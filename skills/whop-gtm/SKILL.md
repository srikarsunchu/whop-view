---
name: whop-gtm
description: Run go-to-market on Whop from the terminal with the Whop CLI — tracking and people, audiences, ad creative, Meta ads, promo codes and checkout links, affiliates and bounties, attribution stats, and Whop's own recommendations. Use when asked to launch, promote, retarget, scale, or report on a Whop product, or when the user says GTM, ads, audiences, campaign, promo, winback, lookalike, bounty, affiliate, ROAS, or "what should I do next" about a Whop business. Not for building apps or payment integration (use the generic whop skill).
---

# Whop GTM

The Whop CLI (`whop`, 0.18+) exposes every go-to-market stage as a command group with `--format json` and `--schema`. This skill is the loop that connects them, plus the rules that keep an agent from spending money it was not asked to spend.

## Rules before any command

1. **Production only.** The CLI has no sandbox, test, or dry-run mode for ads. Every write runs against the real account. Ad budgets, bounties, and media generation move real money.
2. **Gate the money lines.** When a terminal is present, run writes through `wv` (whop-view) instead of `whop`. `wv ads create --plan` renders the whole campaign tree, a real reach estimate, and the committed spend without writing anything; without `--plan` it asks the person to type the budget back. Without `wv`, stop and show the person the exact command and what it commits before running it.
3. **Every write takes `--idempotency-key`.** Generate it from the plan step, not the call, so a retry never creates a second campaign or a second bounty.
4. **Read the schema, not your memory.** `whop <group> <verb> --schema` is the truth. Field names below were verified against 0.18.2 / API 2026-09-15 and will drift.
5. **Object and array flags take JSON.** `--ad_group '{"ad_campaign_id":"adcamp_x",...}'`, `--headlines '["a","b"]'`.
6. **Prerequisites are one-time browser actions.** Pixel on the funnel pages, a Meta Business connected with the `advertise` scope, an ads payment method, and Economic Intelligence switched on. Check them first (see Preflight) and tell the person which are missing instead of failing later.

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
whop auth status --format json                                   # who, which biz_
whop accounts preferences --format json --filter-output ads_payment_methods,ads_reporting_currency,economic_intelligence
whop social-accounts list --format json                          # empty → no page connected, ads will refuse
whop people list --format json --filter-output data[*].first_source,data[*].last_source   # all null → no pixel
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

Ids are placeholders. Lines marked `# $` commit money.

### 1 · Launch day

```bash
whop promo-codes create --account_id $BIZ --code LAUNCH20 --promo_type percentage --amount_off 20 \
  --base_currency usd --new_users_only true --promo_duration_months 1 --product_id $PROD \
  --stock 200 --expires_at 2026-09-28T07:00:00Z --format json
whop checkout-configurations create --account_id $BIZ --plan_id $PLAN \
  --metadata '{"campaign":"launch-sep26"}' --format json --filter-output id,purchase_url
whop media generate --type image --prompt "9:16 product still, dark studio, single key light" \
  --wait --timeout 300 --format json --filter-output file.id                                   # $ balance
whop ad-campaigns create --title "Launch" --platform meta --objective sales --budget_optimization ad_group --format json --filter-output id
wv ads create --title "Launch · v1" --url "$PURCHASE_URL" --call_to_action shop_now \
  --ad_group '{"ad_campaign_id":"adcamp_x","title":"US 25-44 · purchase","budget_amount":40,"budget_type":"daily","optimization_goal":"conversions","conversion_event":"purchase","conversion_location":"website","placements":"automatic","demographics":{"minimum_age":25,"maximum_age":44,"gender":"all"},"regions":{"include":{"countries":["US"]}}}' \
  --creatives '[{"id":"file_a","format":"vertical"}]' --headlines '["It is live"]' \
  --primary_texts '["20% off this week with LAUNCH20."]' --url_parameters '{"utm_campaign":"launch-sep26"}' --plan   # $ daily budget; drop --plan to be asked
```

Do not set `utm_source`, `utm_medium`, `utm_content`, `wacid`, `waid`, `wasid`: Whop reserves them.

### 2 · Winback

```bash
whop audiences create --account_id $BIZ --name "visited 30d, no purchase" --source_type people_filter \
  --filters '{"has_purchased":false,"last_seen_within_days":30,"contactable":true}' --auto_refresh true
whop audiences create --account_id $BIZ --name "customers" --source_type people_filter --filters '{"has_purchased":true}'
whop promo-codes create --account_id $BIZ --code COMEBACK --promo_type flat_amount --amount_off 5 --base_currency usd \
  --new_users_only false --churned_users_only true --promo_duration_months 1 --one_per_customer true
wv ad-groups create --ad_campaign_id adcamp_x --title "winback 30d" --budget_amount 15 --budget_type daily \
  --optimization_goal conversions --conversion_event purchase \
  --audiences '{"include":["adaud_visitors"],"exclude":["adaud_customers"]}' --placements automatic   # $
```

Filters must be rolling windows (`last_seen_within_days`), never fixed dates, or the audience will not refresh.

### 3 · Lookalike scale

```bash
whop audiences create --account_id $BIZ --audience_type lookalike --source_audience_id adaud_customers --count 3 --percentage 6
whop ad-groups estimate_reach --platform meta --audiences '{"include":["adaud_lal_1"]}' --regions '{"include":{"countries":["US"]}}' --format json
# one ad group per band, then after three days:
whop stats get ad_delivery --account_id $BIZ --from 2026-09-22 --to 2026-09-25 --source "whop:adcamp_x:*" --group_by source --metric cost_per_result --format json
whop ad-groups pause adgrp_worst
whop ads duplicate ad_best
```

The source audience needs at least 100 matched people. `percentage` must divide evenly by `count`.

### 4 · Creators do the distribution

```bash
whop products update $PROD --global_affiliate_status enabled --global_affiliate_percentage 30
whop bounties create --account_id $BIZ --title "Clip a 30s vertical from the launch stream" \
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
whop economic-intelligence create --account_id $BIZ --input "<one paragraph: what you sell, the six numbers, what you want, what you can spend>"
whop economic-intelligence list --account_id $BIZ --status ready --format json
whop economic-intelligence update reca_x --status executed          # approve
whop economic-intelligence update reca_x --status superseded --reason "wrong audience"   # reject
```

## Field notes (verified 0.18.2)

- `ad-campaigns create`: `objective` awareness|traffic|engagement|leads|sales; `platform` is `meta` only; `budget_optimization` ad_campaign|ad_group (default ad_group); `budget_type` daily|lifetime; `bid_type` minimum_cost|average_target|maximum_target with `desired_cost_per_result`.
- `ad-groups create`: `conversion_event` standard names or any custom pixel event; `optimization_goal` (18 values, `conversions` for sales); `conversion_location` website|instant_forms|messaging…; `placements` `"automatic"` or per-platform positions; `regions.include.countries|regions|cities|zips|custom_locations`; `detailed_targeting.interests|behaviors|demographics` by id from `targeting_options`; `frequency_cap` only on awareness.
- `ads create`: `ad_group` (inline, with `ad_campaign_id`) or `ad_group_id`; arrays `headlines`, `primary_texts`, `descriptions`; `creatives` `[{"id":"file_…","format":"vertical"}]` (2–10 without format = carousel); `existing_post_id` to boost a post; `social_accounts '[{"id":"sacc_…"}]'`.
- `audiences create`: `source_type` csv_upload|people_filter|engagement; `filters` uses the same keys as `people list`; lookalikes need `source_audience_id`, `count` 1–6, `percentage` 1–20.
- `promo-codes create` required: `code`, `amount_off`, `promo_type`, `base_currency`, `new_users_only`, `promo_duration_months`.
- `bounties create`: escrow is `gross_reward_amount × accepted_submissions_limit`, floor $5; `frequency` needs `publish_at` and `publish_at_timezone`.
- `stats get ad_delivery`: `source` whop:<campaign>:<group>:<ad> or with `:*`; `metric` spend|impressions|clicks, and on placement/publisher_platform also results|roas|cost_per_result; `breakdown_by` age|gender|placement|country|….
- `people list`: `has_purchased`, `contactable`, `source`, `attribution_model`, `last_seen_within_days`, `ltv_gt`, `audience_id`, sort by `ltv`/`aov`/`purchase_count`. Page size 100.
- `events list` needs `--from` and `--to` no more than 30 days apart, or an `identifier`.
- `experiments` returns 403 outside Whop. `notifications create` reaches your app's members, not strangers.

## Webhooks that close the loop

`payment.succeeded`, `membership.activated`, `membership.trial_ending_soon`, `membership.cancel_at_period_end_changed`, `ad_campaign.payment_failed`, `ad.updated` (review status), `payment.affiliate_reward_created`, `export.completed`.

```bash
whop webhooks create --url https://example.com/hooks --events '["payment.succeeded","ad.updated","ad_campaign.payment_failed"]'
```
