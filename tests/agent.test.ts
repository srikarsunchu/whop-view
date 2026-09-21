// The agent face's pure parts: what is gated, the rerun, the plan shapes, and the exit code map.
import { test } from "node:test";
import assert from "node:assert/strict";
import { agentExitCode, agentGated, errorCodeIn, EXIT_CODES, moneyPlan, rerunFor } from "../src/agent.ts";
import { hintsFor } from "../src/hints.ts";
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
