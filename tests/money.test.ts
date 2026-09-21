// `wv money` and `wv money close`: balances, limits, the method pick, the close flags and window, and the plan.
import { test } from "node:test";
import assert from "node:assert/strict";
import { balanceOf, buildClose, buildSwap, closeChecks, closeWindow, currenciesOf, limitsOf, moneyData, parseCloseArgs, parseSwapArgs, pickMethod, quoteOf, swapChecks, unpayable } from "../src/views/money.ts";
import { MONEY_READY, SWAP_BLOCKED, SWAP_READY, envelope, synth, synthPage } from "./render.ts";

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

test("money: every currency the account holds, and the ones nothing can pay out", () => {
  const usdOnly = envelope("payouts.methods.ready");
  assert.deepEqual(currenciesOf(usdOnly), ["usd"]);
  assert.deepEqual(currenciesOf(usdOnly, envelope("ledgers.list")), ["usd"], "the recorded ledger is all usd");
  const eurSale = synthPage([{ id: "line_1", currency: { code: "EUR", precision: "100000000" } }, { id: "line_2", currency: { code: "usd" } }]);
  const reserves = synthPage([{ currency: "gbp", amount: 5 }]);
  assert.deepEqual(currenciesOf(usdOnly, eurSale, reserves), ["usd", "eur", "gbp"], "ledger and reserve currencies join, lowercased, usd first");
  assert.deepEqual(currenciesOf(envelope("error.gated"), eurSale), ["usd", "eur"], "an unreadable methods page still leaves the ledger's currencies");
  // A EUR balance with a USD-only method is stuck; the data names it and the screen marks it.
  assert.deepEqual(unpayable(MONEY_READY).map((b) => b.currency), ["eur"]);
  const d = moneyData(MONEY_READY) as { unpayable: string[]; balances: { currency: string; payable: boolean }[] };
  assert.deepEqual(d.unpayable, ["eur"]);
  assert.deepEqual(d.balances.map((b) => [b.currency, b.payable]), [["usd", true], ["eur", false]]);
  // No method at all: nothing is "unpayable" in particular, the methods row already says so.
  assert.deepEqual(unpayable({ ...MONEY_READY, methods: envelope("payouts.methods.limits") }), []);
});

test("money swap: flags, the quote, and the plan with both balances before and after", () => {
  const { opts } = parseSwapArgs(["money", "swap", "--from", "EUR", "--to", "usd", "--amount", "80"]);
  assert.deepEqual(opts, { from: "eur", to: "usd", amount: 80, key: undefined });
  assert.match(parseSwapArgs(["money", "swap", "--from", "eur", "--to", "eur", "--amount", "1"]).error ?? "", /both eur/);
  assert.match(parseSwapArgs(["money", "swap", "--from", "eur", "--to", "usd"]).error ?? "", /--amount/);
  assert.match(parseSwapArgs(["money", "swap", "--amount", "5"]).error ?? "", /Which currencies/);
  assert.match(parseSwapArgs(["money", "swap", "--from", "eur", "--to", "usd", "--amount", "5", "--speed", "x"]).error ?? "", /not a swap flag/);
  const q = quoteOf(synth({ id: "q", object: "swap_quote", amount_in: "1.0", amount_out: "0.87", rate: "0.87", fee_bps: 0, fee_amount: null }));
  assert.deepEqual(q, { amountIn: 1, amountOut: 0.87, rate: 0.87, feeBps: 0, feeAmount: undefined });
  assert.match(quoteOf(envelope("error.gated")).error ?? "", /HTTP_403/);
  // Ready: one step, the amount typed back, both balances move.
  assert.deepEqual(SWAP_READY.blockers, []);
  assert.deepEqual(SWAP_READY.steps.map((s) => s.key), ["swap"]);
  assert.deepEqual(SWAP_READY.steps[0].argv, ["swaps", "create", "--account_id", "biz_VraUMckluH8dzV", "--from_token", "eur", "--to_token", "usd", "--amount", "80", "--idempotency-key", "k-swap"]);
  assert.deepEqual(SWAP_READY.typedAmount, { amount: 80, currency: "eur" });
  assert.deepEqual(SWAP_READY.after, { from: 0, to: 1326.56 });
  assert.match(SWAP_READY.summary.find((r) => r.key === "rate")?.value ?? "", /1 eur = \$1\.15 · no fee/);
  assert.match(SWAP_READY.summary.find((r) => r.key === "from")?.value ?? "", /€80\.00 available → €0\.00/);
  // Blocked: more than the balance holds.
  assert.equal(SWAP_BLOCKED.blockers.length, 1);
  assert.match(SWAP_BLOCKED.blockers[0], /€80\.00 is more than the €12\.50 available/);
  // A failed quote blocks; a fee warns; sandbox types nothing back.
  const noQuote = buildSwap(["money", "swap"], opts!, { quote: envelope("error.gated"), from: { currency: "eur", available: 100, other: [] }, to: { currency: "usd", available: 0, other: [] } });
  assert.match(noQuote.blockers[0], /would not quote/);
  const fee = buildSwap(["money", "swap"], opts!, { quote: synth({ id: "q", amount_in: "80", amount_out: "91", rate: "1.15", fee_bps: 25, fee_amount: "0.2" }), from: { currency: "eur", available: 100, other: [] }, to: { currency: "usd", available: 0, other: [] }, mode: "sandbox" });
  assert.match(fee.warnings[0], /25 bps/);
  assert.equal(fee.typedAmount, undefined);
  assert.deepEqual(swapChecks({ swap: { id: "swap_1" } }).map((c) => c.label), ["swap", "balances after"]);
});
