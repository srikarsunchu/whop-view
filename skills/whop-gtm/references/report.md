# Monday report that asks Whop what to do

Part of the whop-gtm skill; `SKILL.md` has the rules.


Needs `intelligence` green in doctor; otherwise `economic-intelligence` answers a 403 whose fix is `whop accounts update-preferences --economic_intelligence true`.

```bash
for m in page_visits new_users trial_conversion_rate gross_revenue ad_spend churn_rate; do
  wv stats get $m --account_id $BIZ --last 7d --format json --filter-output totals
done
wv economic-intelligence create --account_id $BIZ --input "<one paragraph: what you sell, the six numbers, what you want, what you can spend>"
wv economic-intelligence list --account_id $BIZ --status ready --format json
wv economic-intelligence update reca_x --status executed          # approve: a write, so a plan first
wv economic-intelligence update reca_x --status superseded --reason "wrong audience"   # reject
```

`wv gtm --format json` is the same six numbers plus the people summary, the campaigns, the offers, and the launch gaps in one call, if the report is for a person rather than for Whop's recommender.

Done when: the six reads returned `totals` for the same seven-day window and the person has seen them next to last week's; `wv economic-intelligence list --status ready --format json` has at least one recommendation, and each one the person approved is `executed` and each one they rejected is `superseded` with a `--reason`; `wv gtm --format json` returns `gaps: []`, or every remaining gap has been shown with its fix. A recommendation that would spend more than the person named as the budget is reported, not executed. Nothing in this playbook writes except the `update`, so the report itself can run unattended and on a schedule.
