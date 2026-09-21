// `memberships check <license_key>`: is this key good. `memberships get` accepts a software license key
// in place of the membership id (its own schema says so), so the check is that call plus a verdict.
import type { Parsed, Rec } from "../envelope.ts";
import { longDate, relative } from "../format.ts";
import { footer } from "../primitives/footer.ts";
import { kv, type KvRow } from "../primitives/kv.ts";
import { teach } from "../argv.ts";
import { paint, type Theme } from "../tokens.ts";
import { truncate, width } from "../ansi.ts";
import { copy } from "../copy.ts";
import { statusLabel, statusRole } from "../status.ts";

/** Statuses under which the key still grants access. `completed` is a paid one-time purchase; `canceling` runs to period end. */
export const VALID_STATUSES = new Set(["active", "trialing", "completed", "canceling"]);

export interface LicenseInput {
  key: string;
  /** `memberships get <key>` */
  membership: Parsed;
  argv: string[];
}

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const isObj = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);

export type Verdict = "valid" | "invalid" | "unknown";

/** The verdict from the response: a known status decides; a 404 is invalid; anything else is unknown. */
export function verdict(p: Parsed): Verdict {
  if (!p.ok) return p.error.code === "HTTP_404" ? "invalid" : "unknown";
  if (!("record" in p.payload)) return "unknown";
  const status = str(p.payload.record.status);
  if (!status) return "unknown";
  return VALID_STATUSES.has(status) ? "valid" : "invalid";
}

/** Exit code: 0 valid, 1 invalid, 2 when the answer could not be read. */
export const exitCodeFor = (v: Verdict) => (v === "valid" ? 0 : v === "invalid" ? 1 : 2);

/** The expiry line: the period end with how far off it is, or `never` for a one-time purchase. */
export function expiryLine(m: Rec): { text: string; role: "text" | "warn" | "bad" | "muted" } {
  const end = str(m.current_period_end);
  if (!end) return { text: copy.license.noExpiry, role: "muted" };
  // Ahead or behind is decided by the formatter's clock, so tests pin it.
  const rel = relative(end);
  const future = rel.startsWith("in ");
  const cancel = m.cancel_at_period_end === true;
  return { text: `${longDate(end)} · ${rel}${cancel ? ` · ${copy.license.cancels}` : ""}`, role: !future ? "bad" : cancel ? "warn" : "text" };
}

/** Rows for the membership behind a key: status, product, plan, expiry, user, membership. */
export function licenseRows(m: Rec): KvRow[] {
  const c = copy.license;
  const status = str(m.status) ?? "";
  const rows: KvRow[] = [{ key: c.status, value: statusLabel(status) || copy.detail.empty, role: statusRole(status) }];
  const rel = (label: string, obj: unknown, id: unknown) => {
    const o = isObj(obj) ? obj : undefined;
    const title = str(o?.title) ?? str(o?.name);
    const ident = str(o?.id) ?? str(id);
    if (title || ident) rows.push({ key: label, value: [title, ident].filter(Boolean).join("  "), role: title ? "text" : "muted" });
  };
  rel(c.product, m.product, m.product_id);
  rel(c.plan, m.plan, m.plan_id);
  const exp = expiryLine(m);
  rows.push({ key: c.expires, value: exp.text, role: exp.role });
  const member = isObj(m.member) ? m.member : undefined;
  const user = member && isObj(member.user) ? member.user : undefined;
  const userName = str(user?.username) ? `@${user!.username}` : undefined;
  const userId = str(user?.id) ?? str(m.user_id);
  if (userName || userId) rows.push({ key: c.user, value: [userName, userId].filter(Boolean).join("  "), role: userName ? "text" : "muted" });
  if (str(m.id)) rows.push({ key: c.membership, value: m.id as string, role: "muted" });
  return rows;
}

export function licenseView(input: LicenseInput, theme: Theme): string[] {
  const c = copy.license;
  const v = verdict(input.membership);
  const badge = v === "valid" ? paint(theme, "good", c.valid) : v === "invalid" ? paint(theme, "bad", c.invalid) : paint(theme, "warn", c.unknown);
  // The key gives way first, so the verdict is always on the first line, right-aligned.
  const keyRoom = theme.width - 1 - (1 + width(c.title) + 2) - (2 + width(badge));
  const head = " " + paint(theme, "accent", c.title) + "  " + paint(theme, "muted", truncate(input.key, Math.max(8, keyRoom)));
  const gap = Math.max(2, theme.width - 1 - width(head) - width(badge));
  const out: string[] = [head + " ".repeat(gap) + badge, ""];
  const p = input.membership;
  if (p.ok && "record" in p.payload) out.push(...kv([{ rows: licenseRows(p.payload.record) }], theme));
  else if (!p.ok) out.push(" " + paint(theme, v === "invalid" ? "bad" : "warn", v === "invalid" ? c.notFound : `${p.error.code} ${p.error.message.split("\n")[0]}`));
  out.push("");
  out.push(...footer([[copy.list.json, teach(input.argv, "--filter-output", "status,product_id,plan_id,current_period_end,cancel_at_period_end,user_id,id")]], theme));
  return out;
}
