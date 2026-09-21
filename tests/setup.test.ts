// `wv setup`: every non-green doctor check becomes a numbered step with who does it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupData, setupSteps, stepFor } from "../src/views/setup.ts";
import { DOCTOR, DOCTOR_READY } from "./render.ts";

test("setup: blocking first, each step says who does it, and a green account has no steps", () => {
  const steps = setupSteps(DOCTOR);
  assert.equal(steps[0].key, "identity", "the blocking failure leads");
  assert.equal(steps[0].blocking, true);
  assert.equal(steps[0].how, "both");
  assert.deepEqual(steps[0].command, ["wv", "verifications", "create", "--account_id", "biz_VraUMckluH8dzV"], "a write fix runs through wv");
  assert.deepEqual(setupSteps(DOCTOR).find((s) => s.key === "page")?.command?.slice(0, 3), ["wv", "social-accounts", "connect"]);
  assert.deepEqual(setupSteps(DOCTOR).find((s) => s.key === "pixel")?.command, ["whop", "events", "validate_pixel"], "a read stays whop");
  assert.match(steps[0].url ?? "", /dashboard\/biz_VraUMckluH8dzV/);
  const byKey = Object.fromEntries(steps.map((s) => [s.key, s]));
  assert.equal(byKey.apikey.how, "cli");
  assert.deepEqual(byKey.apikey.command, ["wv", "auth", "switch", "sandbox"]);
  assert.equal(byKey.payment.how, "browser");
  assert.equal(byKey.payment.command, undefined);
  assert.equal(byKey.ei.how, "cli");
  assert.deepEqual(byKey.ei.command, ["wv", "accounts", "update-preferences", "--economic_intelligence", "true"]);
  assert.equal(byKey.pixel.how, "both");
  assert.equal(byKey.webhooks.how, "cli");
  assert.equal(steps.map((s) => s.n).join(","), steps.map((_, i) => i + 1).join(","));
  assert.equal(setupSteps(DOCTOR_READY).length, 0);
  const d = setupData(DOCTOR) as { ok: boolean; blocking: number; green: string[]; steps: unknown[] };
  assert.equal(d.ok, false);
  assert.equal(d.blocking, 1);
  assert.ok(d.green.includes("auth") && d.green.includes("products"));
  assert.equal((setupData(DOCTOR_READY) as { ok: boolean }).ok, true);
  assert.equal(stepFor({ key: "auth", label: "signed in", level: "fail", detail: "Not signed in.", fix: ["whop", "login"], blocking: true }).how, "terminal");
});

test("setup: the payout method is a step the person finishes, after the blocking ones", () => {
  const steps = setupSteps(DOCTOR);
  const step = steps.find((s) => s.key === "payoutMethod")!;
  assert.equal(step.blocking, false);
  assert.equal(step.how, "both");
  assert.deepEqual(step.command, ["whop", "payouts", "supported-methods"], "a read stays whop");
  assert.match(step.then, /wv payouts create-method/);
  assert.match(step.url ?? "", /dashboard\/biz_VraUMckluH8dzV/);
  assert.ok(steps.findIndex((s) => s.key === "identity") < steps.findIndex((s) => s.key === "payoutMethod"));
});
