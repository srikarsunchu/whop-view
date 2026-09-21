// One screen that answers "am I set up to sell": who is signed in, whether payouts are allowed, whether a
// developer login exists, the pixel, the Meta page, the ads payment method, Economic Intelligence, a
// product with a plan, and a webhook that has delivered. Every check is read from a `whop` command the
// footer teaches, and every failing check names its fix. Reads only.
import type { Parsed, Rec } from "../envelope.ts";
import { money, now, planPrice, relative } from "../format.ts";
import { footer, type FooterLine } from "../primitives/footer.ts";
import { breadcrumb } from "../primitives/rule.ts";
import { teach } from "../argv.ts";
import { paint, type Role, type Theme } from "../tokens.ts";
import { padEnd, width, wrap } from "../ansi.ts";
import { copy, type Mode } from "../copy.ts";
import { limitFor } from "./confirm.ts";
import { peopleSummary } from "./gtm.ts";

export type Level = "ok" | "warn" | "fail";

export interface Check {
  key: string;
  label: string;
  level: Level;
  detail: string;
  /** The command that fixes it, as argv. */
  fix?: string[];
  /** When the CLI cannot do it: where in the dashboard. */
  dashboard?: string;
  /** A failing blocking check makes `wv doctor` exit 1. */
  blocking: boolean;
}

/** The scopes a seller's credential needs, checked with `permissions check`. Names verified against `api-keys permissions`. */
export const DOCTOR_ACTIONS = ["developer:manage_webhook", "payout:withdraw_funds", "access_pass:create", "plan:create", "payment:basic:read", "stats:read"];

/** How recent a successful delivery has to be for a webhook to count as alive. */
export const DELIVERY_WINDOW_DAYS = 7;

export interface DoctorInput {
  accountTitle?: string;
  accountId?: string;
  mode?: Mode;
  auth: Parsed;
  /** `auth list` */
  profiles: Parsed;
  /** `permissions check --resource_id <biz> --actions …` */
  permissions?: Parsed;
  verifications: Parsed;
  /** `payouts methods --include_limits` */
  methods: Parsed;
  /** `people list --first 100` */
  people: Parsed;
  social: Parsed;
  preferences: Parsed;
  products: Parsed;
  webhooks: Parsed;
  /** `webhooks deliveries <id>` keyed by webhook id. */
  deliveries: Record<string, Parsed>;
  /** Every command that fed the screen, in order, for the footer. */
  commands: string[][];
}

const rows = (p: Parsed): Rec[] | undefined => (p.ok && p.payload.kind === "page" ? p.payload.rows : undefined);
const record = (p: Parsed): Rec | undefined => (p.ok && "record" in p.payload ? p.payload.record : undefined);
const errLine = (p: Parsed) => (p.ok ? "" : `${p.error.code} ${p.error.message.split("\n")[0]}`);
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const isObj = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);

/** Whop publishes its dashboard root; deeper paths are not in the CLI or the API reference. */
export const dashboardUrl = (accountId?: string) => `https://whop.com/dashboard/${accountId ?? "<biz_id>"}/`;

interface Profile {
  name: string;
  method: string;
}

/** Profiles from `auth list`: which is active, and which use an API key. */
export function profilesOf(p: Parsed): { active?: string; apiKey: Profile[]; all: Profile[] } {
  const r = record(p);
  const list = Array.isArray(r?.profiles) ? (r!.profiles as unknown[]).filter(isObj) : [];
  const all = list.map((x) => ({ name: String(x.name ?? ""), method: String(x.method ?? "") }));
  return { active: str(r?.active), apiKey: all.filter((x) => x.method === "api_key"), all };
}

/** Actions the credential was not granted, from `permissions check`. */
export function missingActions(p: Parsed | undefined): string[] {
  if (!p) return [];
  const list = rows(p) ?? [];
  return list.filter((r) => r.granted === false && typeof r.action === "string").map((r) => r.action as string);
}

export function checks(input: DoctorInput): Check[] {
  const out: Check[] = [];
  const c = copy.doctor;
  const biz = input.accountId ?? "<biz_id>";

  // 1 signed in
  const auth = record(input.auth);
  if (!auth || auth.loggedIn !== true) {
    out.push({ key: "auth", label: c.labels.auth, level: "fail", detail: auth ? c.notSignedIn : errLine(input.auth) || c.notSignedIn, fix: ["whop", "login"], blocking: true });
  } else {
    const account = isObj(auth.account) ? auth.account : undefined;
    out.push({ key: "auth", label: c.labels.auth, level: "ok", detail: [auth.profile, auth.method, account?.title].filter(Boolean).join(" · "), blocking: true });
  }

  // 2 identity: Whop's own payout limit says whether verification is done.
  const methods = input.methods;
  const limit = methods.ok && methods.payload.kind === "page" ? limitFor(methods.payload.extra?.limits, "standard") : undefined;
  const verification = rows(input.verifications)?.[0];
  const vStatus = str(verification?.status);
  const prefix = vStatus ? c.verification(vStatus) + " · " : "";
  if (limit?.code) {
    out.push({ key: "identity", label: c.labels.identity, level: "fail", detail: prefix + c.payoutsBlocked(limit.message ?? limit.code), fix: ["whop", "verifications", "create", "--account_id", biz], blocking: true });
  } else if (limit) {
    out.push({ key: "identity", label: c.labels.identity, level: "ok", detail: prefix + c.payoutsAllowed(money(limit.max, "usd")), blocking: true });
  } else if (!methods.ok) {
    out.push({ key: "identity", label: c.labels.identity, level: "warn", detail: prefix + c.limitsUnreadable(errLine(methods)), blocking: true });
  } else {
    out.push({ key: "identity", label: c.labels.identity, level: "warn", detail: prefix + c.limitsMissing, blocking: true });
  }

  // 3 api key profile and scopes
  const profiles = profilesOf(input.profiles);
  const missing = missingActions(input.permissions);
  const activeIsKey = profiles.all.find((p) => p.name === profiles.active)?.method === "api_key";
  if (!input.profiles.ok) {
    out.push({ key: "apikey", label: c.labels.apiKey, level: "warn", detail: errLine(input.profiles), blocking: false });
  } else if (activeIsKey) {
    out.push({ key: "apikey", label: c.labels.apiKey, level: missing.length ? "warn" : "ok", detail: missing.length ? c.keyLacks(profiles.active ?? "", missing) : c.keyActive(profiles.active ?? ""), dashboard: missing.length ? dashboardUrl(input.accountId) : undefined, blocking: false });
  } else if (profiles.apiKey.length) {
    const alt = profiles.apiKey[0].name;
    out.push({ key: "apikey", label: c.labels.apiKey, level: missing.length ? "warn" : "ok", detail: missing.length ? c.oauthLacks(missing, alt) : c.oauthFine(alt), fix: missing.length ? ["whop", "auth", "switch", alt] : undefined, blocking: false });
  } else {
    out.push({ key: "apikey", label: c.labels.apiKey, level: "warn", detail: missing.length ? c.noKeyLacks(missing) : c.noKey, fix: ["whop", "auth", "login", "--method", "api-key", "--api-key", "<whop_key>", "--profile", "prod"], dashboard: dashboardUrl(input.accountId), blocking: false });
  }

  // 4 pixel
  const people = peopleSummary(input.people);
  if (!input.people.ok) out.push({ key: "pixel", label: c.labels.pixel, level: "warn", detail: errLine(input.people), blocking: false });
  else if (people.seen === 0) out.push({ key: "pixel", label: c.labels.pixel, level: "warn", detail: c.noPeople, fix: ["whop", "events", "validate_pixel"], blocking: false });
  else if (people.attributed === 0) out.push({ key: "pixel", label: c.labels.pixel, level: "warn", detail: copy.gtm.gap.pixel, fix: ["whop", "events", "validate_pixel"], blocking: false });
  else out.push({ key: "pixel", label: c.labels.pixel, level: "ok", detail: c.attributed(people.attributed, people.seen), blocking: false });

  // 5 meta page
  const social = rows(input.social);
  const page = social?.find((s) => !s.error);
  if (!social) out.push({ key: "page", label: c.labels.page, level: "warn", detail: errLine(input.social) || copy.detail.empty, blocking: false });
  else if (!page) out.push({ key: "page", label: c.labels.page, level: "warn", detail: copy.gtm.gap.page, fix: ["whop", "social-accounts", "connect", "--platform", "meta_business", "--scopes", "advertise", "--redirect_url", "<url>"], blocking: false });
  else out.push({ key: "page", label: c.labels.page, level: "ok", detail: [str(page.name) ?? str(page.id), str(page.platform) ? `(${page.platform})` : "", str(page.username) ? `@${page.username}` : ""].filter(Boolean).join(" "), blocking: false });

  // 6 ads payment method, 7 economic intelligence
  const prefs = record(input.preferences);
  if (!prefs) {
    out.push({ key: "payment", label: c.labels.payment, level: "warn", detail: errLine(input.preferences) || copy.detail.empty, blocking: false });
    out.push({ key: "ei", label: c.labels.ei, level: "warn", detail: errLine(input.preferences) || copy.detail.empty, blocking: false });
  } else {
    const pm = prefs.ads_payment_methods;
    const has = Array.isArray(pm) ? pm.length > 0 : pm != null && pm !== "";
    if (has) out.push({ key: "payment", label: c.labels.payment, level: "ok", detail: c.paymentOn(Array.isArray(pm) ? pm.length : 1), blocking: false });
    else out.push({ key: "payment", label: c.labels.payment, level: "warn", detail: copy.gtm.gap.payment, dashboard: dashboardUrl(input.accountId), blocking: false });
    if (prefs.economic_intelligence === true) out.push({ key: "ei", label: c.labels.ei, level: "ok", detail: c.eiOn, blocking: false });
    else out.push({ key: "ei", label: c.labels.ei, level: "warn", detail: copy.gtm.gap.ei, fix: ["whop", "accounts", "update-preferences", "--economic_intelligence", "true"], blocking: false });
  }

  // 8 a product someone can buy
  const products = rows(input.products);
  const sellable = products?.filter((p) => p.visibility === "visible" && isObj(p.default_plan)) ?? [];
  if (!products) out.push({ key: "products", label: c.labels.products, level: "fail", detail: errLine(input.products) || copy.detail.empty, blocking: true });
  else if (!sellable.length) out.push({ key: "products", label: c.labels.products, level: "fail", detail: products.length ? c.noSellable(products.length) : c.noProducts, fix: ["whop", "products", "create", "--help"], blocking: true });
  else {
    const first = sellable[0];
    out.push({ key: "products", label: c.labels.products, level: "ok", detail: c.forSale(sellable.length, str(first.title) ?? String(first.id), planPrice(first.default_plan as Parameters<typeof planPrice>[0])), blocking: true });
  }

  // 9 a webhook that has delivered
  const hooks = rows(input.webhooks);
  if (!input.webhooks.ok) {
    const scope = input.webhooks.error.code === "HTTP_403";
    const alt = profiles.apiKey[0]?.name;
    out.push({ key: "webhooks", label: c.labels.webhooks, level: "warn", detail: scope ? c.webhooksScope : errLine(input.webhooks), fix: scope ? (alt ? ["whop", "auth", "switch", alt] : ["whop", "auth", "login", "--method", "api-key", "--api-key", "<whop_key>", "--profile", "prod"]) : undefined, blocking: false });
  } else if (!hooks?.length) {
    out.push({ key: "webhooks", label: c.labels.webhooks, level: "warn", detail: c.noWebhooks, fix: ["whop", "webhooks", "create", "--url", "<url>", "--events", '["payment.succeeded"]'], blocking: false });
  } else {
    const alive = hooks.map((h) => ({ hook: h, last: lastSuccess(input.deliveries[String(h.id)]) })).find((x) => x.last !== undefined);
    const more = hooks.length > 1 ? c.more(hooks.length - 1) : "";
    if (alive) out.push({ key: "webhooks", label: c.labels.webhooks, level: "ok", detail: [c.delivered(str(alive.hook.url) ?? String(alive.hook.id), relative(alive.last)), more].filter(Boolean).join(" · "), blocking: false });
    else {
      const h = hooks[0];
      out.push({ key: "webhooks", label: c.labels.webhooks, level: "warn", detail: [c.noDelivery(str(h.url) ?? String(h.id), DELIVERY_WINDOW_DAYS), more].filter(Boolean).join(" · "), fix: ["whop", "webhooks", "test", String(h.id), "--event", "payment.succeeded"], blocking: false });
    }
  }
  return out;
}

/** The newest successful delivery inside the window, as its `sent_at`. */
export function lastSuccess(p: Parsed | undefined): string | undefined {
  const list = p ? rows(p) : undefined;
  if (!list) return undefined;
  const cutoff = now() - DELIVERY_WINDOW_DAYS * 86_400_000;
  const ok = list.filter((d) => d.success === true && typeof d.sent_at === "string" && Date.parse(d.sent_at) >= cutoff).map((d) => d.sent_at as string);
  return ok.sort().at(-1);
}

/** Exit 1 when a blocking check fails. */
export const blocked = (list: Check[]) => list.some((c) => c.blocking && c.level === "fail");

const SYMBOL: Record<Level, [string, Role]> = { ok: ["✓", "good"], warn: ["!", "warn"], fail: ["✗", "bad"] };

/** The screen as data: `wv doctor --format json`. `ok` is the exit rule, `blocking` names the checks behind it. */
export function doctorData(input: DoctorInput): Rec {
  const list = checks(input);
  return {
    ok: !blocked(list),
    blocking: list.filter((c) => c.blocking && c.level === "fail").map((c) => c.key),
    checks: list,
    account: input.accountId || input.accountTitle ? { id: input.accountId, title: input.accountTitle } : undefined,
    mode: input.mode ?? "production",
    dashboard: dashboardUrl(input.accountId),
    commands: input.commands.map((c) => teach(c)),
  };
}

export function doctorView(input: DoctorInput, theme: Theme): string[] {
  const list = checks(input);
  const out: string[] = [];
  out.push(
    ...breadcrumb(theme, [
      [input.accountTitle ?? "", "accent"],
      [input.accountId ?? "", "muted"],
      [copy.session.mode(input.mode ?? "production"), input.mode === "sandbox" ? "good" : "warn"],
      [copy.doctor.title, "accent"],
    ]),
  );
  out.push("");
  const labelW = Math.max(...list.map((c) => width(c.label)));
  const hang = 3 + labelW + 2;
  for (const c of list) {
    const [sym, role] = SYMBOL[c.level];
    const lines = wrap(c.detail, Math.max(16, theme.width - hang));
    out.push(" " + paint(theme, role, sym) + " " + paint(theme, "accent", padEnd(c.label, labelW)) + "  " + paint(theme, c.level === "ok" ? "text" : role, lines[0] ?? ""));
    for (const l of lines.slice(1)) out.push(" ".repeat(hang) + paint(theme, c.level === "ok" ? "text" : role, l));
    const fixes: FooterLine[] = [];
    if (c.fix) fixes.push([copy.doctor.fix, c.fix]);
    if (c.dashboard) fixes.push([copy.doctor.dashboard, c.dashboard]);
    if (fixes.length) out.push(...footer(fixes, theme));
  }
  out.push("");
  const fails = list.filter((c) => c.level === "fail").length;
  const warns = list.filter((c) => c.level === "warn").length;
  const oks = list.filter((c) => c.level === "ok").length;
  const parts = [fails ? paint(theme, "bad", copy.doctor.blocking(fails)) : "", warns ? paint(theme, "warn", copy.doctor.warnings(warns)) : "", paint(theme, "good", copy.doctor.ok(oks))].filter(Boolean);
  out.push(" " + parts.join(paint(theme, "muted", " · ")));
  out.push("");
  out.push(...footer(input.commands.map((cmd, i): [string, string[]] => [i === 0 ? copy.list.json : " ".repeat(copy.list.json.length), teach(cmd)]), theme));
  return out;
}
