# whop-view

`wv` is a human view layer for the [Whop CLI](https://whop.sh). It wraps `whop`, asks it for JSON, and renders a table, a card, a confirmation, or an error when a person is looking. When a pipe, a script, or an agent is looking, it execs `whop` untouched.

The design is in [VIEWS.md](./VIEWS.md). This README shows it.

> Unofficial, personal-use prototype. Not affiliated with, endorsed by, or distributed by Whop. "Whop" is a trademark of its owner. Built against `whop` 0.18.2, API 2026-09-15.

## Why

The CLI shipped agent-first and it shows. Every command prints every field as TOON. In a terminal that TOON is syntax-colored and empty fields are folded away, which helps, but two products are still 69 lines with no columns, no alignment, and ISO timestamps. `--format md` prints `[object Object]` for nested fields. Errors are two lines. `payouts create` moves real money with no confirmation and no dry-run flag. A sandbox API host exists, but the CLI only reaches it through `WHOP_API_BASE_URL` with a separate sandbox key, and Whop's own CLI docs say there is no sandbox mode. Agents are fine with all of that. People are not. `wv` adds the people layer without touching the agent layer: one rendering system that every command group gets for free, driven by inference plus small hint files.

## Install

```bash
git clone https://github.com/srikarsunchu/whop-view && cd whop-view && pnpm install && pnpm build && pnpm link --global
```

Needs Node 22 or newer and a working `whop` on your PATH. Then use `wv` anywhere you would type `whop`.

`pnpm skill` copies the [`whop-gtm`](skills/whop-gtm/SKILL.md) skill into `~/.claude/skills`, so an agent that runs the Whop CLI learns the go-to-market loop and routes every ad write through `wv`. Whop's own `whop skills add` ships one generic skill with nothing about ads, audiences, bounties, or stats.

## Before and after

### `products list`

Before, 69 lines for two products in a terminal, 83 through a pipe:

```
data[2]:
  - id: prod_DQf7IZAtveRoK
    created_at: "2026-09-11T02:00:09.833Z"
    updated_at: "2026-09-11T02:00:10.189Z"
    title: Frame
    visibility: visible
    headline: null
    description: null
    verified: false
    member_count: 0
    route: frame-97
    published_reviews_count: 0
    average_review_rating: 0
    external_identifier: null
    ...
```

After:

```
 products · 2                                                        Hypermotion

 title        visibility  plan       members  created  id
 Frame        visible     Free             0  8d ago   prod_DQf7IZAtveRoK
 Hypermotion  visible     $29.00/mo        2  8d ago   prod_iQ2Zub6GFQS5Q

 2 rows · no more pages
 json  whop products list --account_id <biz_id> --format json --filter-output
       title,visibility,default_plan,member_count,created_at,id
```

![products list](demo/products-list.gif)

The last line is the teaching footer. It is the exact agent command that returns the columns on screen, so a person who learns `wv` learns `whop`.

### `memberships get <id>`

Before:

```
id: mem_kfT4Jl8Pb8DlWE
status: completed
user_id: user_3meX572iT5dAg
product_id: prod_iQ2Zub6GFQS5Q
plan_id: plan_NrjXyj6yTetff
license_key: null
phone_number: null
cancel_at_period_end: false
current_period_end: null
metadata:
created_at: "2026-09-16T00:04:36.958Z"
member: null
account:
  id: biz_VraUMckluH8dzV
  title: Hypermotion
  route: frame-2524
  logo_url: null
recommended_action: "You don't have access to recommended actions yet. Turn on Whop's Economic Intelligence which ..."
```

After:

```
 membership  mem_kfT4Jl8Pb8DlWE

 Status
   status                completed
   cancel at period end  no

 Dates
   created  Sep 16, 2026 00:04 UTC · 4d ago

 Relations
   user     user_3meX572iT5dAg
   product  prod_iQ2Zub6GFQS5Q
   plan     plan_NrjXyj6yTetff
   account  Hypermotion  biz_VraUMckluH8dzV

 json  whop memberships get mem_kfT4Jl8Pb8DlWE --format json
```

![memberships get](demo/membership-get.gif)

### `payouts create`

Before: the payout is sent. There is no prompt.

After:

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

![payouts create](demo/payout-create.gif)

The recording stops one step earlier than the text above: the demo account has not finished identity verification, so Whop's live limit is $0 and `wv` refuses in Whop's own words before any prompt. That is the gate doing its job.

The gate is shaped like Link's approval step, since a y/N prompt is not enough for a command that moves money. Before it asks, `wv` looks up the saved payout method behind `--payout_method_id`, Whop's live payout limit for the chosen speed, and the available balance in the payout's currency, so the amount, where it goes, what Whop will allow, and the ledger it draws from are all on one card. Three cases refuse before `whop` is called and exit 2: an amount over Whop's own limit for that speed (shown in Whop's words, for example "complete identity verification"), an amount over `wv`'s per-payout cap, and an amount over the available balance. The cap is $500 unless `WV_PAYOUT_CAP` says otherwise, in whole currency units; `none` turns it off. The prompt asks for the amount typed back, not `y`; `250`, `250.00`, and `$250` all count. A prompt left sitting is not consent, so a money prompt expires after two minutes (`WV_CONFIRM_TIMEOUT` in seconds, `none` to wait) and exits 130 like a `n`. The last line is the same command against the sandbox, so the safe path is on screen rather than in an env var you have to know about.

Every write verb gets the confirmation. Money groups and destructive verbs get the red gutter, other writes get yellow. Non-money writes still answer `y`. `--yes` skips it. A pipe never sees it.

### `ads create`

Before: the campaign, the ad group, and the ad are created and start delivering. There is no prompt and no estimate.

After:

```
 ▌ Create an ad                                             writes to production

   whop ads create --title 'Frame · launch v1' --url https://hypermotion.art/frame
   --call_to_action shop_now --ad_group '{"ad_campaign_id":"adcamp_x1", …}' …

   campaign  Frame launch  adcamp_x1
             objective  sales
             budget     on each ad group
   group     US 25-44 · purchase  new
             budget     $15.00/day
             goal       conversions on purchase
             targeting  US · ages 25–44 · automatic placements
   ad        Frame · launch v1  new
             creative  shop now · 2 creatives · 2 headlines · 1 primary text
             url       https://hypermotion.art/frame

   reach       1.5M–1.8M people on meta
   spend       $15.00/day · $450.00 over 30 days · no end date
   pays from   visa ••••4242
   balance     $418.56 available
   runs under  Hypermotion (facebook) @hypermotion
   from        Hypermotion  biz_VraUMckluH8dzV
   cap         $500.00 committed spend per plan from wv

   This runs against production. The Whop CLI has no dry-run. Spend accrues as
   ads deliver and is charged afterward. The prompt expires in 2 minutes.

 try first  wv --sandbox ads create …
 Type 15.00 to create it [15.00/N]
```

![ads create](demo/ads-create.gif)

The plan is the sandbox. Whop has no test mode for ads, so before any `create` or `update` under `ads`, `ad-groups`, or `ad-campaigns`, `wv` fetches the campaign and group the command points at, asks `accounts preferences` for the ads payment method, `social-accounts list` for the page the ad runs under, and runs `ad-groups estimate_reach` for real with the group's targeting. The whole tree is one card: what exists, what is `new`, what it will cost, and who pays. A daily budget with no end date is shown as its 30-day commitment, and a commitment over `WV_AD_CAP` ($500 unless set, `none` to turn off) refuses before `whop` is called. When the reach estimate fails, the card says so in Whop's words, since the create will usually fail the same way. `wv ads create … --plan` prints the card and exits without asking, which is the dry-run the CLI does not have.

### `gtm`

`wv gtm` is the loop on one screen: the funnel over the last seven days, who was here, the audiences, the live campaigns, the offers, and the one-time gaps that block a launch. Eleven reads run in parallel and every number is a `whop` command the footer teaches.

```
 Hypermotion › biz_VraUMckluH8dzV › production › gtm
 last 7 days · Sep 14 to Sep 20

 ── Funnel ──────────────────────────────────────────────────────────────
   store visits        0  ▁▁▁▁▁▁▁
   new users           1  ▁▁▁▁▁▁█
   gross revenue  $10.00  ▁▁▁▁▁▁█
   ad spend        $0.00  ▁▁▁▁▁▁▁

 ── People ──────────────────────────────────────────────────────────────
   seen · 7d  2 people · 2 customers · 2 contactable · 0 attributed to a source

 ── Campaigns ───────────────────────────────────────────────────────────
 No campaigns yet.
 try  wv ads create --help

 ── Before a launch ─────────────────────────────────────────────────────
 ✗ No visit carries a source: the pixel is not installed on your pages, so
   nothing is attributed.
 fix  whop events validate_pixel
 ✗ No Meta page is connected, so every ad command will refuse.
 fix  whop social-accounts connect --platform meta_business --scopes advertise
      --redirect_url <url>
 ✗ Economic Intelligence is off, so `whop economic-intelligence` returns 403.
 fix  whop accounts update-preferences --economic_intelligence true
```

![gtm](demo/gtm.gif)

The gaps are read from what the screen already fetched, not guessed: no person with a source means no pixel, an empty `social-accounts list` means no page, `accounts preferences` says whether an ads payment method and Economic Intelligence exist. Each gap names the command that fixes it.

### `doctor`

`wv doctor` answers one question: is this business set up to sell. Nine checks, each read from a `whop` command the footer teaches, each failing one naming the command that fixes it, or `dashboard only` with the URL when no command can.

```
 Frame › biz_VraUMckluH8dzV › production › doctor

 ✓ signed in     sunchusrikar · oauth · Frame
 ✗ identity      Payouts are blocked: Please complete identity verification
                 before requesting a withdrawal.
 fix  whop verifications create --account_id biz_VraUMckluH8dzV
 ! api key       This oauth login lacks developer:manage_webhook. The api-key
                 profile sandbox is saved; switch to it for those.
 fix  whop auth switch sandbox
 ! pixel         No visit carries a source: the pixel is not installed on your
                 pages, so nothing is attributed.
 fix  whop events validate_pixel
 ! meta page     No Meta page is connected, so every ad command will refuse.
 fix  whop social-accounts connect --platform meta_business --scopes advertise
      --redirect_url <url>
 ! ads payment   No ads payment method on the account, so ads will not deliver.
 dashboard only  https://whop.com/dashboard/biz_VraUMckluH8dzV/
 ! intelligence  Economic Intelligence is off, so `whop economic-intelligence`
                 returns 403.
 fix  whop accounts update-preferences --economic_intelligence true
 ✓ products      2 for sale · Frame · Free · 1 more
 ! webhooks      Webhooks refuse an oauth login. Sign in with an API key to
                 list, create, or test them.
 fix  whop auth switch sandbox

 1 blocking · 6 warnings · 2 ok

 json  whop auth status --format json
       whop auth list --format json
       whop permissions check --resource_id biz_VraUMckluH8dzV --actions …
       …
```

Three checks block: signed in, identity, and a visible product with a plan. When any of those fails, `wv doctor` exits 1, so a deploy script or an agent can gate on it. The rest are warnings. Identity is read from Whop's own payout limit rather than guessed: `payouts methods --include_limits` says in Whop's words why a standard payout would be refused, and that line is the check. The api key check runs `permissions check` on the six scopes a seller needs and says which the active login lacks; when a saved api-key profile exists it names it, otherwise it gives the login command and points at the dashboard, which is the only place a key is minted. The pixel, page, ads payment, and Economic Intelligence checks are the gaps `wv gtm` already derives. Webhooks count as alive when one has a successful delivery in the last seven days; an oauth login cannot list them at all, and the check says so instead of failing.

### Sandbox

Whop's CLI docs say there is no sandbox mode. Link ships `--test`, which returns a fake card and never touches the real payment method, and that is the thing to ask Whop for. Until it exists, `wv --sandbox <anything>` (or `WV_SANDBOX=1`) runs the child `whop` with `WHOP_API_BASE_URL` pointed at `sandbox-api.whop.com/api/v1` and, when `WV_SANDBOX_KEY` is set, hands it that key. The session banner, the home status line, and the confirm badge read `sandbox` in green instead of `production` in yellow, the cap and the timeout do not apply, and the warning says no real money moves. The sandbox host does not accept an OAuth login, so without a sandbox key every call errors and the error names the variable to set. `WV_SANDBOX_URL` overrides the host.

![sandbox](demo/sandbox-ads.gif)

The recording above runs `wv --sandbox ads create` against a local mock of the API, since the sandbox host needs its own key: the same gate, a `writes to sandbox` badge, a y/N prompt instead of a typed budget, and the created ad rendered after the write.

### A typo

Before:

```
code: COMMAND_NOT_FOUND
message: 'prodcts' is not a command for 'whop'. Did you mean 'products'?
cta:
  description: "Suggested commands:"
  commands[2]:
    - command: whop products list
    - command: whop --help
      description: see all available commands
```

After:

```
 ▌ Not a command                                                             0ms

   'prodcts' is not a command for 'whop'. Did you mean 'products'?

   Suggested commands:
     whop products list
     whop --help         see all available commands
```

![typo](demo/typo.gif)

The CLI already emits a `cta` block on this one error. `wv` renders it and adds a known fix for the errors that lack one: not signed in, missing scope, rate limited, CLI not installed, missing flags.

## What agents see

Nothing new. `wv` execs `whop` with the original argv whenever any of these hold:

- stdout is not a TTY
- `--format`, `--full-output`, `--filter-output`, `--llms`, `--schema`, `--help`, or any `--token-*` flag is present
- `WV_RAW=1`

`--sandbox` and `--width` are `wv`'s own flags and are stripped before the exec, so `wv --sandbox products list | cat` is `whop products list` against the sandbox host.
- the command owns the terminal itself: `login`, `logout`, `quickstart`, `upgrade`, `apps dev|deploy|init|pull`

`wv products list | cat` is byte-identical to `whop products list`. There is a test for it.

### `home`

```
 Frame › biz_VraUMckluH8dzV › sunchusrikar · oauth › API 2026-09-15 › $18.56 available

 Net revenue · 7d  $9.28  ▁▁█▁▁▁▁
                   Sep 14 to Sep 20

 json  whop auth status --format json
       whop ledgers report --report_type balance_summary --format json
       whop stats get net_revenue --from 2026-09-14 --to 2026-09-20 --interval day --format json
```

![home](demo/home.gif)

Three commands, one screen. The first line is a status line: account, profile and auth method, API version, balance. The footer names every command that produced it.

## Session

`wv` alone opens a session. It looks like the Claude Code or omp transcript: what you ran scrolls up into your terminal's own history, and a small editor block sits at the bottom.

```
 Frame › biz_VraUMckluH8dzV › production › sunchusrikar · oauth › API 2026-09-15 › whop 0.18.2 · wv session
 ● Tip  Type 1 after a list to open that row

 ▌ products list

 products · 2                                                                  Hypermotion

    title        visibility  plan       members  created  id
 1  Frame        visible     Free             0  8d ago   prod_DQf7IZAtveRoK
 2  Hypermotion  visible     $29.00/mo        2  8d ago   prod_iQ2Zub6GFQS5Q

 2 rows · no more pages
 json  whop products list --account_id <biz_id> --format json --filter-output title,visibility,default_plan,member_count,created_at,id

 ───────────────────────────────────────────────────────────────────────────────────────────
 ❯ 
 ───────────────────────────────────────────────────────────────────────────────────────────
 1–2 opens a row · tab completes · ↑↓ history · ! raw whop · help · esc esc quits
```

- Tab completes groups, then verbs, then the verb's flags and their values, all read from `whop --help` and cached for a day. After a list, tab also completes the ids on screen. Several matches open a list under the editor: tab moves the pointer, enter picks, esc closes. When nothing starts with what you typed, in-order matches fill in, so `mbrsh` finds `memberships`.
- Type a row number to open that row. `copy 1` puts that row's id on the clipboard; `copy json` puts the agent command from the last teaching footer there, quoted for a shell. `next` fetches the following page of the last list while there is one; the hint row says `next for more` when that applies. `home`, `help`, `help <group>`, `clear`, `quit`, or esc twice.
- The banner names the account and says `production`, because every command in it runs against production. One tip shows under it, a different one each time.
- `!login` or any `!<args>` runs raw `whop` with the terminal, for the commands that own it.
- Write verbs get the same confirmation as the CLI, inline.
- History lives at `~/.local/state/whop-view/history`. Emacs keys work: ctrl+a/e, ctrl+w, ctrl+u/k, alt+b/f. Paste is one insert.
- Zero dependencies still. The editor is one reducer and a renderer, about 200 lines, in `src/tui/`.

![session](demo/session.gif)

A write verb inside the session gets the same confirmation, then hands the terminal back to the editor:

![payouts create in the session](demo/session-payout.gif)

## Other views

- `wv help` renders the 51 groups the way `whop --help` orders them, two columns at 120 and one at 80.
- `wv <group>` renders that group's verbs.
- `wv doctor` is the setup checklist above; it exits 1 when signing in, identity, or a sellable product is missing.
- `wv stats get <metric> --from … --to …` renders a series: total, sparkline, one money row per point.
- `--width N` overrides the terminal width. `NO_COLOR` strips every escape.
- Every teaching footer is built from an argv array and shell-quoted once, so a product title with a space or a quote pastes back as the same command. `WV_PAYOUT_CAP`, `WV_CONFIRM_TIMEOUT`, `WV_SANDBOX`, `WV_SANDBOX_KEY`, and `WV_SANDBOX_URL` are the only knobs; each is described under [`payouts create`](#payouts-create) and [Sandbox](#sandbox).

## How it generalizes

Three layers. Tokens name six color roles and nothing else names a color. Primitives are pure functions from data and width to lines: table, key-value card, callout, footer, prompt, spinner. Views compose them. Every field is classified by sixteen inference rules, in order, on the response data: ids by prefix, `{amount, currency}` as money, ISO strings as dates, short enums under known keys as status, nested objects by title and id. Twenty-four resources ship a hints file that overrides the primary label, column order, status field, and money fields. Everything else renders from inference alone. Phone numbers, IP addresses, user agents, tokens, and secrets are hidden everywhere. Emails show in detail views only.

## Development

```bash
pnpm test
```

Snapshot tests render every view at 80 and 120 columns, with color and without, from real envelopes in `tests/fixtures`, and check that nothing overflows at 40 and 60. The session's key parser, editor, and completion have their own unit tests. No test calls `whop`. `WV_LIVE=1 pnpm test` adds the live byte-identity check.

```bash
pnpm fixtures
```

Re-records the fixtures from your own account. Read-only commands only. `pnpm fixtures auth.list verifications.list` records just those two.

```bash
pnpm demo
```

Re-records the seven GIFs above. Needs `brew install vhs`. Homebrew's vhs 0.12 writes no GIF against ffmpeg 9, so the tapes emit frames and `scripts/gif.sh` encodes them.
