---
name: whop-gtm
description: Run go-to-market on Whop from the terminal with the Whop CLI — tracking and people, audiences, ad creative, Meta ads, promo codes and checkout links, affiliates and bounties, attribution stats, and Whop's own recommendations. Use when asked to launch, promote, retarget, scale, or report on a Whop product, or when the user says GTM, ads, audiences, campaign, promo, winback, lookalike, bounty, affiliate, ROAS, or "what should I do next" about a Whop business. Not for building apps or payment integration (use the generic whop skill).
---

# Whop GTM

The Whop CLI (`whop`, 0.18+) exposes every go-to-market stage as a command group with `--format json` and `--schema`. This skill is the loop that connects them, plus the rules that keep an agent from spending money it was not asked to spend.

## Rules before any command

1. **Production only.** The CLI has no sandbox, test, or dry-run mode for ads. Every write runs against the real account. Ad budgets, bounties, and media generation move real money.
2. **Gate the money lines.** Run every write through `wv` (whop-view) instead of `whop`. Without `--yes`, `wv` does not run it: in a terminal it shows the plan and asks the person to type the amount back; in a pipe it exits 2 with a JSON envelope (`error.code` `CONFIRMATION_REQUIRED`, `plan`, `rerun`). Show the plan to the person, then run `rerun` exactly as given: its `--approve` token is bound to that command and expires in ten minutes, so an edited or stale rerun is refused. Never add `--yes` yourself. `--plan` returns the plan and runs nothing. Refusals (`WHOP_LIMIT`, `WV_CAP`, `INSUFFICIENT_BALANCE`, `WV_AD_CAP`) have no `rerun`. Without `wv`, stop and show the person the exact command and what it commits before running it.
3. **Every write takes `--idempotency-key`.** Generate it from the plan step, not the call, so a retry never creates a second campaign or a second bounty.
4. **Read the schema, not your memory.** `wv agent <group>` prints every verb's flags from `--schema`, marks writes and money, and names the setup checks the group needs. `wv agent` alone lists every group and verb with its kind; `--format json` on either gives the same as data. Field names in the playbooks were verified against 0.18.2 / API 2026-09-15 and will drift.
5. **Object and array flags take JSON.** `--ad_group '{"ad_campaign_id":"adcamp_x",...}'`, `--headlines '["a","b"]'`. Through `wv`, dotted paths (`--ad_group.budget_amount 40`), repeated flags, and `@file.json` assemble to the same JSON.
6. **Prerequisites are one-time browser actions.** Pixel on the funnel pages, a Meta Business connected with the `advertise` scope, an ads payment method, and Economic Intelligence switched on. `wv doctor --format json` checks all of them in one call and returns a `fix` per failing check; tell the person which are missing instead of failing later.

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

## Preflight (read-only, run all of it first)

```bash
wv doctor --format json    # one call: signed in, identity, api key, pixel, meta page, ads payment, intelligence, products, webhooks; a `fix` per failing check
```

Without `wv`, the same reads by hand:

```bash
whop auth status --format json                                   # who, which biz_
whop accounts preferences --format json --filter-output ads_payment_methods,ads_reporting_currency,economic_intelligence
whop social-accounts list --format json                          # empty → no page connected, ads will refuse
whop people list --format json --filter-output 'data[0,50].first_source'   # all null → no pixel. Slice syntax: data[*] returns nothing
whop ad-campaigns list --format json
whop audiences list --format json
```

Fixes, each once:
- No page: `whop social-accounts connect --platform meta_business --scopes advertise --redirect_url https://<your site>/connected` returns a URL the person opens.
- No pixel: install it in the `<head>` of every funnel page (docs: developer/ads/pixel), then `whop events validate_pixel`.
- No ads payment method: added in the dashboard, or fund the balance with `whop deposits create`.
- Economic Intelligence off: `whop accounts update-preferences --economic_intelligence true`.
- Webhooks need an API-key profile: `whop login --method api-key --apiKey whop_...`; an OAuth token lacks the scope.

## Playbooks

Ids are placeholders. Lines marked `# $` commit money. Every write is `wv …`: in a pipe it answers with the plan and exits 2 until the person approves and the agent runs the `rerun` it was given; reads stay `whop …`.

### 1 · Launch day

```bash
wv promo-codes create --account_id $BIZ --code LAUNCH20 --promo_type percentage --amount_off 20 \
  --base_currency usd --new_users_only true --promo_duration_months 1 --product_id $PROD \
  --stock 200 --expires_at 2026-09-28T07:00:00Z --format json
wv checkout-configurations create --account_id $BIZ --plan_id $PLAN \
  --metadata '{"campaign":"launch-sep26"}' --format json --filter-output id,purchase_url
wv media generate --type image --prompt "9:16 product still, dark studio, single key light" \
  --wait --timeout 300 --format json --filter-output file.id                                   # $ balance
wv ad-campaigns create --title "Launch" --platform meta --objective sales --budget_optimization ad_group --format json --filter-output id
wv ads create --title "Launch · v1" --url "$PURCHASE_URL" --call_to_action shop_now \
  --ad_group '{"ad_campaign_id":"adcamp_x","title":"US 25-44 · purchase","budget_amount":40,"budget_type":"daily","optimization_goal":"conversions","conversion_event":"purchase","conversion_location":"website","placements":"automatic","demographics":{"minimum_age":25,"maximum_age":44,"gender":"all"},"regions":{"include":{"countries":["US"]}}}' \
  --creatives '[{"id":"file_a","format":"vertical"}]' --headlines '["It is live"]' \
  --primary_texts '["20% off this week with LAUNCH20."]' --url_parameters '{"utm_campaign":"launch-sep26"}' --plan   # $ daily budget; drop --plan to be asked
```

Do not set `utm_source`, `utm_medium`, `utm_content`, `wacid`, `waid`, `wasid`: Whop reserves them.

### 2 · Winback

```bash
wv audiences create --account_id $BIZ --name "visited 30d, no purchase" --source_type people_filter \
  --filters '{"has_purchased":false,"last_seen_within_days":30,"contactable":true}' --auto_refresh true
wv audiences create --account_id $BIZ --name "customers" --source_type people_filter --filters '{"has_purchased":true}'
wv promo-codes create --account_id $BIZ --code COMEBACK --promo_type flat_amount --amount_off 5 --base_currency usd \
  --new_users_only false --churned_users_only true --promo_duration_months 1 --one_per_customer true
wv ad-groups create --ad_campaign_id adcamp_x --title "winback 30d" --budget_amount 15 --budget_type daily \
  --optimization_goal conversions --conversion_event purchase \
  --audiences '{"include":["adaud_visitors"],"exclude":["adaud_customers"]}' --placements automatic   # $
```

Filters must be rolling windows (`last_seen_within_days`), never fixed dates, or the audience will not refresh.

### 3 · Lookalike scale

```bash
wv audiences create --account_id $BIZ --audience_type lookalike --source_audience_id adaud_customers --count 3 --percentage 6
whop ad-groups estimate_reach --platform meta --audiences '{"include":["adaud_lal_1"]}' --regions '{"include":{"countries":["US"]}}' --format json
# one ad group per band, then after three days:
whop stats get ad_delivery --account_id $BIZ --from 2026-09-22 --to 2026-09-25 --source "whop:adcamp_x:*" --group_by source --metric cost_per_result --format json
wv ad-groups pause adgrp_worst
wv ads duplicate ad_best
```

The source audience needs at least 100 matched people. `percentage` must divide evenly by `count`.

### 4 · Creators do the distribution

```bash
wv products update $PROD --global_affiliate_status enabled --global_affiliate_percentage 30
wv bounties create --account_id $BIZ --title "Clip a 30s vertical from the launch stream" \
  --description "Cut a 30s vertical. Link the post. Paid per approved clip." --business_goal_type clipping \
  --gross_reward_amount 25 --accepted_submissions_limit 20 \
  --publish_at 2026-09-29T16:00:00Z --publish_at_timezone America/Los_Angeles --frequency weekly     # $ escrows 25 × 20 every week
whop bounty-submissions list --bounty_id bnty_x --status submitted --format json
whop stats get affiliate_fees --account_id $BIZ --from 2026-09-01 --to 2026-09-30 --format json
whop partners links --format json
```

Approve or deny is dashboard only. Poll submissions about once a minute while a person reviews.

### 5 · Monday report that asks Whop what to do

```bash
for m in page_visits new_users trial_conversion_rate gross_revenue ad_spend churn_rate; do
  whop stats get $m --account_id $BIZ --from $(date -v-7d +%F) --to $(date +%F) --format json --filter-output totals
done
wv economic-intelligence create --account_id $BIZ --input "<one paragraph: what you sell, the six numbers, what you want, what you can spend>"
whop economic-intelligence list --account_id $BIZ --status ready --format json
wv economic-intelligence update reca_x --status executed          # approve
wv economic-intelligence update reca_x --status superseded --reason "wrong audience"   # reject
```

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
