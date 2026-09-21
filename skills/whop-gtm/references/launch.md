# Launch day

Part of the whop-gtm skill; `SKILL.md` has the rules. This playbook is one command.


One command plans the whole day: a promo code, a checkout link for the product's default plan, a Meta campaign, and one ad pointed at that checkout link. Four writes, one approval, one rerun.

```bash
wv gtm launch $PROD --budget 40 --creative file_a --plan          # the plan and nothing else
wv gtm launch $PROD --budget 40 --creative file_a                 # CONFIRMATION_REQUIRED with plan and rerun
```

Read `plan.blockers` first: no default plan, no Meta page, no ads payment method, or a 30-day commitment over `WV_AD_CAP` come back as `LAUNCH_BLOCKED` with no `rerun`; fix them (`wv doctor --format json` has the commands) and plan again. `plan.steps` is every command with its own idempotency key, later steps referencing earlier results as `{campaign.id}` and `{checkout.purchase_url}`. Show the person the spend line, the reach, and the four steps, then run `rerun` unchanged. Flags: `--code` and `--percent` (default `LAUNCH20`, 20% for new customers, 7 days), `--days`, `--stock`, `--headline`, `--primary-text`, `--countries US,CA`, `--ages 25-44`, `--url` to point the ad elsewhere, `--campaign` for the utm. Leave `--budget` off to create only the promo and the checkout link. A creative comes from `wv media generate --type image --prompt "…" --wait --timeout 300` (billed from balance, gated like any write) and its `file.id` goes to `--creative`.

Done when the run's `next` reads agree: `promo-codes get` is `active`, the `purchase_url` opens, `ad-campaigns get` and `ads get` exist (the ad sits `in_review` until Meta approves it), `wv stats get ad_delivery --last 1d --source whop:<campaign>:*` shows spend the next day, and `wv gtm` has no gaps. A step that fails stops the rest: the envelope carries `results` for what was made, `failed` for the step, and a `rerun` with the same keys, so running it again finishes the launch without creating anything twice.

Do not set `utm_source`, `utm_medium`, `utm_content`, `wacid`, `waid`, `wasid`: Whop reserves them.
