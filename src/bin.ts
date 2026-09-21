#!/usr/bin/env node
// wv: human view layer for the Whop CLI. Renders when a person is looking, execs `whop` otherwise.
import { makeTheme, type Theme } from "./tokens.ts";
import { helpText, modeFrom, passthrough, run, shouldPassthrough, whopEnv, type Mode } from "./runner.ts";
import { hintsFor } from "./hints.ts";
import { isWrite, MONEY_GROUPS } from "./status.ts";
import { teach } from "./argv.ts";
import { daysAgo, isoDay } from "./format.ts";
import { copy } from "./copy.ts";
import { listViewWithMeta, type ListRender } from "./views/list.ts";
import { detailView } from "./views/detail.ts";
import { amountMatcher, confirmView, describeMethod, flagsToRecord, limitFor, moneyOf, refusedView, speedOf, type Balance, type WhopLimit } from "./views/confirm.ts";
import { money } from "./format.ts";
import { adPlanView, adRefusedView, budgetOf, commitment, isAdPlan, jsonFlags, reachArgv, treeFromArgv, type AdPlanInput, type AdTree, type Reach } from "./views/adplan.ts";
import { errorView } from "./views/error.ts";
import { helpView, parseHelp } from "./views/help.ts";
import { homeView } from "./views/home.ts";
import { gtmView } from "./views/gtm.ts";
import { blocked, checks, doctorView, DOCTOR_ACTIONS } from "./views/doctor.ts";
import { seriesView } from "./views/series.ts";
import { summaryView } from "./views/summary.ts";
import { prompt } from "./primitives/prompt.ts";
import { spinner } from "./primitives/spinner.ts";
import { session } from "./tui/session.ts";
import type { Parsed, Rec } from "./envelope.ts";

const print = (lines: string[]) => process.stdout.write(lines.join("\n") + "\n");

/** Words that are wv's, not whop's. */
const OURS = new Set(["home", "help", "gtm", "doctor"]);

export interface Outcome {
  code: number;
  /** Rows of a list, so the session can offer row shortcuts. */
  rows?: Rec[];
  group?: string;
  /** The printed list and where its rows sit, so the session can highlight one in place. */
  list?: ListRender;
  /** The agent command the view taught, as argv. The session's `copy json` puts it on the clipboard. */
  teach?: string[];
  /** wv argv for the next page of a list. The session's `next` runs it. */
  next?: string[];
}

/** Splits wv's own flags out of argv. */
export function ownFlags(argvIn: string[]): { argv: string[]; width?: number; sandbox: boolean; plan: boolean } {
  let width: number | undefined;
  let sandbox = false;
  let plan = false;
  const argv: string[] = [];
  for (let i = 0; i < argvIn.length; i++) {
    const a = argvIn[i];
    if (a === "--width") width = Number(argvIn[++i]);
    else if (a.startsWith("--width=")) width = Number(a.slice(8));
    else if (a === "--sandbox") sandbox = true;
    else if (a === "--plan") plan = true;
    else argv.push(a);
  }
  return { argv, width: width !== undefined && Number.isFinite(width) && width > 0 ? Math.floor(width) : undefined, sandbox, plan };
}

/** Per-payout cap from `WV_PAYOUT_CAP`, in whole currency units. `none` turns it off. Default $500, like Link. */
export const DEFAULT_CAP = 500;
export function capFrom(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env.WV_PAYOUT_CAP;
  if (raw === undefined || raw === "") return DEFAULT_CAP;
  if (/^(none|off|0)$/i.test(raw.trim())) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CAP;
}

/** Cap on the spend an ad write commits, from `WV_AD_CAP`. Same default and spellings as the payout cap. */
export function adCapFrom(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env.WV_AD_CAP;
  if (raw === undefined || raw === "") return DEFAULT_CAP;
  if (/^(none|off|0)$/i.test(raw.trim())) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CAP;
}

/** How long a money prompt stays open, from `WV_CONFIRM_TIMEOUT` seconds. `0` or `none` waits forever. */
export const DEFAULT_TIMEOUT_SECONDS = 120;
export function timeoutFrom(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = env.WV_CONFIRM_TIMEOUT;
  if (raw === undefined || raw === "") return DEFAULT_TIMEOUT_SECONDS;
  if (/^(none|off|0)$/i.test(raw.trim())) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_TIMEOUT_SECONDS;
}

async function main(argvIn: string[]) {
  const { argv, width, sandbox, plan } = ownFlags(argvIn);
  const theme = makeTheme({ width });
  const mode = modeFrom(sandbox);
  const env = whopEnv(mode);

  if (OURS.has(argv[0]) && !process.stdout.isTTY) {
    process.stderr.write(`wv: ${copy.session.needsTerminal(argv[0])}\n`);
    process.exit(2);
  }
  // `--plan` never writes, so it is safe without a terminal and must never fall through to a real `whop` create.
  if (shouldPassthrough(argv) && !plan) passthrough(argv, env);

  if (argv.length === 0) {
    const acct = await identity(env);
    process.exit(await session({ theme, execute: (a, t) => execute(a, t, { numbered: true, mode }), account: acct, mode }));
  }
  process.exit((await execute(argv, theme, { mode, plan })).code);
}

export interface ExecuteOptions {
  /** Inside a session: lists get a row-number gutter for the `N opens a row` shortcut. */
  numbered?: boolean;
  /** Which host the child `whop` talks to. Default production. */
  mode?: Mode;
  /** `--plan`: for an ad write, print the plan card and run nothing. */
  plan?: boolean;
}

/** Runs one wv command end to end and prints it. Shared by the one-shot CLI and the session. */
export async function execute(argv: string[], theme: Theme, opts: ExecuteOptions = {}): Promise<Outcome> {
  const [group, verb] = argv;
  if (!group || group === "help") {
    const target = group === "help" ? argv[1] : undefined;
    print(helpView(parseHelp(helpText(target ? [target] : [])), theme, target));
    return { code: 0 };
  }
  const mode = opts.mode ?? "production";
  const env = whopEnv(mode);
  if (group === "home") return home(theme, mode);
  if (group === "gtm") return gtm(theme, mode);
  if (group === "doctor") return doctor(theme, mode);
  if (!verb || verb.startsWith("--")) {
    print(helpView(parseHelp(helpText([group])), theme, group));
    return { code: 0 };
  }

  const hints = hintsFor(group, verb);
  const yes = argv.includes("--yes");
  const args = argv.filter((a) => a !== "--yes");

  if (isAdPlan(group, verb) && (!yes || opts.plan)) {
    // Ads gate. The CLI has no dry-run, so the plan is the sandbox: the tree, a real reach estimate,
    // the committed spend, and who pays, on one card. `--plan` stops there.
    const spin = spinner(copy.spinner.adplan, theme);
    const input = await adPlanFor(group, verb, args, env, mode, !!opts.plan).finally(() => spin.stop());
    if (opts.plan) {
      print(adPlanView(input, theme));
      return { code: 0 };
    }
    const live = mode !== "sandbox";
    if (live && input.budget && input.cap != null && commitment(input.budget).total > input.cap) {
      print(adRefusedView(input, theme));
      return { code: 2 };
    }
    print(adPlanView(input, theme));
    const typed = live && input.budget?.typed ? input.budget.amount : undefined;
    const shown = typed !== undefined ? money(typed, input.currency ?? "usd").replace(/^[^\d]+/, "") : "";
    const accept = typed !== undefined ? { test: amountMatcher(typed), hint: copy.confirm.amountNo(shown) } : undefined;
    const answer = await prompt(typed !== undefined ? copy.adplan.typeBudget(shown) : copy.confirm.question, theme, { timeoutMs: input.timeoutSeconds ? input.timeoutSeconds * 1000 : undefined, accept });
    if (answer !== "yes") {
      print([" " + (answer === "timeout" && input.timeoutSeconds ? copy.confirm.expired(input.timeoutSeconds) : copy.confirm.aborted)]);
      return { code: 130 };
    }
    print([""]);
  } else if (isWrite(group, verb) && !yes) {
    // Money gate. Like Link's approval: the amount, where it goes, and what it draws from are on screen,
    // a cap refuses before the network, and a prompt left sitting is not consent.
    const m = MONEY_GROUPS.has(group) ? moneyOf(args) : null;
    const methodId = flagsToRecord(args).payout_method_id;
    const spin = spinner(m ? copy.spinner.money : copy.spinner.identity, theme);
    const [acct, balance, methods] = await Promise.all([
      identity(env),
      m ? balanceFor(m.currency, env) : undefined,
      m || typeof methodId === "string" ? methodsFor(typeof methodId === "string" ? methodId : undefined, m?.currency ?? "usd", speedOf(args), env) : undefined,
    ]).finally(() => spin.stop());
    const live = m && mode !== "sandbox";
    const cap = live ? capFrom() : undefined;
    const limit = live ? methods?.limit : undefined;
    const timeoutSeconds = live ? timeoutFrom() : undefined;
    const input = { group, verb, argv: args, hints, accountTitle: acct?.title, accountId: acct?.id, mode, destination: methods?.destination, balance, cap, limit, timeoutSeconds };
    // Refusals, cheapest reason first. Whop's own limit wins over wv's when both are exceeded: it is the real one.
    if (live && limit && m.amount > limit.max) {
      print(refusedView({ ...input, reason: "whop" }, theme));
      return { code: 2 };
    }
    if (live && cap != null && m.amount > cap) {
      print(refusedView({ ...input, reason: "cap" }, theme));
      return { code: 2 };
    }
    if (live && balance && m.amount > balance.available) {
      print(refusedView({ ...input, reason: "balance" }, theme));
      return { code: 2 };
    }
    print(confirmView(input, theme));
    // Money: type the amount back. Everything else: y.
    const shown = m ? money(m.amount, m.currency).replace(/^[^\d]+/, "") : "";
    const accept = live ? { test: amountMatcher(m.amount), hint: copy.confirm.amountNo(shown) } : undefined;
    const answer = await prompt(live ? copy.confirm.typeAmount(shown) : copy.confirm.question, theme, { timeoutMs: timeoutSeconds ? timeoutSeconds * 1000 : undefined, accept });
    if (answer !== "yes") {
      print([" " + (answer === "timeout" && timeoutSeconds ? copy.confirm.expired(timeoutSeconds) : copy.confirm.aborted)]);
      return { code: 130 };
    }
    print([""]);
  }

  const spin = spinner(copy.spinner.running(args), theme);
  const { parsed, code } = await run(args, env);
  spin.stop();
  return { code, group, ...render(parsed, group, args, theme, opts) };
}

/**
 * Everything the ad plan card shows, gathered in as few calls as the tree allows: identity, the account's
 * ads preferences, connected pages, the balance, the campaign and group the command points at, the names
 * of any audiences it targets, and one real `estimate_reach` for the group's targeting.
 */
async function adPlanFor(group: string, verb: string, args: string[], env: NodeJS.ProcessEnv, mode: Mode, planOnly: boolean): Promise<AdPlanInput> {
  const tree: AdTree = treeFromArgv(group, verb, args);
  const flags = jsonFlags(args);
  const record = async (argv: string[]): Promise<Rec | undefined> => {
    const { parsed } = await run(argv, env);
    return parsed.ok && "record" in parsed.payload ? parsed.payload.record : undefined;
  };
  const page = async (argv: string[]): Promise<Rec[] | undefined> => {
    const { parsed } = await run(argv, env);
    return parsed.ok && parsed.payload.kind === "page" ? parsed.payload.rows : undefined;
  };
  const [acct, prefs, social, group0] = await Promise.all([
    identity(env),
    record(["accounts", "preferences"]),
    page(["social-accounts", "list"]),
    tree.group?.id ? record(["ad-groups", "get", tree.group.id]) : undefined,
  ]);
  if (tree.group && group0) tree.group.rec = { ...group0, ...tree.group.rec };
  // The campaign can hide behind a fetched group.
  const campaignId = tree.campaign?.id ?? (group0 && typeof group0.ad_campaign === "object" && group0.ad_campaign ? String((group0.ad_campaign as Rec).id ?? "") : "");
  if (campaignId && !tree.campaign) tree.campaign = { id: campaignId, isNew: false, rec: {} };
  const currency = typeof prefs?.ads_reporting_currency === "string" ? prefs.ads_reporting_currency : "usd";
  const platform = typeof tree.campaign?.rec.platform === "string" ? tree.campaign.rec.platform : typeof flags.platform === "string" ? flags.platform : "meta";
  const groupRec = tree.group?.rec ?? {};
  const aud = groupRec.audiences && typeof groupRec.audiences === "object" ? (groupRec.audiences as Rec) : undefined;
  const wantsAudiences = !!aud && (Array.isArray(aud.include) || Array.isArray(aud.exclude));
  const estimate = tree.group ? reachArgv(groupRec, platform) : undefined;
  const [campaign, balance, audiences, reachParsed] = await Promise.all([
    tree.campaign?.id ? record(["ad-campaigns", "get", tree.campaign.id]) : undefined,
    balanceFor(currency, env),
    wantsAudiences ? page(["audiences", "list"]) : undefined,
    estimate ? run(estimate, env).then((r) => r.parsed) : undefined,
  ]);
  if (tree.campaign && campaign) tree.campaign.rec = { ...campaign, ...tree.campaign.rec };
  const audienceNames: Record<string, string> = {};
  for (const a of audiences ?? []) if (typeof a.id === "string") audienceNames[a.id] = String(a.name ?? a.id);
  let reach: Reach | undefined;
  if (reachParsed) {
    if (!reachParsed.ok) reach = { error: reachParsed.error.message };
    else if ("record" in reachParsed.payload) {
      const r = reachParsed.payload.record;
      reach = { lower: typeof r.users_lower_bound === "number" ? r.users_lower_bound : undefined, upper: typeof r.users_upper_bound === "number" ? r.users_upper_bound : undefined };
    }
  }
  const pm = prefs?.ads_payment_methods;
  const paysFrom = Array.isArray(pm) && pm.length ? pm.map((m) => describePaymentMethod(m)).join(", ") : pm && typeof pm === "object" ? describePaymentMethod(pm) : typeof pm === "string" ? pm : undefined;
  const budget = budgetOf(tree, flags);
  const live = mode !== "sandbox" && !planOnly;
  return {
    group, verb, argv: args, tree, budget, reach, audienceNames, social, paysFrom, balance, currency,
    accountTitle: acct?.title, accountId: acct?.id, mode,
    cap: live && budget ? adCapFrom() : undefined,
    timeoutSeconds: live && budget ? timeoutFrom() : undefined,
    planOnly,
  };
}

/** One line for whatever `ads_payment_methods` holds. The shape is undocumented, so lean on the usual names. */
function describePaymentMethod(m: unknown): string {
  if (!m || typeof m !== "object") return String(m);
  const r = m as Rec;
  const parts = [r.nickname, r.brand, r.card_brand, r.type, r.kind, r.last4 ? `••••${r.last4}` : r.card_last4 ? `••••${r.card_last4}` : undefined].filter((x) => typeof x === "string" && x) as string[];
  return parts.length ? parts.join(" ") : String(r.id ?? copy.adplan.paysFrom);
}

/** Available balance in one currency from `ledgers report balance_summary`. Undefined when it cannot be read. */
async function balanceFor(currency: string, env: NodeJS.ProcessEnv): Promise<Balance | undefined> {
  const { parsed } = await run(["ledgers", "report", "--report_type", "balance_summary", "--currency", currency], env);
  if (!parsed.ok || parsed.payload.kind !== "report") return undefined;
  const row = parsed.payload.rows.find((r) => r.line_category === "available");
  const available = row ? Number(row.amount) : parsed.payload.total;
  return available != null && Number.isFinite(available) ? { available, currency } : undefined;
}

/**
 * One call for two facts: the saved payout method behind an id, described in one line, and Whop's live
 * limit for the payout's speed. Either is undefined when the list lacks it or the scope is missing.
 */
async function methodsFor(id: string | undefined, currency: string, speed: string, env: NodeJS.ProcessEnv): Promise<{ destination?: string; limit?: WhopLimit } | undefined> {
  const { parsed } = await run(["payouts", "methods", "--include_limits", "--currency", currency], env);
  if (!parsed.ok || parsed.payload.kind !== "page") return undefined;
  const m = id ? parsed.payload.rows.find((r) => r.id === id) : undefined;
  return { destination: m && id ? describeMethod(m, id) : undefined, limit: limitFor(parsed.payload.extra?.limits, speed) };
}

/** Prints the right view for a payload. Returns the rows and list geometry when it was a list. */
function render(parsed: Parsed, group: string, argv: string[], theme: Theme, opts: ExecuteOptions): Pick<Outcome, "rows" | "list" | "teach" | "next"> {
  if (!parsed.ok) {
    print(errorView(parsed.error, theme));
    // The sandbox host answers an OAuth token with 401 or 404. Say which variable fixes it.
    if (opts.mode === "sandbox" && /^HTTP_40[134]$/.test(parsed.error.code) && !process.env.WV_SANDBOX_KEY) print(["", " " + copy.error.sandboxKey]);
    return {};
  }
  const verb = argv[1];
  const hints = hintsFor(group, verb);
  // `payouts methods` lists methods, not payouts. Any verb that is not the plain list names the rows.
  const noun = verb && verb !== "list" ? verb.replace(/[-_]/g, " ") : group;
  const p = parsed.payload;
  switch (p.kind) {
    case "page": {
      const list = listViewWithMeta({ group, argv, rows: p.rows, page: p.page, hints, noun, canCreate: p.rows.length || noun !== group ? undefined : canCreate(group), numbered: opts.numbered }, theme);
      print(list.lines);
      return { rows: p.rows, list, teach: list.teach, next: list.next };
    }
    case "record":
    case "status":
    case "other":
      print(detailView({ group, argv, record: p.record, hints }, theme));
      return { teach: teach(argv) };
    case "report":
      print(detailView({ group, argv, record: reportToRecord(p.rows, p.total), hints }, theme));
      return { teach: teach(argv) };
    case "summary":
      print(summaryView({ argv, total: p.total, groups: p.groups }, theme));
      return { teach: teach(argv) };
    case "series":
      print(seriesView({ argv, points: p.points, currency: p.currency }, theme));
      return { teach: teach(argv) };
  }
}

const canCreate = (group: string) => /^\s{2,}create\s{2,}/m.test(helpText([group]));

const reportToRecord = (rows: Rec[], total?: number): Rec => {
  const rec: Rec = {};
  for (const r of rows) rec[String(r.line_category ?? r.grouping ?? r.period)] = { amount: r.amount, currency: "usd" };
  if (total != null) rec.total = { amount: total, currency: "usd" };
  return rec;
};

interface Identity {
  title: string;
  id: string;
  profile?: string;
  method?: string;
}

let identityCache: Promise<Identity | null> | undefined;

/** `auth status`, once per process. Confirmations and the session banner both need it. */
function identity(env: NodeJS.ProcessEnv = process.env): Promise<Identity | null> {
  identityCache ??= run(["auth", "status"], env).then(({ parsed }) => {
    if (!parsed.ok || parsed.payload.kind !== "status") return null;
    const s = parsed.payload.record;
    const a = s.account as Rec | undefined;
    if (!a) return null;
    return { title: String(a.title ?? ""), id: String(a.id ?? ""), profile: s.profile ? String(s.profile) : undefined, method: s.method ? String(s.method) : undefined };
  });
  return identityCache;
}

async function home(theme: Theme, mode: Mode): Promise<Outcome> {
  const env = whopEnv(mode);
  const from = isoDay(daysAgo(7));
  const to = isoDay(daysAgo(1));
  const cmds = [
    ["auth", "status"],
    ["ledgers", "report", "--report_type", "balance_summary"],
    ["stats", "get", "net_revenue", "--from", from, "--to", to, "--interval", "day"],
  ];
  const spin = spinner(copy.spinner.home, theme);
  const [auth, balance, revenue] = await Promise.all(cmds.map((c) => run(c, env)));
  spin.stop();
  const api = parseHelp(helpText([])).api;
  print(homeView({ auth: auth.parsed, balance: balance.parsed, revenue: revenue.parsed, from, to, commands: cmds, api, mode }, theme));
  return { code: auth.code || balance.code || revenue.code };
}

/** `wv gtm`: the loop on one screen. Eleven reads in parallel, every one taught in the footer. */
async function gtm(theme: Theme, mode: Mode): Promise<Outcome> {
  const env = whopEnv(mode);
  const from = isoDay(daysAgo(7));
  const to = isoDay(daysAgo(1));
  const metrics = ["page_visits", "new_users", "gross_revenue", "ad_spend"];
  const cmds: string[][] = [
    ...metrics.map((m) => ["stats", "get", m, "--from", from, "--to", to, "--interval", "day"]),
    ["people", "list", "--last_seen_within_days", "7"],
    ["audiences", "list"],
    ["ad-campaigns", "list"],
    ["promo-codes", "list"],
    ["social-accounts", "list"],
    ["accounts", "preferences"],
  ];
  const spin = spinner(copy.spinner.gtm, theme);
  const [acct, ...results] = await Promise.all([identity(env), ...cmds.map((c) => run(c, env))]);
  spin.stop();
  const series: Record<string, Parsed> = {};
  metrics.forEach((m, i) => (series[m] = results[i].parsed));
  const [people, audiences, campaigns, promoCodes, social, preferences] = results.slice(metrics.length).map((r) => r.parsed);
  print(gtmView({ accountTitle: acct?.title, accountId: acct?.id, mode, from, to, series, people, audiences, campaigns, promoCodes, social, preferences, commands: cmds }, theme));
  return { code: results.some((r) => r.code) ? 1 : 0 };
}

/**
 * `wv doctor`: is this business set up to sell. `auth status` first, since `permissions check` needs the
 * account id; then nine reads in parallel; then deliveries for the first webhooks. Exit 1 when a blocking
 * check fails, so a script can gate on it.
 */
async function doctor(theme: Theme, mode: Mode): Promise<Outcome> {
  const env = whopEnv(mode);
  const spin = spinner(copy.spinner.doctor, theme);
  const authCmd = ["auth", "status"];
  const auth = await run(authCmd, env);
  const acct = auth.parsed.ok && auth.parsed.payload.kind === "status" && (auth.parsed.payload.record.account as Rec | undefined);
  const accountId = acct ? String(acct.id ?? "") : undefined;
  const accountTitle = acct ? String(acct.title ?? "") : undefined;
  const cmds: string[][] = [
    ["auth", "list"],
    ["verifications", "list"],
    ["payouts", "methods", "--include_limits"],
    ["people", "list", "--first", "100"],
    ["social-accounts", "list"],
    ["accounts", "preferences"],
    ["products", "list"],
    ["webhooks", "list"],
  ];
  const permCmd = accountId ? ["permissions", "check", "--resource_id", accountId, "--actions", DOCTOR_ACTIONS.join(",")] : undefined;
  spin.update(copy.spinner.doctorReads);
  const [[profiles, verifications, methods, people, social, preferences, products, webhooks], permissions] = await Promise.all([Promise.all(cmds.map((c) => run(c, env))), permCmd ? run(permCmd, env) : Promise.resolve(undefined)]);
  const hooks = webhooks.parsed.ok && webhooks.parsed.payload.kind === "page" ? webhooks.parsed.payload.rows.slice(0, 3) : [];
  const deliveryCmds = hooks.map((h) => ["webhooks", "deliveries", String(h.id), "--first", "20"]);
  if (deliveryCmds.length) spin.update(copy.spinner.doctorDeliveries);
  const deliveryResults = await Promise.all(deliveryCmds.map((c) => run(c, env)));
  spin.stop();
  const deliveries: Record<string, Parsed> = {};
  hooks.forEach((h, i) => (deliveries[String(h.id)] = deliveryResults[i].parsed));
  const input = {
    accountTitle, accountId, mode,
    auth: auth.parsed, profiles: profiles.parsed, permissions: permissions?.parsed, verifications: verifications.parsed, methods: methods.parsed,
    people: people.parsed, social: social.parsed, preferences: preferences.parsed, products: products.parsed, webhooks: webhooks.parsed, deliveries,
    commands: [authCmd, ...cmds.slice(0, 1), ...(permCmd ? [permCmd] : []), ...cmds.slice(1), ...deliveryCmds],
  };
  print(doctorView(input, theme));
  return { code: blocked(checks(input)) ? 1 : 0 };
}

main(process.argv.slice(2)).catch((e) => {
  process.stderr.write(`wv: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
