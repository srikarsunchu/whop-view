// `wv gtm rank`'s rubric, one group at a time, and the ranking.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_DAYS, MIN_RESULTS, PAUSE_RATIO, rankGroups, verdictFor } from "../src/views/rank.ts";
import { parseWinbackArgs, buildWinback } from "../src/views/winback.ts";
import { synth } from "./render.ts";

const g = (over: Partial<Parameters<typeof verdictFor>[0]>) => ({ spend: 100, results: 60, costPerResult: 5, ageDays: 5, ...over });

test("rank: rejected and silent groups are not performance questions; the sample gates every verdict", () => {
  assert.equal(verdictFor(g({ status: "rejected" }), 10), "rejected");
  assert.equal(verdictFor(g({ deliveryStatus: "all_ads_rejected" }), 10), "rejected");
  assert.equal(verdictFor(g({ spend: 0, results: 0, ageDays: 1 }), 10), "not_delivering");
  assert.equal(verdictFor(g({ spend: 0, results: 0, ageDays: 0 }), 10), "wait", "a group made today has not had its day");
  assert.equal(verdictFor(g({ ageDays: MIN_DAYS - 1 }), 10), "wait");
  assert.equal(verdictFor(g({ results: MIN_RESULTS - 1 }), 10), "wait");
  assert.equal(verdictFor(g({ costPerResult: 10 * PAUSE_RATIO + 0.01 }), 10), "pause");
  assert.equal(verdictFor(g({ costPerResult: 10 * PAUSE_RATIO }), 10), "hold", "exactly twice is not over");
  assert.equal(verdictFor(g({ costPerResult: 9.99 }), 10), "scale");
  assert.equal(verdictFor(g({ costPerResult: 10 }), 10), "hold", "at the target is not under it");
  assert.equal(verdictFor(g({}), undefined), "hold", "no target, no money verdicts");
  assert.equal(verdictFor(g({ costPerResult: undefined }), 10), "hold");
});

test("rank: cheapest first, groups without a cost per result last by spend, actions only where the rubric acts", () => {
  const now = Date.parse("2026-09-21T12:00:00Z");
  const groups = synth({
    data: [
      { id: "b", title: "b", spend: 200, results: 80, cost_per_result: 4.5, created_at: "2026-09-01T00:00:00Z", status: "active" },
      { id: "a", title: "a", spend: 100, results: 60, cost_per_result: 1.7, created_at: "2026-09-01T00:00:00Z", status: "active" },
      { id: "z", title: "z", spend: 50, results: 0, created_at: "2026-09-19T00:00:00Z", status: "active" },
      { id: "y", title: "y", spend: 10, results: 0, created_at: "2026-09-19T00:00:00Z", status: "active" },
    ],
    page_info: { start_cursor: null, end_cursor: null, has_next_page: false, has_previous_page: false },
  });
  const ranked = rankGroups({ campaignId: "c", groups, target: 2, currency: "usd", now, commands: [] });
  assert.deepEqual(ranked.map((r) => r.id), ["a", "b", "z", "y"]);
  assert.deepEqual(ranked.map((r) => r.verdict), ["scale", "pause", "wait", "wait"]);
  assert.deepEqual(ranked[1].action, ["wv", "ad-groups", "pause", "b"]);
  assert.equal(ranked[2].action, undefined);
  assert.equal(ranked[0].ageDays, 20);
});

test("winback flags and plan: defaults, the group's include and exclude, blockers in words", () => {
  const { opts } = parseWinbackArgs(["gtm", "winback", "adcamp_1", "--budget", "15"]);
  assert.equal(opts?.campaign, "adcamp_1");
  assert.equal(opts?.days, 30);
  assert.equal(opts?.code, "COMEBACK");
  assert.equal(opts?.amount, 5);
  assert.match(parseWinbackArgs(["gtm", "winback", "--nope"]).error ?? "", /not a winback flag/);
  const plan = buildWinback(["gtm", "winback"], { ...opts!, key: "k" }, { preferences: { ads_reporting_currency: "usd", ads_payment_methods: [{}] }, social: [{ id: "s" }], campaign: { id: "adcamp_1", title: "Launch", status: "active" }, visitors: { seen: 12, more: false }, cap: null, now: new Date("2026-09-21T12:00:00Z") });
  assert.deepEqual(plan.blockers, []);
  assert.deepEqual(plan.steps.map((s) => s.key), ["visitors", "customers", "promo", "group"]);
  assert.match(plan.steps[0].what, /~12 people now/);
  assert.ok(plan.steps[0].argv.includes("k-visitors"));
  assert.deepEqual(plan.typedAmount, { amount: 15, currency: "usd" });
  const missing = buildWinback(["gtm", "winback"], { ...opts!, campaign: "adcamp_x" }, { campaignError: "Resource not found", visitors: { seen: 0, more: false }, preferences: {}, social: [] });
  assert.equal(missing.blockers.length, 3, "campaign unreadable, no page, no payment method");
  assert.equal(missing.warnings.length, 1, "nobody seen in the window");
});
