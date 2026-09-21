# When it fails

Every failure `wv` and `whop` return, and what to do. Part of the whop-gtm skill; `SKILL.md` has the rules.


Every failure is one of these. The exit code says which family; the `code` in the body says which row. On any 4 or 5, run `wv doctor --format json` before retrying anything.

| exit | code and message | what it means | what to do |
|---|---|---|---|
| 2 | `CONFIRMATION_REQUIRED` | not a failure: the plan is ready | show `plan`, get a yes, run `rerun` unchanged |
| 2 | `LAUNCH_BLOCKED` | a launch step cannot run | every reason is in `plan.blockers` and `hint`; report them, fix them, plan again; never run the unblocked steps by hand through `whop` |
| 2 | `WHOP_LIMIT` · "Please complete identity verification…" | Whop refuses the payout, in its words | `whop verifications create --account_id <biz>`, then the dashboard; nothing to retry |
| 2 | `WV_CAP`, `WV_AD_CAP` | over wv's per-write cap | report the amount and the cap; the person raises `WV_PAYOUT_CAP` or `WV_AD_CAP` for one shell, or lowers the amount, or sets an end date so an ad's commitment is real |
| 2 | `INSUFFICIENT_BALANCE` | the ledger cannot cover it | report; `wv ledgers report --report_type balance_summary --format json` for the number |
| 2 | `APPROVAL_INVALID`, `APPROVAL_EXPIRED` | the rerun was edited, is over ten minutes old, or came from another machine | run the command without `--approve` for a fresh plan; never add `--yes` |
| 2 | `BAD_PRESET`, `EVENTS_RANGE` | a date flag wv refused | `--last 7d`, `--this month`, `--last month`; `events list` spans at most 30 days |
| 2 | `JSON_FLAGS` | an `@file` is missing or not JSON | fix the path or the file |
| 2 | `NEEDS_TERMINAL` | a wv screen that only draws | `wv doctor` and `wv gtm` answer `--format json`; the rest need a person |
| 3 | `VALIDATION_ERROR` · "expected string, received undefined" on `stats get` | `--from` and `--to` are required | use a preset through `wv` |
| 3 | `HTTP_422` on `ads create` or `ad-groups create` | Meta refused the object | the message names the field; `wv agent ads` has the enum |
| 3 | `HTTP_400` · "No Rain account found for this account." | card issuing is gated behind a Rain account | out of scope; tell the person |
| 3 | `HTTP_400` · "Authenticate with an account-scoped credential…" | cashback rules need an API key, not OAuth | `whop login --method api-key` |
| 3 | `UNKNOWN` · "Unknown flag: --yes" or "--approve" | the command ran through `whop`, not `wv` | rerun it as `wv …`; `whop` does not know wv's flags |
| 4 | `HTTP_403` · "You don't have access to Economic Intelligence yet." | the preference is off | `wv accounts update-preferences --economic_intelligence true` |
| 4 | `HTTP_403` · "OAuth token is not authorized for the developer:manage_webhook scope" | webhooks need an API-key profile | `whop login --method api-key --apiKey whop_…` |
| 4 | `HTTP_403` · "This endpoint requires Whop internal access" | `experiments` is internal-only | stop; nothing a seller can do |
| 4 | `HTTP_401` · "Authentication failed" in sandbox mode | wrong or missing sandbox key | `wv sandbox status`; the key lives in wv's config, never the shell's production key |
| 5 | `HTTP_404` · "Resource not found", "Membership not found" | wrong id, or an id from another account | check the id with the group's `list`; add `--account_id <biz>` when the account is not the active one |
| 5 | `COMMAND_NOT_FOUND` | a typo | `cta.commands` in the body carries the suggestion; `wv agent` lists every group |
| 1 | anything else | whop's own status | read `message`; if it names Meta, it is the ad platform, and `wv doctor`'s `page` and `payment` checks are the first places to look |

Two ad failures are not envelopes at all. `estimate_reach` answering "No Meta ad account available for reach estimates" means no Facebook page is connected (Whop Ads runs under a page you connect, on an ad account Whop owns); `social-accounts connect --platform meta_business --scopes advertise --redirect_url <url>` returns a URL the person opens. An ad that stays `in_review` for more than a day, or turns `rejected`, went through Whop Ads' own review: Whop owns the ad account, the review and launch path, and the billing, and the seller only connects the Facebook page the ad runs under. The fix is the creative or the copy (`ads get` carries `issues`), and the budget is not the problem.
