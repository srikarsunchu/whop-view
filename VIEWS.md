# VIEWS.md

`wv` is the human view layer for the Whop CLI. It wraps `whop`, asks it for JSON, and renders for a person. Agents and scripts never see it. Written against `whop` 0.18.2, API 2026-09-15, from real envelopes captured on 2026-09-19 and 2026-09-21.

## Rendering approach: plain ANSI

Plain ANSI with a tiny layout engine, not Ink. Every view here is a static print: a table, a card, a prompt, a footer. Nothing re-renders except the spinner and the y/N prompt, and both are one line. Ink brings React, a reconciler, and a 4 MB install to draw lines that `process.stdout.write` draws in one call. It also makes snapshot tests indirect, because the output is a virtual tree instead of the bytes the terminal gets. The layout engine we need is under 200 lines: measure visible width, pad, truncate with an ellipsis, wrap at a column, and join columns. If a later view needs live keyboard navigation, that is a new decision, not this one. That decision came on 2026-09-21 and is recorded under [Session](#session): still plain ANSI, still no dependency, one three-line live region and nothing else.

## The three layers

```
tokens      src/tokens.ts        roles, spacing, breakpoints. Only file that names a color.
primitives  src/primitives/*.ts  table, kv, callout, footer, prompt, spinner. Data + width in, string out.
views       src/views/*.ts       list, detail, confirm, error, help, home. Compose primitives.
copy        src/copy.ts          every string a person reads.
```

**Tokens.** Roles, never colors, outside `tokens.ts`.

| role | use | ANSI |
|---|---|---|
| `text` | default | none |
| `muted` | secondary values, footers, ids | dim |
| `accent` | primary label column, section titles | bold |
| `good` | active, paid, live, succeeded | green |
| `warn` | past_due, canceling, pending, money verbs | yellow |
| `bad` | failed, needs_response, errors, destructive verbs | red |
| `mono` | commands and flags | dim + no color |

Spacing: 2 columns between table columns, 1 blank line between blocks, 2-space indent inside cards. Breakpoints: `narrow` under 80, `normal` 80 to 119, `wide` 120 and up. Width comes from `--width`, then `process.stdout.columns`, then 80. `NO_COLOR` set or `FORCE_COLOR=0` strips every escape.

**Primitives.** Each is a pure function `(data, width) => string[]`.

| primitive | signature | rules |
|---|---|---|
| `table` | `(columns, rows, width)` | Right-align money and counts. Truncate the primary column last. Drop lowest-priority columns until it fits. Never wrap a row. |
| `kv` | `(sections, width)` | Section title in `accent`, key in `muted` padded to the longest key in that section, value wraps at width minus key width. |
| `callout` | `(role, title, lines, width)` | One-character gutter in the role color, title bold, body wraps. |
| `footer` | `(lines, width)` | Every line `muted`. Commands inside are `mono`. |
| `prompt` | `(question, defaultNo)` | Prints `question [y/N]`, reads one line from the TTY, resolves `boolean`. |
| `spinner` | `(label)` | Braille spinner on one line, cleared on stop. Only shown after 300 ms. |
| `rule` | `(title?, role, char)` | A horizontal rule, optionally with a title set into it. Section headers in kv and help use it. |
| `breadcrumb` | `(segments)` | Segments joined by a muted chevron, wrapping at width. The home status line. |

**Views.** Compose primitives. Never call `whop` directly; the runner hands them a parsed envelope.

## Ads gate

The CLI has no sandbox for ads, so the plan is the sandbox. `src/views/adplan.ts` renders `create` and `update` under `ads`, `ad-groups`, and `ad-campaigns` as one card before any write. `bin.ts` gathers it: `auth status`, `accounts preferences` (payment method, reporting currency), `social-accounts list`, `ledgers report balance_summary`, then `ad-groups get` and `ad-campaigns get` for the ids on the command line, `audiences list` when the group names audiences, and one real `ad-groups estimate_reach` built from the group's targeting flags (`reachArgv`). The pure parts are tested without the network.

```
 ▌ Create an ad                                             writes to production

   whop ads create …

   campaign  <title>  <id>            existing nodes are muted
             objective  sales          new nodes are `new`
   group     <title>  new
             budget     $40.00/day
             goal       conversions on purchase
             targeting  US · ages 25–44 · automatic placements
   ad        <title>  new
             creative  shop now · 2 creatives · 2 headlines

   reach       1.5M–1.8M people on meta       warn when Whop could not estimate
   spend       $40.00/day · $1,200.00 over 30 days · no end date
   pays from   visa ••••4242                  warn when no ads payment method
   runs under  <page> (facebook) @handle      warn plus the connect command when none
   from        <account>  <biz_id>
   cap         $500.00 committed spend per plan from wv
```

Rules:

- The budget that gets typed back is the one on the command line (`--budget_amount`, or inside `--ad_group`). A budget found on a fetched group or campaign is shown as `from the existing … budget` and the prompt is y/N.
- Commitment is daily × days until `ends_at`, or × 30 with `no end date`; lifetime is itself. Over `WV_AD_CAP` (default $500, `none` off) refuses with exit 2 and names the env var and the end-date fix.
- `--plan` is a wv flag: render the card with an `accent` gutter and `plan only · nothing runs`, exit 0. It also skips the cap and the timeout, since nothing runs.
- Sandbox mode skips the cap and the timeout and still runs the estimate, which the sandbox host will usually refuse; the card shows that refusal.
- The callout tag drops to its own line when the title and the badge do not both fit, since `Create an ad campaign` plus the badge is wider than 40 columns.

## Passthrough rules

`wv` renders only when all of these hold. Otherwise it execs `whop` with the original argv, inherits stdio, and exits with its code.

1. `process.stdout.isTTY` is true.
2. No `--format`, `--full-output`, `--filter-output`, `--llms`, `--llms-full`, `--schema`, `--help`, `-h`, or any `--token-*` flag in argv.
3. `WV_RAW` is unset.
4. The command is not `login`, `logout`, `quickstart`, `upgrade`, `apps dev`, `apps deploy`, `apps init`, or `apps pull`. These are interactive or streaming in `whop` itself and must own the terminal.

When rendering, the runner spawns `whop <argv> --format json --full-output` with stdio piped, parses stdout once, and renders. stderr from `whop` passes through unchanged. Exit code is `whop`'s exit code.

## Envelope shapes

Captured from the real CLI. With `--full-output`:

```
success   { ok: true,  data: <payload>, meta: { command, duration } }
failure   { ok: false, error: { code, message, fieldErrors? }, meta: { command, duration, cta? } }
```

Payload shapes the views must recognize:

| shape | detect | view |
|---|---|---|
| page | `data.data` is an array and `data.page_info` exists | list |
| record | `data.id` is a string | detail |
| series | `data.data.points` is an array | sparkline row |
| report | `data.report_type` and `data.rows` exist | kv from rows |
| status | `data.loggedIn` exists | home identity |
| summary | `data.total` is a number and `data.groups` is an object of count objects | counts by facet |
| anything else | | detail, flat |

Every payload may carry `recommended_action` as a marketing string. It is always hidden.

`meta.cta` is `{ description, commands: [{ command, description? }] }`. The error view renders it verbatim.

## Inference rules

Applied to each field, in order. First match wins. Schema comes from `whop <group> <verb> --schema --format json`, fetched once and cached at `~/.cache/whop-view/<group>.<verb>.json`. Schema describes options, not the response, so it is used for enum lists and descriptions in help. The response is inferred from data.

| # | rule | detect | render |
|---|---|---|---|
| 1 | hidden | key in `HIDDEN` or in hints `hidden` | never shown |
| 2 | id | string matching `^[a-z]{2,5}_[A-Za-z0-9]{8,}$` with at least one digit or capital after the underscore | `mono`, `muted` in lists, full in detail |
| 3 | money object | object with `amount` and `currency` | `money()`: `$10.00`, right-aligned |
| 4 | money number | key in hints `money`, or key matches `/price|amount|balance|spend|revenue|fee/` and value is a finite number | `money(value, currency)` where `currency` is a sibling key or `usd` |
| 5 | ledger amount | sibling `usd_amount` exists | use `usd_amount`, ignore `amount` and `currency.precision` |
| 6 | date | string matching ISO 8601, or key ends in `_at` and value is a number | list: `relative()` like `3d ago`. detail: `Sep 16, 2026 00:04 UTC` then `relative()` in `muted` |
| 7 | status | key is `status` or `visibility` or in hints `status`, value is a string under 20 chars | badge in `STATUS_COLOR` role, underscores to spaces |
| 8 | bool | boolean | `yes` / `no`, `muted` when false |
| 9 | relation | object with `id` and one of `title`, `name`, `username` | `Title` then id in `muted`. Lists show title only. |
| 10 | user | object with `username` | `name @username` |
| 11 | image | object with only `url` | hidden in lists, url in detail |
| 12 | array of scalars | | count in lists (`3 labels`), joined in detail |
| 13 | array of objects | | count in lists, first 5 as a nested kv in detail |
| 14 | long text | string over 60 chars | hidden in lists, wrapped in detail |
| 15 | empty | `null`, `""`, `{}`, `[]` | `—` in lists, hidden in detail |
| 16 | scalar | anything else | as is, numbers right-aligned |

`HIDDEN` is `object`, `metadata`, `recommended_action`, `previous_hosted_urls`, `businesses_created_logo_urls`, `checkout_styling`, `payment_method_configuration`, and any key ending in `_decimals`.

**Default list columns**, in priority order, capped at 6 at `normal` and 8 at `wide`:

1. primary label: hints `primary`, else first of `title`, `name`, `user`, `plan_name`, `product_name`, `line_type`, `id`
2. status: rule 7
3. first money field
4. one date: hints `date`, else `created_at`, else the first rule-6 field
5. one relation: hints `relation`, else `product`, `plan`, `user`, `account` in that order
6. id, always last, always `muted`
7. at `wide`: `member_count`, then the next money field

Column drop order under width pressure: 7, 5, 4, 3, 2. The primary label and id never drop.

**Detail sections**, in order: identity (primary, id, route, urls), status (rule 7 and rule 8 fields), money (rules 3 to 5), dates (rule 6), relations (rules 9 and 10), everything else. Empty sections are skipped.

## Hints schema

`src/hints/<resource>.json`, or `src/hints/<resource>.<verb>.json` when one verb returns rows that share nothing with the group's list (`payouts methods`, `cards transactions`, `accounts reserves`, `partners list`). A verb file wins whole; it never merges with the group file. Every key optional. Forty-odd shipped. The 2026-09-21 batch (economic-intelligence, cards, transfers, swaps, dispute-alerts, resolution-center-cases, checkout-configurations, notifications, exports, domains, verifications, events, bounty-submissions, audiences, experiments, payment-rules, cashback-rules) was written from the response schemas in `https://api.whop.com/openapi.json`, because this account has no rows in any of them; `--schema` describes options, not responses, so it could not have helped.

```json
{
  "primary": "title",
  "status": "visibility",
  "money": ["initial_price", "renewal_price"],
  "date": "created_at",
  "relation": "product",
  "columns": ["title", "visibility", "default_plan", "member_count", "created_at", "id"],
  "hidden": ["gallery_images", "external_identifier"],
  "labels": { "member_count": "members", "plan_type": "billing" },
  "detailKey": "get",
  "listKey": "list"
}
```

Shipped hints and what each fixes:

| resource | why it needs hints |
|---|---|
| products | `default_plan` should render as `planPrice()`, not a relation. `visibility` is the status. |
| plans | money is plain numbers plus `formatted_price`. Use `formatted_price` when present. Primary is `title`, relation is `product`. |
| memberships | no title. Primary is `member.user` then `user_id`. Status is the whole story. `current_period_end` is the date. |
| members | primary is `user`, status is `status`, second column is `access_level`, date is `last_accessed_at`. |
| payments | has no `list`. Only `status <id>` and `return_url <id>`. Hints cover the detail view of `status`. |
| payouts | money is `amount` plus `currency`. `speed` and `status` both matter. Money verb, warn role in confirm. |
| ledgers | `list` is the payments feed. Primary is `line_type` titled, money is `usd_amount`, date is `posted_at`, relation is `product_name`. `report` renders rows as a kv keyed by `line_category`. |
| disputes | status drives everything, `needs_response` is `bad`. Money is `amount`. |
| ad-campaigns | primary `name`, status `status`, money `daily_budget` and `spend`. |
| apps | primary `name`, status `status`, `hosted_url` in identity, `creator` is a user relation. |

## Formatters and maps ported from whop-desktop

Unchanged behavior, copied into `src/format.ts` and `src/status.ts`:

- `money`, `num`, `compact`, `relative`, `shortDate`, `pctDelta`, `titleCase`, `planPrice` from `src/lib/format.ts`
- `STATUS_COLOR` from `src/components/UserCell.tsx`, mapped onto roles: green to `good`, amber to `warn`, red to `bad`, blue to `accent`, gray to `muted`
- `SCOPE_HINTS` pattern from `src/components/Panel.tsx`, extended with `HTTP_404`, `VALIDATION_ERROR`, rate limit, and `COMMAND_NOT_FOUND`
- `WRITE` verb regex from `src/views/Terminal.tsx`, plus the money groups `payouts`, `swaps`, `transfers`, `cards`, `deposits`
- `withAccount` rules from `src/lib/whop.ts`, used only to decide whether `--account_id` appears in the teaching footer

## Views

### list

```
 products · 2                                                    Hypermotion

 title        visibility  plan         members  created   id
 Frame        visible     Free               0  8d ago    prod_DQf7IZAtveRoK
 Hypermotion  visible     $10.00             2  8d ago    prod_iQ2Zub6GFQS5Q

 2 of 2 · no more pages
 json  whop products list --format json --filter-output id,title,visibility,default_plan,member_count,created_at
```

Header: noun, count, account title right-aligned. The noun is the group, or the verb when it names a sub-resource: `payouts methods` heads `methods · 0` and ends `No methods yet.` with no create hint, not `No payouts yet.` Footer: `n of total`, `next: --after <cursor>` when `has_next_page`, then the teaching line with exactly the columns shown. Empty page renders the header and `No products yet.` with the create command from copy.

### detail

```
 membership  mem_kfT4Jl8Pb8DlWE

 ── Status ─────────────────────────────────────────────────────────────────────
   status                completed
   cancel at period end  no

 ── Dates ──────────────────────────────────────────────────────────────────────
   created  Sep 16, 2026 00:04 UTC · 3d ago

 ── Relations ──────────────────────────────────────────────────────────────────
   product  prod_iQ2Zub6GFQS5Q
   plan     plan_NrjXyj6yTetff
   account  Hypermotion  biz_VraUMckluH8dzV

 json  whop memberships get mem_kfT4Jl8Pb8DlWE --format json
```

Bare ids in relations are looked up only if the hints say `resolve: true` for that key. Default is no extra calls.

### confirm

```
 ▌ Create a payout                                          writes to production

   whop payouts create --amount 250 --currency usd --payout_method_id potk_x1
   --speed standard

   amount   $250.00 usd
   to       Chase checking ••••4242  potk_x1
   speed    standard
   from     Hypermotion  biz_VraUMckluH8dzV
   balance  $418.56 available · $168.56 after
   cap      $1,000.00 standard from Whop · $500.00 from wv · $9,999.00 left
            today

   This runs against production. The Whop CLI has no dry-run. This moves real
   money. The prompt expires in 2 minutes.

 try first  wv --sandbox payouts create --amount 250 --currency usd
            --payout_method_id potk_x1 --speed standard
 Type 250 to send it [250/N]
```

Verbs that trigger it: `create update delete cancel pause resume transfer deploy publish unpublish replay extend invite duplicate retry_payment transfer_ownership form_company` and any verb under `payouts swaps transfers cards deposits` except the reads there (`list get methods transactions get-transaction recipients quote quotes status supported-methods`). Money groups and `delete`, `cancel`, `transfer_ownership` get `bad` gutter; other writes get `warn`. Summary rows come from the flags given, rendered through the same inference rules. The command line is the argv shell-quoted once, so a title with a space shows the way it must be typed. `--yes` skips the prompt. Non-TTY never reaches this view. On `n` exit 130 without calling `whop`.

**Money gate.** A money group with `--amount` gets the Link-shaped approval on top. Before the prompt, `wv` runs `payouts methods --include_limits --currency <cur>` and `ledgers report --report_type balance_summary --currency <cur>` alongside `auth status`, and adds three rows. `to` is the saved payout method behind `--payout_method_id` as `nickname account_reference  id`, falling back to `institution_name` then the destination category, with the bare id plus a `warn` note when it is not in the list. `balance` is the available amount and what remains after, in `bad` when negative. `cap` is Whop's live limit for the payout's speed (`limits.<speed>.max_amount`, with `daily_amount_remaining` when sent) next to `wv`'s own cap, in `bad` when the amount is over Whop's. Three refusals, in order: over Whop's limit (`refusedView` prints Whop's `error_message` verbatim, since "complete identity verification" beats any paraphrase), over `wv`'s cap, over the balance. Each is a `bad` callout tagged `not run`, the same rows, exit 2, and `whop` is never called. The cap is `WV_PAYOUT_CAP` in whole currency units, default 500, `none` to disable. The prompt for a live money write is `Type 250 to send it [250/N]`, accepting the amount in any common spelling (`amountMatcher`), and `y` is not consent. A money prompt expires after `WV_CONFIRM_TIMEOUT` seconds, default 120, and prints `Not run. The prompt sat for 2 minutes.` with exit 130. The last line of every production money confirm is `try first  wv --sandbox <same argv>`. A balance or limit that cannot be read simply has no row; the API answers a valid report with a web page now and then, and a missing `payout:withdrawal:read` scope drops `limits`, and neither must block a payout.

**Sandbox.** `--sandbox` or `WV_SANDBOX=1` sets the mode. `whopEnv` in the runner gives the child `WHOP_API_BASE_URL` (`WV_SANDBOX_URL` or `https://sandbox-api.whop.com`) and `WHOP_API_KEY` from `WV_SANDBOX_KEY` when set. In sandbox the badge reads `writes to sandbox`, the gutter is `warn`, the warning says no real money moves, the cap and the timeout are off, and there is no `try first` line. The banner and home status line show `sandbox` in `good` instead of `production` in `warn`. A 401, 403, or 404 in sandbox mode without a sandbox key adds one line naming `WV_SANDBOX_KEY`.

### summary

```
 resolution-center-cases summary · 0 total

 ── By status ──────────────────────────────────────────────────────────────────
   awaiting merchant  0
   awaiting customer  0
   under review       0
   closed             0

 ── By reason ──────────────────────────────────────────────────────────────────
   fraudulent             0
   product not received   0

 json  whop resolution-center-cases summary --format json
```

`disputes summary` and `resolution-center-cases summary`. One section per facet, one row per bucket, zero rows kept because `won 0` is an answer. Status buckets take the status color. An empty facet (no currencies yet) is skipped. Before this view the shape fell to the flat detail: rule 4 painted `total` as `$0.00` because the key matches `/total/`, and the two-level flatten capped at eight lines, so the outcome facet never showed.

### error

```
 ▌ Not a command                                                  0ms

   'prodcts' is not a command for 'whop'. Did you mean 'products'?

   Suggested commands:
     whop products list
     whop --help              see all available commands
```

Title comes from a code map in copy: `COMMAND_NOT_FOUND` Not a command, `HTTP_404` Not found, `HTTP_401` Not signed in with fix `whop login`, `HTTP_403` and `Missing required permission` Missing permission with fix `whop login --api-key`, `HTTP_429` Rate limited, `VALIDATION_ERROR` Missing or invalid flags with one line per `fieldErrors[].path`, ENOENT Whop CLI not found with the install one-liner. Unknown codes render the code as the title. `meta.cta` renders after the message when present; the runner strips `--format json --full-output` from suggested commands so people see the human form.

### help

```
 whop 0.18.2 · API 2026-09-15                      type wv <group> --help

 GET STARTED
   quickstart   Start here — choose or create the business used by the CLI
   apps         Build and deploy fully-hosted web apps (*.whop.site)
   upgrade      Update the CLI to the latest version

 COMMERCE
   products     The things you sell. Each owns plans and a store page.
   plans        Pricing for a product: one-time, recurring, trials, stock.
   ...
```

Groups and order are parsed from `whop --help` at runtime, never hardcoded, so the 51 stay in sync. One column at `normal`, two at `wide`. Descriptions truncate to width. `wv <group>` with no verb renders that group's verbs the same way.

### home

```
 Frame › biz_VraUMckluH8dzV › sunchusrikar · oauth › API 2026-09-15
 $18.56 available

 Net revenue · 7d  $18.56  █▁▁█▁▁▁
                   Sep 12 to Sep 18

 auth status · ledgers report --report_type balance_summary · stats get net_rev…
```

The first line is a breadcrumb status line in the style of omp's bar: account, id, profile and method, API version, then each balance bucket. It wraps at width. Three calls run in parallel: `auth status`, `ledgers report --report_type balance_summary`, and `stats get net_revenue --from <today-7> --to <today-1> --interval day`. `stats get` requires `--from` and `--to`, so home computes them in UTC. A failed tile renders its error inline and the others still show. Sparkline is eight block characters scaled to the max point.

### series

```
 net revenue · 7d  $18.56  █▁▁█▁▁▁

   Sep 13  $9.28
   Sep 14  $0.00
   ...

 json  whop stats get net_revenue --from 2026-09-12 --to 2026-09-18 --interval day --format json
```

`stats get <metric>`: metric name, total, and the sparkline from home on one line, then one row per point with the money formatted in the series currency. Zero points are muted. Before this view a series fell through to the flat detail card and printed raw numbers under a "Details" rule.

## Session

`wv` with no arguments in a TTY opens a session. Not an alternate screen. Output scrolls into the terminal's own buffer the way Claude Code and omp transcripts do, and the only thing ever redrawn is a three-line editor block plus one hint line:

```
 Frame › biz_VraUMckluH8dzV › production › sunchusrikar · oauth › API 2026-09-15 › whop 0.18.2 · wv session
 ● Tip  Type 1 after a list to open that row

 ─────────────────────────────────────────────────────────────────────────────
 ❯ products
 ─────────────────────────────────────────────────────────────────────────────
 ❯ list     List Products
   get      Retrieve Product
 tab cycles · enter picks · esc closes
```

The banner is the home breadcrumb without the balance, so opening a session costs one `auth status`, plus a `production` segment in `warn` so the stakes are always on screen, plus one tip drawn at random from `copy.session.tips`. The block is rule, `❯` prompt, rule (the aura editor shape, without the gradient: roles, not colors). Under it, completion candidates when there are several, then the key hint, which swaps by state: the idle hint, or the picker's keys while candidates are open. Redraw is cursor-up-one, clear-to-end, print again. Resize redraws at the new width. What you typed is echoed with the same `▌` gutter callouts use, in `accent`.

**Editor.** A pure reducer, `applyKey(state, key) → { state, action? }`, in `src/tui/editor.ts`. Insert, left, right, home, end, backspace, delete, ctrl-a/e/b/f, ctrl-u/k/w, alt-b/f/d, alt-backspace, ctrl-left/right. Up and down walk history newest first and keep the live draft. Enter submits, tab completes, ctrl-l redraws, ctrl-c clears the line or quits when it is empty, ctrl-d deletes forward or quits when the line is empty, and two escapes within half a second on an empty line quit. Bracketed paste is on, so a pasted command arrives as one insert. Long lines scroll horizontally around the cursor. History persists at `$XDG_STATE_HOME/whop-view/history`, 500 lines.

**Completion.** `src/tui/complete.ts`. Word 0 offers groups from `whop --help` plus the builtins. Word 1 offers the group's verbs from `whop <group> --help`. Later words: a token starting with `-` offers the verb's `Options:` block, minus flags already used; after an `<a|b>` flag, its values; after the verb or an `--x_id` flag, the ids on screen from the last list. One candidate completes with a trailing space, several fill the common prefix and open a picker under the block: tab moves the pointer, enter puts the pick on the line, esc closes, any other key closes and edits. The list shows eight at a time in a window that follows the pointer, with `↑ N above` and `↓ N below`. Prefix matches win outright in catalog order, so tab behaves like a shell. Only when nothing starts with the word do in-order subsequence matches appear, scored prefix 100 then subsequence 50 plus density, shorter first (the Dodo CLI palette's ranking). A lone subsequence match completes like a lone prefix match; several share no prefix, so the line stays put. Help text is cached for a day at `~/.cache/whop-view/help/`, because each `whop --help` costs a quarter second.

**Commands.** A line is `wv` argv; a leading `wv` or `whop` is dropped so either can be pasted. `home`, `help`, `help <group>`, `clear`, `quit`, `copy <N>`, `copy json`, `next`. `!<args>` runs raw `whop` owning the terminal, for `login` and friends. A bare number `N` runs `<group> get <id>` for row N of the last list; `copy N` puts that id on the clipboard through OSC 52 plus `pbcopy`, `wl-copy`, `xclip`, `xsel`, or `clip`, whichever is there, and confirms with a `good` notice; `copy json` copies the agent command from the last teaching footer, the same argv the footer printed, quoted by `shellJoin` once; `next` runs the wv argv for the following page, which `listViewWithMeta` returns as `next` (the same argv with `--after <end_cursor>` appended or replaced) while `has_next_page` holds; session lists render a muted row-number gutter so N is visible, and the gutter never enters the teaching footer. Write verbs confirm inline through the same y/N prompt as the CLI: the session hands the TTY to readline and takes it back.

**Shared dispatch.** `execute(argv, theme, opts)` in `src/bin.ts` runs one command end to end, prints it, and returns the exit code and any list rows. The one-shot CLI calls it once and exits; the session calls it per line. Nothing in `src/views` knows the session exists, apart from the optional numbered gutter on lists.

**Not done, deliberately.** No live row highlighting with arrow keys: that needs re-rendering a table region and is a fourth line of live state for a shortcut the number gutter already provides. No gradient, no truecolor: tokens still name six roles. No `pi-tui`, no Ink.

**Tests.** `tests/tui.test.ts` covers the key parser, the reducer, history, actions, the editor render at 40 columns, tokenizing, and completion against the help fixtures. The loop itself is exercised by hand in a pseudo-TTY, not in CI.

## Borrowed from the Dodo CLI

Eight session patterns from `dodopayments-cli` 3.1.0, reproduced without its OpenTUI and Solid runtime: the state-dependent hint row, a spinner whose label moves as a command progresses (`spinner().update`), the mode badge in the status row (theirs is TEST or LIVE, ours is `production`), the gutter on echoed input, prefix-then-subsequence ranking with a windowed picker, double-escape to quit, clipboard through OSC 52, and a random tip under the banner. Not borrowed: mouse selection, bordered tables, per-group heading colors, the full-screen scrollbox, and the ASCII wordmark.

## Borrowed from omp

Four patterns from the oh-my-pi TUI, reproduced in the plain renderer with no dependency: the breadcrumb status line (home), titles set into horizontal rules (detail sections and help groups), the dashed band for notices (feature-gated errors), and the name-left description-right picker shape (help). Its `@oh-my-pi/pi-tui` package was considered and rejected: it depends on the agent runtime and native addons, and every wv view is a static print.

## Deviations from the brief, found against the real CLI

- In a TTY the CLI colors its TOON and hides empty fields with a footer count. The brief's "no color" claim came from piped probes. The gap is layout, not color.
- The CLI auto-upgraded from 0.16.3 to 0.18.2 during the build. `payments list` exists on 0.18.2. Fixtures were re-recorded on 0.18.2.
- Feature-gated errors (`HTTP_403` with "You don't have access to X yet") are not permission problems. They render muted with no fix command, matching whop-desktop's `unavailable` branch.
- The empty-state hint `whop <group> create --help` only appears when the group's help lists a `create` verb. Refunds and dispute alerts have none.
- Phone numbers, IP addresses, and user agents are hidden everywhere. Emails render in detail only. People and api-logs carry all three.
- Keys ending in `token`, `secret`, `password`, or `private_key` never render. `apps get` returns a live preview JWT.
- Payments carry a full billing address. It is hidden by hint. Emails and card display names stay, since a merchant looking at one payment needs them.
- Nested objects without a name flatten two levels in detail, so `verification` shows `individual status  verified` instead of `2 fields`.
- Whop's CLI docs say there is no sandbox. The API spec lists `sandbox-api.whop.com`, the binary supports `WHOP_API_BASE_URL`, and that host answers like production but rejects an OAuth token with 401. So: a sandbox exists, the CLI does not expose it, and there is no dry-run flag. The confirm view says "runs against production" rather than "no sandbox".
- The API occasionally answers a valid `get` with an HTML page. That renders as "Not a JSON response" rather than a raw doctype.
- On 2026-09-21 the sandbox host answered `products list` under an OAuth login with 404, not the 401 seen earlier. The sandbox hint fires on either.
- vhs 0.12 only writes frames into a directory that does not exist yet. A rerun over an old `demo/<name>.frames/` keeps the stale capture and says nothing, so `pnpm demo` clears them first.
- A page's sibling keys survive as `extra` on the envelope (`limits` on `payouts methods --include_limits`). `recommended_action` is dropped there as everywhere.
- Teaching footers and the confirm command line are argv arrays until `footer` or `confirmView` prints them. `src/argv.ts` quotes anything outside `[A-Za-z0-9_@%+=:,./-]` with POSIX single quotes and leaves `<biz_id>` placeholders bare. Product titles and notes are user text and will land in a command eventually; this is where that is solved once.

- `stats get` requires `--from` and `--to`. Home supplies a 7-day UTC window.
- `ledgers list` rejects `--first`. Fixtures capture it without paging flags.
- Ledger lines carry `amount` in 1e8 precision units and `usd_amount` in dollars. Rule 5 uses `usd_amount`.
- Two money shapes exist: `{ currency, amount: "10.00" }` objects and plain numbers with a sibling `formatted_price`. Rules 3 and 4 cover both.
- `--full-output` is also a passthrough trigger, since a person asking for the envelope wants the envelope.
- Local Node is 25.8. `engines` says 22 or newer. Tests run with `--experimental-strip-types` so there is no build step for the test loop.
- Rule 7 (status) runs before rule 2 (id). `needs_response` is five lowercase letters, an underscore, and eight more, which is the id shape. Status keys are known, so they win.
- The teaching footer names the columns that survived width pressure, not the ones the hints asked for. The table reports what it kept.
- `tsc` does not copy JSON, so `pnpm build` copies `src/hints` into `dist/hints`.
- Homebrew's vhs 0.12 writes no GIF against ffmpeg 9 and says nothing. Tapes emit frames and `scripts/gif.sh` encodes them.
- The id shape `[a-z]{2,5}_[A-Za-z0-9]{8,}` also matches snake_case words: `tax_behavior`, `needs_tracking`, `gross_earnings`, `ad_delivery`. Ten distinct false positives in the fixtures, so `stats list` painted a quarter of its keys muted. Real ids always carry a digit or a capital. Rule 2 requires one.
- Node's readline swallows Ctrl-C in raw mode and emits `SIGINT` on the interface. With no listener the y/N prompt sat forever, and once stdin closed the process exited 0 as if the write had succeeded. The prompt now treats Ctrl-C, Ctrl-D, and a closed stdin as no.
- Column caps (id 22, primary 36, others 28) applied before anything was measured, so ledger ids truncated at 120 columns with 20 to spare. Caps now apply only once the table is under width pressure.
- The kv card assumed the value column was at least 16 wide, which was false under about 50 columns, so detail views overflowed. Sections stack key over value when the value would be narrower than 16.
- Help text's headline was truncated to make room for the right-hand hint, so at 40 columns the header read `who…`. The hint drops first, then the API version, and only then does the headline truncate.
- The home footer joined three commands with `·` and truncated, losing the third at 80. One teaching line per command.
- Every verb under a money group was gated, so `wv cards transactions` and `wv payouts methods` asked for consent to read. `MONEY_READ_VERBS` in `status.ts` names the reads.
- `accounts reserves` and `verifications list` answer `{ data: [] }` with no `page_info`. They classify as a page already; the header said `accounts · 0` and `No accounts yet.` until the list took a noun.
- `recommended-actions` is gone from the CLI; `economic-intelligence` replaced it, and this account gets `HTTP_403` there. `error.gated` captures that.

## Tests

- `pnpm fixtures` runs the read commands above with `--format json --full-output` and writes `tests/fixtures/<group>.<verb>.json` byte for byte. Committed.
- Snapshot tests render every view from fixtures at widths 80 and 120, with color and with `NO_COLOR=1`. Six views, two widths, two color modes.
- Passthrough test: `wv products list | cat` and `whop products list` produce identical bytes, and `WV_RAW=1 wv products list` in a pseudo-TTY does too.
- Inference tests: one assertion per rule in the table above, using slices of the fixtures.
