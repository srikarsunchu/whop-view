// Derives the hints from Whop's OpenAPI spec, so a hand-written hint file is only for what the spec cannot say.
// `pnpm spec` reads https://api.whop.com/openapi.json (or WV_OPENAPI=<path>, or the cached copy), maps every
// operation to the CLI command it stands for, and writes `src/hints/_spec.json`: per command, the kind of every
// response field the spec settles (id, money, date, status, relation, count, hidden). `hintsFor` merges it under
// the hand file. The mapping report on stderr says which CLI commands the spec covers and which it does not.
//
// The whop binary embeds the same spec (operationIds and x-whop-summary are in its strings), so inside the CLI
// this file is the in-memory lookup and the download disappears; that is the `--format human` argument.
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);

const repo = join(import.meta.dirname, "..");
const cacheDir = join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "whop-view");
const cached = join(cacheDir, "openapi.json");
const URL = "https://api.whop.com/openapi.json";

async function loadSpec(): Promise<Rec> {
  const explicit = process.env.WV_OPENAPI;
  if (explicit && existsSync(explicit)) return JSON.parse(readFileSync(explicit, "utf8"));
  if (!process.env.WV_SPEC_REFRESH && existsSync(cached)) return JSON.parse(readFileSync(cached, "utf8"));
  const r = await fetch(URL);
  if (!r.ok) throw new Error(`${URL}: ${r.status}`);
  const text = await r.text();
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cached, text);
  return JSON.parse(text);
}

export type Kind = "id" | "money" | "date" | "status" | "relation" | "plan" | "count" | "hidden";

export interface DerivedHints {
  /** The response schema the rows come from, for the report. */
  schema?: string;
  kinds: Record<string, Kind>;
}

/** Where the CLI's name for an operation is not the path's: the ledger and stats groups, and the hyphenated method verbs. */
const ALIASES: Record<string, [string, string]> = {
  "GET /financial_activity": ["ledgers", "list"],
  "GET /financial_reports": ["ledgers", "report"],
  "GET /financial_reports/breakdown": ["ledgers", "breakdown"],
  "GET /stats": ["stats", "list"],
  "GET /stats/{metric}": ["stats", "get"],
  "GET /payouts/supported_methods": ["payouts", "supported-methods"],
  "POST /payouts/methods": ["payouts", "create-method"],
  "PATCH /payouts/methods/{id}": ["payouts", "update-method"],
  "DELETE /payouts/methods/{id}": ["payouts", "delete-method"],
  "GET /card_transactions": ["cards", "transactions"],
  "GET /card_transactions/{id}": ["cards", "get-transaction"],
  "GET /partners/businesses": ["partners", "list"],
  "GET /partners/businesses/{id}": ["partners", "retrieve"],
  "GET /partners/businesses/{id}/earnings": ["partners", "earnings"],
  "GET /api_keys/permissions": ["api-keys", "permissions"],
  "GET /permissions": ["permissions", "check"],
  "GET /experiments/exposures": ["experiments", "exposures"],
  "GET /users/me": ["users", "get"],
  "GET /accounts/me": ["accounts", "get"],
  "GET /bounties/{id}/submissions/{submission_id}": ["bounties", "get-submission"],
};

/** `/ad_campaigns/{id}/pause` → `ad-campaigns pause`; `/payouts/methods` → `payouts methods`; `/products` GET → `products list`. */
export function commandFor(method: string, path: string): [string, string] | undefined {
  const alias = ALIASES[`${method.toUpperCase()} ${path}`];
  if (alias) return alias;
  const segs = path.split("/").filter(Boolean);
  if (!segs.length) return undefined;
  const group = segs[0].replace(/_/g, "-");
  const literal = segs.slice(1).filter((s) => !s.startsWith("{"));
  const endsWithParam = segs[segs.length - 1].startsWith("{");
  const m = method.toUpperCase();
  const last = literal[literal.length - 1];
  if (!literal.length) {
    if (m === "GET") return [group, endsWithParam ? "get" : "list"];
    if (m === "POST") return [group, "create"];
    if (m === "PATCH" || m === "PUT") return [group, "update"];
    if (m === "DELETE") return [group, "delete"];
    return undefined;
  }
  // A sub-resource: `webhooks deliveries` lists, `accounts preferences` reads one, `plans calculate_tax` acts.
  const verb = last.replace(/-/g, "_");
  if (m === "DELETE" && endsWithParam) return [group, `delete_${verb}`.replace(/^delete_(.*)$/, (_, v) => (literal.length === 1 ? `delete-${v}` : v))];
  return [group, verb];
}

function deref(spec: Rec, s: unknown, depth = 0): Rec | undefined {
  if (!isObj(s) || depth > 6) return undefined;
  if (typeof s.$ref === "string") {
    const name = s.$ref.split("/").pop() ?? "";
    const target = (spec.components as Rec | undefined)?.schemas as Rec | undefined;
    const hit = target?.[name];
    return isObj(hit) ? { ...deref(spec, hit, depth + 1), __name: name } : undefined;
  }
  for (const key of ["oneOf", "anyOf", "allOf"] as const) {
    const alts = s[key];
    if (Array.isArray(alts)) {
      const merged: Rec = { ...s };
      delete merged[key];
      for (const alt of alts) {
        const d = deref(spec, alt, depth + 1);
        if (!d) continue;
        if (key === "allOf") Object.assign(merged, d, { properties: { ...(merged.properties as Rec | undefined), ...(d.properties as Rec | undefined) } });
        else if (d.type !== "null" && !("properties" in merged)) return { ...merged, ...d };
      }
      return merged;
    }
  }
  return s;
}

const types = (s: Rec): string[] => (Array.isArray(s.type) ? s.type.map(String) : typeof s.type === "string" ? [s.type] : []);
const COUNT_RE = /\b(count|number of|how many|percent|percentage|days|seconds|milliseconds|basis points|bps|ratio|rate)\b/i;
const MONEY_DESC_RE = /\b(amount|major units|minor units|cents|usd|dollars|currency|price|fee|balance|spend|revenue|budget|earn|payout)\b/i;
const MONEY_KEY = /price|amount|balance|spend|revenue|fee|budget|total|payout|earn/i;
const STATUS_KEY = /(^|_)(status|visibility|state|access_level|delivery_status|result|outcome)$/;

/** The kind the spec settles for one property, or nothing when runtime inference is enough. */
export function kindOf(spec: Rec, key: string, prop: unknown): Kind | undefined {
  const s = deref(spec, prop);
  if (!s) return undefined;
  const desc = typeof s.description === "string" ? s.description : "";
  const t = types(s);
  const name = typeof s.__name === "string" ? s.__name : "";
  if (s.deprecated === true || /\binternal (use|only)\b/i.test(desc)) return "hidden";
  if (key === "id" || /prefixed `[a-z]+_`/.test(desc) || /^[a-z]{2,5}_[A-Za-z0-9]{8,}$/.test(String(s.example ?? ""))) return "id";
  // A currency code rides beside an amount; the amount's cell reads it, the code itself never shows.
  if (key === "currency" && !isObj(s.properties)) return "hidden";
  const props = isObj(s.properties) ? Object.keys(s.properties) : [];
  // Money is `{ amount, currency }` and nothing else of note; a payment carries both and is a record, not an amount.
  if (name === "Money" || (props.length && props.every((k) => ["amount", "currency", "decimals", "display_decimals"].includes(k)) && props.includes("amount"))) return "money";
  // A plan renders through planPrice: its type and prices on one cell.
  if (props.includes("plan_type") && (props.includes("initial_price") || props.includes("renewal_price"))) return "plan";
  if (t.includes("object") && props.includes("id") && (props.includes("title") || props.includes("name") || props.includes("username"))) return "relation";
  if (t.includes("array")) {
    const items = deref(spec, s.items);
    if (items && /Image$/.test(String(items.__name ?? ""))) return "hidden";
    return undefined;
  }
  if (s.format === "date-time" || s.format === "date" || /\bISO 8601\b|\btimestamp\b/i.test(desc)) return "date";
  if (t.includes("string") && Array.isArray(s.enum) && STATUS_KEY.test(key)) return "status";
  if ((t.includes("number") || t.includes("integer")) && (COUNT_RE.test(desc) || /count$|_days$|_seconds$|_ms$|_bps$/.test(key))) return "count";
  if ((t.includes("number") || t.includes("integer") || t.includes("string")) && !COUNT_RE.test(desc) && (MONEY_DESC_RE.test(desc) || MONEY_KEY.test(key)) && !/count$|_days$|_seconds$|_ms$|_bps$|_id$|_url$/.test(key)) {
    // A string is money only when the description says so; a number needs the key or the description.
    if (t.includes("string") && !t.includes("number") && !/\b(amount|major units|minor units|cents|usd|dollars)\b/i.test(desc)) return undefined;
    return "money";
  }
  return undefined;
}

/** The schema the rows of a 200 come from: `data[]` items on a page, `data` on a wrapped record, else the body. */
function rowSchema(spec: Rec, op: Rec): { schema?: Rec; name?: string } {
  const responses = op.responses as Rec | undefined;
  const ok = (responses?.["200"] ?? responses?.["201"]) as Rec | undefined;
  const body = deref(spec, ((ok?.content as Rec | undefined)?.["application/json"] as Rec | undefined)?.schema);
  if (!body) return {};
  const props = body.properties as Rec | undefined;
  const data = props?.data as Rec | undefined;
  if (data && isObj(data)) {
    const d = deref(spec, data);
    if (d && types(d).includes("array")) {
      const items = deref(spec, d.items);
      return { schema: items, name: typeof items?.__name === "string" ? items.__name : undefined };
    }
    if (d && isObj(d.properties)) return { schema: d, name: typeof d.__name === "string" ? d.__name : undefined };
  }
  return { schema: body, name: typeof body.__name === "string" ? body.__name : undefined };
}

export function derive(spec: Rec): Record<string, DerivedHints> {
  const out: Record<string, DerivedHints> = {};
  const paths = spec.paths as Rec;
  for (const [path, ops] of Object.entries(paths)) {
    if (!isObj(ops)) continue;
    for (const [method, op] of Object.entries(ops)) {
      if (!isObj(op) || !["get", "post", "patch", "put", "delete"].includes(method)) continue;
      const cmd = commandFor(method, path);
      if (!cmd) continue;
      const { schema, name } = rowSchema(spec, op);
      if (!schema || !isObj(schema.properties)) continue;
      const kinds: Record<string, Kind> = {};
      for (const [key, prop] of Object.entries(schema.properties as Rec)) {
        const k = kindOf(spec, key, prop);
        if (k) kinds[key] = k;
      }
      if (!Object.keys(kinds).length) continue;
      out[`${cmd[0]} ${cmd[1]}`] = { schema: name, kinds };
    }
  }
  return out;
}

/**
 * `pnpm spec --trim`: drop from every hand hint file the facts the derived kinds already settle (a money key the
 * spec calls money, a status or date or plan key it agrees on, a hidden key it hides), so a hand file only says
 * what the spec cannot. A file left with nothing is deleted. The snapshot tests must not change.
 */
function trim(derived: Record<string, DerivedHints>): { files: number; keysBefore: number; keysAfter: number; deleted: string[] } {
  const dir = join(repo, "src", "hints");
  let files = 0;
  let keysBefore = 0;
  let keysAfter = 0;
  const deleted: string[] = [];
  const count = (h: Rec) => Object.entries(h).reduce((n, [k, v]) => n + (Array.isArray(v) ? v.length : k === "labels" && isObj(v) ? Object.keys(v).length : 1), 0);
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".json") || file.startsWith("_")) continue;
    files++;
    const [group, verb] = file.replace(/\.json$/, "").split(".");
    const hand = JSON.parse(readFileSync(join(dir, file), "utf8")) as Rec;
    keysBefore += count(hand);
    const kinds = (derived[`${group} ${verb ?? "list"}`] ?? derived[`${group} list`] ?? derived[`${group} get`])?.kinds ?? {};
    const out: Rec = { ...hand };
    if (Array.isArray(out.money)) {
      const left = out.money.filter((k) => kinds[String(k)] !== "money");
      if (left.length) out.money = left;
      else delete out.money;
    }
    if (Array.isArray(out.hidden)) {
      const left = out.hidden.filter((k) => kinds[String(k)] !== "hidden");
      if (left.length) out.hidden = left;
      else delete out.hidden;
    }
    for (const [key, kind] of [["status", "status"], ["date", "date"], ["plan", "plan"]] as const) {
      // The date and the status also drive column choice; they stay when the file names columns explicitly, since dropping them changes nothing there, and go otherwise only when the spec agrees.
      if (typeof out[key] === "string" && kinds[out[key] as string] === kind && !(key === "date" && !Array.isArray(out.columns))) delete out[key];
    }
    keysAfter += count(out);
    if (!Object.keys(out).length) {
      unlinkSync(join(dir, file));
      deleted.push(file);
    } else writeFileSync(join(dir, file), JSON.stringify(out, null, 2).replace(/\[\n\s+/g, "[").replace(/,\n\s+(?=[^\]\}]*\])/g, ", ").replace(/\n\s+\]/g, "]") + "\n");
  }
  return { files, keysBefore, keysAfter, deleted };
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const spec = await loadSpec();
  const derived = derive(spec);
  if (process.argv.includes("--trim")) {
    const r = trim(derived);
    console.error(`trimmed ${r.files} hand files: ${r.keysBefore} facts → ${r.keysAfter}; deleted ${r.deleted.length ? r.deleted.join(", ") : "none"}`);
    process.exit(0);
  }
  const file = join(repo, "src", "hints", "_spec.json");
  const sorted = Object.fromEntries(Object.entries(derived).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(file, JSON.stringify(sorted, null, 1) + "\n");
  const cmds = Object.keys(sorted);
  const groups = new Set(cmds.map((c) => c.split(" ")[0]));
  console.error(`${file}: ${cmds.length} commands across ${groups.size} groups, from ${Object.keys(spec.paths as Rec).length} paths`);
  const wanted = process.env.WV_COMMANDS ? readFileSync(process.env.WV_COMMANDS, "utf8").split(/\s+/).filter(Boolean) : [];
  if (wanted.length) {
    const missing = wanted.filter((c) => !sorted[c.replace(":", " ")]);
    console.error(`CLI commands with no derived hints: ${missing.length} of ${wanted.length}`);
    console.error(missing.join(" "));
  }
}
