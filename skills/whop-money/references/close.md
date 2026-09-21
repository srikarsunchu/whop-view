# Month end

Part of the whop-money skill; `references/gate.md` has the rules. This playbook is one command.

```bash
wv money close --keep 100 --plan                      # the plan and nothing else
wv money close --keep 100                             # CONFIRMATION_REQUIRED with plan and rerun
wv money close --keep 100 --period this --speed instant --method potk_x --currency eur
```

Two writes, one approval: an export of the period's financial activity (`exports create --resource financial-activity` filtered to the currency and the window) and a payout of what is available above `--keep`, to the named, default, or only saved method. `--period last` (default) is the previous calendar month in UTC; `this` is the month so far. `plan.amount` is the sweep; `plan.balance`, `plan.limit`, `plan.cap`, `plan.method`, and `plan.window` are the numbers behind it. Blockers, all before any write: the balance could not be read; nothing above the floor; no saved method, the named one missing, or several with no default; Whop blocks payouts on the account (identity); the amount over Whop's limit for the speed; the amount over `WV_PAYOUT_CAP`. `CLOSE_BLOCKED` carries them in `hint`. A blocked close is a stop: report the blockers and their fixes, and do not run the export on its own through `whop` because it "would have worked"; the person may not want a lone export, and every write goes through `wv`.

The person types the payout amount back in a terminal; in a pipe the `rerun` carries the approve token and the key base, and each step's idempotency key derives from it, so a rerun after a failed payout does not export twice.

Done when the run's `next` reads agree: `exports get <exp_id>` is `completed` with a `download_url` (minutes; `expires_at` says how long the link lives, so fetch it the same day); `payouts get <wdrl_id>` reaches `completed`; `wv money` shows the balance at the floor plus what settled since. Tell the person when the export is `failed` (rerun the same command; the export key is the same and the payout will not repeat), when the payout is `in_review`, and when `pending` on the balance is large, since pending settles later and is not swept.
