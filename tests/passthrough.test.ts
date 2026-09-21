// Proves wv is invisible to pipes and scripts. Hermetic: a fake `whop` on PATH replays fixtures.
// WV_LIVE=1 additionally compares against the real `whop`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURES, fixture } from "./render.ts";

const bin = join(import.meta.dirname, "..", "src", "bin.ts");
const node = process.execPath;

function fakeWhop(): string {
  const dir = mkdtempSync(join(tmpdir(), "wv-fake-"));
  const script = join(dir, "whop");
  // Echoes argv to stderr so tests can assert what wv passed through, prints the plain fixture.
  // The reads the gate needs answer from fixtures. `WV_FAKE_METHODS` swaps the payout methods fixture, so a
  // test can choose between Whop's own limit (the recorded one blocks every payout) and none.
  writeFileSync(
    script,
    `#!/bin/sh
echo "ARGS: $*" >&2
echo "BASE: \${WHOP_API_BASE_URL:-unset} KEY: \${WHOP_API_KEY:-unset}" >&2
fx() { cat "${FIXTURES}/$1"; exit 0; }
if [ "$1" = "--llms-full" ]; then
  printf '# whop\n\n## whop products\n\n### whop products frobnicate\n\nFrobnicate Product\n\n> Confirm with the user before executing this destructive command.\n\n### whop products list\n\nList Products\n'
  exit 0
fi
case "$*" in *--schema*) [ -f "${FIXTURES}/schema.$1.$2.json" ] && fx "schema.$1.$2.json"; echo '{"code":"COMMAND_NOT_FOUND","message":"no schema"}'; exit 1 ;; esac
case "$1 $2" in
  "products list")
    case "$*" in
      *--after*c2*) fx products.list.json ;;
      *--format*json*--full-output*) [ -n "$WV_FAKE_PAGED" ] && fx products.list.page1.json; fx products.list.json ;;
      *) fx products.list.plain.txt ;;
    esac ;;
  "products get") fx products.get.json ;;
  "auth status") fx auth.status.json ;;
  "ledgers report") fx ledgers.report.json ;;
  "payouts methods") fx "\${WV_FAKE_METHODS:-payouts.methods.limits.json}" ;;
  "accounts preferences") fx accounts.preferences.json ;;
  "social-accounts list") fx social-accounts.list.json ;;
  "ad-groups estimate_reach") echo '{"ok":false,"error":{"code":"HTTP_400","message":"no estimate"},"meta":{"command":"ad-groups estimate_reach","duration":"1ms"}}'; exit 1 ;;
  "payouts create"|"products update"|"products frobnicate"|"ads create") echo '{"ok":true,"data":{"id":"fake_1"},"meta":{"command":"'"$1 $2"'","duration":"1ms"}}'; exit 0 ;;
esac
echo '{"code":"COMMAND_NOT_FOUND","message":"nope"}'
exit 1
`,
  );
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
const gateEnv = (extra: NodeJS.ProcessEnv = {}) => ({ WV_WHOP_BIN: fakeWhop(), WHOP_API_BASE_URL: "", WHOP_API_KEY: "", WV_PAYOUT_CAP: "", WV_AD_CAP: "", WV_RAW: "", ...extra });
const envelopeOf = (r: ReturnType<typeof wv>) => JSON.parse(r.stdout) as { ok: boolean; error?: { code: string; message: string; hint?: string }; plan?: Record<string, unknown>; rerun?: string[]; meta: { command: string; wrapper: string; mode: string } };
const wroteTo = (r: ReturnType<typeof wv>, cmd: string) => new RegExp(`^ARGS: ${cmd}`, "m").test(r.stderr);

test("agent gate: a write without --yes is CONFIRMATION_REQUIRED, exit 2, and whop never runs it", () => {
  const r = wv(["products", "update", "prod_1", "--title", "Frame Pro"], gateEnv());
  assert.equal(r.status, 2);
  const e = envelopeOf(r);
  assert.equal(e.ok, false);
  assert.equal(e.error?.code, "CONFIRMATION_REQUIRED");
  assert.deepEqual(e.rerun, ["wv", "products", "update", "prod_1", "--title", "Frame Pro", "--yes"]);
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
  assert.equal(envelopeOf(ok).rerun?.at(-1), "--yes");
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
  assert.equal(asked.rerun?.at(-1), "--yes");
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
  assert.equal(e.rerun!.at(-1), "--yes");
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
