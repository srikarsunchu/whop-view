// The doctor's pure parts: each check's verdict from real and synthetic envelopes, and the exit rule.
import { test } from "node:test";
import assert from "node:assert/strict";
import { blocked, checks, lastSuccess, missingActions, profilesOf, type Check } from "../src/views/doctor.ts";
import { DOCTOR, DOCTOR_READY, envelope, synth } from "./render.ts";

const byKey = (list: Check[]) => Object.fromEntries(list.map((c) => [c.key, c]));

test("doctor: the recorded account fails identity and products pass, and the screen blocks", () => {
  const c = byKey(checks(DOCTOR));
  assert.equal(c.auth.level, "ok");
  assert.match(c.auth.detail, /sunchusrikar · oauth · Frame/);
  assert.equal(c.identity.level, "fail");
  assert.match(c.identity.detail, /complete identity verification/, "Whop's own words, not a paraphrase");
  assert.deepEqual(c.identity.fix, ["whop", "verifications", "create", "--account_id", "biz_VraUMckluH8dzV"]);
  assert.equal(c.products.level, "ok");
  assert.match(c.products.detail, /2 for sale/);
  assert.equal(blocked(checks(DOCTOR)), true);
});

test("doctor: an oauth login that lacks a scope points at the saved api-key profile", () => {
  const c = byKey(checks(DOCTOR));
  assert.equal(c.apikey.level, "warn");
  assert.match(c.apikey.detail, /lacks developer:manage_webhook/);
  assert.deepEqual(c.apikey.fix, ["whop", "auth", "switch", "sandbox"]);
  assert.equal(c.webhooks.level, "warn");
  assert.deepEqual(c.webhooks.fix, ["whop", "auth", "switch", "sandbox"], "the 403 on webhooks list is the same missing scope");
});

test("doctor: the launch gaps come from the same reads gtm uses", () => {
  const c = byKey(checks(DOCTOR));
  assert.equal(c.pixel.level, "warn");
  assert.deepEqual(c.pixel.fix, ["whop", "events", "validate_pixel"]);
  assert.equal(c.page.level, "warn");
  assert.equal(c.payment.level, "warn");
  assert.equal(c.payment.fix, undefined);
  assert.equal(c.payment.dashboard, "https://whop.com/dashboard/biz_VraUMckluH8dzV/", "no CLI command adds an ads payment method");
  assert.equal(c.ei.level, "warn");
  assert.deepEqual(c.ei.fix, ["whop", "accounts", "update-preferences", "--economic_intelligence", "true"]);
});

test("doctor: everything done is all ok and exits 0", () => {
  const list = checks(DOCTOR_READY);
  assert.deepEqual(list.map((c) => c.level), list.map(() => "ok"));
  const c = byKey(list);
  assert.match(c.identity.detail, /verification verified · payouts allowed · up to \$1,000\.00/);
  assert.match(c.webhooks.detail, /hypermotion\.art\/hooks · last success 27h ago/);
  assert.match(c.pixel.detail, /1 of 2 people attributed/);
  assert.equal(blocked(list), false);
});

test("doctor: signed out fails the first check with whop login and blocks", () => {
  const list = checks({ ...DOCTOR, auth: synth({ loggedIn: false }) });
  const c = byKey(list);
  assert.equal(c.auth.level, "fail");
  assert.deepEqual(c.auth.fix, ["whop", "login"]);
  assert.equal(blocked(list), true);
});

test("doctor: no api-key profile at all names the login command and the dashboard", () => {
  const c = byKey(checks({ ...DOCTOR, profiles: synth({ active: "me", profiles: [{ name: "me", method: "oauth" }] }) }));
  assert.equal(c.apikey.level, "warn");
  assert.match(c.apikey.detail, /No api-key profile/);
  assert.equal(c.apikey.fix?.[2], "login");
  assert.ok(c.apikey.dashboard);
  assert.equal(c.webhooks.fix?.[2], "login");
});

test("doctor: a webhook with no recent success asks for a test event; a missing scope on limits is a warning, not a block", () => {
  const stale = { ...DOCTOR_READY, deliveries: { hook_x1AbCdEfGh: synth({ data: [{ id: "whd_1", success: true, sent_at: "2026-08-01T00:00:00Z" }], page_info: { has_next_page: false } }) } };
  const c = byKey(checks(stale));
  assert.equal(c.webhooks.level, "warn");
  assert.deepEqual(c.webhooks.fix, ["whop", "webhooks", "test", "hook_x1AbCdEfGh", "--event", "payment.succeeded"]);
  const noLimits = byKey(checks({ ...DOCTOR_READY, methods: envelope("payouts.methods") }));
  assert.equal(noLimits.identity.level, "warn");
  assert.equal(blocked(checks({ ...DOCTOR_READY, methods: envelope("payouts.methods") })), false);
});

test("doctor: helpers read auth list, permissions check, and deliveries", () => {
  assert.deepEqual(profilesOf(envelope("auth.list")).apiKey.map((p) => p.name), ["sandbox"]);
  assert.equal(profilesOf(envelope("auth.list")).active, "sunchusrikar");
  assert.deepEqual(missingActions(envelope("permissions.check")), ["developer:manage_webhook"]);
  assert.equal(missingActions(undefined).length, 0);
  assert.equal(lastSuccess(DOCTOR_READY.deliveries.hook_x1AbCdEfGh), "2026-09-18T09:00:00Z");
  assert.equal(lastSuccess(undefined), undefined);
});
