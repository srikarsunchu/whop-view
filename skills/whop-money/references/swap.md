# Convert a balance

Part of the whop-money skill; `references/gate.md` has the rules. This playbook is one command.

```bash
wv money --format json                                        # balances: `unpayable` names the currencies no saved method delivers
wv money swap --from eur --to usd --amount 80 --plan          # the plan and nothing else
wv money swap --from eur --to usd --amount 80                 # CONFIRMATION_REQUIRED with plan and rerun
```

One write, one approval: `swaps create --from_token <from> --to_token <to> --amount N` on the account. Before it, at plan time, `swaps quote` with the same pair and amount; the quote is compute-only (no funds move, nothing is saved), so it is a read and the gate does not hold it. Fiat pairs fill at Whop's mid-market rate, the same the quote returned, so what the plan shows is what runs. `plan.quote` is `{ amountIn, amountOut, rate, feeBps, feeAmount }`; `plan.from` and `plan.to` are both balances as read; `plan.after` is both balances once the swap lands (the `to` side net of any fee).

Blockers, all before any write: the from-balance could not be read; `--amount` over what is available; Whop returned no quote or refused the pair. Warnings: a fee in basis points (the after is net of it); the to-balance could not be read (the after on that side is unknown). `--from` and `--to` are currency codes (`eur`, `usd`, `gbp`), case does not matter, and they must differ. In a terminal the person types the amount back in the from currency; in a pipe the `rerun` carries the approve token and the key base.

When to reach for it: `wv money` marks a balance `no payout method in this currency` and its footer names the swap with the full amount; a payout refused for `INSUFFICIENT_BALANCE` in a currency the person expected money in, when the sale was in another; month end on an account that sells in several currencies and pays out in one (swap first, then `wv money close`). When not to: the person wants a payout method in that currency instead (`payouts supported-methods --country <CC>` says whether Whop offers one; `payouts create-method` saves it), or the balance is crypto (a crypto swap finishes in the background and the same command works, but check `swaps get` before promising the amount).

Done when the run's `next` reads agree: `swaps get <swap_id>` is `completed` (fiat pairs are immediate; crypto takes time and the status says so), and `wv money` shows the from-balance down and the to-balance up by the quoted amount. Tell the person the rate that filled, from the swap record, when it differs from the quote.
