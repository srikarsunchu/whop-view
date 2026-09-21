# Lookalike scale

Part of the whop-gtm skill; `SKILL.md` has the rules.


```bash
wv audiences create --account_id $BIZ --audience_type lookalike --source_audience_id adaud_customers --count 3 --percentage 6
wv ad-groups estimate_reach --platform meta --audiences.include adaud_lal_1 --regions.include.countries US --format json
# one ad group per band (each a gated write), then after three days:
wv gtm rank adcamp_x --target 30 --format json      # every band ranked, with a verdict and the command that acts on it
wv ad-groups pause adgrp_worst                      # when rank says pause
wv ads duplicate ad_best                            # when rank says scale
```

The source audience needs at least 100 matched people. `percentage` must divide evenly by `count`. `pause` and `duplicate` are writes and get the plan like any other; a pause moves no money, so its plan is the command and the account and the prompt is a plain yes.

Done when, in two stages. After the creates: `wv audiences list --audience_type lookalike --format json` shows `count` audiences, one per band, each with `status` `ready` and `total_rows` above zero; `estimate_reach` for each band returned bounds rather than an error; and `wv ad-groups list --ad_campaign_id adcamp_x --format json` shows one group per band, none paused. Do not judge before three days or fifty results per group, whichever is later. After that: `wv gtm rank` ranks the bands by `cost_per_result` against the target and gives each a verdict from the rubric in `references/decide.md`; pause the band it marks `pause`, duplicate the ad in the one it marks `scale`, one change per day, never two variables at once. Report the ranking to the person before pausing anything, since a pause moves no money and needs only a yes, but it also throws away the learning that band has bought.
