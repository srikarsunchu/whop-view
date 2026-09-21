---
name: whop-gtm
description: Run go-to-market on Whop from the terminal, through wv over the Whop CLI, so every write is a plan the person approves before it runs — tracking and people, audiences, ad creative, Meta ads, promo codes and checkout links, affiliates and bounties, attribution stats, and Whop's own recommendations. Use when asked to launch, promote, retarget, scale, or report on a Whop product, or when the user says GTM, ads, audiences, campaign, promo, winback, lookalike, bounty, affiliate, ROAS, or "what should I do next" about a Whop business. Not for building apps or payment integration (use the generic whop skill).
---

# Whop GTM

The Whop CLI (`whop`, 0.18+) exposes every go-to-market stage as a command group. `wv` (whop-view) wraps it: every write becomes a plan the person approves, reads stay whop's bytes with an exit code you can branch on, and two playbooks are single commands. This file is the rules and the map; each playbook, the decide rubric, and the failure map are one read away under `references/`.

## Rules

1. **Every write goes through `wv`, never `whop`.** Without consent `wv` runs nothing. In a terminal it shows the plan and asks the person to type the amount back. In a pipe it exits 2 with `error.code` `CONFIRMATION_REQUIRED`, a `plan`, and a `rerun`. Show the plan, get a yes, run `rerun` exactly as given: its `--approve` token is bound to that argv and expires in ten minutes, so an edited or stale rerun is refused. Never add `--yes` yourself. `--plan` returns the plan and runs nothing. A refusal (`WHOP_LIMIT`, `WV_CAP`, `INSUFFICIENT_BALANCE`, `WV_AD_CAP`, `LAUNCH_BLOCKED`, `WINBACK_BLOCKED`) has no `rerun`; report it, do not retry. Without `wv`, stop and show the person the exact `whop` command and what it commits.
2. **Retries cannot double-spend.** `rerun` carries the `--idempotency-key` `wv` minted at the plan step; a recipe carries one per step from one base.
3. **Reads are whop's bytes plus an exit code.** `wv <group> list --format json` is byte-identical to `whop`; status 3 is a bad request, 4 not allowed, 5 not found, 2 refused by `wv`. `--all` follows the cursor and streams one object per line.
4. **Read the manifest, not your memory.** `wv agent <group>` prints every verb's flags from `--schema` and marks which write, move money, or destroy; `wv agent` lists every group and verb; `--format json` on either is the same as data. `references/commands.md` is the generated map, pinned to 0.18.2 / API 2026-09-15; the live manifest wins.
5. **Preflight is one call.** `wv doctor --format json` returns `{ ok, blocking, checks: [{ key, level, detail, fix, blocking }] }`, exit 1 on a blocking failure. Run it first; show each failing check's `fix`; do not start a playbook whose prerequisites are red.
6. **Whop Ads runs on Whop's ad account.** Whop owns the ad account, the review and launch path, and the billing. The seller connects the Facebook page the ads run under (`social-accounts connect --platform meta_business --scopes advertise`), adds an ads payment method in the dashboard, and installs the pixel on any destination outside Whop. Every performance number is attributed by the Whop pixel, not by Meta. An ad sits `in_review` until Whop's review passes it; `rejected` comes with `issues`.
7. **Objects and arrays are JSON to `whop`, plain flags to you.** Through `wv`, dotted paths (`--ad_group.budget_amount 40`), repeated flags, and `@file.json` assemble to the JSON flag, and the plan shows the assembled command.
8. **Dates are presets.** `--last 7d`, `--last 30d`, `--this month`, `--last month` on `stats get` and `events list`. An `events list` range over 30 days is refused before the call.
9. **Production is the default; the sandbox is not a test mode for ads.** `wv --sandbox` uses a key kept in `wv`'s config; `wv sandbox status` says whether it works. Ad budgets, bounties, payouts, and `media generate` move real money in production.
10. **Every playbook ends with reads that prove it.** Each reference closes with "Done when". A write that returned an id is not a launch that delivers.

## The loop

| stage | groups | what they give you |
|---|---|---|
| know | `people list`, `events list`, `stats get people` / `events` / `traffic_events` | visitors resolved into people with LTV, AOV, source path, device, contactable |
| segment | `audiences create`, `audiences add_people` | People-filter audiences that refresh twice a day, CSV uploads, engagement audiences, lookalikes in 1–6 bands |
| make | `media generate`, `files create` | image or 5/10/15s video from a prompt, billed from balance; `--wait` returns a `file_` id |
| launch | `social-accounts connect`, `ad-campaigns create`, `ad-groups estimate_reach`, `ad-groups targeting_options`, `ad-groups create`, `ads create` | Meta campaigns; one nested `ads create` can build campaign, group, and ad |
| convert | `promo-codes create`, `checkout-configurations create`, `plans create`, `products update` / `publish` | time-boxed offers scoped to new, churned, or existing buyers; checkout links carrying metadata and an affiliate code |
| distribute | `products update --global_affiliate_*`, `partners create` / `links` / `earnings`, `bounties create`, `memberships invite` | affiliates, referral links, recurring clipping or UGC bounties with escrow |
| measure | `stats get ad_delivery` / `events` / `people` / `gross_revenue` / `trial_conversion_rate` / `churn_rate`, `exports create` | attribution unified under `whop:<campaign>:<group>:<ad>` source paths; ROAS and cost per result from your own pixel |
| decide | `ad-campaigns pause` / `unpause`, `ads duplicate`, `ad-groups update`, `economic-intelligence create` / `list` / `update`, `webhooks create` | pause losers, clone winners, or hand the numbers to Whop's recommender and approve what comes back |

## Preflight

```bash
wv doctor --format json    # signed in, identity, api key, pixel, facebook page, ads payment, intelligence, products, webhooks; a fix per failing check
wv gtm --format json       # the funnel, people, audiences, campaigns, offers, and the launch gaps, as data
```

## Playbooks

Ids are placeholders. Every write is `wv …` and answers with a plan; reads stay `whop …`. Read the reference before running one.

| playbook | command | reference |
|---|---|---|
| Launch day | `wv gtm launch <prod_id> --budget 40 --creative file_x --plan` | `references/launch.md` |
| Winback | `wv gtm winback <adcamp_id> --budget 15 --plan` | `references/winback.md` |
| Lookalike scale | audiences and groups by hand, then `wv gtm rank <adcamp_id> --target N` | `references/scale.md` |
| Creators do the distribution | `wv products update`, `wv bounties create` | `references/creators.md` |
| Monday report | `wv gtm --format json`, `economic-intelligence` | `references/report.md` |

## Deciding and failing

- `references/decide.md`: the rubric `wv gtm rank` runs. A target before the first read, three days and fifty results before judging, pause over 2× the target, scale under it, one change per campaign per day, duplicate instead of editing.
- `references/failures.md`: every exit code and `code` the CLI and `wv` return, the recorded message, and the fix. On any 4 or 5, run `wv doctor --format json` before retrying.
- `references/commands.md`: the generated command map, the semantics the schema does not say, and the webhooks that close the loop.
- `references/gate.md`: the rules every wv skill shares, in full, with the envelope shape.
