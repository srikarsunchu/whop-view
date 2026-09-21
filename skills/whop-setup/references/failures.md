# When it fails

What each step's refusal or error means and what to do. Part of the whop-setup skill; `references/gate.md` has the rules.

| step | what you see | what it means | what to do |
|---|---|---|---|
| signed in | `wv setup` step 1 · `Not signed in.` | no token, or it expired | `whop login` in a terminal; then `wv setup` |
| identity | `WHOP_LIMIT` · "Please complete identity verification before requesting a withdrawal." on any payout | `kyc_completed`: documents not done or not cleared | the dashboard; `wv money` shows `payoutsBlocked` until Whop clears it; not a wv problem to retry |
| identity | `HTTP_422` on `verifications create` | a verification already exists | `wv verifications list`; finish the existing one in the dashboard |
| product | `VALIDATION_ERROR` · `--title` required | the only required flag | `wv products create --title "…"` |
| product | `wv store` says `no plans` | the product exists, nothing is buyable | `wv plans create --product_id … --plan_type … --initial_price …` |
| api key | `HTTP_403` · "OAuth token is not authorized for the developer:manage_webhook scope…" | the login cannot do developer work | `wv auth switch <api-key profile>`, or make a key and `whop auth login --method api-key` |
| api key | `permissions check` shows `granted: false` | the key lacks a scope | a new key with the scopes `wv doctor` names; keys cannot gain scopes after creation |
| pixel | `wv gtm` people with no source | the snippet is missing or on the wrong pages | every landing page's head, then `whop events validate_pixel` |
| facebook page | `estimate_reach` · "No Meta ad account available for reach estimates" | no page connected with `advertise` | the connect URL; the person connects the page |
| facebook page | `social-accounts list` row with `error` | the connection broke or lost a scope | connect again |
| ads payment | `ads_payment_methods` empty | nothing to bill ads to | dashboard settings, or fund the balance |
| intelligence | `HTTP_403` · "You don't have access to Economic Intelligence yet." | the preference is off | `wv accounts update-preferences --economic_intelligence true` |
| webhooks | `HOOK_BLOCKED` with the OAuth reason | step 4 first | switch profiles, then `wv dev hook` again |
| any | `CONFIRMATION_REQUIRED` | not a failure: a cli step's plan is ready | show `plan`, get a yes, run `rerun` unchanged |
| any | `UNKNOWN` · "Unknown flag: --yes" or "--approve" | a cli step was typed as `whop` | run it as `wv …` |

Two things are not errors: identity verification staying red for hours after the documents went in is Whop's review, not a missing step; and `wv setup` exiting 1 means steps remain, which is the expected state for most of the first hour.
