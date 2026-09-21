# When it fails

Every refusal and error a dev command returns, and what to do. Part of the whop-dev skill; `references/gate.md` has the rules. On any 4 or 5, run `wv doctor --format json` before retrying.

| exit | code and message | what it means | what to do |
|---|---|---|---|
| 2 | `CONFIRMATION_REQUIRED` | not a failure: the plan is ready | show `plan`, get a yes, run `rerun` unchanged |
| 2 | `HOOK_BLOCKED` | the webhook cannot be created as planned | `plan.blockers`: not https, the credential cannot manage webhooks (fix named), a webhook already exists for the URL; report and stop; never run `webhooks create` by hand |
| 2 | `APPROVAL_INVALID`, `APPROVAL_EXPIRED` | the rerun was edited, is over ten minutes old, or came from another machine | plan again without `--approve`; never add `--yes` |
| 2 | `VALIDATION_ERROR` from `wv dev hook` | the URL or an event name is wrong | https URL; events in dot form, `wv agent webhooks` lists the enum |
| 3 | `VALIDATION_ERROR` on `webhooks create` | `--url` required, or an event outside the enum | `wv agent webhooks` |
| 3 | `VALIDATION_ERROR` on `domains create` | not a bare hostname, or `--app_id` missing | `app.example.com`, no scheme or path |
| 3 | `HTTP_422` on `domains create` | the hostname is claimed by another account | `--replace_existing true` after publishing the TXT proof the error names |
| 3 | `HTTP_422` on `app-builds promote` | the build is not `approved` | `app-builds list --app_id` for `status` and `review_message` |
| 3 | `UNKNOWN` · "Unknown flag: --yes" or "--approve" | the command ran through `whop`, not `wv` | rerun it as `wv …` |
| 4 | `HTTP_403` · "OAuth token is not authorized for the developer:manage_webhook scope. This resource requires an API-key login (`whop login --api-key`)." | webhooks need an API-key profile | `wv auth switch <saved api-key profile>`, else `whop auth login --method api-key --apiKey whop_…`; `wv dev` names the profile |
| 4 | `HTTP_403` on `apps logs` or `app-builds` | the key lacks the app's scope, or the app belongs to another account | `whop api-keys permissions` for the catalog; `wv doctor` for what is missing |
| 4 | `HTTP_401` · "Authentication failed" in sandbox mode | wrong or missing sandbox key | `wv sandbox status` |
| 5 | `HTTP_404` on an `app_`, `hook_`, `dom_`, or `apbd_` id | wrong id or another account's | `wv dev --format json` lists the account's |
| 1 | `whop apps deploy` exits non-zero | the build or the upload failed; the stream said why | read the stream; a missing secret or a build error is in the app, not in Whop |
| 1 | a webhook delivery with `success: false` | the endpoint answered non-2xx or timed out; `response_body` has what it said | fix the endpoint; `webhooks deliveries-replay` for the one delivery, `webhooks replay --failed_only true` for the window |

Two things are not errors: a webhook `disabled_reason: consecutive_failures` is Whop protecting the endpoint after a streak, and `webhooks update <id> --enabled true` brings it back once the endpoint answers; and an `apps logs` window with no rows after a deploy means no requests yet, not a broken app, so open the hosted URL first.
