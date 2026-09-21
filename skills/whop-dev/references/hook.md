# Webhook

Part of the whop-dev skill; `references/gate.md` has the rules. This playbook is one command.

```bash
wv dev --format json                                                # webhookAccess says whether this credential can
wv auth switch <api-key profile>                                  # when it cannot; or whop auth login --method api-key
wv dev hook https://example.com/hooks --plan                        # the plan and nothing else
wv dev hook https://example.com/hooks --events payment.succeeded,membership.activated --test payment.succeeded
wv dev hook https://example.com/app-hooks --app app_x               # a webhook on the app instead of the account
```

Two steps, one approval: `webhooks create --url <https url> --events [...]` (for the account, or `--resource_id app_x` for an app), then `webhooks test <id> --event <e>`, which sends a signed test payload and reads the endpoint's response. Default events are `payment.succeeded`, `membership.activated`, and `membership.cancel_at_period_end_changed`; the test event is the first subscribed one unless `--test` says otherwise. Blockers before any write: the URL is not https; the credential cannot manage webhooks (an OAuth login, an API key without `developer:manage_webhook`, or a 403 from `webhooks list`), with the fix named; a webhook already exists for the URL (`webhooks update <id> --events …` changes it). `HOOK_BLOCKED` carries them. No money moves, so the prompt is a plain yes.

The endpoint verifies the signature with the `webhook_secret` on the created webhook (`webhooks get <id>`, api-key only); `api_version_date` pins the payload shape. `child_resource_events` sends the account's apps' events too.

Done when the run's `next` reads agree: `webhooks deliveries <id> --first 1` shows the test delivery with `success: true` and `response_code` 200 (the test's own `status` and `body` are in the run's results too); `webhooks get <id>` shows `enabled` with `consecutive_failures` 0; `wv dev` lists it healthy. A delivery that failed carries `response_body`; fix the endpoint, then `webhooks deliveries-replay <id> <delivery_id>` re-sends that one, or `webhooks replay <id> --sent_after <iso> --failed_only true` re-sends the window. A webhook Whop disabled (`enabled: false`, `disabled_reason`) after a failure streak is re-enabled with `webhooks update <id> --enabled true` once the endpoint answers.
