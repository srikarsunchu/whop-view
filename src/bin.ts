#!/usr/bin/env node
// wv: human view layer for the Whop CLI. Renders when a person is looking, execs `whop` otherwise.
import { realpathSync } from "node:fs";
import { makeTheme, type Theme } from "./tokens.ts";
import { cachedHelpText, helpText, modeFrom, schema, passthrough, run, sandboxKey, sandboxUrl, shouldPassthrough, whopEnv, type Mode } from "./runner.ts";
import { configPath, maskKey, saveSandboxKey } from "./config.ts";
import { sandboxMissingKeyView, sandboxSavedView, sandboxStatusView } from "./views/sandbox.ts";
import { ask } from "./primitives/prompt.ts";
import { resolveDates } from "./dates.ts";
import { assembleJson, needsAssembly } from "./jsonflags.ts";
import { webhookTestView } from "./views/webhook.ts";
import { exitCodeFor, licenseView, verdict } from "./views/license.ts";
import { followHeader, followIntervalMs, followStopped, logLines, logsView, newEntries, newest, pollArgv } from "./views/logs.ts";
import { hintsFor } from "./hints.ts";
import { isWrite, MONEY_GROUPS } from "./status.ts";
import { adPlan, adRefusedEnvelope, agentGated, confirmationEnvelope, moneyPlan, planEnvelope, refusedEnvelope, serialize, wvErrorEnvelope, type AgentEnvelope } from "./agent.ts";
import { teach } from "./argv.ts";
import { daysAgo, isoDay } from "./format.ts";
import { copy } from "./copy.ts";
import { listViewWithMeta, withAfter, type ListRender } from "./views/list.ts";
import { detailView } from "./views/detail.ts";
import { amountMatcher, confirmView, describeMethod, flagsToRecord, limitFor, moneyOf, refusedView, speedOf, type Balance, type ConfirmInput, type RefusedInput, type WhopLimit } from "./views/confirm.ts";
import { money } from "./format.ts";
import { adPlanView, adRefusedView, budgetOf, commitment, isAdPlan, jsonFlags, reachArgv, treeFromArgv, type AdPlanInput, type AdTree, type Reach } from "./views/adplan.ts";
import { errorView } from "./views/error.ts";
import { helpView, parseHelp } from "./views/help.ts";
import { manifest, manifestIndex, type VerbSchema } from "./views/manifest.ts";
import { homeView } from "./views/home.ts";
import { gtmData, gtmView, type GtmInput } from "./views/gtm.ts";
import { blocked, checks, doctorData, doctorView, DOCTOR_ACTIONS, type DoctorInput } from "./views/doctor.ts";
import { seriesView } from "./views/series.ts";
import { summaryView } from "./views/summary.ts";
import { prompt } from "./primitives/prompt.ts";
import { spinner } from "./primitives/spinner.ts";
import { session } from "./tui/session.ts";
import type { Parsed, Rec } from "./envelope.ts";

const print = (lines: string[]) => process.stdout.write(lines.join("\n") + "\n");

/** Words that are wv's, not whop's. */
const OURS = new Set(["home", "help", "gtm", "doctor", "sandbox", "agent"]);

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
export function ownFlags(argvIn: string[]): { argv: string[]; width?: number; sandbox: boolean; plan: boolean; follow: boolean } {
  let width: number | undefined;
  let sandbox = false;
  let plan = false;
  let follow = false;
  const argv: string[] = [];
  for (let i = 0; i < argvIn.length; i++) {
    const a = argvIn[i];
    if (a === "--width") width = Number(argvIn[++i]);
    else if (a.startsWith("--width=")) width = Number(a.slice(8));
    else if (a === "--sandbox") sandbox = true;
    else if (a === "--plan") plan = true;
    else if (a === "--follow" || a === "-f") follow = true;
    else argv.push(a);
  }
  return { argv, width: width !== undefined && Number.isFinite(width) && width > 0 ? Math.floor(width) : undefined, sandbox, plan, follow };
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
  const own = ownFlags(argvIn);
  const { width, sandbox, plan, follow } = own;
  const theme = makeTheme({ width });
  // Date presets are wv's flags too: resolve them before a pipe execs `whop`, and refuse a range Whop would.
  const dates = resolveDates(own.argv);
  const mode = modeFrom(sandbox);
  const env = whopEnv(mode);
  // No terminal: an agent or a script. Errors and the gate come back as JSON on stdout; everything else execs `whop`.
  if (!process.stdout.isTTY) return agentMain(own.argv, dates, mode, env, plan);
  const json = assembleFor(dates.argv);
  const argv = json.argv;

  // `wv doctor --format json` in a terminal is the agent face on purpose. `--format` would otherwise exec `whop doctor`, which is not a command.
  if (DATA_SCREENS.has(argv[0]) && wantsJson(argv)) process.exit(await screenJson(argv[0], mode, env));
  // `--plan` never writes, so it is safe without a terminal and must never fall through to a real `whop` create.
  // `memberships check <key>` is wv's verb over `memberships get <key>`; a pipe gets the get.
  if (shouldPassthrough(argv) && !plan) passthrough(argv0IsCheck(argv) ? ["memberships", "get", ...argv.slice(2)] : argv, env);

  // Sandbox mode with no key: say so once, before anything runs, and offer to keep a key in wv's config.
  if (mode === "sandbox" && argv[0] !== "sandbox" && !sandboxKey().key) await offerSandboxKey(theme);

  if (argv.length === 0) {
    const acct = await identity(env);
    process.exit(await session({ theme, execute: (a, t) => execute(a, t, { numbered: true, mode }), account: acct, mode }));
  }
  process.exit((await execute(argv, theme, { mode, plan, follow })).code);
}

const emit = (e: AgentEnvelope, code: number): never => {
  process.stdout.write(serialize(e));
  process.exit(code);
};

/**
 * The pipe. A wv refusal (bad preset, bad `@file`) is a JSON envelope, exit 2. A write without `--yes` is
 * gated exactly as in a terminal, but the card is data and the prompt is exit 2 with `rerun`; `--plan` is
 * the data alone, exit 0. `--yes`, `WV_RAW`, and every read exec `whop` with the argv it expects.
 */
async function agentMain(argvIn: string[], dates: ReturnType<typeof resolveDates>, mode: Mode, env: NodeJS.ProcessEnv, plan: boolean): Promise<never> {
  if (dates.error) emit(wvErrorEnvelope(argvIn, mode, dates.error), 2);
  const json = assembleFor(dates.argv);
  if (json.error) emit(wvErrorEnvelope(argvIn, mode, json.error), 2);
  const argv = json.argv;
  // The manifest is Markdown for a program; it prints the same in a pipe and a terminal.
  if (argv[0] === "agent") {
    const lines = await agentManifest(argv[1]);
    if (!lines) emit(wvErrorEnvelope(argv, mode, { code: "COMMAND_NOT_FOUND", message: copy.manifest.unknownGroup(argv[1] ?? "") }), 2);
    print(lines!);
    process.exit(0);
  }
  // Two screens are data as well as pictures. The rest draw and need a terminal.
  if (DATA_SCREENS.has(argv[0])) process.exit(await screenJson(argv[0], mode, env));
  if (OURS.has(argv[0])) emit(wvErrorEnvelope(argv, mode, { code: "NEEDS_TERMINAL", message: copy.agent.needsTerminal(argv[0]) }), 2);
  // `whop` rejects `--yes` as an unknown flag. It is wv's, and it never reaches the child.
  const yes = argv.includes("--yes");
  const args = argv.filter((a) => a !== "--yes");
  if (!process.env.WV_RAW && agentGated(args) && (!yes || plan)) {
    const [group, verb] = args;
    const live = mode !== "sandbox";
    if (isAdPlan(group, verb)) {
      const input = await adPlanFor(group, verb, args, env, mode, plan);
      if (plan) emit(planEnvelope(args, mode, adPlan(input)), 0);
      if (live && input.budget && input.cap != null && commitment(input.budget).total > input.cap) emit(adRefusedEnvelope(input), 2);
      emit(confirmationEnvelope(args, mode, adPlan(input)), 2);
    }
    const gate = await moneyGateFor(group, verb, args, env, mode);
    if (plan) emit(planEnvelope(args, mode, moneyPlan(gate.input)), 0);
    if (gate.refusal) emit(refusedEnvelope({ ...gate.input, reason: gate.refusal }), 2);
    emit(confirmationEnvelope(args, mode, moneyPlan(gate.input)), 2);
  }
  passthrough(argv0IsCheck(args) ? ["memberships", "get", ...args.slice(2)] : args, env);
}

/**
 * `wv agent [group]`. The root help names the groups; a group's help names its verbs; `--schema` (cached by
 * the runner) names each verb's flags. Null when the group is not one `whop --help` lists.
 */
async function agentManifest(group?: string): Promise<string[] | null> {
  const root = parseHelp(cachedHelpText([]));
  const version = /^(whop@\S+)/.exec(cachedHelpText([]))?.[1];
  if (!group) return manifestIndex(root, version);
  const entry = root.groups.flatMap((g) => g.entries).find((e) => e.name === group);
  if (!entry) return null;
  const verbs: VerbSchema[] = parseHelp(cachedHelpText([group]))
    .groups.flatMap((g) => g.entries)
    .map((e) => ({ verb: e.name, desc: e.desc, schema: schema(group, e.name) }));
  return manifest({ group, desc: entry.desc, verbs, version, api: root.api });
}

/** wv screens that have a JSON face: `--format json`, or any pipe. */
const DATA_SCREENS = new Set(["doctor", "gtm"]);
const wantsJson = (argv: string[]) => argv.some((a, i) => a === "--format=json" || (a === "--format" && argv[i + 1] === "json"));

/** Prints a screen's data as JSON and returns the exit code the screen would have used. */
async function screenJson(screen: string, mode: Mode, env: NodeJS.ProcessEnv): Promise<number> {
  const theme = makeTheme({});
  if (screen === "doctor") {
    const input = await gatherDoctor(theme, env, mode);
    const data = doctorData(input);
    process.stdout.write(JSON.stringify({ ...data, meta: { command: "doctor", wrapper: "wv", mode } }, null, 2) + "\n");
    return data.ok ? 0 : 1;
  }
  const { input, failed } = await gatherGtm(theme, env, mode);
  process.stdout.write(JSON.stringify({ ...gtmData(input), meta: { command: "gtm", wrapper: "wv", mode } }, null, 2) + "\n");
  return failed ? 1 : 0;
}

export interface ExecuteOptions {
  /** Inside a session: lists get a row-number gutter for the `N opens a row` shortcut. */
  numbered?: boolean;
  /** Which host the child `whop` talks to. Default production. */
  mode?: Mode;
  /** `--plan`: for an ad write, print the plan card and run nothing. */
  plan?: boolean;
  /** `--follow`: for `apps logs`, keep polling and print new lines until Ctrl-C. */
  follow?: boolean;
}

/** Runs one wv command end to end and prints it. Shared by the one-shot CLI and the session. */
export async function execute(argvIn: string[], theme: Theme, opts: ExecuteOptions = {}): Promise<Outcome> {
  const dates = resolveDates(argvIn);
  if (dates.error) {
    print(errorView({ code: dates.error.code, message: dates.error.message + (dates.error.hint ? "\n" + dates.error.hint : "") }, theme));
    return { code: 2 };
  }
  const json = assembleFor(dates.argv);
  if (json.error) {
    print(errorView({ code: json.error.code, message: json.error.message }, theme));
    return { code: 2 };
  }
  const argv = json.argv;
  const [group, verb] = argv;
  if (!group || group === "help") {
    const target = group === "help" ? argv[1] : undefined;
    print(helpView(parseHelp(helpText(target ? [target] : [])), theme, target));
    return { code: 0 };
  }
  const mode = opts.mode ?? "production";
  const env = whopEnv(mode);
  if (group === "agent") {
    const lines = await agentManifest(verb);
    if (!lines) {
      print(errorView({ code: "COMMAND_NOT_FOUND", message: copy.manifest.unknownGroup(verb ?? "") }, theme));
      return { code: 2 };
    }
    print(lines);
    return { code: 0 };
  }
  if (group === "home") return home(theme, mode);
  if (group === "gtm") return gtm(theme, mode);
  if (group === "doctor") return doctor(theme, mode);
  if (group === "sandbox") {
    if (verb && verb !== "status") {
      print([" " + copy.sandbox.unknownVerb(verb)]);
      return { code: 2 };
    }
    return sandboxStatus(theme);
  }
  if (!verb || verb.startsWith("--")) {
    print(helpView(parseHelp(helpText([group])), theme, group));
    return { code: 0 };
  }

  if (group === "apps" && verb === "logs" && opts.follow) return followLogs(argv, theme, env);

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
    const spin = spinner(m ? copy.spinner.money : copy.spinner.identity, theme);
    const gate = await moneyGateFor(group, verb, args, env, mode).finally(() => spin.stop());
    const { input, live } = gate;
    if (gate.refusal) {
      print(refusedView({ ...input, reason: gate.refusal }, theme));
      return { code: 2 };
    }
    print(confirmView(input, theme));
    // Money: type the amount back. Everything else: y.
    const shown = m ? money(m.amount, m.currency).replace(/^[^\d]+/, "") : "";
    const accept = live && m ? { test: amountMatcher(m.amount), hint: copy.confirm.amountNo(shown) } : undefined;
    const timeoutSeconds = input.timeoutSeconds;
    const answer = await prompt(live ? copy.confirm.typeAmount(shown) : copy.confirm.question, theme, { timeoutMs: timeoutSeconds ? timeoutSeconds * 1000 : undefined, accept });
    if (answer !== "yes") {
      print([" " + (answer === "timeout" && timeoutSeconds ? copy.confirm.expired(timeoutSeconds) : copy.confirm.aborted)]);
      return { code: 130 };
    }
    print([""]);
  }

  if (group === "webhooks" && verb === "test") return webhookTest(args, theme, env);
  if (argv0IsCheck(args)) return licenseCheck(args, theme, env);

  const spin = spinner(copy.spinner.running(args), theme);
  const { parsed, code } = await run(args, env);
  spin.stop();
  return { code, group, ...render(parsed, group, args, theme, opts) };
}

const argv0IsCheck = (argv: string[]) => argv[0] === "memberships" && argv[1] === "check";

/**
 * JSON flags for humans, only when the argv uses a wv spelling (dotted path, repeated flag, `@file`). The
 * command's schema, cached by the runner, says which flags are arrays, so a lone value gets wrapped.
 * A plain agent command is never touched, and never costs a `--schema` call.
 */
function assembleFor(argv: string[]): ReturnType<typeof assembleJson> {
  if (!needsAssembly(argv)) return { argv, assembled: [] };
  const [group, verb] = argv;
  const raw = group && verb && !verb.startsWith("--") ? schema(group, verb) : null;
  const options = raw && typeof raw === "object" && "options" in raw && (raw as { options?: { properties?: unknown } }).options?.properties;
  return assembleJson(argv, options && typeof options === "object" ? (options as Parameters<typeof assembleJson>[1]) : undefined);
}

/** `memberships check <license_key>`: `memberships get` with the key, and a verdict. Exit 0 valid, 1 invalid, 2 unknown. */
async function licenseCheck(args: string[], theme: Theme, env: NodeJS.ProcessEnv): Promise<Outcome> {
  const key = args[2];
  if (!key || key.startsWith("--")) {
    print(errorView({ code: "VALIDATION_ERROR", message: copy.license.needsKey }, theme));
    return { code: 2 };
  }
  const getArgv = ["memberships", "get", ...args.slice(2)];
  const spin = spinner(copy.spinner.running(getArgv), theme);
  const { parsed } = await run(getArgv, env);
  spin.stop();
  print(licenseView({ key, membership: parsed, argv: getArgv }, theme));
  return { code: exitCodeFor(verdict(parsed)), group: "memberships", teach: teach(getArgv) };
}

/** `webhooks test <id> --event <e>`, then the newest delivery, so the round trip is one screen. */
async function webhookTest(args: string[], theme: Theme, env: NodeJS.ProcessEnv): Promise<Outcome> {
  const spin = spinner(copy.spinner.running(args), theme);
  const { parsed, code } = await run(args, env);
  if (!parsed.ok || !("record" in parsed.payload)) {
    spin.stop();
    return { code, group: "webhooks", ...render(parsed, "webhooks", args, theme, {}) };
  }
  const deliveryArgv = ["webhooks", "deliveries", args[2], "--first", "1"];
  spin.update(copy.spinner.running(deliveryArgv));
  const delivery = await run(deliveryArgv, env);
  spin.stop();
  print(webhookTestView({ argv: args, result: parsed.payload.record, delivery: delivery.parsed, deliveryArgv }, theme));
  return { code: parsed.payload.record.success === true ? 0 : 1, group: "webhooks", teach: teach(args) };
}

interface MoneyGate {
  input: ConfirmInput;
  /** True when a real amount goes to production: the cap, the limit, the balance, and the typed amount apply. */
  live: boolean;
  /** Set when wv refuses before any `whop` call. Cheapest reason first; Whop's own limit beats wv's cap, since it is the real one. */
  refusal?: RefusedInput["reason"];
}

/**
 * Everything the money gate shows and decides, shared by the terminal card and the agent envelope: identity,
 * the balance in the payout's currency, the saved method behind `--payout_method_id`, and Whop's live limit.
 */
async function moneyGateFor(group: string, verb: string, args: string[], env: NodeJS.ProcessEnv, mode: Mode): Promise<MoneyGate> {
  const m = MONEY_GROUPS.has(group) ? moneyOf(args) : null;
  const methodId = flagsToRecord(args).payout_method_id;
  const [acct, balance, methods] = await Promise.all([
    identity(env),
    m ? balanceFor(m.currency, env) : undefined,
    m || typeof methodId === "string" ? methodsFor(typeof methodId === "string" ? methodId : undefined, m?.currency ?? "usd", speedOf(args), env) : undefined,
  ]);
  const live = !!m && mode !== "sandbox";
  const cap = live ? capFrom() : undefined;
  const limit = live ? methods?.limit : undefined;
  const timeoutSeconds = live ? timeoutFrom() : undefined;
  const input: ConfirmInput = { group, verb, argv: args, hints: hintsFor(group, verb), accountTitle: acct?.title, accountId: acct?.id, mode, destination: methods?.destination, balance, cap, limit, timeoutSeconds };
  let refusal: MoneyGate["refusal"];
  if (live && m) {
    if (limit && m.amount > limit.max) refusal = "whop";
    else if (cap != null && m.amount > cap) refusal = "cap";
    else if (balance && m.amount > balance.available) refusal = "balance";
  }
  return { input, live, refusal };
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
    // The sandbox host answers a wrong or missing key with 401. That is not "not signed in"; it is the sandbox key.
    if (opts.mode === "sandbox" && /^HTTP_40[14]$/.test(parsed.error.code)) {
      const { key } = sandboxKey();
      print(errorView({ ...parsed.error, code: "SANDBOX_AUTH", message: key ? copy.sandbox.keyRejected(maskKey(key)) : copy.sandbox.rejectsOauth }, theme));
      return {};
    }
    print(errorView(parsed.error, theme));
    return {};
  }
  const verb = argv[1];
  const hints = hintsFor(group, verb);
  // `payouts methods` lists methods, not payouts. Any verb that is not the plain list names the rows.
  const noun = verb && verb !== "list" ? verb.replace(/[-_]/g, " ") : group;
  const p = parsed.payload;
  switch (p.kind) {
    case "page": {
      if (group === "apps" && verb === "logs") {
        print(logsView({ argv, rows: p.rows, page: p.page }, theme));
        return { rows: p.rows, teach: teach(argv), next: p.page.has_next_page && p.page.end_cursor ? withAfter(argv, p.page.end_cursor) : undefined };
      }
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
  const { input, failed } = await gatherGtm(theme, whopEnv(mode), mode);
  print(gtmView(input, theme));
  return { code: failed ? 1 : 0 };
}

async function gatherGtm(theme: Theme, env: NodeJS.ProcessEnv, mode: Mode): Promise<{ input: GtmInput; failed: boolean }> {
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
  return { input: { accountTitle: acct?.title, accountId: acct?.id, mode, from, to, series, people, audiences, campaigns, promoCodes, social, preferences, commands: cmds }, failed: results.some((r) => r.code !== 0) };
}

/**
 * `wv doctor`: is this business set up to sell. `auth status` first, since `permissions check` needs the
 * account id; then nine reads in parallel; then deliveries for the first webhooks. Exit 1 when a blocking
 * check fails, so a script can gate on it.
 */
async function doctor(theme: Theme, mode: Mode): Promise<Outcome> {
  const input = await gatherDoctor(theme, whopEnv(mode), mode);
  print(doctorView(input, theme));
  return { code: blocked(checks(input)) ? 1 : 0 };
}

async function gatherDoctor(theme: Theme, env: NodeJS.ProcessEnv, mode: Mode): Promise<DoctorInput> {
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
  return {
    accountTitle, accountId, mode,
    auth: auth.parsed, profiles: profiles.parsed, permissions: permissions?.parsed, verifications: verifications.parsed, methods: methods.parsed,
    people: people.parsed, social: social.parsed, preferences: preferences.parsed, products: products.parsed, webhooks: webhooks.parsed, deliveries,
    commands: [authCmd, ...cmds.slice(0, 1), ...(permCmd ? [permCmd] : []), ...cmds.slice(1), ...deliveryCmds],
  };
}

/**
 * `wv apps logs <id> --follow`: the newest page first, then `--created_after` the newest line seen every
 * few seconds, printing what is new, until Ctrl-C. The API answers newest first with no entry id, so
 * `newEntries` keys on request id, time, and message. An API error stops the loop; it is printed as is.
 */
async function followLogs(argv: string[], theme: Theme, env: NodeJS.ProcessEnv): Promise<Outcome> {
  const interval = followIntervalMs();
  print(followHeader(argv, Math.round(interval / 1000), theme));
  const seen = new Set<string>();
  let after: string | undefined;
  let count = 0;
  let stopped = false;
  let wake: (() => void) | undefined;
  const stop = () => {
    stopped = true;
    wake?.();
  };
  process.on("SIGINT", stop);
  try {
    let first = true;
    while (!stopped) {
      const { parsed } = await run(pollArgv(argv, after), env);
      // Ctrl-C reaches the child `whop` too, so a poll in flight comes back empty. That is the stop, not an error.
      if (stopped) break;
      if (!parsed.ok) {
        print(errorView(parsed.error, theme));
        return { code: 1 };
      }
      const rows = parsed.payload.kind === "page" ? parsed.payload.rows : [];
      // The first page is history: show the last twenty, then only what arrives.
      const fresh = newEntries(seen, rows, first ? 20 : Infinity);
      for (const r of fresh) print(logLines(r, theme));
      count += fresh.length;
      after = newest(rows) ?? after;
      first = false;
      // The timer stays referenced: it is the only handle keeping the process alive between polls.
      if (!stopped) await new Promise<void>((resolve) => {
        wake = resolve;
        setTimeout(resolve, interval);
      });
    }
  } finally {
    process.off("SIGINT", stop);
  }
  print(followStopped(count, theme));
  return { code: 0 };
}

/**
 * The screen for sandbox mode without a key, then one question. A pasted key that looks like one is
 * saved owner-only to wv's config; anything else continues without a key and the 401 explains itself.
 */
async function offerSandboxKey(theme: Theme): Promise<void> {
  const file = configPath();
  print(sandboxMissingKeyView(file, theme));
  print([""]);
  const answer = await ask(copy.sandbox.askKey, copy.sandbox.askHint, theme);
  if (!answer) {
    print([" " + copy.sandbox.skipped, ""]);
    return;
  }
  if (!/^whop_[A-Za-z0-9_-]{8,}$/.test(answer)) {
    print([" " + copy.sandbox.notAKey, ""]);
    return;
  }
  saveSandboxKey(answer);
  print([...sandboxSavedView(file, theme), ""]);
}

/** `wv sandbox status`: ping the sandbox host with whatever key wv has and say what was used. Always the sandbox, whatever the mode. */
async function sandboxStatus(theme: Theme): Promise<Outcome> {
  const env = whopEnv("sandbox");
  const { key, source: keySource } = sandboxKey();
  const { url, source: urlSource } = sandboxUrl();
  const spin = spinner(copy.spinner.sandbox, theme);
  const { parsed } = await run(["accounts", "get", "me"], env);
  spin.stop();
  print(sandboxStatusView({ url, urlSource, key, keySource, configPath: configPath(), account: parsed }, theme));
  return { code: parsed.ok ? 0 : 1 };
}

// Only when this file is the program. Tests import `capFrom` and friends from here, and under `node --test`
// an unguarded main would exec `whop` with no arguments and exit before a single test ran.
const isMain = (() => {
  try {
    // `wv` is a symlink to dist/bin.js: argv[1] keeps the link, import.meta.filename is the target.
    return realpathSync(process.argv[1] ?? "") === import.meta.filename;
  } catch {
    return false;
  }
})();
if (isMain) {
  main(process.argv.slice(2)).catch((e) => {
    process.stderr.write(`wv: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
