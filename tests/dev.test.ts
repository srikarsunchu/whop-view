// `wv dev`: the webhook credential rule, the screen as data, and the hook plan.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHook, DEFAULT_HOOK_EVENTS, devData, hookChecks, parseHookArgs, webhookAccess } from "../src/views/dev.ts";
import { envelope, synth, synthPage } from "./render.ts";

const READY_PROFILES = synth({ active: "prod-key", profiles: [{ name: "prod-key", method: "api_key" }, { name: "sunchusrikar", method: "oauth" }] });
const GRANTED = synthPage([{ action: "developer:manage_webhook", granted: true }]);
const HOOKS = synthPage([{ id: "hook_1", url: "https://hypermotion.art/hooks", enabled: true, events: ["payment.succeeded"], consecutive_failures: 0 }]);

test("dev: webhooks need an api-key profile with the scope; the fix names the saved key profile when there is one", () => {
  const oauth = webhookAccess(envelope("auth.list"), envelope("permissions.check"), envelope("error.webhooks_oauth"));
  assert.equal(oauth.ok, false);
  assert.match(oauth.reason ?? "", /OAuth token/);
  assert.deepEqual(oauth.fix, ["whop", "auth", "switch", "sandbox"], "the recorded profiles carry one api_key profile named sandbox");
  const ok = webhookAccess(READY_PROFILES, GRANTED, HOOKS);
  assert.deepEqual(ok, { ok: true });
  const lacking = webhookAccess(READY_PROFILES, synthPage([{ action: "developer:manage_webhook", granted: false }]), HOOKS);
  assert.match(lacking.reason ?? "", /lacks developer:manage_webhook/);
  const forbidden = webhookAccess(READY_PROFILES, GRANTED, envelope("error.webhooks_oauth"));
  assert.match(forbidden.reason ?? "", /403/);
});

test("dev: the screen as data carries the app, the webhook access verdict, and the error count", () => {
  const d = devData({ apps: envelope("apps.list"), app: { id: "app_HKnLpw6UGGEqk6", name: "Frame", status: "hidden" }, builds: synthPage([]), domains: synthPage([]), webhooks: envelope("error.webhooks_oauth"), errors: envelope("apps.logs"), profiles: envelope("auth.list"), permissions: envelope("permissions.check"), commands: [] }) as { ok: boolean; app: { id: string }; webhookAccess: { ok: boolean }; webhooks: { error: string }; errorsLast24h: number };
  assert.equal(d.ok, true);
  assert.equal(d.app.id, "app_HKnLpw6UGGEqk6");
  assert.equal(d.webhookAccess.ok, false);
  assert.match(d.webhooks.error, /HTTP_403/);
  assert.equal(d.errorsLast24h, 0);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(d)));
});

test("dev hook: flags default to three events and a test of the first; the plan blocks on oauth, http, and a duplicate", () => {
  const { opts } = parseHookArgs(["dev", "hook", "https://example.com/hooks", "--idempotency-key", "k"]);
  assert.deepEqual(opts?.events, DEFAULT_HOOK_EVENTS);
  assert.equal(opts?.test, "payment.succeeded");
  assert.deepEqual(parseHookArgs(["dev", "hook", "https://x/y", "--events", "payment.succeeded,invoice.paid", "--test", "invoice.paid", "--app", "app_1"]).opts, { url: "https://x/y", events: ["payment.succeeded", "invoice.paid"], app: "app_1", test: "invoice.paid", key: undefined });
  assert.match(parseHookArgs(["dev", "hook"]).error ?? "", /Which URL/);
  assert.match(parseHookArgs(["dev", "hook", "https://x/y", "--events", "PaymentSucceeded"]).error ?? "", /not an event name/);
  const ready = buildHook(["dev", "hook"], opts!, { profiles: READY_PROFILES, permissions: GRANTED, webhooks: HOOKS, accountId: "biz_1" });
  assert.deepEqual(ready.blockers, []);
  assert.deepEqual(ready.steps.map((s) => s.key), ["hook", "test"]);
  assert.ok(ready.steps[0].argv.includes(JSON.stringify(DEFAULT_HOOK_EVENTS)));
  assert.ok(ready.steps[0].argv.includes("k-hook"));
  assert.deepEqual(ready.steps[1].argv, ["webhooks", "test", "{hook.id}", "--event", "payment.succeeded"]);
  assert.equal(ready.typedAmount, undefined);
  const oauth = buildHook(["dev", "hook"], opts!, { profiles: envelope("auth.list"), permissions: envelope("permissions.check"), webhooks: envelope("error.webhooks_oauth") });
  assert.equal(oauth.blockers.length, 1);
  assert.match(oauth.blockers[0], /OAuth token.*Fix: whop auth switch sandbox/);
  const http = buildHook(["dev", "hook"], { ...opts!, url: "http://example.com/hooks" }, { profiles: READY_PROFILES, permissions: GRANTED, webhooks: HOOKS });
  assert.match(http.blockers[0], /not an https URL/);
  const dup = buildHook(["dev", "hook"], { ...opts!, url: "https://hypermotion.art/hooks" }, { profiles: READY_PROFILES, permissions: GRANTED, webhooks: HOOKS });
  assert.match(dup.blockers[0], /already exists: hook_1/);
  const odd = buildHook(["dev", "hook"], { ...opts!, test: "invoice.paid" }, { profiles: READY_PROFILES, permissions: GRANTED, webhooks: HOOKS });
  assert.match(odd.warnings[0], /not among the subscribed events/);
  assert.deepEqual(hookChecks({ hook: { id: "hook_2" } }).map((c) => c.label), ["delivery", "webhook", "the loop"]);
});
