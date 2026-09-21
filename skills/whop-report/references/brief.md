# Monday brief

Part of the whop-report skill; `references/gate.md` has the rules. Reads only.

```bash
wv report --format json    # the data; agents read this
wv report --md             # Markdown; post this
wv report                  # the page, for a person at a terminal
```

What to write, in this order, from the data:

1. **The six numbers.** `kpis`: visits, new users, gross revenue, net revenue, ad spend, churn, each as this week, last week, change. Lead with revenue and the biggest mover. A metric with `error` is reported as unreadable, not as zero. Zero visits with nonzero revenue is a missing pixel, not a quiet week.
2. **What blocks.** `doctor.failing` and `gaps`, each with its `fix`. A blocking doctor check (identity, a product with a plan, signed in) comes first; warnings (pixel, page, ads payment, intelligence, api key, webhooks) after.
3. **Money and store.** `money.balances` per currency and `money.payoutsBlocked`; `store.forSale` of `store.products` and `store.activeCodes`.
4. **Campaigns.** One line per campaign from `campaigns`: the verdict counts and the one action `wv gtm rank` proposes. `references/decide.md` in the gtm skill is the rubric behind the verdicts.
5. **Recommendations.** `recommendations`: title and action type, with the two commands: `wv economic-intelligence update <id> --status executed` to approve, `--status superseded --reason "…"` to reject. The person picks.
6. **Next.** The `next` list as is: what, then the command. It is already ordered.

Tone: numbers first, one sentence each, the command in backticks. Never say a thing is done that `next` still lists. Never run a `next` command as part of writing the brief; each is a plan the person approves.

Done when: the person has the six numbers against last week, knows what blocks, and has the `next` list with commands they can paste. If the brief is for Whop's recommender instead of a person, `economic-intelligence create --input "<one paragraph: what you sell, the six numbers, what you want, what you can spend>"` starts a recommendation; it is a write, and a plan first.
