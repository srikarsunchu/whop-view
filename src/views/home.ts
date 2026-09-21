import type { Parsed, Rec } from "../envelope.ts";
import { money, shortDate } from "../format.ts";
import { footer } from "../primitives/footer.ts";
import { teach } from "../argv.ts";
import { paint, type Role, type Theme } from "../tokens.ts";
import { width } from "../ansi.ts";
import { copy } from "../copy.ts";
import { errorView } from "./error.ts";
import { breadcrumb } from "../primitives/rule.ts";

export interface HomeInput {
  auth: Parsed;
  balance: Parsed;
  revenue: Parsed;
  from: string;
  to: string;
  commands: string[][];
  /** `sandbox` when wv is pointed at the sandbox host. */
  mode?: "production" | "sandbox";
  /** API version from `whop --help`, shown in the status line. */
  api?: string;
}

const BLOCKS = "▁▂▃▄▅▆▇█";

export function sparkline(values: number[]): string {
  const max = Math.max(...values, 0);
  if (max === 0) return BLOCKS[0].repeat(values.length);
  return values.map((v) => BLOCKS[Math.min(7, Math.round((v / max) * 7))]).join("");
}

export function homeView(input: HomeInput, theme: Theme): string[] {
  const out: string[] = [];
  // Status line: account › id › profile · method › API › balance. One row, like omp's breadcrumb bar.
  const segs: [string, Role?][] = [];
  if (input.auth.ok && input.auth.payload.kind === "status") {
    const s = input.auth.payload.record;
    const account = s.account as Rec | undefined;
    segs.push([String(account?.title ?? ""), "accent"], [String(account?.id ?? ""), "muted"], [copy.session.mode(input.mode ?? "production"), input.mode === "sandbox" ? "good" : "warn"], [`${s.profile ?? ""} · ${s.method ?? ""}`, "text"]);
  } else if (input.auth.ok) segs.push([copy.home.notSignedIn, "warn"]);
  if (input.api) segs.push([`${copy.help.api} ${input.api}`, "muted"]);
  const bal = balanceRows(input.balance);
  for (const [k, v] of bal) segs.push([k ? `${v} ${k}` : v, k === "available" ? "good" : "text"]);
  out.push(...breadcrumb(theme, segs));
  if (!input.auth.ok) out.push("", ...errorView(input.auth.error, theme));
  out.push("");

  const rev = revenueRows(input.revenue, input.from, input.to);
  const title = copy.home.revenue(dayCount(input.from, input.to));
  const [first, second] = rev;
  out.push(" " + paint(theme, "accent", title) + "  " + (first ? first[0] + "  " + first[1] : ""));
  if (second) out.push(" " + " ".repeat(width(title) + 2) + paint(theme, "muted", second[0] + (second[1] ? "  " + second[1] : "")));
  out.push("");
  // One teaching line per command, so none of the three is ever truncated away.
  out.push(...footer(input.commands.map((c, i): [string, string[]] => [i === 0 ? copy.list.json : " ".repeat(copy.list.json.length), teach(c)]), theme));
  return out;
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
