# Decide: the rubric

Part of the whop-gtm skill; `SKILL.md` has the rules. `wv gtm rank <campaign> --target N` runs this table as one read.


The measure and decide stages are where money is saved or wasted, and where an agent is most tempted to act on one day of data. The numbers below are Meta's own learning-phase mechanics and the margins the product's price implies; the person can override any of them by naming a target.

**Set the target before the first read.** Cost per result must land under what one sale is worth: for a one-time plan, the price times the margin the person names (default 50%); for a renewal, the first payment plus one more period, times that margin. Write the number down in the plan (`--primary-text` or the campaign title is fine) so every later read compares against it, not against a feeling.

**Read one thing.** `wv gtm rank <adcamp_id> --target <cost per result> --format json` is this whole section as data: every ad group under the campaign from `ad-groups list` with `spend`, `results`, `cost_per_result`, `return_on_ad_spend`, `delivery_status`, and its age, ranked cheapest first, each with the verdict below and the `wv` command that acts on it. Without `--target` it ranks and marks `wait` and `not delivering` only. Underneath, `wv stats get ad_delivery --last 3d --source "whop:<campaign>:*" --group_by source --breakdown_by metric --format json` gives spend, impressions, and clicks per group over a window; group by one segment deeper than the filter, and only `whop:*` paths report delivery.

**Do not judge early.** Three full days and fifty results per ad group, whichever is later (`rank` says `wait`). Under that, the only decisions are "is it delivering at all" (`delivery_status` is `learning` or `active`, spend above zero within 24 hours; `rank` says `not delivering` otherwise) and "is it rejected" (`ads get` status `rejected`, `issues` names why; Whop Ads' review, fix the creative or copy, do not touch the budget).

| what the read says | decision | how |
|---|---|---|
| no spend after 24 hours | delivery problem, not performance | check `ads get` status (in review, rejected), the page under `social-accounts list`, and the payment method under `accounts preferences`; `wv doctor` covers all three |
| cost per result over 2× target after the minimum sample | losing | `wv ad-groups pause <id>`, report the ranking first |
| cost per result between target and 2× target | inconclusive | leave it another three days; change nothing |
| cost per result under target, results still climbing | winning | `wv ads duplicate <id>` into a new group with a fresh audience band, or raise the group budget by at most 20% a day; never both on the same day |
| results flat while spend climbs, impressions per person rising | creative fatigue | new creative in a duplicated ad; do not edit the running one, an edit resets Meta's learning |
| `return_on_ad_spend` under 1 for a week with the sample met | the offer, not the ad | change the promo or the landing page before spending more; pause everything until the person decides |

**Rules that hold regardless.** One change per campaign per day. Never edit a delivering ad's creative or targeting; duplicate and let the old one run out. Pause, do not delete, so the numbers stay readable next week. Budget moves are 20% steps. A pause needs a plain yes; a duplicate carries the group's budget into the plan and gets the money prompt. When Whop's recommender (`economic-intelligence list --status ready`) disagrees with this table, show the person both and let them pick; approve with `--status executed`, reject with `--status superseded --reason`.
