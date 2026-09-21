// One screen for the go-to-market loop: funnel numbers over a window, who is here, audiences, live
// campaigns, offers, and the one-time gaps that block a launch. Every number is a `whop` command
// the footer teaches. Reads only.
import { plain, type Parsed, type Rec } from "../envelope.ts";
import { money, num, shortDate } from "../format.ts";
import { footer } from "../primitives/footer.ts";
import { kv, type KvRow } from "../primitives/kv.ts";
import { breadcrumb, rule } from "../primitives/rule.ts";
import { table, type TableCell, type TableColumn } from "../primitives/table.ts";
import { teach } from "../argv.ts";
import { paint, type Role, type Theme } from "../tokens.ts";
import { wrap } from "../ansi.ts";
import { copy, type Mode } from "../copy.ts";
import { sparkline } from "./home.ts";
import { statusLabel, statusRole } from "../status.ts";

export interface GtmInput {
  accountTitle?: string;
  accountId?: string;
  mode?: Mode;
  from: string;
  to: string;
  /** `stats get <metric>` series, keyed by metric. */
  series: Record<string, Parsed>;
  people: Parsed;
  audiences: Parsed;
  campaigns: Parsed;
  promoCodes: Parsed;
  social: Parsed;
  preferences: Parsed;
  /** Every command that fed the screen, in order, for the footer. */
  commands: string[][];
}

const rows = (p: Parsed): Rec[] | undefined => (p.ok && p.payload.kind === "page" ? p.payload.rows : undefined);
const errLine = (p: Parsed) => (p.ok ? "" : `${p.error.code} ${p.error.message.split("\n")[0]}`);
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** Whop returns only the days with a value; lay the points onto every day of the window so sparklines line up. */
export function daySeries(points: { timestamp: number; value: number }[], from: string, days: number): number[] {
  const start = Date.parse(from) / 1000;
  const out = new Array<number>(days).fill(0);
  for (const p of points) {
    const i = Math.floor((p.timestamp - start) / 86_400);
    if (i >= 0 && i < days) out[i] += p.value;
  }
  return out;
}

/** A metric line: the total and a sparkline over the window. */
export function seriesLine(p: Parsed, isMoney: boolean, from: string, days: number): { total: string; spark: string; role: Role } {
  if (!p.ok) return { total: errLine(p), spark: "", role: "warn" };
  if (p.payload.kind !== "series") return { total: copy.detail.empty, spark: "", role: "muted" };
  const values = daySeries(p.payload.points, from, days);
  const total = values.reduce((a, b) => a + b, 0);
  return { total: isMoney ? money(total, p.payload.currency ?? "usd") : num(total), spark: sparkline(values), role: total === 0 ? "muted" : "text" };
}

/** Counts a page of people: seen, customers, contactable, and how many carry any source at all. */
export function peopleSummary(p: Parsed): { text: string; role: Role; attributed: number; seen: number } {
  const list = rows(p);
  if (!list) return { text: errLine(p) || copy.detail.empty, role: p.ok ? "muted" : "warn", attributed: 0, seen: 0 };
  const seen = list.length;
  const customers = list.filter((r) => r.has_purchased === true || Number(r.purchase_count) > 0).length;
  const contactable = list.filter((r) => str(r.email) || str(r.phone)).length;
  const attributed = list.filter((r) => str(r.first_source) || str(r.last_source)).length;
  const more = p.ok && p.payload.kind === "page" && p.payload.page.has_next_page ? "+" : "";
  return { text: seen ? copy.gtm.people(`${seen}${more}`, customers, contactable, attributed) : copy.gtm.noPeople, role: seen ? "text" : "muted", attributed, seen };
}

export interface Gap {
  what: string;
  fix?: string[];
}

/** The one-time setup a launch needs, read from what the screen already fetched. */
export function gaps(input: GtmInput, people: { attributed: number; seen: number }): Gap[] {
  const out: Gap[] = [];
  if (people.seen > 0 && people.attributed === 0) out.push({ what: copy.gtm.gap.pixel, fix: ["whop", "events", "validate_pixel"] });
  const social = rows(input.social);
  if (social && !social.some((s) => !s.error)) out.push({ what: copy.gtm.gap.page, fix: ["whop", "social-accounts", "connect", "--platform", "meta_business", "--scopes", "advertise", "--redirect_url", "<url>"] });
  const prefs = input.preferences.ok && "record" in input.preferences.payload ? input.preferences.payload.record : undefined;
  if (prefs) {
    const pm = prefs.ads_payment_methods;
    if (pm == null || (Array.isArray(pm) && pm.length === 0)) out.push({ what: copy.gtm.gap.payment });
    if (prefs.economic_intelligence === false) out.push({ what: copy.gtm.gap.ei, fix: ["whop", "accounts", "update-preferences", "--economic_intelligence", "true"] });
  }
  return out;
}

function campaignTable(p: Parsed, theme: Theme): string[] {
  const list = rows(p);
  if (!list) return [" " + paint(theme, p.ok ? "muted" : "warn", errLine(p) || copy.detail.empty)];
  if (!list.length) return [" " + paint(theme, "muted", copy.gtm.noCampaigns), ...footer([[copy.gtm.try, ["wv", "ads", "create", "--help"]]], theme)];
  const cols: TableColumn[] = [
    { key: "title", label: "campaign", align: "left", priority: 0, max: 28 },
    { key: "status", label: "status", align: "left", priority: 2 },
    { key: "delivery_status", label: "delivery", align: "left", priority: 4 },
    { key: "spend", label: "spend", align: "right", priority: 1 },
    { key: "results", label: "results", align: "right", priority: 3 },
    { key: "cost_per_result", label: "cpr", align: "right", priority: 5 },
    { key: "return_on_ad_spend", label: "roas", align: "right", priority: 6 },
  ];
  const cells = list.map((r) => {
    const c: Record<string, TableCell> = {};
    const cur = str(r.spend_currency) ?? "usd";
    c.title = { text: str(r.title) ?? str(r.id) ?? "", role: "text" };
    c.status = { text: statusLabel(str(r.status) ?? ""), role: statusRole(str(r.status) ?? "") };
    c.delivery_status = { text: statusLabel(str(r.delivery_status) ?? ""), role: "muted" };
    c.spend = { text: money(Number(r.spend ?? 0), cur), role: "text" };
    c.results = { text: r.results == null ? copy.detail.empty : num(Number(r.results)), role: "text" };
    c.cost_per_result = { text: r.cost_per_result == null ? copy.detail.empty : money(Number(r.cost_per_result), cur), role: "text" };
    c.return_on_ad_spend = { text: typeof r.return_on_ad_spend === "number" ? `${r.return_on_ad_spend.toFixed(2)}×` : copy.detail.empty, role: "text" };
    return c;
  });
  return table(cols, cells, theme).lines;
}

function audienceRows(p: Parsed): KvRow[] {
  const list = rows(p);
  if (!list) return [{ key: copy.gtm.audiences, value: errLine(p) || copy.detail.empty, role: p.ok ? "muted" : "warn" }];
  if (!list.length) return [{ key: copy.gtm.none, value: copy.gtm.noAudiences, role: "muted" }];
  return list.slice(0, 6).map((a) => ({
    key: str(a.name) ?? str(a.id) ?? copy.gtm.audiences,
    value: [statusLabel(str(a.status) ?? ""), str(a.audience_type) === "lookalike" ? copy.gtm.lookalike : str(a.source_type)?.replace(/_/g, " "), typeof a.total_rows === "number" ? copy.gtm.members(a.total_rows) : ""].filter(Boolean).join(" · "),
    role: statusRole(str(a.status) ?? ""),
  }));
}

function offerRows(p: Parsed): KvRow[] {
  const list = rows(p);
  if (!list) return [{ key: copy.gtm.offers, value: errLine(p) || copy.detail.empty, role: p.ok ? "muted" : "warn" }];
  if (!list.length) return [{ key: copy.gtm.none, value: copy.gtm.noOffers, role: "muted" }];
  return list.slice(0, 6).map((c) => {
    const off = c.promo_type === "percentage" ? `${c.amount_off}%` : money(Number(c.amount_off ?? 0), str(c.currency) ?? "usd");
    const who = c.new_users_only ? copy.gtm.newUsers : c.churned_users_only ? copy.gtm.churned : c.existing_memberships_only ? copy.gtm.existing : "";
    const bits = [statusLabel(str(c.status) ?? ""), `${off} ${copy.gtm.off}`, who, typeof c.uses === "number" ? copy.gtm.uses(c.uses, c.unlimited_stock ? undefined : Number(c.stock)) : "", str(c.expires_at) ? copy.gtm.expires(shortDate(c.expires_at as string)) : ""].filter(Boolean);
    return { key: str(c.code) ?? str(c.id) ?? "", value: bits.join(" · "), role: statusRole(str(c.status) ?? "") };
  });
}

/** The screen as data: `wv gtm --format json`. Every envelope the screen read, the people summary, and the gaps with their fixes. */
export function gtmData(input: GtmInput): Rec {
  const people = peopleSummary(input.people);
  const series: Rec = {};
  for (const [metric, p] of Object.entries(input.series)) series[metric] = plain(p);
  const failed = [...Object.values(input.series), input.people, input.audiences, input.campaigns, input.promoCodes, input.social, input.preferences].filter((p) => !p.ok).length;
  return {
    ok: failed === 0,
    account: input.accountId || input.accountTitle ? { id: input.accountId, title: input.accountTitle } : undefined,
    mode: input.mode ?? "production",
    window: { from: input.from, to: input.to },
    series,
    people: { seen: people.seen, attributed: people.attributed, ...plain(input.people) },
    audiences: plain(input.audiences),
    campaigns: plain(input.campaigns),
    promo_codes: plain(input.promoCodes),
    social_accounts: plain(input.social),
    preferences: plain(input.preferences),
    gaps: gaps(input, people),
    commands: input.commands.map((c) => teach(c)),
  };
}

export function gtmView(input: GtmInput, theme: Theme): string[] {
  const out: string[] = [];
  const days = Math.round((Date.parse(input.to) - Date.parse(input.from)) / 86_400_000) + 1;
  out.push(
    ...breadcrumb(theme, [
      [input.accountTitle ?? "", "accent"],
      [input.accountId ?? "", "muted"],
      [copy.session.mode(input.mode ?? "production"), input.mode === "sandbox" ? "good" : "warn"],
      [copy.gtm.title, "accent"],
      [copy.gtm.window(days, shortDate(input.from), shortDate(input.to)), "muted"],
    ]),
  );
  out.push("");

  const lines = [
    [copy.gtm.visits, seriesLine(input.series.page_visits, false, input.from, days)],
    [copy.gtm.newUsersKey, seriesLine(input.series.new_users, false, input.from, days)],
    [copy.gtm.revenue, seriesLine(input.series.gross_revenue, true, input.from, days)],
    [copy.gtm.adSpend, seriesLine(input.series.ad_spend, true, input.from, days)],
  ] as const;
  // Totals right-align to the widest so the sparklines start in one column.
  const totalW = Math.max(...lines.map(([, l]) => l.total.length));
  const funnel: KvRow[] = lines.map(([key, l]) => ({ key, value: (l.spark ? l.total.padStart(totalW) + "  " + l.spark : l.total).trimEnd(), role: l.role }));
  const people = peopleSummary(input.people);
  out.push(...kv([{ title: copy.gtm.funnel, rows: funnel }, { title: copy.gtm.peopleTitle, rows: [{ key: copy.gtm.seen(days), value: people.text, role: people.role }] }, { title: copy.gtm.audiences, rows: audienceRows(input.audiences) }], theme));
  out.push("", rule(theme, copy.gtm.campaigns));
  out.push(...campaignTable(input.campaigns, theme));
  out.push("", ...kv([{ title: copy.gtm.offers, rows: offerRows(input.promoCodes) }], theme));

  const g = gaps(input, people);
  if (g.length) {
    out.push("", rule(theme, copy.gtm.gapsTitle, "warn"));
    for (const gap of g) {
      const [first, ...rest] = wrap(gap.what, theme.width - 4);
      out.push(" " + paint(theme, "warn", "✗") + " " + first);
      for (const l of rest) out.push("   " + l);
      if (gap.fix) out.push(...footer([[copy.gtm.fix, gap.fix]], theme));
    }
  }
  out.push("");
  out.push(...footer(input.commands.map((c, i): [string, string[]] => [i === 0 ? copy.list.json : " ".repeat(copy.list.json.length), teach(c)]), theme));
  return out;
}
