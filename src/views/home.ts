import type { Parsed, Rec } from "../envelope.ts";
import { money, shortDate } from "../format.ts";
import { footer } from "../primitives/footer.ts";
import { paint, type Theme } from "../tokens.ts";
import { padEnd, padStart, width } from "../ansi.ts";
import { copy } from "../copy.ts";
import { errorView } from "./error.ts";

export interface HomeInput {
  auth: Parsed;
  balance: Parsed;
  revenue: Parsed;
  from: string;
  to: string;
  commands: string[];
}

const BLOCKS = "▁▂▃▄▅▆▇█";

export function sparkline(values: number[]): string {
  const max = Math.max(...values, 0);
  if (max === 0) return BLOCKS[0].repeat(values.length);
  return values.map((v) => BLOCKS[Math.min(7, Math.round((v / max) * 7))]).join("");
}

export function homeView(input: HomeInput, theme: Theme): string[] {
  const out: string[] = [];
  // Identity
  if (input.auth.ok && input.auth.payload.kind === "status") {
    const s = input.auth.payload.record;
    const account = s.account as Rec | undefined;
    const left = paint(theme, "accent", String(account?.title ?? "")) + "  " + paint(theme, "muted", String(account?.id ?? ""));
    const right = paint(theme, "muted", `${s.profile ?? ""} · ${s.method ?? ""}`);
    const gap = theme.width - 1 - width(left) - width(right);
    out.push(" " + left + padStart(right, Math.max(2, gap) + width(right)));
  } else if (input.auth.ok) {
    out.push(" " + paint(theme, "warn", copy.home.notSignedIn));
  } else out.push(...errorView(input.auth.error, theme));
  out.push("");

  // Two tiles side by side at normal and wide, stacked at narrow.
  const balanceTile = tile(copy.home.balance, balanceRows(input.balance), theme);
  const revenueTile = tile(copy.home.revenue(dayCount(input.from, input.to)), revenueRows(input.revenue, input.from, input.to), theme);
  if (theme.breakpoint === "narrow") out.push(...balanceTile, "", ...revenueTile);
  else {
    const colW = Math.max(...balanceTile.map(width)) + 4;
    for (let i = 0; i < Math.max(balanceTile.length, revenueTile.length); i++) out.push((padEnd(balanceTile[i] ?? "", colW) + (revenueTile[i] ?? "")).trimEnd());
  }
  out.push("");
  out.push(...footer([input.commands.join(" · ")], theme));
  return out;
}

function tile(title: string, rows: [string, string][], theme: Theme): string[] {
  const lines = [" " + paint(theme, "accent", title)];
  const keyW = Math.max(0, ...rows.map(([k]) => width(k)));
  for (const [k, v] of rows) lines.push(("   " + paint(theme, "muted", padEnd(k, keyW)) + (k ? "  " : "") + v).trimEnd());
  return lines;
}

function balanceRows(p: Parsed): [string, string][] {
  if (!p.ok) return [["", p.error.code + " " + p.error.message.split("\n")[0]]];
  if (p.payload.kind !== "report") return [["", "—"]];
  const rows = p.payload.rows.map((r): [string, string] => [String(r.line_category ?? r.grouping ?? ""), money(Number(r.amount))]);
  return rows.length ? rows : [["available", money(p.payload.total ?? 0)]];
}

function revenueRows(p: Parsed, from: string, to: string): [string, string][] {
  if (!p.ok) return [["", p.error.code + " " + p.error.message.split("\n")[0]]];
  if (p.payload.kind !== "series") return [["", "—"]];
  const values = p.payload.points.map((pt) => pt.value);
  const total = values.reduce((a, b) => a + b, 0);
  return [
    [money(total, p.payload.currency ?? "usd"), sparkline(values)],
    [copy.home.range(shortDate(from), shortDate(to)), ""],
  ];
}

const dayCount = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
