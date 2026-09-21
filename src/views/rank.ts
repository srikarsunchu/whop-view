// `wv gtm rank <campaign>`: the decide rubric as one read. Every ad group under a campaign with its spend,
// results, cost per result, and return on ad spend from `ad-groups list`, ranked by cost per result against a
// target, with the verdict the rubric gives each one and the command that acts on it. Reads only; the
// commands it teaches are writes and go through the gate when the person runs them.
import type { Parsed, Rec } from "../envelope.ts";
import { copy, type Mode } from "../copy.ts";
import { money, num, relative } from "../format.ts";
import { footer, type FooterLine } from "../primitives/footer.ts";
import { breadcrumb } from "../primitives/rule.ts";
import { table, type TableCell, type TableColumn } from "../primitives/table.ts";
import { teach } from "../argv.ts";
import { paint, type Role, type Theme } from "../tokens.ts";
import { wrap } from "../ansi.ts";
import { statusLabel, statusRole } from "../status.ts";

export const MIN_DAYS = 3;
export const MIN_RESULTS = 50;
export const PAUSE_RATIO = 2;

export type Verdict = "not_delivering" | "wait" | "pause" | "hold" | "scale" | "rejected";

export interface RankedGroup {
  id: string;
  title: string;
  status?: string;
  deliveryStatus?: string;
  spend: number;
  results: number;
  costPerResult?: number;
  roas?: number;
  ageDays?: number;
  verdict: Verdict;
  /** The write that acts on the verdict, as wv argv. Absent for wait and hold. */
  action?: string[];
}

export interface RankInput {
  campaignId: string;
  campaign?: Rec;
  groups: Parsed;
  /** Cost per result the person named. Absent: rank only, no pause or scale verdicts. */
  target?: number;
  currency: string;
  accountTitle?: string;
  accountId?: string;
  mode?: Mode;
  now?: number;
  commands: string[][];
}

const n = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** The rubric, one group at a time. Order matters: a rejected or silent group is not a performance question. */
export function verdictFor(g: { status?: string; deliveryStatus?: string; spend: number; results: number; costPerResult?: number; ageDays?: number }, target: number | undefined): Verdict {
  if (g.status === "rejected" || g.deliveryStatus === "rejected" || g.deliveryStatus === "all_ads_rejected") return "rejected";
  if (g.spend === 0 && (g.ageDays ?? 0) >= 1) return "not_delivering";
  if ((g.ageDays ?? 0) < MIN_DAYS || g.results < MIN_RESULTS) return "wait";
  if (target === undefined || g.costPerResult === undefined) return "hold";
  if (g.costPerResult > target * PAUSE_RATIO) return "pause";
  if (g.costPerResult < target) return "scale";
  return "hold";
}

export function rankGroups(input: RankInput): RankedGroup[] {
  const rows = input.groups.ok && input.groups.payload.kind === "page" ? input.groups.payload.rows : [];
  const now = input.now ?? Date.now();
  const out: RankedGroup[] = rows.map((r) => {
    const created = str(r.created_at) ? Date.parse(r.created_at as string) : NaN;
    const g = {
      id: String(r.id ?? ""),
      title: str(r.title) ?? String(r.id ?? ""),
      status: str(r.status),
      deliveryStatus: str(r.delivery_status),
      spend: n(r.spend) ?? 0,
      results: n(r.results) ?? 0,
      costPerResult: n(r.cost_per_result),
      roas: n(r.return_on_ad_spend),
      ageDays: Number.isFinite(created) ? Math.floor((now - created) / 86_400_000) : undefined,
    };
    const verdict = verdictFor(g, input.target);
    const action = verdict === "pause" ? ["wv", "ad-groups", "pause", g.id] : verdict === "scale" ? ["wv", "ads", "list", "--ad_group_id", g.id, "--format", "json"] : verdict === "rejected" ? ["wv", "ads", "list", "--ad_group_id", g.id, "--format", "json"] : undefined;
    return { ...g, verdict, action };
  });
  // Ranked by cost per result, cheapest first; groups without one sink to the bottom in spend order.
  return out.sort((a, b) => (a.costPerResult ?? Infinity) - (b.costPerResult ?? Infinity) || b.spend - a.spend);
}

export function rankData(input: RankInput): Rec {
  const ranked = rankGroups(input);
  return {
    campaign: { id: input.campaignId, title: str(input.campaign?.title), status: str(input.campaign?.status), deliveryStatus: str(input.campaign?.delivery_status) },
    target: input.target,
    currency: input.currency,
    rubric: { minDays: MIN_DAYS, minResults: MIN_RESULTS, pauseRatio: PAUSE_RATIO },
    groups: ranked,
    ...(input.groups.ok ? {} : { error: input.groups.error }),
    commands: input.commands.map((c) => teach(c)),
  };
}

const VERDICT_ROLE: Record<Verdict, Role> = { scale: "good", hold: "text", wait: "muted", pause: "bad", not_delivering: "warn", rejected: "bad" };

export function rankView(input: RankInput, theme: Theme): string[] {
  const c = copy.rank;
  const out: string[] = [];
  out.push(...breadcrumb(theme, [[input.accountTitle ?? "", "accent"], [input.accountId ?? "", "muted"], [copy.session.mode(input.mode ?? "production"), input.mode === "sandbox" ? "good" : "warn"], [c.title, "accent"], [`${str(input.campaign?.title) ?? input.campaignId}`, "muted"]]));
  out.push("");
  if (!input.groups.ok) {
    out.push(" " + paint(theme, "warn", `${input.groups.error.code} ${input.groups.error.message.split("\n")[0]}`), "");
    return out;
  }
  const ranked = rankGroups(input);
  if (!ranked.length) {
    out.push(" " + paint(theme, "muted", c.noGroups), "");
    return out;
  }
  const cols: TableColumn[] = [
    { key: "title", label: c.cols.group, align: "left", priority: 0, max: 28 },
    { key: "delivery", label: c.cols.delivery, align: "left", priority: 4 },
    { key: "age", label: c.cols.age, align: "right", priority: 5 },
    { key: "spend", label: c.cols.spend, align: "right", priority: 2 },
    { key: "results", label: c.cols.results, align: "right", priority: 3 },
    { key: "cpr", label: c.cols.cpr, align: "right", priority: 1 },
    { key: "roas", label: c.cols.roas, align: "right", priority: 6 },
    { key: "verdict", label: c.cols.verdict, align: "left", priority: 0 },
  ];
  const cells = ranked.map((g) => {
    const row: Record<string, TableCell> = {};
    row.title = { text: g.title, role: "text" };
    row.delivery = { text: statusLabel(g.deliveryStatus ?? g.status ?? ""), role: statusRole(g.deliveryStatus ?? g.status ?? "") };
    row.age = { text: g.ageDays === undefined ? copy.detail.empty : `${g.ageDays}d`, role: "muted" };
    row.spend = { text: money(g.spend, input.currency), role: "text" };
    row.results = { text: num(g.results), role: "text" };
    row.cpr = { text: g.costPerResult === undefined ? copy.detail.empty : money(g.costPerResult, input.currency), role: input.target !== undefined && g.costPerResult !== undefined ? (g.costPerResult < input.target ? "good" : g.costPerResult > input.target * PAUSE_RATIO ? "bad" : "text") : "text" };
    row.roas = { text: g.roas === undefined ? copy.detail.empty : `${g.roas.toFixed(2)}×`, role: "text" };
    row.verdict = { text: c.verdicts[g.verdict], role: VERDICT_ROLE[g.verdict] };
    return row;
  });
  out.push(...table(cols, cells, theme).lines, "");
  const note = input.target === undefined ? c.noTarget : c.targetNote(money(input.target, input.currency), MIN_DAYS, MIN_RESULTS, PAUSE_RATIO);
  for (const l of wrap(note, theme.width - 3)) out.push("   " + paint(theme, "muted", l));
  out.push("");
  const lines: FooterLine[] = [];
  for (const g of ranked) if (g.action) lines.push([c.verdicts[g.verdict], g.action]);
  for (const cmd of input.commands) lines.push([copy.list.json, teach(cmd)]);
  out.push(...footer(lines, theme), "");
  void relative;
  return out;
}
