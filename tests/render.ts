// Renders every view from fixtures. Shared by snapshot tests and `pnpm demo:offline`.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnvelope } from "../src/envelope.ts";
import { hintsFor } from "../src/hints.ts";
import { makeTheme, type Theme } from "../src/tokens.ts";
import { setNow } from "../src/format.ts";
import { listView } from "../src/views/list.ts";
import { detailView } from "../src/views/detail.ts";
import { changesFor, confirmView, currentSummary, refusedView } from "../src/views/confirm.ts";
import { buildLaunch, launchDoneView, launchView, parseLaunchArgs } from "../src/views/launch.ts";
import { buildWinback, parseWinbackArgs } from "../src/views/winback.ts";
import { recipeView } from "../src/views/recipe.ts";
import { rankView } from "../src/views/rank.ts";
import { balanceOf, buildClose, moneyView, parseCloseArgs } from "../src/views/money.ts";
import { buildDispute, buildRefund, lookupView, parseDisputeArgs, parseRefundArgs } from "../src/views/support.ts";
import { buildHook, devView, parseHookArgs } from "../src/views/dev.ts";
import { errorView } from "../src/views/error.ts";
import { helpView, parseHelp } from "../src/views/help.ts";
import { homeView } from "../src/views/home.ts";
import { seriesView } from "../src/views/series.ts";
import { summaryView } from "../src/views/summary.ts";
import { adPlanView, adRefusedView, type AdPlanInput } from "../src/views/adplan.ts";
import { gtmView, type GtmInput } from "../src/views/gtm.ts";
import { doctorView, DOCTOR_ACTIONS, type DoctorInput } from "../src/views/doctor.ts";
import { sandboxMissingKeyView, sandboxStatusView } from "../src/views/sandbox.ts";
import { followHeader, followStopped, logLines, logsView } from "../src/views/logs.ts";
import { webhookTestView } from "../src/views/webhook.ts";
import { licenseView } from "../src/views/license.ts";
import { assembleJson } from "../src/jsonflags.ts";
import type { Rec } from "../src/envelope.ts";

export const FIXTURES = join(import.meta.dirname, "fixtures");
export const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");
export const envelope = (name: string) => parseEnvelope(fixture(`${name}.json`));

/** Freeze the clock one day after the newest fixture so relative times are stable. */
setNow(() => Date.parse("2026-09-19T12:00:00Z"));

export function theme(width: number, color: boolean): Theme {
  return { ...makeTheme({ width, color }), color };
}

function page(name: string, group: string, argv: string[], t: Theme, accountTitle?: string, canCreate?: boolean, numbered?: boolean, noun?: string) {
  const p = envelope(name);
  if (!p.ok || p.payload.kind !== "page") throw new Error(` is not a page`);
  return listView({ group, argv, rows: p.payload.rows, page: p.payload.page, hints: hintsFor(group, argv[1]), accountTitle, canCreate, numbered, noun }, t);
}

function record(name: string, group: string, argv: string[], t: Theme) {
  const p = envelope(name);
  if (!p.ok || !("record" in p.payload)) throw new Error(`${name} is not a record`);
  return detailView({ group, argv, record: p.payload.record, hints: hintsFor(group) }, t);
}

function summary(name: string, argv: string[], t: Theme) {
  const p = envelope(name);
  if (!p.ok || p.payload.kind !== "summary") throw new Error(`${name} is not a summary`);
  return summaryView({ argv, total: p.payload.total, groups: p.payload.groups }, t);
}

function error(name: string, t: Theme) {
  const p = envelope(name);
  if (p.ok) throw new Error(`${name} is not an error`);
  return errorView(p.error, t);
}

const PAYOUT = {
  group: "payouts",
  verb: "create",
  argv: ["payouts", "create", "--amount", "250", "--currency", "usd", "--payout_method_id", "potk_x1", "--speed", "standard"],
  hints: hintsFor("payouts"),
  accountTitle: "Hypermotion",
  accountId: "biz_VraUMckluH8dzV",
};

const AD_GROUP_JSON = '{"ad_campaign_id":"adcamp_x1","title":"US 25-44 · purchase","budget_amount":40,"budget_type":"daily","optimization_goal":"conversions","conversion_event":"purchase","conversion_location":"website","placements":"automatic","demographics":{"minimum_age":25,"maximum_age":44,"gender":"all"},"regions":{"include":{"countries":["US"]}}}';

/** Shared shape for the ads gate scenes. The ids are placeholders; the account has no ads yet. */
const AD_PLAN: AdPlanInput = {
  group: "ads",
  verb: "create",
  argv: ["ads", "create", "--title", "Frame · launch v1", "--url", "https://hypermotion.art/frame", "--call_to_action", "shop_now", "--ad_group", AD_GROUP_JSON, "--creatives", '[{"id":"file_a1","format":"vertical"},{"id":"file_b2","format":"vertical"}]', "--headlines", '["Frame is live","Ship the cut, not the timeline"]', "--primary_texts", '["20% off this week with LAUNCH20."]'],
  tree: {
    campaign: { id: "adcamp_x1", isNew: false, rec: { id: "adcamp_x1", title: "Frame launch", objective: "sales", platform: "meta", budget_optimization: "ad_group", status: "draft" } },
    group: { isNew: true, rec: JSON.parse(AD_GROUP_JSON) },
    ad: { isNew: true, rec: { title: "Frame · launch v1", url: "https://hypermotion.art/frame", call_to_action: "shop_now", creatives: [{ id: "file_a1" }, { id: "file_b2" }], headlines: ["Frame is live", "Ship the cut, not the timeline"], primary_texts: ["20% off this week with LAUNCH20."] } },
  },
  budget: { amount: 40, type: "daily", owner: "group", typed: true },
  reach: { lower: 1_500_000, upper: 1_800_000 },
  social: [{ id: "sacc_x1", name: "Hypermotion", platform: "facebook", username: "hypermotion", verified: false, error: null, scopes: ["advertise"] }],
  paysFrom: "visa ••••4242",
  balance: { available: 418.56, currency: "usd" },
  currency: "usd",
  accountTitle: "Hypermotion",
  accountId: "biz_VraUMckluH8dzV",
  cap: 1500,
  timeoutSeconds: 120,
};

const GTM_COMMANDS = [
  ...["page_visits", "new_users", "gross_revenue", "ad_spend"].map((m) => ["stats", "get", m, "--from", "2026-09-14", "--to", "2026-09-20", "--interval", "day"]),
  ["people", "list", "--last_seen_within_days", "7"],
  ["audiences", "list"],
  ["ad-campaigns", "list"],
  ["promo-codes", "list"],
  ["social-accounts", "list"],
  ["accounts", "preferences"],
];

/** The recorded account's gtm screen, shared by the snapshot and the JSON face test. */
export const GTM: GtmInput = {
  accountTitle: "Hypermotion",
  accountId: "biz_VraUMckluH8dzV",
  from: "2026-09-14",
  to: "2026-09-20",
  series: { page_visits: envelope("stats.page_visits"), new_users: envelope("stats.new_users"), gross_revenue: envelope("stats.gross_revenue"), ad_spend: envelope("stats.ad_spend") },
  people: envelope("people.list"),
  audiences: envelope("audiences.list"),
  campaigns: envelope("ad-campaigns.list"),
  promoCodes: envelope("promo-codes.list"),
  social: envelope("social-accounts.list"),
  preferences: envelope("accounts.preferences"),
  commands: GTM_COMMANDS,
};

/** An envelope built in the test, for shapes this account cannot record (webhooks need an API-key login). */
/** The record inside a recorded `get`. */
const record0 = (name: string): Rec => {
  const p = envelope(name);
  return p.ok && "record" in p.payload ? p.payload.record : {};
};

const LAUNCH_NOW = new Date("2026-09-21T12:00:00Z");
const LAUNCH_ARGV = ["gtm", "launch", "prod_iQ2Zub6GFQS5Q", "--budget", "40", "--creative", "file_x1", "--idempotency-key", "5b2c1d6e-0000-4000-8000-000000000002"];
const LAUNCH_OPTS = parseLaunchArgs(LAUNCH_ARGV, LAUNCH_NOW).opts!;
/** The recorded account: no page, no payment method, so the ad steps block. */
export const LAUNCH_BLOCKED = buildLaunch(LAUNCH_ARGV, LAUNCH_OPTS, { product: record0("products.get"), preferences: record0("accounts.preferences"), social: [], reach: { error: "No connected Meta account" }, accountId: "biz_VraUMckluH8dzV", accountTitle: "Hypermotion", cap: 500, now: LAUNCH_NOW });
/** The same launch on an account that is set up. */
export const LAUNCH_READY = buildLaunch(LAUNCH_ARGV, LAUNCH_OPTS, { product: record0("products.get"), preferences: { ads_reporting_currency: "usd", ads_payment_methods: [{ id: "pm_1", brand: "visa", last4: "4242" }] }, social: [{ id: "sacc_x1", platform: "facebook", name: "Hypermotion", username: "hypermotion" }], reach: { lower: 1_500_000, upper: 1_800_000 }, accountId: "biz_VraUMckluH8dzV", accountTitle: "Hypermotion", cap: 2000, now: LAUNCH_NOW });

const WINBACK_ARGV = ["gtm", "winback", "adcamp_x1", "--budget", "15", "--idempotency-key", "5b2c1d6e-0000-4000-8000-000000000003"];
export const WINBACK_READY = buildWinback(WINBACK_ARGV, parseWinbackArgs(WINBACK_ARGV).opts!, { preferences: { ads_reporting_currency: "usd", ads_payment_methods: [{ id: "pm_1" }] }, social: [{ id: "sacc_x1", platform: "facebook", name: "Hypermotion", username: "hypermotion" }], campaign: { id: "adcamp_x1", title: "Launch · Hypermotion", status: "active" }, visitors: { seen: 100, more: true }, reach: { lower: 400, upper: 900 }, accountId: "biz_VraUMckluH8dzV", accountTitle: "Hypermotion", cap: 2000, now: LAUNCH_NOW });
const RANK_GROUPS = [
  { id: "adgrp_a1", title: "US 25-44 · purchase", status: "active", delivery_status: "active", spend: 420, results: 60, cost_per_result: 7, return_on_ad_spend: 3.1, created_at: "2026-09-10T00:00:00Z" },
  { id: "adgrp_b1", title: "lal 1%", status: "active", delivery_status: "learning", spend: 90, results: 4, cost_per_result: 22.5, created_at: "2026-09-20T00:00:00Z" },
  { id: "adgrp_c1", title: "lal 3%", status: "active", delivery_status: "active", spend: 600, results: 55, cost_per_result: 18.5, return_on_ad_spend: 0.4, created_at: "2026-09-05T00:00:00Z" },
  { id: "adgrp_d1", title: "broad", status: "active", delivery_status: "issues", spend: 0, results: 0, created_at: "2026-09-19T00:00:00Z" },
];
export const RANK = { campaignId: "adcamp_x1", campaign: { id: "adcamp_x1", title: "Launch · Hypermotion", status: "active" }, groups: parseEnvelope(JSON.stringify({ ok: true, data: { data: RANK_GROUPS, page_info: { start_cursor: null, end_cursor: null, has_next_page: false, has_previous_page: false } }, meta: { command: "ad-groups list", duration: "1ms" } })), target: 8, currency: "usd", accountTitle: "Hypermotion", accountId: "biz_VraUMckluH8dzV", now: LAUNCH_NOW.getTime(), commands: [["ad-campaigns", "get", "adcamp_x1"], ["ad-groups", "list", "--ad_campaign_id", "adcamp_x1", "--order", "cost_per_result", "--direction", "asc"]] };

const MONEY_COMMANDS = [["ledgers", "report", "--report_type", "balance_summary", "--currency", "usd"], ["payouts", "methods", "--include_limits"], ["payouts", "list", "--first", "5"], ["accounts", "reserves"], ["verifications", "list"]];
export const MONEY = { accountTitle: "Frame", accountId: "biz_VraUMckluH8dzV", balances: [balanceOf("usd", envelope("ledgers.report"))], methods: envelope("payouts.methods.limits"), payouts: envelope("payouts.list"), reserves: envelope("accounts.reserves"), verifications: envelope("verifications.list"), now: LAUNCH_NOW.getTime(), commands: MONEY_COMMANDS };
const READY_PAYOUTS = parseEnvelope(JSON.stringify({ ok: true, data: { data: [{ id: "wdrl_x1", amount: "500.00", currency: "usd", status: "completed", speed: "standard", created_at: "2026-09-01T12:00:00Z" }, { id: "wdrl_x2", amount: "120.00", currency: "usd", status: "processing", speed: "standard", created_at: "2026-09-20T12:00:00Z" }], page_info: { start_cursor: null, end_cursor: null, has_next_page: false, has_previous_page: false } }, meta: { command: "payouts list", duration: "1ms" } }));
export const MONEY_READY = { ...MONEY, accountTitle: "Hypermotion", balances: [{ currency: "usd", available: 1234.56, other: [{ category: "pending", amount: 40 }] }, { currency: "eur", available: 80, other: [] }], methods: envelope("payouts.methods.ready"), payouts: READY_PAYOUTS };
const CLOSE_ARGV = ["money", "close", "--keep", "100", "--idempotency-key", "5b2c1d6e-0000-4000-8000-000000000004"];
export const CLOSE_BLOCKED = buildClose(CLOSE_ARGV, parseCloseArgs(CLOSE_ARGV).opts!, { balance: balanceOf("usd", envelope("ledgers.report")), methods: envelope("payouts.methods.limits"), accountId: "biz_VraUMckluH8dzV", accountTitle: "Frame", cap: 500, now: LAUNCH_NOW });
export const CLOSE_READY = buildClose(CLOSE_ARGV, parseCloseArgs(CLOSE_ARGV).opts!, { balance: { currency: "usd", available: 1234.56, other: [{ category: "pending", amount: 40 }] }, methods: envelope("payouts.methods.ready"), accountId: "biz_VraUMckluH8dzV", accountTitle: "Hypermotion", cap: 2000, now: LAUNCH_NOW });

const LOOKUP_DISPUTES = parseEnvelope(JSON.stringify({ ok: true, data: { data: [record0("disputes.get")], page_info: { start_cursor: null, end_cursor: null, has_next_page: false, has_previous_page: false } }, meta: { command: "disputes list", duration: "1ms" } }));
const LOOKUP_CASES = parseEnvelope(JSON.stringify({ ok: true, data: { data: [], page_info: { start_cursor: null, end_cursor: null, has_next_page: false, has_previous_page: false } }, meta: { command: "resolution-center-cases list", duration: "1ms" } }));
const PERSON0 = (() => { const p = envelope("people.list"); return p.ok && p.payload.kind === "page" ? p.payload.rows[1] ?? p.payload.rows[0] : {}; })();
const MEMBER0 = (() => { const p = envelope("members.list"); return p.ok && p.payload.kind === "page" ? p.payload.rows[0] : {}; })();
export const LOOKUP = { key: "ada@example.com", kind: "email" as const, accountTitle: "Hypermotion", accountId: "biz_VraUMckluH8dzV", user: { id: "user_3meX572iT5dAg", name: "Ada Customer", username: "adacustomer", email: "ada@example.com" }, person: PERSON0, member: MEMBER0, memberships: envelope("memberships.list"), payments: envelope("payments.list"), disputes: LOOKUP_DISPUTES, cases: LOOKUP_CASES, now: LAUNCH_NOW.getTime(), commands: [["people", "list", "--email", "ada@example.com"], ["memberships", "list", "--user_id", "user_3meX572iT5dAg"], ["payments", "list", "--user_id", "user_3meX572iT5dAg", "--first", "10"], ["disputes", "list", "--first", "50"], ["resolution-center-cases", "list", "--user_id", "user_3meX572iT5dAg"]] };
const REFUND_ARGV = ["support", "refund", "pay_JFHAhioMdPL1ts", "--idempotency-key", "5b2c1d6e-0000-4000-8000-000000000005"];
export const REFUND_READY = buildRefund(REFUND_ARGV, parseRefundArgs(REFUND_ARGV).opts!, { payment: record0("payments.get"), accountId: "biz_VraUMckluH8dzV", accountTitle: "Hypermotion" });
const DISPUTE_ARGV = ["support", "dispute", "dsp_x1", "--evidence", "file_x1:digital_fulfillment,file_x2:customer_order_history", "--idempotency-key", "5b2c1d6e-0000-4000-8000-000000000006"];
export const DISPUTE_READY = buildDispute(DISPUTE_ARGV, parseDisputeArgs(DISPUTE_ARGV).opts!, { dispute: record0("disputes.get"), accountId: "biz_VraUMckluH8dzV", accountTitle: "Hypermotion", now: LAUNCH_NOW.getTime() });
export const DISPUTE_LATE = buildDispute(DISPUTE_ARGV, parseDisputeArgs(DISPUTE_ARGV).opts!, { dispute: record0("disputes.get"), accountId: "biz_VraUMckluH8dzV", accountTitle: "Hypermotion", now: Date.parse("2026-09-25T12:00:00Z") });

export const synth = (data: unknown) => parseEnvelope(JSON.stringify({ ok: true, data, meta: { command: "synthetic", duration: "1ms" } }));
export const synthPage = (rows: unknown[]) => synth({ data: rows, page_info: { start_cursor: null, end_cursor: null, has_next_page: false, has_previous_page: false } });

const DEV_APP = (() => { const p = envelope("apps.list"); return p.ok && p.payload.kind === "page" ? p.payload.rows[0] : {}; })();
const DEV_COMMANDS = [["apps", "list"], ["auth", "list"], ["webhooks", "list", "--include_app_webhooks", "true"], ["app-builds", "list", "--app_id", "app_HKnLpw6UGGEqk6"], ["domains", "list", "--app_id", "app_HKnLpw6UGGEqk6"]];
export const DEV = { accountTitle: "Frame", accountId: "biz_VraUMckluH8dzV", apps: envelope("apps.list"), app: DEV_APP, builds: synthPage([]), domains: synthPage([]), webhooks: envelope("error.webhooks_oauth"), errors: envelope("apps.logs"), profiles: envelope("auth.list"), permissions: envelope("permissions.check"), now: LAUNCH_NOW.getTime(), commands: DEV_COMMANDS };
const DEV_PROFILES = synth({ active: "prod-key", profiles: [{ name: "prod-key", method: "api_key" }] });
const DEV_GRANTED = synthPage([{ action: "developer:manage_webhook", granted: true }]);
export const DEV_READY = { ...DEV, accountTitle: "Hypermotion", app: { ...DEV_APP, name: "Hypermotion", status: "live", hosted_url: "https://hypermotion.whop.site", verified: true }, builds: synthPage([{ id: "apbd_x1", platform: "web", status: "approved", is_production: true, created_at: "2026-09-19T10:00:00Z" }, { id: "apbd_x2", platform: "web", status: "pending", is_production: false, created_at: "2026-09-21T09:00:00Z" }]), domains: synthPage([{ id: "dom_x1", domain: "app.hypermotion.art", status: "active", dns_status: "verified", certificate_status: "active", last_checked_at: "2026-09-21T11:00:00Z" }, { id: "dom_x2", domain: "shop.hypermotion.art", status: "pending_verification", dns_status: "pending", certificate_status: "pending", last_checked_at: "2026-09-21T11:00:00Z" }]), webhooks: synthPage([{ id: "hook_x1", url: "https://hypermotion.art/hooks", enabled: true, events: ["payment.succeeded", "membership.activated"], consecutive_failures: 0 }, { id: "hook_x2", url: "https://staging.hypermotion.art/hooks", enabled: false, disabled_reason: "consecutive_failures", events: ["payment.succeeded"], consecutive_failures: 12, failing_since: "2026-09-18T00:00:00Z" }]), errors: synthPage([{ level: "error", message: "boom" }, { level: "error", message: "boom again" }]), profiles: DEV_PROFILES, permissions: DEV_GRANTED };
const HOOK_ARGV = ["dev", "hook", "https://hypermotion.art/hooks/v2", "--idempotency-key", "5b2c1d6e-0000-4000-8000-000000000007"];
export const HOOK_READY = buildHook(HOOK_ARGV, parseHookArgs(HOOK_ARGV).opts!, { profiles: DEV_PROFILES, permissions: DEV_GRANTED, webhooks: DEV_READY.webhooks, accountId: "biz_VraUMckluH8dzV", accountTitle: "Hypermotion" });
export const HOOK_BLOCKED = buildHook(HOOK_ARGV, parseHookArgs(HOOK_ARGV).opts!, { profiles: envelope("auth.list"), permissions: envelope("permissions.check"), webhooks: envelope("error.webhooks_oauth"), accountId: "biz_VraUMckluH8dzV", accountTitle: "Frame" });


const DOCTOR_COMMANDS = [
  ["auth", "status"],
  ["auth", "list"],
  ["permissions", "check", "--resource_id", "biz_VraUMckluH8dzV", "--actions", DOCTOR_ACTIONS.join(",")],
  ["verifications", "list"],
  ["payouts", "methods", "--include_limits"],
  ["people", "list", "--first", "100"],
  ["social-accounts", "list"],
  ["accounts", "preferences"],
  ["products", "list"],
  ["webhooks", "list"],
];

/** The real account as recorded: identity unverified, oauth login, nothing connected. */
export const DOCTOR: DoctorInput = {
  accountTitle: "Frame",
  accountId: "biz_VraUMckluH8dzV",
  auth: envelope("auth.status"),
  profiles: envelope("auth.list"),
  permissions: envelope("permissions.check"),
  verifications: envelope("verifications.list"),
  methods: envelope("payouts.methods.limits"),
  people: envelope("people.list"),
  social: envelope("social-accounts.list"),
  preferences: envelope("accounts.preferences"),
  products: envelope("products.list"),
  webhooks: envelope("error.webhooks_oauth"),
  deliveries: {},
  commands: DOCTOR_COMMANDS,
};

/** The same account with everything done. Shapes follow the API reference for what this account cannot record. */
export const DOCTOR_READY: DoctorInput = {
  ...DOCTOR,
  profiles: synth({ active: "prod", profiles: [{ name: "prod", method: "api_key", accountId: "biz_VraUMckluH8dzV", accountTitle: "Frame" }] }),
  permissions: synthPage(DOCTOR_ACTIONS.map((action) => ({ action, granted: true }))),
  verifications: synth({ data: [{ id: "ver_x1AbCdEfGh", status: "verified", last_error_code: null, last_error_reason: null }] }),
  methods: synth({ data: [{ id: "potk_x1", nickname: "Chase checking" }], page_info: { start_cursor: null, end_cursor: null, has_next_page: false, has_previous_page: false }, limits: { object: "payout_limit", currency: "usd", standard: { max_amount: 1000, daily_amount_remaining: 9999 }, instant: { max_amount: 250 } } }),
  people: synthPage([{ id: "prsn_x1AbCdEfGh", first_source: "whop:adcamp_x1:*", last_source: "direct" }, { id: "prsn_x2AbCdEfGh", first_source: null, last_source: null }]),
  social: synthPage([{ id: "sacc_x1AbCdEfGh", name: "Hypermotion", platform: "facebook", username: "hypermotion", error: null }]),
  preferences: synth({ ads_payment_methods: [{ id: "pm_x1AbCdEfGh", brand: "visa", last4: "4242" }], economic_intelligence: true }),
  webhooks: synthPage([{ id: "hook_x1AbCdEfGh", url: "https://hypermotion.art/hooks", enabled: true, events: ["payment.succeeded"] }]),
  deliveries: { hook_x1AbCdEfGh: synthPage([{ id: "whd_x1AbCdEfGh", event: "payment.succeeded", success: true, response_code: 200, total_time: 0.21, sent_at: "2026-09-18T09:00:00Z" }, { id: "whd_x2AbCdEfGh", event: "payment.succeeded", success: false, response_code: 500, total_time: 1.2, sent_at: "2026-09-17T09:00:00Z" }]) },
  commands: [...DOCTOR_COMMANDS, ["webhooks", "deliveries", "hook_x1AbCdEfGh", "--first", "20"]],
};

const CONFIG_PATH = "~/.config/whop-view/config.json";

/** Delivery attempts in the API reference's `WebhookDelivery` shape, newest first. An oauth login cannot record them. */
export const DELIVERIES: Rec[] = [
  { id: "whd_x1AbCdEfGh", event: "payment.succeeded", success: true, response_code: 200, total_time: 0.21, sent_at: "2026-09-18T09:00:00Z", replayed_from: null, resource_id: "biz_VraUMckluH8dzV", request_body: { type: "payment.succeeded" }, response_body: { ok: true } },
  { id: "whd_x2AbCdEfGh", event: "membership.activated", success: false, response_code: 500, total_time: 1.2, sent_at: "2026-09-17T09:00:00Z", replayed_from: null, resource_id: "biz_VraUMckluH8dzV", request_body: { type: "membership.activated" }, response_body: { error: "non_json", raw_body: "<html><body>Internal Server Error</body></html>" } },
  { id: "whd_x3AbCdEfGh", event: "membership.activated", success: true, response_code: 200, total_time: 0.34, sent_at: "2026-09-17T09:05:00Z", replayed_from: "whd_x2AbCdEfGh", resource_id: "biz_VraUMckluH8dzV", request_body: { type: "membership.activated" }, response_body: null },
];

/** Log entries as the API reference shapes them, newest first, since this account's app has none yet. */
export const LOG_ROWS: Rec[] = [
  { app_id: "app_HKnLpw6UGGEqk6", app_build_id: "abld_x1AbCdEfGh", request_id: "req_4", created_at: "2026-09-18T09:00:05.000Z", source: "request", level: "warn", message: "slow response", request_method: "POST", request_path: "/api/checkout", response_status: 200, wall_time_ms: 2400, cpu_time_ms: 40, truncated: true },
  { app_id: "app_HKnLpw6UGGEqk6", app_build_id: "abld_x1AbCdEfGh", request_id: "req_3", created_at: "2026-09-18T09:00:02.500Z", source: "console", level: "debug", message: "cache miss for user_ICLAwIXM9zFfz", request_method: null, request_path: null, response_status: null },
  { app_id: "app_HKnLpw6UGGEqk6", app_build_id: "abld_x1AbCdEfGh", request_id: "req_2", created_at: "2026-09-18T09:00:02.000Z", source: "exception", level: "error", message: "TypeError: Cannot read properties of undefined (reading 'slotId')", outcome: "exception", request_method: "GET", request_path: "/api/slots", response_status: 500, stack: "at handler (app.js:12)" },
  { app_id: "app_HKnLpw6UGGEqk6", app_build_id: "abld_x1AbCdEfGh", request_id: "req_1", created_at: "2026-09-18T09:00:01.000Z", source: "console", level: "info", message: "booted", request_method: null, request_path: null, response_status: null },
];

export const SCENES: Record<string, (t: Theme) => string[]> = {
  "sandbox.status": (t) => sandboxStatusView({ url: "https://sandbox-api.whop.com/api/v1", urlSource: "default", key: "whop_sandbox_key_abcdef1234", keySource: "config", configPath: CONFIG_PATH, account: synth({ id: "biz_sandboxAb12", title: "Frame (sandbox)", route: "frame-sandbox" }) }, t),
  "sandbox.status.nokey": (t) => sandboxStatusView({ url: "https://sandbox-api.whop.com/api/v1", urlSource: "default", keySource: "none", configPath: CONFIG_PATH, account: envelope("error.sandbox_oauth") }, t),
  "sandbox.status.badkey": (t) => sandboxStatusView({ url: "http://localhost:9", urlSource: "env", key: "whop_wrong_key_abcdef1234", keySource: "env", configPath: CONFIG_PATH, account: envelope("error.sandbox_oauth") }, t),
  "sandbox.missing_key": (t) => sandboxMissingKeyView(CONFIG_PATH, t),
  "license.valid": (t) => licenseView({ key: "mem_kfT4Jl8Pb8DlWE", membership: envelope("memberships.get"), argv: ["memberships", "get", "mem_kfT4Jl8Pb8DlWE"] }, t),
  "license.renewing": (t) => licenseView({ key: "A1B2C3D4-E5F6G7H8-I9J0K1L2-M3N4O5P6", membership: synth({ id: "mem_x1AbCdEfGh", status: "active", license_key: "A1B2C3D4-E5F6G7H8-I9J0K1L2-M3N4O5P6", product: { id: "prod_iQ2Zub6GFQS5Q", title: "Hypermotion" }, plan: { id: "plan_ozEZmitgc8tjB", title: "Creator — 1,000 credits" }, current_period_end: "2026-10-14T12:00:00Z", cancel_at_period_end: true, member: { id: "mber_x1AbCdEfGh", user: { id: "user_3meX572iT5dAg", username: "adacustomer" } } }), argv: ["memberships", "get", "A1B2C3D4-E5F6G7H8-I9J0K1L2-M3N4O5P6"] }, t),
  "license.expired": (t) => licenseView({ key: "A1B2C3D4-E5F6G7H8-I9J0K1L2-M3N4O5P6", membership: synth({ id: "mem_x1AbCdEfGh", status: "expired", product_id: "prod_iQ2Zub6GFQS5Q", plan_id: "plan_ozEZmitgc8tjB", current_period_end: "2026-09-01T12:00:00Z", user_id: "user_3meX572iT5dAg" }), argv: ["memberships", "get", "A1B2C3D4-E5F6G7H8-I9J0K1L2-M3N4O5P6"] }, t),
  "license.invalid": (t) => licenseView({ key: "ABCD-1234-EFGH-5678", membership: envelope("error.license_404"), argv: ["memberships", "get", "ABCD-1234-EFGH-5678"] }, t),
  "list.deliveries": (t) => listView({ group: "webhooks", argv: ["webhooks", "deliveries", "hook_x1AbCdEfGh"], rows: DELIVERIES, page: { start_cursor: null, end_cursor: null, has_next_page: false, has_previous_page: false }, hints: hintsFor("webhooks", "deliveries"), noun: "deliveries" }, t),
  "webhook.test": (t) => webhookTestView({ argv: ["webhooks", "test", "hook_x1AbCdEfGh", "--event", "payment.succeeded"], result: { status: 200, body: "OK", success: true }, delivery: synthPage([DELIVERIES[0]]), deliveryArgv: ["webhooks", "deliveries", "hook_x1AbCdEfGh", "--first", "1"] }, t),
  "webhook.test.failed": (t) => webhookTestView({ argv: ["webhooks", "test", "hook_x1AbCdEfGh", "--event", "membership.activated"], result: { status: 500, body: { error: "non_json", raw_body: "<html><body>Internal Server Error</body></html>" }, success: false }, delivery: synthPage([DELIVERIES[1]]), deliveryArgv: ["webhooks", "deliveries", "hook_x1AbCdEfGh", "--first", "1"] }, t),
  "webhook.test.no_scope": (t) => webhookTestView({ argv: ["webhooks", "test", "hook_x1AbCdEfGh", "--event", "payment.succeeded"], result: { status: 200, body: "OK", success: true }, delivery: envelope("error.webhooks_oauth"), deliveryArgv: ["webhooks", "deliveries", "hook_x1AbCdEfGh", "--first", "1"] }, t),
  "logs.page": (t) => logsView({ argv: ["apps", "logs", "app_HKnLpw6UGGEqk6", "--level", "error"], rows: LOG_ROWS, page: { start_cursor: "c0", end_cursor: "c1", has_next_page: true, has_previous_page: false } }, t),
  "logs.empty": (t) => {
    const p = envelope("apps.logs");
    if (!p.ok || p.payload.kind !== "page") throw new Error("apps.logs is not a page");
    return logsView({ argv: ["apps", "logs", "app_HKnLpw6UGGEqk6"], rows: p.payload.rows, page: p.payload.page }, t);
  },
  "logs.follow": (t) => [...followHeader(["apps", "logs", "app_HKnLpw6UGGEqk6", "--level", "error", "--query", "slot"], 3, t), ...LOG_ROWS.slice().reverse().flatMap((r) => logLines(r, t)), ...followStopped(4, t)],
  "error.events_range": (t) => errorView({ code: "EVENTS_RANGE", message: "Time range cannot exceed 30 days\n62 days from 2026-07-01T00:00:00Z to 2026-09-01T00:00:00Z. Try --last 30d, or move --from and --to closer together." }, t),
  "error.bad_preset": (t) => errorView({ code: "BAD_PRESET", message: "--last week is not a date preset.\nPresets: --last 7d, --last 30d, --last 90d, --this month, --last month." }, t),
  "error.sandbox_auth": (t) => errorView({ code: "SANDBOX_AUTH", message: "The sandbox host answered 401 to the key whop_wro…1234. It is not a sandbox key, or it was revoked.", durationMs: 500 }, t),
  doctor: (t) => doctorView(DOCTOR, t),
  "doctor.ready": (t) => doctorView(DOCTOR_READY, t),
  "doctor.signed_out": (t) => doctorView({ ...DOCTOR, accountTitle: undefined, accountId: undefined, permissions: undefined, auth: synth({ loggedIn: false }), profiles: synth({ active: null, profiles: [] }), webhooks: envelope("error.webhooks_oauth") }, t),
  gtm: (t) => gtmView(GTM, t),
  "adplan.ads.nested": (t) => adPlanView(AD_PLAN, t),
  "adplan.ads.plan_only": (t) => adPlanView({ ...AD_PLAN, planOnly: true, cap: undefined, timeoutSeconds: undefined }, t),
  "adplan.ads.no_page": (t) => adPlanView({ ...AD_PLAN, social: [], paysFrom: undefined, reach: { error: "No Meta ad account available for reach estimates" } }, t),
  "adplan.ads.existing_group": (t) =>
    adPlanView(
      {
        ...AD_PLAN,
        argv: ["ads", "create", "--title", "Frame · launch v2", "--url", "https://hypermotion.art/frame", "--ad_group_id", "adgrp_x1", "--headlines", '["Frame is live"]'],
        tree: { ...AD_PLAN.tree, group: { id: "adgrp_x1", isNew: false, rec: { ...JSON.parse(AD_GROUP_JSON), id: "adgrp_x1", status: "active", ends_at: "2026-10-05T00:00:00Z" } }, ad: { isNew: true, rec: { title: "Frame · launch v2", url: "https://hypermotion.art/frame", headlines: ["Frame is live"] } } },
        budget: { amount: 40, type: "daily", owner: "group", typed: false, endsAt: "2026-10-05T00:00:00Z" },
        cap: undefined,
        timeoutSeconds: undefined,
      },
      t,
    ),
  "adplan.campaign.create": (t) =>
    adPlanView(
      {
        group: "ad-campaigns",
        verb: "create",
        argv: ["ad-campaigns", "create", "--title", "Frame launch", "--platform", "meta", "--objective", "sales", "--budget_optimization", "ad_group"],
        tree: { campaign: { isNew: true, rec: { title: "Frame launch", platform: "meta", objective: "sales", budget_optimization: "ad_group" } } },
        social: AD_PLAN.social,
        paysFrom: AD_PLAN.paysFrom,
        currency: "usd",
        accountTitle: "Hypermotion",
        accountId: "biz_VraUMckluH8dzV",
      },
      t,
    ),
  "adplan.group.over_cap": (t) =>
    adRefusedView(
      {
        group: "ad-groups",
        verb: "create",
        argv: ["ad-groups", "create", "--ad_campaign_id", "adcamp_x1", "--title", "US broad", "--budget_amount", "120", "--budget_type", "daily", "--optimization_goal", "conversions", "--conversion_event", "purchase", "--regions", '{"include":{"countries":["US"]}}'],
        tree: { campaign: AD_PLAN.tree.campaign, group: { isNew: true, rec: { title: "US broad", budget_amount: 120, budget_type: "daily", optimization_goal: "conversions", conversion_event: "purchase", regions: { include: { countries: ["US"] } } } } },
        budget: { amount: 120, type: "daily", owner: "group", typed: true },
        reach: { lower: 210_000_000, upper: 250_000_000 },
        social: AD_PLAN.social,
        paysFrom: AD_PLAN.paysFrom,
        balance: AD_PLAN.balance,
        currency: "usd",
        accountTitle: "Hypermotion",
        accountId: "biz_VraUMckluH8dzV",
        cap: 500,
      },
      t,
    ),
  "adplan.ads.sandbox": (t) => adPlanView({ ...AD_PLAN, mode: "sandbox", cap: undefined, timeoutSeconds: undefined }, t),
  "list.products": (t) => page("products.list", "products", ["products", "list"], t, "Hypermotion"),
  "list.plans": (t) => page("plans.list", "plans", ["plans", "list"], t),
  "list.products.numbered": (t) => page("products.list", "products", ["products", "list"], t, "Hypermotion", undefined, true),
  "list.memberships": (t) => page("memberships.list", "memberships", ["memberships", "list"], t),
  "list.members": (t) => page("members.list", "members", ["members", "list"], t),
  "list.ledgers": (t) => page("ledgers.list", "ledgers", ["ledgers", "list"], t),
  "list.apps": (t) => page("apps.list", "apps", ["apps", "list"], t),
  "list.payments": (t) => page("payments.list", "payments", ["payments", "list"], t),
  "list.stats": (t) => page("stats.list", "stats", ["stats", "list"], t),
  "list.empty": (t) => page("payouts.list", "payouts", ["payouts", "list"], t, undefined, true),
  "list.empty.nocreate": (t) => page("refunds.list", "refunds", ["refunds", "list"], t, undefined, false),
  "list.reserves": (t) => page("accounts.reserves", "accounts", ["accounts", "reserves"], t, undefined, undefined, undefined, "reserves"),
  "list.methods": (t) => page("payouts.methods", "payouts", ["payouts", "methods"], t, undefined, undefined, undefined, "methods"),
  "summary.disputes": (t) => summary("disputes.summary", ["disputes", "summary"], t),
  "summary.cases": (t) => summary("resolution-center-cases.summary", ["resolution-center-cases", "summary"], t),
  "detail.membership": (t) => record("memberships.get", "memberships", ["memberships", "get", "mem_kfT4Jl8Pb8DlWE"], t),
  "detail.product": (t) => record("products.get", "products", ["products", "get", "prod_iQ2Zub6GFQS5Q"], t),
  "confirm.payout": (t) => confirmView({ ...PAYOUT, destination: "Chase checking ••••4242  potk_x1", balance: { available: 418.56, currency: "usd" }, cap: 500, limit: { speed: "standard", max: 1000, dailyRemaining: 9999 }, timeoutSeconds: 120 }, t),
  "confirm.payout.whop_blocked": (t) =>
    refusedView({ ...PAYOUT, argv: ["payouts", "create", "--amount", "10", "--payout_method_id", "potk_x1"], reason: "whop", balance: { available: 18.56, currency: "usd" }, cap: 500, limit: { speed: "standard", max: 0, code: "kyc_completed", message: "Please complete identity verification before requesting a withdrawal." } }, t),
  "confirm.payout.unknown_method": (t) => confirmView({ ...PAYOUT, balance: { available: 418.56, currency: "usd" }, cap: null, timeoutSeconds: 120 }, t),
  "confirm.payout.sandbox": (t) => confirmView({ ...PAYOUT, mode: "sandbox", destination: "Chase checking ••••4242  potk_x1", balance: { available: 418.56, currency: "usd" } }, t),
  "confirm.payout.over_cap": (t) => refusedView({ ...PAYOUT, argv: ["payouts", "create", "--amount", "2000", "--currency", "usd", "--payout_method_id", "potk_x1"], reason: "cap", destination: "Chase checking ••••4242  potk_x1", balance: { available: 2418.56, currency: "usd" }, cap: 500 }, t),
  "confirm.payout.over_balance": (t) => refusedView({ ...PAYOUT, reason: "balance", destination: "Chase checking ••••4242  potk_x1", balance: { available: 18.56, currency: "usd" }, cap: 500 }, t),
  dev: (t) => devView(DEV, t),
  "dev.ready": (t) => devView(DEV_READY, t),
  "hook.ready": (t) => recipeView(HOOK_READY, t),
  "hook.blocked": (t) => recipeView(HOOK_BLOCKED, t),
  "support.lookup": (t) => lookupView(LOOKUP, t),
  "support.lookup.miss": (t) => lookupView({ ...LOOKUP, key: "nobody@example.com", user: undefined, person: undefined, member: undefined }, t),
  "refund.ready": (t) => recipeView(REFUND_READY, t),
  "dispute.ready": (t) => recipeView(DISPUTE_READY, t),
  "dispute.late": (t) => recipeView(DISPUTE_LATE, t),
  money: (t) => moneyView(MONEY, t),
  "money.ready": (t) => moneyView(MONEY_READY, t),
  "close.blocked": (t) => recipeView(CLOSE_BLOCKED, t),
  "close.ready": (t) => recipeView(CLOSE_READY, t),
  "winback.ready": (t) => recipeView(WINBACK_READY, t),
  rank: (t) => rankView(RANK, t),
  "rank.no_target": (t) => rankView({ ...RANK, target: undefined }, t),
  "launch.blocked": (t) => launchView(LAUNCH_BLOCKED, t),
  "launch.ready": (t) => launchView(LAUNCH_READY, t),
  "launch.plan_only": (t) => launchView(LAUNCH_READY, t, { planOnly: true }),
  "launch.done": (t) => launchDoneView(LAUNCH_READY, { promo: { id: "promo_x1", code: "LAUNCH20", status: "active" }, checkout: { id: "chk_x1", purchase_url: "https://whop.com/checkout/chk_x1" }, campaign: { id: "adcamp_x1", status: "paused" }, ad: { id: "ad_x1", status: "in_review" } }, undefined, t),
  "launch.stopped": (t) => launchDoneView(LAUNCH_READY, { promo: { id: "promo_x1", code: "LAUNCH20", status: "active" }, checkout: { id: "chk_x1", purchase_url: "https://whop.com/checkout/chk_x1" } }, { step: "campaign", message: "No ads payment method" }, t),
  "confirm.update.diff": (t) => {
    const rec = record0("products.get");
    const argv = ["products", "update", "prod_iQ2Zub6GFQS5Q", "--title", "Hypermotion Pro", "--headline", "Words, into motion.", "--idempotency-key", "5b2c1d6e-0000-4000-8000-000000000001"];
    return confirmView({ group: "products", verb: "update", argv, hints: hintsFor("products", "update"), accountTitle: "Hypermotion", accountId: "biz_VraUMckluH8dzV", current: currentSummary(rec), changes: changesFor("update", argv, rec) }, t);
  },
  "confirm.unpublish": (t) => {
    const rec = record0("products.get");
    const argv = ["products", "unpublish", "prod_iQ2Zub6GFQS5Q"];
    return confirmView({ group: "products", verb: "unpublish", argv, hints: hintsFor("products", "unpublish"), accountTitle: "Hypermotion", accountId: "biz_VraUMckluH8dzV", current: currentSummary(rec), changes: changesFor("unpublish", argv, rec) }, t);
  },
  "confirm.delete.diff": (t) => {
    const rec = record0("products.get");
    const argv = ["products", "delete", "prod_iQ2Zub6GFQS5Q"];
    return confirmView({ group: "products", verb: "delete", argv, hints: hintsFor("products", "delete"), accountTitle: "Hypermotion", accountId: "biz_VraUMckluH8dzV", current: currentSummary(rec), changes: changesFor("delete", argv, rec) }, t);
  },
  "confirm.assembled": (t) =>
    confirmView(
      {
        group: "webhooks",
        verb: "create",
        argv: assembleJson(["webhooks", "create", "--url", "https://hypermotion.art/hooks", "--events", "payment.succeeded", "--events", "membership.activated", "--api_version_date", "2026-09-15"]).argv,
        hints: hintsFor("webhooks"),
        accountTitle: "Hypermotion",
        accountId: "biz_VraUMckluH8dzV",
      },
      t,
    ),
  "confirm.update.quoted": (t) => confirmView({ group: "products", verb: "update", argv: ["products", "update", "prod_DQf7IZAtveRoK", "--title", "Frame Pro's \"beta\"", "--headline", "one; two && three"], hints: hintsFor("products") }, t),
  "confirm.delete": (t) => confirmView({ group: "products", verb: "delete", argv: ["products", "delete", "prod_DQf7IZAtveRoK"], hints: hintsFor("products"), accountTitle: "Hypermotion", accountId: "biz_VraUMckluH8dzV" }, t),
  "confirm.update": (t) => confirmView({ group: "products", verb: "update", argv: ["products", "update", "prod_DQf7IZAtveRoK", "--title", "Frame Pro", "--visibility", "hidden"], hints: hintsFor("products") }, t),
  "error.typo": (t) => error("error.typo", t),
  "error.404": (t) => error("error.404", t),
  "error.validation": (t) => error("error.validation", t),
  "error.unknown_flag": (t) => error("error.unknown_flag", t),
  "error.401": (t) => errorView({ code: "HTTP_401", message: "Unauthorized" }, t),
  "error.scope": (t) => errorView({ code: "HTTP_403", message: "Missing required permission: developer:manage_webhook" }, t),
  "error.enoent": (t) => errorView({ code: "ENOENT", message: "spawn whop ENOENT" }, t),
  "error.gated": (t) => error("error.gated", t),
  "error.experiments": (t) => error("error.experiments", t),
  "error.cards": (t) => error("error.cards", t),
  "error.cashback": (t) => error("error.cashback", t),
  "error.gated.unknown": (t) => errorView({ code: "HTTP_403", message: "You don't have access to Financing yet.", durationMs: 200 }, t),
  "detail.auth": (t) => record("auth.status", "auth", ["auth", "status"], t),
  "series.net_revenue": (t) => {
    const p = envelope("stats.net_revenue");
    if (!p.ok || p.payload.kind !== "series") throw new Error("stats.net_revenue is not a series");
    return seriesView({ argv: ["stats", "get", "net_revenue", "--from", "2026-09-12", "--to", "2026-09-18", "--interval", "day"], points: p.payload.points, currency: p.payload.currency }, t);
  },
  help: (t) => helpView(parseHelp(fixture("help.txt")), t),
  "help.products": (t) => helpView(parseHelp(fixture("help.products.txt")), t, "products"),
  home: (t) =>
    homeView(
      {
        auth: envelope("auth.status"),
        balance: envelope("ledgers.report"),
        revenue: envelope("stats.net_revenue"),
        from: "2026-09-12",
        to: "2026-09-18",
        commands: [
          ["auth", "status"],
          ["ledgers", "report", "--report_type", "balance_summary"],
          ["stats", "get", "net_revenue", "--from", "2026-09-12", "--to", "2026-09-18", "--interval", "day"],
        ],
        api: parseHelp(fixture("help.txt")).api,
      },
      t,
    ),
};

if (process.argv[1] === import.meta.filename) {
  const only = process.argv[2];
  const width = Number(process.argv[3] ?? 80);
  const t = theme(width, process.env.NO_COLOR === undefined);
  for (const [name, scene] of Object.entries(SCENES)) {
    if (only && !name.startsWith(only)) continue;
    console.log(`\n${"─".repeat(width)}\n ${name} @ ${width}\n${"─".repeat(width)}`);
    console.log(scene(t).join("\n"));
  }
}
