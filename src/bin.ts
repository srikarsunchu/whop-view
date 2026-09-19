#!/usr/bin/env node
// wv: human view layer for the Whop CLI. Renders when a person is looking, execs `whop` otherwise.
import { makeTheme } from "./tokens.ts";
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
import { prompt } from "./primitives/prompt.ts";
import { spinner } from "./primitives/spinner.ts";
import type { Parsed, Rec } from "./envelope.ts";

const print = (lines: string[]) => process.stdout.write(lines.join("\n") + "\n");

async function main(argvIn: string[]) {
  // --width is ours; strip it before anything reaches whop.
  let widthOverride: number | undefined;
  const argv: string[] = [];
  for (let i = 0; i < argvIn.length; i++) {
    if (argvIn[i] === "--width") widthOverride = Number(argvIn[++i]);
    else if (argvIn[i].startsWith("--width=")) widthOverride = Number(argvIn[i].slice(8));
    else argv.push(argvIn[i]);
  }
  const theme = makeTheme({ width: widthOverride });

  if (shouldPassthrough(argv)) passthrough(argv);

  const [group, verb] = argv;

  if (!group) return print(helpView(parseHelp(helpText([])), theme));
  if (group === "home") return home(theme);
  if (!verb || verb.startsWith("--")) return print(helpView(parseHelp(helpText([group])), theme, group));

  const hints = hintsFor(group);
  const yes = argv.includes("--yes");
  const args = argv.filter((a) => a !== "--yes");

  if (isWrite(group, verb) && !yes) {
    const acct = await account();
    print(confirmView({ group, verb, argv: args, hints, accountTitle: acct?.title, accountId: acct?.id }, theme));
    const ok = await prompt(copy.confirm.question, theme);
    if (!ok) {
      print([" " + copy.confirm.aborted]);
      process.exit(130);
    }
    print([""]);
  }

  const spin = spinner(copy.spinner, theme);
  const { parsed, code } = await run(args);
  spin.stop();
  render(parsed, group, args, theme);
  process.exit(code);
}

function render(parsed: Parsed, group: string, argv: string[], theme: ReturnType<typeof makeTheme>) {
  if (!parsed.ok) return print(errorView(parsed.error, theme));
  const hints = hintsFor(group);
  const p = parsed.payload;
  switch (p.kind) {
    case "page":
      return print(listView({ group, argv, rows: p.rows, page: p.page, hints }, theme));
    case "record":
    case "status":
    case "other":
      return print(detailView({ group, argv, record: p.record, hints }, theme));
    case "report":
      return print(detailView({ group, argv, record: reportToRecord(p.rows, p.total), hints }, theme));
    case "series": {
      const rec: Rec = Object.fromEntries(p.points.map((pt) => [new Date(pt.timestamp * 1000).toISOString().slice(0, 10), pt.value]));
      return print(detailView({ group, argv, record: rec, hints }, theme));
    }
  }
}

const reportToRecord = (rows: Rec[], total?: number): Rec => {
  const rec: Rec = {};
  for (const r of rows) rec[String(r.line_category ?? r.grouping ?? r.period)] = { amount: r.amount, currency: "usd" };
  if (total != null) rec.total = { amount: total, currency: "usd" };
  return rec;
};

async function account(): Promise<{ title: string; id: string } | null> {
  const { parsed } = await run(["auth", "status"]);
  if (!parsed.ok || parsed.payload.kind !== "status") return null;
  const a = parsed.payload.record.account as Rec | undefined;
  return a ? { title: String(a.title ?? ""), id: String(a.id ?? "") } : null;
}

async function home(theme: ReturnType<typeof makeTheme>) {
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
  print(homeView({ auth: auth.parsed, balance: balance.parsed, revenue: revenue.parsed, from, to, commands: cmds.map((c) => c.join(" ")) }, theme));
  process.exit(auth.code || balance.code || revenue.code);
}

main(process.argv.slice(2)).catch((e) => {
  process.stderr.write(`wv: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
