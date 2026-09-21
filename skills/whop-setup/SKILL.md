---
name: whop-setup
description: The first hour on Whop from the terminal, through wv over the Whop CLI — sign in, pick the business, verify identity so payouts work, an API-key profile for developer work, the pixel, the Facebook page ads run under, an ads payment method, Economic Intelligence, a product with a plan, a webhook that delivers; as a numbered list of who does what, the CLI or the person in a browser, re-checked until every check is green. Use when someone is new to Whop or to this account, when asked to set up, onboard, get started, verify, connect, or "why can't I", or when wv doctor is red and the person wants to know what to do first. Not for running the business once it is set up (whop-gtm, whop-money, whop-support, whop-dev, whop-store, whop-report).
---

# Whop Setup

Nine one-time things make a Whop business able to sell, pay out, run ads, and receive webhooks, and most of them are browser steps the CLI can only start. `wv setup` turns `wv doctor` into a numbered list with who does each step; the person does the browser ones, wv gates the CLI ones, and `wv setup` again says what is left. The rules every wv skill shares are in `references/gate.md`. This file is the map.

## Rules for setup

1. **The list is the plan.** `wv setup --format json` returns `steps`, blocking ones first, each with `how`: `cli` (wv runs it, the person approves), `terminal` (an interactive `whop` command that owns the terminal), `browser` (only the person, at `url`), or `both` (wv starts it, the person finishes at `url`). Do them in order; do not skip a blocking one to reach a warning.
2. **Blocking means no sale.** Signed in, identity verified (payouts), and a visible product with a plan are the three that block; everything else is a warning that costs a feature (ads, attribution, webhooks, recommendations). Say which kind each step is.
3. **The person does the browser steps.** Identity documents, an ads payment method, a Facebook page connection, a pixel in a page's head, an API key in the dashboard: none can be done from the terminal, and nothing here pretends otherwise. Give the URL and one sentence of what to do there, then wait.
4. **wv runs the CLI steps as plans.** `wv accounts update-preferences --economic_intelligence true`, `wv products create --title …`, `wv auth switch <profile>`, `wv social-accounts connect …` (which returns the URL for the browser half), `wv dev hook …`: each shows its plan and needs a yes. Never `whop <write>` by hand.
5. **Interactive commands run as `whop` in a terminal.** `whop login`, `whop quickstart`, `whop auth login --method api-key`: they open a browser or prompt, and wv execs them untouched. Tell the person to run them where they can see the terminal.
6. **Re-check, do not assume.** After each step, `wv setup` again. A step done in the browser shows up as green on the next run and not before; identity verification in particular can take Whop time to clear. Done is `wv setup` with no steps, or `wv doctor --format json` with `ok: true`.
7. **The first sale needs the first three plus a checkout link.** Once identity and a product are green, `wv store publish <prod>` mints the link; `whop-store` owns it from there.

## The order, and who does what

| step | blocks | who | how |
|---|---|---|---|
| signed in | yes | person | `whop login` in a terminal |
| identity | yes (payouts) | both | `wv verifications create --account_id <biz>` starts it; documents in the dashboard finish it |
| product with a plan | yes | wv | `wv products create --title …`, then `wv plans create --product_id … --plan_type one_time --initial_price …` |
| api key | no (developer work) | wv or both | `wv auth switch <saved api-key profile>`, or make a key in the dashboard and `whop auth login --method api-key` |
| pixel | no (attribution, audiences) | both | the snippet in every landing page's head, then `whop events validate_pixel` |
| facebook page | no (ads) | both | `wv social-accounts connect --platform meta_business --scopes advertise --redirect_url <url>` returns a URL; connect the page there |
| ads payment | no (ads) | person | settings in the dashboard, or `wv deposits create` to fund the balance |
| intelligence | no (recommendations) | wv | `wv accounts update-preferences --economic_intelligence true` |
| webhooks | no (your server) | wv | `wv dev hook https://<host>/hooks`, on the api-key profile |

## Preflight

```bash
whop auth status --format json   # who, which business; whop quickstart if none
wv setup --format json           # the list
```

## Playbooks

| playbook | command | reference |
|---|---|---|
| First hour | `wv setup`, then each step, then `wv setup` again | `references/walkthrough.md` |

## Deciding and failing

- `references/failures.md`: what each step's refusal or error means and what to do.
- `references/gate.md`: the rules every wv skill shares.
- `references/commands.md`: the generated command map for the setup groups.
