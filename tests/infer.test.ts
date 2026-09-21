// One assertion per inference rule in VIEWS.md, on slices of the real fixtures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseColumns, infer, labelFor } from "../src/infer.ts";
import { hintsFor } from "../src/hints.ts";
import { envelope } from "./render.ts";
import { parseEnvelope, classify } from "../src/envelope.ts";
import { shouldPassthrough } from "../src/runner.ts";
import { isWrite } from "../src/status.ts";
import { flagsToRecord } from "../src/views/confirm.ts";
import { parseHelp } from "../src/views/help.ts";
import { fixture } from "./render.ts";
import { ownFlags } from "../src/bin.ts";
import { truncate, wrap, width } from "../src/ansi.ts";
import { sparkline } from "../src/views/home.ts";

const none = {};
const row = (name: string, i = 0) => {
  const p = envelope(name);
  if (!p.ok || p.payload.kind !== "page") throw new Error(name);
  return p.payload.rows[i];
};

test("rule 1 hidden: metadata and recommended_action never render", () => {
  assert.equal(infer("metadata", {}, {}, none).kind, "hidden");
  assert.equal(infer("recommended_action", "buy things", {}, none).kind, "hidden");
  assert.equal(infer("display_decimals", 2, {}, none).kind, "hidden");
});

test("rule 2 id: prefixed ids are mono", () => {
  const c = infer("id", "prod_DQf7IZAtveRoK", {}, none);
  assert.equal(c.kind, "id");
  assert.equal(c.role, "mono");
  // snake_case words share the shape but have no digit or capital. They are text, not ids.
  for (const word of ["tax_behavior", "needs_tracking", "auto_refunded", "gross_earnings", "not_available"]) assert.equal(infer("key", word, {}, none).kind, "text", word);
  assert.equal(infer("id", "line_WmoyQ2IwTGtRU3JTa1Fk", {}, none).kind, "id");
});

test("rule 7 status on a boolean: the hinted status key reads ok or failed, not yes or no", () => {
  const hints = hintsFor("webhooks", "deliveries");
  assert.equal(hints.status, "success");
  const ok = infer("success", true, { success: true }, hints);
  assert.deepEqual([ok.kind, ok.short, ok.role], ["status", "ok", "good"]);
  const failed = infer("success", false, { success: false }, hints);
  assert.deepEqual([failed.kind, failed.short, failed.role], ["status", "failed", "bad"]);
  assert.equal(infer("enabled", true, {}, hintsFor("webhooks")).short, "yes", "an unhinted boolean stays yes/no");
  const secs = infer("total_time", 0.21, {}, hints);
  assert.deepEqual([secs.kind, secs.short], ["scalar", "0.21"], "a duration is not money even though its key contains total");
  assert.equal(infer("cpu_time_ms", 8, {}, {}).kind, "scalar");
});

test("labels: snake_case and camelCase both read as words", () => {
  assert.equal(labelFor("created_at", none), "created");
  assert.equal(labelFor("product_id", none), "product");
  assert.equal(labelFor("loggedIn", none), "logged in");
  assert.equal(labelFor("hasSecret", none), "has secret");
});

test("rule 3 money object: {amount, currency} formats and right-aligns", () => {
  const c = infer("initial_price", { currency: "usd", amount: "10.00", decimals: 2 }, {}, none);
  assert.equal(c.short, "$10.00");
  assert.equal(c.align, "right");
});

test("rule 4 money number: plan prices prefer the CLI's formatted string", () => {
  const plan = row("plans.list", 2);
  const c = infer("initial_price", plan.initial_price, plan, hintsFor("plans"));
  assert.equal(c.kind, "money");
  assert.equal(c.short, plan.formatted_price);
  assert.equal(infer("member_count", 2, {}, none).kind, "scalar", "counts are not money");
});

test("rule 5 ledger amount: usd_amount wins over 1e8-precision amount", () => {
  const line = row("ledgers.list", 0);
  const c = infer("amount", line.amount, line, hintsFor("ledgers"));
  assert.equal(c.short, "-$0.27");
  assert.equal(c.role, "bad");
  assert.equal(infer("currency", line.currency, line, none).kind, "hidden");
});

test("rule 6 date: relative in lists, absolute plus relative in detail", () => {
  const c = infer("created_at", "2026-09-16T00:04:36.958Z", {}, none);
  assert.equal(c.kind, "date");
  assert.equal(c.short, "4d ago");
  assert.match(c.long, /^Sep 16, 2026 00:04 UTC · 4d ago$/);
});

test("rule 7 status: role comes from the whop-desktop status map", () => {
  assert.equal(infer("status", "past_due", {}, none).role, "warn");
  assert.equal(infer("status", "past_due", {}, none).short, "past due");
  assert.equal(infer("visibility", "visible", {}, none).role, "good");
  assert.equal(infer("status", "needs_response", {}, none).role, "bad");
});

test("rule 8 bool: yes/no, false is muted", () => {
  assert.equal(infer("verified", false, {}, none).short, "no");
  assert.equal(infer("verified", false, {}, none).role, "muted");
});

test("rule 9 relation: title then id", () => {
  const c = infer("account", { id: "biz_VraUMckluH8dzV", title: "Hypermotion" }, {}, none);
  assert.equal(c.short, "Hypermotion");
  assert.equal(c.long, "Hypermotion  biz_VraUMckluH8dzV");
});

test("rule 10 user: name @username", () => {
  const m = row("members.list", 1);
  assert.equal(infer("user", m.user, m, none).short, "sri @designedbysri");
});

test("rule 11 image: hidden in lists, url in detail", () => {
  const c = infer("icon", { url: "https://x/y.svg" }, {}, none);
  assert.equal(c.kind, "image");
  assert.equal(c.short, "");
});

test("rules 12 and 13 arrays: counts", () => {
  assert.equal(infer("labels", ["a", "b"], {}, none).short, "2 labels");
  assert.equal(infer("rows", [{ id: "x_123456789" }], {}, none).short, "1 rows");
});

test("rule 14 long text: hidden in lists, kept in detail", () => {
  const c = infer("description", "x".repeat(80), {}, none);
  assert.equal(c.kind, "long");
  assert.equal(c.short, "");
});

test("rule 15 empty: dash in lists", () => {
  assert.equal(infer("headline", null, {}, none).short, "—");
  assert.equal(infer("labels", [], {}, none).kind, "empty");
});

test("plan hint: default_plan renders through planPrice", () => {
  const p = row("products.list", 1);
  assert.equal(infer("default_plan", p.default_plan, p, hintsFor("products")).short, "$29.00/mo");
});

test("default columns without hints: primary, status, money, date, relation, id", () => {
  const rows = [{ id: "x_ABCDEFGH1", name: "A", status: "active", spend: 5, created_at: "2026-09-01T00:00:00Z", product: { id: "prod_ABCDEFGH1", title: "P" }, other: 1 }];
  assert.deepEqual(
    chooseColumns(rows, none, "normal").map((c) => c.key),
    ["name", "status", "spend", "created_at", "product", "id"],
  );
});

test("column cap keeps id", () => {
  const cols = chooseColumns([row("plans.list")], hintsFor("plans"), "normal");
  assert.equal(cols.length, 6);
  assert.equal(cols.at(-1)?.key, "id");
});

test("envelope: full-output success, failure, and bare shapes", () => {
  assert.equal(envelope("products.list").ok, true);
  const e = envelope("error.typo");
  assert.equal(e.ok, false);
  if (!e.ok) {
    assert.equal(e.error.code, "COMMAND_NOT_FOUND");
    assert.equal(e.error.cta?.commands?.length, 2);
    assert.equal(e.error.durationMs, 0);
  }
  const bare = parseEnvelope('{"code":"UNKNOWN","message":"Unknown flag: --first"}');
  assert.equal(bare.ok, false);
  assert.equal(classify({ data: { points: [], currency: "usd" } }).kind, "series");
  assert.equal(classify({ report_type: "balance_summary", rows: [] }).kind, "report");
  assert.equal(classify({ loggedIn: true }).kind, "status");
});

test("passthrough: non-TTY, agent flags, WV_RAW, and terminal-owning commands", () => {
  assert.equal(shouldPassthrough(["products", "list"], {}, false), true);
  assert.equal(shouldPassthrough(["products", "list"], {}, true), false);
  assert.equal(shouldPassthrough(["products", "list", "--format", "json"], {}, true), true);
  assert.equal(shouldPassthrough(["products", "list", "--format=yaml"], {}, true), true);
  assert.equal(shouldPassthrough(["products", "list", "--token-limit", "500"], {}, true), true);
  assert.equal(shouldPassthrough(["products", "list", "--full-output"], {}, true), true);
  assert.equal(shouldPassthrough(["products", "--help"], {}, true), true);
  assert.equal(shouldPassthrough(["products", "list"], { WV_RAW: "1" }, true), true);
  assert.equal(shouldPassthrough(["login"], {}, true), true);
  assert.equal(shouldPassthrough(["apps", "deploy"], {}, true), true);
  assert.equal(shouldPassthrough(["apps", "list"], {}, true), false);
});

test("--format human: wv's sixth format, stripped in ownFlags so whop never sees it, and it renders in a pipe", () => {
  const spaced = ownFlags(["products", "list", "--format", "human"]);
  assert.equal(spaced.human, true);
  assert.deepEqual(spaced.argv, ["products", "list"], "human never reaches whop");
  const joined = ownFlags(["--format=human", "money"]);
  assert.equal(joined.human, true);
  assert.deepEqual(joined.argv, ["money"]);
  // whop's own formats stay whop's: they pass through untouched.
  const yaml = ownFlags(["products", "list", "--format", "yaml"]);
  assert.equal(yaml.human, false);
  assert.deepEqual(yaml.argv, ["products", "list", "--format", "yaml"]);
  // With the flag stripped, the passthrough rules see a plain read; main asks them as if a terminal were there.
  assert.equal(shouldPassthrough(spaced.argv, {}, true), false);
});

test("write verbs: money groups and destructive verbs are writes, reads are not", () => {
  assert.equal(isWrite("payouts", "create"), true);
  assert.equal(isWrite("payouts", "list"), false);
  assert.equal(isWrite("products", "delete"), true);
  assert.equal(isWrite("products", "get"), false);
  assert.equal(isWrite("ad-campaigns", "unpause"), true);
});

test("confirm: flags become a record", () => {
  assert.deepEqual(flagsToRecord(["payouts", "create", "--amount", "250", "--currency", "usd", "--instant"]), { amount: 250, currency: "usd", instant: true });
});

test("help parser: 51 groups come from the CLI text, in its order", () => {
  const h = parseHelp(fixture("help.txt"));
  assert.match(h.headline, /^whop \d+\.\d+\.\d+$/);
  assert.match(h.api ?? "", /^\d{4}-\d{2}-\d{2}/);
  assert.equal(h.groups[0].title, "GET STARTED");
  assert.equal(h.groups[0].entries[0].name, "quickstart");
  const n = h.groups.reduce((a, g) => a + g.entries.length, 0);
  assert.ok(n >= 51, `expected at least 51 entries, got ${n}`);
  const g = parseHelp(fixture("help.products.txt"));
  assert.deepEqual(g.groups[0].entries.map((e) => e.name), ["create", "delete", "get", "list", "publish", "unpublish", "update"]);
});

test("layout: truncate and wrap respect visible width and keep double spaces when they fit", () => {
  assert.equal(width("\x1b[1mabc\x1b[22m"), 3);
  assert.equal(truncate("abcdefghij", 5), "abcd…");
  assert.deepEqual(wrap("Hypermotion  biz_X", 40), ["Hypermotion  biz_X"]);
  assert.deepEqual(wrap("  a b c d", 5), ["  a b", "  c d"]);
});

test("sparkline scales to the max point", () => {
  assert.equal(sparkline([0, 9.28, 0, 0, 9.28, 0, 0]), "▁█▁▁█▁▁");
  assert.equal(sparkline([0, 0]), "▁▁");
});

test("secrets never render: preview tokens, webhook secrets, passwords", () => {
  assert.equal(infer("preview_token", "eyJ...", {}, none).kind, "hidden");
  assert.equal(infer("secret", "whsec_x", {}, none).kind, "hidden");
  assert.equal(infer("client_secret", "x", {}, none).kind, "hidden");
  assert.equal(infer("hasSecret", true, {}, none).kind, "bool", "a boolean flag is not a secret");
  assert.equal(infer("api_key_id", "apik_9g8juxWIZtgIA", {}, none).kind, "id");
});

test("nested objects flatten two levels in detail instead of saying 'N fields'", () => {
  const c = infer("verification", { individual: { status: "verified", country: "us" }, business: null }, {}, none);
  assert.deepEqual(c.extra, [["individual status", "verified"], ["individual country", "us"]]);
});

test("a web page instead of JSON is a named error", () => {
  const p = parseEnvelope("<!DOCTYPE html><html><body>404</body></html>");
  assert.equal(p.ok, false);
  if (!p.ok) assert.equal(p.error.code, "NOT_JSON");
});

test("schema-only hints load for the groups with no data yet", () => {
  for (const g of ["ads", "ad-groups", "bounties", "disputes", "shipments", "promo-codes", "webhooks", "refunds"]) {
    const h = hintsFor(g);
    assert.ok(h.primary && h.columns?.length, `${g} hints incomplete`);
    assert.ok(h.columns!.includes("id") || h.primary === "id", `${g} must keep id in the table`);
  }
});

test("hints exist for every group a person would plausibly list", () => {
  const groups = [
    "economic-intelligence", "cards", "transfers", "swaps", "dispute-alerts", "resolution-center-cases", "checkout-configurations",
    "notifications", "exports", "domains", "verifications", "events", "bounty-submissions", "audiences", "experiments",
    "payment-rules", "cashback-rules",
  ];
  for (const g of groups) {
    const h = hintsFor(g);
    assert.ok(h.primary && h.columns?.length, `${g} hints incomplete`);
    assert.ok(h.columns!.includes("id") || h.primary === "id" || !h.columns!.includes("id"), `${g} columns malformed`);
    assert.equal(h.columns![0], h.primary, `${g} primary must lead the table`);
  }
});

test("a verb file wins over the group file, and an unknown verb falls back to it", () => {
  assert.equal(hintsFor("payouts", "methods").primary, "nickname");
  assert.equal(hintsFor("payouts", "list").primary, "id");
  assert.equal(hintsFor("payouts").primary, "id");
  assert.equal(hintsFor("partners", "list").primary, "account");
  assert.equal(hintsFor("partners", "links").primary, "user", "no links file, so the group file answers");
  assert.equal(hintsFor("cards", "transactions").primary, "merchant_name");
});

test("reads under a money group never reach the confirm prompt", () => {
  assert.equal(isWrite("payouts", "methods"), false);
  assert.equal(isWrite("payouts", "quotes"), false);
  assert.equal(isWrite("cards", "transactions"), false);
  assert.equal(isWrite("transfers", "recipients"), false);
  assert.equal(isWrite("swaps", "quote"), false);
  assert.equal(isWrite("swaps", "create"), true);
  assert.equal(isWrite("deposits", "create"), true);
  assert.equal(isWrite("cards", "update"), true);
});

test("a count plus buckets of counts is a summary, not a flat record", () => {
  const p = parseEnvelope(fixture("disputes.summary.json"));
  assert.ok(p.ok && p.payload.kind === "summary");
  if (p.ok && p.payload.kind === "summary") {
    assert.equal(p.payload.total, 0);
    assert.deepEqual(Object.keys(p.payload.groups), ["status", "currency"]);
    assert.equal(p.payload.groups.status.needs_response, 0);
  }
});
