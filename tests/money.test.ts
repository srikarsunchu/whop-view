// `wv money` and `wv money close`: balances, limits, the method pick, the close flags and window, and the plan.
import { test } from "node:test";
import assert from "node:assert/strict";
import { balanceOf, buildClose, closeChecks, closeWindow, limitsOf, moneyData, parseCloseArgs, pickMethod } from "../src/views/money.ts";
import { envelope, synth } from "./render.ts";

const NOW = new Date("2026-09-21T12:00:00Z");

test("money: the balance summary reads available and the other rows; a failed read is an error, not a zero", () => {
  const b = balanceOf("usd", envelope("ledgers.report"));
  assert.equal(b.available, 18.56);
  assert.deepEqual(b.other, []);
  const rich = balanceOf("eur", synth({ report_type: "balance_summary", rows: [{ line_category: "available", amount: 100 }, { line_category: "pending", amount: 25.5 }], total: 125.5 }));
  assert.equal(rich.available, 100);
  assert.deepEqual(rich.other, [{ category: "pending", amount: 25.5 }]);
  const bad = balanceOf("gbp", envelope("error.gated"));
  assert.match(bad.error ?? "", /HTTP_403/);
  assert.equal(bad.available, undefined);
});

test("money: limits carry the block behind a zero; the method is the named one, else the default, else the only one", () => {
  const l = limitsOf(envelope("payouts.methods.limits"));
  assert.equal(l.standard?.code, "kyc_completed");
  assert.equal(l.instant?.code, "restricted_account");
  const ready = limitsOf(envelope("payouts.methods.ready"));
  assert.equal(ready.standard?.max, 5000);
  assert.equal(ready.standard?.code, undefined);
  const one = [{ id: "potk_1" }];
  assert.equal(pickMethod(one).method?.id, "potk_1");
  assert.equal(pickMethod([]).reason, "none");
  assert.equal(pickMethod(one, "potk_9").reason, "named_missing");
  assert.equal(pickMethod([{ id: "a" }, { id: "b" }]).reason, "several");
  assert.equal(pickMethod([{ id: "a" }, { id: "b", is_default: true }]).method?.id, "b");
  assert.equal(pickMethod([{ id: "a" }, { id: "b" }], "a").method?.id, "a");
});

test("money close: flags and the window", () => {
  const { opts } = parseCloseArgs(["money", "close", "--keep", "100", "--method", "potk_1", "--speed", "instant", "--period", "this"]);
  assert.deepEqual(opts, { keep: 100, method: "potk_1", currency: "usd", speed: "instant", period: "this", notes: undefined, key: undefined });
  assert.equal(parseCloseArgs(["money", "close"]).opts?.keep, 0);
  assert.match(parseCloseArgs(["money", "close", "--speed", "fast"]).error ?? "", /standard or instant/);
  assert.match(parseCloseArgs(["money", "close", "--keep", "-5"]).error ?? "", /--keep needs/);
  assert.match(parseCloseArgs(["money", "close", "--nope"]).error ?? "", /not a close flag/);
  assert.deepEqual(closeWindow("last", NOW), { from: "2026-08-01T00:00:00Z", to: "2026-09-01T00:00:00Z", label: "August 2026" });
  assert.deepEqual(closeWindow("this", NOW), { from: "2026-09-01T00:00:00Z", to: "2026-09-21T12:00:00Z", label: "September 2026" });
});

test("money close: the recorded account blocks on the identity limit and the missing method; a ready account plans two steps", () => {
  const opts = parseCloseArgs(["money", "close", "--keep", "10", "--idempotency-key", "k"]).opts!;
  const blocked = buildClose(["money", "close"], opts, { balance: balanceOf("usd", envelope("ledgers.report")), methods: envelope("payouts.methods.limits"), accountId: "biz_1", cap: 500, now: NOW });
  assert.equal(blocked.amount, 8.56);
  assert.equal(blocked.blockers.length, 2);
  assert.match(blocked.blockers[0], /No saved payout method/);
  assert.match(blocked.blockers[1], /identity verification/);
  const ready = buildClose(["money", "close"], opts, { balance: { currency: "usd", available: 1234.56, other: [{ category: "pending", amount: 40 }] }, methods: envelope("payouts.methods.ready"), accountId: "biz_1", accountTitle: "Frame", cap: 5000, now: NOW });
  assert.deepEqual(ready.blockers, []);
  assert.equal(ready.amount, 1224.56);
  assert.deepEqual(ready.typedAmount, { amount: 1224.56, currency: "usd" });
  assert.deepEqual(ready.steps.map((s) => s.key), ["export", "payout"]);
  assert.ok(ready.steps[0].argv.includes("financial-activity"));
  assert.ok(ready.steps[0].argv.some((a) => a.includes('"posted_after":"2026-08-01T00:00:00Z"')));
  assert.ok(ready.steps[1].argv.includes("potk_x1"));
  assert.ok(ready.steps[1].argv.includes("1224.56"));
  assert.ok(ready.steps[1].argv.includes("k-payout"));
  const overCap = buildClose(["money", "close"], opts, { balance: { currency: "usd", available: 1234.56, other: [] }, methods: envelope("payouts.methods.ready"), cap: 500, now: NOW });
  assert.match(overCap.blockers[0], /\$500\.00 cap/);
  const overLimit = buildClose(["money", "close"], opts, { balance: { currency: "usd", available: 9000, other: [] }, methods: envelope("payouts.methods.ready"), cap: null, now: NOW });
  assert.match(overLimit.blockers[0], /\$5,000\.00 Whop allows/);
  const nothing = buildClose(["money", "close"], { ...opts, keep: 50 }, { balance: balanceOf("usd", envelope("ledgers.report")), methods: envelope("payouts.methods.ready"), now: NOW });
  assert.match(nothing.blockers[0], /Nothing to pay out/);
  const sandbox = buildClose(["money", "close"], opts, { balance: { currency: "usd", available: 100, other: [] }, methods: envelope("payouts.methods.limits"), mode: "sandbox", now: NOW });
  assert.equal(sandbox.blockers.some((b) => /identity/.test(b)), false, "sandbox skips Whop's limit");
  assert.equal(sandbox.typedAmount, undefined);
  assert.deepEqual(closeChecks({ export: { id: "exp_1" }, payout: { id: "wdrl_1" } }).map((c) => c.label), ["export", "payout", "balance after"]);
});

test("money data: the screen as JSON names the block and round-trips", () => {
  const d = moneyData({ balances: [balanceOf("usd", envelope("ledgers.report"))], methods: envelope("payouts.methods.limits"), payouts: envelope("payouts.list"), reserves: envelope("accounts.reserves"), verifications: envelope("verifications.list"), commands: [] }) as { ok: boolean; payoutsBlocked?: { code: string }; balances: { available: number }[] };
  assert.equal(d.ok, true);
  assert.equal(d.payoutsBlocked?.code, "kyc_completed");
  assert.equal(d.balances[0].available, 18.56);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(d)));
});
