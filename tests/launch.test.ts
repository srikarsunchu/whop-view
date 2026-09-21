// `wv gtm launch`'s pure parts: the flags, the plan from recorded reads, the placeholders, and the done-when checks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLaunch, doneChecks, launchData, parseLaunchArgs, stepKey, substitute } from "../src/views/launch.ts";
import { envelope } from "./render.ts";

const rec = (name: string) => {
  const p = envelope(name);
  return p.ok && "record" in p.payload ? p.payload.record : {};
};
const rows = (name: string) => {
  const p = envelope(name);
  return p.ok && p.payload.kind === "page" ? p.payload.rows : [];
};
const NOW = new Date("2026-09-21T12:00:00Z");

test("launch flags: the product is the positional or --product, defaults are the playbook's, junk is refused in words", () => {
  const { opts } = parseLaunchArgs(["gtm", "launch", "prod_1", "--budget", "40", "--creative", "file_a,file_b", "--creative", "file_c"], NOW);
  assert.equal(opts?.product, "prod_1");
  assert.equal(opts?.budget, 40);
  assert.deepEqual(opts?.creatives, ["file_a", "file_b", "file_c"]);
  assert.equal(opts?.code, "LAUNCH20");
  assert.equal(opts?.percent, 20);
  assert.equal(opts?.days, 7);
  assert.deepEqual(opts?.countries, ["US"]);
  assert.deepEqual(opts?.ages, [25, 44]);
  assert.equal(opts?.campaign, "launch-20260921");
  assert.equal(parseLaunchArgs(["gtm", "launch", "--product", "prod_2", "--percent", "30", "--countries", "us,ca", "--ages", "18-65"]).opts?.code, "LAUNCH30");
  assert.deepEqual(parseLaunchArgs(["gtm", "launch", "prod_2", "--countries", "us,ca"]).opts?.countries, ["US", "CA"]);
  assert.match(parseLaunchArgs(["gtm", "launch"]).error ?? "", /Which product/);
  assert.match(parseLaunchArgs(["gtm", "launch", "prod_1", "--budget", "lots"]).error ?? "", /--budget needs a positive number/);
  assert.match(parseLaunchArgs(["gtm", "launch", "prod_1", "--ages", "young"]).error ?? "", /--ages is two ages/);
  assert.match(parseLaunchArgs(["gtm", "launch", "prod_1", "--nope", "x"]).error ?? "", /not a launch flag/);
  assert.match(parseLaunchArgs(["gtm", "launch", "prod_1", "prod_2"]).error ?? "", /only positional/);
});

test("launch plan: from the recorded account the ad steps block, the promo and checkout are ready, keys derive from the base", () => {
  const { opts } = parseLaunchArgs(["gtm", "launch", "prod_iQ2Zub6GFQS5Q", "--budget", "40", "--creative", "file_a", "--idempotency-key", "base"], NOW);
  const plan = buildLaunch(["gtm", "launch", "prod_iQ2Zub6GFQS5Q"], opts!, { product: rec("products.get"), preferences: rec("accounts.preferences"), social: rows("social-accounts.list"), reach: { error: "no estimate" }, accountId: "biz_1", accountTitle: "Hypermotion", cap: 500, now: NOW });
  assert.deepEqual(plan.product, { id: "prod_iQ2Zub6GFQS5Q", title: "Hypermotion", planId: "plan_ozEZmitgc8tjB", planTitle: "Creator — 1,000 credits", price: "$29.00/mo", visibility: "visible" });
  assert.equal(plan.blockers.length, 3, "no page, no payment method, and $1,200 over the $500 cap");
  assert.match(plan.blockers[2], /\$1,200\.00.*\$500\.00/);
  assert.deepEqual(plan.commitment, { total: 1200, days: 30, openEnded: true });
  assert.equal(plan.expiresAt, "2026-09-28T12:00:00Z");
  const promo = plan.steps[0].argv;
  assert.ok(promo.includes("--expires_at") && promo.includes("2026-09-28T12:00:00Z"));
  assert.ok(promo.includes(stepKey("base", "promo")));
  assert.ok(plan.steps[1].argv.includes("plan_ozEZmitgc8tjB"));
  assert.equal(plan.steps.some((s) => s.skipped), false, "every step is planned; the blockers stop the run, not the plan");
  const ready = buildLaunch(["gtm", "launch"], opts!, { product: rec("products.get"), preferences: { ads_reporting_currency: "usd", ads_payment_methods: [{ id: "pm_1" }] }, social: [{ id: "sacc_1", platform: "facebook", name: "Hypermotion" }], cap: null, now: NOW });
  assert.deepEqual(ready.blockers, []);
  assert.equal(ready.paysFrom, "the account's ads payment method");
  const noBudget = buildLaunch(["gtm", "launch"], parseLaunchArgs(["gtm", "launch", "prod_iQ2Zub6GFQS5Q"], NOW).opts!, { product: rec("products.get"), preferences: rec("accounts.preferences"), now: NOW });
  assert.deepEqual(noBudget.blockers, []);
  assert.deepEqual(noBudget.steps.filter((s) => s.skipped).map((s) => s.key), ["campaign", "ad"]);
  assert.equal(noBudget.commitment, undefined);
  const noCreative = buildLaunch(["gtm", "launch"], parseLaunchArgs(["gtm", "launch", "prod_iQ2Zub6GFQS5Q", "--budget", "10"], NOW).opts!, { product: rec("products.get"), preferences: { ads_payment_methods: [{}] }, social: [{ id: "s" }], cap: null, now: NOW });
  assert.deepEqual(noCreative.steps.filter((s) => s.skipped).map((s) => s.key), ["ad"]);
  assert.equal(noCreative.warnings.length, 1);
  const missing = buildLaunch(["gtm", "launch"], opts!, { now: NOW });
  assert.match(missing.blockers[0], /could not be read/);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(launchData(plan))));
});

test("launch: placeholders resolve from earlier results and stay visible when they cannot", () => {
  const argv = ["ads", "create", "--url", "{checkout.purchase_url}", "--ad_group", '{"ad_campaign_id":"{campaign.id}","x":1}', "--title", "{promo.code} live"];
  assert.deepEqual(substitute(argv, { checkout: { purchase_url: "https://w/c/1" }, campaign: { id: "adcamp_1" }, promo: { code: "LAUNCH20" } }), ["ads", "create", "--url", "https://w/c/1", "--ad_group", '{"ad_campaign_id":"adcamp_1","x":1}', "--title", "LAUNCH20 live"]);
  assert.deepEqual(substitute(["--url", "{checkout.purchase_url}"], {}), ["--url", "{checkout.purchase_url}"]);
  const checks = doneChecks({ steps: [] } as never, { promo: { id: "promo_1" }, campaign: { id: "adcamp_1" } });
  assert.deepEqual(checks.map((c) => c.label), ["promo", "campaign", "spend tomorrow", "the funnel"]);
  assert.deepEqual(checks[0].argv, ["whop", "promo-codes", "get", "promo_1", "--format", "json"]);
  assert.equal(checks[2].argv[0], "wv", "the date preset only resolves through wv");
});
