---
name: whop-money
description: Treasury on Whop from the terminal, through wv over the Whop CLI, so every payout, transfer, or swap is a plan the person approves before it runs — balances per currency, Whop's live payout limits and the identity block behind a zero, saved payout methods, month-end close with a ledger export and a sweep payout, reconciliation from the ledger, reserves, deposits. Use when asked about a balance, a payout, a withdrawal, moving money between Whop accounts, converting a balance, closing the month, reconciling, or why a payout was refused, or when the user says payout, withdraw, balance, ledger, treasury, month end, reserve, KYC, or verification about a Whop business. Not for selling, ads, support, or apps (use whop-gtm or the generic whop skill).
---

# Whop Money

The money groups of the Whop CLI (`payouts`, `ledgers`, `transfers`, `swaps`, `deposits`, `cards`, `verifications`) move real money with no confirmation and no dry run. `wv` wraps them: every write is a plan the person approves, Whop's live limit is read before any call, and the month end is one command. The rules every wv skill shares are in `references/gate.md`; read it once. This file is the map.

## Rules for money

1. **Read the screen before any write.** `wv money --format json` is the whole treasury in one call: `balances` per currency (`available` and the other rows the ledger names), `limits` per speed with the block behind a zero (`payoutsBlocked` names it: `kyc_completed` means identity verification is not done, `restricted_account` means Whop turned that speed off), the saved `methods` with the default marked, `reserves`, `verifications`, and the last five `payouts`. Nothing on it writes.
2. **Whop's limit is the truth, wv's cap is the seatbelt.** A payout is refused, in Whop's words, when the amount is over the live limit for its speed; `wv`'s own `WV_PAYOUT_CAP` (default $500) refuses on top. When both are exceeded the refusal names Whop's. The plan shows both; `plan.limit` and `plan.cap` carry them as data.
3. **Balances are per currency, and a balance is only as good as a method that delivers it.** A payout draws only from the balance in its currency; `--currency` on the payout must match the currency the funds arrived in. `wv money` lists one balance per currency the account holds money in (saved methods, the ledger's last page, reserves), and `unpayable` names the ones no saved method delivers: a EUR sale on a USD-only account sits there until it is swapped. `wv money swap --from eur --to usd --amount N` is the only way to convert: it quotes first and shows both balances before and after, which a bare `wv swaps create` does not. Do not reach for `swaps create` or `swaps quote` yourself, even through `wv`; the recipe runs them.
4. **The method is named, or it is the default, or it is the only one.** `wv money close` and the payout gate pick that way and refuse in words when several methods exist and none is the default (`--method <potk_id>`).
5. **Instant is a permission, not a speed.** `--speed instant` is refused unless the account and the method are eligible; the `instant` limit on the screen says whether it is. Default to `standard`.
6. **Cards, swaps, and transfers are gated the same way** but two of them are behind Whop gates this account may not have: `cards` answers `HTTP_400 No Rain account found` without a Rain account, and `cashback-rules` needs an API-key credential. Report the gate, do not retry.
7. **A blocked recipe is a stop, not a menu.** `CLOSE_BLOCKED` means report the blockers and their fixes; never run the export or the payout by hand through `whop`. Every write goes through `wv`, including the ones that look harmless.
8. **Every playbook ends with reads that prove it.** A payout that returned an id is `requested`; it is done at `completed`, and `reversed` means the bank sent it back.

## The loop

| stage | groups | what they give you |
|---|---|---|
| know | `wv money`, `ledgers report balance_summary`, `payouts methods --include_limits`, `accounts reserves`, `verifications list` | available per currency, the live limit per speed and what blocks it, saved methods, reserves and when they release |
| move | `payouts create`, `payouts quotes`, `transfers create`, `wv money swap`, `deposits create` | a withdrawal to a bank or wallet, a quote first when the ledger requires one, a move between Whop accounts, a conversion, a hosted deposit page |
| close | `wv money close`, `exports create --resource financial-activity` | the month's ledger as a CSV and the sweep payout above a floor, as one plan |
| reconcile | `ledgers list`, `ledgers report income_statement` / `balance_activity`, `ledgers breakdown`, `payouts list --status` | every line with its source payment, income by period, a bucket explained, payouts by state |
| fix | `verifications create`, `payouts create-method`, `payouts update-method` | identity verification, a new or corrected bank |

## Preflight

```bash
wv doctor --format json    # identity is the blocking check for money; its fix is whop verifications create
wv money --format json     # balances, limits, methods, reserves, recent payouts
```

## Playbooks

| playbook | command | reference |
|---|---|---|
| One payout | `wv payouts create --amount 250 --payout_method_id potk_x` | `references/payout.md` |
| Month end | `wv money close --keep 100 --plan` | `references/close.md` |
| Convert a balance | `wv money swap --from eur --to usd --amount 80 --plan` | `references/swap.md` |
| Reconcile | `wv ledgers list --all`, `ledgers report`, `ledgers breakdown` | `references/reconcile.md` |

## Deciding and failing

- `references/failures.md`: every refusal and error a money command returns, the recorded message, and the fix.
- `references/gate.md`: the rules every wv skill shares.
- `references/commands.md`: the generated command map for the money groups.
