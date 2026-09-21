# Creators do the distribution

Part of the whop-gtm skill; `SKILL.md` has the rules.


```bash
wv products update $PROD --global_affiliate_status enabled --global_affiliate_percentage 30
wv bounties create --account_id $BIZ --title "Clip a 30s vertical from the launch stream" \
  --description "Cut a 30s vertical. Link the post. Paid per approved clip." --business_goal_type clipping \
  --gross_reward_amount 25 --accepted_submissions_limit 20 \
  --publish_at 2026-09-29T16:00:00Z --publish_at_timezone America/Los_Angeles --frequency weekly     # $ escrows 25 × 20 every week
wv bounty-submissions list --bounty_id bnty_x --status submitted --all
wv stats get affiliate_fees --account_id $BIZ --this month --format json
wv partners links --format json
```

The `products update` plan shows the change, `global affiliate status  disabled → enabled`, read from the record before anything runs. Approve or deny on a submission is dashboard only. `--all` streams every submission as one object per line; poll about once a minute while a person reviews.

Done when: `wv products get $PROD --format json` shows `global_affiliate_status` `enabled` at the percentage asked; `wv bounties get bnty_x --format json` shows the bounty `scheduled` with `scheduled_publish_at` in the future, then `open` after it (the escrow, `gross_reward_amount × accepted_submissions_limit`, has been taken from the balance, and `wv ledgers report --report_type balance_summary --format json` moved by that much); after `publish_at`, `wv bounty-submissions list --bounty_id bnty_x --all` grows; and within the month `wv stats get affiliate_fees --this month --format json` and `wv stats get partner_link_clicks --this month --format json` are above zero. Stop and tell the person when submissions sit `submitted` for more than a day (`approved` and `denied` are the resolved states), since review is dashboard only, and when a weekly bounty's escrow would leave the balance short of the next payout.
