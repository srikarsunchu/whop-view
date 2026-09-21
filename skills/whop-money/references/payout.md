# One payout

Part of the whop-money skill; `references/gate.md` has the rules.

```bash
wv money --format json                                              # limits, methods, balance first
wv payouts create --amount 250 --payout_method_id potk_x --plan     # the plan and nothing else
wv payouts create --amount 250 --payout_method_id potk_x            # CONFIRMATION_REQUIRED with plan and rerun
```

The plan is the card the person would see: `money` (amount and currency), `destination` (the saved method in words, or "not among the saved payout methods"), `balance` (available and what remains after), `cap` (wv's), `limit` (Whop's, for the speed, with `code` and `message` when it is a block). Refusals, cheapest first and Whop's before wv's: `WHOP_LIMIT` when the amount is over Whop's live limit or the account is blocked (`kyc_completed`, `restricted_account`), `WV_CAP` over `WV_PAYOUT_CAP`, `INSUFFICIENT_BALANCE` over what is available in that currency. None has a `rerun`; report the words and the fix (`whop verifications create --account_id <biz>` for identity; `WV_PAYOUT_CAP=<n>` for one shell when the person means it; wait for settlement for the balance).

Flags that matter: `--currency` must match the balance the funds sit in; `--speed instant` only when the `instant` limit on `wv money` is not blocked; `--quote_token` when `wv money` shows `payout_quote_required` on the ledger (get it from `wv payouts quotes`, which is a read here); `--acknowledge_bank_warning true` only after the person has read the warning about the account holder's name.

Done when: `wv payouts get <wdrl_id> --format json` moves `requested` → `processing` → `completed` (a day or two for `standard`); `wv money` shows the balance lower by the amount; a `reversed` payout came back from the bank, and `payouts methods` will show the method `broken` if the bank rejected the account. Tell the person when a payout sits `in_review` for more than a day; that is Whop's review, and nothing here changes it.
