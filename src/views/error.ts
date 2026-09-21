import type { WhopError } from "../envelope.ts";
import { callout } from "../primitives/callout.ts";
import { paint, type Theme } from "../tokens.ts";
import { padEnd, width, wrap } from "../ansi.ts";
import { copy } from "../copy.ts";
import { rule } from "../primitives/rule.ts";

/** SCOPE_HINTS idea from whop-desktop Panel.tsx: message patterns that imply a fix. */
const PATTERNS: { match: RegExp; code: string }[] = [
  { match: /API-key login|developer:manage_webhook/i, code: "HTTP_403" },
  { match: /Missing required permission/i, code: "HTTP_403" },
  { match: /not logged in|unauthorized/i, code: "HTTP_401" },
  { match: /rate limit|too many requests/i, code: "HTTP_429" },
  { match: /ENOENT|Install it/i, code: "ENOENT" },
];

const UNAVAILABLE = /don't have access|not available|not enabled|internal access|yet\.?$/i;

export function errorView(error: WhopError, theme: Theme): string[] {
  const gated = UNAVAILABLE.test(error.message.split("\n")[0]);
  const code = gated ? "UNAVAILABLE" : copy.error.titles[error.code] ? error.code : (PATTERNS.find((p) => p.match.test(error.message))?.code ?? error.code);
  const title = copy.error.titles[code] ?? copy.dates.titles[code] ?? code;
  const lines: string[] = [];
  const [first, ...rest] = error.message.split("\n").map((l) => l.trim());
  if (error.code === "VALIDATION_ERROR" && error.fieldErrors?.length) {
    for (const f of error.fieldErrors) lines.push(copy.error.field(f.path, f.message));
  } else if (first) lines.push(first);
  // wv's own refusals carry a second line with the hint. Whop's messages carry a JSON dump there; that stays out.
  if (copy.dates.titles[code]) for (const l of rest) if (l) lines.push(paint(theme, "muted", l));

  const scope = /permission: (\S+)/i.exec(error.message)?.[1];
  const fix = copy.error.fixes[code];
  if (fix) {
    lines.push("");
    lines.push(`${paint(theme, "muted", copy.error.fix)}  ${paint(theme, "mono", fix)}${scope ? paint(theme, "muted", `  (needs ${scope})`) : ""}`);
  }
  if (error.cta?.commands?.length) {
    lines.push("");
    lines.push(paint(theme, "muted", error.cta.description ?? copy.error.suggested));
    const cmds = error.cta.commands.map((c) => ({ cmd: humanize(c.command), desc: c.description }));
    const w = Math.max(...cmds.map((c) => width(c.cmd)));
    for (const c of cmds) lines.push("  " + paint(theme, "mono", padEnd(c.cmd, w)) + (c.desc ? "  " + paint(theme, "muted", c.desc) : ""));
  }
  const tag = error.durationMs != null ? `${error.durationMs}ms` : undefined;
  if (gated) {
    // omp's "update available" band: dashed rule, title, one line, dashed rule.
    const body = lines.flatMap((l) => wrap(l, theme.width - 1)).map((l) => " " + l);
    return [rule(theme, undefined, "warn", "╌"), ...wrap(title, theme.width - 1).map((l) => " " + paint(theme, "warn", l)), ...body, rule(theme, undefined, "warn", "╌")];
  }
  return callout("bad", title, lines, theme, tag);
}

/** The CLI suggests its own agent form. People get the human form. */
export const humanize = (cmd: string) => cmd.replace(/\s--format json/g, "").replace(/\s--full-output/g, "");
