# When it fails

Every refusal and error a money command returns, and what to do. Part of the whop-money skill; `references/gate.md` has the rules. On any 4 or 5, run `wv doctor --format json` before retrying.

| exit | code and message | what it means | what to do |
|---|---|---|---|
| 2 | `CONFIRMATION_REQUIRED` | not a failure: the plan is ready | show `plan`, get a yes, run `rerun` unchanged |
| 2 | `WHOP_LIMIT` · "Please complete identity verification before requesting a withdrawal." | `kyc_completed`: payouts are blocked until identity is verified | `whop verifications create --account_id <biz>`, then the dashboard; nothing to retry |
| 2 | `WHOP_LIMIT` · "Instant payouts are currently disabled for your account." | `restricted_account` on the instant speed | `--speed standard` |
| 2 | `WHOP_LIMIT` · "… is more than the … Whop allows per standard payout right now." | over the live limit; `daily_amount_remaining` may be the binding one | split the payout, or wait a day |
| 2 | `WV_CAP` | over `WV_PAYOUT_CAP`, default $500 | report the amount and the cap; the person sets `WV_PAYOUT_CAP=<n>` for one shell or lowers the amount |
| 2 | `INSUFFICIENT_BALANCE` | the balance in that currency cannot cover it | `wv money` for the number; pending settles later; check `--currency` matches where the funds sit |
| 2 | `CLOSE_BLOCKED` | month end cannot run as planned | report `plan.blockers` (the balance, the floor, the method, the identity block, the limit, the cap) and stop; do not run the export or the payout by hand |
| 2 | `APPROVAL_INVALID`, `APPROVAL_EXPIRED` | the rerun was edited, is over ten minutes old, or came from another machine | plan again without `--approve`; never add `--yes` |
| 3 | `VALIDATION_ERROR` on `payouts create` | a required flag missing: `--amount`, `--payout_method_id` | `wv agent payouts` for the flags |
| 3 | `HTTP_400` · "No Rain account found for this account." | card issuing is behind a Rain account | out of scope; tell the person |
| 3 | `HTTP_400` · "Authenticate with an account-scoped credential to manage cashback rules" | cashback rules need an API key | `whop login --method api-key` |
| 3 | `HTTP_422` · `invalid_payout_quote` | the ledger requires a quote and none or a stale one was passed | `wv payouts quotes --amount … --payout_method_id …` then `--quote_token` |
| 3 | `UNKNOWN` · "Unknown flag: --yes" or "--approve" | the command ran through `whop`, not `wv` | rerun it as `wv …` |
| 4 | `HTTP_403` on `ledgers` or `payouts` | the credential lacks `payment:basic:read` or `payout:withdrawal:read`; without the latter `payouts methods` returns no `limits` | `wv doctor` names the missing scope; an API-key profile with the scope |
| 4 | `HTTP_401` · "Authentication failed" in sandbox mode | wrong or missing sandbox key | `wv sandbox status` |
| 5 | `HTTP_404` on a `potk_` or `wdrl_` id | wrong id or another account's | `wv payouts methods`, `wv payouts list` |
| 1 | anything else | whop's own status | read `message`; a payout `failed` or `denied` in `payouts get` is Whop's or the bank's decision and `payouts methods` may show the method `broken` |

Two things are not errors: `payouts quotes` and `swaps quote` are POSTs whop tags for confirmation but only compute, so `wv` treats them as reads; and a payout `reversed` is a completed payout the bank returned, which shows up as money back on the balance and a method to fix.
