import { padEnd, width, wrap } from "../ansi.ts";
import { INDENT, paint, type Role, type Theme } from "../tokens.ts";
import { rule } from "./rule.ts";

export interface KvRow {
  key: string;
  value: string;
  role?: Role;
  /** Indented sub-rows under this value. */
  extra?: [string, string][];
}

export interface KvSection {
  title?: string;
  rows: KvRow[];
}

/** Key-value card. Keys pad to the longest key in the section; values wrap. */
export function kv(sections: KvSection[], theme: Theme): string[] {
  const out: string[] = [];
  for (const s of sections) {
    if (s.rows.length === 0) continue;
    if (out.length) out.push("");
    if (s.title) out.push(rule(theme, s.title));
    const keyW = Math.max(...s.rows.map((r) => width(r.key)));
    const valW = Math.max(16, theme.width - INDENT.length - 1 - keyW - 2);
    for (const r of s.rows) {
      const lines = wrap(r.value, valW);
      out.push(" " + INDENT + paint(theme, "muted", padEnd(r.key, keyW)) + "  " + paint(theme, r.role ?? "text", lines[0] ?? ""));
      for (const l of lines.slice(1)) out.push(" " + INDENT + " ".repeat(keyW + 2) + paint(theme, r.role ?? "text", l));
      if (r.extra) {
        const subW = Math.max(...r.extra.map(([k]) => width(k)));
        for (const [k, v] of r.extra) {
          out.push(" " + INDENT + " ".repeat(keyW + 2) + paint(theme, "muted", padEnd(k, subW)) + "  " + v);
        }
      }
    }
  }
  return out;
}
