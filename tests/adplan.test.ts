// The ads gate's pure parts: JSON flags, the tree a command names, whose budget applies, what it commits,
// the targeting and reach lines, and the estimate_reach argv.
import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetOf, commitment, describeReach, describeSocial, describeTargeting, isAdPlan, jsonFlags, reachArgv, treeFromArgv, DEFAULT_HORIZON_DAYS } from "../src/views/adplan.ts";
import { adCapFrom, DEFAULT_CAP } from "../src/bin.ts";

const GROUP = '{"ad_campaign_id":"adcamp_x1","title":"US 25-44 · purchase","budget_amount":40,"budget_type":"daily","optimization_goal":"conversions","conversion_event":"purchase","placements":"automatic","demographics":{"minimum_age":25,"maximum_age":44,"gender":"all"},"regions":{"include":{"countries":["US"]}}}';

test("ads gate: only creates and updates under the three ad groups", () => {
  assert.equal(isAdPlan("ads", "create"), true);
  assert.equal(isAdPlan("ad-groups", "update"), true);
  assert.equal(isAdPlan("ad-campaigns", "pause"), false);
  assert.equal(isAdPlan("products", "create"), false);
  assert.equal(isAdPlan("ads", undefined), false);
});

test("json flags: objects and arrays parse, scalars coerce, bad json stays a string", () => {
  const f = jsonFlags(["ads", "create", "--ad_group", GROUP, "--headlines", '["a","b"]', "--title", "x", "--multi_advertiser_ads", "false", "--bad", "{oops"]);
  assert.equal((f.ad_group as { budget_amount: number }).budget_amount, 40);
  assert.deepEqual(f.headlines, ["a", "b"]);
  assert.equal(f.multi_advertiser_ads, false);
  assert.equal(f.bad, "{oops");
});

test("tree: a nested ads create names all three nodes; an id names an existing one", () => {
  const nested = treeFromArgv("ads", "create", ["ads", "create", "--title", "Frame · v1", "--ad_group", GROUP]);
  assert.equal(nested.ad?.isNew, true);
  assert.equal(nested.group?.isNew, true);
  assert.equal(nested.group?.rec.title, "US 25-44 · purchase");
  assert.deepEqual(nested.campaign, { id: "adcamp_x1", isNew: false, rec: {} });
  const existing = treeFromArgv("ads", "create", ["ads", "create", "--title", "v2", "--ad_group_id", "adgrp_x1"]);
  assert.deepEqual(existing.group, { id: "adgrp_x1", isNew: false, rec: {} });
  assert.equal(existing.campaign, undefined);
  const update = treeFromArgv("ad-groups", "update", ["ad-groups", "update", "adgrp_x1", "--budget_amount", "60"]);
  assert.equal(update.group?.id, "adgrp_x1");
  assert.equal(update.group?.isNew, false);
  assert.equal(update.group?.rec.budget_amount, 60);
  const camp = treeFromArgv("ad-campaigns", "create", ["ad-campaigns", "create", "--title", "t", "--objective", "sales", "--platform", "meta"]);
  assert.equal(camp.campaign?.isNew, true);
  assert.equal(camp.group, undefined);
});

test("budget: the command line's own budget is typed back; a fetched group's is not; a campaign only when it owns it", () => {
  const own = jsonFlags(["ads", "create", "--ad_group", GROUP]);
  assert.deepEqual(budgetOf(treeFromArgv("ads", "create", ["ads", "create", "--ad_group", GROUP]), own), { amount: 40, type: "daily", owner: "group", typed: true, startsAt: undefined, endsAt: undefined });
  const fetched = { group: { id: "adgrp_x1", isNew: false, rec: { budget_amount: 25, budget_type: "lifetime", ends_at: "2026-10-01T00:00:00Z" } } };
  assert.equal(budgetOf(fetched, {})?.typed, false);
  assert.equal(budgetOf(fetched, {})?.type, "lifetime");
  const campaignOwns = { campaign: { id: "adcamp_x1", isNew: false, rec: { budget_optimization: "ad_campaign", budget_amount: 100 } }, group: { id: "adgrp_x1", isNew: false, rec: {} } };
  assert.equal(budgetOf(campaignOwns, {})?.owner, "campaign");
  const groupsOwn = { campaign: { id: "adcamp_x1", isNew: false, rec: { budget_optimization: "ad_group", budget_amount: null } } };
  assert.equal(budgetOf(groupsOwn, {}), undefined);
});

test("commitment: daily over the horizon when open ended, daily until the end date, lifetime as itself", () => {
  const at = Date.parse("2026-09-21T00:00:00Z");
  assert.deepEqual(commitment({ amount: 40, type: "daily", owner: "group", typed: true }, at), { total: 40 * DEFAULT_HORIZON_DAYS, days: DEFAULT_HORIZON_DAYS, openEnded: true });
  assert.deepEqual(commitment({ amount: 40, type: "daily", owner: "group", typed: true, endsAt: "2026-09-28T00:00:00Z" }, at), { total: 280, days: 7, openEnded: false });
  // A start in the future shortens the run; a start in the past does not lengthen it.
  assert.equal(commitment({ amount: 10, type: "daily", owner: "group", typed: true, startsAt: "2026-09-25T00:00:00Z", endsAt: "2026-09-28T00:00:00Z" }, at).days, 3);
  assert.equal(commitment({ amount: 10, type: "daily", owner: "group", typed: true, startsAt: "2026-09-01T00:00:00Z", endsAt: "2026-09-28T00:00:00Z" }, at).days, 7);
  assert.deepEqual(commitment({ amount: 500, type: "lifetime", owner: "campaign", typed: true }, at), { total: 500, days: DEFAULT_HORIZON_DAYS, openEnded: true });
});

test("ad cap: default $500, dollars from the env, none turns it off", () => {
  assert.equal(adCapFrom({}), DEFAULT_CAP);
  assert.equal(adCapFrom({ WV_AD_CAP: "3000" }), 3000);
  assert.equal(adCapFrom({ WV_AD_CAP: "none" }), null);
  assert.equal(adCapFrom({ WV_AD_CAP: "lots" }), DEFAULT_CAP);
});

test("targeting: places, ages, gender, interests by name, audiences by name, placements", () => {
  const rec = JSON.parse(GROUP);
  assert.equal(describeTargeting(rec), "US · ages 25–44 · automatic placements");
  const rich = {
    regions: { include: { countries: ["US", "CA"], regions: ["US-TX"], cities: [{ key: "1", name: "Austin" }] }, exclude: { zips: ["78701"] } },
    demographics: { minimum_age: 21, gender: "female" },
    detailed_targeting: { interests: [{ id: "1", name: "Video editing" }, { id: "2", name: "Video editing software" }] },
    audiences: { include: ["adaud_a"], exclude: ["adaud_b"] },
    languages: ["en"],
    placements: [{ platform: "instagram", positions: ["reels"] }],
  };
  assert.equal(describeTargeting(rich, { adaud_a: "visited 30d", adaud_b: "customers" }), "US, CA, US-TX, Austin · excluding 1 place · ages 21+ · female · interests: Video editing, Video editing software · audiences: visited 30d · excluding: customers · en · placements on instagram");
  assert.equal(describeTargeting({ demographics: { automatic: true } }), "automatic audience");
  assert.equal(describeTargeting({}), "");
});

test("reach: a range, a single bound, no estimate, an error, or nothing to estimate", () => {
  assert.deepEqual(describeReach({ lower: 1_500_000, upper: 1_800_000 }, "meta"), { text: "1.5M–1.8M people on meta", role: "text" });
  assert.deepEqual(describeReach({ lower: 900 }, "meta"), { text: "900 people on meta", role: "text" });
  assert.deepEqual(describeReach({}, "meta"), { text: "meta returned no estimate for this targeting", role: "warn" });
  assert.deepEqual(describeReach({ error: "No Meta ad account available for reach estimates" }, "meta"), { text: "not estimated · No Meta ad account available for reach estimates", role: "warn" });
  assert.equal(describeReach(undefined, "meta").role, "muted");
});

test("social: the first usable page, its error when it has one, or the connect command", () => {
  assert.deepEqual(describeSocial([{ id: "sacc_1", name: "Frame", platform: "facebook", username: "frame", error: null }]), { text: "Frame (facebook) @frame", role: "text" });
  assert.deepEqual(describeSocial([{ id: "sacc_1", name: "Frame", platform: "facebook", error: "Page access expired" }]), { text: "Frame (facebook) · Page access expired", role: "warn" });
  assert.equal(describeSocial([]).role, "warn");
});

test("estimate argv: only the targeting keys, as JSON, and nothing when there is no targeting", () => {
  const argv = reachArgv(JSON.parse(GROUP), "meta");
  assert.deepEqual(argv?.slice(0, 4), ["ad-groups", "estimate_reach", "--platform", "meta"]);
  assert.ok(argv?.includes("--regions") && argv.includes("--demographics") && !argv.includes("--budget_amount"));
  assert.equal(reachArgv({ title: "x", budget_amount: 5 }, "meta"), undefined);
  assert.equal(reachArgv({ audiences: {}, languages: [] }, "meta"), undefined);
});
