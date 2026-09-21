# Winback

Part of the whop-gtm skill; `SKILL.md` has the rules. This playbook is one command.

One command plans the winback: a people-filter audience of visitors seen in the window who never bought, a customers audience to exclude, a flat-amount promo for churned customers, and one ad group in an existing campaign that includes the first audience and excludes the second.

```bash
wv gtm winback adcamp_x --budget 15 --plan          # the plan and nothing else
wv gtm winback adcamp_x --budget 15                 # CONFIRMATION_REQUIRED with plan and rerun
wv gtm winback                                      # audiences and promo only, no ad group
```

`plan.window.visitors` is how many people were seen in the window without buying, from `people list`; zero means the pixel is not attributing and the visitors audience will stay empty (`wv doctor` names the fix). `--budget` needs `--campaign` or the positional campaign id: the ad group joins an existing campaign, and `wv gtm launch` creates one. Flags: `--days` (30, the rolling window; never a fixed date, or the audience will not refresh), `--code` and `--amount` (`COMEBACK`, $5 off, one per customer, churned customers only), `--product` to scope the code, `--countries`. A missing page or payment method, or the commitment over `WV_AD_CAP`, blocks it before anything runs; `WINBACK_BLOCKED` carries the reasons.

Done when the run's `next` reads agree: both `audiences get` calls show `status` `ready` (or `partial`) with `total_rows` above zero for the visitors one; `promo-codes get` is `active`; `ad-groups get` shows the group `active` under the campaign with `delivery_status` `learning` then `active`; and `wv stats get ad_delivery --last 1d --source whop:<campaign>:<group>:*` shows spend the next day. In three days, `wv gtm rank <campaign> --target N` puts the winback group next to the campaign's other groups. Worth saying to the person: a retargeting audience of a few hundred people exhausts in days; when `rank` says `pause`, pause.
