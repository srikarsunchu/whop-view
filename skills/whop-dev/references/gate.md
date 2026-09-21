# The gate

Shared by every wv skill. `pnpm skill` copies this file into each skill's `references/`.

## Every write goes through `wv`, never `whop`

Without consent `wv` runs nothing. In a terminal it shows the plan and asks the person to type the amount back (a plain yes when no money moves). In a pipe it exits 2 with a JSON envelope in whop's own shape:

```
{ "ok": false,
  "error": { "code": "CONFIRMATION_REQUIRED", "message": "…", "hint": "…" },
  "plan":  { … what the write commits … },
  "rerun": ["wv", …, "--idempotency-key", "…", "--approve", "<expires>.<hmac>"],
  "meta":  { "command": "payouts create", "wrapper": "wv", "mode": "production" } }
```

Show `plan` to the person, get a yes, run `rerun` exactly as given. The `--approve` token is a signature over that argv, the host, and an expiry ten minutes out, minted with a secret only this machine holds: an edited, stale, or foreign rerun is refused with `APPROVAL_INVALID` or `APPROVAL_EXPIRED` and nothing runs. Never add `--yes` yourself. `--plan` returns `{ ok: true, plan }` and runs nothing, for any write or recipe.

A refusal is the same envelope with no `rerun`; report it, do not retry, and never run the plan's steps by hand through `whop` to "do the part that would have worked": a recipe is one approval for the whole sequence, and a blocked recipe means the person decides what to do next, not the agent. Refusals: `WHOP_LIMIT` (Whop's own limit, in its words), `WV_CAP` (`WV_PAYOUT_CAP`, default $500 per payout), `WV_AD_CAP` (`WV_AD_CAP`, default $500 committed per ad write), `INSUFFICIENT_BALANCE`, and `<RECIPE>_BLOCKED` with the reasons in `plan.blockers` and `hint`.

## Retries cannot double-spend

`rerun` carries the `--idempotency-key` `wv` minted at the plan step; a recipe carries one per step from one base, and a rerun after a failed step finishes what is left and re-creates nothing.

## Reads are whop's bytes plus an exit code

`wv <group> <verb> --format json` is byte-identical to `whop`. The status is 3 for a bad request, 4 for not allowed, 5 for not found, 2 when `wv` refused before running, where `whop` says 1 for all of them. `--all` follows the cursor and streams one object per line. `--last 7d`, `--this month`, `--last month` resolve to `--from` and `--to` on `stats get` and `events list`. Dotted paths, repeated flags, and `@file.json` assemble to the JSON flag `whop` expects.

## Preflight is one call

`wv doctor --format json` returns `{ ok, blocking, checks: [{ key, level, detail, fix, blocking }] }`, exit 1 on a blocking failure. Run it first; show each failing check's `fix`; do not start a playbook whose prerequisites are red. `wv agent <group>` prints every verb's flags from `--schema` and marks which write, move money, or destroy; the live manifest wins over any table in a skill.

## Production is the default

`wv --sandbox` points `whop` at the sandbox host with a key kept in `wv`'s config; `wv sandbox status` says whether it works. Payouts, transfers, ad budgets, bounties, and `media generate` move real money in production; that is what the gate is for.
