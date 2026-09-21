// Approval bound to the plan: the token matches one argv in one mode until it expires, and nothing else.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approveTtlFrom, checkApproval, DEFAULT_APPROVE_TTL_SECONDS, mintApproval, splitApprove } from "../src/approve.ts";
import { approveSecret, readConfig } from "../src/config.ts";
import { rerunFor } from "../src/agent.ts";

const argv = ["payouts", "create", "--amount", "5", "--payout_method_id", "potk_1", "--idempotency-key", "k1"];

test("approve: a token verifies the exact argv and mode it was minted for, until it expires", () => {
  const t = mintApproval(argv, "production", "s3cret", 1_000_600);
  assert.match(t, /^1000600\.[0-9a-f]{32}$/);
  assert.equal(checkApproval(t, argv, "production", "s3cret", 1_000_000), "ok");
  assert.equal(checkApproval(t, argv, "production", "s3cret", 1_000_600), "ok", "the last second counts");
  assert.equal(checkApproval(t, argv, "production", "s3cret", 1_000_601), "expired");
  assert.equal(checkApproval(t, [...argv.slice(0, 3), "500", ...argv.slice(4)], "production", "s3cret", 1_000_000), "invalid", "a changed amount");
  assert.equal(checkApproval(t, [...argv, "--speed", "instant"], "production", "s3cret", 1_000_000), "invalid", "an added flag");
  assert.equal(checkApproval(t, argv, "sandbox", "s3cret", 1_000_000), "invalid", "a different host");
  assert.equal(checkApproval(t, argv, "production", "other", 1_000_000), "invalid", "another machine's secret");
  assert.equal(checkApproval("1000600.deadbeef", argv, "production", "s3cret", 1_000_000), "invalid");
  assert.equal(checkApproval("", argv, "production", "s3cret", 1_000_000), "invalid");
  assert.equal(checkApproval(`9999999999.${"0".repeat(32)}`, argv, "production", "s3cret"), "invalid", "a forged expiry does not pass with a forged signature");
});

test("approve: the flag splits out of argv in both spellings; the rerun carries it instead of --yes", () => {
  assert.deepEqual(splitApprove(["products", "publish", "p1", "--approve", "t"]), { argv: ["products", "publish", "p1"], token: "t" });
  assert.deepEqual(splitApprove(["products", "publish", "--approve=t", "p1"]), { argv: ["products", "publish", "p1"], token: "t" });
  assert.deepEqual(splitApprove(["products", "publish", "p1"]), { argv: ["products", "publish", "p1"], token: undefined });
  assert.deepEqual(splitApprove(["products", "publish", "--approve"]), { argv: ["products", "publish"], token: "" });
  assert.deepEqual(rerunFor(["products", "publish", "p1", "--plan"], "t"), ["wv", "products", "publish", "p1", "--approve", "t"]);
  assert.deepEqual(rerunFor(["products", "publish", "p1"]), ["wv", "products", "publish", "p1", "--yes"]);
});

test("approve: the ttl comes from the env, default ten minutes", () => {
  assert.equal(approveTtlFrom({}), DEFAULT_APPROVE_TTL_SECONDS);
  assert.equal(approveTtlFrom({ WV_APPROVE_TTL: "60" }), 60);
  assert.equal(approveTtlFrom({ WV_APPROVE_TTL: "junk" }), DEFAULT_APPROVE_TTL_SECONDS);
});

test("approve: the secret is created once in the config, owner-only, kept beside the sandbox key, and never clobbers a broken file", () => {
  const dir = mkdtempSync(join(tmpdir(), "wv-approve-"));
  const file = join(dir, "config.json");
  writeFileSync(file, JSON.stringify({ sandbox: { key: "whop_sb" } }));
  const env = { WV_CONFIG: file };
  const a = approveSecret(env);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(approveSecret(env), a, "stable across calls");
  assert.deepEqual(readConfig(env).sandbox, { key: "whop_sb" }, "the sandbox key survives");
  assert.equal(approveSecret({ WV_CONFIG: file, WV_APPROVE_SECRET: "env" }), "env");
  const broken = join(dir, "broken.json");
  writeFileSync(broken, "{ not json");
  const b = approveSecret({ WV_CONFIG: broken });
  assert.match(b, /^[0-9a-f]{64}$/);
  assert.equal(readFileSync(broken, "utf8"), "{ not json", "a file that does not parse is left alone");
});
