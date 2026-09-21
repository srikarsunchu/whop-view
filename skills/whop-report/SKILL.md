---
name: whop-report
description: The weekly brief for a Whop business, from the terminal through wv over the Whop CLI — six numbers this week against last, what blocks a sale or a launch, the money and whether payouts are allowed, the store, every live campaign ranked, and Whop's own recommendations waiting for a yes; as a page, as JSON, or as Markdown a schedule can post. Reads only, so it can run unattended; the only writes it points at are approving or rejecting a recommendation, and those are gated. Use when asked for a report, a summary, a weekly or Monday update, how the business is doing, what changed since last week, or what to do next, or when the user says brief, report, weekly, KPI, dashboard, or "how are we doing" about a Whop business.
---

# Whop Report

`wv report` is the Monday brief as one read: two weeks of six metrics, the doctor, the funnel, the money, the store, a rank per live campaign, and the recommendations, composed from the screens the other wv skills use. It writes nothing. The rules every wv skill shares are in `references/gate.md`; the ones that matter here are about reads, so this file is short.

## Rules for the brief

The bare CLI has forty reads behind a Monday brief and no way to ask for last week next to this week, no verdict on a campaign, and a recommender that answers 403 until a preference is on. `wv report` supplies the composition, the comparison, and the list of what to do, and it writes nothing, so the rules are about reading it well and handing every action back to a gated `wv` write.

1. **One call, three faces.** `wv report` is the page; `wv report --format json`, or any pipe, is the data (`kpis`, `doctor`, `gaps`, `money`, `store`, `campaigns`, `recommendations`, `next`); `wv report --md` is Markdown for a message or a doc. Run one, not the underlying forty reads, and not the other skills' screens one by one: the brief already composes `wv doctor`, `wv gtm`, `wv money`, `wv store`, and `wv gtm rank`.
2. **Compare, do not narrate.** Each metric is this week against last week with the change; churn and ad spend are good when they fall, the rest when they rise. A metric with no last week has no change; say so instead of inventing one. `visits` at zero with revenue above zero means the pixel is not installed, and `gaps` says so with the fix.
3. **Next is the brief.** `next` is every action the reads imply, as `wv` commands: a failing doctor check's fix, a launch gap's fix, the losing group in a campaign, a ready recommendation, the identity fix when payouts are blocked. Report them in that order. Every one is a write owned by another skill and gets a plan when run: exit 2 in a pipe with `CONFIRMATION_REQUIRED`, the `plan`, and a signed `rerun`; the person approves, the agent runs `rerun` as given, never `--yes`.
4. **Recommendations are Whop's, and the person decides.** `economic-intelligence list --status ready` is what Whop's recommender proposes. `wv economic-intelligence update <id> --status executed` records approval; `--status superseded --reason "…"` rejects with feedback; both are plans. Show the recommendation's `title` and `reasoning`, never act on one unasked, and when it disagrees with `wv gtm rank`, show both and let the person choose.
5. **A brief can run unattended.** Nothing in it writes, so a schedule can run `wv report --md` and post the result; `references/schedule.md` has the shape. Anything the brief flags is a decision for the person, not the schedule, and a schedule never runs a `next` command.
6. **Say when a read failed.** A metric or a section that answered an error shows the error in its place, in Whop's words; the brief does not drop it. The exit code of the pipe says what went wrong: 4 for the Economic Intelligence 403, whose fix (`whop accounts update-preferences --economic_intelligence true`) `next` already carries. Read `references/failures.md` for what each failed read looks like.
7. **Read the manifest, not your memory.** `wv agent stats` and `wv agent economic-intelligence` print every flag from `--schema`; `stats list` names every metric the brief could add on request. The command map in `references/commands.md` is generated from the same source and pinned to 0.18.2 / API 2026-09-15; the live manifest wins.

## The loop

| stage | groups | what they give you |
|---|---|---|
| measure | `wv report`, `stats get <metric> --last 7d`, `stats list` | six metrics over two windows, every other metric on request |
| judge | `wv gtm rank <campaign> --target N`, `wv doctor --format json`, `wv gtm --format json` | verdicts per ad group, the setup checks, the launch gaps |
| decide | `economic-intelligence list --status ready`, `economic-intelligence update` | Whop's proposals, approved or rejected with a reason |
| act | the `wv` commands in `next` | every one a plan first; the other skills own them |

## Playbooks

| playbook | command | reference |
|---|---|---|
| Monday brief | `wv report --md` | `references/brief.md` |
| On a schedule | `wv report --md` posted weekly | `references/schedule.md` |

## Deciding and failing

- `references/failures.md`: what a failed read looks like in the brief and what to do.
- `references/gate.md`: the rules every wv skill shares.
- `references/commands.md`: the generated command map for the stats and recommendation groups.
