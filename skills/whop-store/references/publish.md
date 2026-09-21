# Publish

Part of the whop-store skill; `references/gate.md` has the rules. This playbook is one command.

```bash
wv store --format json                                # forSale per product says what is missing
wv store publish prod_x --plan                        # the plan and nothing else
wv store publish prod_x                               # CONFIRMATION_REQUIRED with plan and rerun
wv store publish prod_x --no-link                     # publish alone
```

Two steps, one approval: `products publish <id>`, skipped when the product is already visible, then `checkout-configurations create --plan_id <default plan>` with `metadata.source` set, which returns a `purchase_url` to share. The plan reads `products get` and `plans list --product_ids` first. Blockers: the product could not be read; it has no plan; every plan is hidden or archived (the page would have nothing to buy). `PUBLISH_BLOCKED` carries them. A warning says the product has no headline and no description, since the page will be bare; `wv products update prod_x --headline … --description …` fixes that with a diff. No money moves; a plain yes.

Before publishing: `wv doctor --format json` for the account (identity, a payout method) since a sale that cannot be paid out is a support ticket later; `wv store` for the plans' prices; the product's `route` is the public path, `whop.com/<route>`.

Done when: `wv products get prod_x --format json` shows `visibility: visible`; the `purchase_url` from the run's results opens to a checkout at the plan's price; `wv store` shows the product `for sale`. Tell the person the link and the price it charges, and that `wv products unpublish prod_x` reverses the publish without deleting anything.
