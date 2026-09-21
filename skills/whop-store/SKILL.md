---
name: whop-store
description: Running a Whop storefront from the terminal, through wv over the Whop CLI, so every price change, publish, plan, promo code, or checkout link is a plan the person approves before it runs — the catalog on one screen (every product, its plans and prices, who is on them, whether it is for sale), price changes that show before and after with the members affected, publishing with a shareable checkout link, plans, promo codes, and checkout configurations. Use when asked to change a price, publish or hide a product, add or archive a plan, make a promo code or a checkout link, or when the user says price, plan, product, publish, hidden, visible, promo, discount, checkout link, stock, trial, or waitlist about a Whop business. Not for ads, treasury, tickets, or apps (use whop-gtm, whop-money, whop-support, whop-dev).
---

# Whop Store

A storefront is products, the plans that price them, the codes that discount them, and the links that sell them. The store groups of the CLI (`products`, `plans`, `promo-codes`, `checkout-configurations`, `memberships`) update live records with no diff and no check that the page has anything to buy. `wv` supplies the catalog, the before-and-after, and the gate. The rules every wv skill shares are in `references/gate.md`; read it once. This file is the map.

## Rules for the store

The bare CLI updates a live price with no before-and-after, publishes a page without checking it has anything to buy, and exits 1 for every failure. `wv` supplies the catalog, the diff, the refusal, and the gate, so the rules are about using `wv` the way it expects rather than working around `whop`.

1. **Read the catalog first, and start every write from an id it showed.** `wv store --format json` is every product with `forSale` (visible, and at least one visible buy-now plan) and why not when it is not, its plans with price, type, visibility, members, stock, and trial, the active promo codes, and the checkout links. In a pipe the data comes without the flag. Nothing on it writes.
2. **Every write goes through `wv`, never `whop`.** Without consent `wv` runs nothing: a write in a pipe exits 2 with `CONFIRMATION_REQUIRED`, the `plan`, and a `rerun` whose `--approve` token is bound to that argv for ten minutes and whose `--idempotency-key` was minted at the plan step. Show the plan, get a yes, run `rerun` exactly as given; never add `--yes`. `--plan` returns the plan and runs nothing, for any write or recipe. A refusal is the same envelope with no `rerun`; report it, do not retry, and never do "the part that would have worked" by hand through `whop`.
3. **A price change is a diff, not a number.** `wv store price <plan_id> --to N` reads the plan and the plan shows `$10.00 → $39.00` with how many members are on it. `--to` is the price of a one-time plan or the renewal of a subscription; `--initial` is a subscription's first charge. A paid plan charges at least 1.00 in its currency; 0 makes it free. The same price, a sub-dollar price, an archived plan, or `--initial` on a one-time plan is refused before anything runs. The API reference does not say whether a renewal change applies to existing subscribers; say so, and have the person check the dashboard before assuming.
4. **Publishing needs something to buy.** `wv store publish <prod_id>` publishes the product and mints a checkout link for its default plan, as one plan with one approval. A product with no plan, or only hidden or archived plans, is refused: the page would be empty. Already visible skips the publish and still mints the link. `--no-link` publishes alone.
5. **Every other update shows what changes.** `wv products update <prod> --title …`, `wv plans update <plan> --visibility hidden`, and `wv promo-codes …` read the record first and the plan carries `title  Frame → Frame Pro`, `visibility  visible → hidden`; unchanged fields stay muted, in the terminal card and in `plan.changes` on the pipe. `products unpublish` and `plans update --visibility archived` take a product or plan off sale without deleting anything; `delete` is destructive and gated as such.
6. **Offers are scoped and time-boxed.** A promo code takes `--promo_type percentage|flat_amount`, `--amount_off`, `--base_currency`, `--new_users_only`, `--promo_duration_months`, and optionally `--product_id`, `--plan_ids`, `--stock`, `--expires_at`, `--one_per_customer`, `--churned_users_only`. Through `wv`, `--plan_ids plan_a --plan_ids plan_b` is the array `whop` expects. `wv gtm launch` mints the launch code; for anything else, name the audience and the end date in the plan the person sees.
7. **A checkout link sells one plan.** `checkout-configurations create --plan_id <plan>` returns a `purchase_url`; `--metadata.campaign launch-sep26` rides onto the payment and the membership for attribution; `--affiliate_code` credits a partner; `--redirect_url` is where the buyer lands after paying. `--plan.<field>` creates a plan for the link instead of naming one.
8. **Read the manifest, not your memory.** `wv agent products`, `wv agent plans`, `wv agent promo-codes`, and `wv agent checkout-configurations` print every flag from `--schema` and mark which verbs write or destroy. The command map in `references/commands.md` is generated from the same source and pinned to 0.18.2 / API 2026-09-15; the live manifest wins when they differ.
9. **Every playbook ends with reads that prove it.** A price is changed at `plans get`; a product is published at `products get` with `visibility: visible` and a `purchase_url` that opens; a code is live at `promo-codes list --status active`. A write that returned an id is not done.

## The loop

| stage | groups | what they give you |
|---|---|---|
| know | `wv store`, `products list`, `plans list --product_ids`, `promo-codes list --status active`, `checkout-configurations list`, `memberships list --plan_id` | the catalog, who is on what, what is discounted, what links exist |
| price | `wv store price`, `plans update`, `plans create` | a price with its diff and its members, a new plan |
| sell | `wv store publish`, `products publish` / `unpublish`, `checkout-configurations create` | a visible page with something to buy, a shareable link |
| discount | `promo-codes create` / `deactivate` / `activate` / `delete` | a code with its audience, stock, and end date |
| prove | `products get`, `plans get`, `promo-codes get`, the `purchase_url` | the state the change promised |

## Preflight

```bash
wv doctor --format json    # the products check: a visible product with a default plan
wv store --format json     # the catalog with forSale per product
```

## Playbooks

| playbook | command | reference |
|---|---|---|
| Change a price | `wv store price <plan_id> --to 39 --plan` | `references/price.md` |
| Publish | `wv store publish <prod_id> --plan` | `references/publish.md` |
| Offers and links | `wv promo-codes create …`, `wv checkout-configurations create …` | `references/offers.md` |

## Deciding and failing

- `references/failures.md`: every refusal and error a store command returns, the recorded message, and the fix.
- `references/gate.md`: the rules every wv skill shares.
- `references/commands.md`: the generated command map for the store groups.
