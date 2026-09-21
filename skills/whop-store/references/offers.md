# Offers and links

Part of the whop-store skill; `references/gate.md` has the rules. Each write is a plan.

```bash
wv promo-codes create --account_id $BIZ --code SPRING15 --promo_type percentage --amount_off 15 --base_currency usd \
  --new_users_only true --promo_duration_months 1 --product_id prod_x --stock 100 --expires_at 2026-10-01T00:00:00Z
wv promo-codes create --account_id $BIZ --code STAY5 --promo_type flat_amount --amount_off 5 --base_currency usd \
  --new_users_only false --existing_memberships_only true --promo_duration_months 3 --one_per_customer true
wv promo-codes deactivate promo_x                     # off without deleting; activate turns it back on
wv checkout-configurations create --plan_id plan_x --metadata.campaign spring --redirect_url https://example.com/thanks
wv checkout-configurations create --plan_id plan_x --affiliate_code partner_code
wv checkout-configurations list --plan_id plan_x --format json
```

A promo code's audience is one of `new_users_only`, `churned_users_only`, `existing_memberships_only`; `promo_duration_months` is how many renewals it applies to; `stock` and `expires_at` bound it; `one_per_customer` stops stacking. Scope it with `--product_id` or `--plan_ids`, or leave it account-wide. The plan shows every flag; a code with no end date and no stock is a warning worth saying aloud. `deactivate` and `activate` are writes wv gates; `expired` in `promo-codes list --status` groups inactive and archived codes.

A checkout link sells exactly one plan. `metadata` rides onto the payment and the membership, which is how a campaign, a partner, or a page is attributed later; `wv gtm launch` sets `metadata.campaign` for its own link. `affiliate_code` credits a partner from `partners links`. `mode setup` saves a payment method without charging. `--plan '{…}'` creates a plan for the link, which is the way to sell a one-off price without touching the product's plans.

Done when: `wv promo-codes list --status active --format json` includes the code with its `stock` and `expires_at`; `wv store` lists it under Offers; the `purchase_url` opens and, with the code entered, shows the discount. Tell the person a code they did not scope applies to every product, and an unbounded one never ends.
