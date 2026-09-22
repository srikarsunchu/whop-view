# Handoff: global views for the Whop CLI

For the Tuesday review. Everything here was verified on 2026-09-21 against `whop` 0.18.2, API 2026-09-15, and the spec at `https://api.whop.com/openapi.json`. `wv` 0.1.0 is at github.com/srikarsunchu/whop-view; Whop Desktop, the Mac app that embeds it, is at github.com/srikarsunchu/whop-desktop.

## The claim

A view layer for every command group, including the ones Whop ships tomorrow, does not need a screen per group. It needs the kind of each response field, and the OpenAPI spec already says that: `pnpm spec` derives it for 370 commands across 84 groups. What the spec cannot say is the product choice, which column comes first and what it is called, and that is all that is left in the 49 hand hint files. The same core gives an agent a safe face: a write never runs on the first call, it comes back as a plan with a signed rerun, and a refusal carries the plan and no rerun.

## Read in this order

1. `docs/coverage.md`, the measurement. Every recorded envelope rendered three ways: hand hints over derived kinds (what ships), derived kinds alone, inference alone. The honest line: 1 of 12 recorded lists renders identical columns from the spec alone, and nearly every money, status, date, and plan fact does. `pnpm spec --trim` removed 130 of 1,050 hand facts with every snapshot byte-identical.
2. `docs/in-cli.md`, the design. The same code as `--format human` inside the whop binary: derived kinds become a build-time constant beside the operation table, hand facts become `x-whop-cli` annotations on the spec, two spawns disappear. No branch of the CLI exists because its source is not published.
3. `demo/handoff.gif` (also `.mp4`), twenty-two seconds of `wv money` and `wv store --from DE` at 80 columns on the live account.
4. `VIEWS.md`, the decision log: [Hints schema](../VIEWS.md#hints-schema), [Account scope](../VIEWS.md#account-scope), [Passthrough rules](../VIEWS.md#passthrough-rules), [Money](../VIEWS.md#money), [Agent gate](../VIEWS.md#agent-gate).
5. `README.md`: [What agents see](../README.md#what-agents-see), [The screens](../README.md#the-screens), [How it generalizes](../README.md#how-it-generalizes).
6. In whop-desktop: `README.md` (the gate in the chat and in every action dialog) and `docs/assistant-workspace.md` ("What I tested": the refusal card and the plan card on the real business).

## What exists

- Two faces from one core. Terminal: tables and cards. Pipe or agent: whop's own bytes for reads; for writes, exit 2 with `CONFIRMATION_REQUIRED`, a `plan`, and a `rerun` carrying a ten-minute `--approve` token and an idempotency key. `WHOP_LIMIT`, `WV_CAP`, `INSUFFICIENT_BALANCE`, and `*_BLOCKED` carry the plan and no rerun. A model never holds the approval.
- Screens, one JSON call each: money, store, doctor, setup, report, gtm, dev. Recipes, several writes under one approval: money close, money swap, store price, store publish, support refund, support dispute, dev hook, gtm launch and winback.
- Seven skills with evals (`pnpm eval <skill>`) against `tests/fake-whop.sh`; money is 30 of 30.
- `wv --mcp` serves four tools. `--format human` is the sixth format. Screens take `--account_id` for a caller that switches businesses.
- Whop Desktop: the assistant's `whop` is a shim that hands writes to wv; a plan renders as a card with Approve and Decline, money asks for the amount typed back, a refusal is red with no button, and the outcome goes back to Claude. Every panel action dialog goes through the same gate.

## Two decisions to make

1. Where this lives: inside the CLI as `--format human` with `x-whop-cli` annotations on the spec (`docs/in-cli.md`), or wv as a companion the CLI points at. The code is the same either way; the difference is where the product choices are reviewed.
2. A non-US test business with a verified identity. On the test account `payouts supported-methods` is empty under every country and `payouts list` refuses the OAuth login every other money read accepts, so the refusal list for global payouts cannot be built from here.

## Payments, what is built and what is open

Built: the money screen lists every currency the ledger holds and marks balances no saved method can deliver; `wv money swap` quotes first; doctor and setup check payout methods from `payouts supported-methods`; `wv store --from CC` prices plans tax-included through `plans calculate_tax`. Open: the two findings above, unverified beyond one account.

## Corrections to earlier notes

The hint count is 49, not 24. A dozen screens are hand-built, not two. wv does reach the request schema, through a second spawn cached on disk; the response schema comes only from the downloaded spec.
