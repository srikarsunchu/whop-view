// Plan-as-sandbox for ads. The CLI has no dry-run, so before an ad write wv fetches the tree the
// command touches, runs `ad-groups estimate_reach` for real, and puts campaign, group, ad, reach,
// committed spend, and what pays for it on one card. Nothing spends until the person types the budget.
import type { Rec } from "../envelope.ts";
import { compact, money, shortDate, now } from "../format.ts";
import { callout } from "../primitives/callout.ts";
import { footer } from "../primitives/footer.ts";
import { kv, type KvRow } from "../primitives/kv.ts";
import { paint, type Role, type Theme } from "../tokens.ts";
import { copy, type Mode } from "../copy.ts";
import { wrap } from "../ansi.ts";
import { shellJoin } from "../argv.ts";
import { flagsToRecord } from "./confirm.ts";

export const AD_GROUPS = new Set(["ads", "ad-groups", "ad-campaigns"]);
const PLAN_VERBS = new Set(["create", "update"]);

/** Writes that get the plan card: creates and updates under the three ad groups. */
export const isAdPlan = (group: string, verb: string | undefined) => AD_GROUPS.has(group) && !!verb && PLAN_VERBS.has(verb);

const isObj = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const numOf = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** `flagsToRecord`, plus object and array flags parsed from the JSON the CLI accepts for them. */
export function jsonFlags(argv: string[]): Rec {
  const rec = flagsToRecord(argv);
  for (const [k, v] of Object.entries(rec)) {
    if (typeof v !== "string" || !/^\s*[[{]/.test(v)) continue;
    try {
      rec[k] = JSON.parse(v);
    } catch {
      /* leave the string; whop will reject it with a field error */
    }
  }
  return rec;
}

export interface AdNode {
  id?: string;
  /** True when this command creates it. */
  isNew: boolean;
  /** Its fields: the flags for a new node, the fetched record for an existing one. */
  rec: Rec;
}

export interface AdTree {
  campaign?: AdNode;
  group?: AdNode;
  ad?: AdNode;
}

/** The nodes a command line names, before any fetch. Ids are filled from `--*_id` flags and positionals. */
export function treeFromArgv(group: string, verb: string, argv: string[]): AdTree {
  const flags = jsonFlags(argv);
  const positional = argv.slice(2).find((a) => !a.startsWith("--") && !Object.values(flags).some((v) => String(v) === a));
  const own: AdNode = verb === "create" ? { isNew: true, rec: flags } : { id: positional, isNew: false, rec: flags };
  const tree: AdTree = {};
  if (group === "ad-campaigns") tree.campaign = own;
  if (group === "ad-groups") {
    tree.group = own;
    if (str(flags.ad_campaign_id)) tree.campaign = { id: str(flags.ad_campaign_id), isNew: false, rec: {} };
  }
  if (group === "ads") {
    tree.ad = own;
    if (isObj(flags.ad_group)) {
      tree.group = { isNew: true, rec: flags.ad_group };
      if (str(flags.ad_group.ad_campaign_id)) tree.campaign = { id: str(flags.ad_group.ad_campaign_id), isNew: false, rec: {} };
    } else if (str(flags.ad_group_id)) tree.group = { id: str(flags.ad_group_id), isNew: false, rec: {} };
  }
  return tree;
}

export interface Budget {
  amount: number;
  type: "daily" | "lifetime";
  owner: "campaign" | "group";
  /** True when the command line itself carries the budget, so the person types it back. */
  typed: boolean;
  startsAt?: string;
  endsAt?: string;
}

/** The budget the tree will spend from: the one on the command line first, then the group's, then a campaign that owns it. */
export function budgetOf(tree: AdTree, ownFlags: Rec): Budget | undefined {
  const pick = (rec: Rec, owner: Budget["owner"], typed: boolean): Budget | undefined => {
    const amount = numOf(rec.budget_amount);
    if (amount === undefined) return undefined;
    return { amount, type: rec.budget_type === "lifetime" ? "lifetime" : "daily", owner, typed, startsAt: str(rec.starts_at), endsAt: str(rec.ends_at) };
  };
  const nested = isObj(ownFlags.ad_group) ? ownFlags.ad_group : undefined;
  return (
    pick(ownFlags, "budget_optimization" in ownFlags || tree.campaign?.isNew ? "campaign" : "group", true) ??
    (nested && pick(nested, "group", true)) ??
    (tree.group && pick(tree.group.rec, "group", false)) ??
    (tree.campaign && tree.campaign.rec.budget_optimization === "ad_campaign" ? pick(tree.campaign.rec, "campaign", false) : undefined)
  );
}

export const DEFAULT_HORIZON_DAYS = 30;

export interface Commitment {
  total: number;
  days: number;
  /** No end date: the total is over the default horizon, not a real cap. */
  openEnded: boolean;
}

/** What the budget commits: daily × days until `ends_at`, or over the default horizon when there is no end. Lifetime is itself. */
export function commitment(b: Budget, at: number = now()): Commitment {
  const start = b.startsAt ? Math.max(Date.parse(b.startsAt), at) : at;
  const end = b.endsAt ? Date.parse(b.endsAt) : NaN;
  const openEnded = !Number.isFinite(end);
  const days = openEnded ? DEFAULT_HORIZON_DAYS : Math.max(1, Math.ceil((end - start) / 86_400_000));
  return { total: b.type === "daily" ? b.amount * days : b.amount, days, openEnded };
}

/** One line for the ad group's targeting, from either the flags or the fetched record. */
export function describeTargeting(rec: Rec, audienceNames: Record<string, string> = {}): string {
  const parts: string[] = [];
  const regions = isObj(rec.regions) ? rec.regions : undefined;
  const inc = regions && isObj(regions.include) ? regions.include : undefined;
  if (inc) {
    const places: string[] = [];
    for (const k of ["country_groups", "countries", "regions"]) if (Array.isArray(inc[k])) places.push(...inc[k].map(String));
    for (const k of ["cities", "zips", "custom_locations"]) if (Array.isArray(inc[k])) places.push(...inc[k].map((c: unknown) => (isObj(c) ? String(c.name ?? c.key ?? c.zip ?? "") : String(c))).filter(Boolean));
    if (places.length) parts.push(places.slice(0, 4).join(", ") + (places.length > 4 ? ` +${places.length - 4}` : ""));
  }
  const exc = regions && isObj(regions.exclude) ? regions.exclude : undefined;
  if (exc) {
    const n = Object.values(exc).reduce<number>((a, v) => a + (Array.isArray(v) ? v.length : 0), 0);
    if (n) parts.push(copy.adplan.excluding(n));
  }
  const demo = isObj(rec.demographics) ? rec.demographics : undefined;
  if (demo?.automatic === true) parts.push(copy.adplan.automaticAudience);
  else if (demo) {
    const lo = numOf(demo.minimum_age);
    const hi = numOf(demo.maximum_age);
    if (lo !== undefined || hi !== undefined) parts.push(copy.adplan.ages(lo, hi));
    if (typeof demo.gender === "string" && demo.gender !== "all") parts.push(String(demo.gender));
  }
  const dt = isObj(rec.detailed_targeting) ? rec.detailed_targeting : undefined;
  if (dt) {
    for (const k of ["interests", "behaviors", "demographics"]) {
      const list = Array.isArray(dt[k]) ? (dt[k] as unknown[]) : [];
      if (!list.length) continue;
      const names = list.map((x) => (isObj(x) ? str(x.name) : undefined)).filter((x): x is string => !!x);
      parts.push(`${k}: ${names.length ? names.slice(0, 3).join(", ") + (list.length > 3 ? ` +${list.length - 3}` : "") : list.length}`);
    }
  }
  const aud = isObj(rec.audiences) ? rec.audiences : undefined;
  if (aud) {
    const name = (id: unknown) => (isObj(id) ? str(id.name) ?? str(id.id) ?? "" : audienceNames[String(id)] ?? String(id));
    if (Array.isArray(aud.include) && aud.include.length) parts.push(copy.adplan.audiences(aud.include.map(name)));
    if (Array.isArray(aud.exclude) && aud.exclude.length) parts.push(copy.adplan.excludingAudiences(aud.exclude.map(name)));
  }
  if (Array.isArray(rec.languages) && rec.languages.length) parts.push(rec.languages.map(String).join(", "));
  const pl = rec.placements;
  if (pl === "automatic" || (Array.isArray(pl) && pl.length === 0)) parts.push(copy.adplan.automaticPlacements);
  else if (Array.isArray(pl)) parts.push(copy.adplan.placements(pl.map((p) => (isObj(p) ? String(p.platform ?? "") : String(p))).filter(Boolean)));
  return parts.join(" · ");
}

export interface Reach {
  lower?: number;
  upper?: number;
  /** Whop's own words when it could not estimate. */
  error?: string;
}

/** The reach line and its role. Null bounds mean the platform had no estimate. */
export function describeReach(r: Reach | undefined, platform: string): { text: string; role: Role } {
  if (!r) return { text: copy.adplan.reachSkipped, role: "muted" };
  if (r.error) return { text: copy.adplan.reachFailed(r.error), role: "warn" };
  if (r.lower == null && r.upper == null) return { text: copy.adplan.reachNone(platform), role: "warn" };
  const lo = r.lower ?? r.upper ?? 0;
  const hi = r.upper ?? r.lower ?? 0;
  return { text: copy.adplan.reach(lo === hi ? compact(lo) : `${compact(lo)}–${compact(hi)}`, platform), role: "text" };
}

/** `sacc_` rows as one line: `Frame (facebook) @frame`, with the platform's error when it has one. */
export function describeSocial(rows: Rec[]): { text: string; role: Role } {
  const usable = rows.filter((r) => !r.error);
  const pick = usable[0] ?? rows[0];
  if (!pick) return { text: copy.adplan.noSocial, role: "warn" };
  const label = [str(pick.name) ?? str(pick.username) ?? String(pick.id), pick.platform ? `(${pick.platform})` : "", str(pick.username) ? `@${pick.username}` : ""].filter(Boolean).join(" ");
  if (pick.error) return { text: `${label} · ${pick.error}`, role: "warn" };
  return { text: rows.length > 1 ? `${label} +${rows.length - 1}` : label, role: "text" };
}

export interface AdPlanInput {
  group: string;
  verb: string;
  argv: string[];
  tree: AdTree;
  budget?: Budget;
  reach?: Reach;
  /** Names for `adaud_` ids the group references. */
  audienceNames?: Record<string, string>;
  /** Connected pages that can run ads. Undefined when the list could not be read. */
  social?: Rec[];
  /** The account's ads payment method, in words. Undefined when not set. */
  paysFrom?: string;
  balance?: { available: number; currency: string };
  currency?: string;
  accountTitle?: string;
  accountId?: string;
  mode?: Mode;
  /** Cap on committed spend in whole currency units. `null` when off. Absent in sandbox or plan-only. */
  cap?: number | null;
  timeoutSeconds?: number;
  /** `--plan`: render the card, run nothing. */
  planOnly?: boolean;
}

const commandLine = (argv: string[]) => shellJoin(["whop", ...argv.filter((a) => a !== "--yes")]);

const nodeLabel = (n: AdNode, fallback: string) => {
  const title = str(n.rec.title) ?? str(n.rec.name);
  const id = n.id ?? str(n.rec.id);
  const head = title ?? id ?? fallback;
  const tail = [title && id ? id : "", n.isNew ? copy.adplan.new : ""].filter(Boolean).join("  ");
  return tail ? `${head}  ${tail}` : head;
};

function treeRows(input: AdPlanInput): KvRow[] {
  const { tree } = input;
  const cur = input.currency ?? "usd";
  const rows: KvRow[] = [];
  if (tree.campaign) {
    const c = tree.campaign.rec;
    const extra: [string, string][] = [];
    if (str(c.objective)) extra.push([copy.adplan.objective, String(c.objective)]);
    if (str(c.platform)) extra.push([copy.adplan.platform, String(c.platform)]);
    const owns = c.budget_optimization === "ad_campaign";
    if (owns && numOf(c.budget_amount) !== undefined) extra.push([copy.adplan.budget, `${money(c.budget_amount as number, cur)}/${c.budget_type === "lifetime" ? copy.adplan.lifetime : copy.adplan.day}`]);
    else if (c.budget_optimization) extra.push([copy.adplan.budget, copy.adplan.onGroups]);
    if (str(c.status)) extra.push([copy.adplan.status, String(c.status)]);
    rows.push({ key: copy.adplan.campaign, value: nodeLabel(tree.campaign, copy.adplan.campaign), role: tree.campaign.isNew ? "text" : "muted", extra: extra.length ? extra : undefined });
  }
  if (tree.group) {
    const g = tree.group.rec;
    const extra: [string, string][] = [];
    if (numOf(g.budget_amount) !== undefined) extra.push([copy.adplan.budget, `${money(g.budget_amount as number, cur)}/${g.budget_type === "lifetime" ? copy.adplan.lifetime : copy.adplan.day}`]);
    const goal = [str(g.optimization_goal), str(g.conversion_event) ? copy.adplan.on(String(g.conversion_event)) : ""].filter(Boolean).join(" ");
    if (goal) extra.push([copy.adplan.goal, goal]);
    const targeting = describeTargeting(g, input.audienceNames);
    if (targeting) extra.push([copy.adplan.targeting, targeting]);
    if (str(g.starts_at) || str(g.ends_at)) extra.push([copy.adplan.runs, copy.adplan.window(str(g.starts_at) ? shortDate(g.starts_at as string) : undefined, str(g.ends_at) ? shortDate(g.ends_at as string) : undefined)]);
    if (str(g.status) && !tree.group.isNew) extra.push([copy.adplan.status, String(g.status)]);
    rows.push({ key: copy.adplan.group, value: nodeLabel(tree.group, copy.adplan.group), role: tree.group.isNew ? "text" : "muted", extra: extra.length ? extra : undefined });
  }
  if (tree.ad) {
    const a = tree.ad.rec;
    const bits: string[] = [];
    if (str(a.call_to_action)) bits.push(String(a.call_to_action).replace(/_/g, " "));
    const count = (k: string, one: string, many: string) => (Array.isArray(a[k]) && a[k].length ? `${a[k].length} ${a[k].length === 1 ? one : many}` : "");
    for (const [k, one, many] of [["creatives", copy.adplan.creative, copy.adplan.creatives], ["headlines", copy.adplan.headline, copy.adplan.headlines], ["primary_texts", copy.adplan.text, copy.adplan.texts], ["descriptions", copy.adplan.description, copy.adplan.descriptions]] as const) {
      const c = count(k, one, many);
      if (c) bits.push(c);
    }
    if (str(a.existing_post_id)) bits.push(copy.adplan.boostsPost);
    const extra: [string, string][] = [];
    if (bits.length) extra.push([copy.adplan.creative, bits.join(" · ")]);
    if (str(a.url)) extra.push([copy.adplan.url, String(a.url)]);
    rows.push({ key: copy.adplan.ad, value: nodeLabel(tree.ad, copy.adplan.ad), role: tree.ad.isNew ? "text" : "muted", extra: extra.length ? extra : undefined });
  }
  return rows;
}

function moneyRows(input: AdPlanInput): KvRow[] {
  const rows: KvRow[] = [];
  const cur = input.currency ?? "usd";
  const platform = str(input.tree.campaign?.rec.platform) ?? str(input.tree.group?.rec.platform) ?? "meta";
  if (input.tree.group) {
    const r = describeReach(input.reach, platform);
    rows.push({ key: copy.adplan.reachKey, value: r.text, role: r.role });
  }
  if (input.budget) {
    const c = commitment(input.budget);
    const per = input.budget.type === "daily" ? `${money(input.budget.amount, cur)}/${copy.adplan.day}` : `${money(input.budget.amount, cur)} ${copy.adplan.lifetime}`;
    const total = input.budget.type === "daily" ? (c.openEnded ? copy.adplan.openEnded(money(c.total, cur), c.days) : copy.adplan.until(money(c.total, cur), c.days)) : "";
    const owner = input.budget.typed ? "" : copy.adplan.fromExisting(input.budget.owner === "campaign" ? copy.adplan.campaign : copy.adplan.group);
    rows.push({ key: copy.adplan.spend, value: [per, total, owner].filter(Boolean).join(" · "), role: input.budget.typed ? "warn" : "text" });
  } else if (input.tree.group || input.tree.campaign) rows.push({ key: copy.adplan.spend, value: copy.adplan.noBudget, role: "muted" });
  rows.push({ key: copy.adplan.paysFrom, value: input.paysFrom ?? copy.adplan.noPaymentMethod, role: input.paysFrom ? "text" : "warn" });
  if (input.balance) rows.push({ key: copy.confirm.balance, value: copy.adplan.available(money(input.balance.available, input.balance.currency)), role: "muted" });
  if (input.social) {
    const s = describeSocial(input.social);
    rows.push({ key: copy.adplan.runsUnder, value: s.text, role: s.role });
  }
  if (input.accountTitle) rows.push({ key: copy.confirm.from, value: `${input.accountTitle}  ${input.accountId ?? ""}`.trim() });
  if (input.budget && input.cap !== undefined) {
    const c = commitment(input.budget);
    const over = input.cap !== null && c.total > input.cap;
    rows.push({ key: copy.confirm.cap, value: input.cap === null ? copy.confirm.noCap : copy.adplan.cap(money(input.cap, cur)), role: over ? "bad" : "muted" });
  }
  return rows;
}

function card(input: AdPlanInput, role: Role, title: string, tag: string, theme: Theme): string[] {
  const out = callout(role, title, [paint(theme, "mono", commandLine(input.argv))], theme, tag);
  out.push("");
  out.push(...kv([{ rows: treeRows(input) }, { rows: moneyRows(input) }], theme));
  out.push("");
  return out;
}

/** The plan card. Same shape as the payout gate: the whole tree, then what it costs and who pays. */
export function adPlanView(input: AdPlanInput, theme: Theme): string[] {
  const mode = input.mode ?? "production";
  const spends = !!input.budget;
  const role: Role = input.planOnly ? "accent" : mode === "sandbox" ? "warn" : spends ? "bad" : "warn";
  const tag = input.planOnly ? copy.adplan.planBadge : copy.confirm.badge(mode);
  const out = card(input, role, copy.confirm.title(input.group, input.verb), tag, theme);
  const notes = [mode === "sandbox" ? copy.confirm.sandboxWarning : copy.confirm.warning];
  if (spends && mode !== "sandbox") notes.push(copy.adplan.money);
  if (input.reach?.error && !input.planOnly) notes.push(copy.adplan.reachErrorNote);
  if (input.timeoutSeconds && !input.planOnly) notes.push(copy.confirm.expires(input.timeoutSeconds));
  if (input.planOnly) notes.push(copy.adplan.planNote);
  for (const l of wrap(notes.join(" "), theme.width - 3)) out.push("   " + paint(theme, "muted", l));
  out.push("");
  const argv = input.argv.filter((a) => a !== "--yes");
  const lines: [string, string[]][] = [];
  if (input.planOnly) lines.push([copy.adplan.thenRun, ["wv", ...argv]]);
  if (mode !== "sandbox" && spends) lines.push([copy.confirm.tryFirst, ["wv", "--sandbox", ...argv]]);
  if (lines.length) out.push(...footer(lines, theme), "");
  return out;
}

/** Printed instead of the prompt when the committed spend is over the cap. `whop` is never called. */
export function adRefusedView(input: AdPlanInput, theme: Theme): string[] {
  const cur = input.currency ?? "usd";
  const c = input.budget ? commitment(input.budget) : { total: 0, days: 0, openEnded: true };
  const out = card(input, "bad", copy.adplan.refused.title, copy.confirm.refused.badge, theme);
  const notes = [copy.adplan.refused.body(money(c.total, cur), money(input.cap ?? 0, cur)), copy.adplan.refused.raise(Math.ceil(c.total))];
  for (const l of wrap(notes.join(" "), theme.width - 3)) out.push("   " + paint(theme, "muted", l));
  out.push("");
  out.push(...footer([[copy.confirm.tryFirst, ["wv", "--sandbox", ...input.argv.filter((a) => a !== "--yes")]]], theme), "");
  return out;
}

/** The targeting flags `estimate_reach` takes, from a group's flags or record. Empty when there is nothing to estimate. */
export function reachArgv(groupRec: Rec, platform: string): string[] | undefined {
  const keys = ["audiences", "demographics", "detailed_targeting", "devices", "languages", "regions"];
  const argv: string[] = ["ad-groups", "estimate_reach", "--platform", platform];
  let any = false;
  for (const k of keys) {
    const v = groupRec[k];
    if (v === undefined || v === null || (Array.isArray(v) && v.length === 0) || (isObj(v) && Object.keys(v).length === 0)) continue;
    argv.push(`--${k}`, JSON.stringify(v));
    any = true;
  }
  return any ? argv : undefined;
}
