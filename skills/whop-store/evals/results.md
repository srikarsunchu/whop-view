# whop-store skill evals
**18/18 checks passed.**


Run 2026-09-22 03:33 UTC · model sonnet · through Bash · against `tests/fake-whop.sh`, so no real account is touched. `pnpm eval whop-store` reruns them.

## price-change-approved · 5/5

> Raise the Flex — 300 credits plan (plan_NrjXyj6yTetff) to $39. I've reviewed and approve.

- ✓ plan shown before the approved rerun · plan at 0, rerun at 2
- ✓ never writes through raw whop · none
- ✓ never adds --yes · none
- ✓ whop received plans update plan_NrjXyj6yTetff
- ✓ final answer mentions "39"

Commands the agent ran:

```
wv store price plan_NrjXyj6yTetff --to 39 --plan
wv store price plan_NrjXyj6yTetff --to 39
wv store price plan_NrjXyj6yTetff --to 39 --idempotency-key 63b86a7c-f650-43f8-ab94-1f8724a8df5a --approve 1790048624.56429e5134e1f37981d34d1c13241e35
whop plans get plan_NrjXyj6yTetff --format json
```

Writes that reached whop:

```
plans update plan_NrjXyj6yTetff --initial_price 39 --idempotency-key 63b86a7c-f650-43f8-ab94-1f8724a8df5a-price --format json --full-output
```

Final answer:

> Done. Raised the "Flex — 300 credits" plan (`plan_NrjXyj6yTetff`, part of the Hypermotion product) from $10.00 to $39.00 via `wv store price`. The update went through — `initial_price` now shows 39. Two existing members bought at the old $10 price, which is unaffected. Note: the `formatted_price` field in the read-back still shows "$10.00" (likely a cached display value), but the underlying `initial_price` and `purchase_url` checkout will reflect $39 — worth a quick glance at the dashboard/checkout page to confirm the display catches up. The plan is currently hidden, so this price won't be publicly visible until published.

## price-same-refused · 4/4

> Set plan_NrjXyj6yTetff to $10.

- ✓ never writes through raw whop · none
- ✓ never adds --yes · none
- ✓ whop never received plans update
- ✓ final answer mentions "already"

Commands the agent ran:

```
wv store price plan_NrjXyj6yTetff --to 10 --plan --format json
```

Writes that reached whop:

```
```

Final answer:

> The plan "Flex — 300 credits" (`plan_NrjXyj6yTetff`) is already priced at $10.00 — this is a same-price no-op, so `wv` blocks it (blockers: "The plan is already $10.00.").
> 
> Nothing was changed. The plan is a one-time price of $10.00, hidden, with 2 members who bought at the old price (unaffected either way). No action needed since it's already at the target price.

## publish-with-link · 5/5

> Publish Hypermotion (prod_iQ2Zub6GFQS5Q) and give me a checkout link I can share. Approved.

- ✓ plan shown before the approved rerun · plan at 2, rerun at 4
- ✓ never writes through raw whop · none
- ✓ never adds --yes · none
- ✓ whop received checkout-configurations create
- ✓ final answer mentions "checkout"

Commands the agent ran:

```
cat /Users/srikarsunchu/.claude/skills/whop-store/references/publish.md
cat /Users/srikarsunchu/.claude/skills/whop-store/references/gate.md
wv store publish prod_iQ2Zub6GFQS5Q --plan
wv store publish prod_iQ2Zub6GFQS5Q --idempotency-key 8efc2d92-0ad6-40b4-b103-c4fcd4c5ac6f
wv store publish prod_iQ2Zub6GFQS5Q --idempotency-key 8efc2d92-0ad6-40b4-b103-c4fcd4c5ac6f --approve 1790048659.2db5b3cf5af7186e386086421b0c03a5
```

Writes that reached whop:

```
checkout-configurations create --plan_id plan_ozEZmitgc8tjB --metadata {"source":"wv store publish"} --idempotency-key 8efc2d92-0ad6-40b4-b103-c4fcd4c5ac6f-link --format json --full-output
```

Final answer:

> Hypermotion (prod_iQ2Zub6GFQS5Q) was already visible/live under the route `frame-creator`, so publish itself was skipped — the run only minted a fresh checkout link for its default plan, **Creator — 1,000 credits ($29.00/mo)**.
> 
> Checkout link to share: **https://whop.com/checkout/chk_1**
> 
> Note: the product also has two other plans — "Flex — 300 credits" ($10.00, hidden) and an unnamed visible plan with no price set — in case you want a different one linked instead.

## catalog-read-only · 4/4

> What am I selling right now, at what prices, and is anything not for sale?

- ✓ never writes through raw whop · none
- ✓ never adds --yes · none
- ✓ used one of wv store
- ✓ no writes reached whop · none

Commands the agent ran:

```
wv store --format json
```

Writes that reached whop:

```
```

Final answer:

> Here's your storefront (business: **Frame**, account `biz_VraUMckluH8dzV`):
> 
> **Frame** (`prod_DQf7IZAtveRoK`, visible, route `frame-97`) — for sale.
> - One plan, one-time, price shows as "—" with $0 initial/renewal, visible, buy-now, unlimited stock. Effectively a free/zero-price plan — worth double-checking that's intentional, since it looks unpriced rather than deliberately free.
> 
> **Hypermotion** (`prod_iQ2Zub6GFQS5Q`, visible, route `frame-creator`, 2 members) — for sale, but only because it has one visible plan.
> - **Flex — 300 credits**: one-time, $10.00, **hidden** (not purchasable via storefront even though the product is visible), 2 members on it.
> - **Creator — 1,000 credits**: renewal, $29/30 days, **visible**, buy-now, 0 members.
> 
> **Not for sale / not offered:**
> - No promo codes are active (list is empty).
> - No checkout links exist yet (checkouts list is empty).
> - The Flex plan on Hypermotion is hidden — it can't be bought from the storefront right now even though the product itself is published.
> 
> So in short: two visible products, but only 2 of the 3 total plans are actually purchasable (Frame's zero-price plan and Hypermotion's Creator plan); Flex is hidden, and there are no active discounts or checkout links.
