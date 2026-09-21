#!/usr/bin/env node
// wv: human view layer for the Whop CLI. Renders when a person is looking, execs `whop` otherwise.
import { makeTheme, type Theme } from "./tokens.ts";
import { helpText, passthrough, run, shouldPassthrough } from "./runner.ts";
import { hintsFor } from "./hints.ts";
import { isWrite } from "./status.ts";
import { daysAgo, isoDay } from "./format.ts";
import { copy } from "./copy.ts";
import { listView } from "./views/list.ts";
import { detailView } from "./views/detail.ts";
import { confirmView } from "./views/confirm.ts";
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
}

/** Splits wv's own flags out of argv. */
export function ownFlags(argvIn: string[]): { argv: string[]; width?: number } {
  let width: number | undefined;
  const argv: string[] = [];
  for (let i = 0; i < argvIn.length; i++) {
    const a = argvIn[i];
    if (a === "--width") width = Number(argvIn[++i]);
    else if (a.startsWith("--width=")) width = Number(a.slice(8));
    else argv.push(a);
  }
  return { argv, width: width !== undefined && Number.isFinite(width) && width > 0 ? Math.floor(width) : undefined };
}

async function main(argvIn: string[]) {
  const { argv, width } = ownFlags(argvIn);
  const theme = makeTheme({ width });

  if (OURS.has(argv[0]) && !process.stdout.isTTY) {
    process.stderr.write(`wv: ${copy.session.needsTerminal}\n`);
    process.exit(2);
  }
  if (shouldPassthrough(argv)) passthrough(argv);

  if (argv.length === 0) {
    const acct = await identity();
    process.exit(await session({ theme, execute: (a, t) => execute(a, t, { numbered: true }), account: acct }));
  }
  process.exit((await execute(argv, theme)).code);
}

export interface ExecuteOptions {
  /** Inside a session: lists get a row-number gutter for the `N opens a row` shortcut. */
  numbered?: boolean;
}

/** Runs one wv command end to end and prints it. Shared by the one-shot CLI and the session. */
export async function execute(argv: string[], theme: Theme, opts: ExecuteOptions = {}): Promise<Outcome> {
  const [group, verb] = argv;
  if (!group || group === "help") {
    const target = group === "help" ? argv[1] : undefined;
    print(helpView(parseHelp(helpText(target ? [target] : [])), theme, target));
    return { code: 0 };
  }
  if (group === "home") return home(theme);
  if (!verb || verb.startsWith("--")) {
    print(helpView(parseHelp(helpText([group])), theme, group));
    return { code: 0 };
  }

  const hints = hintsFor(group);
  const yes = argv.includes("--yes");
  const args = argv.filter((a) => a !== "--yes");

  if (isWrite(group, verb) && !yes) {
    const acct = await identity();
    print(confirmView({ group, verb, argv: args, hints, accountTitle: acct?.title, accountId: acct?.id }, theme));
    const ok = await prompt(copy.confirm.question, theme);
    if (!ok) {
      print([" " + copy.confirm.aborted]);
      return { code: 130 };
    }
    print([""]);
  }

  const spin = spinner(copy.spinner, theme);
  const { parsed, code } = await run(args);
  spin.stop();
  return { code, group, rows: render(parsed, group, args, theme, opts) };
}

/** Prints the right view for a payload. Returns the rows when it was a list. */
function render(parsed: Parsed, group: string, argv: string[], theme: Theme, opts: ExecuteOptions): Rec[] | undefined {
  if (!parsed.ok) {
    print(errorView(parsed.error, theme));
    return;
  }
  const hints = hintsFor(group);
  const p = parsed.payload;
  switch (p.kind) {
    case "page":
      print(listView({ group, argv, rows: p.rows, page: p.page, hints, canCreate: p.rows.length ? undefined : canCreate(group), numbered: opts.numbered }, theme));
      return p.rows;
    case "record":
    case "status":
    case "other":
      return void print(detailView({ group, argv, record: p.record, hints }, theme));
    case "report":
      return void print(detailView({ group, argv, record: reportToRecord(p.rows, p.total), hints }, theme));
    case "series":
      return void print(seriesView({ argv, points: p.points, currency: p.currency }, theme));
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
function identity(): Promise<Identity | null> {
  identityCache ??= run(["auth", "status"]).then(({ parsed }) => {
    if (!parsed.ok || parsed.payload.kind !== "status") return null;
    const s = parsed.payload.record;
    const a = s.account as Rec | undefined;
    if (!a) return null;
    return { title: String(a.title ?? ""), id: String(a.id ?? ""), profile: s.profile ? String(s.profile) : undefined, method: s.method ? String(s.method) : undefined };
  });
  return identityCache;
}

async function home(theme: Theme): Promise<Outcome> {
  const from = isoDay(daysAgo(7));
  const to = isoDay(daysAgo(1));
  const cmds = [
    ["auth", "status"],
    ["ledgers", "report", "--report_type", "balance_summary"],
    ["stats", "get", "net_revenue", "--from", from, "--to", to, "--interval", "day"],
  ];
  const spin = spinner(copy.spinner, theme);
  const [auth, balance, revenue] = await Promise.all(cmds.map((c) => run(c)));
  spin.stop();
  const api = parseHelp(helpText([])).api;
  print(homeView({ auth: auth.parsed, balance: balance.parsed, revenue: revenue.parsed, from, to, commands: cmds.map((c) => c.join(" ")), api }, theme));
  return { code: auth.code || balance.code || revenue.code };
}

main(process.argv.slice(2)).catch((e) => {
  process.stderr.write(`wv: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
