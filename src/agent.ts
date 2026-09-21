// The agent face of wv. When stdout is not a terminal, a write gets the same gate a person gets, as one
// JSON envelope on stdout in whop's own shape: `ok`, `error`, `meta`, plus `plan` (what the card would
// have shown) and `rerun` (the command that runs it with consent). Pure: bin.ts gathers and prints.
import type { Rec } from "./envelope.ts";
import type { Mode } from "./copy.ts";
import { copy } from "./copy.ts";
import { shellJoin } from "./argv.ts";
import { money } from "./format.ts";
import { flagsToRecord, moneyOf, type ConfirmInput, type RefusedInput } from "./views/confirm.ts";
import { commitment, type AdPlanInput } from "./views/adplan.ts";
import { isWrite } from "./status.ts";
import { isAdPlan } from "./views/adplan.ts";
import { randomUUID } from "node:crypto";

/** Codes wv itself emits. Everything else on stdout is whop's. */
export type AgentCode = "CONFIRMATION_REQUIRED" | "WHOP_LIMIT" | "WV_CAP" | "INSUFFICIENT_BALANCE" | "WV_AD_CAP" | "BAD_PRESET" | "EVENTS_RANGE" | "JSON_FLAGS" | "NEEDS_TERMINAL";

export interface AgentEnvelope {
  ok: boolean;
  error?: { code: AgentCode | string; message: string; hint?: string };
  /** What the confirm or ad plan card would have shown, as data. */
  plan?: Rec;
  /** The wv command that runs the write with consent. Absent on a refusal: nothing to rerun. */
  rerun?: string[];
  meta: { command: string; wrapper: "wv"; mode: Mode };
}

/** Flags that print and exit inside whop without running the command. A write carrying one is not a write. */
const NON_EXEC = new Set(["--schema", "--help", "-h", "--llms", "--llms-full", "--version", "-v"]);

/** Whether a piped argv is a write wv gates: a write or ad verb with none of the flags that never execute. */
export function agentGated(argv: string[]): boolean {
  const [group, verb] = argv;
  if (!group || !verb || verb.startsWith("--")) return false;
  if (argv.some((a) => NON_EXEC.has(a))) return false;
  return isWrite(group, verb) || isAdPlan(group, verb);
}

const command = (argv: string[]) => argv.slice(0, 2).join(" ");

export function envelope(argv: string[], mode: Mode, body: Omit<AgentEnvelope, "meta">): AgentEnvelope {
  return { ...body, meta: { command: command(argv), wrapper: "wv", mode } };
}

/** Two-space JSON and a newline, like `whop --format json`. */
export const serialize = (e: AgentEnvelope) => JSON.stringify(e, null, 2) + "\n";

/** The command an agent reruns to consent: wv, the same argv, `--yes`. `whop` itself rejects `--yes`. */
export const rerunFor = (argv: string[]) => ["wv", ...argv.filter((a) => a !== "--yes" && a !== "--plan"), "--yes"];

const account = (title?: string, id?: string) => (id || title ? { id, title } : undefined);

/** The money gate's card as data. `hints` and the prompt timeout are a person's concerns and stay out. */
export function moneyPlan(input: ConfirmInput): Rec {
  const m = moneyOf(input.argv);
  return {
    kind: "write",
    group: input.group,
    verb: input.verb,
    command: shellJoin(["whop", ...input.argv]),
    mode: input.mode ?? "production",
    account: account(input.accountTitle, input.accountId),
    flags: flagsToRecord(input.argv),
    money: m ?? undefined,
    destination: input.destination,
    balance: input.balance,
    cap: input.cap === undefined ? undefined : input.cap,
    limit: input.limit,
  };
}

/** The ads gate's card as data, with the commitment the budget implies. */
export function adPlan(input: AdPlanInput): Rec {
  return {
    kind: "ad",
    group: input.group,
    verb: input.verb,
    command: shellJoin(["whop", ...input.argv]),
    mode: input.mode ?? "production",
    account: account(input.accountTitle, input.accountId),
    tree: input.tree,
    budget: input.budget,
    commitment: input.budget ? commitment(input.budget) : undefined,
    currency: input.currency,
    reach: input.reach,
    audienceNames: input.audienceNames && Object.keys(input.audienceNames).length ? input.audienceNames : undefined,
    social: input.social,
    paysFrom: input.paysFrom,
    balance: input.balance,
    cap: input.cap === undefined ? undefined : input.cap,
  };
}

/** `ok: true` and the plan. `--plan` in a pipe. */
export function planEnvelope(argv: string[], mode: Mode, plan: Rec): AgentEnvelope {
  return envelope(argv, mode, { ok: true, plan });
}

/** The gate asking for consent: exit 2, the plan, and the rerun. */
export function confirmationEnvelope(argv: string[], mode: Mode, plan: Rec): AgentEnvelope {
  const cmd = shellJoin(["whop", ...argv.filter((a) => a !== "--yes")]);
  return envelope(argv, mode, {
    ok: false,
    error: { code: "CONFIRMATION_REQUIRED", message: copy.agent.confirm(cmd, mode), hint: copy.agent.confirmHint },
    plan,
    rerun: rerunFor(argv),
  });
}

/** A money refusal in the same words the card uses. Nothing to rerun. */
export function refusedEnvelope(input: RefusedInput): AgentEnvelope {
  const m = moneyOf(input.argv);
  const amount = m ? money(m.amount, m.currency) : "";
  const cur = m?.currency;
  const c = copy.confirm.refused;
  const [code, message, hint]: [AgentCode, string, string | undefined] =
    input.reason === "whop"
      ? ["WHOP_LIMIT", input.limit?.message ?? c.whopBody(amount, money(input.limit?.max ?? 0, cur), input.limit?.speed ?? "standard"), undefined]
      : input.reason === "cap"
        ? ["WV_CAP", c.capBody(amount, money(input.cap ?? 0, cur)), m ? c.raise(Math.ceil(m.amount)) : undefined]
        : ["INSUFFICIENT_BALANCE", c.balanceBody(amount, money(input.balance?.available ?? 0, cur)), undefined];
  return envelope(input.argv, input.mode ?? "production", { ok: false, error: { code, message, hint }, plan: moneyPlan(input) });
}

/** The ad spend cap refusal. */
export function adRefusedEnvelope(input: AdPlanInput): AgentEnvelope {
  const c = commitment(input.budget!);
  const cur = input.currency ?? "usd";
  return envelope(input.argv, input.mode ?? "production", {
    ok: false,
    error: { code: "WV_AD_CAP", message: copy.adplan.refused.body(money(c.total, cur), money(input.cap ?? 0, cur)), hint: copy.adplan.refused.raise(Math.ceil(c.total)) },
    plan: adPlan(input),
  });
}

/** A wv refusal that happens before any `whop` call: a bad date preset, a malformed `@file`, a screen that needs a terminal. */
export function wvErrorEnvelope(argv: string[], mode: Mode, error: { code: string; message: string; hint?: string }): AgentEnvelope {
  return envelope(argv, mode, { ok: false, error });
}

/**
 * Exit codes for a pipe. `whop` exits 1 for every failure, so a script cannot branch without parsing the body.
 * wv reads the code out of the bytes it already forwarded and maps: 2 refused by wv (the gate above), 3 a bad
 * request, 4 not allowed, 5 not found, else whop's own status. `WV_EXIT=whop` keeps whop's status.
 */
export const EXIT_CODES: Record<string, number> = {
  VALIDATION_ERROR: 3,
  HTTP_400: 3,
  HTTP_422: 3,
  HTTP_401: 4,
  HTTP_403: 4,
  HTTP_404: 5,
  COMMAND_NOT_FOUND: 5,
};

/** The error code in whop's output, in any of its formats: `"code": "X"` (json), `code: X` (toon, yaml), `**code**` is not one. */
export function errorCodeIn(text: string): string | undefined {
  const m = /"code"\s*:\s*"([A-Z][A-Z0-9_]*)"/.exec(text) ?? /^\s*code:\s*"?([A-Z][A-Z0-9_]*)"?\s*$/m.exec(text);
  return m?.[1];
}

export function agentExitCode(whopStatus: number, stdout: string, env: NodeJS.ProcessEnv = process.env): number {
  if (whopStatus === 0 || env.WV_EXIT === "whop") return whopStatus;
  const code = errorCodeIn(stdout);
  return (code && EXIT_CODES[code]) || whopStatus;
}

/** Whether a verb's schema lists `--idempotency-key`. Every write in the API does; the schema is the check. */
export function takesIdempotency(schema: unknown): boolean {
  const opts = schema && typeof schema === "object" && "options" in schema ? (schema as { options?: { properties?: Record<string, unknown> } }).options : undefined;
  return !!opts?.properties && "idempotency-key" in opts.properties;
}

export const hasIdempotencyKey = (argv: string[]) => argv.some((a) => a === "--idempotency-key" || a.startsWith("--idempotency-key="));

/**
 * The gate is the plan step, so it mints the key the skill tells agents to mint: one per plan, carried into the
 * card, the envelope, and `rerun`, so the approved retry can never write twice. Argv that already has one is kept.
 */
export function withIdempotencyKey(argv: string[], schema: unknown, key: string = randomUUID()): string[] {
  if (!takesIdempotency(schema) || hasIdempotencyKey(argv)) return argv;
  return [...argv, "--idempotency-key", key];
}
