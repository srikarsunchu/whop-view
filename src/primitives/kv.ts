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

/** Values narrower than this stack under their key instead of beside it. */
const MIN_VALUE_WIDTH = 16;

/**
 * Key-value card. Keys pad to the longest key in the section; values wrap beside them.
 * When the terminal is too narrow to leave a value MIN_VALUE_WIDTH columns, the section
 * stacks: key on one line, value indented on the next. Nothing exceeds the width.
 */
export function kv(sections: KvSection[], theme: Theme): string[] {
  const out: string[] = [];
  const room = theme.width - INDENT.length - 1;
  for (const s of sections) {
    if (s.rows.length === 0) continue;
    if (out.length) out.push("");
    if (s.title) out.push(rule(theme, s.title));
    const keyW = Math.max(...s.rows.map((r) => width(r.key)));
    const beside = room - keyW - 2 >= MIN_VALUE_WIDTH;
    const valW = beside ? room - keyW - 2 : Math.max(1, room - INDENT.length);
    const lead = beside ? " ".repeat(keyW + 2) : INDENT;
    for (const r of s.rows) {
      const lines = wrap(r.value, valW);
      const role = r.role ?? "text";
      if (beside) out.push(" " + INDENT + paint(theme, "muted", padEnd(r.key, keyW)) + "  " + paint(theme, role, lines[0] ?? ""));
      else {
        out.push(" " + INDENT + paint(theme, "muted", r.key));
        if (lines[0]) out.push(" " + INDENT + lead + paint(theme, role, lines[0]));
      }
      for (const l of lines.slice(1)) out.push(" " + INDENT + lead + paint(theme, role, l));
      if (r.extra) {
        const subW = Math.max(...r.extra.map(([k]) => width(k)));
        const subRoom = Math.max(1, room - lead.length - subW - 2);
        for (const [k, v] of r.extra) {
          const [first, ...rest] = wrap(v, subRoom);
          out.push(" " + INDENT + lead + paint(theme, "muted", padEnd(k, subW)) + "  " + (first ?? ""));
          for (const l of rest) out.push(" " + INDENT + lead + " ".repeat(subW + 2) + l);
        }
      }
    }
  }
  return out;
}
