// `wv store`: the catalog on one screen: every product with its plans and prices, who is on them, the active
// offers, and the checkout links. `wv store price <plan_id> --to N`: a price change that reads the plan first and
// shows before → after with the members on it. `wv store publish <prod_id>`: publish a product and mint a
// checkout link for its default plan, refused when there is nothing to buy. Reads only here; bin.ts gathers.
import type { Parsed, Rec } from "../envelope.ts";
import { copy, type Mode } from "../copy.ts";
import { money, planPrice, shortDate } from "../format.ts";
import { footer, type FooterLine } from "../primitives/footer.ts";
import { kv, type KvRow, type KvSection } from "../primitives/kv.ts";
import { breadcrumb } from "../primitives/rule.ts";
import { table, type TableCell, type TableColumn } from "../primitives/table.ts";
import { teach } from "../argv.ts";
import { paint, type Theme } from "../tokens.ts";
import { wrap } from "../ansi.ts";
import { statusLabel, statusRole } from "../status.ts";
import { recipeData, stepKey, type RecipePlan, type RecipeRow, type RecipeStep } from "./recipe.ts";

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const isObj = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);
const rows = (p: Parsed | undefined): Rec[] | undefined => (p && p.ok && p.payload.kind === "page" ? p.payload.rows : undefined);
const errLine = (p: Parsed) => (p.ok ? "" : `${p.error.code} ${p.error.message.split("\n")[0]}`);
/** A price as Whop sends it: a number on `plans list`, a money object on a product's `default_plan`. */
export const priceOf = (v: unknown): number | undefined => (isObj(v) ? (v.amount !== undefined && v.amount !== null && Number.isFinite(Number(v.amount)) ? Number(v.amount) : undefined) : typeof v === "number" ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export interface StoreInput {
  accountTitle?: string;
  accountId?: string;
  mode?: Mode;
  products: Parsed;
  /** `plans list`, every plan on the account. */
  plans: Parsed;
  /** `promo-codes list --status active` */
  promoCodes: Parsed;
  /** `checkout-configurations list` */
  checkouts: Parsed;
  now?: number;
  commands: string[][];
}

/** The plans under a product, from the plans list's `product.id` or `product_id`. */
export function plansOf(plans: Rec[], productId: string): Rec[] {
  return plans.filter((p) => (isObj(p.product) ? p.product.id : p.product_id) === productId);
}

/** A product is for sale when it is visible and has a visible buy-now plan. The doctor's products check says the same. */
export function forSale(product: Rec, plans: Rec[]): { ok: boolean; why?: string } {
  const c = copy.store;
  if (product.visibility !== "visible") return { ok: false, why: c.notVisible(str(product.visibility) ?? "unknown") };
  const visible = plans.filter((p) => p.visibility === "visible" && (p.release_method ?? "buy_now") === "buy_now");
  if (!plans.length) return { ok: false, why: c.noPlans };
  if (!visible.length) return { ok: false, why: c.noVisiblePlan };
  return { ok: true };
}

export function storeData(input: StoreInput): Rec {
  const products = rows(input.products);
  const plans = rows(input.plans) ?? [];
  return {
    ok: input.products.ok && input.plans.ok,
    account: input.accountId || input.accountTitle ? { id: input.accountId, title: input.accountTitle } : undefined,
    mode: input.mode ?? "production",
    products: products
      ? products.map((p) => {
          const own = plansOf(plans, String(p.id));
          return { id: p.id, title: p.title, visibility: p.visibility, route: p.route, member_count: p.member_count, forSale: forSale(p, own), plans: own.map((pl) => ({ id: pl.id, title: pl.title, plan_type: pl.plan_type, price: planPrice(pl as never), initial_price: priceOf(pl.initial_price), renewal_price: priceOf(pl.renewal_price), billing_period: pl.billing_period, visibility: pl.visibility, release_method: pl.release_method, member_count: pl.member_count, stock: pl.unlimited_stock === true ? "unlimited" : pl.stock, trial_period_days: pl.trial_period_days, purchase_url: pl.purchase_url })) };
        })
      : { error: errLine(input.products) },
    promo_codes: rows(input.promoCodes) ?? { error: errLine(input.promoCodes) },
    checkouts: rows(input.checkouts)?.map((k) => ({ id: k.id, plan_id: isObj(k.plan) ? k.plan.id : k.plan_id, purchase_url: k.purchase_url, metadata: k.metadata, created_at: k.created_at })) ?? { error: errLine(input.checkouts) },
    commands: input.commands.map((c) => teach(c)),
  };
}

function productSections(input: StoreInput, theme: Theme): KvSection[] {
  const c = copy.store;
  const products = rows(input.products);
  const plans = rows(input.plans) ?? [];
  if (!products) return [{ rows: [{ key: c.products, value: errLine(input.products) || copy.detail.empty, role: "warn" }] }];
  if (!products.length) return [{ rows: [{ key: c.products, value: c.noProducts, role: "muted" }] }];
  return products.map((p) => {
    const own = plansOf(plans, String(p.id));
    const sale = forSale(p, own);
    const head: KvRow = { key: statusLabel(str(p.visibility) ?? ""), value: sale.ok ? `${c.forSale} · ${c.members(num(p.member_count) ?? 0)} · whop.com/${str(p.route) ?? ""}` : sale.why ?? "", role: sale.ok ? "good" : "warn" };
    const planRows: KvRow[] = own.length
      ? own.map((pl) => ({
          key: str(pl.title) ?? String(pl.id),
          value: [planPrice(pl as never), str(pl.plan_type)?.replace(/_/g, " ") ?? "", statusLabel(str(pl.visibility) ?? ""), pl.release_method === "waitlist" ? c.waitlist : "", num(pl.trial_period_days) ? c.trial(pl.trial_period_days as number) : "", c.members(num(pl.member_count) ?? 0), pl.unlimited_stock === true ? "" : c.stock(num(pl.stock) ?? 0), String(pl.id)].filter(Boolean).join(" · "),
          role: pl.visibility === "visible" ? "text" : "muted",
        }))
      : [{ key: c.plans, value: c.noPlansShort, role: "warn" }];
    return { title: `${str(p.title) ?? ""}  ${String(p.id)}`.trim(), rows: [head, ...planRows] };
  });
}

function offerTable(input: StoreInput, theme: Theme): string[] {
  const c = copy.store;
  const list = rows(input.promoCodes);
  if (!list) return wrap(errLine(input.promoCodes) || copy.detail.empty, theme.width - 1).map((l) => " " + paint(theme, "warn", l));
  if (!list.length) return wrap(c.noOffers, theme.width - 1).map((l) => " " + paint(theme, "muted", l));
  const cols: TableColumn[] = [
    { key: "code", label: c.cols.code, align: "left", priority: 0 },
    { key: "off", label: c.cols.off, align: "right", priority: 1 },
    { key: "who", label: c.cols.who, align: "left", priority: 3 },
    { key: "uses", label: c.cols.uses, align: "right", priority: 2 },
    { key: "expires", label: c.cols.expires, align: "left", priority: 4 },
    { key: "id", label: "id", align: "left", priority: 5, max: 22 },
  ];
  const cells = list.map((k) => {
    const row: Record<string, TableCell> = {};
    row.code = { text: str(k.code) ?? "", role: "text" };
    row.off = { text: k.promo_type === "percentage" ? `${k.amount_off}%` : money(priceOf(k.amount_off) ?? 0, str(k.currency) ?? "usd"), role: "text" };
    row.who = { text: k.new_users_only ? copy.gtm.newUsers : k.churned_users_only ? copy.gtm.churned : k.existing_memberships_only ? copy.gtm.existing : c.anyone, role: "muted" };
    row.uses = { text: typeof k.uses === "number" ? copy.gtm.uses(k.uses, k.unlimited_stock ? undefined : num(k.stock)) : copy.detail.empty, role: "muted" };
    row.expires = { text: str(k.expires_at) ? shortDate(k.expires_at as string) : c.never, role: "muted" };
    row.id = { text: String(k.id ?? ""), role: "muted" };
    return row;
  });
  return table(cols, cells, theme).lines;
}

function checkoutLines(input: StoreInput, theme: Theme): string[] {
  const c = copy.store;
  const list = rows(input.checkouts);
  if (!list) return wrap(errLine(input.checkouts) || copy.detail.empty, theme.width - 1).map((l) => " " + paint(theme, "warn", l));
  if (!list.length) return wrap(c.noCheckouts, theme.width - 1).map((l) => " " + paint(theme, "muted", l));
  const kvRows: KvRow[] = list.slice(0, 6).map((k) => ({ key: str(isObj(k.plan) ? k.plan.id : k.plan_id) ?? String(k.id), value: [str(k.purchase_url) ?? String(k.id), isObj(k.metadata) && Object.keys(k.metadata).length ? Object.entries(k.metadata).map(([a, b]) => `${a}=${b}`).join(" ") : ""].filter(Boolean).join(" · "), role: "muted" }));
  const out = kv([{ rows: kvRows }], theme);
  if (list.length > 6) out.push(" " + paint(theme, "muted", c.moreCheckouts(list.length - 6)));
  return out;
}

export function storeView(input: StoreInput, theme: Theme): string[] {
  const c = copy.store;
  const out: string[] = [];
  out.push(...breadcrumb(theme, [[input.accountTitle ?? "", "accent"], [input.accountId ?? "", "muted"], [copy.session.mode(input.mode ?? "production"), input.mode === "sandbox" ? "good" : "warn"], [c.title, "accent"]]));
  out.push("");
  out.push(...kv(productSections(input, theme), theme));
  out.push("");
  out.push(" " + paint(theme, "accent", c.offers));
  out.push(...offerTable(input, theme), "");
  out.push(" " + paint(theme, "accent", c.checkouts));
  out.push(...checkoutLines(input, theme), "");
  const products = rows(input.products) ?? [];
  const plans = rows(input.plans) ?? [];
  const lines: FooterLine[] = [];
  const unsold = products.find((p) => !forSale(p, plansOf(plans, String(p.id))).ok);
  if (unsold) lines.push([c.publish, ["wv", "store", "publish", String(unsold.id), "--plan"]]);
  const firstPlan = plans.find((p) => p.visibility === "visible") ?? plans[0];
  if (firstPlan) lines.push([c.price, ["wv", "store", "price", String(firstPlan.id), "--to", "<amount>", "--plan"]]);
  for (const cmd of input.commands) lines.push([copy.list.json, teach(cmd)]);
  out.push(...footer(lines, theme), "");
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// `wv store price <plan_id> --to N [--initial N]`: the plan first, then one gated update.

export interface PriceOptions {
  plan: string;
  /** The recurring price for a renewal plan, the price for a one-time plan. */
  to?: number;
  /** The first charge on a renewal plan. */
  initial?: number;
  key?: string;
}

export function parsePriceArgs(argv: string[]): { opts?: PriceOptions; error?: string } {
  const rest = argv[0] === "store" && argv[1] === "price" ? argv.slice(2) : argv;
  const flags: Record<string, string> = {};
  let positional: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const name = eq > 0 ? a.slice(0, eq) : a;
      if (!["--to", "--initial", "--idempotency-key"].includes(name)) return { error: copy.store.price_.unknownFlag(name) };
      flags[name] = eq > 0 ? a.slice(eq + 1) : (rest[++i] ?? "");
    } else if (!positional) positional = a;
    else return { error: copy.launch.extraArg(a) };
  }
  if (!positional || !/^plan_/.test(positional)) return { error: copy.store.price_.needsPlan };
  const numFlag = (name: string): number | undefined | null => {
    if (flags[name] === undefined) return undefined;
    const n = Number(flags[name]);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
  };
  const to = numFlag("--to");
  const initial = numFlag("--initial");
  if (to === null) return { error: copy.launch.badNumber("--to", flags["--to"]) };
  if (initial === null) return { error: copy.launch.badNumber("--initial", flags["--initial"]) };
  if (to === undefined && initial === undefined) return { error: copy.store.price_.needsAmount };
  return { opts: { plan: positional, to, initial, key: flags["--idempotency-key"] } };
}

export interface PriceReads {
  plan?: Rec;
  planError?: string;
  accountTitle?: string;
  accountId?: string;
  mode?: Mode;
}

export interface PricePlan extends RecipePlan {
  opts: PriceOptions;
}

export function buildPrice(argv: string[], opts: PriceOptions, reads: PriceReads): PricePlan {
  const c = copy.store.price_;
  const mode = reads.mode ?? "production";
  const key = opts.key ?? "{key}";
  const p = reads.plan;
  const cur = str(p?.currency) ?? "usd";
  const renewal = p?.plan_type === "renewal";
  const currentMain = renewal ? priceOf(p?.renewal_price) : priceOf(p?.initial_price);
  const currentInitial = priceOf(p?.initial_price);
  const blockers: string[] = [];
  const warnings: string[] = [];
  const flags: string[] = [];
  const changes: RecipeRow[] = [];
  if (!p) blockers.push(c.noPlan(opts.plan, reads.planError ?? ""));
  else {
    if (opts.to !== undefined) {
      if (opts.to > 0 && opts.to < 1) blockers.push(c.minimum(money(1, cur)));
      if (currentMain !== undefined && Math.abs(opts.to - currentMain) < 0.005) blockers.push(c.samePrice(money(opts.to, cur)));
      flags.push(renewal ? "--renewal_price" : "--initial_price", String(opts.to));
      changes.push({ key: renewal ? c.renewal : c.priceKey, value: `${money(currentMain ?? 0, cur)} → ${money(opts.to, cur)}`, role: "warn" });
    }
    if (opts.initial !== undefined) {
      if (!renewal) blockers.push(c.initialOnOneTime);
      else {
        if (opts.initial > 0 && opts.initial < 1) blockers.push(c.minimum(money(1, cur)));
        flags.push("--initial_price", String(opts.initial));
        changes.push({ key: c.first, value: `${money(currentInitial ?? 0, cur)} → ${money(opts.initial, cur)}`, role: "warn" });
      }
    }
    const members = num(p.member_count);
    if (members && members > 0) warnings.push(c.members(members, renewal));
    if (p.visibility === "archived") blockers.push(c.archived);
  }
  const steps: RecipeStep[] = [
    {
      key: "price",
      label: c.stepLabel,
      what: changes.map((ch) => `${ch.key} ${ch.value}`).join(" · ") || c.stepLabel,
      group: "plans",
      verb: "update",
      argv: ["plans", "update", opts.plan, ...flags, "--idempotency-key", stepKey(key, "price")],
    },
  ];
  const summary: RecipeRow[] = [];
  if (p) {
    const product = isObj(p.product) ? str(p.product.title) : undefined;
    summary.push({ key: copy.launch.product, value: `${product ?? ""}  ${str(isObj(p.product) ? p.product.id : p.product_id) ?? ""}`.trim() || copy.detail.empty, role: "muted" });
    summary.push({ key: c.planKey, value: `${str(p.title) ?? ""} · ${planPrice(p as never)} · ${str(p.plan_type)?.replace(/_/g, " ") ?? ""} · ${statusLabel(str(p.visibility) ?? "")} · ${opts.plan}`, role: "text" });
    summary.push({ key: c.membersKey, value: copy.store.members(num(p.member_count) ?? 0), role: num(p.member_count) ? "warn" : "muted" });
    summary.push(...changes);
  }
  return {
    name: "price",
    title: c.title,
    argv,
    mode,
    account: reads.accountId || reads.accountTitle ? { id: reads.accountId, title: reads.accountTitle } : undefined,
    summary,
    steps,
    blockers,
    warnings,
    data: { plan: p ? { id: p.id, title: p.title, plan_type: p.plan_type, currency: cur, initial_price: currentInitial, renewal_price: priceOf(p.renewal_price), member_count: p.member_count, visibility: p.visibility } : undefined, to: opts.to, initial: opts.initial, changes: changes.map((ch) => ({ field: ch.key, change: ch.value })) },
    done: () => [{ label: c.check, argv: ["whop", "plans", "get", opts.plan, "--format", "json"] }, { label: copy.store.title, argv: ["wv", "store"] }],
    opts,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// `wv store publish <prod_id> [--no-link]`: publish, then a checkout link for the default plan.

export interface PublishOptions {
  product: string;
  link: boolean;
  key?: string;
}

export function parsePublishArgs(argv: string[]): { opts?: PublishOptions; error?: string } {
  const rest = argv[0] === "store" && argv[1] === "publish" ? argv.slice(2) : argv;
  let positional: string | undefined;
  let link = true;
  let key: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--no-link") link = false;
    else if (a === "--idempotency-key") key = rest[++i];
    else if (a.startsWith("--idempotency-key=")) key = a.slice(18);
    else if (a.startsWith("--")) return { error: copy.store.publish_.unknownFlag(a) };
    else if (!positional) positional = a;
    else return { error: copy.launch.extraArg(a) };
  }
  if (!positional || !/^prod_/.test(positional)) return { error: copy.store.publish_.needsProduct };
  return { opts: { product: positional, link, key } };
}

export interface PublishReads {
  product?: Rec;
  productError?: string;
  /** `plans list --product_ids <id>` */
  plans?: Rec[];
  accountTitle?: string;
  accountId?: string;
  mode?: Mode;
}

export interface PublishPlan extends RecipePlan {
  opts: PublishOptions;
}

export function buildPublish(argv: string[], opts: PublishOptions, reads: PublishReads): PublishPlan {
  const c = copy.store.publish_;
  const mode = reads.mode ?? "production";
  const key = opts.key ?? "{key}";
  const p = reads.product;
  const plans = reads.plans ?? [];
  const blockers: string[] = [];
  const warnings: string[] = [];
  const visiblePlans = plans.filter((pl) => pl.visibility === "visible" && (pl.release_method ?? "buy_now") === "buy_now");
  const defaultPlan = p && isObj(p.default_plan) ? p.default_plan : undefined;
  const linkPlan = defaultPlan ?? visiblePlans[0];
  if (!p) blockers.push(c.noProduct(opts.product, reads.productError ?? ""));
  else {
    if (!plans.length) blockers.push(copy.store.noPlans);
    else if (!visiblePlans.length) blockers.push(copy.store.noVisiblePlan);
    if (!str(p.headline) && !str(p.description)) warnings.push(c.noCopy);
  }
  const already = p?.visibility === "visible";
  const steps: RecipeStep[] = [
    {
      key: "publish",
      label: c.stepLabels.publish,
      what: already ? c.alreadyVisible : c.publishLine(str(p?.title) ?? opts.product),
      group: "products",
      verb: "publish",
      argv: ["products", "publish", opts.product, "--idempotency-key", stepKey(key, "publish")],
      skipped: already ? c.alreadyVisibleShort : undefined,
    },
    {
      key: "link",
      label: c.stepLabels.link,
      what: linkPlan ? c.linkLine(str(linkPlan.title) ?? String(linkPlan.id), planPrice(linkPlan as never)) : c.linkLineNoPlan,
      group: "checkout-configurations",
      verb: "create",
      argv: ["checkout-configurations", "create", "--plan_id", linkPlan ? String(linkPlan.id) : "{plan}", "--metadata", JSON.stringify({ source: "wv store publish" }), "--idempotency-key", stepKey(key, "link")],
      skipped: !opts.link ? c.noLink : !linkPlan ? copy.store.noPlansShort : undefined,
    },
  ];
  const summary: RecipeRow[] = [];
  if (p) {
    summary.push({ key: copy.launch.product, value: `${str(p.title) ?? ""}  ${opts.product} · ${statusLabel(str(p.visibility) ?? "")}`.trim(), role: already ? "good" : "warn" });
    summary.push({ key: copy.store.plans, value: plans.length ? plans.map((pl) => `${str(pl.title) ?? pl.id} ${planPrice(pl as never)}${pl.visibility !== "visible" ? ` (${statusLabel(str(pl.visibility) ?? "")})` : ""}`).join(" · ") : copy.store.noPlansShort, role: visiblePlans.length ? "text" : "warn" });
    if (linkPlan) summary.push({ key: c.linkKey, value: `${str(linkPlan.title) ?? linkPlan.id} · ${planPrice(linkPlan as never)}`, role: "muted" });
    summary.push({ key: c.pageKey, value: str(p.route) ? `whop.com/${p.route}` : copy.detail.empty, role: "muted" });
  }
  return {
    name: "publish",
    title: c.title,
    argv,
    mode,
    account: reads.accountId || reads.accountTitle ? { id: reads.accountId, title: reads.accountTitle } : undefined,
    summary,
    steps,
    blockers,
    warnings,
    data: { product: p ? { id: p.id, title: p.title, visibility: p.visibility, route: p.route } : undefined, plans: plans.map((pl) => ({ id: pl.id, title: pl.title, visibility: pl.visibility, price: planPrice(pl as never) })), linkPlan: linkPlan ? { id: linkPlan.id, title: linkPlan.title } : undefined },
    done: (results) => publishChecks(opts.product, results),
    opts,
  };
}

export function publishChecks(productId: string, results: Partial<Record<string, Rec>>): { label: string; argv: string[] }[] {
  const c = copy.store.publish_.check;
  const out: { label: string; argv: string[] }[] = [{ label: c.product, argv: ["whop", "products", "get", productId, "--format", "json"] }];
  if (results.link?.purchase_url) out.push({ label: c.link, argv: ["open", String(results.link.purchase_url)] });
  out.push({ label: copy.store.title, argv: ["wv", "store"] });
  return out;
}

export const priceData = (plan: PricePlan): Rec => recipeData(plan);
export const publishData = (plan: PublishPlan): Rec => recipeData(plan);
void statusRole;
