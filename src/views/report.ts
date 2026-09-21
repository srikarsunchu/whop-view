// `wv report`: the Monday brief. Six numbers this week against last week, what blocks a sale or a launch,
// the money, the store, every live campaign ranked, and Whop's own recommendations waiting for a yes, as one
// page a person reads, one JSON object an agent reads, or one Markdown document a schedule posts. Reads only;
// the only writes it points at are the two that approve or reject a recommendation, and those are gated.
import type { Parsed, Rec } from "../envelope.ts";
import { copy, type Mode } from "../copy.ts";
import { money, num as fmtNum, shortDate } from "../format.ts";
import { footer, type FooterLine } from "../primitives/footer.ts";
import { kv, type KvRow, type KvSection } from "../primitives/kv.ts";
import { breadcrumb } from "../primitives/rule.ts";
import { table, type TableCell, type TableColumn } from "../primitives/table.ts";
import { teach } from "../argv.ts";
import { paint, type Role, type Theme } from "../tokens.ts";
import { wrap } from "../ansi.ts";
import { shellJoin } from "../argv.ts";
import { checks, type Check, type DoctorInput } from "./doctor.ts";
import { gaps, peopleSummary, type Gap, type GtmInput } from "./gtm.ts";
import { limitsOf, type MoneyInput } from "./money.ts";
import { forSale, plansOf, type StoreInput } from "./store.ts";
import { rankGroups, type RankInput, type RankedGroup } from "./rank.ts";

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const rows = (p: Parsed | undefined): Rec[] | undefined => (p && p.ok && p.payload.kind === "page" ? p.payload.rows : undefined);
const errLine = (p: Parsed) => (p.ok ? "" : `${p.error.code} ${p.error.message.split("\n")[0]}`);

export type Unit = "count" | "currency" | "percent";

/** The six numbers, in the order the brief reads them. */
export const REPORT_METRICS: { key: string; unit: Unit }[] = [
  { key: "page_visits", unit: "count" },
  { key: "new_users", unit: "count" },
  { key: "gross_revenue", unit: "currency" },
  { key: "net_revenue", unit: "currency" },
  { key: "ad_spend", unit: "currency" },
  { key: "churn_rate", unit: "percent" },
];

export interface MetricPair {
  key: string;
  unit: Unit;
  now: Parsed;
  prev: Parsed;
}

export interface ReportInput {
  accountTitle?: string;
  accountId?: string;
  mode?: Mode;
  window: { from: string; to: string; prevFrom: string; prevTo: string; days: number };
  metrics: MetricPair[];
  doctor: DoctorInput;
  gtm: GtmInput;
  money: MoneyInput;
  store: StoreInput;
  /** One per live campaign, up to three. */
  ranks: RankInput[];
  /** `economic-intelligence list --status ready` */
  recommendations: Parsed;
  generatedAt: string;
  commands: string[][];
}

export interface Kpi {
  key: string;
  unit: Unit;
  now?: number;
  prev?: number;
  /** Relative change, now against prev, when both exist and prev is not zero. */
  change?: number;
  error?: string;
}

/** A series to one number: counts and money sum, rates average the points that exist. */
export function total(p: Parsed, unit: Unit): { value?: number; currency?: string; error?: string } {
  if (!p.ok) return { error: errLine(p) };
  if (p.payload.kind !== "series") return { value: undefined };
  const values = p.payload.points.map((pt) => pt.value).filter((v) => Number.isFinite(v));
  if (!values.length) return { value: 0, currency: p.payload.currency };
  const sum = values.reduce((a, b) => a + b, 0);
  return { value: unit === "percent" ? sum / values.length : sum, currency: p.payload.currency };
}

export function kpis(metrics: MetricPair[]): Kpi[] {
  return metrics.map((m) => {
    const now = total(m.now, m.unit);
    const prev = total(m.prev, m.unit);
    const change = now.value !== undefined && prev.value !== undefined && prev.value !== 0 ? (now.value - prev.value) / Math.abs(prev.value) : undefined;
    return { key: m.key, unit: m.unit, now: now.value, prev: prev.value, change, error: now.error ?? prev.error };
  });
}

export const fmtValue = (v: number | undefined, unit: Unit, currency = "usd") => (v === undefined ? copy.detail.empty : unit === "currency" ? money(v, currency) : unit === "percent" ? `${(v * 100).toFixed(1)}%` : fmtNum(v));
export const fmtChange = (c: number | undefined) => (c === undefined ? copy.detail.empty : `${c > 0 ? "+" : ""}${Math.round(c * 100)}%`);

/** A campaign's groups reduced to what the brief says: how many wait, hold, scale, pause. */
export function rankSummary(r: RankInput): { title: string; id: string; groups: RankedGroup[]; verdicts: Record<string, number>; action?: RankedGroup } {
  const groups = rankGroups(r);
  const verdicts: Record<string, number> = {};
  for (const g of groups) verdicts[g.verdict] = (verdicts[g.verdict] ?? 0) + 1;
  const action = groups.find((g) => g.verdict === "pause") ?? groups.find((g) => g.verdict === "scale") ?? groups.find((g) => g.verdict === "rejected" || g.verdict === "not_delivering");
  return { title: str(r.campaign?.title) ?? r.campaignId, id: r.campaignId, groups, verdicts, action };
}

/** The things the brief asks the person to do, as wv commands, from everything it read. */
export function nextActions(input: ReportInput): { label: string; what: string; argv: string[] }[] {
  const c = copy.report;
  const out: { label: string; what: string; argv: string[] }[] = [];
  for (const ch of checks(input.doctor)) if (ch.level === "fail" && ch.fix) out.push({ label: `${c.fix} ${ch.label}`, what: ch.detail, argv: ch.fix });
  for (const g of gaps(input.gtm, peopleSummary(input.gtm.people))) if (g.fix) out.push({ label: c.gap, what: g.what, argv: g.fix });
  for (const r of input.ranks) {
    const s = rankSummary(r);
    if (s.action?.action) out.push({ label: copy.rank.verdicts[s.action.verdict], what: `${s.title}: ${copy.rank.verdicts[s.action.verdict]} ${s.action.title}`, argv: s.action.action });
  }
  for (const rec of rows(input.recommendations) ?? []) out.push({ label: c.approveShort, what: c.approve(str(rec.title) ?? String(rec.id)), argv: ["wv", "economic-intelligence", "update", String(rec.id), "--status", "executed"] });
  const limits = limitsOf(input.money.methods);
  if (limits.standard?.code) out.push({ label: c.unblockPayouts, what: c.unblockPayouts, argv: ["whop", "verifications", "create", "--account_id", input.accountId ?? "<biz_id>"] });
  return out;
}

export function reportData(input: ReportInput): Rec {
  const doctorChecks = checks(input.doctor);
  const people = peopleSummary(input.gtm.people);
  const storePlans = rows(input.store.plans) ?? [];
  const products = rows(input.store.products) ?? [];
  return {
    ok: input.metrics.every((m) => m.now.ok && m.prev.ok),
    account: input.accountId || input.accountTitle ? { id: input.accountId, title: input.accountTitle } : undefined,
    mode: input.mode ?? "production",
    generatedAt: input.generatedAt,
    window: input.window,
    kpis: kpis(input.metrics),
    doctor: { ok: !doctorChecks.some((c) => c.blocking && c.level === "fail"), failing: doctorChecks.filter((c) => c.level !== "ok").map((c) => ({ key: c.key, level: c.level, detail: c.detail, fix: c.fix })) },
    gaps: gaps(input.gtm, people),
    people: { seen: people.seen, attributed: people.attributed },
    money: { balances: input.money.balances, payoutsBlocked: limitsOf(input.money.methods).standard?.code ?? null },
    store: { products: products.length, forSale: products.filter((p) => forSale(p, plansOf(storePlans, String(p.id))).ok).length, activeCodes: (rows(input.store.promoCodes) ?? []).length },
    campaigns: input.ranks.map((r) => {
      const s = rankSummary(r);
      return { id: s.id, title: s.title, verdicts: s.verdicts, groups: s.groups.map((g) => ({ id: g.id, title: g.title, spend: g.spend, results: g.results, costPerResult: g.costPerResult, verdict: g.verdict })) };
    }),
    recommendations: rows(input.recommendations)?.map((r) => ({ id: r.id, title: r.title, action_type: r.action_type, reasoning: r.reasoning })) ?? { error: errLine(input.recommendations) },
    next: nextActions(input).map((a) => ({ what: a.what, run: a.argv })),
    commands: input.commands.map((c) => teach(c)),
  };
}

const CHECK_ROLE: Record<Check["level"], Role> = { ok: "good", warn: "warn", fail: "bad" };

function kpiTable(input: ReportInput, theme: Theme): string[] {
  const c = copy.report;
  const cols: TableColumn[] = [
    { key: "metric", label: c.cols.metric, align: "left", priority: 0 },
    { key: "now", label: c.cols.thisWeek, align: "right", priority: 0 },
    { key: "prev", label: c.cols.lastWeek, align: "right", priority: 1 },
    { key: "change", label: c.cols.change, align: "right", priority: 2 },
  ];
  const cells = kpis(input.metrics).map((k) => {
    const row: Record<string, TableCell> = {};
    const cur = (input.metrics.find((m) => m.key === k.key)?.now.ok && (input.metrics.find((m) => m.key === k.key)!.now as { payload: { currency?: string } }).payload.currency) || "usd";
    row.metric = { text: c.metrics[k.key] ?? k.key.replace(/_/g, " "), role: "text" };
    row.now = { text: k.error ? k.error : fmtValue(k.now, k.unit, cur), role: k.error ? "warn" : k.now ? "text" : "muted" };
    row.prev = { text: fmtValue(k.prev, k.unit, cur), role: "muted" };
    const good = k.key === "churn_rate" || k.key === "ad_spend" ? (k.change ?? 0) < 0 : (k.change ?? 0) > 0;
    row.change = { text: fmtChange(k.change), role: k.change === undefined ? "muted" : good ? "good" : "bad" };
    return row;
  });
  return table(cols, cells, theme).lines;
}

export function reportView(input: ReportInput, theme: Theme): string[] {
  const c = copy.report;
  const out: string[] = [];
  out.push(...breadcrumb(theme, [[input.accountTitle ?? "", "accent"], [input.accountId ?? "", "muted"], [copy.session.mode(input.mode ?? "production"), input.mode === "sandbox" ? "good" : "warn"], [c.title, "accent"], [c.window(shortDate(input.window.from), shortDate(input.window.to), shortDate(input.window.prevFrom), shortDate(input.window.prevTo)), "muted"]]));
  out.push("");
  out.push(...kpiTable(input, theme), "");

  const doctorChecks = checks(input.doctor).filter((ch) => ch.level !== "ok");
  const gapList = gaps(input.gtm, peopleSummary(input.gtm.people));
  const blockers: KvRow[] = [
    ...doctorChecks.map((ch) => ({ key: ch.label, value: ch.detail, role: CHECK_ROLE[ch.level] })),
    ...gapList.map((g: Gap) => ({ key: c.gap, value: g.what, role: "warn" as Role })),
  ];
  const limits = limitsOf(input.money.methods);
  const storePlans = rows(input.store.plans) ?? [];
  const products = rows(input.store.products) ?? [];
  const sale = products.filter((p) => forSale(p, plansOf(storePlans, String(p.id))).ok).length;
  const status: KvRow[] = [
    { key: c.money, value: [...input.money.balances.map((b) => (b.error ? `${b.currency} ${b.error}` : `${money(b.available ?? 0, b.currency)} ${copy.money.available}`)), limits.standard?.code ? c.payoutsBlocked : c.payoutsOk].join(" · "), role: limits.standard?.code ? "warn" : "text" },
    { key: c.store, value: c.storeLine(sale, products.length, (rows(input.store.promoCodes) ?? []).length), role: sale ? "text" : "warn" },
    { key: c.people, value: (() => { const p = peopleSummary(input.gtm.people); return p.text; })(), role: "muted" },
  ];
  const sections: KvSection[] = [{ title: c.status, rows: status }];
  if (blockers.length) sections.push({ title: c.blockers, rows: blockers });
  out.push(...kv(sections, theme), "");

  out.push(" " + paint(theme, "accent", c.campaigns));
  if (!input.ranks.length) out.push(...wrap(c.noCampaigns, theme.width - 1).map((l) => " " + paint(theme, "muted", l)));
  for (const r of input.ranks) {
    const s = rankSummary(r);
    const parts = Object.entries(s.verdicts).map(([v, n]) => `${n} ${copy.rank.verdicts[v]}`);
    out.push(...kv([{ rows: [{ key: s.title, value: [`${s.groups.length} ${s.groups.length === 1 ? "group" : "groups"}`, ...parts, s.action ? `${copy.rank.verdicts[s.action.verdict]}: ${s.action.title}` : ""].filter(Boolean).join(" · "), role: s.action?.verdict === "pause" ? "bad" : s.action?.verdict === "scale" ? "good" : "text" }] }], theme));
  }
  out.push("");

  out.push(" " + paint(theme, "accent", c.recommendations));
  const recs = rows(input.recommendations);
  if (!recs) out.push(...wrap(errLine(input.recommendations), theme.width - 1).map((l) => " " + paint(theme, "muted", l)));
  else if (!recs.length) out.push(...wrap(c.noRecommendations, theme.width - 1).map((l) => " " + paint(theme, "muted", l)));
  else out.push(...kv([{ rows: recs.slice(0, 5).map((r) => ({ key: String(r.id), value: [str(r.title) ?? "", str(r.action_type)?.replace(/_/g, " ") ?? ""].filter(Boolean).join(" · "), role: "text" as Role })) }], theme));
  out.push("");

  const lines: FooterLine[] = nextActions(input).map((a) => [a.label, a.argv] as FooterLine);
  lines.push([c.md, ["wv", "report", "--md"]]);
  out.push(...footer(lines, theme), "");
  return out;
}

/** The brief as Markdown, for a schedule that posts it. Same facts, no color, no width. */
export function reportMarkdown(input: ReportInput): string[] {
  const c = copy.report;
  const d = reportData(input) as { kpis: Kpi[]; doctor: { failing: { key: string; level: string; detail: string; fix?: string[] }[] }; gaps: Gap[]; money: { balances: { currency: string; available?: number; error?: string }[]; payoutsBlocked: string | null }; store: { products: number; forSale: number; activeCodes: number }; campaigns: { title: string; verdicts: Record<string, number>; groups: { title: string; verdict: string; costPerResult?: number }[] }[]; recommendations: { id: string; title?: string; action_type?: string }[] | { error: string }; next: { what: string; run: string[] }[] };
  const out: string[] = [`# ${c.mdTitle(input.accountTitle ?? input.accountId ?? "")}`, "", `${c.window(shortDate(input.window.from), shortDate(input.window.to), shortDate(input.window.prevFrom), shortDate(input.window.prevTo))} · ${c.generated(input.generatedAt)}`, ""];
  out.push(`| ${c.cols.metric} | ${c.cols.thisWeek} | ${c.cols.lastWeek} | ${c.cols.change} |`, "|---|---:|---:|---:|");
  for (const k of d.kpis) out.push(`| ${c.metrics[k.key] ?? k.key} | ${k.error ? k.error : fmtValue(k.now, k.unit)} | ${fmtValue(k.prev, k.unit)} | ${fmtChange(k.change)} |`);
  out.push("");
  out.push(`## ${c.status}`, "", `- ${c.money}: ${d.money.balances.map((b) => (b.error ? `${b.currency} ${b.error}` : `${money(b.available ?? 0, b.currency)} ${copy.money.available}`)).join(", ")}${d.money.payoutsBlocked ? ` · ${c.payoutsBlocked}` : ""}`, `- ${c.store}: ${c.storeLine(d.store.forSale, d.store.products, d.store.activeCodes)}`, "");
  if (d.doctor.failing.length || d.gaps.length) {
    out.push(`## ${c.blockers}`, "");
    for (const f of d.doctor.failing) out.push(`- **${f.key}** (${f.level}): ${f.detail}${f.fix ? ` · \`${shellJoin(f.fix)}\`` : ""}`);
    for (const g of d.gaps) out.push(`- ${g.what}${g.fix ? ` · \`${shellJoin(g.fix)}\`` : ""}`);
    out.push("");
  }
  out.push(`## ${c.campaigns}`, "");
  if (!d.campaigns.length) out.push(c.noCampaigns, "");
  for (const cp of d.campaigns) {
    out.push(`- **${cp.title}**: ${Object.entries(cp.verdicts).map(([v, n]) => `${n} ${copy.rank.verdicts[v]}`).join(", ")}`);
    for (const g of cp.groups) out.push(`  - ${g.title} · ${copy.rank.verdicts[g.verdict]}${g.costPerResult !== undefined ? ` · ${money(g.costPerResult)} per result` : ""}`);
  }
  if (d.campaigns.length) out.push("");
  out.push(`## ${c.recommendations}`, "");
  if (Array.isArray(d.recommendations)) {
    if (!d.recommendations.length) out.push(c.noRecommendations, "");
    for (const r of d.recommendations) out.push(`- ${r.title ?? r.id}${r.action_type ? ` · ${r.action_type.replace(/_/g, " ")}` : ""} · \`${r.id}\``);
    if (d.recommendations.length) out.push("");
  } else out.push(d.recommendations.error, "");
  out.push(`## ${c.next}`, "");
  if (!d.next.length) out.push(c.nothingToDo, "");
  for (const n of d.next) out.push(`- ${n.what}: \`${shellJoin(n.run)}\``);
  out.push("");
  return out;
}
