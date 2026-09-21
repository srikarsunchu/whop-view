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
  writeFileSync(
    script,
    `#!/bin/sh
echo "ARGS: $*" >&2
echo "BASE: \${WHOP_API_BASE_URL:-unset} KEY: \${WHOP_API_KEY:-unset}" >&2
if [ "$1" = "products" ] && [ "$2" = "list" ]; then
  case "$*" in
    *--format*json*--full-output*) cat "${join(FIXTURES, "products.list.json")}" ;;
    *) cat "${join(FIXTURES, "products.list.plain.txt")}" ;;
  esac
  exit 0
fi
echo '{"code":"COMMAND_NOT_FOUND","message":"nope"}'
exit 1
`,
  );
  chmodSync(script, 0o755);
  return script;
}

const wv = (args: string[], env: NodeJS.ProcessEnv = {}) =>
  spawnSync(node, ["--experimental-strip-types", "--no-warnings", bin, ...args], { encoding: "utf8", env: { ...process.env, ...env } });

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

test("piped stdout: failure exit codes are preserved", () => {
  const fake = fakeWhop();
  const r = wv(["prodcts", "list"], { WV_WHOP_BIN: fake });
  assert.equal(r.status, 1);
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
