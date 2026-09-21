// `wv support`: the key kinds, the buyer resolution, the refund and dispute plans, and the actions a ticket ends in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { actionsFor, amountOf, buildDispute, buildRefund, classifyKey, disputesFor, lookupData, parseDisputeArgs, parseRefundArgs, userFrom } from "../src/views/support.ts";
import { envelope } from "./render.ts";

const rec = (name: string) => {
  const p = envelope(name);
  return p.ok && "record" in p.payload ? p.payload.record : {};
};
const NOW = Date.parse("2026-09-21T12:00:00Z");

test("support: keys classify by shape, and a buyer resolves from a person, a payment, or a membership", () => {
  assert.equal(classifyKey("a@b.co"), "email");
  assert.equal(classifyKey("user_1"), "user");
  assert.equal(classifyKey("mem_1"), "membership");
  assert.equal(classifyKey("pay_1"), "payment");
  assert.equal(classifyKey("mber_1"), "member");
  assert.equal(classifyKey("prsn_1"), "person");
  assert.equal(classifyKey("ABCD-1234-EFGH"), "license");
  const p = envelope("people.list");
  const person = p.ok && p.payload.kind === "page" ? p.payload.rows[0] : {};
  assert.deepEqual(userFrom(person), { id: "user_ICLAwIXM9zFfz", name: "sri", username: "designedbysri", email: "person1@example.com" });
  assert.equal(userFrom(rec("payments.get"))?.id, "user_3meX572iT5dAg");
  assert.equal(userFrom(rec("memberships.get"))?.id, "user_3meX572iT5dAg");
  assert.equal(userFrom(undefined), undefined);
  assert.equal(amountOf({ currency: "usd", amount: "9.28" }), 9.28);
  assert.equal(amountOf(5), 5);
});

test("support: disputes narrow to the buyer's payments; the actions come from what the screen found", () => {
  const all = envelope("disputes.list");
  assert.deepEqual(disputesFor(all, new Set(["pay_1"])), all, "an empty list stays empty");
  const input = { key: "a@b.co", kind: "email" as const, user: { id: "user_3meX572iT5dAg" }, memberships: envelope("memberships.list"), payments: envelope("payments.list"), disputes: all, cases: all, commands: [] };
  const actions = actionsFor(input);
  assert.deepEqual(actions[0], { label: "refund", argv: ["wv", "support", "refund", "pay_JFHAhioMdPL1ts"] });
  assert.equal(actions.some((a) => a.label === "cancel"), false, "the recorded memberships are completed, not active");
  const d = lookupData(input) as { ok: boolean; actions: { what: string }[] };
  assert.equal(d.ok, true);
  assert.equal(d.actions[0].what, "refund");
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(d)));
  assert.equal((lookupData({ ...input, user: undefined }) as { ok: boolean }).ok, false);
});

test("refund: the payment first; full by default, partial on --amount, refused over what is left", () => {
  const { opts } = parseRefundArgs(["support", "refund", "pay_JFHAhioMdPL1ts", "--idempotency-key", "k"]);
  assert.match(parseRefundArgs(["support", "refund"]).error ?? "", /Which payment/);
  assert.match(parseRefundArgs(["support", "refund", "mem_1"]).error ?? "", /Which payment/);
  assert.match(parseRefundArgs(["support", "refund", "pay_1", "--amount", "x"]).error ?? "", /--amount needs/);
  const full = buildRefund(["support", "refund"], opts!, { payment: rec("payments.get"), accountId: "biz_1" });
  assert.deepEqual(full.blockers, []);
  assert.equal(full.amount, 10, "the presentment total, not the amount after fees");
  assert.deepEqual(full.steps[0].argv, ["payments", "refund", "pay_JFHAhioMdPL1ts", "--idempotency-key", "k-refund"]);
  assert.deepEqual(full.typedAmount, { amount: 10, currency: "usd" });
  const partial = buildRefund(["support", "refund"], { ...opts!, amount: 4 }, { payment: rec("payments.get") });
  assert.ok(partial.steps[0].argv.includes("--partial_amount") && partial.steps[0].argv.includes("4"));
  const over = buildRefund(["support", "refund"], { ...opts!, amount: 40 }, { payment: rec("payments.get") });
  assert.match(over.blockers[0], /more than the \$10\.00 left/);
  const done = buildRefund(["support", "refund"], opts!, { payment: { ...rec("payments.get"), refunded_amount: { currency: "usd", amount: "10.00" } } });
  assert.match(done.blockers[0], /already refunded in full/);
  const unpaid = buildRefund(["support", "refund"], opts!, { payment: { ...rec("payments.get"), status: "open", refundable: false } });
  assert.equal(unpaid.blockers.length, 2);
  const missing = buildRefund(["support", "refund"], opts!, { paymentError: "Resource not found" });
  assert.match(missing.blockers[0], /could not be read: Resource not found/);
});

test("dispute: evidence with types, the deadline, and the two steps; locked or late is a stop", () => {
  const { opts } = parseDisputeArgs(["support", "dispute", "dsp_x1", "--evidence", "file_a", "--evidence", "file_b:product_image,file_c:customer_session", "--idempotency-key", "k"]);
  assert.deepEqual(opts?.evidence, [{ id: "file_a", type: "digital_fulfillment" }, { id: "file_b", type: "product_image" }, { id: "file_c", type: "customer_session" }]);
  assert.match(parseDisputeArgs(["support", "dispute", "dsp_1", "--evidence", "photo.png"]).error ?? "", /file id like file_x/);
  assert.match(parseDisputeArgs(["support", "dispute", "dsp_1", "--evidence", "file_a:selfie"]).error ?? "", /not a document type/);
  assert.match(parseDisputeArgs(["support", "dispute"]).error ?? "", /Which dispute/);
  const plan = buildDispute(["support", "dispute"], opts!, { dispute: rec("disputes.get"), accountId: "biz_1", now: NOW });
  assert.deepEqual(plan.blockers, []);
  assert.deepEqual(plan.warnings, [], "72 hours left is not soon");
  assert.deepEqual(plan.steps.map((s) => s.key), ["evidence", "submit"]);
  assert.ok(plan.steps[0].argv.includes(JSON.stringify([{ id: "file_a", document_type: "digital_fulfillment" }, { id: "file_b", document_type: "product_image" }, { id: "file_c", document_type: "customer_session" }])));
  assert.ok(plan.steps[1].argv.includes("k-submit"));
  assert.equal(plan.typedAmount, undefined, "no money moves; a plain yes");
  const soon = buildDispute(["support", "dispute"], opts!, { dispute: rec("disputes.get"), now: Date.parse("2026-09-23T20:00:00Z") });
  assert.match(soon.warnings[0], /16 hours left/);
  const late = buildDispute(["support", "dispute"], opts!, { dispute: rec("disputes.get"), now: Date.parse("2026-09-25T12:00:00Z") });
  assert.match(late.blockers[0], /window closed/);
  const locked = buildDispute(["support", "dispute"], opts!, { dispute: { ...rec("disputes.get"), status: "under_review", evidence_editable: false, evidence_locked_reason: "submitted" }, now: NOW });
  assert.equal(locked.blockers.length, 2);
  const none = buildDispute(["support", "dispute"], { ...opts!, evidence: [] }, { dispute: rec("disputes.get"), now: NOW });
  assert.match(none.blockers[0], /No evidence named/);
  const existing = buildDispute(["support", "dispute"], opts!, { dispute: { ...rec("disputes.get"), evidence: { documents: [{ id: "file_old" }] } }, now: NOW });
  assert.match(existing.warnings[0], /1 document is already uploaded/);
});
