// Proves wv is invisible to pipes and scripts. Hermetic: a fake `whop` on PATH replays fixtures.
// WV_LIVE=1 additionally compares against the real `whop`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURES, fixture } from "./render.ts";
import { mintApproval } from "../src/approve.ts";

const bin = join(import.meta.dirname, "..", "src", "bin.ts");
const node = process.execPath;

function fakeWhop(): string {
  const dir = mkdtempSync(join(tmpdir(), "wv-fake-"));
  const script = join(dir, "whop");
  // The shared stand-in, `tests/fake-whop.sh`, with the fixtures directory baked in.
  writeFileSync(script, readFileSync(join(import.meta.dirname, "fake-whop.sh"), "utf8").split("${WV_FAKE_FIXTURES}").join(FIXTURES));
  chmodSync(script, 0o755);
  return script;
}

// Hermetic: no real wv config, a fresh cache dir (so the fake whop answers --schema and --llms-full and the
// developer's cache is never read or written), no real sandbox variables from the developer's shell.
const wv = (args: string[], env: NodeJS.ProcessEnv = {}) =>
  spawnSync(node, ["--experimental-strip-types", "--no-warnings", bin, ...args], { encoding: "utf8", env: { ...process.env, WV_CONFIG: "/nonexistent/wv.json", XDG_CACHE_HOME: mkdtempSync(join(tmpdir(), "wv-cache-")), WV_SANDBOX_KEY: "", WV_SANDBOX_URL: "", WV_SANDBOX: "", ...env } });

test("piped stdout: wv emits whop's bytes untouched and keeps its exit code", () => {
  const fake = fakeWhop();
  const r = wv(["products", "list"], { WV_WHOP_BIN: fake });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, fixture("products.list.plain.txt"));
  assert.match(r.stderr, /^ARGS: products list$/m, "argv must reach whop unchanged");
});

test("piped stdout: --format json passes through without --full-output being added", () => {
  const fake = fakeWhop();
  const r = wv(["products", "list", "--format", "json"], { WV_WHOP_BIN: fake });
  assert.match(r.stderr, /^ARGS: products list --format json$/m);
});

test("piped stdout: --sandbox is stripped before the exec and the child sees the sandbox host and key", () => {
  const fake = fakeWhop();
  const r = wv(["--sandbox", "products", "list"], { WV_WHOP_BIN: fake, WV_SANDBOX_KEY: "whop_test", WHOP_API_BASE_URL: "", WHOP_API_KEY: "" });
  assert.equal(r.stdout, fixture("products.list.plain.txt"));
  assert.match(r.stderr, /^ARGS: products list$/m, "--sandbox must never reach whop");
  assert.match(r.stderr, /^BASE: https:\/\/sandbox-api\.whop\.com\/api\/v1 KEY: whop_test$/m);
  const plain = wv(["products", "list"], { WV_WHOP_BIN: fake, WHOP_API_BASE_URL: "", WHOP_API_KEY: "" });
  assert.match(plain.stderr, /^BASE: unset KEY: unset$/m, "production must not touch the host");
});

test("piped stdout: keys stay on their own side, from the shell and from the config file", () => {
  const fake = fakeWhop();
  const cfg = join(mkdtempSync(join(tmpdir(), "wv-cfg-")), "config.json");
  writeFileSync(cfg, JSON.stringify({ sandbox: { key: "whop_from_config" } }));
  // A production key in the shell never reaches the sandbox host.
  const stripped = wv(["--sandbox", "products", "list"], { WV_WHOP_BIN: fake, WHOP_API_BASE_URL: "", WHOP_API_KEY: "whop_live" });
  assert.match(stripped.stderr, /^BASE: https:\/\/sandbox-api\.whop\.com\/api\/v1 KEY: unset$/m);
  // The config's sandbox key reaches the sandbox host, and never production.
  const fromConfig = wv(["--sandbox", "products", "list"], { WV_WHOP_BIN: fake, WV_CONFIG: cfg, WHOP_API_BASE_URL: "", WHOP_API_KEY: "" });
  assert.match(fromConfig.stderr, /KEY: whop_from_config$/m);
  const prod = wv(["products", "list"], { WV_WHOP_BIN: fake, WV_CONFIG: cfg, WV_SANDBOX_KEY: "whop_env_sandbox", WHOP_API_BASE_URL: "", WHOP_API_KEY: "" });
  assert.match(prod.stderr, /^BASE: unset KEY: unset$/m, "neither the config key nor WV_SANDBOX_KEY may reach production");
  // A shell already pointed at the sandbox host is sandbox mode: the shell's key is dropped there too.
  const shell = wv(["products", "list"], { WV_WHOP_BIN: fake, WHOP_API_BASE_URL: "https://sandbox-api.whop.com/api/v1", WHOP_API_KEY: "whop_live" });
  assert.match(shell.stderr, /KEY: unset$/m);
});

test("piped stdout: whop's single failure code becomes one an agent can branch on, bytes untouched", () => {
  const fake = fakeWhop();
  const r = wv(["prodcts", "list"], { WV_WHOP_BIN: fake, WV_EXIT: "" });
  assert.equal(r.status, 5, "COMMAND_NOT_FOUND is 5");
  assert.equal(r.stdout, '{"code":"COMMAND_NOT_FOUND","message":"nope"}\n');
  const kept = wv(["prodcts", "list"], { WV_WHOP_BIN: fake, WV_EXIT: "whop" });
  assert.equal(kept.status, 1, "WV_EXIT=whop keeps whop's status");
  assert.equal(kept.stdout, r.stdout);
});

test("live: exit codes on the real whop", { skip: !process.env.WV_LIVE }, () => {
  assert.equal(wv(["stats", "get", "--format", "json"], { WV_EXIT: "" }).status, 3, "VALIDATION_ERROR");
  assert.equal(wv(["economic-intelligence", "list"], { WV_EXIT: "" }).status, 4, "HTTP_403");
  assert.equal(wv(["prodcts", "list"], { WV_EXIT: "" }).status, 5, "COMMAND_NOT_FOUND");
  assert.equal(wv(["products", "get", "prod_doesnotexist", "--format", "json"], { WV_EXIT: "" }).status, 5, "HTTP_404");
});

test("missing whop binary exits 127 with a one-line message", () => {
  const r = wv(["products", "list"], { WV_WHOP_BIN: "/nonexistent/whop" });
  assert.equal(r.status, 127);
  assert.match(r.stderr, /could not run/);
});

test("live: wv products list | cat is byte-identical to whop products list", { skip: !process.env.WV_LIVE }, () => {
  const real = spawnSync("whop", ["products", "list"], { encoding: "utf8" });
  const r = wv(["products", "list"]);
  assert.equal(r.stdout, real.stdout);
  assert.equal(r.status, real.status);
});

// The agent gate: a write in a pipe is gated like a write in a terminal, but the card is JSON and the
// prompt is exit 2 with `rerun`. Nothing below reaches the fake `whop` as a write unless the test says so.
const GROUP = '{"ad_campaign_id":"adcamp_x1","title":"US 25-44","budget_amount":40,"budget_type":"daily","optimization_goal":"conversions","conversion_event":"purchase","placements":"automatic","demographics":{"minimum_age":25,"maximum_age":44,"gender":"all"},"regions":{"include":{"countries":["US"]}}}';
const gateEnv = (extra: NodeJS.ProcessEnv = {}) => ({ WV_WHOP_BIN: fakeWhop(), WHOP_API_BASE_URL: "", WHOP_API_KEY: "", WV_PAYOUT_CAP: "", WV_AD_CAP: "", WV_RAW: "", WV_APPROVE_SECRET: "test-secret", ...extra });
const envelopeOf = (r: ReturnType<typeof wv>) => JSON.parse(r.stdout) as { ok: boolean; error?: { code: string; message: string; hint?: string }; plan?: Record<string, unknown>; rerun?: string[]; meta: { command: string; wrapper: string; mode: string } };
const wroteTo = (r: ReturnType<typeof wv>, cmd: string) => new RegExp(`^ARGS: ${cmd}`, "m").test(r.stderr);

test("agent gate: a write without --yes is CONFIRMATION_REQUIRED, exit 2, and whop never runs it", () => {
  const r = wv(["products", "update", "prod_1", "--title", "Frame Pro"], gateEnv());
  assert.equal(r.status, 2);
  const e = envelopeOf(r);
  assert.equal(e.ok, false);
  assert.equal(e.error?.code, "CONFIRMATION_REQUIRED");
  assert.deepEqual(e.rerun?.slice(0, 6), ["wv", "products", "update", "prod_1", "--title", "Frame Pro"]);
  assert.equal(e.rerun?.at(-2), "--approve");
  assert.match(e.rerun?.at(-1) ?? "", /^\d+\.[0-9a-f]{32}$/);
  assert.deepEqual(e.meta, { command: "products update", wrapper: "wv", mode: "production" });
  assert.equal(e.plan?.kind, "write");
  assert.equal(e.plan?.command, "whop products update prod_1 --title 'Frame Pro'");
  assert.deepEqual(e.plan?.account, { id: "biz_VraUMckluH8dzV", title: "Frame" });
  assert.ok(wroteTo(r, "auth status"), "identity is read");
  assert.equal(wroteTo(r, "products update"), false, "the write must not reach whop");
});

test("agent gate: --yes execs whop with the argv it expects, --yes stripped", () => {
  const r = wv(["products", "update", "prod_1", "--title", "x", "--yes"], gateEnv());
  assert.equal(r.status, 0);
  assert.match(r.stderr, /^ARGS: products update prod_1 --title x$/m);
  assert.match(r.stdout, /"id": ?"fake_1"/);
});

test("agent gate: --plan is the plan alone, ok true, exit 0", () => {
  const r = wv(["payouts", "create", "--amount", "5", "--payout_method_id", "potk_1", "--plan"], gateEnv());
  assert.equal(r.status, 0);
  const e = envelopeOf(r);
  assert.equal(e.ok, true);
  assert.equal(e.error, undefined);
  assert.equal(e.rerun, undefined);
  assert.deepEqual(e.plan?.money, { amount: 5, currency: "usd" });
  assert.deepEqual(e.plan?.balance, { available: 18.56, currency: "usd" });
  assert.equal(wroteTo(r, "payouts create"), false);
});

test("agent gate: Whop's own limit refuses first, in Whop's words, with no rerun", () => {
  const r = wv(["payouts", "create", "--amount", "5", "--payout_method_id", "potk_1"], gateEnv());
  assert.equal(r.status, 2);
  const e = envelopeOf(r);
  assert.equal(e.error?.code, "WHOP_LIMIT");
  assert.match(e.error?.message ?? "", /identity verification/);
  assert.equal(e.rerun, undefined);
  assert.equal((e.plan?.limit as { code: string }).code, "kyc_completed");
});

test("agent gate: the wv cap and the balance refuse when Whop does not", () => {
  const cap = wv(["payouts", "create", "--amount", "600", "--payout_method_id", "potk_1"], gateEnv({ WV_FAKE_METHODS: "payouts.methods.json" }));
  assert.equal(cap.status, 2);
  assert.equal(envelopeOf(cap).error?.code, "WV_CAP");
  assert.match(envelopeOf(cap).error?.hint ?? "", /WV_PAYOUT_CAP=600/);
  const bal = wv(["payouts", "create", "--amount", "100", "--payout_method_id", "potk_1"], gateEnv({ WV_FAKE_METHODS: "payouts.methods.json", WV_PAYOUT_CAP: "1000" }));
  assert.equal(bal.status, 2);
  assert.equal(envelopeOf(bal).error?.code, "INSUFFICIENT_BALANCE");
  const ok = wv(["payouts", "create", "--amount", "10", "--payout_method_id", "potk_1"], gateEnv({ WV_FAKE_METHODS: "payouts.methods.json" }));
  assert.equal(envelopeOf(ok).error?.code, "CONFIRMATION_REQUIRED");
  assert.deepEqual(envelopeOf(ok).rerun?.slice(0, 7), ["wv", "payouts", "create", "--amount", "10", "--payout_method_id", "potk_1"]);
  assert.equal(envelopeOf(ok).rerun?.at(-2), "--approve");
});

test("agent gate: sandbox skips the cap, the limit, and the balance, and says so in meta", () => {
  const r = wv(["--sandbox", "payouts", "create", "--amount", "600", "--payout_method_id", "potk_1"], gateEnv({ WV_SANDBOX_KEY: "whop_test" }));
  assert.equal(r.status, 2);
  const e = envelopeOf(r);
  assert.equal(e.error?.code, "CONFIRMATION_REQUIRED");
  assert.equal(e.meta.mode, "sandbox");
  assert.equal(e.plan?.cap, undefined);
});

test("agent gate: an ad write is the plan tree with its commitment; over the ad cap refuses", () => {
  const args = ["ads", "create", "--title", "Launch", "--ad_group", GROUP, "--headlines", '["a"]'];
  const refused = wv(args, gateEnv());
  assert.equal(refused.status, 2);
  const e = envelopeOf(refused);
  assert.equal(e.error?.code, "WV_AD_CAP");
  assert.equal(e.plan?.kind, "ad");
  assert.deepEqual(e.plan?.commitment, { total: 1200, days: 30, openEnded: true });
  assert.equal(wroteTo(refused, "ads create"), false);
  const asked = envelopeOf(wv(args, gateEnv({ WV_AD_CAP: "none" })));
  assert.equal(asked.error?.code, "CONFIRMATION_REQUIRED");
  assert.equal((asked.plan?.reach as { error: string }).error, "no estimate");
  assert.equal(asked.rerun?.at(-2), "--approve");
  const plan = wv([...args, "--plan"], gateEnv());
  assert.equal(plan.status, 0);
  assert.equal(envelopeOf(plan).ok, true);
});

test("agent gate: WV_RAW and the flags that never execute pass a write straight through", () => {
  const raw = wv(["products", "update", "prod_1", "--title", "x"], gateEnv({ WV_RAW: "1" }));
  assert.match(raw.stderr, /^ARGS: products update prod_1 --title x$/m);
  const schema = wv(["payouts", "create", "--schema"], gateEnv());
  assert.match(schema.stderr, /^ARGS: payouts create --schema$/m);
});

test("agent gate: --format json on a write is still a write", () => {
  const r = wv(["payouts", "create", "--amount", "5", "--payout_method_id", "potk_1", "--format", "json"], gateEnv());
  assert.equal(r.status, 2);
  assert.equal(envelopeOf(r).error?.code, "WHOP_LIMIT");
  assert.equal(wroteTo(r, "payouts create"), false);
});

test("agent gate: a wv refusal before any whop call is the same envelope on stdout", () => {
  const preset = wv(["stats", "get", "page_visits", "--last", "3x"], gateEnv());
  assert.equal(preset.status, 2);
  assert.equal(envelopeOf(preset).error?.code, "BAD_PRESET");
  assert.equal(preset.stderr.includes("ARGS:"), false, "whop never ran");
  const file = wv(["ads", "create", "--ad_group", "@/nonexistent/group.json"], gateEnv());
  assert.equal(file.status, 2);
  assert.equal(envelopeOf(file).error?.code, "JSON_FLAGS");
});

test("agent: a screen that only draws is NEEDS_TERMINAL on stdout, exit 2", () => {
  const r = wv(["home"], gateEnv());
  assert.equal(r.status, 2);
  assert.equal(envelopeOf(r).error?.code, "NEEDS_TERMINAL");
  assert.equal(r.stderr.includes("ARGS:"), false);
});

test("agent gate: the plan step mints the idempotency key, and the rerun carries it", () => {
  const r = wv(["payouts", "create", "--amount", "10", "--payout_method_id", "potk_1"], gateEnv({ WV_FAKE_METHODS: "payouts.methods.json" }));
  const e = envelopeOf(r);
  assert.equal(e.error?.code, "CONFIRMATION_REQUIRED");
  const i = e.rerun!.indexOf("--idempotency-key");
  assert.ok(i > 0, "rerun carries the key");
  assert.match(e.rerun![i + 1], /^[0-9a-f-]{36}$/);
  assert.equal(e.rerun!.at(-2), "--approve");
  assert.match(String(e.plan?.command), /--idempotency-key [0-9a-f-]{36}$/, "the plan shows the command that will run");
  // A key the caller chose is kept; a verb whose schema has none gets none.
  const own = envelopeOf(wv(["payouts", "create", "--amount", "10", "--payout_method_id", "potk_1", "--idempotency-key", "mine"], gateEnv({ WV_FAKE_METHODS: "payouts.methods.json" })));
  assert.equal(own.rerun!.filter((a) => a === "--idempotency-key").length, 1);
  assert.ok(own.rerun!.includes("mine"));
  const none = envelopeOf(wv(["products", "update", "prod_1", "--title", "x"], gateEnv()));
  assert.equal(none.rerun!.includes("--idempotency-key"), false, "no schema fixture for products update, so no key");
});

test("agent gate: a verb only whop's manifest calls a write is gated too", () => {
  const r = wv(["products", "frobnicate", "prod_1"], gateEnv());
  assert.equal(r.status, 2);
  assert.equal(envelopeOf(r).error?.code, "CONFIRMATION_REQUIRED");
  assert.equal(wroteTo(r, "products frobnicate"), false);
  const list = wv(["products", "list"], gateEnv());
  assert.equal(list.status, 0, "a read the manifest lists without the tag still passes through");
});

test("agent gate: a write against one record carries what it changes, read from the record first", () => {
  const r = wv(["products", "update", "prod_iQ2Zub6GFQS5Q", "--title", "Hypermotion Pro", "--visibility", "visible"], gateEnv());
  const e = envelopeOf(r);
  assert.equal(e.error?.code, "CONFIRMATION_REQUIRED");
  assert.ok(wroteTo(r, "products get prod_iQ2Zub6GFQS5Q"), "the record is read");
  assert.deepEqual(e.plan?.current, { id: "prod_iQ2Zub6GFQS5Q", title: "Hypermotion", visibility: "visible" });
  assert.deepEqual(e.plan?.changes, [
    { key: "title", before: "Hypermotion", after: "Hypermotion Pro", changed: true },
    { key: "visibility", before: "visible", after: "visible", changed: false },
  ]);
  const pub = envelopeOf(wv(["products", "unpublish", "prod_iQ2Zub6GFQS5Q"], gateEnv()));
  assert.deepEqual(pub.plan?.changes, [{ key: "visibility", before: "visible", after: "hidden", changed: true }]);
});

test("--all in a pipe: every page, one row per line, then the same as one array with --format json", () => {
  const env = gateEnv({ WV_FAKE_PAGED: "1" });
  const r = wv(["products", "list", "--all"], env);
  assert.equal(r.status, 0);
  const lines = r.stdout.trim().split("\n").map((l) => JSON.parse(l) as { id: string });
  assert.equal(lines.length, 4, "two pages of two rows");
  assert.equal(lines[0].id, lines[2].id, "the fake serves the same rows twice; the cursor was followed");
  assert.match(r.stderr, /^ARGS: products list --after c2 --format json --full-output$/m);
  const arr = wv(["products", "list", "--all", "--format", "json"], env);
  const body = JSON.parse(arr.stdout) as { data: unknown[]; pages: number; page_info: { has_next_page: boolean } };
  assert.equal(body.data.length, 4);
  assert.equal(body.pages, 2);
  assert.equal(body.page_info.has_next_page, false);
  const one = wv(["products", "list", "--all"], gateEnv());
  assert.equal(one.stdout.trim().split("\n").length, 2, "a single page is just its rows");
  assert.equal(one.stderr.includes("--after"), false);
});

test("agent gate: the rerun runs as planned; edited, stale, or foreign approvals are refused", () => {
  const env = gateEnv();
  const first = envelopeOf(wv(["products", "update", "prod_1", "--title", "Frame Pro"], env));
  const rerun = first.rerun!.slice(1);
  const ran = wv(rerun, env);
  assert.equal(ran.status, 0, "the approved rerun execs whop");
  assert.match(ran.stderr, /^ARGS: products update prod_1 --title Frame Pro$/m, "neither --approve nor its token reach whop");
  // The same token on an edited command.
  const edited = wv(rerun.map((a) => (a === "Frame Pro" ? "Frame Ultra" : a)), env);
  assert.equal(edited.status, 2);
  assert.equal(envelopeOf(edited).error?.code, "APPROVAL_INVALID");
  assert.equal(wroteTo(edited, "products update"), false);
  // The same token against the sandbox host.
  const other = wv(["--sandbox", ...rerun], { ...env, WV_SANDBOX_KEY: "whop_test" });
  assert.equal(envelopeOf(other).error?.code, "APPROVAL_INVALID");
  // A token minted with this secret an hour ago.
  const stale = mintApproval(["products", "update", "prod_1", "--title", "Frame Pro"], "production", "test-secret", Math.floor(Date.now() / 1000) - 3600);
  const expired = wv(["products", "update", "prod_1", "--title", "Frame Pro", "--approve", stale], env);
  assert.equal(envelopeOf(expired).error?.code, "APPROVAL_EXPIRED");
  // Another machine's secret.
  const foreign = wv(rerun, { ...env, WV_APPROVE_SECRET: "someone-else" });
  assert.equal(envelopeOf(foreign).error?.code, "APPROVAL_INVALID");
  // --yes still works: the honor system, on purpose.
  assert.equal(wv(["products", "update", "prod_1", "--title", "x", "--yes"], env).status, 0);
});

test("agent: the index carries every verb with its kind, and --format json is the same as data", () => {
  const env = gateEnv();
  const md = wv(["agent"], env);
  assert.equal(md.status, 0);
  assert.match(md.stdout, /^# wv agent$/m);
  const json = wv(["agent", "--format", "json"], env);
  assert.equal(json.status, 0);
  const data = JSON.parse(json.stdout) as { groups: { group: string; verbs: { verb: string; kind: string[] }[] }[] };
  assert.ok(Array.isArray(data.groups));
  const group = wv(["agent", "nope", "--format", "json"], env);
  assert.equal(group.status, 2);
  assert.equal(envelopeOf(group).error?.code, "COMMAND_NOT_FOUND");
});

// `wv gtm launch`: four writes as one plan, one approval, one rerun, results fed forward.
const LAUNCH = ["gtm", "launch", "prod_iQ2Zub6GFQS5Q", "--budget", "40", "--creative", "file_a", "--idempotency-key", "base"];
// $40 a day commits $1,200 over 30 days, over the default $500 ad cap; these tests are about the steps, so the cap is off.
const launchEnv = (extra: NodeJS.ProcessEnv = {}) => gateEnv({ WV_AD_CAP: "none", ...extra });

test("launch: --plan is the four steps as data, keys derived from one base, later steps referencing earlier results", () => {
  const r = wv([...LAUNCH, "--plan"], launchEnv({ WV_FAKE_READY: "1" }));
  assert.equal(r.status, 0);
  const e = envelopeOf(r);
  const plan = e.plan as { steps: { key: string; command: string; argv: string[]; skipped?: string }[]; blockers: string[]; commitment: { total: number }; product: { planId: string } };
  assert.deepEqual(plan.steps.map((s) => s.key), ["promo", "checkout", "campaign", "ad"]);
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.commitment.total, 1200);
  assert.equal(plan.product.planId, "plan_ozEZmitgc8tjB");
  for (const s of plan.steps) assert.ok(s.argv.includes(`base-${s.key}`), `${s.key} carries its own key`);
  assert.ok(plan.steps[3].argv.includes("{checkout.purchase_url}"), "the ad's destination is the checkout link the plan creates");
  assert.match(plan.steps[3].argv.find((a) => a.startsWith("{\"ad_campaign_id\"")) ?? "", /\{campaign\.id\}/);
  assert.equal(wroteTo(r, "promo-codes create"), false);
});

test("launch: without a page or a payment method the ad steps block the launch; without --budget they are skipped and it proceeds", () => {
  const blocked = wv(LAUNCH, gateEnv());
  assert.equal(blocked.status, 2);
  const e = envelopeOf(blocked);
  assert.equal(e.error?.code, "LAUNCH_BLOCKED");
  assert.equal(e.rerun, undefined);
  assert.equal((e.plan as { blockers: string[] }).blockers.length, 3, "no page, no payment method, and the default $500 cap against a $1,200 commitment");
  assert.equal((envelopeOf(wv(LAUNCH, launchEnv())).plan as { blockers: string[] }).blockers.length, 2);
  const promoOnly = envelopeOf(wv(["gtm", "launch", "prod_iQ2Zub6GFQS5Q"], gateEnv()));
  assert.equal(promoOnly.error?.code, "CONFIRMATION_REQUIRED");
  const steps = (promoOnly.plan as { steps: { key: string; skipped?: string }[] }).steps;
  assert.deepEqual(steps.filter((s) => !s.skipped).map((s) => s.key), ["promo", "checkout"]);
  assert.equal(promoOnly.rerun?.at(-2), "--approve");
});

test("launch: the approved rerun runs the steps in order, feeding ids forward, and reports what it made", () => {
  const env = launchEnv({ WV_FAKE_READY: "1" });
  const asked = envelopeOf(wv(LAUNCH, env));
  assert.equal(asked.error?.code, "CONFIRMATION_REQUIRED");
  const ran = wv(asked.rerun!.slice(1), env);
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  const done = envelopeOf(ran) as ReturnType<typeof envelopeOf> & { results: Record<string, { id: string; purchase_url?: string }>; next: { what: string; run: string[] }[] };
  assert.equal(done.ok, true);
  assert.deepEqual(Object.keys(done.results), ["promo", "checkout", "campaign", "ad"]);
  assert.equal(done.results.checkout.purchase_url, "https://whop.com/checkout/chk_1");
  const args = ran.stderr.split("\n").filter((l) => l.startsWith("ARGS: ")).map((l) => l.slice(6));
  const order = args.filter((a) => / create /.test(a)).map((a) => a.split(" ").slice(0, 2).join(" "));
  assert.deepEqual(order, ["promo-codes create", "checkout-configurations create", "ad-campaigns create", "ads create"]);
  const ad = args.find((a) => a.startsWith("ads create"))!;
  assert.match(ad, /--url https:\/\/whop\.com\/checkout\/chk_1 /, "the checkout link fed the ad");
  assert.match(ad, /"ad_campaign_id":"adcamp_1"/, "the campaign id fed the ad group");
  assert.match(ad, /--idempotency-key base-ad/);
  assert.ok(done.next.some((n) => n.run.join(" ").includes("ad-campaigns get adcamp_1")), "done-when names the ids it made");
  // Approve the same plan against a different budget: refused.
  const edited = wv(asked.rerun!.slice(1).map((a) => (a === "40" ? "400" : a)), env);
  assert.equal(envelopeOf(edited).error?.code, "APPROVAL_INVALID");
});

test("launch: a step that fails stops the run and names what was made and what was not", () => {
  const env = launchEnv({ WV_FAKE_READY: "1", WV_FAKE_CAMPAIGN_FAILS: "1" });
  const r = wv([...LAUNCH, "--yes"], env);
  assert.equal(r.status, 3, "the failing step's code decides the exit");
  const e = envelopeOf(r) as ReturnType<typeof envelopeOf> & { results: Record<string, unknown>; failed: string };
  assert.equal(e.ok, false);
  assert.equal(e.error?.code, "HTTP_422");
  assert.deepEqual(Object.keys(e.results), ["promo", "checkout"]);
  assert.equal(e.failed, "campaign");
  assert.equal(wroteTo(r, "ads create"), false, "nothing after the failure runs");
  assert.ok(e.rerun?.includes("--idempotency-key"), "the resume carries the same keys");
});

// `wv gtm winback`: two audiences, a promo, one ad group in an existing campaign, results fed forward.
const WINBACK = ["gtm", "winback", "adcamp_1", "--budget", "15", "--idempotency-key", "base"];

test("winback: the plan is two audiences, a promo, and a group that includes one and excludes the other", () => {
  const r = wv([...WINBACK, "--plan"], launchEnv({ WV_FAKE_READY: "1" }));
  assert.equal(r.status, 0, r.stdout);
  const plan = envelopeOf(r).plan as { steps: { key: string; argv: string[]; skipped?: string }[]; blockers: string[]; campaign: string; window: { days: number; visitors: { seen: number } } };
  assert.deepEqual(plan.steps.map((s) => s.key), ["visitors", "customers", "promo", "group"]);
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.window.days, 30);
  assert.ok(plan.window.visitors.seen >= 0);
  const group = plan.steps[3].argv.join(" ");
  assert.match(group, /"include":\["\{visitors\.id\}"\],"exclude":\["\{customers\.id\}"\]/);
  assert.match(group, /--ad_campaign_id adcamp_1 /);
  assert.ok(plan.steps[0].argv.includes("base-visitors"));
  // No budget: the group is skipped and nothing blocks; a budget without a campaign blocks in words.
  const promoOnly = envelopeOf(wv(["gtm", "winback"], gateEnv()));
  assert.equal(promoOnly.error?.code, "CONFIRMATION_REQUIRED");
  assert.deepEqual((promoOnly.plan as { steps: { key: string; skipped?: string }[] }).steps.filter((s) => s.skipped).map((s) => s.key), ["group"]);
  const noCampaign = envelopeOf(wv(["gtm", "winback", "--budget", "15"], launchEnv({ WV_FAKE_READY: "1" })));
  assert.equal(noCampaign.error?.code, "WINBACK_BLOCKED");
  assert.match(noCampaign.error?.hint ?? "", /--budget needs --campaign/);
});

test("winback: the approved rerun feeds both audience ids into the ad group", () => {
  const env = launchEnv({ WV_FAKE_READY: "1" });
  const asked = envelopeOf(wv(WINBACK, env));
  assert.equal(asked.error?.code, "CONFIRMATION_REQUIRED");
  const ran = wv(asked.rerun!.slice(1), env);
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  const done = envelopeOf(ran) as ReturnType<typeof envelopeOf> & { results: Record<string, { id: string }>; next: { run: string[] }[] };
  assert.deepEqual(Object.keys(done.results), ["visitors", "customers", "promo", "group"]);
  const group = ran.stderr.split("\n").find((l) => l.startsWith("ARGS: ad-groups create"))!;
  assert.match(group, /"include":\["adaud_visitors"\],"exclude":\["adaud_customers"\]/);
  assert.match(group, /--idempotency-key base-group/);
  assert.ok(done.next.some((n) => n.run.join(" ") === "wv gtm rank adcamp_1"), "done-when points at the rank read in three days");
});

test("rank: the groups under a campaign, ranked by cost per result, with the rubric's verdicts", () => {
  const r = wv(["gtm", "rank", "adcamp_1", "--target", "8"], gateEnv());
  assert.equal(r.status, 0, r.stdout);
  const d = JSON.parse(r.stdout) as { ok: boolean; target: number; groups: { id: string; verdict: string; action?: string[] }[]; rubric: { minDays: number } };
  assert.equal(d.ok, true);
  assert.equal(d.target, 8);
  assert.deepEqual(d.groups.map((g) => [g.id, g.verdict]), [
    ["adgrp_a", "scale"],
    ["adgrp_c", "pause"],
    ["adgrp_b", "wait"],
    ["adgrp_d", "not_delivering"],
  ]);
  assert.deepEqual(d.groups[1].action, ["wv", "ad-groups", "pause", "adgrp_c"]);
  const noTarget = JSON.parse(wv(["gtm", "rank", "adcamp_1"], gateEnv()).stdout) as { groups: { verdict: string }[] };
  assert.deepEqual(noTarget.groups.map((g) => g.verdict), ["hold", "hold", "wait", "not_delivering"], "no target, no pause or scale");
  const bad = wv(["gtm", "rank"], gateEnv());
  assert.equal(bad.status, 2);
  assert.equal(envelopeOf(bad).error?.code, "VALIDATION_ERROR");
});

// `wv money`: the screen as data, and `wv money close`: export then payout as one plan.
test("money: the screen as JSON names the identity block, and the close plan is refused by it", () => {
  const r = wv(["money"], gateEnv());
  assert.equal(r.status, 0, r.stdout);
  const d = JSON.parse(r.stdout) as { ok: boolean; payoutsBlocked?: { code: string }; balances: { currency: string; available: number }[] };
  assert.equal(d.payoutsBlocked?.code, "kyc_completed");
  assert.deepEqual(d.balances.map((b) => [b.currency, b.available]), [["usd", 18.56]]);
  const blocked = wv(["money", "close", "--keep", "10"], gateEnv());
  assert.equal(blocked.status, 2);
  const e = envelopeOf(blocked);
  assert.equal(e.error?.code, "CLOSE_BLOCKED");
  assert.match(e.error?.hint ?? "", /identity verification/);
  assert.equal(wroteTo(blocked, "payouts create"), false);
  assert.equal(wroteTo(blocked, "exports create"), false);
});

test("money close: on a ready account the approved rerun exports, then pays out, keys from one base", () => {
  const env = gateEnv({ WV_FAKE_METHODS: "payouts.methods.ready.json", WV_PAYOUT_CAP: "none" });
  const asked = envelopeOf(wv(["money", "close", "--keep", "10", "--idempotency-key", "base"], env));
  assert.equal(asked.error?.code, "CONFIRMATION_REQUIRED", JSON.stringify(asked));
  const plan = asked.plan as { amount: number; steps: { key: string }[]; typedAmount: { amount: number } };
  assert.equal(plan.amount, 8.56);
  assert.deepEqual(plan.steps.map((s) => s.key), ["export", "payout"]);
  assert.equal(plan.typedAmount.amount, 8.56);
  const ran = wv(asked.rerun!.slice(1), env);
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  const args = ran.stderr.split("\n").filter((l) => l.startsWith("ARGS: ")).map((l) => l.slice(6));
  const writes = args.filter((a) => /^(exports|payouts) create/.test(a));
  assert.equal(writes[0].startsWith("exports create"), true);
  assert.match(writes[0], /financial-activity/);
  assert.match(writes[0], /--idempotency-key base-export/);
  assert.match(writes[1], /^payouts create --account_id biz_VraUMckluH8dzV --amount 8.56 --currency usd --payout_method_id potk_x1 --speed standard/);
  assert.match(writes[1], /--idempotency-key base-payout/);
  const done = envelopeOf(ran) as ReturnType<typeof envelopeOf> & { results: Record<string, { id: string }> };
  assert.deepEqual(Object.keys(done.results), ["export", "payout"]);
});

// `wv support`: the lookup as data, the refund as one gated step, the dispute as evidence then submit.
test("support lookup: an email resolves to the buyer and the screen is data with the actions a ticket ends in", () => {
  const r = wv(["support", "lookup", "person1@example.com"], gateEnv());
  assert.equal(r.status, 0, r.stdout);
  const d = JSON.parse(r.stdout) as { ok: boolean; user: { id: string }; memberships: unknown[]; payments: unknown[]; actions: { what: string; run: string[] }[] };
  assert.equal(d.ok, true);
  assert.equal(d.user.id, "user_ICLAwIXM9zFfz");
  assert.equal(d.memberships.length, 2);
  assert.equal(d.payments.length, 3);
  assert.deepEqual(d.actions[0].run, ["wv", "support", "refund", "pay_JFHAhioMdPL1ts"]);
  assert.match(r.stderr, /^ARGS: people list --email person1@example.com/m);
  assert.match(r.stderr, /^ARGS: memberships list --user_id user_ICLAwIXM9zFfz/m);
  const byMembership = JSON.parse(wv(["support", "lookup", "mem_kfT4Jl8Pb8DlWE"], gateEnv()).stdout) as { user: { id: string } };
  assert.equal(byMembership.user.id, "user_3meX572iT5dAg");
  const none = wv(["support", "lookup"], gateEnv());
  assert.equal(none.status, 2);
  assert.equal(envelopeOf(none).error?.code, "VALIDATION_ERROR");
});

test("support refund: the payment is read first, the amount is typed back, the approved rerun refunds once", () => {
  const env = gateEnv();
  const asked = envelopeOf(wv(["support", "refund", "pay_JFHAhioMdPL1ts", "--idempotency-key", "base"], env));
  assert.equal(asked.error?.code, "CONFIRMATION_REQUIRED", JSON.stringify(asked));
  const plan = asked.plan as { amount: number; typedAmount: { amount: number }; payment: { remaining: number } };
  assert.equal(plan.amount, 10);
  assert.equal(plan.payment.remaining, 10);
  const ran = wv(asked.rerun!.slice(1), env);
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  assert.match(ran.stderr, /^ARGS: payments refund pay_JFHAhioMdPL1ts --idempotency-key base-refund/m);
  const partial = envelopeOf(wv(["support", "refund", "pay_JFHAhioMdPL1ts", "--amount", "4"], env));
  assert.match((partial.plan as { steps: { command: string }[] }).steps[0].command, /--partial_amount 4/);
  const over = envelopeOf(wv(["support", "refund", "pay_JFHAhioMdPL1ts", "--amount", "40"], env));
  assert.equal(over.error?.code, "REFUND_BLOCKED");
});

test("support dispute: evidence then submit as one plan; locked, late, or empty is a stop", () => {
  const env = gateEnv();
  const asked = envelopeOf(wv(["support", "dispute", "dsp_x1", "--evidence", "file_a,file_b:product_image", "--idempotency-key", "base"], env));
  assert.equal(asked.error?.code, "CONFIRMATION_REQUIRED", JSON.stringify(asked));
  assert.deepEqual((asked.plan as { steps: { key: string }[] }).steps.map((s) => s.key), ["evidence", "submit"]);
  const ran = wv(asked.rerun!.slice(1), env);
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  const args = ran.stderr.split("\n").filter((l) => l.startsWith("ARGS: disputes")).map((l) => l.slice(6));
  assert.match(args[1] ?? "", /^disputes upload_evidence dsp_x1 --documents .*"document_type":"product_image".* --idempotency-key base-evidence/);
  assert.match(args[2] ?? "", /^disputes submit dsp_x1 --idempotency-key base-submit/);
  const empty = envelopeOf(wv(["support", "dispute", "dsp_x1"], env));
  assert.equal(empty.error?.code, "DISPUTE_BLOCKED");
  assert.match(empty.error?.hint ?? "", /No evidence named/);
  const locked = envelopeOf(wv(["support", "dispute", "dsp_x1", "--evidence", "file_a"], gateEnv({ WV_FAKE_DISPUTE_LOCKED: "1" })));
  assert.equal(locked.error?.code, "DISPUTE_BLOCKED");
  assert.match(locked.error?.hint ?? "", /under review/);
  assert.equal(wroteTo(locked, "disputes submit"), false);
});

// `wv dev`: the app loop as data, and `wv dev hook`: create, test, prove, refused on an OAuth login.
test("dev: the screen as data names why webhooks are unreadable on an oauth login, and the hook plan is blocked by it", () => {
  const r = wv(["dev"], gateEnv());
  assert.equal(r.status, 0, r.stdout);
  const d = JSON.parse(r.stdout) as { app: { id: string }; webhookAccess: { ok: boolean; fix: string[] }; builds: unknown[]; domains: unknown[] };
  assert.equal(d.app.id, "app_HKnLpw6UGGEqk6");
  assert.equal(d.webhookAccess.ok, false);
  assert.deepEqual(d.webhookAccess.fix, ["whop", "auth", "switch", "sandbox"]);
  assert.equal(d.builds.length, 2);
  assert.equal(d.domains.length, 1);
  const blocked = wv(["dev", "hook", "https://example.com/hooks"], gateEnv());
  assert.equal(blocked.status, 2);
  assert.equal(envelopeOf(blocked).error?.code, "HOOK_BLOCKED");
  assert.match(envelopeOf(blocked).error?.hint ?? "", /OAuth token/);
  assert.equal(wroteTo(blocked, "webhooks create"), false);
});

test("dev hook: on an api-key profile the approved rerun creates the webhook, then tests it with the hook's id", () => {
  const env = gateEnv({ WV_FAKE_READY: "1" });
  const asked = envelopeOf(wv(["dev", "hook", "https://example.com/hooks", "--events", "payment.succeeded,invoice.paid", "--idempotency-key", "base"], env));
  assert.equal(asked.error?.code, "CONFIRMATION_REQUIRED", JSON.stringify(asked));
  const ran = wv(asked.rerun!.slice(1), env);
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  const args = ran.stderr.split("\n").filter((l) => l.startsWith("ARGS: webhooks")).map((l) => l.slice(6));
  assert.match(args.find((a) => a.startsWith("webhooks create")) ?? "", /--url https:\/\/example.com\/hooks --events \["payment.succeeded","invoice.paid"\] --idempotency-key base-hook/);
  assert.match(args.find((a) => a.startsWith("webhooks test")) ?? "", /^webhooks test hook_2 --event payment.succeeded/, "the created hook's id fed the test");
  const done = envelopeOf(ran) as ReturnType<typeof envelopeOf> & { results: Record<string, { id?: string }>; next: { run: string[] }[] };
  assert.equal(done.results.hook.id, "hook_2");
  assert.ok(done.next.some((n) => n.run.join(" ").includes("webhooks deliveries hook_2")));
  const dup = envelopeOf(wv(["dev", "hook", "https://hypermotion.art/hooks"], env));
  assert.equal(dup.error?.code, "HOOK_BLOCKED");
  assert.match(dup.error?.hint ?? "", /already exists: hook_1/);
});
