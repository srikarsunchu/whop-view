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

// Whop's published sandbox server. Only the base URL is needed to record what the host says to an OAuth token.
const SANDBOX = { WHOP_API_BASE_URL: "https://sandbox-api.whop.com/api/v1", WHOP_API_KEY: "" };

const CASES: [string, string[], NodeJS.ProcessEnv?][] = [
  ["products.list", ["products", "list"]],
  ["products.get", ["products", "get", "prod_iQ2Zub6GFQS5Q"]],
  ["plans.list", ["plans", "list"]],
  ["memberships.list", ["memberships", "list"]],
  ["memberships.get", ["memberships", "get", "mem_kfT4Jl8Pb8DlWE"]],
  ["members.list", ["members", "list"]],
  ["payouts.list", ["payouts", "list"]],
  ["payments.list", ["payments", "list"]],
  ["stats.list", ["stats", "list"]],
  ["refunds.list", ["refunds", "list"]],
  ["error.gated", ["economic-intelligence", "list"]],
  ["ledgers.list", ["ledgers", "list"]],
  ["ledgers.report", ["ledgers", "report", "--report_type", "balance_summary"]],
  ["disputes.list", ["disputes", "list"]],
  ["ad-campaigns.list", ["ad-campaigns", "list"]],
  ["disputes.summary", ["disputes", "summary"]],
  ["resolution-center-cases.summary", ["resolution-center-cases", "summary"]],
  ["accounts.reserves", ["accounts", "reserves"]],
  ["payouts.methods", ["payouts", "methods"]],
  ["apps.list", ["apps", "list"]],
  ["auth.status", ["auth", "status"]],
  ["stats.net_revenue", ["stats", "get", "net_revenue", "--from", day(7), "--to", day(1), "--interval", "day"]],
  ["error.404", ["products", "get", "prod_doesnotexist"]],
  ["error.typo", ["prodcts", "list"]],
  ["error.validation", ["stats", "get", "net_revenue"]],
  ["error.unknown_flag", ["ledgers", "list", "--first", "2"]],
  // Doctor inputs. `permissions check` needs the active account's id; it is filled in below.
  ["auth.list", ["auth", "list"]],
  ["permissions.check", ["permissions", "check", "--resource_id", "<biz_id>", "--actions", "developer:manage_webhook,payout:withdraw_funds,access_pass:create,plan:create,payment:basic:read,stats:read"]],
  ["verifications.list", ["verifications", "list"]],
  ["payouts.methods.limits", ["payouts", "methods", "--include_limits"]],
  ["error.webhooks_oauth", ["webhooks", "list"]],
  ["error.sandbox_oauth", ["accounts", "get", "me"], SANDBOX],
  ["apps.logs", ["apps", "logs", "app_HKnLpw6UGGEqk6"]],
  // `memberships get` takes a membership id or a software license key; a key nobody issued is a 404.
  ["error.license_404", ["memberships", "get", "ABCD-1234-EFGH-5678"]],
  // Feature gates in Whop's words: internal-only, a preference, and card issuing behind a Rain account.
  ["error.experiments", ["experiments", "list"]],
  ["error.cards", ["cards", "list"]],
  ["error.cashback", ["cashback-rules", "list"]],
];

// Fixtures are committed. Nothing a real person could be identified by survives recording:
// emails, street lines and postal codes, and the real customers named below.
const PEOPLE: [string, string][] = [
  ["Baasil Ali", "Ada Customer"],
  ["baasil", "ada"],
  ["bossil", "adacustomer"],
];
const redact = (text: string) => {
  let out = text
    // `email`, `user_email`, and the camelCase `userEmail` that `auth list` carries.
    .replace(/("[a-z_]*email[a-z_]*":\s*")[^"@]+@[^"]+(")/gi, "$1redacted@example.com$2")
    .replace(/("(?:line1|line2|postal_code)":\s*")[^"]+(")/g, "$1redacted$2");
  for (const [real, fake] of PEOPLE) out = out.split(real).join(fake);
  return out;
};

const dir = join(import.meta.dirname, "..", "tests", "fixtures");
mkdirSync(dir, { recursive: true });
// `pnpm fixtures auth.list verifications.list` records only those; no names records everything.
const only = process.argv.slice(2);
const status = spawnSync("whop", ["auth", "status", "--format", "json"], { encoding: "utf8" });
const biz = (() => {
  try {
    return String(JSON.parse(status.stdout).account?.id ?? "");
  } catch {
    return "";
  }
})();
for (const [name, argsIn, extraEnv] of CASES) {
  if (only.length && !only.includes(name)) continue;
  const args = argsIn.map((a) => (a === "<biz_id>" ? biz : a));
  const env = { ...process.env, ...extraEnv };
  for (const [k, v] of Object.entries(extraEnv ?? {})) if (v === "") delete env[k];
  const r = spawnSync("whop", [...args, "--format", "json", "--full-output"], { encoding: "utf8", env });
  writeFileSync(join(dir, `${name}.json`), redact(r.stdout));
  console.log(`${name}: exit ${r.status}, ${r.stdout.length} bytes`);
}
if (only.length) process.exit(0);
// Help text is parsed at runtime; keep a copy so the help view can be snapshotted offline.
writeFileSync(join(dir, "help.txt"), spawnSync("whop", ["--help"], { encoding: "utf8" }).stdout);
writeFileSync(join(dir, "help.products.txt"), spawnSync("whop", ["products", "--help"], { encoding: "utf8" }).stdout);
// Plain (non --full-output) forms, for the passthrough byte-identity test.
writeFileSync(join(dir, "products.list.plain.txt"), spawnSync("whop", ["products", "list"], { encoding: "utf8" }).stdout);
console.log("help + plain captured");
