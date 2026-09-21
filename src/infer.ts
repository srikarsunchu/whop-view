// The 16 inference rules from VIEWS.md. Pure: data in, cells out.
import { longDate, money, planPrice, relative, titleCase, type Money } from "./format.ts";
import { statusLabel, statusRole } from "./status.ts";
import type { Hints } from "./hints.ts";
import type { Rec } from "./envelope.ts";
import type { Role } from "./tokens.ts";
import { copy } from "./copy.ts";

export type Kind = "hidden" | "id" | "money" | "date" | "status" | "bool" | "relation" | "user" | "image" | "list" | "objects" | "text" | "long" | "empty" | "scalar" | "plan";

export interface Cell {
  kind: Kind;
  /** Short form for tables. */
  short: string;
  /** Long form for detail cards. */
  long: string;
  role: Role;
  align: "left" | "right";
  /** Extra detail lines under the long form (nested objects). */
  extra?: [string, string][];
}

export const HIDDEN = new Set([
  "object", "metadata", "recommended_action", "previous_hosted_urls", "businesses_created_logo_urls",
  "checkout_styling", "payment_method_configuration", "custom_fields", "gallery_images",
  "last_ip", "ip_address", "user_agent", "phone", "phone_number", "phones", "icons", "issuer_identification_number",
]);

/** Whop ids: short prefix, underscore, 8+ mixed characters with at least one digit or capital. The
 *  capital-or-digit requirement keeps snake_case words like `tax_behavior` from reading as ids. */
export const ID_RE = /^[a-z]{2,5}_(?=[a-z]*[A-Z0-9])[A-Za-z0-9]{8,}$/;
/** Credentials never render, in any view. `hasSecret` is a boolean and does not match. */
const SECRET_RE = /(^|_)(token|secret|password|private_key|client_secret)$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;
const MONEY_KEY = /price|amount|balance|spend|revenue|fee|budget|total|payout|earn/i;

const isObj = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);
const isMoneyObj = (v: unknown): v is Money => isObj(v) && "amount" in v && "currency" in v && typeof v.currency === "string";
const isEmpty = (v: unknown) => v == null || v === "" || (Array.isArray(v) && v.length === 0) || (isObj(v) && Object.keys(v).length === 0);

const cell = (kind: Kind, short: string, long = short, role: Role = "text", align: "left" | "right" = "left", extra?: [string, string][]): Cell => ({ kind, short, long, role, align, extra });

export function labelFor(key: string, hints: Hints): string {
  return (
    hints.labels?.[key] ??
    key
      .replace(/_at$/, "")
      .replace(/_id$/, "")
      // `member_count` is the members column; `published_reviews_count` the published reviews.
      .replace(/^(.*?)(s)?_count$/, "$1s")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .replace(/_/g, " ")
  );
}

export function summarize(v: Rec): string {
  const name = (v.title ?? v.name ?? v.username ?? v.line_type ?? v.key) as string | undefined;
  return name ? String(name) : String(v.id ?? "");
}

/** Classify one field. */
export function infer(key: string, value: unknown, row: Rec, hints: Hints): Cell {
  // 1 hidden
  const spec = hints.kinds?.[key];
  if (HIDDEN.has(key) || hints.hidden?.includes(key) || spec === "hidden" || key.endsWith("_decimals") || SECRET_RE.test(key)) return cell("hidden", "");
  // 15 empty (early so nulls don't fall through)
  if (isEmpty(value)) return cell("empty", copy.detail.empty, "", "muted");
  // plan (hint, or the spec's word) → planPrice
  if ((hints.plan === key || spec === "plan") && isObj(value)) {
    const price = planPrice(value as Parameters<typeof planPrice>[0]);
    return cell("plan", price, `${price}  ${value.id ?? ""}`.trim(), "text", "left");
  }
  // 5 ledger amount: sibling usd_amount wins
  if (key === "amount" && typeof row.usd_amount === "string") {
    const n = Number(row.usd_amount);
    return cell("money", money(n), money(n), n < 0 ? "bad" : "text", "right");
  }
  if (key === "usd_amount" && "amount" in row) return cell("hidden", "");
  if (key === "currency" && isObj(value) && "precision" in value) return cell("hidden", "");
  // 5b the spec's word: a kind the OpenAPI schema settles, ahead of every guess below and after the ledger's own amount rule. Only the kinds a guess could get wrong.
  if (spec === "count" && typeof value === "number") return cell("scalar", String(value), String(value), "text", "right");
  if (spec === "money" && typeof value === "number") {
    const pre = hints.formatted?.[key];
    const str = pre && typeof row[pre] === "string" ? (row[pre] as string) : money(value, typeof row.currency === "string" ? row.currency : "usd");
    return cell("money", str, str, "text", "right");
  }
  if (spec === "money" && typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
    const n = Number(value);
    const str = money(n, typeof row.currency === "string" ? row.currency : "usd");
    return cell("money", str, str, n < 0 ? "bad" : "text", "right");
  }
  if (spec === "status" && typeof value === "string" && value.length < 40) return cell("status", statusLabel(value), statusLabel(value), statusRole(value));
  if (spec === "date" && ((typeof value === "string" && ISO_RE.test(value)) || typeof value === "number")) {
    return cell("date", relative(value as string | number), `${longDate(value as string | number)} · ${relative(value as string | number)}`, "text");
  }
  // 7 status, ahead of ids: "needs_response" matches the id shape
  if ((key === "status" || key === "visibility" || key === "access_level" || hints.status === key) && typeof value === "string" && value.length < 20) {
    return cell("status", statusLabel(value), statusLabel(value), statusRole(value));
  }
  // A boolean the hints call the status (`success` on a webhook delivery) reads ok or failed, not yes or no.
  if (hints.status === key && typeof value === "boolean") {
    const label = value ? copy.detail.ok : copy.detail.failed;
    return cell("status", label, label, value ? "good" : "bad");
  }
  // 2 id
  if (typeof value === "string" && ID_RE.test(value)) return cell("id", value, value, "mono");
  // 3 money object
  if (isMoneyObj(value)) return cell("money", money(value), money(value), "text", "right");
  // 4 money number
  const hinted = hints.money?.includes(key);
  // `total_time` and `cpu_time_ms` match /total/ and /fee/ by accident; durations are never money.
  if ((hinted || MONEY_KEY.test(key)) && typeof value === "number" && !/count|days|percentage|level|rate$|ratio|^return_on|_time$|_ms$|_seconds$/i.test(key)) {
    const pre = hints.formatted?.[key];
    const str = pre && typeof row[pre] === "string" ? (row[pre] as string) : money(value, typeof row.currency === "string" ? row.currency : "usd");
    return cell("money", str, str, "text", "right");
  }
  if (typeof value === "string" && (hinted || MONEY_KEY.test(key)) && /^-?\d+(\.\d+)?$/.test(value)) {
    const n = Number(value);
    return cell("money", money(n), money(n), n < 0 ? "bad" : "text", "right");
  }
  if (key === "formatted_price" || key === "currency") return cell("hidden", "");
  // 6 date
  if ((typeof value === "string" && ISO_RE.test(value) && value.length >= 10) || (key.endsWith("_at") && typeof value === "number")) {
    return cell("date", relative(value as string | number), `${longDate(value as string | number)} · ${relative(value as string | number)}`, "text");
  }
  // 8 bool
  if (typeof value === "boolean") return cell("bool", value ? copy.detail.yes : copy.detail.no, value ? copy.detail.yes : copy.detail.no, value ? "text" : "muted");
  // 10 user
  if (isObj(value) && typeof value.username === "string") {
    const name = (value.name as string | undefined) ?? "";
    const short = name ? `${name} @${value.username}` : `@${value.username}`;
    return cell("user", short, `${short}  ${value.id ?? ""}`.trim());
  }
  // 9 relation
  if (isObj(value) && typeof value.id === "string" && (value.title || value.name || value.username)) {
    const t = summarize(value);
    return cell("relation", t, `${t}  ${value.id}`);
  }
  // 11 image
  if (isObj(value) && Object.keys(value).length === 1 && typeof value.url === "string") return cell("image", "", value.url, "muted");
  // 12 array of scalars
  if (Array.isArray(value) && value.every((x) => !isObj(x))) {
    const n = value.length;
    return cell("list", `${n} ${labelFor(key, hints)}`, value.map(String).join(", "));
  }
  // 13 array of objects
  if (Array.isArray(value)) {
    const n = value.length;
    const extra: [string, string][] = value
      .slice(0, 5)
      .map((x, i): [string, string] => [String(i + 1), summarize(x as Rec)])
      .filter(([, v]) => v.trim());
    return cell("objects", `${n} ${labelFor(key, hints)}`, `${n} ${labelFor(key, hints)}`, "text", "left", extra.length ? extra : undefined);
  }
  // an object that is only an id (`ad_campaign: { id }`) is a bare relation, not a card
  if (isObj(value) && Object.keys(value).length === 1 && typeof value.id === "string") return cell("id", value.id, value.id, "mono");
  // nested object without a name: flatten to extra lines in detail, two levels deep
  if (isObj(value)) {
    const extra: [string, string][] = [];
    const walk = (obj: Rec, prefix: string) => {
      for (const [k, v] of Object.entries(obj)) {
        if (extra.length >= 8) return;
        const c = infer(k, v, obj, hints);
        if (c.kind === "hidden" || c.kind === "empty") continue;
        if (isObj(v) && !prefix && !("id" in v) && !c.long.trim()) walk(v, labelFor(k, hints) + " ");
        else if (isObj(v) && !prefix && c.kind === "objects") walk(v, labelFor(k, hints) + " ");
        else extra.push([prefix + labelFor(k, hints), c.long || String(v)]);
      }
    };
    walk(value, "");
    const label = typeof value.id === "string" ? value.id : extra.length ? "" : `${Object.keys(value).length} fields`;
    return cell("objects", label || `${Object.keys(value).length} fields`, label, "muted", "left", extra);
  }
  // 14 long text. Emails ride along: detail only, never a list column.
  if (typeof value === "string" && (value.length > 60 || /email/.test(key))) return cell("long", "", value);
  // 16 scalar
  if (typeof value === "number") return cell("scalar", String(value), String(value), "text", "right");
  const s = String(value);
  return cell("text", key === "line_type" || key === "plan_type" ? titleCase(s) : s, s);
}

export interface Column {
  key: string;
  label: string;
  priority: number;
}

const PRIMARY_KEYS = ["title", "name", "user", "member", "plan_name", "product_name", "line_type", "key", "id"];
const RELATION_KEYS = ["product", "plan", "user", "creator", "account"];

/** Default list columns in priority order, per VIEWS.md. */
export function chooseColumns(rows: Rec[], hints: Hints, breakpoint: "narrow" | "normal" | "wide"): Column[] {
  if (rows.length === 0) return [];
  const sample = rows[0];
  const keys = Object.keys(sample);
  const kinds = new Map<string, Kind>();
  for (const k of keys) {
    // Kind of the first non-empty value across rows, so a null in row 0 doesn't hide a column.
    const r = rows.find((x) => !isEmpty(x[k])) ?? sample;
    kinds.set(k, infer(k, r[k], r, hints).kind);
  }
  const cols: Column[] = [];
  const add = (key: string | undefined, priority: number) => {
    if (!key || !keys.includes(key) || cols.some((c) => c.key === key)) return;
    if (kinds.get(key) === "hidden") return;
    cols.push({ key, label: labelFor(key, hints), priority });
  };
  if (hints.columns) {
    hints.columns.forEach((k, i) => add(k, i === 0 || k === "id" ? 0 : i));
  } else {
    const primary = hints.primary ?? PRIMARY_KEYS.find((k) => keys.includes(k) && kinds.get(k) !== "hidden" && kinds.get(k) !== "empty") ?? keys[0];
    add(primary, 0);
    add(hints.status ?? keys.find((k) => kinds.get(k) === "status"), 2);
    add(hints.plan, 3);
    add(hints.money?.[0] ?? keys.find((k) => kinds.get(k) === "money" || kinds.get(k) === "plan"), 3);
    add(hints.date ?? (keys.includes("created_at") ? "created_at" : keys.find((k) => kinds.get(k) === "date")), 4);
    // A relation that is the same on every row says nothing: an account-scoped list carries the account on each row.
    const constant = (k: string) => rows.length > 1 && rows.every((r) => JSON.stringify(r[k]) === JSON.stringify(rows[0][k]));
    add(hints.relation ?? RELATION_KEYS.find((k) => keys.includes(k) && (kinds.get(k) === "relation" || kinds.get(k) === "user") && !constant(k)), 5);
    // A `<thing>_name` string is the relation spelled out: `product_name` on a ledger line, `plan_name` on a member.
    if (!hints.relation) add(keys.find((k) => /_name$/.test(k) && kinds.get(k) === "text" && !cols.some((c) => c.key === k)), 5);
    if (breakpoint === "wide") {
      add(keys.find((k) => /member_count|count$/.test(k)), 7);
      add(keys.find((k) => kinds.get(k) === "money" && !cols.some((c) => c.key === k)), 7);
    }
  }
  add("id", 0);
  const cap = breakpoint === "wide" ? 8 : 6;
  if (cols.length <= cap) return cols;
  // Under the cap, the id column is always the one kept last.
  const id = cols.find((c) => c.key === "id");
  const rest = cols.filter((c) => c !== id).slice(0, id ? cap - 1 : cap);
  return id ? [...rest, id] : rest;
}
