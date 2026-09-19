// One assertion per inference rule in VIEWS.md, on slices of the real fixtures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseColumns, infer } from "../src/infer.ts";
import { hintsFor } from "../src/hints.ts";
import { envelope } from "./render.ts";
import { parseEnvelope, classify } from "../src/envelope.ts";
import { shouldPassthrough } from "../src/runner.ts";
import { isWrite } from "../src/status.ts";
import { flagsToRecord } from "../src/views/confirm.ts";
import { parseHelp } from "../src/views/help.ts";
import { fixture } from "./render.ts";
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
  assert.equal(h.headline, "whop 0.16.3");
  assert.equal(h.api, "2026-08-25-2");
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
