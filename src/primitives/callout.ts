import { padEnd, width, wrap } from "../ansi.ts";
import { INDENT, paint, type Role, type Theme } from "../tokens.ts";

/** One-character gutter in the role color, bold title, optional right-aligned tag, wrapped body. */
export function callout(role: Role, title: string, lines: string[], theme: Theme, tag?: string): string[] {
  const out: string[] = [];
  const bar = paint(theme, role, "▌");
  const head = paint(theme, "accent", title);
  if (tag) {
    const gap = theme.width - 2 - width(title) - width(tag) - 1;
    out.push(` ${bar} ${head}${" ".repeat(Math.max(1, gap))}${paint(theme, role === "text" ? "muted" : role, tag)}`);
  } else out.push(` ${bar} ${head}`);
  out.push("");
  for (const l of lines) {
    if (l === "") {
      out.push("");
      continue;
    }
    for (const w of wrap(l, theme.width - INDENT.length - 2)) out.push(" " + INDENT + padEnd(w, 0));
  }
  return out;
}
