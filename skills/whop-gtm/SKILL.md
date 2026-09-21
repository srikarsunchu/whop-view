---
name: whop-gtm
description: Run go-to-market on Whop from the terminal, through wv over the Whop CLI, so every write is a plan the person approves before it runs — tracking and people, audiences, ad creative, Meta ads, promo codes and checkout links, affiliates and bounties, attribution stats, and Whop's own recommendations. Use when asked to launch, promote, retarget, scale, or report on a Whop product, or when the user says GTM, ads, audiences, campaign, promo, winback, lookalike, bounty, affiliate, ROAS, or "what should I do next" about a Whop business. Not for building apps or payment integration (use the generic whop skill).
---

# Whop GTM

The Whop CLI (`whop`, 0.18+) exposes every go-to-market stage as a command group with `--format json` and `--schema`, and enforces nothing around them: the 149 commands it tags "confirm before executing" run on sight, every failure exits 1, and its manifests are either too thin to act on or too big for a turn. This skill runs the loop through `wv` ([whop-view](https://github.com/srikarsunchu/whop-view)), which forwards every read as `whop`'s own bytes and turns every write into a plan the person approves: `wv doctor --format json` is the preflight, `wv agent <group>` is the manifest with every flag, and a write without `--yes` comes back as a `CONFIRMATION_REQUIRED` envelope with the plan and a `rerun` instead of money moving. The command reference below is generated from the live CLI by `pnpm skill`.

## Rules before any command

The bare CLI has no gate, no dry-run, no useful exit code, and no manifest that fits a turn. `wv` supplies each of those, so the rules are about using `wv` the way it expects rather than working around `whop`.

1. **Every write goes through `wv`, never `whop`.** Without `--yes`, `wv` runs nothing. In a terminal it shows the plan and asks the person to type the amount back. In a pipe it exits 2 with a JSON envelope: `error.code` `CONFIRMATION_REQUIRED`, a `plan` (the command, the account, the money, the balance, the caps, and for a record what changes), and a `rerun`. Show the plan to the person, get a yes, then run `rerun` exactly as given. Its `--approve` token is bound to that argv and expires in ten minutes, so an edited or stale rerun is refused and nothing runs. Never add `--yes` yourself. `--plan` returns `{ ok: true, plan }` and runs nothing, for any write. A refusal (`WHOP_LIMIT` in Whop's words, `WV_CAP`, `INSUFFICIENT_BALANCE`, `WV_AD_CAP`) is the same envelope with no `rerun`; report it, do not retry. If `wv` is not installed, stop and show the person the exact `whop` command and what it commits before running anything.
2. **Retries cannot double-spend.** `rerun` carries an `--idempotency-key` that `wv` minted at the plan step, so an approved retry never creates a second campaign, bounty, or payout. Only when you must call `whop` directly, generate the key yourself from the plan step, not the call.
3. **Reads are `whop`'s own bytes, plus an exit code you can branch on.** `wv <group> list --format json` is byte-identical to `whop`, and the status is 3 for a bad request, 4 for not allowed, 5 for not found, 2 when `wv` refused before running, where `whop` says 1 for all of them. `wv <group> list --all` follows the cursor and streams one object per line, which `whop` cannot do.
4. **Read the manifest, not your memory.** `wv agent <group>` prints every verb's flags from `--schema`, marks which write, move money, or destroy, and names the doctor checks the group needs before its first write. `wv agent` alone lists every group and verb with its kind; `--format json` on either returns the same as data. The command reference at the end of this skill is generated from it and pinned to 0.18.2 / API 2026-09-15; the live manifest wins when they differ.
5. **Preflight is one call.** The pixel on the funnel pages, a Meta Business connected with the `advertise` scope, an ads payment method, Economic Intelligence, identity verification for payouts, and an API-key login for webhooks are one-time setup. `wv doctor --format json` checks all of them and returns `{ ok, blocking, checks: [{ key, level, detail, fix, blocking }] }`, exit 1 on a blocking failure. Run it first, show the person each failing check's `fix`, and do not start a playbook whose prerequisites are red.
6. **Objects and arrays are JSON to `whop`, plain flags to you.** Through `wv`, dotted paths (`--ad_group.budget_amount 40 --ad_group.regions.include.countries US`), repeated flags (`--headlines "a" --headlines "b"`), and `@file.json` assemble to the JSON flag `whop` expects, and the plan shows the assembled command. Writing the JSON by hand also works; `wv` never touches a command that already carries it.
7. **Dates are presets.** `--last 7d`, `--last 30d`, `--this month`, and `--last month` on `stats get` and `events list` resolve to `--from` and `--to` before `whop` runs. An `events list` range over 30 days is refused before the call, in Whop's words.
8. **Production is the default, and the sandbox is not a test mode for ads.** `wv --sandbox` points `whop` at the sandbox host with a key kept in `wv`'s config; `wv sandbox status` says whether that works. The sandbox has no Meta account, so ad estimates and creates usually refuse there. Ad budgets, bounties, payouts, and media generation move real money in production; that is what the gate is for.

## The loop

| stage | groups | what they give you |
|---|---|---|
| know | `people list`, `events list`, `stats get people` / `events` / `traffic_events` | visitors resolved into people with LTV, AOV, source path, device, contactable |
| segment | `audiences create`, `audiences add_people` | People-filter audiences that refresh twice a day, CSV uploads, engagement audiences, lookalikes in 1–6 bands |
| make | `media generate`, `files create` | image or 5/10/15s video from a prompt, billed from balance; `--wait` returns a `file_` id |
| launch | `social-accounts connect`, `ad-campaigns create`, `ad-groups estimate_reach`, `ad-groups targeting_options`, `ad-groups create`, `ads create` | Meta campaigns; one nested `ads create` can build campaign, group, and ad |
| convert | `promo-codes create`, `checkout-configurations create`, `plans create`, `products update` / `publish` | time-boxed offers scoped to new, churned, or existing buyers; checkout links carrying metadata and an affiliate code |
| distribute | `products update --global_affiliate_*`, `partners create` / `links` / `earnings`, `bounties create`, `memberships invite` | affiliates, referral links, recurring clipping or UGC bounties with escrow |
| measure | `stats get ad_delivery` / `events` / `people` / `gross_revenue` / `trial_conversion_rate` / `churn_rate`, `exports create` | attribution unified under `whop:<campaign>:<group>:<ad>` source paths; ROAS and cost per result from your own pixel |
| decide | `ad-campaigns pause` / `unpause`, `ads duplicate`, `ad-groups update`, `economic-intelligence create` / `list` / `update`, `webhooks create` | pause losers, clone winners, or hand the numbers to Whop's recommender and approve what comes back |

## Preflight (read-only, one call)

```bash
wv doctor --format json
```

Nine checks, each with a `key`, a `level` (`ok`, `warn`, `fail`), a `detail` in Whop's words where Whop has any, a `fix` as the exact command when the CLI has one or a dashboard URL when it does not, and `blocking`. The envelope is `{ ok, blocking, checks: [...] }` and the exit code is 1 when a blocking check fails, so the branch is the status, not the body. In a terminal the same call is a screen; in a pipe it is the data, no flag needed.

| key | what it reads | blocking | when red |
|---|---|---|---|
| `auth` | `auth status` | yes | not signed in → `whop login` |
| `identity` | `payouts methods --include_limits`, the same limit the payout gate reads | yes | payouts blocked, in Whop's words → `whop verifications create --account_id <biz>` |
| `apikey` | `auth list` and `permissions check` on the six scopes a seller needs | no | an OAuth login lacks `developer:manage_webhook` → `whop auth switch <saved api-key profile>`, or the login command plus the dashboard where a key is minted |
| `pixel` | `people list --first 100`, anyone with a source | no | nobody attributed → `whop events validate_pixel` after the pixel is in the `<head>` of every funnel page |
| `page` | `social-accounts list` | no | no Meta Business → `whop social-accounts connect --platform meta_business --scopes advertise --redirect_url <url>`, which returns a URL the person opens |
| `payment` | `accounts preferences` | no | no ads payment method → dashboard only |
| `ei` | `accounts preferences` | no | Economic Intelligence off → `whop accounts update-preferences --economic_intelligence true` |
| `products` | `products list`, a visible product with a plan | yes | nothing to buy → `whop products create --help` |
| `webhooks` | `webhooks list` and the newest deliveries | no | no webhook, none delivered in 7 days, or the OAuth 403 → `whop webhooks create …`, `whop webhooks test <id> --event payment.succeeded`, or the API-key login |

Which checks a playbook needs is in `wv agent <group>` under its prerequisites, and in the playbooks below: ads need `pixel`, `page`, and `payment`; payouts, cards, transfers, and swaps need `identity`; webhooks need `apikey`; the Monday report needs `ei`. Every fix is a one-time action, most of them the person's: run the `fix` when it is a command, show the URL when it is the dashboard, and rerun doctor before starting. Do not begin a playbook whose checks are red and hope the write explains itself later; the ad write would refuse in Whop's words at the last step instead of the first.

## Playbooks

Every line is `wv`, reads and writes alike: a read is `whop`'s bytes with a real exit code, a write is a plan until the person approves. Ids are placeholders. Lines marked `# $` commit money. Each playbook starts with the same preflight and ends with the same approval step:

```bash
wv doctor --format json          # exit 1 and a `fix` per red check means stop and show the person
# … the playbook's reads, then one write at a time:
wv <group> <verb> … --plan       # the plan, nothing runs: show it
wv <group> <verb> …              # exit 2, CONFIRMATION_REQUIRED, `plan`, `rerun`
# the person says yes → run `rerun` exactly as given (it carries --approve and --idempotency-key)
```

### 1 · Launch day

Needs `pixel`, `page`, and `payment` green in doctor, or the ad write will refuse in Whop's words.

```bash
wv promo-codes create --account_id $BIZ --code LAUNCH20 --promo_type percentage --amount_off 20 \
  --base_currency usd --new_users_only true --promo_duration_months 1 --product_id $PROD \
  --stock 200 --expires_at 2026-09-28T07:00:00Z
wv checkout-configurations create --account_id $BIZ --plan_id $PLAN --metadata.campaign launch-sep26
wv media generate --type image --prompt "9:16 product still, dark studio, single key light" --wait --timeout 300   # $ balance
wv ad-campaigns create --title "Launch" --platform meta --objective sales --budget_optimization ad_group
wv ads create --title "Launch · v1" --url "$PURCHASE_URL" --call_to_action shop_now \
  --ad_group.ad_campaign_id adcamp_x --ad_group.title "US 25-44 · purchase" \
  --ad_group.budget_amount 40 --ad_group.budget_type daily \
  --ad_group.optimization_goal conversions --ad_group.conversion_event purchase --ad_group.conversion_location website \
  --ad_group.placements automatic --ad_group.demographics.minimum_age 25 --ad_group.demographics.maximum_age 44 --ad_group.demographics.gender all \
  --ad_group.regions.include.countries US \
  --creatives.0.id file_a --creatives.0.format vertical --headlines "It is live" \
  --primary_texts "20% off this week with LAUNCH20." --url_parameters.utm_campaign launch-sep26 --plan   # $ daily budget
```

The `ads create` plan is the campaign tree, a real reach estimate, the 30-day commitment of the daily budget, who pays, and the assembled `whop` command with the JSON `whop` expects; over `WV_AD_CAP` it refuses before the call. The `purchase_url` for the ad comes from the checkout configuration's plan in the pipe. Do not set `utm_source`, `utm_medium`, `utm_content`, `wacid`, `waid`, `wasid`: Whop reserves them.

### 2 · Winback

```bash
wv audiences create --account_id $BIZ --name "visited 30d, no purchase" --source_type people_filter \
  --filters.has_purchased false --filters.last_seen_within_days 30 --filters.contactable true --auto_refresh true
wv audiences create --account_id $BIZ --name "customers" --source_type people_filter --filters.has_purchased true
wv promo-codes create --account_id $BIZ --code COMEBACK --promo_type flat_amount --amount_off 5 --base_currency usd \
  --new_users_only false --churned_users_only true --promo_duration_months 1 --one_per_customer true
wv ad-groups create --ad_campaign_id adcamp_x --title "winback 30d" --budget_amount 15 --budget_type daily \
  --optimization_goal conversions --conversion_event purchase \
  --audiences.include adaud_visitors --audiences.exclude adaud_customers --placements automatic   # $
```

Filters must be rolling windows (`last_seen_within_days`), never fixed dates, or the audience will not refresh. The audience ids for the ad group come from the two `create` responses; `wv audiences list --format json` lists them again.

### 3 · Lookalike scale

```bash
wv audiences create --account_id $BIZ --audience_type lookalike --source_audience_id adaud_customers --count 3 --percentage 6
wv ad-groups estimate_reach --platform meta --audiences.include adaud_lal_1 --regions.include.countries US --format json
# one ad group per band (each a gated write), then after three days:
wv stats get ad_delivery --account_id $BIZ --last 3d --source "whop:adcamp_x:*" --group_by source --metric cost_per_result --format json
wv ad-groups pause adgrp_worst
wv ads duplicate ad_best
```

The source audience needs at least 100 matched people. `percentage` must divide evenly by `count`. `pause` and `duplicate` are writes and get the plan like any other; a pause moves no money, so its plan is the command and the account and the prompt is a plain yes.

### 4 · Creators do the distribution

```bash
wv products update $PROD --global_affiliate_status enabled --global_affiliate_percentage 30
wv bounties create --account_id $BIZ --title "Clip a 30s vertical from the launch stream" \
  --description "Cut a 30s vertical. Link the post. Paid per approved clip." --business_goal_type clipping \
  --gross_reward_amount 25 --accepted_submissions_limit 20 \
  --publish_at 2026-09-29T16:00:00Z --publish_at_timezone America/Los_Angeles --frequency weekly     # $ escrows 25 × 20 every week
wv bounty-submissions list --bounty_id bnty_x --status submitted --all
wv stats get affiliate_fees --account_id $BIZ --this month --format json
wv partners links --format json
```

The `products update` plan shows the change, `global affiliate status  disabled → enabled`, read from the record before anything runs. Approve or deny on a submission is dashboard only. `--all` streams every submission as one object per line; poll about once a minute while a person reviews.

### 5 · Monday report that asks Whop what to do

Needs `intelligence` green in doctor; otherwise `economic-intelligence` answers a 403 whose fix is `whop accounts update-preferences --economic_intelligence true`.

```bash
for m in page_visits new_users trial_conversion_rate gross_revenue ad_spend churn_rate; do
  wv stats get $m --account_id $BIZ --last 7d --format json --filter-output totals
done
wv economic-intelligence create --account_id $BIZ --input "<one paragraph: what you sell, the six numbers, what you want, what you can spend>"
wv economic-intelligence list --account_id $BIZ --status ready --format json
wv economic-intelligence update reca_x --status executed          # approve: a write, so a plan first
wv economic-intelligence update reca_x --status superseded --reason "wrong audience"   # reject
```

`wv gtm --format json` is the same six numbers plus the people summary, the campaigns, the offers, and the launch gaps in one call, if the report is for a person rather than for Whop's recommender.

## Command reference

Every flag, its type, and whether a verb writes or moves money comes from `wv agent <group>`, which reads `--schema` live and so cannot drift. The block below is the map, regenerated by `pnpm skill`.

<!-- wv agent:start -->

Generated by `pnpm skill` from whop@0.18.2 · API 2026-09-15. `wv agent <group>` prints every flag with its type and description; this is the map.

### people

Visitors and customers of an account, with identity, purchase, and traffic profiles. · `wv agent people`

- `whop people get` · read
- `whop people list` · read

### events

Conversion and engagement events tracked for attribution. · `wv agent events`

- `whop events create` · write · required: `--account_id`, `--event_name`
- `whop events list` · read
- `whop events pulse` · read
- `whop events validate_pixel` · read

### audiences

Reusable targeting lists for ad groups. · `wv agent audiences`

- `whop audiences add_people` · write · required: `--file_id`
- `whop audiences create` · write · required: `--account_id`
- `whop audiences delete` · write, destructive
- `whop audiences list` · read
- `whop audiences update` · write

### media

AI-generated assets, billed from a balance, attachable wherever files are accepted. · `wv agent media`

- `whop media generate` · write · required: `--prompt`, `--type`, `--timeout`
- `whop media get` · read

### files

Upload files and attach them wherever Whop accepts documents. · `wv agent files`

- `whop files complete` · write · required: `--multipart_parts`, `--multipart_upload_id`
- `whop files create` · write · required: `--filename`
- `whop files get` · read
- `whop files list` · read · required: `--file_ids`

### social-accounts

Connected Facebook and Instagram accounts that run ads. · `wv agent social-accounts`

- `whop social-accounts connect` · write · required: `--platform`, `--redirect_url`
- `whop social-accounts create` · write · required: `--platform`
- `whop social-accounts delete` · write, destructive
- `whop social-accounts lead_forms` · read
- `whop social-accounts list` · read
- `whop social-accounts posts` · read

### ad-campaigns

Platform, objective, and budget for a set of ads. · `wv agent ad-campaigns`

- `whop ad-campaigns create` · write · required: `--objective`, `--platform`, `--title`
- `whop ad-campaigns delete` · write, destructive
- `whop ad-campaigns duplicate` · write
- `whop ad-campaigns get` · read
- `whop ad-campaigns list` · read
- `whop ad-campaigns pause` · write
- `whop ad-campaigns retry_payment` · write
- `whop ad-campaigns unpause` · write
- `whop ad-campaigns update` · write

### ad-groups

Audience, placements, and schedule within a campaign. · `wv agent ad-groups`

- `whop ad-groups create` · write · required: `--ad_campaign_id`
- `whop ad-groups delete` · write, destructive
- `whop ad-groups duplicate` · write
- `whop ad-groups estimate_reach` · read · required: `--platform`
- `whop ad-groups get` · read
- `whop ad-groups list` · read
- `whop ad-groups pause` · write
- `whop ad-groups targeting_options` · read · required: `--platform`
- `whop ad-groups unpause` · write
- `whop ad-groups update` · write

### ads

The creative: copy, assets, and destination URL. · `wv agent ads`

- `whop ads create` · write
- `whop ads delete` · write, destructive
- `whop ads duplicate` · write
- `whop ads get` · read
- `whop ads list` · read
- `whop ads pause` · write
- `whop ads unpause` · write
- `whop ads update` · write

### promo-codes

Discounts that creators configure for checkout. · `wv agent promo-codes`

- `whop promo-codes activate` · write
- `whop promo-codes create` · write · required: `--account_id`, `--amount_off`, `--base_currency`, `--code`, `--new_users_only`, `--promo_duration_months`, `--promo_type`
- `whop promo-codes deactivate` · write
- `whop promo-codes delete` · write, destructive
- `whop promo-codes get` · read
- `whop promo-codes list` · read

### checkout-configurations

Turn a plan into a shareable, prefilled checkout link. · `wv agent checkout-configurations`

- `whop checkout-configurations create` · write
- `whop checkout-configurations delete` · write, destructive
- `whop checkout-configurations get` · read
- `whop checkout-configurations list` · read

### plans

Pricing for a product: one-time, recurring, trials, stock. · `wv agent plans`

- `whop plans calculate_tax` · read
- `whop plans create` · write
- `whop plans delete` · write, destructive
- `whop plans get` · read
- `whop plans list` · read
- `whop plans update` · write

### products

The things you sell. Each owns plans and a store page. · `wv agent products`

- `whop products create` · write · required: `--title`
- `whop products delete` · write, destructive
- `whop products get` · read
- `whop products list` · read
- `whop products publish` · write
- `whop products unpublish` · write
- `whop products update` · write

### partners

Your partner profile, referral links, payout rates, and referred businesses. · `wv agent partners`

- `whop partners create` · write
- `whop partners earnings` · read
- `whop partners get` · read
- `whop partners leaderboard` · read
- `whop partners links` · read
- `whop partners list` · read
- `whop partners referred_users` · read
- `whop partners retrieve` · read

### bounties

Paid tasks with reviewed submissions and escrowed rewards. · `wv agent bounties`

- `whop bounties cancel` · write, destructive
- `whop bounties create` · write · required: `--description`, `--gross_reward_amount`, `--title`
- `whop bounties get` · read
- `whop bounties get-submission` · read
- `whop bounties list` · read
- `whop bounties submissions` · read
- `whop bounties update` · write

### bounty-submissions

Work submitted to a bounty, from attempt to payout. · `wv agent bounty-submissions`

- `whop bounty-submissions create` · write · required: `--bounty_id`
- `whop bounty-submissions delete` · write, destructive
- `whop bounty-submissions get` · read
- `whop bounty-submissions list` · read
- `whop bounty-submissions submit` · write

### memberships

A customer's purchase of a plan, from checkout through cancellation. · `wv agent memberships`

- `whop memberships cancel` · write, destructive
- `whop memberships extend` · write · required: `--days`
- `whop memberships get` · read
- `whop memberships invite` · write · required: `--plan_id`
- `whop memberships list` · read
- `whop memberships pause` · write
- `whop memberships resume` · write
- `whop memberships resync_access` · write
- `whop memberships transfer` · write
- `whop memberships update` · write

### stats

Aggregated financial, audience, and traffic reporting. · `wv agent stats`

- `whop stats get` · read · required: `--from`, `--to`
- `whop stats list` · read

### exports

Asynchronous CSV dumps of an account's dashboard data. · `wv agent exports`

- `whop exports create` · write · required: `--resource`
- `whop exports get` · read
- `whop exports list` · read

### economic-intelligence

What an account should do next to grow, generated from its own data. · `wv agent economic-intelligence`

- `whop economic-intelligence create` · write · required: `--input`
- `whop economic-intelligence list` · read
- `whop economic-intelligence update` · write · required: `--status`

### webhooks

Event notifications pushed to your server as things happen. · `wv agent webhooks`

- `whop webhooks create` · write · required: `--url`
- `whop webhooks delete` · write, destructive
- `whop webhooks deliveries` · read
- `whop webhooks deliveries-replay` · write
- `whop webhooks get` · read
- `whop webhooks list` · read
- `whop webhooks replay` · write · required: `--sent_after`
- `whop webhooks test` · read · required: `--event`
- `whop webhooks update` · write

<!-- wv agent:end -->

Semantics the schema does not say (verified 0.18.2):

- `bounties create`: escrow is `gross_reward_amount × accepted_submissions_limit`, floor $5.
- `ads create`: 2–10 `creatives` without a `format` become a carousel. `existing_post_id` boosts a post instead.
- `audiences create`: lookalikes need `source_audience_id`; `filters` uses the same keys as `people list`.
- `stats get ad_delivery`: `source` is `whop:<campaign>:<group>:<ad>`, or with `:*`. Attribution unifies under that path.
- `events list` needs `--from` and `--to` no more than 30 days apart, or an `identifier`. `wv` presets: `--last 7d`, `--this month`.
- `experiments` returns 403 outside Whop. `notifications create` reaches your app's members, not strangers.

## Webhooks that close the loop

`payment.succeeded`, `membership.activated`, `membership.trial_ending_soon`, `membership.cancel_at_period_end_changed`, `ad_campaign.payment_failed`, `ad.updated` (review status), `payment.affiliate_reward_created`, `export.completed`.

```bash
wv webhooks create --url https://example.com/hooks --events '["payment.succeeded","ad.updated","ad_campaign.payment_failed"]'
```
