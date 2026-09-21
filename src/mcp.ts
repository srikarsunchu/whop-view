// `wv --mcp`: the agent face as a Model Context Protocol server on stdio. The same gate and the same envelopes
// the pipe gives, reached as tools instead of argv, so a client that never opens a terminal (Claude desktop,
// Cursor, claude.ai) gets the plan step before a write. JSON-RPC 2.0, one message per line, no dependency:
// initialize, ping, tools/list, tools/call are the whole protocol this server needs.
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { agentReply, ownFlags, type AgentReply } from "./bin.ts";
import { agentExitCode, agentGated } from "./agent.ts";
import { cachedLlmsFull, modeFrom, runBuffered, whopEnv } from "./runner.ts";
import { loadWhopWrites } from "./status.ts";
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

/** Runs one tool: the argv through the same `agentReply` the pipe uses, an exec buffered instead of streamed. */
export async function callTool(name: string, args: Rec): Promise<ToolResult> {
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
  if (r.kind === "text") return toolResult(r.text, r.code);
  const ran = await runBuffered(r.argv, r.env, agentExitCode);
  return toolResult(ran.stdout, ran.code);
}

const respond = (id: Id, result: unknown) => JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n";
const fail = (id: Id, code: number, message: string) => JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n";

/** One request to one response line, or nothing for a notification. */
export async function handle(req: Request): Promise<string | undefined> {
  const id = req.id ?? null;
  if (req.method.startsWith("notifications/")) return undefined;
  switch (req.method) {
    case "initialize": {
      const asked = typeof req.params?.protocolVersion === "string" ? req.params.protocolVersion : "";
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
        return respond(id, await callTool(name, args));
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
    rl.on("line", (line) => {
      if (!line.trim()) return;
      let req: Request;
      try {
        req = JSON.parse(line) as Request;
      } catch {
        process.stdout.write(fail(null, -32700, "Parse error"));
        return;
      }
      pending++;
      void handle(req)
        .then((out) => out && process.stdout.write(out))
        .finally(() => {
          pending--;
          done();
        });
    });
    rl.on("close", () => {
      closed = true;
      done();
    });
  });
}
