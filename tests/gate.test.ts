// The money gate's pure parts: quoting, the cap and timeout settings, the prompt's clock, and sandbox env.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { shellJoin, shellQuote, teach } from "../src/argv.ts";
import { capFrom, timeoutFrom, DEFAULT_CAP, DEFAULT_TIMEOUT_SECONDS } from "../src/bin.ts";
import { prompt } from "../src/primitives/prompt.ts";
import { amountMatcher, describeMethod, limitFor, moneyOf, speedOf } from "../src/views/confirm.ts";
import { withAfter } from "../src/views/list.ts";
import { parseEnvelope } from "../src/envelope.ts";
import { modeFrom, whopEnv, SANDBOX_URL } from "../src/runner.ts";
import { theme } from "./render.ts";

test("argv: quoting happens once, only when needed, and placeholders stay bare", () => {
  assert.equal(shellQuote("prod_DQf7IZAtveRoK"), "prod_DQf7IZAtveRoK");
  assert.equal(shellQuote("title,visibility,created_at"), "title,visibility,created_at");
  assert.equal(shellQuote("<biz_id>"), "<biz_id>");
  assert.equal(shellQuote("Frame Pro"), "'Frame Pro'");
  assert.equal(shellQuote("Frame Pro's \"beta\""), "'Frame Pro'\\''s \"beta\"'");
  assert.equal(shellQuote("one; two && $(three)"), "'one; two && $(three)'");
  assert.equal(shellQuote(""), "''");
  assert.equal(shellJoin(["whop", "products", "update", "prod_1", "--title", "Frame Pro"]), "whop products update prod_1 --title 'Frame Pro'");
  assert.deepEqual(teach(["products", "list"], "--filter-output", "id"), ["whop", "products", "list", "--format", "json", "--filter-output", "id"]);
});

test("cap: default $500, dollars from the env, none turns it off, junk falls back", () => {
  assert.equal(capFrom({}), DEFAULT_CAP);
  assert.equal(capFrom({ WV_PAYOUT_CAP: "2000" }), 2000);
  assert.equal(capFrom({ WV_PAYOUT_CAP: "none" }), null);
  assert.equal(capFrom({ WV_PAYOUT_CAP: "0" }), null);
  assert.equal(capFrom({ WV_PAYOUT_CAP: "lots" }), DEFAULT_CAP);
  assert.equal(capFrom({ WV_PAYOUT_CAP: "-5" }), DEFAULT_CAP);
});

test("timeout: default two minutes, seconds from the env, none waits", () => {
  assert.equal(timeoutFrom({}), DEFAULT_TIMEOUT_SECONDS);
  assert.equal(timeoutFrom({ WV_CONFIRM_TIMEOUT: "30" }), 30);
  assert.equal(timeoutFrom({ WV_CONFIRM_TIMEOUT: "none" }), undefined);
  assert.equal(timeoutFrom({ WV_CONFIRM_TIMEOUT: "0" }), undefined);
});

test("money: amount and currency come from the flags, currency defaults to usd", () => {
  assert.deepEqual(moneyOf(["payouts", "create", "--amount", "250", "--payout_method_id", "potk_1"]), { amount: 250, currency: "usd" });
  assert.deepEqual(moneyOf(["payouts", "create", "--amount", "12.5", "--currency", "CAD"]), { amount: 12.5, currency: "cad" });
  assert.equal(moneyOf(["payouts", "cancel", "pout_1"]), null);
});

test("destination: nickname, else institution, else category; the masked reference as sent; else the id", () => {
  assert.equal(describeMethod({ id: "potk_1", nickname: "Chase checking", institution_name: "JPMorgan Chase", account_reference: "••••4242" }, "potk_1"), "Chase checking ••••4242  potk_1");
  assert.equal(describeMethod({ id: "potk_1", institution_name: "Chase", account_reference: null }, "potk_1"), "Chase  potk_1");
  assert.equal(describeMethod({ id: "potk_1", destination: { category: "digital_wallet", name: "S. Sunchu" }, account_reference: "s***@elide.dev" }, "potk_1"), "digital wallet s***@elide.dev  potk_1");
  assert.equal(describeMethod({ id: "potk_1" }, "potk_1"), "potk_1");
  assert.equal(describeMethod(undefined, "potk_1"), "potk_1");
});

test("prompt: a prompt left sitting answers timeout, not yes", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  output.resume();
  const answer = await prompt("Run it?", theme(80, false), { input, output, timeoutMs: 20 });
  assert.equal(answer, "timeout");
});

test("prompt: y is yes, anything else is no, and no timeout means it waits for the line", async () => {
  const ask = (line: string) => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();
    const p = prompt("Run it?", theme(80, false), { input, output });
    input.write(line + "\n");
    return p;
  };
  assert.equal(await ask("y"), "yes");
  assert.equal(await ask("YES"), "yes");
  assert.equal(await ask("n"), "no");
  assert.equal(await ask(""), "no");
});

test("sandbox: the flag or WV_SANDBOX picks the mode; the env points whop at the sandbox host and key", () => {
  assert.equal(modeFrom(false, {}), "production");
  assert.equal(modeFrom(true, {}), "sandbox");
  assert.equal(modeFrom(false, { WV_SANDBOX: "1" }), "sandbox");
  assert.equal(modeFrom(false, { WV_SANDBOX: "0" }), "production");
  const base = { PATH: "/bin", WHOP_API_KEY: "whop_live" };
  assert.deepEqual(whopEnv("production", base), base);
  assert.deepEqual(whopEnv("sandbox", base), { ...base, WHOP_API_BASE_URL: SANDBOX_URL });
  assert.deepEqual(whopEnv("sandbox", { ...base, WV_SANDBOX_KEY: "whop_test", WV_SANDBOX_URL: "http://localhost:9" }), { ...base, WV_SANDBOX_KEY: "whop_test", WV_SANDBOX_URL: "http://localhost:9", WHOP_API_BASE_URL: "http://localhost:9", WHOP_API_KEY: "whop_test" });
});

test("typed amount: the amount in any common spelling is yes, y is not", () => {
  const ok = amountMatcher(10);
  for (const a of ["10", "10.00", "$10", "$10.00", " 10 "]) assert.equal(ok(a), true, a);
  for (const a of ["y", "yes", "1", "100", "10.01", ""]) assert.equal(ok(a), false, a);
  assert.equal(amountMatcher(1234.5)("$1,234.50"), true);
});

test("whop limits: picked by speed, blocks carry the code and message, missing scope is undefined", () => {
  const limits = { object: "payout_limit", currency: "usd", standard: { max_amount: 0, error_code: "kyc_completed", error_message: "Please complete identity verification before requesting a withdrawal." }, instant: { max_amount: 250, daily_amount_remaining: 9999 } };
  assert.deepEqual(limitFor(limits, "standard"), { speed: "standard", max: 0, code: "kyc_completed", message: "Please complete identity verification before requesting a withdrawal.", dailyRemaining: undefined });
  assert.deepEqual(limitFor(limits, "instant"), { speed: "instant", max: 250, code: undefined, message: undefined, dailyRemaining: 9999 });
  assert.equal(limitFor(undefined, "standard"), undefined);
  assert.equal(limitFor({}, "standard"), undefined);
  assert.equal(speedOf(["payouts", "create", "--speed", "instant"]), "instant");
  assert.equal(speedOf(["payouts", "create"]), "standard");
});

test("envelope: siblings of a page survive as extra, so limits reach the gate", () => {
  const p = parseEnvelope(JSON.stringify({ data: [], page_info: { start_cursor: null, end_cursor: null, has_next_page: false, has_previous_page: false }, limits: { standard: { max_amount: 5 } }, recommended_action: "x" }));
  assert.ok(p.ok && p.payload.kind === "page");
  assert.deepEqual(p.payload.extra, { limits: { standard: { max_amount: 5 } } });
  const plain = parseEnvelope(JSON.stringify({ data: [], page_info: { start_cursor: null, end_cursor: null, has_next_page: false, has_previous_page: false } }));
  assert.ok(plain.ok && plain.payload.kind === "page" && plain.payload.extra === undefined);
});

test("next page: --after is appended or replaced, never doubled", () => {
  assert.deepEqual(withAfter(["products", "list"], "c2"), ["products", "list", "--after", "c2"]);
  assert.deepEqual(withAfter(["products", "list", "--after", "c1", "--first", "5"], "c2"), ["products", "list", "--after", "c2", "--first", "5"]);
  assert.deepEqual(withAfter(["products", "list", "--after=c1"], "c2"), ["products", "list", "--after", "c2"]);
});
