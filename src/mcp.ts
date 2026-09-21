// `wv --mcp`: the agent face as a Model Context Protocol server on stdio. The same gate and the same envelopes
// the pipe gives, reached as tools instead of argv, so a client that never opens a terminal (Claude desktop,
// Cursor, claude.ai) gets the plan step before a write. JSON-RPC 2.0, one message per line, no dependency:
// initialize, ping, tools/list, tools/call are the whole protocol this server needs.
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { agentReply, ownFlags, type AgentReply } from "./bin.ts";
import { agentExitCode, agentGated, serialize, type AgentEnvelope } from "./agent.ts";
import { cachedLlmsFull, modeFrom, runBuffered, whopEnv, type Mode } from "./runner.ts";
import { loadWhopWrites } from "./status.ts";
import { amountMatcher } from "./views/confirm.ts";
import { money } from "./format.ts";
import { copy } from "./copy.ts";
import type { Rec } from "./envelope.ts";

export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

type Id = number | string | null;
interface Request {
  jsonrpc: "2.0";
  id?: Id;
  method: string;
  params?: Rec;
}

export interface ToolResult {
  content: { type: "text"; text: string }[];
  structuredContent?: Rec;
  isError?: boolean;
}

/** What the server asks the client to put in front of the person, and what comes back. MCP `elicitation/create`. */
export interface ElicitParams {
  message: string;
  requestedSchema: { type: "object"; properties: Rec; required?: string[] };
}
export interface ElicitResult {
  action: "accept" | "decline" | "cancel";
  content?: Rec;
}

/**
 * The client on the other end of stdio. `elicit` is set only when the client declared the capability at
 * initialize; without it the plan and the rerun go back to the model, as in the pipe.
 */
export interface Client {
  elicit?: (params: ElicitParams) => Promise<ElicitResult>;
}

const SCREENS = ["gtm", "money", "dev", "store", "doctor", "setup"] as const;

const version = (() => {
  try {
    return (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

/** The tools, in the order a client lists them. Every input is wv argv underneath, so the schemas stay honest. */
export const TOOLS = [
  {
    name: "wv_manifest",
    description: copy.mcp.manifest,
    inputSchema: {
      type: "object",
      properties: {
        group: { type: "string", description: "A command group, such as `products` or `payouts`. Omit for the index of every group and verb." },
        format: { type: "string", enum: ["markdown", "json"], description: "Markdown fits a turn; json is the same as data." },
      },
    },
  },
  {
    name: "wv_read",
    description: copy.mcp.read,
    inputSchema: {
      type: "object",
      required: ["argv"],
      properties: {
        argv: { type: "array", items: { type: "string" }, description: "The whop argv, without `whop`: `[\"products\", \"list\", \"--first\", \"5\"]`. Dotted flags and @file work as in wv." },
        all: { type: "boolean", description: "Follow the cursor and return every page as one array." },
        sandbox: { type: "boolean", description: "Talk to the sandbox host with the sandbox key." },
      },
    },
  },
  {
    name: "wv_screen",
    description: copy.mcp.screen,
    inputSchema: {
      type: "object",
      required: ["screen"],
      properties: {
        screen: { type: "string", enum: [...SCREENS, "report", "gtm rank", "support lookup"], description: "Which screen." },
        args: { type: "array", items: { type: "string" }, description: "The screen's own arguments: the app id for `dev`; an email, license key, membership id, or payment id for `support lookup`." },
        markdown: { type: "boolean", description: "`report` only: Markdown instead of data." },
        sandbox: { type: "boolean", description: "Talk to the sandbox host with the sandbox key." },
      },
    },
  },
  {
    name: "wv_write",
    description: copy.mcp.write,
    inputSchema: {
      type: "object",
      required: ["argv"],
      properties: {
        argv: { type: "array", items: { type: "string" }, description: "The wv argv, without `wv`: a write such as `[\"payouts\", \"create\", \"--amount\", \"250\", \"--payout_method_id\", \"potk_1\"]`, a recipe such as `[\"dev\", \"hook\", \"https://…\", \"--events\", \"payment.succeeded\"]`, or the `rerun` from a plan, exactly as given." },
        plan: { type: "boolean", description: "The plan alone. Nothing runs, and no rerun is minted." },
        sandbox: { type: "boolean", description: "Talk to the sandbox host with the sandbox key." },
      },
    },
  },
] as const;

export type ToolName = (typeof TOOLS)[number]["name"];

/** Turns a reply into a tool result: the bytes as text, parsed as structured content when they are one JSON object. */
export function toolResult(text: string, code: number): ToolResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const rec = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Rec) : undefined;
  // A plan waiting for consent is the protocol working, not an error, and a screen whose `ok` is false is data
  // (a business that is not set up). A refusal, a whop error, or a missing binary carries `error` and no rerun.
  const isError = rec ? rec.error !== undefined && !Array.isArray(rec.rerun) : code !== 0;
  return { content: [{ type: "text", text: text.replace(/\n$/, "") }], ...(rec ? { structuredContent: rec } : {}), ...(isError ? { isError: true } : {}) };
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const hasFormat = (argv: string[]) => argv.some((a) => a === "--format" || a.startsWith("--format="));

/** The wv argv a tool call stands for. Every tool is one wv command underneath. */
export function argvFor(name: string, args: Rec): string[] {
  const sandbox = args.sandbox === true ? ["--sandbox"] : [];
  switch (name) {
    case "wv_manifest":
      return ["agent", ...(typeof args.group === "string" && args.group ? [args.group] : []), ...(args.format === "json" ? ["--format", "json"] : [])];
    case "wv_read": {
      const argv = strings(args.argv);
      // whop's envelope, `ok` and `error` included, unless the caller chose a format: the same shape every other reply has.
      return [...sandbox, ...argv, ...(hasFormat(argv) ? [] : ["--format", "json", "--full-output"]), ...(args.all === true ? ["--all"] : [])];
    }
    case "wv_screen": {
      const screen = typeof args.screen === "string" ? args.screen.split(" ") : [];
      return [...sandbox, ...screen, ...strings(args.args), ...(args.markdown === true && screen[0] === "report" ? ["--md"] : [])];
    }
    case "wv_write": {
      const argv = strings(args.argv);
      return [...sandbox, ...(argv[0] === "wv" ? argv.slice(1) : argv), ...(args.plan === true ? ["--plan"] : [])];
    }
    default:
      throw new Error(copy.mcp.unknownTool(name));
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);

/** The amount the person must type back, when the plan moves real money: a money write, or a recipe with one. */
function typedAmountOf(plan: Rec, mode: Mode): { amount: number; currency: string } | undefined {
  if (mode === "sandbox") return undefined;
  const m = isRec(plan.money) ? plan.money : isRec(plan.typedAmount) ? plan.typedAmount : undefined;
  return m && typeof m.amount === "number" && typeof m.currency === "string" ? { amount: m.amount, currency: m.currency } : undefined;
}

/** The plan as the lines a person reads before saying yes: what runs, where, the money, the changes, the steps. */
export function planMessage(plan: Rec, mode: Mode): string {
  const lines: string[] = [];
  const account = isRec(plan.account) ? plan.account : undefined;
  lines.push(`${str(plan.command) ?? ""}`);
  lines.push(`${mode === "sandbox" ? copy.confirm.sandboxWarning : copy.confirm.warning}${account?.title ? ` Account: ${account.title}${account.id ? ` (${account.id})` : ""}.` : ""}`);
  const m = isRec(plan.money) ? plan.money : isRec(plan.typedAmount) ? plan.typedAmount : undefined;
  if (m && typeof m.amount === "number" && typeof m.currency === "string") lines.push(`${mode === "sandbox" ? "Amount:" : copy.confirm.money} ${money(m.amount, m.currency)}${str(plan.destination) ? ` to ${plan.destination}` : ""}.`);
  const commitment = isRec(plan.commitment) ? plan.commitment : undefined;
  if (commitment && typeof commitment.total === "number") lines.push(`Commits ${money(commitment.total, "usd")} over ${commitment.openEnded ? "an open-ended schedule" : `${commitment.days} days`}.`);
  if (Array.isArray(plan.changes) && plan.changes.length) {
    lines.push(`${copy.confirm.changes}:`);
    for (const c of plan.changes) if (isRec(c) && c.changed !== false) lines.push(`  ${str(c.key) ?? ""}: ${c.before === undefined ? "unset" : JSON.stringify(c.before)} -> ${JSON.stringify(c.after)}`);
  }
  if (Array.isArray(plan.steps) && plan.steps.length) {
    lines.push("Steps:");
    for (const st of plan.steps) if (isRec(st) && !st.skipped) lines.push(`  ${str(st.label) ?? str(st.key) ?? ""}: ${str(st.command) ?? ""}`);
  }
  if (Array.isArray(plan.warnings)) for (const w of plan.warnings) lines.push(`Warning: ${String(w)}`);
  return lines.filter((l) => l !== "").join("\n");
}

/** What the client asks: the amount typed back for money, a yes for everything else. `y` is not consent for a payout. */
export function elicitParamsFor(plan: Rec, mode: Mode): ElicitParams {
  const typed = typedAmountOf(plan, mode);
  const message = planMessage(plan, mode);
  if (typed) {
    const shown = money(typed.amount, typed.currency).replace(/^[^\d]+/, "");
    return { message, requestedSchema: { type: "object", properties: { amount: { type: "string", title: copy.confirm.typeAmount(shown), description: copy.mcp.amountField(shown) } }, required: ["amount"] } };
  }
  return { message, requestedSchema: { type: "object", properties: { approve: { type: "boolean", title: copy.confirm.question, description: copy.mcp.approveField } }, required: ["approve"] } };
}

/** Whether what came back is consent: the exact amount for money, `true` for the rest. Anything else is a no. */
export function consented(plan: Rec, mode: Mode, result: ElicitResult): boolean {
  if (result.action !== "accept" || !isRec(result.content)) return false;
  const typed = typedAmountOf(plan, mode);
  if (typed) return typeof result.content.amount === "string" && amountMatcher(typed.amount)(result.content.amount);
  return result.content.approve === true;
}

/** The person said no, or typed something else: the plan comes back with no rerun, so the model cannot run it anyway. */
function declined(envelope: Rec, why: "declined" | "cancelled" | "mismatch"): ToolResult {
  const meta = isRec(envelope.meta) ? envelope.meta : { command: "", wrapper: "wv", mode: "production" };
  const e: AgentEnvelope = { ok: false, error: { code: "DECLINED", message: copy.mcp.declined[why], hint: copy.mcp.declinedHint }, plan: isRec(envelope.plan) ? envelope.plan : undefined, meta: meta as AgentEnvelope["meta"] };
  return toolResult(serialize(e), 2);
}

/**
 * The write gate on this transport. The reply is the pipe's: a plan and a rerun. When the client can put a
 * question in front of the person, the server asks it here, and the model never holds the approval: a yes
 * runs the rerun in the same call, a no comes back with the plan and no rerun. Otherwise the plan and the
 * rerun go to the model, which shows the plan and calls again, as in the pipe.
 */
async function withConsent(result: ToolResult, client: Client): Promise<ToolResult> {
  const env = result.structuredContent;
  if (!client.elicit || !env || !isRec(env.error) || env.error.code !== "CONFIRMATION_REQUIRED" || !Array.isArray(env.rerun) || !isRec(env.plan)) return result;
  const mode: Mode = isRec(env.meta) && env.meta.mode === "sandbox" ? "sandbox" : "production";
  const answer = await client.elicit(elicitParamsFor(env.plan, mode));
  if (answer.action === "cancel") return declined(env, "cancelled");
  if (answer.action !== "accept") return declined(env, "declined");
  if (!consented(env.plan, mode, answer)) return declined(env, typedAmountOf(env.plan, mode) ? "mismatch" : "declined");
  process.stderr.write(copy.mcp.approvedLog(str(env.plan.command) ?? "") + "\n");
  // The rerun is the pipe's: the mode is not in it, so the token minted for the sandbox must be checked there.
  return callTool("wv_write", { argv: env.rerun.map(String), sandbox: mode === "sandbox" }, {});
}

/** Runs one tool: the argv through the same `agentReply` the pipe uses, an exec buffered instead of streamed. */
export async function callTool(name: string, args: Rec, client: Client = {}): Promise<ToolResult> {
  if (!TOOLS.some((t) => t.name === name)) return { content: [{ type: "text", text: copy.mcp.unknownTool(name) }], isError: true };
  const own = ownFlags(argvFor(name, args));
  const mode = modeFrom(own.sandbox);
  const env = whopEnv(mode);
  if (own.argv.length >= 2 && !own.argv[1].startsWith("--")) loadWhopWrites(cachedLlmsFull());
  // A read tool never gets to run a write, even with consent flags smuggled into its argv.
  if (name === "wv_read" && agentGated(own.argv.filter((a) => a !== "--yes" && a !== "--approve" && !a.startsWith("--approve=")))) {
    return { content: [{ type: "text", text: copy.mcp.readIsWrite(own.argv.slice(0, 2).join(" ")) }], isError: true };
  }
  const r: AgentReply = await agentReply(own.argv, { mode, env, plan: own.plan, all: own.all, md: own.md });
  if (r.kind === "text") return name === "wv_write" ? withConsent(toolResult(r.text, r.code), client) : toolResult(r.text, r.code);
  const ran = await runBuffered(r.argv, r.env, agentExitCode);
  return toolResult(ran.stdout, ran.code);
}

const respond = (id: Id, result: unknown) => JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n";
const fail = (id: Id, code: number, message: string) => JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n";

/** Whether the client's initialize declared it can put a question in front of the person. */
export const clientElicits = (params: Rec | undefined) => isRec(params?.capabilities) && isRec(params.capabilities.elicitation);

/**
 * One request to one response line, or nothing for a notification. `client` is the way back to the person;
 * `initialize` is where the server learns whether there is one, and `session.elicits` remembers it.
 */
export async function handle(req: Request, client: Client = {}, session: { elicits?: boolean } = {}): Promise<string | undefined> {
  const id = req.id ?? null;
  if (req.method.startsWith("notifications/")) return undefined;
  switch (req.method) {
    case "initialize": {
      const asked = typeof req.params?.protocolVersion === "string" ? req.params.protocolVersion : "";
      session.elicits = clientElicits(req.params);
      return respond(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "wv", version },
        instructions: copy.mcp.instructions,
      });
    }
    case "ping":
      return respond(id, {});
    case "tools/list":
      return respond(id, { tools: TOOLS });
    case "tools/call": {
      const name = typeof req.params?.name === "string" ? req.params.name : "";
      const args = req.params?.arguments && typeof req.params.arguments === "object" ? (req.params.arguments as Rec) : {};
      try {
        return respond(id, await callTool(name, args, session.elicits ? client : {}));
      } catch (e) {
        return respond(id, { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true });
      }
    }
    default:
      return fail(id, -32601, `Method not found: ${req.method}`);
  }
}

/**
 * Reads requests from stdin one per line, answers on stdout. Requests run concurrently and answer as they
 * finish. When stdin closes, the calls still running finish first, then the process exits. Never returns.
 */
export function serveMcp(): Promise<never> {
  return new Promise(() => {
    const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
    let pending = 0;
    let closed = false;
    const done = () => {
      if (closed && pending === 0) process.exit(0);
    };
    // Requests the server sends the client (elicitation), by id, waiting for their response line.
    let nextId = 1;
    const waiting = new Map<number, (r: ElicitResult) => void>();
    const client: Client = {
      elicit: (params) =>
        new Promise((resolve) => {
          const id = nextId++;
          waiting.set(id, resolve);
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, method: "elicitation/create", params }) + "\n");
        }),
    };
    const session: { elicits?: boolean } = {};
    rl.on("line", (line) => {
      if (!line.trim()) return;
      let msg: Request & { result?: unknown; error?: unknown };
      try {
        msg = JSON.parse(line) as typeof msg;
      } catch {
        process.stdout.write(fail(null, -32700, "Parse error"));
        return;
      }
      // A response to something the server asked. An error, or a shape the spec does not allow, is a cancel.
      if (typeof msg.method !== "string") {
        const resolve = typeof msg.id === "number" ? waiting.get(msg.id) : undefined;
        if (!resolve) return;
        waiting.delete(msg.id as number);
        const r = msg.result;
        resolve(isRec(r) && (r.action === "accept" || r.action === "decline" || r.action === "cancel") ? { action: r.action, content: isRec(r.content) ? r.content : undefined } : { action: "cancel" });
        return;
      }
      const req = msg;
      pending++;
      void handle(req, client, session)
        .then((out) => out && process.stdout.write(out))
        .finally(() => {
          pending--;
          done();
        });
    });
    rl.on("close", () => {
      closed = true;
      for (const [id, resolve] of waiting) {
        waiting.delete(id);
        resolve({ action: "cancel" });
      }
      done();
    });
  });
}

/** The command a client runs to start this server. `wv` is on PATH after `pnpm link --global`. */
export const MCP_COMMAND = "wv --mcp";

/**
 * `wv mcp add [--agent x] [--no-global]`: whop's own installer, told to register wv's server instead of whop's.
 * A `--command` the person gave wins.
 */
export function mcpAddArgv(rest: string[]): string[] {
  const given = rest.some((a) => a === "--command" || a === "-c" || a.startsWith("--command="));
  return ["mcp", "add", ...(given ? [] : ["--command", MCP_COMMAND]), ...rest];
}

export interface McpDoctor {
  ok: boolean;
  toolCount: number;
  tools: { name: string; description: string }[];
  /** What the server said it is. */
  server?: { name: string; version: string; protocolVersion: string };
  command: string;
  error?: string;
}

/**
 * `wv mcp doctor`: start this same program as the server, initialize, list the tools, and report, the way
 * `whop mcp doctor` does for whop's. Proves the startup path a client would take, not just the module.
 */
export function mcpDoctor(timeoutMs = 15000): Promise<McpDoctor> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [...process.execArgv, process.argv[1], "--mcp"], { stdio: ["pipe", "pipe", "ignore"], env: process.env });
    let out = "";
    let settled = false;
    const finish = (r: McpDoctor) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, toolCount: 0, tools: [], command: MCP_COMMAND, error: copy.mcpDoctor.timeout }), timeoutMs);
    child.on("error", (e) => finish({ ok: false, toolCount: 0, tools: [], command: MCP_COMMAND, error: e.message }));
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString("utf8");
      const lines = out.split("\n");
      const answers = new Map<number, Rec>();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const j = JSON.parse(line) as { id?: number; result?: Rec };
          if (typeof j.id === "number" && isRec(j.result)) answers.set(j.id, j.result);
        } catch {
          // a partial line; wait for the rest
        }
      }
      const init = answers.get(1);
      const list = answers.get(2);
      if (!init || !list) return;
      const info = isRec(init.serverInfo) ? init.serverInfo : {};
      const tools = Array.isArray(list.tools) ? list.tools.filter(isRec).map((t) => ({ name: String(t.name), description: String(t.description ?? "") })) : [];
      finish({ ok: tools.length > 0, toolCount: tools.length, tools, server: { name: String(info.name ?? ""), version: String(info.version ?? ""), protocolVersion: String(init.protocolVersion ?? "") }, command: MCP_COMMAND, ...(tools.length ? {} : { error: copy.mcpDoctor.noTools }) });
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: PROTOCOL_VERSIONS[0], capabilities: {}, clientInfo: { name: "wv mcp doctor", version } } }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
  });
}
