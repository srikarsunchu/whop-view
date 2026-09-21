// `wv gtm winback`: the winback playbook as one plan. Two people-filter audiences (visitors in the window who
// never bought, and customers), a flat-amount promo for churned buyers, and one ad group in an existing
// campaign that includes the first audience and excludes the second. Same shape as launch: one approval,
// one rerun, keys from one base, results fed forward.
import type { Rec } from "../envelope.ts";
import { copy, type Mode } from "../copy.ts";
import { money } from "../format.ts";
import { commitment, describeReach, describeSocial, type Commitment, type Reach } from "./adplan.ts";
import { recipeData, stepKey, type RecipePlan, type RecipeRow, type RecipeStep } from "./recipe.ts";

export interface WinbackOptions {
  /** The campaign the ad group joins. Absent: no ad group. */
  campaign?: string;
  budget?: number;
  /** The rolling window for "visited, did not buy". */
  days: number;
  code: string;
  amount: number;
  product?: string;
  countries: string[];
  key?: string;
}

export const WINBACK_FLAGS = ["--campaign", "--budget", "--days", "--code", "--amount", "--product", "--countries", "--idempotency-key"];

export function parseWinbackArgs(argv: string[]): { opts?: WinbackOptions; error?: string } {
  const rest = argv[0] === "gtm" && argv[1] === "winback" ? argv.slice(2) : argv;
  const flags: Record<string, string> = {};
  let positional: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const name = eq > 0 ? a.slice(0, eq) : a;
      if (!WINBACK_FLAGS.includes(name)) return { error: copy.winback.unknownFlag(name) };
      flags[name] = eq > 0 ? a.slice(eq + 1) : (rest[++i] ?? "");
    } else if (!positional) positional = a;
    else return { error: copy.launch.extraArg(a) };
  }
  const num = (name: string, fallback?: number): number | undefined | null => {
    const v = flags[name];
    if (v === undefined) return fallback;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const budget = num("--budget");
  if (budget === null) return { error: copy.launch.badNumber("--budget", flags["--budget"]) };
  const days = num("--days", 30);
  if (days === null) return { error: copy.launch.badNumber("--days", flags["--days"]) };
  const amount = num("--amount", 5);
  if (amount === null) return { error: copy.launch.badNumber("--amount", flags["--amount"]) };
  return {
    opts: {
      campaign: flags["--campaign"] ?? positional,
      budget: budget ?? undefined,
      days: Math.round(days!),
      code: flags["--code"] ?? "COMEBACK",
      amount: amount!,
      product: flags["--product"],
      countries: (flags["--countries"] ?? "US").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean),
      key: flags["--idempotency-key"],
    },
  };
}

export interface WinbackReads {
  preferences?: Rec;
  social?: Rec[];
  /** `ad-campaigns get <campaign>`, when one was named. */
  campaign?: Rec;
  campaignError?: string;
  /** `people list --last_seen_within_days N --has_purchased false`: how many the first audience will hold, roughly. */
  visitors?: { seen: number; more: boolean };
  reach?: Reach;
  accountTitle?: string;
  accountId?: string;
  mode?: Mode;
  cap?: number | null;
  now?: Date;
}

export interface WinbackPlan extends RecipePlan {
  opts: WinbackOptions;
  currency: string;
  commitment?: Commitment;
  key: string;
}

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** The ad group whop expects. `{visitors.id}` and `{customers.id}` fill from the two audience creates. */
export function winbackGroup(opts: WinbackOptions): Rec {
  return {
    ad_campaign_id: opts.campaign ?? "{campaign}",
    title: `winback ${opts.days}d`,
    budget_amount: opts.budget,
    budget_type: "daily",
    optimization_goal: "conversions",
    conversion_event: "purchase",
    conversion_location: "website",
    placements: "automatic",
    audiences: { include: ["{visitors.id}"], exclude: ["{customers.id}"] },
    regions: { include: { countries: opts.countries } },
  };
}

export function buildWinback(argv: string[], opts: WinbackOptions, reads: WinbackReads): WinbackPlan {
  const c = copy.winback;
  const now = reads.now ?? new Date();
  const mode = reads.mode ?? "production";
  const key = opts.key ?? "{key}";
  const biz = reads.accountId ?? "<biz_id>";
  const currency = str(reads.preferences?.ads_reporting_currency) ?? "usd";
  const blockers: string[] = [];
  const warnings: string[] = [];
  const wantsGroup = opts.budget !== undefined || opts.campaign !== undefined;
  if (opts.budget !== undefined && !opts.campaign) blockers.push(c.needsCampaign);
  if (opts.campaign && reads.campaignError) blockers.push(c.noCampaign(opts.campaign, reads.campaignError));
  if (reads.visitors && reads.visitors.seen === 0) warnings.push(c.noVisitors(opts.days));

  const steps: RecipeStep[] = [
    {
      key: "visitors",
      label: c.stepLabels.visitors,
      what: c.visitorsLine(opts.days, reads.visitors ? `${reads.visitors.seen}${reads.visitors.more ? "+" : ""}` : undefined),
      group: "audiences",
      verb: "create",
      argv: ["audiences", "create", "--account_id", biz, "--name", c.visitorsName(opts.days), "--source_type", "people_filter", "--filters", JSON.stringify({ has_purchased: false, last_seen_within_days: opts.days, contactable: true }), "--auto_refresh", "true", "--idempotency-key", stepKey(key, "visitors")],
    },
    {
      key: "customers",
      label: c.stepLabels.customers,
      what: c.customersLine,
      group: "audiences",
      verb: "create",
      argv: ["audiences", "create", "--account_id", biz, "--name", c.customersName, "--source_type", "people_filter", "--filters", JSON.stringify({ has_purchased: true }), "--auto_refresh", "true", "--idempotency-key", stepKey(key, "customers")],
    },
    {
      key: "promo",
      label: copy.launch.stepLabels.promo,
      what: c.promoLine(opts.code, money(opts.amount, currency)),
      group: "promo-codes",
      verb: "create",
      argv: [
        "promo-codes", "create", "--account_id", biz, "--code", opts.code, "--promo_type", "flat_amount", "--amount_off", String(opts.amount), "--base_currency", currency,
        "--new_users_only", "false", "--churned_users_only", "true", "--promo_duration_months", "1", "--one_per_customer", "true",
        ...(opts.product ? ["--product_id", opts.product] : []), "--idempotency-key", stepKey(key, "promo"),
      ],
    },
  ];
  let commit: Commitment | undefined;
  let paysFrom: string | undefined;
  if (wantsGroup && opts.budget !== undefined) {
    const pm = reads.preferences?.ads_payment_methods;
    paysFrom = Array.isArray(pm) && pm.length ? copy.launch.paymentMethods(pm.length) : pm && typeof pm === "object" ? copy.launch.paymentMethods(1) : undefined;
    if (reads.social && !reads.social.some((s) => !s.error)) blockers.push(copy.launch.noPage);
    if (reads.preferences && !paysFrom) blockers.push(copy.launch.noPayment);
    commit = commitment({ amount: opts.budget, type: "daily", owner: "group", typed: true }, now.getTime());
    if (mode !== "sandbox" && reads.cap != null && commit.total > reads.cap) blockers.push(copy.launch.overCap(money(commit.total, currency), money(reads.cap, currency)));
  }
  steps.push({
    key: "group",
    label: c.stepLabels.group,
    what: c.groupLine(opts.days, reads.campaign ? str(reads.campaign.title) ?? opts.campaign ?? "" : opts.campaign ?? ""),
    group: "ad-groups",
    verb: "create",
    argv: ["ad-groups", "create", ...Object.entries(winbackGroup(opts)).flatMap(([k, v]) => [`--${k}`, typeof v === "object" ? JSON.stringify(v) : String(v)]), "--idempotency-key", stepKey(key, "group")],
    skipped: opts.budget === undefined ? c.noBudget : undefined,
  });

  const summary: RecipeRow[] = [];
  if (reads.campaign) summary.push({ key: c.campaign, value: `${str(reads.campaign.title) ?? ""}  ${opts.campaign ?? ""}`.trim(), role: str(reads.campaign.status) === "active" ? "text" : "warn" });
  if (commit && opts.budget !== undefined) {
    summary.push({ key: copy.launch.spend, value: `${money(opts.budget, currency)}/${copy.adplan.day} · ${copy.adplan.until(money(commit.total, currency), commit.days)} · ${copy.launch.noEnd}`, role: "warn" });
    const r = describeReach(reads.reach, "meta");
    summary.push({ key: copy.launch.reach, value: r.text, role: r.role });
    summary.push({ key: copy.launch.paysFrom, value: paysFrom ?? copy.adplan.noPaymentMethod, role: paysFrom ? "text" : "warn" });
    if (reads.social) {
      const s = describeSocial(reads.social);
      summary.push({ key: copy.launch.runsUnder, value: s.text, role: s.role });
    }
    if (reads.cap !== undefined) summary.push({ key: copy.confirm.cap, value: reads.cap === null ? copy.confirm.noCap : copy.adplan.cap(money(reads.cap, currency)), role: "muted" });
  }
  return {
    name: "winback",
    title: c.title,
    argv,
    mode,
    account: reads.accountId || reads.accountTitle ? { id: reads.accountId, title: reads.accountTitle } : undefined,
    summary,
    steps,
    blockers,
    warnings,
    typedAmount: opts.budget !== undefined && mode !== "sandbox" ? { amount: opts.budget, currency } : undefined,
    data: { campaign: opts.campaign, currency, commitment: commit, reach: reads.reach, paysFrom, cap: reads.cap, window: { days: opts.days, visitors: reads.visitors }, promo: { code: opts.code, amount: opts.amount } },
    done: (results) => winbackChecks(opts, results),
    opts,
    currency,
    commitment: commit,
    key,
  };
}

export const winbackData = (plan: WinbackPlan): Rec => recipeData(plan);

/** "Done when": both audiences `ready` with rows, the code active, the group under its campaign, spend tomorrow. */
export function winbackChecks(opts: WinbackOptions, results: Partial<Record<string, Rec>>): { label: string; argv: string[] }[] {
  const c = copy.winback.check;
  const out: { label: string; argv: string[] }[] = [];
  if (results.visitors?.id) out.push({ label: c.visitors, argv: ["whop", "audiences", "get", String(results.visitors.id), "--format", "json"] });
  if (results.customers?.id) out.push({ label: c.customers, argv: ["whop", "audiences", "get", String(results.customers.id), "--format", "json"] });
  if (results.promo?.id) out.push({ label: copy.launch.check.promo, argv: ["whop", "promo-codes", "get", String(results.promo.id), "--format", "json"] });
  if (results.group?.id) out.push({ label: c.group, argv: ["whop", "ad-groups", "get", String(results.group.id), "--format", "json"] });
  if (opts.campaign && results.group?.id) out.push({ label: copy.launch.check.delivery, argv: ["wv", "stats", "get", "ad_delivery", "--last", "1d", "--source", `whop:${opts.campaign}:${results.group.id}:*`, "--metric", "spend", "--format", "json"] });
  if (opts.campaign) out.push({ label: c.rank, argv: ["wv", "gtm", "rank", opts.campaign] });
  return out;
}
