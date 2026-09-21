# When it fails

Every refusal and error a support command returns, and what to do. Part of the whop-support skill; `references/gate.md` has the rules. On any 4 or 5, run `wv doctor --format json` before retrying.

| exit | code and message | what it means | what to do |
|---|---|---|---|
| 2 | `CONFIRMATION_REQUIRED` | not a failure: the plan is ready | show `plan`, get a yes, run `rerun` unchanged |
| 2 | `REFUND_BLOCKED` | the refund cannot run as planned | `plan.blockers`: not paid, not refundable, already refunded, over what remains, unreadable payment; report and stop |
| 2 | `DISPUTE_BLOCKED` | the response cannot be submitted | `plan.blockers`: not `needs_response`, evidence locked, window closed, no evidence named; report and stop; never run `disputes submit` by hand |
| 2 | `APPROVAL_INVALID`, `APPROVAL_EXPIRED` | the rerun was edited, is over ten minutes old, or came from another machine | plan again without `--approve`; never add `--yes` |
| 2 | `VALIDATION_ERROR` from `wv support` | the key or flag is wrong | the message says which: a `pay_` id for refund, a `dsp_` id and `file_` ids for dispute, a key for lookup |
| 3 | `VALIDATION_ERROR` on `resolution-center-cases deny` or `reply` | `--message` is required | say why, in words the customer will read |
| 3 | `VALIDATION_ERROR` on `memberships extend` | `--days` 1 to 1095 | pick a number in range |
| 3 | `HTTP_422` on `payments refund` | the processor refused: too old, already reversed, or the amount | `payments get` for `refundable` and `refunded_amount`; a `failed` refund carries `failure_reason` |
| 3 | `HTTP_422` on `disputes upload_evidence` | a `document_type` outside the enum or a `file_` id that is not the account's | `wv agent disputes` for the enum; `wv files list --file_ids <id>` |
| 3 | `UNKNOWN` · "Unknown flag: --yes" or "--approve" | the command ran through `whop`, not `wv` | rerun it as `wv …` |
| 4 | `HTTP_403` on `people` or `payments` with emails | the credential lacks `member:email:read` or `payment:basic:read` | an API-key profile with the scope; `wv doctor` names it |
| 4 | `HTTP_401` · "Authentication failed" in sandbox mode | wrong or missing sandbox key | `wv sandbox status` |
| 5 | `HTTP_404` · "Membership not found" | a license key nobody issued, or another account's membership | `wv memberships check <key>` exits 1 for invalid, 2 for unknown |
| 5 | `HTTP_404` on a `pay_`, `dsp_`, or `rcc_` id | wrong id or another account's | `wv support lookup <email>` lists the buyer's ids |
| 1 | `ok: false` with no `user` from `wv support lookup` | nothing matched the key | try the email, the user id, a membership id, or a payment id; `payments list --query` matches name and username too |

Two things are not errors: a dispute `inquiry: true` is a question from the issuer, not a chargeback, and a good response ends it without funds moving; and a payment `refunded_amount` equal to its total with `status` still `paid` is normal, since a refund does not change the payment's lifecycle state.
