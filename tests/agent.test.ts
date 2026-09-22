// The agent face's pure parts: what is gated, the rerun, the plan shapes, and the exit code map.
import { test } from "node:test";
import assert from "node:assert/strict";
import { agentExitCode, agentGated, errorCodeIn, EXIT_CODES, hasIdempotencyKey, moneyPlan, rerunFor, takesIdempotency, withIdempotencyKey } from "../src/agent.ts";
import { hintsFor } from "../src/hints.ts";
import { changesFor, currentSummary, describeRecord } from "../src/views/confirm.ts";
import { envelope } from "./render.ts";
import { COMPUTE_ONLY, isWrite, loadWhopWrites, taggedWrites, WRITE_VERBS } from "../src/status.ts";
import { spawnSync } from "node:child_process";
import { fixture } from "./render.ts";

test("agent: a write or an ad verb is gated; a read, a --schema, and a --help are not", () => {
  assert.equal(agentGated(["payouts", "create", "--amount", "5"]), true);
  assert.equal(agentGated(["products", "update", "prod_1"]), true);
  assert.equal(agentGated(["ads", "create"]), true);
  assert.equal(agentGated(["products", "list"]), false);
  assert.equal(agentGated(["payouts", "methods"]), false, "a read under a money group");
  assert.equal(agentGated(["payouts", "create", "--schema"]), false);
  assert.equal(agentGated(["payouts", "create", "--help"]), false);
  assert.equal(agentGated(["payouts", "create", "--format", "json"]), true, "a format flag does not lift the gate");
  assert.equal(agentGated(["payouts"]), false);
  assert.equal(agentGated([]), false);
});

test("agent: rerun is wv with --yes, never whop, and never a second --yes or a --plan", () => {
  assert.deepEqual(rerunFor(["payouts", "create", "--amount", "5"]), ["wv", "payouts", "create", "--amount", "5", "--yes"]);
  assert.deepEqual(rerunFor(["ads", "create", "--plan", "--yes"]), ["wv", "ads", "create", "--yes"]);
});

test("agent: the money plan is the card as data, hints and timeout left out", () => {
  const plan = moneyPlan({ group: "payouts", verb: "create", argv: ["payouts", "create", "--amount", "250", "--payout_method_id", "potk_1"], hints: hintsFor("payouts", "create"), accountId: "biz_1", accountTitle: "Frame", cap: 500, timeoutSeconds: 120, balance: { available: 18.56, currency: "usd" } });
  assert.deepEqual(plan.money, { amount: 250, currency: "usd" });
  assert.deepEqual(plan.flags, { amount: 250, payout_method_id: "potk_1" });
  assert.equal(plan.command, "whop payouts create --amount 250 --payout_method_id potk_1");
  assert.equal("hints" in plan, false);
  assert.equal("timeoutSeconds" in plan, false);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(plan)));
});

test("agent: the error code is read from json, toon, and the --full-output envelope alike", () => {
  assert.equal(errorCodeIn(fixture("error.typo.json")), "COMMAND_NOT_FOUND");
  assert.equal(errorCodeIn(fixture("error.validation.json")), "VALIDATION_ERROR");
  assert.equal(errorCodeIn(fixture("error.gated.json")), "HTTP_403");
  assert.equal(errorCodeIn('{"code":"HTTP_404","message":"Product not found"}'), "HTTP_404");
  assert.equal(errorCodeIn("code: VALIDATION_ERROR\nmessage: bad\n"), "VALIDATION_ERROR");
  assert.equal(errorCodeIn("ok: false\nerror:\n  code: HTTP_403\n  message: no\n"), "HTTP_403");
  assert.equal(errorCodeIn(fixture("products.list.plain.txt")), undefined, "a page carries no error code");
  assert.equal(errorCodeIn("fieldErrors[1]{code,missing}:\n  invalid_type,true"), undefined, "a field error's lowercase code is not the envelope's");
});

test("agent: exit codes map, success and WV_EXIT=whop keep whop's status", () => {
  assert.equal(agentExitCode(1, fixture("error.validation.json"), {}), 3);
  assert.equal(agentExitCode(1, fixture("error.gated.json"), {}), 4);
  assert.equal(agentExitCode(1, fixture("error.typo.json"), {}), 5);
  assert.equal(agentExitCode(1, fixture("error.404.json"), {}), 5);
  assert.equal(agentExitCode(1, '{"code":"UNKNOWN","message":"Unknown flag: --dry-run"}', {}), 1);
  assert.equal(agentExitCode(0, fixture("products.list.plain.txt"), {}), 0);
  assert.equal(agentExitCode(1, fixture("error.gated.json"), { WV_EXIT: "whop" }), 1);
  assert.equal(agentExitCode(127, "", {}), 127);
  assert.deepEqual(Object.values(EXIT_CODES).filter((c) => c < 3 || c > 5), [], "wv's codes stay in 3..5; 2 is the gate");
});

test("status: the verbs whop itself tags for confirmation are writes; compute-only POSTs are not", () => {
  for (const [g, v] of [["payments", "refund"], ["payments", "capture"], ["payments", "void"], ["audiences", "add_people"], ["social-accounts", "connect"], ["promo-codes", "deactivate"], ["disputes", "upload_evidence"], ["resolution-center-cases", "accept"], ["webhooks", "deliveries-replay"], ["media", "generate"], ["accounts", "suspend"], ["apps", "permissions"]])
    assert.equal(isWrite(g, v), true, `${g} ${v}`);
  for (const [g, v] of [["ad-groups", "estimate_reach"], ["events", "validate_pixel"], ["plans", "calculate_tax"], ["payouts", "quotes"], ["webhooks", "test"], ["people", "list"]])
    assert.equal(isWrite(g, v), false, `${g} ${v}`);
});

const LLMS = `# whop

## whop products

### whop products frobnicate

Frobnicate Product

#### Options

| Flag | Type |
|---|---|

> Confirm with the user before executing this destructive command.

### whop products list

List Products

## whop ad-groups

### whop ad-groups estimate_reach

> Confirm with the user before executing this destructive command.
`;

test("status: whop's tag is parsed per command, and loading it widens isWrite without narrowing it", () => {
  assert.deepEqual([...taggedWrites(LLMS)].sort(), ["ad-groups estimate_reach", "products frobnicate"]);
  assert.equal(isWrite("products", "frobnicate"), false, "unknown to the hand list");
  loadWhopWrites(LLMS);
  try {
    assert.equal(isWrite("products", "frobnicate"), true, "whop's tag gates it");
    assert.equal(isWrite("products", "list"), false);
    assert.equal(isWrite("products", "update"), true, "the hand list still applies");
    assert.equal(isWrite("ad-groups", "estimate_reach"), false, "compute-only wins over the tag");
  } finally {
    loadWhopWrites(null);
  }
  assert.equal(isWrite("products", "frobnicate"), false);
  assert.equal(taggedWrites("").size, 0);
});

test("idempotency: minted once from the schema, never twice, never where the schema has none", () => {
  const schema = JSON.parse(fixture("schema.payouts.create.json"));
  assert.equal(takesIdempotency(schema), true);
  assert.equal(takesIdempotency(JSON.parse(fixture("schema.payouts.list.json"))), false);
  assert.equal(takesIdempotency(null), false);
  const argv = ["payouts", "create", "--amount", "5"];
  assert.deepEqual(withIdempotencyKey(argv, schema, "k1"), [...argv, "--idempotency-key", "k1"]);
  assert.deepEqual(withIdempotencyKey([...argv, "--idempotency-key", "mine"], schema, "k1"), [...argv, "--idempotency-key", "mine"]);
  assert.deepEqual(withIdempotencyKey([...argv, "--idempotency-key=mine"], schema, "k1"), [...argv, "--idempotency-key=mine"]);
  assert.deepEqual(withIdempotencyKey(argv, null, "k1"), argv);
  assert.match(withIdempotencyKey(argv, schema).at(-1) ?? "", /^[0-9a-f-]{36}$/, "a real key is a uuid");
  assert.equal(hasIdempotencyKey(argv), false);
});

test("live: every command whop tags for confirmation is a write here, or is named compute-only", { skip: !process.env.WV_LIVE }, () => {
  const text = spawnSync("whop", ["--llms-full"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).stdout;
  const tagged = taggedWrites(text);
  assert.ok(tagged.size > 100, `parsed ${tagged.size} tagged commands`);
  loadWhopWrites(text);
  try {
    for (const key of tagged) {
      const [g, v] = key.split(" ");
      assert.equal(isWrite(g, v) || COMPUTE_ONLY.has(key), true, `${key} is tagged by whop and gated by neither list`);
    }
    // The hand list is not dead weight: every entry the CLI still has is tagged, or is a wv verb (`login`, `switch`).
    const hand = [...tagged].filter((k) => WRITE_VERBS.has(k.split(" ")[1]));
    assert.ok(hand.length > 50);
  } finally {
    loadWhopWrites(null);
  }
});

test("changes: flags against the record, implied statuses, a delete as one row, scope flags ignored", () => {
  const p = envelope("products.get");
  const rec = p.ok && "record" in p.payload ? p.payload.record : {};
  assert.deepEqual(changesFor("update", ["products", "update", "prod_1", "--title", "New", "--account_id", "biz_1", "--idempotency-key", "k", "--metadata", '{"a":1}'], rec), [
    { key: "title", before: "Hypermotion", after: "New", changed: true },
    { key: "metadata", before: rec.metadata, after: { a: 1 }, changed: JSON.stringify(rec.metadata ?? null) !== '{"a":1}' },
  ]);
  assert.deepEqual(changesFor("publish", ["products", "publish", "prod_1"], rec), [{ key: "visibility", before: "visible", after: "visible", changed: false }]);
  assert.deepEqual(changesFor("pause", ["memberships", "pause", "mem_1"], { id: "mem_1", status: "active" }), [{ key: "status", before: "active", after: "paused", changed: true }]);
  assert.deepEqual(changesFor("pause", ["x", "pause", "id"], { id: "id" }), [], "no status field, nothing implied");
  assert.deepEqual(changesFor("extend", ["memberships", "extend", "mem_1", "--days", "7"], { id: "mem_1", status: "active", current_period_end: "2026-09-14T23:26:52.000Z" }), [
    { key: "current_period_end", before: "2026-09-14T23:26:52.000Z", after: "2026-09-21T23:26:52.000Z", changed: true },
  ], "extend moves the period end; days is not a field");
  assert.deepEqual(changesFor("extend", ["memberships", "extend", "mem_1", "--days", "7"], { id: "mem_1", status: "active" }), [{ key: "days", before: undefined, after: 7, changed: true }], "no period end on the record: the flag stands");
  const del = changesFor("delete", ["products", "delete", "prod_1"], rec);
  assert.equal(del.length, 1);
  assert.equal(del[0].before, "Hypermotion  prod_iQ2Zub6GFQS5Q");
  assert.equal(describeRecord({ id: "x_1" }), "x_1");
  assert.equal(describeRecord({ code: "LAUNCH20", id: "promo_1" }), "LAUNCH20  promo_1");
  assert.deepEqual(currentSummary(rec), { id: "prod_iQ2Zub6GFQS5Q", title: "Hypermotion", visibility: "visible" });
});
