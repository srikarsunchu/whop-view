# When it fails

Every refusal and error a store command returns, and what to do. Part of the whop-store skill; `references/gate.md` has the rules. On any 4 or 5, run `wv doctor --format json` before retrying.

| exit | code and message | what it means | what to do |
|---|---|---|---|
| 2 | `CONFIRMATION_REQUIRED` | not a failure: the plan is ready | show `plan`, get a yes, run `rerun` unchanged |
| 2 | `PRICE_BLOCKED` | the price change cannot run as planned | `plan.blockers`: already that price, under 1.00, `--initial` on a one-time plan, archived, unreadable; report and stop |
| 2 | `PUBLISH_BLOCKED` | the product cannot be published as planned | `plan.blockers`: no plan, every plan hidden or archived, unreadable; add or publish a plan first, never `products publish` by hand |
| 2 | `APPROVAL_INVALID`, `APPROVAL_EXPIRED` | the rerun was edited, is over ten minutes old, or came from another machine | plan again without `--approve`; never add `--yes` |
| 2 | `VALIDATION_ERROR` from `wv store` | the id or a flag is wrong | a `plan_` id with `--to` or `--initial`; a `prod_` id |
| 3 | `VALIDATION_ERROR` on `promo-codes create` | one of the seven required flags is missing: `account_id`, `code`, `promo_type`, `amount_off`, `base_currency`, `new_users_only`, `promo_duration_months` | `wv agent promo-codes` for the list |
| 3 | `VALIDATION_ERROR` on `plans update` · price under the minimum | a paid fiat plan charges at least 1.00 | 0 for free, or at least 1.00 |
| 3 | `HTTP_422` on `plans create` | a renewal plan without `--billing_period`, or a one-time plan with `--renewal_price` | `wv agent plans` for the pairs |
| 3 | `HTTP_422` on `checkout-configurations create` | both `--plan_id` and `--plan`, or neither | exactly one |
| 3 | `HTTP_422` on `promo-codes create` · duplicate code | the code exists, possibly inactive | `promo-codes list --status expired`; `activate` the old one or pick a new code |
| 3 | `UNKNOWN` · "Unknown flag: --yes" or "--approve" | the command ran through `whop`, not `wv` | rerun it as `wv …` |
| 4 | `HTTP_403` on `plans` with `member_count: null` | the credential lacks `plan:basic:read`; members and stock read as null | an API-key profile with the scope; `wv doctor` names it |
| 4 | `HTTP_401` · "Authentication failed" in sandbox mode | wrong or missing sandbox key | `wv sandbox status` |
| 5 | `HTTP_404` on a `prod_`, `plan_`, `promo_`, or `chk_` id | wrong id or another account's | `wv store --format json` lists the account's |
| 1 | anything else | whop's own status | read `message` |

Two things are not errors: a plan's `member_count` of `null` is a scope, not zero members; and `products publish` on an already visible product is a no-op the recipe skips, so a rerun never fails on it.
