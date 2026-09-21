#!/usr/bin/env node
// wv: human view layer for the Whop CLI. Renders when a person is looking, execs `whop` otherwise.
import { realpathSync } from "node:fs";
import { makeTheme, paint, type Theme } from "./tokens.ts";
import { cachedHelpText, cachedLlmsFull, helpText, modeFrom, schema, passthrough, passthroughPiped, run, sandboxKey, sandboxUrl, shouldPassthrough, whopEnv, type Mode } from "./runner.ts";
import { approveSecret, configPath, maskKey, saveSandboxKey } from "./config.ts";
import { approveTtlFrom, checkApproval, mintApproval, splitApprove } from "./approve.ts";
import { sandboxMissingKeyView, sandboxSavedView, sandboxStatusView } from "./views/sandbox.ts";
import { ask } from "./primitives/prompt.ts";
import { resolveDates } from "./dates.ts";
import { assembleJson, needsAssembly } from "./jsonflags.ts";
import { webhookTestView } from "./views/webhook.ts";
import { exitCodeFor, licenseView, verdict } from "./views/license.ts";
import { followHeader, followIntervalMs, followStopped, logLines, logsView, newEntries, newest, pollArgv } from "./views/logs.ts";
import { hintsFor } from "./hints.ts";
import { isWrite, loadWhopWrites, MONEY_GROUPS } from "./status.ts";
import { adPlan, adRefusedEnvelope, agentExitCode, agentGated, approvalEnvelope, confirmationEnvelope, moneyPlan, planEnvelope, refusedEnvelope, serialize, withIdempotencyKey, wvErrorEnvelope, type AgentEnvelope } from "./agent.ts";
import { teach } from "./argv.ts";
import { daysAgo, isoDay } from "./format.ts";
import { copy } from "./copy.ts";
import { listViewWithMeta, withAfter, type ListRender } from "./views/list.ts";
import { detailView } from "./views/detail.ts";
import { amountMatcher, changesFor, confirmView, currentSummary, describeMethod, flagsToRecord, limitFor, moneyOf, refusedView, speedOf, type Balance, type ConfirmInput, type RefusedInput, type WhopLimit } from "./views/confirm.ts";
import { money } from "./format.ts";
import { adPlanView, adRefusedView, budgetOf, commitment, isAdPlan, jsonFlags, reachArgv, treeFromArgv, type AdPlanInput, type AdTree, type Reach } from "./views/adplan.ts";
import { errorView } from "./views/error.ts";
import { helpView, parseHelp } from "./views/help.ts";
import { manifest, manifestData, manifestIndex, manifestIndexData, type VerbSchema, type VerbsByGroup } from "./views/manifest.ts";
import { adGroupFor, buildLaunch, parseLaunchArgs, type LaunchReads } from "./views/launch.ts";
import { buildWinback, parseWinbackArgs, winbackGroup, type WinbackReads } from "./views/winback.ts";
import { rankData, rankView, type RankInput } from "./views/rank.ts";
import { balanceOf, buildClose, moneyData, moneyView, parseCloseArgs, type MoneyInput } from "./views/money.ts";
import { buildDispute, buildRefund, classifyKey, disputesFor, lookupData, lookupView, parseDisputeArgs, parseRefundArgs, userFrom, type LookupInput } from "./views/support.ts";
import { buildHook, devData, devView, parseHookArgs, WEBHOOK_ACTION, type DevInput } from "./views/dev.ts";
import { buildPrice, buildPublish, parsePriceArgs, parsePublishArgs, storeData, storeView, type StoreInput } from "./views/store.ts";
import { REPORT_METRICS, reportData, reportMarkdown, reportView, type ReportInput } from "./views/report.ts";
import { setupData, setupView } from "./views/setup.ts";
import { recipeData, recipeDoneView, recipeView, substitute, type RecipePlan } from "./views/recipe.ts";
import { randomUUID } from "node:crypto";
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
const OURS = new Set(["home", "help", "gtm", "doctor", "sandbox", "agent", "money", "support", "dev", "store", "report", "setup"]);

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
export function ownFlags(argvIn: string[]): { argv: string[]; width?: number; sandbox: boolean; plan: boolean; follow: boolean; all: boolean; md: boolean } {
  let width: number | undefined;
  let sandbox = false;
  let plan = false;
  let follow = false;
  let all = false;
  let md = false;
  const argv: string[] = [];
  for (let i = 0; i < argvIn.length; i++) {
    const a = argvIn[i];
    if (a === "--width") width = Number(argvIn[++i]);
    else if (a.startsWith("--width=")) width = Number(a.slice(8));
    else if (a === "--sandbox") sandbox = true;
    else if (a === "--plan") plan = true;
    else if (a === "--follow" || a === "-f") follow = true;
    else if (a === "--all") all = true;
    else if (a === "--md") md = true;
    else argv.push(a);
  }
  return { argv, width: width !== undefined && Number.isFinite(width) && width > 0 ? Math.floor(width) : undefined, sandbox, plan, follow, all, md };
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
  const { width, sandbox, plan, follow, all, md } = own;
  const theme = makeTheme({ width });
  // Date presets are wv's flags too: resolve them before a pipe execs `whop`, and refuse a range Whop would.
  const dates = resolveDates(own.argv);
  const mode = modeFrom(sandbox);
  const env = whopEnv(mode);
  // whop's own write list, so the gate knows a verb the hand list has never heard of. Cached a day; empty is fine.
  if (own.argv.length >= 2 && !own.argv[1].startsWith("--")) loadWhopWrites(cachedLlmsFull());
  // No terminal: an agent or a script. Errors and the gate come back as JSON on stdout; everything else execs `whop`.
  if (!process.stdout.isTTY) return agentMain(own.argv, dates, mode, env, plan, all, md);
  const json = assembleFor(dates.argv);
  const argv = json.argv;

  // `wv doctor --format json` in a terminal is the agent face on purpose. `--format` would otherwise exec `whop doctor`, which is not a command.
  if (argv[0] === "report" && (md || wantsJson(argv))) process.exit(await reportRun(theme, env, mode, md ? "md" : "json"));
  if (DATA_SCREENS.has(argv[0]) && wantsJson(argv)) process.exit(await screenJson(argv[0], mode, env, argv.filter((a, i) => !(a === "--format" || a.startsWith("--format=") || argv[i - 1] === "--format"))));
  if (argv[0] === "agent" && wantsJson(argv)) process.exit((await execute(argv, theme, { mode })).code);
  if (argv[0] === "gtm" && argv[1] === "rank" && wantsJson(argv)) process.exit(await rankJson(argv, mode, env));
  if (argv[0] === "support" && argv[1] === "lookup" && wantsJson(argv)) process.exit(await lookupJson(argv, mode, env));
  // `--plan` never writes, so it is safe without a terminal and must never fall through to a real `whop` create.
  // `memberships check <key>` is wv's verb over `memberships get <key>`; a pipe gets the get.
  if (shouldPassthrough(argv) && !plan) passthrough(argv0IsCheck(argv) ? ["memberships", "get", ...argv.slice(2)] : argv, env);

  // Sandbox mode with no key: say so once, before anything runs, and offer to keep a key in wv's config.
  if (mode === "sandbox" && argv[0] !== "sandbox" && !sandboxKey().key) await offerSandboxKey(theme);

  if (argv.length === 0) {
    const acct = await identity(env);
    process.exit(await session({ theme, execute: (a, t) => execute(a, t, { numbered: true, mode }), account: acct, mode }));
  }
  process.exit((await execute(argv, theme, { mode, plan, follow, all })).code);
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
async function agentMain(argvIn: string[], dates: ReturnType<typeof resolveDates>, mode: Mode, env: NodeJS.ProcessEnv, plan: boolean, all = false, md = false): Promise<never> {
  if (dates.error) emit(wvErrorEnvelope(argvIn, mode, dates.error), 2);
  const json = assembleFor(dates.argv);
  if (json.error) emit(wvErrorEnvelope(argvIn, mode, json.error), 2);
  const argv = json.argv;
  // The manifest is Markdown for a program; it prints the same in a pipe and a terminal.
  if (argv[0] === "agent") {
    const lines = await agentManifest(argv[1], wantsJson(argv));
    if (!lines) emit(wvErrorEnvelope(argv, mode, { code: "COMMAND_NOT_FOUND", message: copy.manifest.unknownGroup(argv[1] ?? "") }), 2);
    print(lines!);
    process.exit(0);
  }
  if ((argv[0] === "gtm" && (argv[1] === "launch" || argv[1] === "winback")) || (argv[0] === "money" && argv[1] === "close") || (argv[0] === "support" && (argv[1] === "refund" || argv[1] === "dispute")) || (argv[0] === "dev" && argv[1] === "hook") || (argv[0] === "store" && (argv[1] === "price" || argv[1] === "publish"))) return recipePiped(argv, mode, env, plan);
  if (argv[0] === "support" && argv[1] === "lookup") process.exit(await lookupJson(argv, mode, env));
  if (argv[0] === "gtm" && argv[1] === "rank") process.exit(await rankJson(argv, mode, env));
  if (argv[0] === "report") process.exit(await reportRun(makeTheme({}), env, mode, md ? "md" : "json"));
  // Two screens are data as well as pictures. The rest draw and need a terminal.
  if (DATA_SCREENS.has(argv[0])) process.exit(await screenJson(argv[0], mode, env, argv));
  if (OURS.has(argv[0])) emit(wvErrorEnvelope(argv, mode, { code: "NEEDS_TERMINAL", message: copy.agent.needsTerminal(argv[0]) }), 2);
  // `whop` rejects `--yes` and `--approve` as unknown flags. They are wv's, and they never reach the child.
  const { argv: unapproved, token } = splitApprove(argv);
  const args = unapproved.filter((a) => a !== "--yes");
  // A rerun: the token must match this exact argv and mode, and be fresh. Then it is consent.
  let yes = unapproved.includes("--yes");
  if (token !== undefined && !plan) {
    const verdict = checkApproval(token, args, mode, approveSecret());
    if (verdict !== "ok") emit(approvalEnvelope(args, mode, verdict), 2);
    yes = true;
  }
  if (!process.env.WV_RAW && agentGated(args) && (!yes || plan)) {
    const [group, verb] = args;
    // The plan step mints the idempotency key, so the approved rerun cannot write twice.
    const planned = withIdempotencyKey(args, schema(group, verb));
    const live = mode !== "sandbox";
    // The approval signs the planned argv: the rerun must carry it unchanged, within the TTL.
    const ttlSeconds = approveTtlFrom();
    const approval = { token: mintApproval(planned, mode, approveSecret(), Math.floor(Date.now() / 1000) + ttlSeconds), ttlSeconds };
    if (isAdPlan(group, verb)) {
      const input = await adPlanFor(group, verb, planned, env, mode, plan);
      if (plan) emit(planEnvelope(planned, mode, adPlan(input)), 0);
      if (live && input.budget && input.cap != null && commitment(input.budget).total > input.cap) emit(adRefusedEnvelope(input), 2);
      emit(confirmationEnvelope(planned, mode, adPlan(input), approval), 2);
    }
    const gate = await moneyGateFor(group, verb, planned, env, mode);
    if (plan) emit(planEnvelope(planned, mode, moneyPlan(gate.input)), 0);
    if (gate.refusal) emit(refusedEnvelope({ ...gate.input, reason: gate.refusal }), 2);
    emit(confirmationEnvelope(planned, mode, moneyPlan(gate.input), approval), 2);
  }
  // `--all`: follow the cursor and stream every row, one JSON object per line, or one array with `--format json`.
  if (all && argv.length >= 2) process.exit(await allPagesPiped(args, env));
  // Bytes go through untouched; only the exit status is mapped, from the code in the bytes.
  return passthroughPiped(argv0IsCheck(args) ? ["memberships", "get", ...args.slice(2)] : args, env, agentExitCode);
}

/**
 * `wv agent [group]`. The root help names the groups; a group's help names its verbs; `--schema` (cached by
 * the runner) names each verb's flags. Null when the group is not one `whop --help` lists.
 */
async function agentManifest(group?: string, json = false): Promise<string[] | null> {
  loadWhopWrites(cachedLlmsFull());
  const root = parseHelp(cachedHelpText([]));
  const version = /^(whop@\S+)/.exec(cachedHelpText([]))?.[1];
  const asJson = (data: Rec) => JSON.stringify(data, null, 2).split("\n");
  if (!group || group.startsWith("--")) {
    // Every group's verbs, from the cached help: ~40 `whop <group> --help` calls the first day, none after.
    const verbs: VerbsByGroup = {};
    for (const e of root.groups.flatMap((g) => g.entries)) verbs[e.name] = parseHelp(cachedHelpText([e.name])).groups.flatMap((g) => g.entries);
    return json ? asJson(manifestIndexData(root, version, verbs)) : manifestIndex(root, version, verbs);
  }
  const entry = root.groups.flatMap((g) => g.entries).find((e) => e.name === group);
  if (!entry) return null;
  const verbs: VerbSchema[] = parseHelp(cachedHelpText([group]))
    .groups.flatMap((g) => g.entries)
    .map((e) => ({ verb: e.name, desc: e.desc, schema: schema(group, e.name) }));
  const input = { group, desc: entry.desc, verbs, version, api: root.api };
  return json ? asJson(manifestData(input)) : manifest(input);
}

/** `--idempotency-key <base>` on a recipe argv, minted here when absent, so every step's key survives into the rerun. */
function recipeArgvWithKey(argv: string[]): string[] {
  return argv.some((a) => a === "--idempotency-key" || a.startsWith("--idempotency-key=")) ? argv : [...argv, "--idempotency-key", randomUUID()];
}

const recordOf = (p: Parsed): Rec | undefined => (p.ok && "record" in p.payload ? p.payload.record : undefined);
const rowsOf = (p: Parsed): Rec[] | undefined => (p.ok && p.payload.kind === "page" ? p.payload.rows : undefined);
const reachOf = (p: Parsed | undefined): Reach | undefined => {
  if (!p) return undefined;
  if (!p.ok) return { error: p.error.message };
  const r = recordOf(p);
  return r ? { lower: typeof r.users_lower_bound === "number" ? r.users_lower_bound : undefined, upper: typeof r.users_upper_bound === "number" ? r.users_upper_bound : undefined } : undefined;
};

/** The reads behind the launch card: identity, the product, ads preferences, connected pages, and one reach estimate. */
async function launchReads(opts: NonNullable<ReturnType<typeof parseLaunchArgs>["opts"]>, env: NodeJS.ProcessEnv, mode: Mode, live: boolean): Promise<LaunchReads> {
  const wantsAds = opts.budget !== undefined;
  const estimate = wantsAds ? reachArgv(adGroupFor(opts, ""), "meta") : undefined;
  const [acct, product, preferences, social, reach] = await Promise.all([
    identity(env),
    run(["products", "get", opts.product], env),
    run(["accounts", "preferences"], env),
    wantsAds ? run(["social-accounts", "list"], env) : undefined,
    estimate ? run(estimate, env) : undefined,
  ]);
  return { product: recordOf(product.parsed), preferences: recordOf(preferences.parsed), social: social ? rowsOf(social.parsed) : undefined, reach: reachOf(reach?.parsed), accountTitle: acct?.title, accountId: acct?.id, mode, cap: live && wantsAds ? adCapFrom() : undefined };
}

/** The reads behind the winback card: identity, the campaign, ads preferences, who was seen in the window, connected pages, reach. */
async function winbackReads(opts: NonNullable<ReturnType<typeof parseWinbackArgs>["opts"]>, env: NodeJS.ProcessEnv, mode: Mode, live: boolean): Promise<WinbackReads> {
  const wantsGroup = opts.budget !== undefined;
  const estimate = wantsGroup ? reachArgv({ ...winbackGroup(opts), audiences: undefined }, "meta") : undefined;
  const [acct, campaign, preferences, people, social, reach] = await Promise.all([
    identity(env),
    opts.campaign ? run(["ad-campaigns", "get", opts.campaign], env) : undefined,
    run(["accounts", "preferences"], env),
    run(["people", "list", "--last_seen_within_days", String(opts.days), "--has_purchased", "false", "--first", "100"], env),
    wantsGroup ? run(["social-accounts", "list"], env) : undefined,
    estimate ? run(estimate, env) : undefined,
  ]);
  const seen = rowsOf(people.parsed);
  const more = people.parsed.ok && people.parsed.payload.kind === "page" && people.parsed.payload.page.has_next_page;
  return {
    preferences: recordOf(preferences.parsed),
    social: social ? rowsOf(social.parsed) : undefined,
    campaign: campaign ? recordOf(campaign.parsed) : undefined,
    campaignError: campaign && !campaign.parsed.ok ? campaign.parsed.error.message.split("\n")[0] : undefined,
    visitors: seen ? { seen: seen.length, more: !!more } : undefined,
    reach: reachOf(reach?.parsed),
    accountTitle: acct?.title, accountId: acct?.id, mode,
    cap: live && wantsGroup ? adCapFrom() : undefined,
  };
}

/** One recipe by name: parse its flags, gather its reads, build its plan. `error` is a refusal in words before any read. */
async function buildRecipe(argv: string[], env: NodeJS.ProcessEnv, mode: Mode, live: boolean): Promise<{ plan?: RecipePlan; error?: string }> {
  if (argv[0] === "store" && argv[1] === "price") {
    const parsed = parsePriceArgs(argv);
    if (!parsed.opts) return { error: parsed.error };
    const [acct, plan] = await Promise.all([identity(env), run(["plans", "get", parsed.opts.plan], env)]);
    return { plan: buildPrice(argv, parsed.opts, { plan: recordOf(plan.parsed), planError: plan.parsed.ok ? undefined : plan.parsed.error.message.split("\n")[0], accountTitle: acct?.title, accountId: acct?.id, mode }) };
  }
  if (argv[0] === "store" && argv[1] === "publish") {
    const parsed = parsePublishArgs(argv);
    if (!parsed.opts) return { error: parsed.error };
    const [acct, product, plans] = await Promise.all([identity(env), run(["products", "get", parsed.opts.product], env), run(["plans", "list", "--product_ids", parsed.opts.product], env)]);
    return { plan: buildPublish(argv, parsed.opts, { product: recordOf(product.parsed), productError: product.parsed.ok ? undefined : product.parsed.error.message.split("\n")[0], plans: rowsOf(plans.parsed), accountTitle: acct?.title, accountId: acct?.id, mode }) };
  }
  if (argv[0] === "dev" && argv[1] === "hook") {
    const parsed = parseHookArgs(argv);
    if (!parsed.opts) return { error: parsed.error };
    const acct = await identity(env);
    const [profiles, permissions, webhooks] = await Promise.all([run(["auth", "list"], env), acct?.id ? run(["permissions", "check", "--resource_id", acct.id, "--actions", WEBHOOK_ACTION], env) : undefined, run(["webhooks", "list", "--include_app_webhooks", "true"], env)]);
    return { plan: buildHook(argv, parsed.opts, { profiles: profiles.parsed, permissions: permissions?.parsed, webhooks: webhooks.parsed, accountTitle: acct?.title, accountId: acct?.id, mode }) };
  }
  if (argv[0] === "support" && argv[1] === "refund") {
    const parsed = parseRefundArgs(argv);
    if (!parsed.opts) return { error: parsed.error };
    const [acct, payment] = await Promise.all([identity(env), run(["payments", "get", parsed.opts.payment], env)]);
    return { plan: buildRefund(argv, parsed.opts, { payment: recordOf(payment.parsed), paymentError: payment.parsed.ok ? undefined : payment.parsed.error.message.split("\n")[0], accountTitle: acct?.title, accountId: acct?.id, mode }) };
  }
  if (argv[0] === "support" && argv[1] === "dispute") {
    const parsed = parseDisputeArgs(argv);
    if (!parsed.opts) return { error: parsed.error };
    const [acct, dispute] = await Promise.all([identity(env), run(["disputes", "get", parsed.opts.dispute], env)]);
    return { plan: buildDispute(argv, parsed.opts, { dispute: recordOf(dispute.parsed), disputeError: dispute.parsed.ok ? undefined : dispute.parsed.error.message.split("\n")[0], accountTitle: acct?.title, accountId: acct?.id, mode }) };
  }
  if (argv[0] === "money") {
    const parsed = parseCloseArgs(argv);
    if (!parsed.opts) return { error: parsed.error };
    const o = parsed.opts;
    const [acct, balance, methods] = await Promise.all([identity(env), run(["ledgers", "report", "--report_type", "balance_summary", "--currency", o.currency], env), run(["payouts", "methods", "--include_limits", "--currency", o.currency], env)]);
    return { plan: buildClose(argv, o, { balance: balanceOf(o.currency, balance.parsed), methods: methods.parsed, accountTitle: acct?.title, accountId: acct?.id, mode, cap: live ? capFrom() : undefined }) };
  }
  if (argv[1] === "winback") {
    const parsed = parseWinbackArgs(argv);
    if (!parsed.opts) return { error: parsed.error };
    return { plan: buildWinback(argv, parsed.opts, await winbackReads(parsed.opts, env, mode, live)) };
  }
  const parsed = parseLaunchArgs(argv);
  if (!parsed.opts) return { error: parsed.error };
  return { plan: buildLaunch(argv, parsed.opts, await launchReads(parsed.opts, env, mode, live)) };
}

/** Runs the plan's steps in order, feeding each result into the next. Stops at the first failure. */
async function runRecipe(plan: RecipePlan, env: NodeJS.ProcessEnv, onStep?: (label: string) => void): Promise<{ results: Partial<Record<string, Rec>>; failed?: { step: string; message: string; code: string } }> {
  const results: Partial<Record<string, Rec>> = {};
  for (const step of plan.steps) {
    if (step.skipped) continue;
    onStep?.(step.label);
    const { parsed } = await run(substitute(step.argv, results), env);
    if (!parsed.ok) return { results, failed: { step: step.key, message: parsed.error.message.split("\n")[0], code: parsed.error.code } };
    results[step.key] = recordOf(parsed) ?? {};
  }
  return { results };
}

/** A recipe in a terminal: the card, one typed approval for the whole sequence, then the run. */
async function recipeTerminal(argvIn: string[], theme: Theme, mode: Mode, env: NodeJS.ProcessEnv, planOnly: boolean): Promise<Outcome> {
  const split = splitApprove(argvIn);
  const yesFlag = split.argv.includes("--yes");
  const argv = recipeArgvWithKey(split.argv.filter((a) => a !== "--yes"));
  if (split.token !== undefined) {
    const verdict = checkApproval(split.token, argv, mode, approveSecret());
    if (verdict !== "ok") {
      print(errorView({ code: verdict === "expired" ? "APPROVAL_EXPIRED" : "APPROVAL_INVALID", message: verdict === "expired" ? copy.agent.approvalExpired : copy.agent.approvalInvalid }, theme));
      return { code: 2 };
    }
  }
  const approved = yesFlag || split.token !== undefined;
  const live = mode !== "sandbox" && !planOnly;
  const spin = spinner(argv[0] === "store" ? (argv[1] === "price" ? copy.spinner.price : copy.spinner.publish) : argv[0] === "dev" ? copy.spinner.hook : argv[0] === "support" ? (argv[1] === "refund" ? copy.spinner.refund : copy.spinner.dispute) : argv[0] === "money" ? copy.spinner.close : argv[1] === "winback" ? copy.spinner.winback : copy.spinner.launch, theme);
  const built = await buildRecipe(argv, env, mode, live).finally(() => spin.stop());
  if (!built.plan) {
    print(errorView({ code: "VALIDATION_ERROR", message: built.error ?? "" }, theme));
    return { code: 2 };
  }
  const plan = built.plan;
  if (planOnly) {
    print(recipeView(plan, theme, { planOnly: true }));
    return { code: 0 };
  }
  if (plan.blockers.length) {
    print(recipeView(plan, theme));
    return { code: 2 };
  }
  if (!approved) {
    print(recipeView(plan, theme));
    const typed = live ? plan.typedAmount : undefined;
    const shown = typed ? money(typed.amount, typed.currency).replace(/^[^\d]+/, "") : "";
    const accept = typed ? { test: amountMatcher(typed.amount), hint: copy.confirm.amountNo(shown) } : undefined;
    const timeoutSeconds = live ? timeoutFrom() : undefined;
    const answer = await prompt(typed ? copy.recipe.typeAmount(shown, plan.name) : copy.confirm.question, theme, { timeoutMs: timeoutSeconds ? timeoutSeconds * 1000 : undefined, accept });
    if (answer !== "yes") {
      print([" " + (answer === "timeout" && timeoutSeconds ? copy.confirm.expired(timeoutSeconds) : copy.confirm.aborted)]);
      return { code: 130 };
    }
    print([""]);
  }
  const stepSpin = spinner("", theme);
  const r = await runRecipe(plan, env, (label) => stepSpin.update(copy.spinner.launchStep(label))).finally(() => stepSpin.stop());
  print(recipeDoneView(plan, r.results, r.failed, theme));
  return { code: r.failed ? 1 : 0, group: "gtm" };
}

/** A recipe in a pipe: one envelope for the whole sequence, one rerun, then the results as data. */
async function recipePiped(argvIn: string[], mode: Mode, env: NodeJS.ProcessEnv, planOnly: boolean): Promise<never> {
  const split = splitApprove(argvIn);
  const yesFlag = split.argv.includes("--yes");
  const argv = recipeArgvWithKey(split.argv.filter((a) => a !== "--yes"));
  if (split.token !== undefined && !planOnly) {
    const verdict = checkApproval(split.token, argv, mode, approveSecret());
    if (verdict !== "ok") emit(approvalEnvelope(argv, mode, verdict), 2);
  }
  const approved = yesFlag || split.token !== undefined;
  const live = mode !== "sandbox" && !planOnly;
  const built = await buildRecipe(argv, env, mode, live);
  if (!built.plan) emit(wvErrorEnvelope(argv, mode, { code: "VALIDATION_ERROR", message: built.error ?? "" }), 2);
  const plan = built.plan!;
  const data = recipeData(plan);
  if (planOnly) emit(planEnvelope(argv, mode, data), 0);
  if (plan.blockers.length) emit(envelopeWith(argv, mode, { ok: false, error: { code: `${plan.name.toUpperCase()}_BLOCKED`, message: copy.recipe.blockedMessage(plan.name), hint: plan.blockers.join(" ") }, plan: data }), 2);
  if (!approved) {
    const ttlSeconds = approveTtlFrom();
    emit(confirmationEnvelope(argv, mode, data, { token: mintApproval(argv, mode, approveSecret(), Math.floor(Date.now() / 1000) + ttlSeconds), ttlSeconds }), 2);
  }
  const r = await runRecipe(plan, env);
  const results: Rec = {};
  for (const [k, v] of Object.entries(r.results)) results[k] = { id: v?.id, code: v?.code, name: v?.name, status: v?.status, purchase_url: v?.purchase_url };
  const body: Omit<AgentEnvelope, "meta"> & Rec = r.failed
    ? { ok: false, error: { code: r.failed.code, message: r.failed.message, hint: copy.recipe.resume }, results, failed: r.failed.step, rerun: ["wv", ...argv, "--yes"] }
    : { ok: true, results, next: plan.done(r.results).map((c) => ({ what: c.label, run: c.argv })) };
  return emit(envelopeWith(argv, mode, body), r.failed ? agentExitCode(1, JSON.stringify(r.failed)) : 0);
}

const envelopeWith = (argv: string[], mode: Mode, body: Omit<AgentEnvelope, "meta"> & Rec): AgentEnvelope => ({ ...body, meta: { command: argv.slice(0, 2).join(" "), wrapper: "wv", mode } });

/** `wv gtm rank <campaign> [--target N]`: the campaign and its ad groups with their delivery numbers. */
async function rankReads(argv: string[], env: NodeJS.ProcessEnv, mode: Mode): Promise<RankInput | { error: string }> {
  const id = argv[2] && !argv[2].startsWith("--") ? argv[2] : undefined;
  if (!id) return { error: copy.rank.needsCampaign };
  const ti = argv.indexOf("--target");
  const target = ti >= 0 ? Number(argv[ti + 1]) : undefined;
  if (target !== undefined && !(Number.isFinite(target) && target > 0)) return { error: copy.launch.badNumber("--target", argv[ti + 1] ?? "") };
  const cmds = [["ad-campaigns", "get", id], ["ad-groups", "list", "--ad_campaign_id", id, "--order", "cost_per_result", "--direction", "asc"], ["accounts", "preferences"]];
  const [acct, campaign, groups, prefs] = await Promise.all([identity(env), ...cmds.map((c) => run(c, env))]);
  const currency = typeof recordOf(prefs.parsed)?.ads_reporting_currency === "string" ? String(recordOf(prefs.parsed)!.ads_reporting_currency) : "usd";
  return { campaignId: id, campaign: recordOf(campaign.parsed), groups: groups.parsed, target, currency, accountTitle: acct?.title, accountId: acct?.id, mode, commands: cmds.slice(0, 2) };
}

async function rank(argv: string[], theme: Theme, mode: Mode, env: NodeJS.ProcessEnv): Promise<Outcome> {
  const spin = spinner(copy.spinner.rank, theme);
  const input = await rankReads(argv, env, mode).finally(() => spin.stop());
  if ("error" in input) {
    print(errorView({ code: "VALIDATION_ERROR", message: input.error }, theme));
    return { code: 2 };
  }
  print(rankView(input, theme));
  return { code: input.groups.ok ? 0 : 1, group: "gtm" };
}

async function rankJson(argv: string[], mode: Mode, env: NodeJS.ProcessEnv): Promise<number> {
  const clean = argv.filter((a, i) => !(a === "--format" || a.startsWith("--format=") || argv[i - 1] === "--format"));
  const input = await rankReads(clean, env, mode);
  if ("error" in input) {
    process.stdout.write(serialize(wvErrorEnvelope(clean, mode, { code: "VALIDATION_ERROR", message: input.error })));
    return 2;
  }
  process.stdout.write(JSON.stringify({ ok: input.groups.ok, ...rankData(input), meta: { command: "gtm rank", wrapper: "wv", mode } }, null, 2) + "\n");
  return input.groups.ok ? 0 : 1;
}

/**
 * `wv support lookup <key>`: resolve the key to a buyer, then read everything a ticket needs in parallel.
 * An email goes through `people list --email` and `payments list --query`; a membership id or license key through
 * `memberships get`; a payment id through `payments get`; a member id through `members get`; a person id through
 * `people get`. Disputes have no user filter, so the list is narrowed to the buyer's payment ids here.
 */
async function gatherLookup(key: string, env: NodeJS.ProcessEnv, mode: Mode): Promise<LookupInput> {
  const kind = classifyKey(key);
  const commands: string[][] = [];
  const read = async (argv: string[]) => {
    commands.push(argv);
    return (await run(argv, env)).parsed;
  };
  const acct = await identity(env);
  let user: LookupInput["user"];
  let person: Rec | undefined;
  if (kind === "email") {
    const people = await read(["people", "list", "--email", key]);
    person = rowsOf(people)?.[0];
    user = userFrom(person);
    if (!user) {
      const pays = await read(["payments", "list", "--query", key, "--first", "1"]);
      user = userFrom(rowsOf(pays)?.[0]);
    }
  } else if (kind === "user") user = { id: key };
  else if (kind === "membership" || kind === "license") user = userFrom(recordOf(await read(["memberships", "get", key])));
  else if (kind === "payment") user = userFrom(recordOf(await read(["payments", "get", key])));
  else if (kind === "member") user = userFrom(recordOf(await read(["members", "get", key])));
  else if (kind === "person") {
    person = recordOf(await read(["people", "get", key]));
    user = userFrom(person);
  }
  const empty: Parsed = { ok: true, payload: { kind: "page", rows: [], page: { start_cursor: null, end_cursor: null, has_next_page: false, has_previous_page: false } } };
  if (!user) return { key, kind, accountTitle: acct?.title, accountId: acct?.id, mode, memberships: empty, payments: empty, disputes: empty, cases: empty, commands };
  const cmds = [
    ["memberships", "list", "--user_id", user.id],
    ["payments", "list", "--user_id", user.id, "--first", "10"],
    ["disputes", "list", "--first", "50"],
    ["resolution-center-cases", "list", "--user_id", user.id],
    ...(person ? [] : [["people", "list", "--user_id", user.id]]),
    ["members", "list", "--user_ids", user.id],
  ];
  commands.push(...cmds);
  const results = await Promise.all(cmds.map((c) => run(c, env)));
  const [memberships, payments, disputes, cases] = results.map((r) => r.parsed);
  const rest = results.slice(4).map((r) => r.parsed);
  if (!person) person = rowsOf(rest[0])?.[0];
  const member = rowsOf(rest[rest.length - 1])?.[0];
  const u = userFrom(person) ?? userFrom(rowsOf(payments)?.[0]) ?? user;
  const paymentIds = new Set((rowsOf(payments) ?? []).map((p) => String(p.id)));
  return { key, kind, accountTitle: acct?.title, accountId: acct?.id, mode, user: { ...user, ...u, id: user.id }, person, member, memberships, payments, disputes: disputesFor(disputes, paymentIds), cases, commands };
}

const lookupKey = (argv: string[]) => (argv[2] && !argv[2].startsWith("--") ? argv[2] : undefined);

async function lookup(argv: string[], theme: Theme, mode: Mode, env: NodeJS.ProcessEnv): Promise<Outcome> {
  const key = argv[1] === "lookup" ? lookupKey(argv) : argv[1] && !argv[1].startsWith("--") ? argv[1] : undefined;
  if (!key) {
    print(errorView({ code: "VALIDATION_ERROR", message: copy.support.needsKey }, theme));
    return { code: 2 };
  }
  const spin = spinner(copy.spinner.lookup, theme);
  const input = await gatherLookup(key, env, mode).finally(() => spin.stop());
  print(lookupView(input, theme));
  return { code: input.user ? 0 : 1, group: "support" };
}

async function lookupJson(argv: string[], mode: Mode, env: NodeJS.ProcessEnv): Promise<number> {
  const clean = argv.filter((a, i) => !(a === "--format" || a.startsWith("--format=") || argv[i - 1] === "--format"));
  const key = lookupKey(clean);
  if (!key) {
    process.stdout.write(serialize(wvErrorEnvelope(clean, mode, { code: "VALIDATION_ERROR", message: copy.support.needsKey })));
    return 2;
  }
  const input = await gatherLookup(key, env, mode);
  process.stdout.write(JSON.stringify({ ...lookupData(input), meta: { command: "support lookup", wrapper: "wv", mode } }, null, 2) + "\n");
  return input.user ? 0 : 1;
}

/**
 * `wv report`: the brief. Six metrics over this week and last, then the four screens' reads in turn (each has its
 * own spinner), then a rank per live campaign, then the recommendations. Read-only; about forty calls.
 */
async function gatherReport(theme: Theme, env: NodeJS.ProcessEnv, mode: Mode): Promise<ReportInput> {
  const acct = await identity(env);
  const from = isoDay(daysAgo(7));
  const to = isoDay(daysAgo(1));
  const prevFrom = isoDay(daysAgo(14));
  const prevTo = isoDay(daysAgo(8));
  const spin = spinner(copy.spinner.report, theme);
  const metricCmds = REPORT_METRICS.flatMap((m) => [["stats", "get", m.key, "--from", from, "--to", to, "--interval", "day"], ["stats", "get", m.key, "--from", prevFrom, "--to", prevTo, "--interval", "day"]]);
  const recCmd = ["economic-intelligence", "list", "--status", "ready"];
  const [metricResults, recs] = await Promise.all([Promise.all(metricCmds.map((c) => run(c, env))), run(recCmd, env)]);
  spin.stop();
  const doctor = await gatherDoctor(theme, env, mode);
  const { input: gtm } = await gatherGtm(theme, env, mode);
  const money = await gatherMoney(theme, env, mode);
  const store = await gatherStore(theme, env, mode);
  const live = (rowsOf(gtm.campaigns) ?? []).filter((c) => c.status === "active").slice(0, 3);
  const ranks: RankInput[] = [];
  for (const c of live) {
    const r = await rankReads(["gtm", "rank", String(c.id)], env, mode);
    if (!("error" in r)) ranks.push(r);
  }
  return {
    accountTitle: acct?.title, accountId: acct?.id, mode,
    window: { from, to, prevFrom, prevTo, days: 7 },
    metrics: REPORT_METRICS.map((m, i) => ({ key: m.key, unit: m.unit, now: metricResults[i * 2].parsed, prev: metricResults[i * 2 + 1].parsed })),
    doctor, gtm, money, store, ranks, recommendations: recs.parsed,
    generatedAt: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC",
    commands: [...metricCmds, recCmd, ...doctor.commands, ...gtm.commands, ...money.commands, ...store.commands, ...ranks.flatMap((r) => r.commands)],
  };
}

async function reportRun(theme: Theme, env: NodeJS.ProcessEnv, mode: Mode, face: "tty" | "json" | "md"): Promise<number> {
  const input = await gatherReport(theme, env, mode);
  if (face === "md") print(reportMarkdown(input));
  else if (face === "json") process.stdout.write(JSON.stringify({ ...reportData(input), meta: { command: "report", wrapper: "wv", mode } }, null, 2) + "\n");
  else print(reportView(input, theme));
  return reportData(input).ok ? 0 : 1;
}

/** `wv store`: products, every plan, the active promo codes, and the checkout links, at once. */
async function gatherStore(theme: Theme, env: NodeJS.ProcessEnv, mode: Mode): Promise<StoreInput> {
  const spin = spinner(copy.spinner.store, theme);
  const cmds = [["products", "list"], ["plans", "list"], ["promo-codes", "list", "--status", "active"], ["checkout-configurations", "list"]];
  const [acct, products, plans, promoCodes, checkouts] = await Promise.all([identity(env), ...cmds.map((c) => run(c, env))]);
  spin.stop();
  return { accountTitle: acct?.title, accountId: acct?.id, mode, products: products.parsed, plans: plans.parsed, promoCodes: promoCodes.parsed, checkouts: checkouts.parsed, commands: cmds };
}

async function storeScreen(theme: Theme, mode: Mode): Promise<Outcome> {
  const input = await gatherStore(theme, whopEnv(mode), mode);
  print(storeView(input, theme));
  return { code: input.products.ok ? 0 : 1, group: "store" };
}

/** `wv dev [app_id]`: the apps, then the named or first app's builds, domains, and last day of errors, plus the account's webhooks and the credential. */
async function gatherDev(appId: string | undefined, theme: Theme, env: NodeJS.ProcessEnv, mode: Mode): Promise<DevInput> {
  const spin = spinner(copy.spinner.dev, theme);
  const acct = await identity(env);
  const commands: string[][] = [["apps", "list"], ["auth", "list"], ["webhooks", "list", "--include_app_webhooks", "true"]];
  const permCmd = acct?.id ? ["permissions", "check", "--resource_id", acct.id, "--actions", WEBHOOK_ACTION] : undefined;
  if (permCmd) commands.push(permCmd);
  const [apps, profiles, webhooks, permissions] = await Promise.all([run(["apps", "list"], env), run(["auth", "list"], env), run(["webhooks", "list", "--include_app_webhooks", "true"], env), permCmd ? run(permCmd, env) : undefined]);
  const list = rowsOf(apps.parsed) ?? [];
  const app = appId ? list.find((a) => a.id === appId) ?? { id: appId } : list[0];
  let builds: Parsed | undefined;
  let domains: Parsed | undefined;
  let errors: Parsed | undefined;
  if (app?.id) {
    const id = String(app.id);
    const since = new Date(Date.now() - 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const cmds = [["app-builds", "list", "--app_id", id], ["domains", "list", "--app_id", id], ["apps", "logs", id, "--level", "error", "--created_after", since]];
    commands.push(...cmds);
    [builds, domains, errors] = (await Promise.all(cmds.map((c) => run(c, env)))).map((r) => r.parsed);
  }
  spin.stop();
  return { accountTitle: acct?.title, accountId: acct?.id, mode, apps: apps.parsed, app: app?.id ? app : undefined, builds, domains, webhooks: webhooks.parsed, errors, profiles: profiles.parsed, permissions: permissions?.parsed, commands };
}

async function devScreen(argv: string[], theme: Theme, mode: Mode): Promise<Outcome> {
  const input = await gatherDev(argv[1] && !argv[1].startsWith("--") ? argv[1] : undefined, theme, whopEnv(mode), mode);
  print(devView(input, theme));
  return { code: input.apps.ok ? 0 : 1, group: "dev" };
}

/** wv screens that have a JSON face: `--format json`, or any pipe. */
const DATA_SCREENS = new Set(["doctor", "gtm", "money", "dev", "store", "setup"]);
const wantsJson = (argv: string[]) => argv.some((a, i) => a === "--format=json" || (a === "--format" && argv[i + 1] === "json"));

/** Prints a screen's data as JSON and returns the exit code the screen would have used. */
async function screenJson(screen: string, mode: Mode, env: NodeJS.ProcessEnv, argv: string[] = []): Promise<number> {
  const theme = makeTheme({});
  if (screen === "setup") {
    const input = await gatherDoctor(theme, env, mode);
    const data = setupData(input);
    process.stdout.write(JSON.stringify({ ...data, meta: { command: "setup", wrapper: "wv", mode } }, null, 2) + "\n");
    return data.ok ? 0 : 1;
  }
  if (screen === "store") {
    const input = await gatherStore(theme, env, mode);
    const data = storeData(input);
    process.stdout.write(JSON.stringify({ ...data, meta: { command: "store", wrapper: "wv", mode } }, null, 2) + "\n");
    return data.ok ? 0 : 1;
  }
  if (screen === "dev") {
    const input = await gatherDev(argv[1] && !argv[1].startsWith("--") ? argv[1] : undefined, theme, env, mode);
    const data = devData(input);
    process.stdout.write(JSON.stringify({ ...data, meta: { command: "dev", wrapper: "wv", mode } }, null, 2) + "\n");
    return data.ok ? 0 : 1;
  }
  if (screen === "doctor") {
    const input = await gatherDoctor(theme, env, mode);
    const data = doctorData(input);
    process.stdout.write(JSON.stringify({ ...data, meta: { command: "doctor", wrapper: "wv", mode } }, null, 2) + "\n");
    return data.ok ? 0 : 1;
  }
  if (screen === "money") {
    const input = await gatherMoney(theme, env, mode);
    const data = moneyData(input);
    process.stdout.write(JSON.stringify({ ...data, meta: { command: "money", wrapper: "wv", mode } }, null, 2) + "\n");
    return data.ok ? 0 : 1;
  }
  const { input, failed } = await gatherGtm(theme, env, mode);
  process.stdout.write(JSON.stringify({ ...gtmData(input), meta: { command: "gtm", wrapper: "wv", mode } }, null, 2) + "\n");
  return failed ? 1 : 0;
}

/** `wv money`: identity, the usd balance plus one per saved-method currency, methods with limits, recent payouts, reserves, verifications. */
async function gatherMoney(theme: Theme, env: NodeJS.ProcessEnv, mode: Mode): Promise<MoneyInput> {
  const spin = spinner(copy.spinner.moneyScreen, theme);
  const methodsCmd = ["payouts", "methods", "--include_limits"];
  const cmds = [["payouts", "list", "--first", "5"], ["accounts", "reserves"], ["verifications", "list"]];
  const [acct, methods, payouts, reserves, verifications] = await Promise.all([identity(env), run(methodsCmd, env), ...cmds.map((c) => run(c, env))]);
  const currencies = ["usd"];
  for (const m of methods.parsed.ok && methods.parsed.payload.kind === "page" ? methods.parsed.payload.rows : []) {
    const c = typeof m.currency === "string" ? m.currency.toLowerCase() : "";
    if (c && !currencies.includes(c)) currencies.push(c);
  }
  const balanceCmds = currencies.map((c) => ["ledgers", "report", "--report_type", "balance_summary", "--currency", c]);
  const balances = await Promise.all(balanceCmds.map((c) => run(c, env)));
  spin.stop();
  return {
    accountTitle: acct?.title, accountId: acct?.id, mode,
    balances: balances.map((b, i) => balanceOf(currencies[i], b.parsed)),
    methods: methods.parsed, payouts: payouts.parsed, reserves: reserves.parsed, verifications: verifications.parsed,
    commands: [...balanceCmds, methodsCmd, ...cmds],
  };
}

async function moneyScreen(theme: Theme, mode: Mode): Promise<Outcome> {
  const input = await gatherMoney(theme, whopEnv(mode), mode);
  print(moneyView(input, theme));
  return { code: moneyData(input).ok ? 0 : 1, group: "money" };
}

/** Pages `--all` will follow before stopping. A cursor that never ends is a bug in the API, not a reason to loop. */
export const ALL_MAX_PAGES = 1000;

/**
 * Every page of a list: `withAfter` on the cursor until `has_next_page` is false. Rows accumulate; the last
 * envelope is kept so a failure mid-way is reported as whop reported it. `onPage` is for the spinner.
 */
async function fetchAll(argv: string[], env: NodeJS.ProcessEnv, onPage?: (n: number) => void): Promise<{ rows: Rec[]; pages: number; last: Parsed; code: number; extra?: Rec }> {
  const rows: Rec[] = [];
  let cursor: string | undefined;
  let pages = 0;
  let extra: Rec | undefined;
  for (;;) {
    onPage?.(pages + 1);
    const { parsed, code } = await run(cursor ? withAfter(argv, cursor) : argv, env);
    pages++;
    if (!parsed.ok || parsed.payload.kind !== "page") return { rows, pages, last: parsed, code: parsed.ok ? 0 : code || 1, extra };
    rows.push(...parsed.payload.rows);
    extra ??= parsed.payload.extra;
    const page = parsed.payload.page;
    if (!page.has_next_page || !page.end_cursor || pages >= ALL_MAX_PAGES) return { rows, pages, last: parsed, code: 0, extra };
    cursor = page.end_cursor;
  }
}

const wantsJsonArray = (argv: string[]) => argv.some((a, i) => a === "--format=json" || (a === "--format" && argv[i + 1] === "json"));

/**
 * `wv <group> list --all | …`: jsonl by default, each row on its own line as it arrives, so a long list streams;
 * `--format json` buffers into whop's own list shape with `page_info` closed. A failing page ends the stream
 * with whop's error envelope and its exit code, so a consumer sees where it stopped.
 */
async function allPagesPiped(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const asArray = wantsJsonArray(argv);
  const clean = argv.filter((a, i) => !(a === "--format" || a.startsWith("--format=") || (argv[i - 1] === "--format")));
  const r = await fetchAll(clean, env);
  if (asArray) {
    process.stdout.write(JSON.stringify({ data: r.rows, page_info: { start_cursor: null, end_cursor: null, has_next_page: false, has_previous_page: false }, pages: r.pages, ...(r.extra ?? {}), ...(r.last.ok ? {} : { error: r.last.error }) }, null, 2) + "\n");
  } else {
    for (const row of r.rows) process.stdout.write(JSON.stringify(row) + "\n");
    if (!r.last.ok) process.stdout.write(JSON.stringify({ ok: false, error: r.last.error, pages: r.pages }) + "\n");
  }
  return r.last.ok ? 0 : agentExitCode(r.code, JSON.stringify(r.last.error));
}

export interface ExecuteOptions {
  /** Inside a session: lists get a row-number gutter for the `N opens a row` shortcut. */
  numbered?: boolean;
  /** `--all`: follow the cursor and render every row as one list. */
  all?: boolean;
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
    const lines = await agentManifest(verb, wantsJson(argv));
    if (!lines) {
      print(errorView({ code: "COMMAND_NOT_FOUND", message: copy.manifest.unknownGroup(verb ?? "") }, theme));
      return { code: 2 };
    }
    print(lines);
    return { code: 0 };
  }
  if (group === "home") return home(theme, mode);
  if ((group === "gtm" && (verb === "launch" || verb === "winback")) || (group === "money" && verb === "close") || (group === "support" && (verb === "refund" || verb === "dispute")) || (group === "dev" && verb === "hook") || (group === "store" && (verb === "price" || verb === "publish"))) return recipeTerminal(argv, theme, mode, env, !!opts.plan);
  if (group === "dev") return devScreen(argv, theme, mode);
  if (group === "store") return storeScreen(theme, mode);
  if (group === "report") return { code: await reportRun(theme, whopEnv(mode), mode, "tty") };
  if (group === "setup") {
    const input = await gatherDoctor(theme, whopEnv(mode), mode);
    print(setupView(input, theme));
    return { code: setupData(input).ok ? 0 : 1, group: "setup" };
  }
  if (group === "support") return lookup(argv, theme, mode, env);
  if (group === "money") return moneyScreen(theme, mode);
  if (group === "gtm" && verb === "rank") return rank(argv, theme, mode, env);
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

  const split = splitApprove(argv);
  const stripped = split.argv.filter((a) => a !== "--yes");
  // A valid `--approve` token from a piped plan is consent here too; a stale or mismatched one is refused.
  if (split.token !== undefined) {
    const verdict = checkApproval(split.token, stripped, mode, approveSecret());
    if (verdict !== "ok") {
      print(errorView({ code: verdict === "expired" ? "APPROVAL_EXPIRED" : "APPROVAL_INVALID", message: verdict === "expired" ? copy.agent.approvalExpired : copy.agent.approvalInvalid }, theme));
      return { code: 2 };
    }
  }
  const yes = split.argv.includes("--yes") || split.token !== undefined;
  const gated = (isAdPlan(group, verb) || isWrite(group, verb)) && !yes;
  // The plan step mints the idempotency key and the card shows it, so a second approval of the same plan cannot write twice.
  const args = gated ? withIdempotencyKey(stripped, schema(group, verb)) : stripped;

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
  if (opts.all) {
    const r = await fetchAll(args, env, (n) => spin.update(copy.spinner.allPages(n)));
    spin.stop();
    // One list of every row, the pager closed, so the footer says how many pages it took.
    const parsed: Parsed = r.last.ok && r.last.payload.kind === "page" ? { ok: true, payload: { kind: "page", rows: r.rows, page: { start_cursor: null, end_cursor: null, has_next_page: false, has_previous_page: false }, extra: r.extra } } : r.last;
    if (r.pages > 1 && parsed.ok) print([" " + paint(theme, "muted", copy.list.allPages(r.pages))]);
    return { code: r.code, group, ...render(parsed, group, args, theme, opts) };
  }
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

/** The id a write targets: the first positional after the verb. */
const targetId = (args: string[]) => (args[2] && !args[2].startsWith("--") ? args[2] : undefined);

/** `<group> get <id>`, or undefined when the group has no get or the id is unknown. Never fails the gate. */
async function currentRecord(group: string, id: string, env: NodeJS.ProcessEnv): Promise<Rec | undefined> {
  const { parsed } = await run([group, "get", id], env);
  return parsed.ok && "record" in parsed.payload ? parsed.payload.record : undefined;
}

/**
 * Everything the money gate shows and decides, shared by the terminal card and the agent envelope: identity,
 * the balance in the payout's currency, the saved method behind `--payout_method_id`, and Whop's live limit.
 */
async function moneyGateFor(group: string, verb: string, args: string[], env: NodeJS.ProcessEnv, mode: Mode): Promise<MoneyGate> {
  const m = MONEY_GROUPS.has(group) ? moneyOf(args) : null;
  const methodId = flagsToRecord(args).payout_method_id;
  // A write against one record: read it first, so the card can say what changes. `create` has nothing to read.
  const target = !MONEY_GROUPS.has(group) && verb !== "create" ? targetId(args) : undefined;
  const [acct, balance, methods, current] = await Promise.all([
    identity(env),
    m ? balanceFor(m.currency, env) : undefined,
    m || typeof methodId === "string" ? methodsFor(typeof methodId === "string" ? methodId : undefined, m?.currency ?? "usd", speedOf(args), env) : undefined,
    target ? currentRecord(group, target, env) : undefined,
  ]);
  const live = !!m && mode !== "sandbox";
  const cap = live ? capFrom() : undefined;
  const limit = live ? methods?.limit : undefined;
  const timeoutSeconds = live ? timeoutFrom() : undefined;
  const input: ConfirmInput = { group, verb, argv: args, hints: hintsFor(group, verb), accountTitle: acct?.title, accountId: acct?.id, mode, destination: methods?.destination, balance, cap, limit, timeoutSeconds };
  if (current) {
    input.current = currentSummary(current);
    input.changes = changesFor(verb, args, current);
  }
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
