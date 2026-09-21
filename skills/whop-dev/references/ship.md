# Ship

Part of the whop-dev skill; `references/gate.md` has the rules. The deploy itself owns the terminal.

```bash
whop apps init                                  # once: register, scaffold, link this directory
whop apps dev                                   # local server against the app's dev credentials
whop apps deploy                                # build, upload, ship; streams; run it where the person can see it
wv dev app_x --format json                      # the build approved and production, the hosted url
wv apps logs app_x --follow                     # the first requests, live; Ctrl-C stops
```

`apps init`, `apps dev`, and `apps deploy` are interactive or streaming in `whop` itself, so `wv` execs them untouched and they show no plan: run them as `whop …` in a terminal, never in a pipe, and tell the person what the stream said. Before a deploy, `wv dev` shows which build is `production`; `app-builds list --app_id` lists them with `status` (`draft`, `pending`, `approved`, `rejected`) and `review_message` when rejected. `app-builds promote <id>` (a write, gated) makes an approved build the production one without a new deploy.

Secrets: `whop apps secrets` (a command group; `wv agent apps` lists its verbs) sets encrypted env for the hosted runtime and `apps dev`. A build that reads a secret that was never set fails at request time, not at deploy; the error lines show it.

Done when: `wv dev app_x --format json` shows the newest build `approved` with `is_production: true`, `app.hosted_url` answers 200 in a browser, `apps logs app_x --level error --created_after <deploy time>` is empty after the first requests, and, when the app receives webhooks, `wv dev` shows its hook with no failures. Tell the person when a build sits `pending` for more than an hour (Whop's review), when it is `rejected` (the message says why), and when the error lines after a deploy mention a missing secret.
