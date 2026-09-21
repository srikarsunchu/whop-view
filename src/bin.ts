#!/usr/bin/env node
// wv: human view layer for the Whop CLI. Renders when a person is looking, execs `whop` otherwise.
import { makeTheme, type Theme } from "./tokens.ts";
import { helpText, modeFrom, passthrough, run, shouldPassthrough, whopEnv, type Mode } from "./runner.ts";
import { hintsFor } from "./hints.ts";
import { isWrite, MONEY_GROUPS } from "./status.ts";
import { teach } from "./argv.ts";
import { daysAgo, isoDay } from "./format.ts";
import { copy } from "./copy.ts";
import { listViewWithMeta, type ListRender } from "./views/list.ts";
import { detailView } from "./views/detail.ts";
import { confirmView, describeMethod, flagsToRecord, moneyOf, refusedView, type Balance } from "./views/confirm.ts";
import { errorView } from "./views/error.ts";
import { helpView, parseHelp } from "./views/help.ts";
import { homeView } from "./views/home.ts";
import { seriesView } from "./views/series.ts";
import { prompt } from "./primitives/prompt.ts";
import { spinner } from "./primitives/spinner.ts";
import { session } from "./tui/session.ts";
import type { Parsed, Rec } from "./envelope.ts";

const print = (lines: string[]) => process.stdout.write(lines.join("\n") + "\n");

/** Words that are wv's, not whop's. */
const OURS = new Set(["home", "help"]);

export interface Outcome {
  code: number;
  /** Rows of a list, so the session can offer row shortcuts. */
  rows?: Rec[];
  group?: string;
  /** The printed list and where its rows sit, so the session can highlight one in place. */
  list?: ListRender;
  /** The agent command the view taught, as argv. The session's `copy json` puts it on the clipboard. */
  teach?: string[];
}

/** Splits wv's own flags out of argv. */
export function ownFlags(argvIn: string[]): { argv: string[]; width?: number; sandbox: boolean } {
  let width: number | undefined;
  let sandbox = false;
  const argv: string[] = [];
  for (let i = 0; i < argvIn.length; i++) {
    const a = argvIn[i];
    if (a === "--width") width = Number(argvIn[++i]);
    else if (a.startsWith("--width=")) width = Number(a.slice(8));
    else if (a === "--sandbox") sandbox = true;
    else argv.push(a);
  }
  return { argv, width: width !== undefined && Number.isFinite(width) && width > 0 ? Math.floor(width) : undefined, sandbox };
}

/** Per-payout cap from `WV_PAYOUT_CAP`, in whole currency units. `none` turns it off. Default $500, like Link. */
export const DEFAULT_CAP = 500;
export function capFrom(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env.WV_PAYOUT_CAP;
  if (raw === undefined || raw === "") return DEFAULT_CAP;
  if (/^(none|off|0)$/i.test(raw.trim())) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CAP;
}

/** How long a money prompt stays open, from `WV_CONFIRM_TIMEOUT` seconds. `0` or `none` waits forever. */
export const DEFAULT_TIMEOUT_SECONDS = 120;
export function timeoutFrom(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = env.WV_CONFIRM_TIMEOUT;
  if (raw === undefined || raw === "") return DEFAULT_TIMEOUT_SECONDS;
  if (/^(none|off|0)$/i.test(raw.trim())) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_TIMEOUT_SECONDS;
}

async function main(argvIn: string[]) {
  const { argv, width, sandbox } = ownFlags(argvIn);
  const theme = makeTheme({ width });
  const mode = modeFrom(sandbox);
  const env = whopEnv(mode);

  if (OURS.has(argv[0]) && !process.stdout.isTTY) {
    process.stderr.write(`wv: ${copy.session.needsTerminal}\n`);
    process.exit(2);
  }
  if (shouldPassthrough(argv)) passthrough(argv, env);

  if (argv.length === 0) {
    const acct = await identity(env);
    process.exit(await session({ theme, execute: (a, t) => execute(a, t, { numbered: true, mode }), account: acct, mode }));
  }
  process.exit((await execute(argv, theme, { mode })).code);
}

export interface ExecuteOptions {
  /** Inside a session: lists get a row-number gutter for the `N opens a row` shortcut. */
  numbered?: boolean;
  /** Which host the child `whop` talks to. Default production. */
  mode?: Mode;
}

/** Runs one wv command end to end and prints it. Shared by the one-shot CLI and the session. */
export async function execute(argv: string[], theme: Theme, opts: ExecuteOptions = {}): Promise<Outcome> {
  const [group, verb] = argv;
  if (!group || group === "help") {
    const target = group === "help" ? argv[1] : undefined;
    print(helpView(parseHelp(helpText(target ? [target] : [])), theme, target));
    return { code: 0 };
  }
  const mode = opts.mode ?? "production";
  const env = whopEnv(mode);
  if (group === "home") return home(theme, mode);
  if (!verb || verb.startsWith("--")) {
    print(helpView(parseHelp(helpText([group])), theme, group));
    return { code: 0 };
  }

  const hints = hintsFor(group);
  const yes = argv.includes("--yes");
  const args = argv.filter((a) => a !== "--yes");

  if (isWrite(group, verb) && !yes) {
    // Money gate. Like Link's approval: the amount, where it goes, and what it draws from are on screen,
    // a cap refuses before the network, and a prompt left sitting is not consent.
    const m = MONEY_GROUPS.has(group) ? moneyOf(args) : null;
    const methodId = flagsToRecord(args).payout_method_id;
    const spin = spinner(m ? copy.spinner.money : copy.spinner.identity, theme);
    const [acct, balance, destination] = await Promise.all([
      identity(env),
      m ? balanceFor(m.currency, env) : undefined,
      typeof methodId === "string" ? methodFor(methodId, env) : undefined,
    ]).finally(() => spin.stop());
    const live = m && mode !== "sandbox";
    const cap = live ? capFrom() : undefined;
    const timeoutSeconds = live ? timeoutFrom() : undefined;
    const input = { group, verb, argv: args, hints, accountTitle: acct?.title, accountId: acct?.id, mode, destination, balance, cap, timeoutSeconds };
    if (live && cap != null && m.amount > cap) {
      print(refusedView({ ...input, reason: "cap" }, theme));
      return { code: 2 };
    }
    if (live && balance && m.amount > balance.available) {
      print(refusedView({ ...input, reason: "balance" }, theme));
      return { code: 2 };
    }
    print(confirmView(input, theme));
    const answer = await prompt(copy.confirm.question, theme, { timeoutMs: timeoutSeconds ? timeoutSeconds * 1000 : undefined });
    if (answer !== "yes") {
      print([" " + (answer === "timeout" && timeoutSeconds ? copy.confirm.expired(timeoutSeconds) : copy.confirm.aborted)]);
      return { code: 130 };
    }
    print([""]);
  }

  const spin = spinner(copy.spinner.running(args), theme);
  const { parsed, code } = await run(args, env);
  spin.stop();
  return { code, group, ...render(parsed, group, args, theme, opts) };
}

/** Available balance in one currency from `ledgers report balance_summary`. Undefined when it cannot be read. */
async function balanceFor(currency: string, env: NodeJS.ProcessEnv): Promise<Balance | undefined> {
  const { parsed } = await run(["ledgers", "report", "--report_type", "balance_summary", "--currency", currency], env);
  if (!parsed.ok || parsed.payload.kind !== "report") return undefined;
  const row = parsed.payload.rows.find((r) => r.line_category === "available");
  const available = row ? Number(row.amount) : parsed.payload.total;
  return available != null && Number.isFinite(available) ? { available, currency } : undefined;
}

/** The saved payout method behind an id, described in one line. Undefined when it is not in the list. */
async function methodFor(id: string, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const { parsed } = await run(["payouts", "methods"], env);
  if (!parsed.ok || parsed.payload.kind !== "page") return undefined;
  const m = parsed.payload.rows.find((r) => r.id === id);
  return m ? describeMethod(m, id) : undefined;
}

/** Prints the right view for a payload. Returns the rows and list geometry when it was a list. */
function render(parsed: Parsed, group: string, argv: string[], theme: Theme, opts: ExecuteOptions): Pick<Outcome, "rows" | "list" | "teach"> {
  if (!parsed.ok) {
    print(errorView(parsed.error, theme));
    // The sandbox host answers an OAuth token with 401 or 404. Say which variable fixes it.
    if (opts.mode === "sandbox" && /^HTTP_40[134]$/.test(parsed.error.code) && !process.env.WV_SANDBOX_KEY) print(["", " " + copy.error.sandboxKey]);
    return {};
  }
  const hints = hintsFor(group);
  const p = parsed.payload;
  switch (p.kind) {
    case "page": {
      const list = listViewWithMeta({ group, argv, rows: p.rows, page: p.page, hints, canCreate: p.rows.length ? undefined : canCreate(group), numbered: opts.numbered }, theme);
      print(list.lines);
      return { rows: p.rows, list, teach: list.teach };
    }
    case "record":
    case "status":
    case "other":
      print(detailView({ group, argv, record: p.record, hints }, theme));
      return { teach: teach(argv) };
    case "report":
      print(detailView({ group, argv, record: reportToRecord(p.rows, p.total), hints }, theme));
      return { teach: teach(argv) };
    case "series":
      print(seriesView({ argv, points: p.points, currency: p.currency }, theme));
      return { teach: teach(argv) };
  }
}

const canCreate = (group: string) => /^\s{2,}create\s{2,}/m.test(helpText([group]));

const reportToRecord = (rows: Rec[], total?: number): Rec => {
  const rec: Rec = {};
  for (const r of rows) rec[String(r.line_category ?? r.grouping ?? r.period)] = { amount: r.amount, currency: "usd" };
  if (total != null) rec.total = { amount: total, currency: "usd" };
  return rec;
};

interface Identity {
  title: string;
  id: string;
  profile?: string;
  method?: string;
}

let identityCache: Promise<Identity | null> | undefined;

/** `auth status`, once per process. Confirmations and the session banner both need it. */
function identity(env: NodeJS.ProcessEnv = process.env): Promise<Identity | null> {
  identityCache ??= run(["auth", "status"], env).then(({ parsed }) => {
    if (!parsed.ok || parsed.payload.kind !== "status") return null;
    const s = parsed.payload.record;
    const a = s.account as Rec | undefined;
    if (!a) return null;
    return { title: String(a.title ?? ""), id: String(a.id ?? ""), profile: s.profile ? String(s.profile) : undefined, method: s.method ? String(s.method) : undefined };
  });
  return identityCache;
}

async function home(theme: Theme, mode: Mode): Promise<Outcome> {
  const env = whopEnv(mode);
  const from = isoDay(daysAgo(7));
  const to = isoDay(daysAgo(1));
  const cmds = [
    ["auth", "status"],
    ["ledgers", "report", "--report_type", "balance_summary"],
    ["stats", "get", "net_revenue", "--from", from, "--to", to, "--interval", "day"],
  ];
  const spin = spinner(copy.spinner.home, theme);
  const [auth, balance, revenue] = await Promise.all(cmds.map((c) => run(c, env)));
  spin.stop();
  const api = parseHelp(helpText([])).api;
  print(homeView({ auth: auth.parsed, balance: balance.parsed, revenue: revenue.parsed, from, to, commands: cmds, api, mode }, theme));
  return { code: auth.code || balance.code || revenue.code };
}

main(process.argv.slice(2)).catch((e) => {
  process.stderr.write(`wv: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
