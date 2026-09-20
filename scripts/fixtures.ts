// Records real envelopes from the local `whop` into tests/fixtures. Read-only commands only.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const day = (n: number) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

const CASES: [string, string[]][] = [
  ["products.list", ["products", "list"]],
  ["products.get", ["products", "get", "prod_iQ2Zub6GFQS5Q"]],
  ["plans.list", ["plans", "list"]],
  ["memberships.list", ["memberships", "list"]],
  ["memberships.get", ["memberships", "get", "mem_kfT4Jl8Pb8DlWE"]],
  ["members.list", ["members", "list"]],
  ["payouts.list", ["payouts", "list"]],
  ["ledgers.list", ["ledgers", "list"]],
  ["ledgers.report", ["ledgers", "report", "--report_type", "balance_summary"]],
  ["disputes.list", ["disputes", "list"]],
  ["ad-campaigns.list", ["ad-campaigns", "list"]],
  ["apps.list", ["apps", "list"]],
  ["auth.status", ["auth", "status"]],
  ["stats.net_revenue", ["stats", "get", "net_revenue", "--from", day(7), "--to", day(1), "--interval", "day"]],
  ["error.404", ["products", "get", "prod_doesnotexist"]],
  ["error.typo", ["prodcts", "list"]],
  ["error.validation", ["stats", "get", "net_revenue"]],
  ["error.unknown_flag", ["ledgers", "list", "--first", "2"]],
];

// Fixtures are committed. Email addresses are the one field no view renders and the one that must not leak.
const redact = (text: string) => text.replace(/("(?:user_)?email":\s*")[^"@]+@[^"]+(")/g, "$1redacted@example.com$2");

const dir = join(import.meta.dirname, "..", "tests", "fixtures");
mkdirSync(dir, { recursive: true });
for (const [name, args] of CASES) {
  const r = spawnSync("whop", [...args, "--format", "json", "--full-output"], { encoding: "utf8" });
  writeFileSync(join(dir, `${name}.json`), redact(r.stdout));
  console.log(`${name}: exit ${r.status}, ${r.stdout.length} bytes`);
}
// Help text is parsed at runtime; keep a copy so the help view can be snapshotted offline.
writeFileSync(join(dir, "help.txt"), spawnSync("whop", ["--help"], { encoding: "utf8" }).stdout);
writeFileSync(join(dir, "help.products.txt"), spawnSync("whop", ["products", "--help"], { encoding: "utf8" }).stdout);
// Plain (non --full-output) forms, for the passthrough byte-identity test.
writeFileSync(join(dir, "products.list.plain.txt"), spawnSync("whop", ["products", "list"], { encoding: "utf8" }).stdout);
console.log("help + plain captured");
