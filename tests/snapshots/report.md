# Hypermotion · weekly brief

Sep 14 to Sep 20 vs Sep 7 to Sep 13 · generated 2026-09-21 12:00 UTC

| metric | this week | last week | change |
|---|---:|---:|---:|
| visits | 0 | 0 | — |
| new users | 1 | 0 | — |
| gross revenue | $10.00 | $0.00 | — |
| net revenue | $18.56 | $9.28 | +100% |
| ad spend | $0.00 | $0.00 | — |
| churn | 2.0% | 5.0% | -60% |

## Status

- money: $18.56 available · payouts blocked (identity)
- store: 2 of 2 products for sale · 1 active code

## Blockers

- **identity** (fail): Payouts are blocked: Please complete identity verification before requesting a withdrawal. · `whop verifications create --account_id biz_VraUMckluH8dzV`
- **apikey** (warn): This oauth login lacks developer:manage_webhook. The api-key profile sandbox is saved; switch to it for those. · `wv auth switch sandbox`
- **pixel** (warn): No visit carries a source: the pixel is not installed on your pages, so nothing is attributed. · `whop events validate_pixel`
- **page** (warn): No Meta page is connected, so every ad command will refuse. · `whop social-accounts connect --platform meta_business --scopes advertise --redirect_url <url>`
- **payment** (warn): No ads payment method on the account, so ads will not deliver.
- **ei** (warn): Economic Intelligence is off, so `whop economic-intelligence` returns 403. · `whop accounts update-preferences --economic_intelligence true`
- **webhooks** (warn): Webhooks refuse an oauth login. Sign in with an API key to list, create, or test them. · `wv auth switch sandbox`
- No ads payment method on the account, so ads will not deliver.

## Campaigns

- **Launch · Hypermotion**: 1 scale, 1 pause, 1 wait, 1 not delivering
  - US 25-44 · purchase · scale · $7.00 per result
  - lal 3% · pause · $18.50 per result
  - lal 1% · wait · $22.50 per result
  - broad · not delivering

## Recommendations

- Launch a 20% winback code for visitors who did not buy · promo code · `reca_x1`

## Next

- Payouts are blocked: Please complete identity verification before requesting a withdrawal.: `whop verifications create --account_id biz_VraUMckluH8dzV`
- This oauth login lacks developer:manage_webhook. The api-key profile sandbox is saved; switch to it for those.: `wv auth switch sandbox`
- No visit carries a source: the pixel is not installed on your pages, so nothing is attributed.: `whop events validate_pixel`
- No Meta page is connected, so every ad command will refuse.: `whop social-accounts connect --platform meta_business --scopes advertise --redirect_url <url>`
- Economic Intelligence is off, so `whop economic-intelligence` returns 403.: `whop accounts update-preferences --economic_intelligence true`
- Launch · Hypermotion: pause lal 3%: `wv ad-groups pause adgrp_c1`
- approve: Launch a 20% winback code for visitors who did not buy: `wv economic-intelligence update reca_x1 --status executed`

