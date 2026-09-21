// `wv dev [app_id]`: the app loop on one screen: the app and its production builds, its domains and their
// verification, the account's webhooks and their failure streaks, and the last day's error lines. `wv dev hook
// <url>`: a webhook created, tested, and proven delivered, as one plan, refused before anything runs when the
// credential is an OAuth login, since webhooks need an API-key profile. Reads only here; bin.ts gathers and runs.
import type { Parsed, Rec } from "../envelope.ts";
import { copy, type Mode } from "../copy.ts";
import { relative, shortDate } from "../format.ts";
import { footer, type FooterLine } from "../primitives/footer.ts";
import { kv, type KvRow, type KvSection } from "../primitives/kv.ts";
import { breadcrumb } from "../primitives/rule.ts";
import { table, type TableCell, type TableColumn } from "../primitives/table.ts";
import { teach } from "../argv.ts";
import { paint, type Theme } from "../tokens.ts";
import { wrap } from "../ansi.ts";
import { statusLabel, statusRole } from "../status.ts";
import { missingActions, profilesOf } from "./doctor.ts";
import { recipeData, stepKey, type RecipePlan, type RecipeRow, type RecipeStep } from "./recipe.ts";

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const rows = (p: Parsed | undefined): Rec[] | undefined => (p && p.ok && p.payload.kind === "page" ? p.payload.rows : undefined);
const errLine = (p: Parsed) => (p.ok ? "" : `${p.error.code} ${p.error.message.split("\n")[0]}`);

export const WEBHOOK_ACTION = "developer:manage_webhook";

export interface DevInput {
  accountTitle?: string;
  accountId?: string;
  mode?: Mode;
  /** `apps list` */
  apps: Parsed;
  /** The app the screen is about: the one named, else the first listed. */
  app?: Rec;
  /** `app-builds list --app_id` */
  builds?: Parsed;
  /** `domains list --app_id` */
  domains?: Parsed;
  /** `webhooks list --include_app_webhooks` */
  webhooks: Parsed;
  /** `apps logs <id> --level error --created_after <24h ago>` */
  errors?: Parsed;
  /** `auth list` */
  profiles: Parsed;
  /** `permissions check --actions developer:manage_webhook` */
  permissions?: Parsed;
  now?: number;
  commands: string[][];
}

/**
 * Whether this credential can manage webhooks: an API-key profile with the action granted. The OAuth token
 * the CLI signs in with lacks the scope, and `webhooks list` answers 403 in that case.
 */
export function webhookAccess(profiles: Parsed, permissions: Parsed | undefined, webhooks: Parsed | undefined): { ok: boolean; reason?: string; fix?: string[] } {
  const p = profilesOf(profiles);
  const active = p.all.find((x) => x.name === p.active);
  const missing = missingActions(permissions).includes(WEBHOOK_ACTION);
  const forbidden = !!webhooks && !webhooks.ok && /^HTTP_403$/.test(webhooks.error.code);
  if (active?.method === "api_key" && !missing && !forbidden) return { ok: true };
  if (active?.method === "api_key" && !missing && forbidden) return { ok: false, reason: copy.dev.forbidden, fix: ["whop", "auth", "login", "--method", "api-key"] };
  const alt = p.apiKey[0];
  return { ok: false, reason: active?.method === "api_key" ? copy.dev.keyLacksScope : copy.dev.oauth, fix: alt ? ["whop", "auth", "switch", alt.name] : ["whop", "auth", "login", "--method", "api-key"] };
}

export function devData(input: DevInput): Rec {
  const access = webhookAccess(input.profiles, input.permissions, input.webhooks);
  const errors = rows(input.errors);
  return {
    ok: input.apps.ok,
    account: input.accountId || input.accountTitle ? { id: input.accountId, title: input.accountTitle } : undefined,
    mode: input.mode ?? "production",
    apps: rows(input.apps)?.map((a) => ({ id: a.id, name: a.name, app_type: a.app_type, status: a.status, hosted_url: a.hosted_url, base_url: a.base_url, verified: a.verified })) ?? { error: errLine(input.apps) },
    app: input.app ? { id: input.app.id, name: input.app.name, app_type: input.app.app_type, status: input.app.status, hosted_url: input.app.hosted_url, verified: input.app.verified } : undefined,
    builds: input.builds ? (rows(input.builds) ?? { error: errLine(input.builds) }) : undefined,
    domains: input.domains ? (rows(input.domains) ?? { error: errLine(input.domains) }) : undefined,
    webhooks: rows(input.webhooks)?.map((w) => ({ id: w.id, url: w.url, enabled: w.enabled, events: w.events, consecutive_failures: w.consecutive_failures, failing_since: w.failing_since, disabled_reason: w.disabled_reason })) ?? { error: errLine(input.webhooks) },
    webhookAccess: access,
    errorsLast24h: errors ? errors.length : undefined,
    commands: input.commands.map((c) => teach(c)),
  };
}

function appRows(input: DevInput): KvRow[] {
  const c = copy.dev;
  const a = input.app;
  if (!input.apps.ok) return [{ key: c.app, value: errLine(input.apps), role: "warn" }];
  if (!a) return [{ key: c.app, value: c.noApps, role: "muted" }];
  const status = str(a.status) ?? "";
  return [
    { key: c.app, value: `${str(a.name) ?? ""}  ${String(a.id)}`.trim(), role: "text" },
    { key: c.type, value: [str(a.app_type)?.replace(/_/g, " ") ?? "", statusLabel(status), a.verified === true ? c.verified : c.unverified].filter(Boolean).join(" · "), role: status === "live" ? "good" : statusRole(status) },
    { key: c.url, value: str(a.hosted_url) ?? str(a.base_url) ?? c.noUrl, role: str(a.hosted_url) ? "text" : "muted" },
  ];
}

function buildTable(input: DevInput, theme: Theme): string[] {
  const c = copy.dev;
  if (!input.builds) return [];
  const list = rows(input.builds);
  if (!list) return wrap(errLine(input.builds) || copy.detail.empty, theme.width - 1).map((l) => " " + paint(theme, input.builds.ok ? "muted" : "warn", l));
  if (!list.length) return wrap(c.noBuilds, theme.width - 1).map((l) => " " + paint(theme, "muted", l));
  const cols: TableColumn[] = [
    { key: "platform", label: c.cols.platform, align: "left", priority: 1 },
    { key: "status", label: c.cols.status, align: "left", priority: 0 },
    { key: "production", label: c.cols.production, align: "left", priority: 2 },
    { key: "created", label: c.cols.created, align: "left", priority: 3 },
    { key: "id", label: "id", align: "left", priority: 4, max: 22 },
  ];
  const cells = list.slice(0, 6).map((b) => {
    const row: Record<string, TableCell> = {};
    const status = str(b.status) ?? "";
    row.platform = { text: str(b.platform) ?? "", role: "muted" };
    row.status = { text: statusLabel(status), role: status === "approved" ? "good" : status === "rejected" ? "bad" : status === "pending" ? "warn" : "muted" };
    row.production = { text: b.is_production === true ? c.live : copy.detail.empty, role: b.is_production === true ? "good" : "muted" };
    row.created = { text: str(b.created_at) ? relative(b.created_at as string) : copy.detail.empty, role: "muted" };
    row.id = { text: String(b.id ?? ""), role: "muted" };
    return row;
  });
  return table(cols, cells, theme).lines;
}

function domainTable(input: DevInput, theme: Theme): string[] {
  const c = copy.dev;
  if (!input.domains) return [];
  const list = rows(input.domains);
  if (!list) return wrap(errLine(input.domains) || copy.detail.empty, theme.width - 1).map((l) => " " + paint(theme, input.domains.ok ? "muted" : "warn", l));
  if (!list.length) return wrap(c.noDomains, theme.width - 1).map((l) => " " + paint(theme, "muted", l));
  const cols: TableColumn[] = [
    { key: "domain", label: c.cols.domain, align: "left", priority: 0, max: 36 },
    { key: "status", label: c.cols.status, align: "left", priority: 1 },
    { key: "dns", label: c.cols.dns, align: "left", priority: 3 },
    { key: "cert", label: c.cols.cert, align: "left", priority: 4 },
    { key: "checked", label: c.cols.checked, align: "left", priority: 5 },
    { key: "id", label: "id", align: "left", priority: 2, max: 22 },
  ];
  const cells = list.map((d) => {
    const row: Record<string, TableCell> = {};
    const status = str(d.status) ?? "";
    row.domain = { text: str(d.domain) ?? "", role: "text" };
    row.status = { text: statusLabel(status), role: status === "active" ? "good" : status === "action_required" ? "bad" : "warn" };
    row.dns = { text: statusLabel(str(d.dns_status) ?? ""), role: "muted" };
    row.cert = { text: statusLabel(str(d.certificate_status) ?? ""), role: "muted" };
    row.checked = { text: str(d.last_checked_at) ? relative(d.last_checked_at as string) : copy.detail.empty, role: "muted" };
    row.id = { text: String(d.id ?? ""), role: "muted" };
    return row;
  });
  return table(cols, cells, theme).lines;
}

function webhookTable(input: DevInput, theme: Theme): string[] {
  const c = copy.dev;
  const list = rows(input.webhooks);
  if (!list) {
    const access = webhookAccess(input.profiles, input.permissions, input.webhooks);
    const text = access.ok ? errLine(input.webhooks) : `${errLine(input.webhooks) || copy.detail.empty} · ${access.reason ?? ""}`;
    return wrap(text, theme.width - 1).map((l) => " " + paint(theme, "warn", l));
  }
  if (!list.length) return wrap(c.noWebhooks, theme.width - 1).map((l) => " " + paint(theme, "muted", l));
  const cols: TableColumn[] = [
    { key: "url", label: c.cols.url, align: "left", priority: 0, max: 40 },
    { key: "enabled", label: c.cols.enabled, align: "left", priority: 1 },
    { key: "events", label: c.cols.events, align: "right", priority: 3 },
    { key: "failures", label: c.cols.failures, align: "left", priority: 2 },
    { key: "id", label: "id", align: "left", priority: 4, max: 22 },
  ];
  const cells = list.map((w) => {
    const row: Record<string, TableCell> = {};
    const failures = typeof w.consecutive_failures === "number" ? w.consecutive_failures : 0;
    row.url = { text: str(w.url) ?? "", role: "text" };
    row.enabled = { text: w.enabled === false ? `${c.disabled}${str(w.disabled_reason) ? ` · ${(w.disabled_reason as string).replace(/_/g, " ")}` : ""}` : c.enabled, role: w.enabled === false ? "bad" : "good" };
    row.events = { text: String(Array.isArray(w.events) ? w.events.length : 0), role: "muted" };
    row.failures = { text: failures > 0 ? c.failing(failures, str(w.failing_since) ? relative(w.failing_since as string) : undefined) : c.healthy, role: failures > 0 ? "bad" : "muted" };
    row.id = { text: String(w.id ?? ""), role: "muted" };
    return row;
  });
  return table(cols, cells, theme).lines;
}

export function devView(input: DevInput, theme: Theme): string[] {
  const c = copy.dev;
  const out: string[] = [];
  out.push(...breadcrumb(theme, [[input.accountTitle ?? "", "accent"], [input.accountId ?? "", "muted"], [copy.session.mode(input.mode ?? "production"), input.mode === "sandbox" ? "good" : "warn"], [c.title, "accent"], [str(input.app?.name) ?? "", "muted"]]));
  out.push("");
  const sections: KvSection[] = [{ rows: appRows(input) }];
  out.push(...kv(sections, theme));
  out.push("");
  if (input.app) {
    out.push(" " + paint(theme, "accent", c.builds));
    out.push(...buildTable(input, theme), "");
    out.push(" " + paint(theme, "accent", c.domains));
    out.push(...domainTable(input, theme), "");
  }
  out.push(" " + paint(theme, "accent", c.webhooks));
  out.push(...webhookTable(input, theme), "");
  if (input.app && input.errors) {
    const errors = rows(input.errors);
    out.push(...wrap(errors ? c.errors(errors.length) : errLine(input.errors), theme.width - 1).map((l) => " " + paint(theme, errors && errors.length ? "warn" : "muted", l)), "");
  }
  const access = webhookAccess(input.profiles, input.permissions, input.webhooks);
  const lines: FooterLine[] = [];
  if (input.app) {
    lines.push([c.deploy, ["whop", "apps", "deploy"]]);
    lines.push([c.follow, ["wv", "apps", "logs", String(input.app.id), "--follow"]]);
  }
  if (!access.ok && access.fix) lines.push([copy.doctor.fix, access.fix]);
  lines.push([c.hook, ["wv", "dev", "hook", "https://<your host>/hooks", "--plan"]]);
  for (const cmd of input.commands) lines.push([copy.list.json, teach(cmd)]);
  out.push(...footer(lines, theme), "");
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// `wv dev hook <url> [--events a,b] [--app app_x] [--test event]`: create, test, prove.

export const DEFAULT_HOOK_EVENTS = ["payment.succeeded", "membership.activated", "membership.cancel_at_period_end_changed"];

export interface HookOptions {
  url: string;
  events: string[];
  app?: string;
  test: string;
  key?: string;
}

export function parseHookArgs(argv: string[]): { opts?: HookOptions; error?: string } {
  const rest = argv[0] === "dev" && argv[1] === "hook" ? argv.slice(2) : argv;
  const flags: Record<string, string[]> = {};
  let positional: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const name = eq > 0 ? a.slice(0, eq) : a;
      if (!["--events", "--app", "--test", "--idempotency-key"].includes(name)) return { error: copy.dev.hookFlags(name) };
      (flags[name] ??= []).push(eq > 0 ? a.slice(eq + 1) : (rest[++i] ?? ""));
    } else if (!positional) positional = a;
    else return { error: copy.launch.extraArg(a) };
  }
  if (!positional) return { error: copy.dev.needsUrl };
  const events = (flags["--events"] ?? []).flatMap((e) => e.split(",")).map((e) => e.trim()).filter(Boolean);
  const list = events.length ? events : DEFAULT_HOOK_EVENTS;
  const bad = list.find((e) => !/^[a-z_]+\.[a-z_]+$/.test(e));
  if (bad) return { error: copy.dev.badEvent(bad) };
  const test = flags["--test"]?.at(-1) ?? list[0];
  return { opts: { url: positional, events: list, app: flags["--app"]?.at(-1), test, key: flags["--idempotency-key"]?.at(-1) } };
}

export interface HookReads {
  profiles: Parsed;
  permissions?: Parsed;
  webhooks: Parsed;
  accountTitle?: string;
  accountId?: string;
  mode?: Mode;
}

export interface HookPlan extends RecipePlan {
  opts: HookOptions;
}

export function buildHook(argv: string[], opts: HookOptions, reads: HookReads): HookPlan {
  const c = copy.dev;
  const mode = reads.mode ?? "production";
  const key = opts.key ?? "{key}";
  const blockers: string[] = [];
  const warnings: string[] = [];
  let url: URL | undefined;
  try {
    url = new URL(opts.url);
  } catch {
    /* handled below */
  }
  if (!url || url.protocol !== "https:") blockers.push(c.needsHttps(opts.url));
  const access = webhookAccess(reads.profiles, reads.permissions, reads.webhooks);
  if (!access.ok) blockers.push(`${access.reason ?? c.oauth} ${c.fixIs(access.fix ?? [])}`);
  const existing = (rows(reads.webhooks) ?? []).find((w) => str(w.url) === opts.url);
  if (existing) blockers.push(c.exists(String(existing.id)));
  if (!opts.events.includes(opts.test)) warnings.push(c.testNotSubscribed(opts.test));
  const steps: RecipeStep[] = [
    {
      key: "hook",
      label: c.stepLabels.hook,
      what: c.hookLine(opts.events.length, url?.host ?? opts.url, opts.app),
      group: "webhooks",
      verb: "create",
      argv: ["webhooks", "create", "--url", opts.url, "--events", JSON.stringify(opts.events), ...(opts.app ? ["--resource_id", opts.app] : []), "--idempotency-key", stepKey(key, "hook")],
    },
    {
      key: "test",
      label: c.stepLabels.test,
      what: c.testLine(opts.test),
      group: "webhooks",
      verb: "test",
      argv: ["webhooks", "test", "{hook.id}", "--event", opts.test],
    },
  ];
  const summary: RecipeRow[] = [
    { key: c.url, value: opts.url, role: url?.protocol === "https:" ? "text" : "warn" },
    { key: c.cols.events, value: opts.events.join(", "), role: "muted" },
    { key: c.scope, value: opts.app ?? c.account, role: "muted" },
    { key: c.credential, value: access.ok ? c.apiKeyOk : (access.reason ?? c.oauth), role: access.ok ? "good" : "bad" },
  ];
  return {
    name: "hook",
    title: c.hookTitle,
    argv,
    mode,
    account: reads.accountId || reads.accountTitle ? { id: reads.accountId, title: reads.accountTitle } : undefined,
    summary,
    steps,
    blockers,
    warnings,
    data: { url: opts.url, events: opts.events, app: opts.app, test: opts.test, access },
    done: (results) => hookChecks(results),
    opts,
  };
}

/** "Done when": the test delivery succeeded, and the hook shows no failures on the dev screen. */
export function hookChecks(results: Partial<Record<string, Rec>>): { label: string; argv: string[] }[] {
  const c = copy.dev.check;
  const out: { label: string; argv: string[] }[] = [];
  if (results.hook?.id) out.push({ label: c.delivery, argv: ["whop", "webhooks", "deliveries", String(results.hook.id), "--first", "1", "--format", "json"] });
  if (results.hook?.id) out.push({ label: c.hook, argv: ["whop", "webhooks", "get", String(results.hook.id), "--format", "json"] });
  out.push({ label: c.screen, argv: ["wv", "dev"] });
  return out;
}

export const hookData = (plan: HookPlan): Rec => recipeData(plan);
void shortDate;
