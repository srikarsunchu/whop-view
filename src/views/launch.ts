// `wv gtm launch`: the launch-day playbook as one plan. Four writes in order, each with its own idempotency
// key derived from one base, the later ones fed by the earlier ones' results: a promo code, a checkout link
// for the product's default plan, a Meta campaign, and one ad whose destination is the checkout link. The
// person approves the whole sequence once; the pipe gets it as one envelope with one `rerun`. Pure: bin.ts
// gathers the reads, runs the steps, and prints.
import type { Rec } from "../envelope.ts";
import { copy, type Mode } from "../copy.ts";
import { money } from "../format.ts";
import type { Theme } from "../tokens.ts";
import { commitment, describeReach, describeSocial, type Commitment, type Reach } from "./adplan.ts";
import { planPrice } from "../format.ts";
import { recipeData, recipeDoneView, recipeView, stepKey, substitute, type RecipePlan, type RecipeRow, type RecipeStep, type RecipeViewOptions } from "./recipe.ts";

export { stepKey, substitute };

export interface LaunchOptions {
  product: string;
  /** Daily ad budget in the account's ads currency. Absent: no campaign, no ad. */
  budget?: number;
  code: string;
  percent: number;
  /** Days until the promo expires. */
  days: number;
  stock?: number;
  /** `file_` ids for the ad. Absent: the ad step is skipped and the plan says so. */
  creatives: string[];
  headline?: string;
  primaryText?: string;
  countries: string[];
  ages: [number, number];
  /** Destination for the ad. Default: the checkout link the plan creates. */
  url?: string;
  campaign: string;
  /** Base for every step's idempotency key. Minted at the plan step when absent. */
  key?: string;
}

export const LAUNCH_FLAGS = ["--product", "--budget", "--code", "--percent", "--days", "--stock", "--creative", "--headline", "--primary-text", "--countries", "--ages", "--url", "--campaign", "--idempotency-key"];

const dateStamp = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

/** `wv gtm launch [prod_x] --budget 40 --creative file_a …`. Defaults are the launch-day playbook's. */
export function parseLaunchArgs(argv: string[], now: Date = new Date()): { opts?: LaunchOptions; error?: string } {
  const rest = argv[0] === "gtm" && argv[1] === "launch" ? argv.slice(2) : argv;
  const flags: Record<string, string[]> = {};
  let positional: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const name = eq > 0 ? a.slice(0, eq) : a;
      const value = eq > 0 ? a.slice(eq + 1) : (rest[++i] ?? "");
      if (!LAUNCH_FLAGS.includes(name)) return { error: copy.launch.unknownFlag(name) };
      (flags[name] ??= []).push(value);
    } else if (!positional) positional = a;
    else return { error: copy.launch.extraArg(a) };
  }
  const one = (name: string) => flags[name]?.at(-1);
  const product = one("--product") ?? positional;
  if (!product) return { error: copy.launch.needsProduct };
  const num = (name: string): number | undefined | null => {
    const v = one(name);
    if (v === undefined) return undefined;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const budget = num("--budget");
  if (budget === null) return { error: copy.launch.badNumber("--budget", one("--budget") ?? "") };
  const percent = num("--percent") ?? 20;
  if (percent === null || percent > 100) return { error: copy.launch.badNumber("--percent", one("--percent") ?? "") };
  const days = num("--days") ?? 7;
  if (days === null) return { error: copy.launch.badNumber("--days", one("--days") ?? "") };
  const stock = num("--stock");
  if (stock === null) return { error: copy.launch.badNumber("--stock", one("--stock") ?? "") };
  const agesRaw = one("--ages") ?? "25-44";
  const ages = /^(\d{2})-(\d{2})$/.exec(agesRaw);
  if (!ages) return { error: copy.launch.badAges(agesRaw) };
  const creatives = (flags["--creative"] ?? []).flatMap((c) => c.split(",")).filter(Boolean);
  return {
    opts: {
      product,
      budget: budget ?? undefined,
      code: one("--code") ?? `LAUNCH${Math.round(percent)}`,
      percent,
      days: Math.round(days),
      stock: stock === undefined ? undefined : Math.round(stock),
      creatives,
      headline: one("--headline"),
      primaryText: one("--primary-text"),
      countries: (one("--countries") ?? "US").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean),
      ages: [Number(ages[1]), Number(ages[2])],
      url: one("--url"),
      campaign: one("--campaign") ?? `launch-${dateStamp(now)}`,
      key: one("--idempotency-key"),
    },
  };
}

/** What `bin.ts` read before planning. Every field optional: a failed read is a warning on the card, never a crash. */
export interface LaunchReads {
  product?: Rec;
  preferences?: Rec;
  social?: Rec[];
  reach?: Reach;
  accountTitle?: string;
  accountId?: string;
  mode?: Mode;
  /** `WV_AD_CAP`, when a real budget goes to production. */
  cap?: number | null;
  now?: Date;
}

export type StepKey = "promo" | "checkout" | "campaign" | "ad";

export type LaunchStep = RecipeStep & { key: StepKey };

/** The generic plan plus what the launch knows: the product, the commitment, the reach, who pays. */
export interface LaunchPlan extends RecipePlan {
  opts: LaunchOptions;
  product?: { id: string; title?: string; planId?: string; planTitle?: string; price?: string; visibility?: string };
  currency: string;
  steps: LaunchStep[];
  commitment?: Commitment;
  reach?: Reach;
  social?: Rec[];
  paysFrom?: string;
  cap?: number | null;
  expiresAt: string;
  key: string;
}

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const isObj = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);

/** The ad group whop expects, from the options. Shared with the plan's reach estimate. */
export function adGroupFor(opts: LaunchOptions, title: string): Rec {
  return {
    ad_campaign_id: "{campaign.id}",
    title,
    budget_amount: opts.budget,
    budget_type: "daily",
    optimization_goal: "conversions",
    conversion_event: "purchase",
    conversion_location: "website",
    placements: "automatic",
    demographics: { minimum_age: opts.ages[0], maximum_age: opts.ages[1], gender: "all" },
    regions: { include: { countries: opts.countries } },
  };
}

export function buildLaunch(argv: string[], opts: LaunchOptions, reads: LaunchReads): LaunchPlan {
  const c = copy.launch;
  const now = reads.now ?? new Date();
  const mode = reads.mode ?? "production";
  const key = opts.key ?? "{key}";
  const p = reads.product;
  const defaultPlan = p && isObj(p.default_plan) ? p.default_plan : undefined;
  const currency = str(reads.preferences?.ads_reporting_currency) ?? "usd";
  const product = p ? { id: String(p.id ?? opts.product), title: str(p.title), planId: str(defaultPlan?.id), planTitle: str(defaultPlan?.title), price: defaultPlan ? planPrice(defaultPlan) : undefined, visibility: str(p.visibility) } : undefined;
  const expires = new Date(now.getTime() + opts.days * 86_400_000);
  const expiresAt = expires.toISOString().replace(/\.\d{3}Z$/, "Z");
  const biz = reads.accountId ?? "<biz_id>";
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!p) blockers.push(c.noProduct(opts.product));
  else if (product?.visibility !== "visible") warnings.push(c.notVisible(product?.visibility ?? "unknown"));
  if (p && !defaultPlan) blockers.push(c.noPlan);

  const steps: LaunchStep[] = [];
  steps.push({
    key: "promo",
    label: c.stepLabels.promo,
    what: c.promoLine(opts.code, opts.percent, opts.days, opts.stock),
    group: "promo-codes",
    verb: "create",
    argv: [
      "promo-codes", "create", "--account_id", biz, "--code", opts.code, "--promo_type", "percentage", "--amount_off", String(opts.percent),
      "--base_currency", currency, "--new_users_only", "true", "--promo_duration_months", "1", "--product_id", opts.product,
      ...(opts.stock ? ["--stock", String(opts.stock)] : []), "--expires_at", expiresAt, "--idempotency-key", stepKey(key, "promo"),
    ],
  });
  steps.push({
    key: "checkout",
    label: c.stepLabels.checkout,
    what: c.checkoutLine(product?.planTitle ?? product?.planId ?? "?", product?.price),
    group: "checkout-configurations",
    verb: "create",
    argv: ["checkout-configurations", "create", "--account_id", biz, "--plan_id", product?.planId ?? "{plan}", "--metadata", JSON.stringify({ campaign: opts.campaign }), "--idempotency-key", stepKey(key, "checkout")],
  });

  const title = `${c.campaignTitle} · ${product?.title ?? opts.product}`;
  const wantsAds = opts.budget !== undefined;
  const social = reads.social;
  const pm = reads.preferences?.ads_payment_methods;
  const paysFrom = Array.isArray(pm) && pm.length ? c.paymentMethods(pm.length) : pm && typeof pm === "object" ? c.paymentMethods(1) : undefined;
  let adsSkipped: string | undefined;
  if (!wantsAds) adsSkipped = c.noBudget;
  else {
    if (social && !social.some((s) => !s.error)) blockers.push(c.noPage);
    if (reads.preferences && !paysFrom) blockers.push(c.noPayment);
  }
  steps.push({
    key: "campaign",
    label: c.stepLabels.campaign,
    what: c.campaignLine,
    group: "ad-campaigns",
    verb: "create",
    argv: ["ad-campaigns", "create", "--title", title, "--platform", "meta", "--objective", "sales", "--budget_optimization", "ad_group", "--idempotency-key", stepKey(key, "campaign")],
    skipped: adsSkipped,
  });
  const group = adGroupFor(opts, `${opts.countries.join(",")} ${opts.ages[0]}-${opts.ages[1]} · purchase`);
  const adSkipped = adsSkipped ?? (opts.creatives.length ? undefined : c.noCreative);
  steps.push({
    key: "ad",
    label: c.stepLabels.ad,
    what: c.adLine(opts.creatives.length, opts.countries.join(","), opts.ages),
    group: "ads",
    verb: "create",
    argv: [
      "ads", "create", "--title", `${title} · v1`, "--url", opts.url ?? "{checkout.purchase_url}", "--call_to_action", "shop_now",
      "--ad_group", JSON.stringify(group),
      "--creatives", JSON.stringify(opts.creatives.map((id) => ({ id, format: "vertical" }))),
      "--headlines", JSON.stringify([opts.headline ?? c.defaultHeadline]),
      "--primary_texts", JSON.stringify([opts.primaryText ?? c.defaultPrimary(opts.percent, opts.code)]),
      "--url_parameters", JSON.stringify({ utm_campaign: opts.campaign }),
      "--idempotency-key", stepKey(key, "ad"),
    ],
    skipped: adSkipped,
  });
  if (wantsAds && !opts.creatives.length) warnings.push(c.noCreative);

  let commit: Commitment | undefined;
  if (wantsAds && opts.budget !== undefined) {
    commit = commitment({ amount: opts.budget, type: "daily", owner: "group", typed: true }, now.getTime());
    if (mode !== "sandbox" && reads.cap != null && commit.total > reads.cap) blockers.push(c.overCap(money(commit.total, currency), money(reads.cap, currency)));
  }
  const partial = { opts, argv, mode, product, currency, steps, commitment: commit, reach: wantsAds ? reads.reach : undefined, social, paysFrom, cap: wantsAds ? reads.cap : undefined, blockers, warnings, expiresAt, key };
  const plan: LaunchPlan = {
    ...partial,
    name: "launch",
    title: c.title,
    account: reads.accountId || reads.accountTitle ? { id: reads.accountId, title: reads.accountTitle } : undefined,
    summary: launchSummary(partial),
    typedAmount: wantsAds && opts.budget !== undefined && mode !== "sandbox" ? { amount: opts.budget, currency } : undefined,
    data: { product, currency, commitment: commit, reach: wantsAds ? reads.reach : undefined, paysFrom, cap: wantsAds ? reads.cap : undefined, promo: { code: opts.code, percent: opts.percent, expiresAt, stock: opts.stock } },
    done: (results) => doneChecks(results),
  };
  return plan;
}

function launchSummary(plan: Pick<LaunchPlan, "product" | "commitment" | "opts" | "currency" | "reach" | "paysFrom" | "social" | "cap">): RecipeRow[] {
  const c = copy.launch;
  const rows: RecipeRow[] = [];
  if (plan.product) rows.push({ key: c.product, value: `${plan.product.title ?? ""}  ${plan.product.id}`.trim(), role: plan.product.visibility === "visible" ? "text" : "warn" });
  if (plan.commitment && plan.opts.budget !== undefined) {
    rows.push({ key: c.spend, value: `${money(plan.opts.budget, plan.currency)}/${copy.adplan.day} · ${copy.adplan.until(money(plan.commitment.total, plan.currency), plan.commitment.days)}${plan.commitment.openEnded ? ` · ${c.noEnd}` : ""}`, role: "warn" });
    const r = describeReach(plan.reach, "meta");
    rows.push({ key: c.reach, value: r.text, role: r.role });
    rows.push({ key: c.paysFrom, value: plan.paysFrom ?? copy.adplan.noPaymentMethod, role: plan.paysFrom ? "text" : "warn" });
    if (plan.social) {
      const s = describeSocial(plan.social);
      rows.push({ key: c.runsUnder, value: s.text, role: s.role });
    }
    if (plan.cap !== undefined) rows.push({ key: copy.confirm.cap, value: plan.cap === null ? copy.confirm.noCap : copy.adplan.cap(money(plan.cap, plan.currency)), role: "muted" });
  }
  return rows;
}

export const launchData = (plan: LaunchPlan): Rec => recipeData(plan);
export const launchView = (plan: LaunchPlan, theme: Theme, opts: RecipeViewOptions = {}): string[] => recipeView(plan, theme, opts);
export const launchDoneView = (plan: LaunchPlan, results: Partial<Record<string, Rec>>, failed: { step: string; message: string } | undefined, theme: Theme): string[] => recipeDoneView(plan, results, failed, theme);

/** "Done when": the reads that prove the launch is live, as agent commands, with the ids the run produced. */
export function doneChecks(results: Partial<Record<string, Rec>>): { label: string; argv: string[] }[] {
  const c = copy.launch;
  const out: { label: string; argv: string[] }[] = [];
  if (results.promo?.id) out.push({ label: c.check.promo, argv: ["whop", "promo-codes", "get", String(results.promo.id), "--format", "json"] });
  if (results.checkout?.purchase_url) out.push({ label: c.check.checkout, argv: ["open", String(results.checkout.purchase_url)] });
  if (results.campaign?.id) out.push({ label: c.check.campaign, argv: ["whop", "ad-campaigns", "get", String(results.campaign.id), "--format", "json"] });
  if (results.ad?.id) out.push({ label: c.check.ad, argv: ["whop", "ads", "get", String(results.ad.id), "--format", "json"] });
  if (results.campaign?.id) out.push({ label: c.check.delivery, argv: ["wv", "stats", "get", "ad_delivery", "--last", "1d", "--source", `whop:${results.campaign.id}:*`, "--metric", "spend", "--format", "json"] });
  out.push({ label: c.check.gtm, argv: ["wv", "gtm"] });
  return out;
}
