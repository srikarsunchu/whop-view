// The license check's pure parts: the verdict, the exit code, the expiry line, and the rows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { exitCodeFor, expiryLine, licenseRows, verdict, VALID_STATUSES } from "../src/views/license.ts";
import { relative } from "../src/format.ts";
import { envelope, synth } from "./render.ts";

test("license: a recorded one-time membership is valid, an unknown key is invalid, anything else is unknown", () => {
  assert.equal(verdict(envelope("memberships.get")), "valid", "completed is a paid one-time purchase");
  assert.equal(verdict(envelope("error.license_404")), "invalid");
  assert.equal(verdict(envelope("error.webhooks_oauth")), "unknown", "a 403 says nothing about the key");
  for (const s of ["active", "trialing", "completed", "canceling"]) assert.equal(verdict(synth({ id: "mem_x", status: s })), "valid", s);
  for (const s of ["expired", "canceled", "past_due", "paused"]) assert.equal(verdict(synth({ id: "mem_x", status: s })), "invalid", s);
  assert.equal(VALID_STATUSES.has("past_due"), false, "past due does not grant access");
  assert.deepEqual([exitCodeFor("valid"), exitCodeFor("invalid"), exitCodeFor("unknown")], [0, 1, 2]);
});

test("license: the expiry line reads a period end ahead or behind, and never for a one-time purchase", () => {
  assert.deepEqual(expiryLine({ current_period_end: null }), { text: "never · one-time purchase", role: "muted" });
  const ahead = expiryLine({ current_period_end: "2026-10-14T12:00:00Z" });
  assert.equal(ahead.text, "Oct 14, 2026 12:00 UTC · in 25d");
  assert.equal(ahead.role, "text");
  const cancels = expiryLine({ current_period_end: "2026-10-14T12:00:00Z", cancel_at_period_end: true });
  assert.match(cancels.text, /in 25d · cancels then$/);
  assert.equal(cancels.role, "warn");
  const behind = expiryLine({ current_period_end: "2026-09-01T12:00:00Z" });
  assert.equal(behind.text, "Sep 1, 2026 12:00 UTC · 18d ago");
  assert.equal(behind.role, "bad");
});

test("relative: dates ahead read `in`, dates behind read `ago`", () => {
  assert.equal(relative("2026-09-19T12:00:20Z"), "just now");
  assert.equal(relative("2026-09-19T14:00:00Z"), "in 2h");
  assert.equal(relative("2026-09-19T10:00:00Z"), "2h ago");
  assert.equal(relative("2026-11-19T12:00:00Z"), "in 2mo");
});

test("license: rows carry status, product, plan, expiry, user, and the membership id", () => {
  const p = envelope("memberships.get");
  if (!p.ok || !("record" in p.payload)) throw new Error("memberships.get is not a record");
  const rows = licenseRows(p.payload.record);
  assert.deepEqual(rows.map((r) => r.key), ["status", "product", "plan", "expires", "user", "membership"]);
  assert.equal(rows[0].value, "completed");
  assert.equal(rows[3].value, "never · one-time purchase");
  assert.equal(rows[5].value, "mem_kfT4Jl8Pb8DlWE");
  const named = licenseRows({ id: "mem_x", status: "active", product: { id: "prod_x", title: "Frame" }, plan: { id: "plan_x", title: "Pro" }, member: { user: { id: "user_x", username: "sri" } } });
  assert.equal(named[1].value, "Frame  prod_x");
  assert.equal(named[4].value, "@sri  user_x");
});
