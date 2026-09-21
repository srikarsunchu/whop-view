---
name: whop-dev
description: Building and running Whop apps from the terminal, through wv over the Whop CLI — the app loop on one screen (the app, its production build, its custom domains and their verification, the account's webhooks and their failure streaks, the last day of error lines), init, dev, deploy, and logs, webhooks created and proven with a test delivery, custom domains, API keys and their scopes. Use when asked to build, deploy, or debug a Whop app, add or fix a webhook, verify a domain, follow logs, or when the user says app, deploy, build, webhook, delivery, domain, DNS, API key, scope, or logs about a Whop business. Not for selling, ads, treasury, or tickets (use whop-gtm, whop-money, whop-support).
---

# Whop Dev

Whop hosts apps (`*.whop.site`, Vite on Cloudflare Workers) and pushes events to webhooks. The developer groups of the CLI (`apps`, `app-builds`, `domains`, `webhooks`, `api-keys`, `events`) do each step one at a time; three of them (`apps init`, `apps dev`, `apps deploy`) own the terminal and stream. `wv` supplies the screen, the webhook proof, and the gate. The rules every wv skill shares are in `references/gate.md`; read it once. This file is the map.

## Rules for dev

1. **Webhooks need an API key, not the login.** The OAuth token `whop login` leaves behind lacks `developer:manage_webhook`, so `webhooks list` answers 403 and `webhooks create` would too. `wv dev --format json` says so in `webhookAccess` with the fix: `whop auth switch <saved api-key profile>`, or `whop auth login --method api-key`. Do the switch before any webhook work, and switch back after if the person wants the OAuth profile active.
2. **A webhook is not live until a delivery succeeded.** `wv dev hook <url>` creates it, sends a test event, and the done-when read is `webhooks deliveries <id> --first 1` with `success: true`. The URL must be https. A second webhook for the same URL is refused; change the first with `webhooks update`.
3. **Deploy owns the terminal.** `whop apps deploy` builds, uploads, and ships, streaming as it goes; `whop apps dev` runs the local server; `whop apps init` scaffolds. Run them as `whop`, not `wv`, in a terminal the person can see; there is no plan for a stream. Afterwards `wv dev` shows the build `approved` and `production`, and `wv apps logs <app_id> --follow` shows the first requests land.
4. **A domain is verified by DNS the person sets.** `wv domains create --app_id <app> --domain <host>` returns `dns_records`; the person adds them; `domains get` moves `pending_verification` → `provisioning` → `active`, with `dns_status` and `certificate_status` saying which half is waiting. `action_required` carries `issues`. Nothing in the CLI can do the DNS step.
5. **Logs are the debugger.** `wv apps logs <app_id> --level error --created_after <iso>` for the last day, `--query <text>` to narrow, `--follow` to watch. `wv dev` counts the last 24 hours of error lines.
6. **Keys are scoped.** `whop api-keys permissions` is the catalog; `wv doctor --format json` runs `permissions check` for the scopes a seller and a developer need and names the missing ones. A key that answers 403 on one group is a scope problem, not an auth problem.
7. **Every playbook ends with reads that prove it.** A deploy is done when the build is `approved` and `is_production` and the hosted URL answers; a webhook when a delivery succeeded; a domain when `status` is `active`.

## The loop

| stage | groups | what they give you |
|---|---|---|
| know | `wv dev [app_id]`, `apps list`, `app-builds list --app_id`, `domains list --app_id`, `webhooks list --include_app_webhooks`, `apps logs` | the app, its builds, its domains, the hooks, the errors |
| build | `whop apps init`, `whop apps dev`, `whop apps deploy`, `apps pull`, `app-builds promote` | scaffold, run locally, ship, fetch deployed source, promote a build |
| hook | `wv dev hook`, `webhooks create` / `update` / `test` / `deliveries` / `replay` / `deliveries-replay` | a proven endpoint, and a way to re-send what it missed |
| domain | `domains create` / `get` / `update` / `delete` | a custom hostname with its DNS records and certificate |
| secure | `api-keys permissions`, `permissions check`, `apps permissions`, `apps secrets` | scopes, the app's requested permissions, encrypted env for the hosted runtime |

## Preflight

```bash
wv doctor --format json    # the api key check is the one that matters here
wv dev --format json       # the app, builds, domains, webhooks with webhookAccess, errors in 24h
```

## Playbooks

| playbook | command | reference |
|---|---|---|
| Ship | `whop apps deploy`, then `wv dev`, `wv apps logs <app> --follow` | `references/ship.md` |
| Webhook | `wv dev hook https://<host>/hooks --plan` | `references/hook.md` |
| Domain | `wv domains create --app_id <app> --domain <host>` | `references/domain.md` |

## Deciding and failing

- `references/failures.md`: every refusal and error a dev command returns, the recorded message, and the fix.
- `references/gate.md`: the rules every wv skill shares.
- `references/commands.md`: the generated command map for the developer groups.
