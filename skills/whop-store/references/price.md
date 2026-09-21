# Change a price

Part of the whop-store skill; `references/gate.md` has the rules. This playbook is one command.

```bash
wv store --format json                                # the plan ids, prices, and members
wv store price plan_x --to 39 --plan                  # the diff and nothing else
wv store price plan_x --to 39                         # CONFIRMATION_REQUIRED with plan and rerun
wv store price plan_x --to 29 --initial 0             # a subscription: renewal 29, first charge free
```

The plan reads `plans get` first and carries `plan` (id, title, type, currency, both prices, members, visibility) and `changes` as `field: before → after`. For a one-time plan `--to` is the price and becomes `--initial_price`; for a renewal plan `--to` is the recurring price (`--renewal_price`) and `--initial` the first charge (`--initial_price`). Blockers: the plan could not be read, the price is already that, a paid price under 1.00 in the plan's currency (0 makes it free), `--initial` on a one-time plan, an archived plan. `PRICE_BLOCKED` carries them. A warning counts the members on the plan: on a one-time plan their purchase does not change; on a subscription the API reference does not say whether the renewal change reaches them, so the warning says to check the dashboard before assuming. No money moves; the prompt is a plain yes, but read the diff aloud to the person, since a wrong price on a live plan is visible to every buyer immediately.

Related writes, each a plan that shows its diff: `wv plans update plan_x --visibility hidden` takes a plan off the page without archiving; `--strike_through_initial_price 59` shows a comparison price; `--trial_period_days 7` adds a trial; `--stock 50 --unlimited_stock false` caps units. `wv plans create --product_id prod_x --plan_type renewal --renewal_price 29 --billing_period 30 --title "Monthly"` adds a plan instead of changing one, which is the safer move when members are on the old price.

Done when: `wv plans get plan_x --format json` shows the new `initial_price` or `renewal_price` and `formatted_price`; `wv store` shows it under the product; the checkout link for the plan (`checkout-configurations list --plan_id`) shows the new price when opened. Tell the person how many members were on the plan and, for a subscription, that whether their renewals change is a dashboard question.
