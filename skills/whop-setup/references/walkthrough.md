# First hour

Part of the whop-setup skill; `references/gate.md` has the rules. The loop is: `wv setup`, do step 1, `wv setup`, do the next, until green.

```bash
whop login                                   # interactive; opens a browser
whop quickstart                              # interactive; choose or create the business the CLI uses
wv setup --format json                       # the numbered list, blocking first
```

For each step, by `how`:

- **terminal**: run the command as `whop …` where the person can see it; it prompts or opens a browser. `whop login`, `whop quickstart`, `whop auth login --method api-key --api-key whop_… --profile prod`.
- **cli**: run the command as given; it is `wv …` and shows a plan. `--plan` first if the person wants to see it before deciding. Approve with the rerun.
- **browser**: give the `url` and the `then` sentence. Wait for the person to say it is done, then `wv setup` again.
- **both**: run the command (it starts the thing or returns a URL), then the browser half.

What each step looks like when it lands, so `wv setup` goes green:

1. **signed in**: `whop auth status` shows `loggedIn: true` and the right `account`.
2. **identity**: `wv verifications create --account_id <biz>` (a plan) starts it; the dashboard takes the documents; `wv money --format json` shows `payoutsBlocked: null` once Whop clears it, which can take a while. Until then the step stays red and that is not a failure.
3. **product with a plan**: `wv products create --title "…"` then `wv plans create --product_id prod_… --plan_type one_time --initial_price 29 --title "…"` (or `--plan_type renewal --renewal_price 29 --billing_period 30`); `wv store` shows it `for sale` after `wv store publish`.
4. **api key**: `wv auth switch <profile>` when `auth list` has an api-key profile; else the dashboard makes a key with the scopes `wv doctor` names (`developer:manage_webhook`, `payout:withdraw_funds`, `access_pass:create`, `plan:create`, `payment:basic:read`, `stats:read`), then `whop auth login --method api-key`.
5. **pixel**: the snippet from `https://docs.whop.com/developer/ads/pixel` in the head of every landing page; `whop events validate_pixel` confirms; `wv gtm` shows people with a source within a day of traffic.
6. **facebook page**: `wv social-accounts connect --platform meta_business --scopes advertise --redirect_url https://<your site>/connected` returns a URL; the person connects the page there; `wv gtm` shows it under runs under. Whop owns the ad account; the page is yours.
7. **ads payment**: dashboard settings, or `wv deposits create --destination <biz> --amount …` for a hosted deposit page; `wv gtm --format json` shows `ads_payment_methods` non-empty.
8. **intelligence**: `wv accounts update-preferences --economic_intelligence true`; `wv report` stops showing the 403.
9. **webhooks**: on the api-key profile, `wv dev hook https://<host>/hooks`; `wv dev` shows it healthy.

Done when: `wv setup` prints every check green, `wv doctor --format json` is `ok: true`, and `wv report` has an empty Blockers section. Tell the person which steps are theirs and how long identity can take; do not report the account as set up while a blocking step is red.
