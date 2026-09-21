# whop-view

`wv` is a human view layer for the [Whop CLI](https://whop.sh). It wraps `whop`, asks it for JSON, and renders a table, a card, a confirmation, or an error when a person is looking. When a pipe, a script, or an agent is looking, it execs `whop` untouched.

The design is in [VIEWS.md](./VIEWS.md). This README shows it.

> Unofficial, personal-use prototype. Not affiliated with, endorsed by, or distributed by Whop. "Whop" is a trademark of its owner. Built against `whop` 0.16.3 and 0.18.2.

## Why

The CLI shipped agent-first and it shows. Every command prints every field as TOON. In a terminal that TOON is syntax-colored and empty fields are folded away, which helps, but two products are still 69 lines with no columns, no alignment, and ISO timestamps. `--format md` prints `[object Object]` for nested fields. Errors are two lines. `payouts create` moves real money with no confirmation and no dry-run flag. A sandbox API host exists, but the CLI only reaches it through `WHOP_API_BASE_URL` with a separate sandbox key, and Whop's own CLI docs say there is no sandbox mode. Agents are fine with all of that. People are not. `wv` adds the people layer without touching the agent layer: one rendering system that every command group gets for free, driven by inference plus small hint files.

## Install

```bash
git clone https://github.com/srikarsunchu/whop-view && cd whop-view && pnpm install && pnpm build && pnpm link --global
```

Needs Node 22 or newer and a working `whop` on your PATH. Then use `wv` anywhere you would type `whop`.

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

   amount            $250.00 usd
   payout method id  potk_x1
   speed             standard
   from              Hypermotion  biz_VraUMckluH8dzV

   This runs against production. The Whop CLI has no dry-run. This moves real money.

 Run it? [y/N]
```

![payouts create](demo/payout-create.gif)

Every write verb gets this. Money groups and destructive verbs get the red gutter, other writes get yellow. `--yes` skips it. A pipe never sees it.

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
- the command owns the terminal itself: `login`, `logout`, `quickstart`, `upgrade`, `apps dev|deploy|init|pull`

`wv products list | cat` is byte-identical to `whop products list`. There is a test for it.

### `home`

```
 Frame › biz_VraUMckluH8dzV › sunchusrikar · oauth › API 2026-09-15 › $18.56 available

 Net revenue · 7d  $9.28  ▁▁█▁▁▁▁
                   Sep 14 to Sep 20

 auth status · ledgers report --report_type balance_summary · stats get net_revenue --from 2026-09-14 …
```

![home](demo/home.gif)

Three commands, one screen. The first line is a status line: account, profile and auth method, API version, balance. The footer names every command that produced it.

## Other views

- `wv` alone renders the 51 groups the way `whop --help` orders them, two columns at 120 and one at 80.
- `wv <group>` renders that group's verbs.
- `--width N` overrides the terminal width. `NO_COLOR` strips every escape.

## How it generalizes

Three layers. Tokens name six color roles and nothing else names a color. Primitives are pure functions from data and width to lines: table, key-value card, callout, footer, prompt, spinner. Views compose them. Every field is classified by sixteen inference rules, in order, on the response data: ids by prefix, `{amount, currency}` as money, ISO strings as dates, short enums under known keys as status, nested objects by title and id. Twenty-four resources ship a hints file that overrides the primary label, column order, status field, and money fields. Everything else renders from inference alone. Phone numbers, IP addresses, user agents, tokens, and secrets are hidden everywhere. Emails show in detail views only.

## Development

```bash
pnpm test
```

Snapshot tests render every view at 80 and 120 columns, with color and without, from real envelopes in `tests/fixtures`. No test calls `whop`. `WV_LIVE=1 pnpm test` adds the live byte-identity check.

```bash
pnpm fixtures
```

Re-records the fixtures from your own account. Read-only commands only.

```bash
pnpm demo
```

Re-records the four GIFs above. Needs `brew install vhs`. Homebrew's vhs 0.12 writes no GIF against ffmpeg 9, so the tapes emit frames and `scripts/gif.sh` encodes them.
