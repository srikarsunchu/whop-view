import { truncate, wrap } from "../ansi.ts";
import { paint, type Theme } from "../tokens.ts";

/** Muted footer lines. A `label  command` pair paints the command mono and wraps with a hanging indent. */
export function footer(lines: (string | [label: string, command: string])[], theme: Theme): string[] {
  const out: string[] = [];
  for (const l of lines) {
    if (typeof l === "string") {
      out.push(" " + paint(theme, "muted", truncate(l, theme.width - 1)));
      continue;
    }
    const [label, cmd] = l;
    const hang = " ".repeat(label.length + 3);
    const parts = wrap(cmd, theme.width - hang.length);
    out.push(" " + paint(theme, "muted", label) + "  " + paint(theme, "mono", parts[0] ?? ""));
    for (const p of parts.slice(1)) out.push(hang + paint(theme, "mono", p));
  }
  return out;
}
