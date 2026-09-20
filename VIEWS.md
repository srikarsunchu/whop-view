# VIEWS.md

`wv` is the human view layer for the Whop CLI. It wraps `whop`, asks it for JSON, and renders for a person. Agents and scripts never see it. Written against `whop` 0.16.3, API 2026-08-25-2, from real envelopes captured on 2026-09-19.

## Rendering approach: plain ANSI

Plain ANSI with a tiny layout engine, not Ink. Every view here is a static print: a table, a card, a prompt, a footer. Nothing re-renders except the spinner and the y/N prompt, and both are one line. Ink brings React, a reconciler, and a 4 MB install to draw lines that `process.stdout.write` draws in one call. It also makes snapshot tests indirect, because the output is a virtual tree instead of the bytes the terminal gets. The layout engine we need is under 200 lines: measure visible width, pad, truncate with an ellipsis, wrap at a column, and join columns. If a later view needs live keyboard navigation, that is a new decision, not this one.

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

**Views.** Compose primitives. Never call `whop` directly; the runner hands them a parsed envelope.

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
| anything else | | detail, flat |

Every payload may carry `recommended_action` as a marketing string. It is always hidden.

`meta.cta` is `{ description, commands: [{ command, description? }] }`. The error view renders it verbatim.

## Inference rules

Applied to each field, in order. First match wins. Schema comes from `whop <group> <verb> --schema --format json`, fetched once and cached at `~/.cache/whop-view/<group>.<verb>.json`. Schema describes options, not the response, so it is used for enum lists and descriptions in help. The response is inferred from data.

| # | rule | detect | render |
|---|---|---|---|
| 1 | hidden | key in `HIDDEN` or in hints `hidden` | never shown |
| 2 | id | string matching `^[a-z]{2,5}_[A-Za-z0-9]{8,}$` | `mono`, `muted` in lists, full in detail |
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

`src/hints/<resource>.json`. Every key optional. Eighteen shipped; every other resource renders from inference alone.

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

Header: group, count, account title right-aligned. Footer: `n of total`, `next: --after <cursor>` when `has_next_page`, then the teaching line with exactly the columns shown. Empty page renders the header and `No products yet.` with the create command from copy.

### detail

```
 membership  mem_kfT4Jl8Pb8DlWE

 Status
   status                completed
   cancel at period end  no

 Dates
   created               Sep 16, 2026 00:04 UTC · 3d ago

 Relations
   account               Hypermotion  biz_VraUMckluH8dzV
   product               prod_iQ2Zub6GFQS5Q
   plan                  plan_NrjXyj6yTetff
   user                  user_3meX572iT5dAg

 json  whop memberships get mem_kfT4Jl8Pb8DlWE --format json
```

Bare ids in relations are looked up only if the hints say `resolve: true` for that key. Default is no extra calls.

### confirm

```
 ▌ Send a payout                                        writes to production

   whop payouts create --amount 250 --currency usd --payout_method_id potk_x1

   amount     $250.00 usd
   speed      standard
   from       Hypermotion  biz_VraUMckluH8dzV

   The Whop CLI has no sandbox or dry-run. This moves real money.

 Run it? [y/N]
```

Verbs that trigger it: `create update delete cancel pause resume transfer deploy publish unpublish replay extend invite duplicate retry_payment transfer_ownership form_company` and any verb under `payouts swaps transfers cards deposits`. Money groups and `delete`, `cancel`, `transfer_ownership` get `bad` gutter; other writes get `warn`. Summary rows come from the flags given, rendered through the same inference rules. `--yes` skips the prompt. Non-TTY never reaches this view. On `n` exit 130 without calling `whop`.

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
 whop 0.16.3 · API 2026-08-25-2                    type wv <group> --help

 GET STARTED
   quickstart   Start here — choose or create the business used by the CLI
   apps         Build and deploy fully-hosted web apps (*.whop.app)
   upgrade      Update the CLI to the latest version

 COMMERCE
   products     The things you sell. Each owns plans and a store page.
   plans        Pricing for a product: one-time, recurring, trials, stock.
   ...
```

Groups and order are parsed from `whop --help` at runtime, never hardcoded, so the 51 stay in sync. One column at `normal`, two at `wide`. Descriptions truncate to width. `wv <group>` with no verb renders that group's verbs the same way.

### home

```
 Frame  biz_VraUMckluH8dzV                     sunchusrikar · oauth

 Balance                    Net revenue · 7d
   available     $18.56       $18.56  ▁▁█▁▁█▁▁
                              Sep 12 to Sep 18

 auth status · ledgers report --report_type balance_summary · stats get net_revenue --from 2026-09-12 --to 2026-09-18 --interval day
```

Three calls run in parallel: `auth status`, `ledgers report --report_type balance_summary`, and `stats get net_revenue --from <today-7> --to <today-1> --interval day`. `stats get` requires `--from` and `--to`, so home computes them in UTC. A failed tile renders its error inline and the others still show. Sparkline is eight block characters scaled to the max point.

## Deviations from the brief, found against the real CLI

- In a TTY the CLI colors its TOON and hides empty fields with a footer count. The brief's "no color" claim came from piped probes. The gap is layout, not color.
- The CLI auto-upgraded from 0.16.3 to 0.18.2 during the build. `payments list` exists on 0.18.2. Fixtures were re-recorded on 0.18.2.
- Feature-gated errors (`HTTP_403` with "You don't have access to X yet") are not permission problems. They render muted with no fix command, matching whop-desktop's `unavailable` branch.
- The empty-state hint `whop <group> create --help` only appears when the group's help lists a `create` verb. Refunds and dispute alerts have none.
- Phone numbers, IP addresses, and user agents are hidden everywhere. Emails render in detail only. People and api-logs carry all three.

- `payments list` does not exist. Payments hints target `payments status <id>`. The payments feed is `ledgers list`.
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

## Tests

- `pnpm fixtures` runs the read commands above with `--format json --full-output` and writes `tests/fixtures/<group>.<verb>.json` byte for byte. Committed.
- Snapshot tests render every view from fixtures at widths 80 and 120, with color and with `NO_COLOR=1`. Six views, two widths, two color modes.
- Passthrough test: `wv products list | cat` and `whop products list` produce identical bytes, and `WV_RAW=1 wv products list` in a pseudo-TTY does too.
- Inference tests: one assertion per rule in the table above, using slices of the fixtures.
