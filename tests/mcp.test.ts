// `wv --mcp`: the agent face over JSON-RPC on stdio. Hermetic like the pipe tests: the fake `whop` on PATH,
// no real config, a fresh cache. The gate is the same code the pipe runs; these tests prove the transport
// carries it: a write is a plan first, the rerun runs it, a read tool cannot smuggle consent, and the
// server drains in-flight calls before it exits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURES } from "./render.ts";
import { argvFor, consented, elicitParamsFor, handle, mcpAddArgv, planMessage, toolResult, TOOLS, type ElicitResult, type ToolResult } from "../src/mcp.ts";
import { spawnSync } from "node:child_process";

const bin = join(import.meta.dirname, "..", "src", "bin.ts");

function fakeWhop(): string {
  const dir = mkdtempSync(join(tmpdir(), "wv-fake-"));
  const script = join(dir, "whop");
  writeFileSync(script, readFileSync(join(import.meta.dirname, "fake-whop.sh"), "utf8").split("${WV_FAKE_FIXTURES}").join(FIXTURES));
  chmodSync(script, 0o755);
  return script;
}

const gateEnv = (extra: NodeJS.ProcessEnv = {}) => ({ WV_WHOP_BIN: fakeWhop(), WHOP_API_BASE_URL: "", WHOP_API_KEY: "", WV_PAYOUT_CAP: "", WV_AD_CAP: "", WV_RAW: "", WV_APPROVE_SECRET: "test-secret", ...extra });

interface Rpc {
  id?: number;
  method: string;
  params?: unknown;
}

type Served = { byId: Map<number, { result?: ToolResult & Record<string, unknown>; error?: { code: number; message: string } }>; argv: string[]; status: number | null; asked: { message: string; requestedSchema: { properties: Record<string, unknown>; required?: string[] } }[] };

/**
 * Starts `wv --mcp`, sends every message, and returns the responses by id plus whop's argv log. With `person`,
 * the client declares elicitation and answers each `elicitation/create` the server sends with what the person
 * would have done; stdin closes once every request has been answered. Without it, stdin closes at once.
 */
function serve(messages: Rpc[], env: NodeJS.ProcessEnv = {}, person?: (params: { message: string; requestedSchema: { properties: Record<string, unknown> } }) => ElicitResult): Promise<Served> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", bin, "--mcp"], {
      env: { ...process.env, WV_CONFIG: "/nonexistent/wv.json", XDG_CACHE_HOME: mkdtempSync(join(tmpdir(), "wv-cache-")), WV_SANDBOX_KEY: "", WV_SANDBOX_URL: "", WV_SANDBOX: "", ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    let buffered = "";
    const asked: Served["asked"] = [];
    const expected = new Set(messages.filter((m) => m.id !== undefined).map((m) => m.id as number));
    child.stderr.on("data", (d) => (err += d));
    child.stdout.on("data", (d) => {
      out += d;
      if (!person) return;
      buffered += d;
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const j = JSON.parse(line) as { id?: number; method?: string; params?: Served["asked"][number] };
        if (j.method === "elicitation/create" && j.params) {
          asked.push(j.params);
          child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: j.id, result: person(j.params) }) + "\n");
        } else if (j.id !== undefined) {
          expected.delete(j.id);
          if (expected.size === 0) child.stdin.end();
        }
      }
    });
    for (const m of messages) child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
    if (!person) child.stdin.end();
    child.on("close", (status) => {
      const byId = new Map<number, { result?: ToolResult & Record<string, unknown>; error?: { code: number; message: string } }>();
      for (const line of out.split("\n")) {
        if (!line.trim()) continue;
        const j = JSON.parse(line) as { id: number; method?: string; result?: ToolResult & Record<string, unknown>; error?: { code: number; message: string } };
        if (j.method === undefined) byId.set(j.id, j);
      }
      resolve({ byId, argv: err.split("\n").filter((l) => l.startsWith("ARGS: ")).map((l) => l.slice(6)), status, asked });
    });
  });
}

const init: Rpc = { id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } };
const initElicit: Rpc = { id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: { elicitation: {} }, clientInfo: { name: "test", version: "0" } } };
const call = (id: number, name: string, args: Record<string, unknown>): Rpc => ({ id, method: "tools/call", params: { name, arguments: args } });
const structured = (r: { result?: ToolResult }) => r.result?.structuredContent as { ok: boolean; error?: { code: string }; plan?: Record<string, unknown>; rerun?: string[]; meta?: Record<string, unknown> } | undefined;

test("mcp: initialize answers the asked version, names the server, and lists four tools with schemas", async () => {
  const { byId, status } = await serve([init, { method: "notifications/initialized" }, { id: 2, method: "tools/list" }, { id: 3, method: "ping" }, { id: 4, method: "nope/nothing" }], gateEnv());
  assert.equal(status, 0);
  const i = byId.get(1)!.result as unknown as { protocolVersion: string; serverInfo: { name: string }; capabilities: { tools: object }; instructions: string };
  assert.equal(i.protocolVersion, "2025-06-18");
  assert.equal(i.serverInfo.name, "wv");
  assert.ok(i.capabilities.tools);
  assert.match(i.instructions, /rerun/);
  const tools = (byId.get(2)!.result as unknown as { tools: { name: string; inputSchema: { type: string } }[] }).tools;
  assert.deepEqual(tools.map((t) => t.name), ["wv_manifest", "wv_read", "wv_screen", "wv_write"]);
  assert.ok(tools.every((t) => t.inputSchema.type === "object"));
  assert.deepEqual(byId.get(3)!.result, {});
  assert.equal(byId.get(4)!.error?.code, -32601);
});

test("mcp: every tool is one wv argv underneath", () => {
  assert.deepEqual(argvFor("wv_manifest", {}), ["agent"]);
  assert.deepEqual(argvFor("wv_manifest", { group: "payouts", format: "json" }), ["agent", "payouts", "--format", "json"]);
  assert.deepEqual(argvFor("wv_read", { argv: ["products", "list"] }), ["products", "list", "--format", "json", "--full-output"]);
  assert.deepEqual(argvFor("wv_read", { argv: ["products", "list", "--format", "toon"], all: true, sandbox: true }), ["--sandbox", "products", "list", "--format", "toon", "--all"]);
  assert.deepEqual(argvFor("wv_screen", { screen: "support lookup", args: ["mem_1"] }), ["support", "lookup", "mem_1"]);
  assert.deepEqual(argvFor("wv_screen", { screen: "report", markdown: true }), ["report", "--md"]);
  assert.deepEqual(argvFor("wv_write", { argv: ["wv", "payouts", "create", "--amount", "5"], plan: true }), ["payouts", "create", "--amount", "5", "--plan"]);
  assert.throws(() => argvFor("wv_nope", {}), /Unknown tool/);
  assert.equal(TOOLS.length, 4);
});

test("mcp: a result is the bytes as text, one JSON object as structured content, and an error only when it is one", () => {
  const plan = toolResult(JSON.stringify({ ok: false, error: { code: "CONFIRMATION_REQUIRED" }, rerun: ["wv", "x"] }) + "\n", 2);
  assert.equal(plan.isError, undefined, "a plan waiting for consent is not an error");
  assert.equal(plan.structuredContent?.ok, false);
  const refused = toolResult(JSON.stringify({ ok: false, error: { code: "WV_CAP" } }), 2);
  assert.equal(refused.isError, true);
  const screen = toolResult(JSON.stringify({ ok: false, blocking: ["identity"] }), 1);
  assert.equal(screen.isError, undefined, "a business that is not set up is data");
  const rows = toolResult('{"a":1}\n{"a":2}\n', 0);
  assert.equal(rows.structuredContent, undefined, "jsonl is text, not one object");
  assert.equal(rows.content[0].text, '{"a":1}\n{"a":2}');
  assert.equal(toolResult("wv: could not run whop\n", 127).isError, true);
});

test("mcp: a write is a plan first, whop never runs it, and the rerun runs it exactly once as planned", async () => {
  const env = gateEnv();
  const first = await serve([init, call(2, "wv_write", { argv: ["products", "update", "prod_1", "--title", "Frame Pro"] })], env);
  const e = structured(first.byId.get(2)!)!;
  assert.equal(first.byId.get(2)!.result?.isError, undefined);
  assert.equal(e.ok, false);
  assert.equal(e.error?.code, "CONFIRMATION_REQUIRED");
  assert.equal(e.plan?.kind, "write");
  assert.deepEqual(e.rerun?.slice(0, 6), ["wv", "products", "update", "prod_1", "--title", "Frame Pro"]);
  assert.equal(e.rerun?.at(-2), "--approve");
  assert.ok(first.argv.some((a) => a.startsWith("auth status")), "identity is read for the card");
  assert.ok(!first.argv.some((a) => a.startsWith("products update")), "the write must not reach whop");
  // The rerun, as given, with its leading `wv`.
  const ran = await serve([init, call(2, "wv_write", { argv: e.rerun })], env);
  assert.ok(ran.argv.includes("products update prod_1 --title Frame Pro"), "neither --approve nor its token reach whop");
  assert.match(ran.byId.get(2)!.result!.content[0].text, /fake_1/);
  // The same token on an edited command is refused, and is an error.
  const edited = await serve([init, call(2, "wv_write", { argv: e.rerun!.map((a) => (a === "Frame Pro" ? "Frame Ultra" : a)) })], env);
  assert.equal(structured(edited.byId.get(2)!)?.error?.code, "APPROVAL_INVALID");
  assert.equal(edited.byId.get(2)!.result?.isError, true);
  assert.ok(!edited.argv.some((a) => a.startsWith("products update")));
});

test("mcp: plan is the plan alone with no rerun, and a refusal is an error with no rerun", async () => {
  const env = gateEnv();
  const { byId, argv } = await serve([init, call(2, "wv_write", { argv: ["payouts", "create", "--amount", "5", "--payout_method_id", "potk_1"], plan: true }), call(3, "wv_write", { argv: ["payouts", "create", "--amount", "5000", "--payout_method_id", "potk_1"] })], env);
  const plan = structured(byId.get(2)!)!;
  assert.equal(plan.ok, true);
  assert.equal(plan.rerun, undefined);
  assert.equal(plan.plan?.kind, "write");
  const refused = structured(byId.get(3)!)!;
  assert.equal(refused.ok, false);
  assert.equal(refused.rerun, undefined);
  assert.equal(byId.get(3)!.result?.isError, true);
  assert.ok(!argv.some((a) => a.startsWith("payouts create")), "no payout reached whop");
});

test("mcp: the read tool returns whop's envelope and refuses a write even with consent flags in its argv", async () => {
  const env = gateEnv();
  const { byId, argv } = await serve([init, call(2, "wv_read", { argv: ["products", "list"] }), call(3, "wv_read", { argv: ["products", "update", "prod_1", "--title", "x", "--yes"] }), call(4, "wv_read", { argv: ["products", "update", "prod_1", "--title", "x", "--approve", "1.deadbeef"] })], env);
  assert.ok(argv.includes("products list --format json --full-output"));
  assert.equal(structured(byId.get(2)!)?.ok, true);
  for (const id of [3, 4]) {
    assert.equal(byId.get(id)!.result?.isError, true);
    assert.match(byId.get(id)!.result!.content[0].text, /is a write/);
  }
  assert.ok(!argv.some((a) => a.startsWith("products update")), "a read tool never writes");
});

test("mcp: a screen is data with wv's meta, and a recipe plans through the write tool", async () => {
  const env = gateEnv({ WV_FAKE_READY: "1" });
  const { byId, argv } = await serve([init, call(2, "wv_screen", { screen: "doctor" }), call(3, "wv_write", { argv: ["dev", "hook", "https://example.com/hooks", "--events", "payment.succeeded"], plan: true })], env);
  const doctor = structured(byId.get(2)!)!;
  assert.deepEqual(doctor.meta, { command: "doctor", wrapper: "wv", mode: "production" });
  assert.ok(Array.isArray((doctor as unknown as { checks: unknown[] }).checks));
  const hook = structured(byId.get(3)!)!;
  assert.equal(hook.ok, true);
  assert.equal(hook.plan?.kind, "hook");
  assert.ok(!argv.some((a) => a.startsWith("webhooks create")), "plan only");
});

test("mcp: a parse error and an unknown tool answer in protocol, and handle is pure enough to call directly", async () => {
  const unknown = JSON.parse((await handle({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "wv_nope", arguments: {} } }))!) as { result: ToolResult };
  assert.equal(unknown.result.isError, true);
  assert.equal(await handle({ jsonrpc: "2.0", method: "notifications/cancelled" }), undefined);
});

// Elicitation: when the client can ask the person, the server does, and the model never holds the approval.

test("mcp elicitation: a yes from the person runs the write in the same call; the model never sees a rerun", async () => {
  const env = gateEnv();
  const r = await serve([initElicit, call(2, "wv_write", { argv: ["products", "update", "prod_1", "--title", "Frame Pro"] })], env, () => ({ action: "accept", content: { approve: true } }));
  assert.equal(r.asked.length, 1, "one question was asked");
  assert.match(r.asked[0].message, /whop products update prod_1 --title 'Frame Pro'/);
  assert.match(r.asked[0].message, /production/);
  assert.deepEqual(r.asked[0].requestedSchema.required, ["approve"]);
  assert.ok(r.argv.includes("products update prod_1 --title Frame Pro"), "the write ran, with no wv flags in whop's argv");
  const result = r.byId.get(2)!.result!;
  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text, /fake_1/, "the tool's answer is whop's answer to the write");
  assert.equal(structured(r.byId.get(2)!)?.rerun, undefined);
});

test("mcp elicitation: a no, a dismissed prompt, or a wrong amount runs nothing and comes back with no rerun", async () => {
  const env = gateEnv();
  const write = call(2, "wv_write", { argv: ["products", "update", "prod_1", "--title", "Frame Pro"] });
  for (const [answer, code] of [
    [{ action: "decline" }, /said no/],
    [{ action: "cancel" }, /dismissed/],
    [{ action: "accept", content: { approve: false } }, /said no/],
  ] as [ElicitResult, RegExp][]) {
    const r = await serve([initElicit, write], env, () => answer);
    const e = structured(r.byId.get(2)!)!;
    assert.equal(e.error?.code, "DECLINED");
    assert.match((e.error as { message: string }).message, code);
    assert.equal(e.rerun, undefined, "no rerun after a no");
    assert.equal(e.plan?.kind, "write", "the plan is still there for the model to report");
    assert.equal(r.byId.get(2)!.result?.isError, true);
    assert.ok(!r.argv.some((a) => a.startsWith("products update")), "nothing ran");
  }
});

test("mcp elicitation: money asks for the amount typed back, and y is not consent for a payout", async () => {
  const env = gateEnv({ WV_FAKE_METHODS: "payouts.methods.json" });
  const payout = call(2, "wv_write", { argv: ["payouts", "create", "--amount", "5", "--payout_method_id", "potk_1"] });
  const wrong = await serve([initElicit, payout], env, () => ({ action: "accept", content: { amount: "50" } }));
  assert.deepEqual(wrong.asked[0].requestedSchema.required, ["amount"]);
  assert.match(wrong.asked[0].message, /moves real money/);
  assert.match(structured(wrong.byId.get(2)!)!.error!.code, /DECLINED/);
  assert.match((structured(wrong.byId.get(2)!)!.error as { message: string }).message, /did not match/);
  assert.ok(!wrong.argv.some((a) => a.startsWith("payouts create")), "a wrong amount sends nothing");
  const right = await serve([initElicit, payout], env, () => ({ action: "accept", content: { amount: "$5.00" } }));
  assert.ok(right.argv.some((a) => a.startsWith("payouts create --amount 5 --payout_method_id potk_1")), "the exact amount, however written, sends it");
  assert.equal(right.byId.get(2)!.result?.isError, undefined);
});

test("mcp elicitation: a client that did not declare it gets the plan and the rerun, as in the pipe", async () => {
  const env = gateEnv();
  const r = await serve([init, call(2, "wv_write", { argv: ["products", "update", "prod_1", "--title", "Frame Pro"] })], env, () => ({ action: "accept", content: { approve: true } }));
  assert.equal(r.asked.length, 0, "nothing was asked");
  assert.equal(structured(r.byId.get(2)!)?.error?.code, "CONFIRMATION_REQUIRED");
  assert.ok(Array.isArray(structured(r.byId.get(2)!)?.rerun));
});

test("mcp elicitation: plan only never asks, and the sandbox asks for a yes, not an amount", async () => {
  const env = gateEnv({ WV_SANDBOX_KEY: "whop_test" });
  const planned = await serve([initElicit, call(2, "wv_write", { argv: ["products", "update", "prod_1", "--title", "x"], plan: true })], env, () => ({ action: "accept", content: { approve: true } }));
  assert.equal(planned.asked.length, 0);
  assert.equal(structured(planned.byId.get(2)!)?.ok, true);
  const sandbox = await serve([initElicit, call(2, "wv_write", { argv: ["payouts", "create", "--amount", "5", "--payout_method_id", "potk_1"], sandbox: true })], env, () => ({ action: "accept", content: { approve: true } }));
  assert.deepEqual(sandbox.asked[0].requestedSchema.required, ["approve"]);
  assert.match(sandbox.asked[0].message, /sandbox/);
  assert.ok(sandbox.argv.some((a) => a.startsWith("payouts create")));
});

test("mcp elicitation: the question and the consent rule, as pure functions", () => {
  const plan = { kind: "write", command: "whop payouts create --amount 250", money: { amount: 250, currency: "usd" }, destination: "Chase ••4421", account: { title: "Frame", id: "biz_1" } };
  const q = elicitParamsFor(plan, "production");
  assert.match(q.message, /\$250\.00 to Chase/);
  assert.match(q.message, /Account: Frame \(biz_1\)/);
  assert.deepEqual(q.requestedSchema.required, ["amount"]);
  assert.equal(consented(plan, "production", { action: "accept", content: { amount: "250" } }), true);
  assert.equal(consented(plan, "production", { action: "accept", content: { amount: "250.01" } }), false);
  assert.equal(consented(plan, "production", { action: "accept", content: { approve: true } }), false, "a yes is not an amount");
  assert.equal(consented(plan, "sandbox", { action: "accept", content: { approve: true } }), true);
  const recipe = { kind: "hook", command: "wv dev hook https://x", steps: [{ key: "create", label: "Create the webhook", command: "whop webhooks create --url https://x" }, { key: "skip", label: "Skipped", command: "x", skipped: true }], changes: [], warnings: ["The account is on an OAuth login."] };
  const m = planMessage(recipe, "production");
  assert.match(m, /Steps:\n  Create the webhook: whop webhooks create/);
  assert.doesNotMatch(m, /Skipped/);
  assert.match(m, /Warning: The account is on an OAuth login/);
  assert.equal(consented(recipe, "production", { action: "decline" }), false);
});

// `wv mcp add` and `wv mcp doctor`: registration through whop's installer, and the startup path a client takes.

test("mcp add: whop's installer is told to run wv, and a --command the person gave wins", () => {
  assert.deepEqual(mcpAddArgv([]), ["mcp", "add", "--command", "wv --mcp"]);
  assert.deepEqual(mcpAddArgv(["--agent", "claude-code", "--no-global"]), ["mcp", "add", "--command", "wv --mcp", "--agent", "claude-code", "--no-global"]);
  assert.deepEqual(mcpAddArgv(["--command", "pnpm wv --mcp"]), ["mcp", "add", "--command", "pnpm wv --mcp"]);
  assert.deepEqual(mcpAddArgv(["-c", "x"]), ["mcp", "add", "-c", "x"]);
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", bin, "mcp", "add", "--agent", "cursor"], { encoding: "utf8", env: { ...process.env, ...gateEnv(), WV_CONFIG: "/nonexistent/wv.json", WV_SANDBOX: "", WV_SANDBOX_KEY: "" } });
  assert.match(r.stderr, /^ARGS: mcp add --command wv --mcp --agent cursor$/m, "whop's own mcp add runs, with wv's command");
});

test("mcp doctor: starts the server, lists its tools, and answers JSON in a pipe", () => {
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", bin, "mcp", "doctor"], { encoding: "utf8", env: { ...process.env, ...gateEnv(), WV_CONFIG: "/nonexistent/wv.json", WV_SANDBOX: "", WV_SANDBOX_KEY: "" } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const d = JSON.parse(r.stdout) as { ok: boolean; toolCount: number; tools: { name: string }[]; server: { name: string; protocolVersion: string }; command: string; meta: { command: string } };
  assert.equal(d.ok, true);
  assert.equal(d.toolCount, 4);
  assert.deepEqual(d.tools.map((t) => t.name), TOOLS.map((t) => t.name));
  assert.equal(d.server.name, "wv");
  assert.equal(d.command, "wv --mcp");
  assert.deepEqual(d.meta, { command: "mcp doctor", wrapper: "wv", mode: "production" });
});
