import { truncate, wrap } from "../ansi.ts";
import { shellJoin } from "../argv.ts";
import { paint, type Theme } from "../tokens.ts";

export type FooterLine = string | [label: string, command: string | readonly string[]];

/**
 * Muted footer lines. A `label  command` pair paints the command mono and wraps with a hanging indent.
 * A command given as argv is shell-quoted here, so a title with a space or a quote pastes back correctly.
 */
export function footer(lines: FooterLine[], theme: Theme): string[] {
  const out: string[] = [];
  for (const l of lines) {
    if (typeof l === "string") {
      out.push(" " + paint(theme, "muted", truncate(l, theme.width - 1)));
      continue;
    }
    const [label, command] = l;
    const cmd = typeof command === "string" ? command : shellJoin(command);
    const hang = " ".repeat(label.length + 3);
    const parts = wrap(cmd, theme.width - hang.length);
    out.push(" " + paint(theme, "muted", label) + "  " + paint(theme, "mono", parts[0] ?? ""));
    for (const p of parts.slice(1)) out.push(hang + paint(theme, "mono", p));
  }
  return out;
}
