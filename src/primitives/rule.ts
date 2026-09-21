import { width } from "../ansi.ts";
import { paint, type Role, type Theme } from "../tokens.ts";

/** A horizontal rule with an optional title set into it: ` ── Status ──────────`. */
export function rule(theme: Theme, title?: string, role: Role = "muted", char = "─"): string {
  const w = theme.width - 1;
  if (!title) return " " + paint(theme, role, char.repeat(w));
  const head = char.repeat(2) + " " + title + " ";
  const rest = Math.max(0, w - width(head));
  return " " + paint(theme, role, char.repeat(2) + " ") + paint(theme, "accent", title) + paint(theme, role, " " + char.repeat(rest));
}

/** omp-style breadcrumb: segments joined by a muted chevron. Wraps onto further lines at width. */
export function breadcrumb(theme: Theme, segments: [text: string, role?: Role][]): string[] {
  const sep = paint(theme, "muted", " › ");
  const lines: string[] = [];
  let line = "";
  for (const [t, r] of segments) {
    if (!t) continue;
    const piece = paint(theme, r ?? "text", t);
    if (line && width(line) + 3 + width(t) > theme.width - 1) {
      lines.push(" " + line);
      line = piece;
    } else line = line ? line + sep + piece : piece;
  }
  if (line) lines.push(" " + line);
  return lines;
}
