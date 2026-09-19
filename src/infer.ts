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
]);

const ID_RE = /^[a-z]{2,5}_[A-Za-z0-9]{8,}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;
const MONEY_KEY = /price|amount|balance|spend|revenue|fee|budget|total|payout|earn/i;

const isObj = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);
const isMoneyObj = (v: unknown): v is Money => isObj(v) && "amount" in v && "currency" in v && typeof v.currency === "string";
const isEmpty = (v: unknown) => v == null || v === "" || (Array.isArray(v) && v.length === 0) || (isObj(v) && Object.keys(v).length === 0);

const cell = (kind: Kind, short: string, long = short, role: Role = "text", align: "left" | "right" = "left", extra?: [string, string][]): Cell => ({ kind, short, long, role, align, extra });

export function labelFor(key: string, hints: Hints): string {
  return hints.labels?.[key] ?? key.replace(/_at$/, "").replace(/_id$/, "").replace(/_/g, " ");
}

export function summarize(v: Rec): string {
  const name = (v.title ?? v.name ?? v.username ?? v.line_type ?? v.key) as string | undefined;
  return name ? String(name) : String(v.id ?? "");
}

/** Classify one field. */
export function infer(key: string, value: unknown, row: Rec, hints: Hints): Cell {
  // 1 hidden
  if (HIDDEN.has(key) || hints.hidden?.includes(key) || key.endsWith("_decimals")) return cell("hidden", "");
  // 15 empty (early so nulls don't fall through)
  if (isEmpty(value)) return cell("empty", copy.detail.empty, "", "muted");
  // plan (hint) → planPrice
  if (hints.plan === key && isObj(value)) {
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
  // 7 status, ahead of ids: "needs_response" matches the id shape
  if ((key === "status" || key === "visibility" || key === "access_level" || hints.status === key) && typeof value === "string" && value.length < 20) {
    return cell("status", statusLabel(value), statusLabel(value), statusRole(value));
  }
  // 2 id
  if (typeof value === "string" && ID_RE.test(value)) return cell("id", value, value, "mono");
  // 3 money object
  if (isMoneyObj(value)) return cell("money", money(value), money(value), "text", "right");
  // 4 money number
  const hinted = hints.money?.includes(key);
  if ((hinted || MONEY_KEY.test(key)) && typeof value === "number" && !/count|days|percentage|level/i.test(key)) {
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
    const extra: [string, string][] = value.slice(0, 5).map((x, i) => [String(i + 1), summarize(x as Rec)]);
    return cell("objects", `${n} ${labelFor(key, hints)}`, `${n} ${labelFor(key, hints)}`, "text", "left", extra);
  }
  // nested object without a name: flatten to extra lines in detail
  if (isObj(value)) {
    const extra: [string, string][] = Object.entries(value)
      .filter(([k, v]) => !HIDDEN.has(k) && !isEmpty(v))
      .slice(0, 8)
      .map(([k, v]) => [labelFor(k, hints), infer(k, v, value, hints).long || String(v)]);
    const label = typeof value.id === "string" ? value.id : `${Object.keys(value).length} fields`;
    return cell("objects", label, label, "muted", "left", extra);
  }
  // 14 long text
  if (typeof value === "string" && value.length > 60) return cell("long", "", value);
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
    add(hints.relation ?? RELATION_KEYS.find((k) => keys.includes(k) && (kinds.get(k) === "relation" || kinds.get(k) === "user")), 5);
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
