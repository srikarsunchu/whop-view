import type { WhopError } from "../envelope.ts";
import { callout } from "../primitives/callout.ts";
import { paint, type Theme } from "../tokens.ts";
import { padEnd, width, wrap } from "../ansi.ts";
import { copy } from "../copy.ts";
import { rule } from "../primitives/rule.ts";
import { footer } from "../primitives/footer.ts";

/** SCOPE_HINTS idea from whop-desktop Panel.tsx: message patterns that imply a fix. */
const PATTERNS: { match: RegExp; code: string }[] = [
  { match: /API-key login|developer:manage_webhook|account-scoped credential/i, code: "HTTP_403" },
  { match: /Missing required permission/i, code: "HTTP_403" },
  { match: /not logged in|unauthorized/i, code: "HTTP_401" },
  { match: /rate limit|too many requests/i, code: "HTTP_429" },
  { match: /ENOENT|Install it/i, code: "ENOENT" },
];

const UNAVAILABLE = /don't have access|not available|not enabled|internal access|yet\.?$/i;

/** What unlocks a gate, when wv knows. Matched against the message; verified against the CLI on 2026-09-21. */
export interface Gate {
  match: RegExp;
  /** The command that turns it on, when the CLI has one. */
  fix?: string[];
  note: string;
}

export const GATES: Gate[] = [
  { match: /economic intelligence|recommended actions?/i, fix: ["whop", "accounts", "update-preferences", "--economic_intelligence", "true"], note: copy.error.gates.preference },
  { match: /whop internal access|internal access/i, note: copy.error.gates.internal },
  { match: /rain account/i, fix: ["whop", "verifications", "create", "--account_id", "<biz_id>"], note: copy.error.gates.cards },
];

/** The gate a message names, or the generic one for a "don't have access yet" nobody has mapped. */
export function gateFor(message: string): Gate | undefined {
  const first = message.split("\n")[0];
  const known = GATES.find((g) => g.match.test(first));
  if (known) return known;
  return UNAVAILABLE.test(first) ? { match: UNAVAILABLE, note: copy.error.gates.unknown } : undefined;
}

export function errorView(error: WhopError, theme: Theme): string[] {
  const gate = gateFor(error.message);
  const gated = !!gate;
  // A message that names its own cause wins over the HTTP code: "account-scoped credential" arrives as a 400.
  const code = gated ? "UNAVAILABLE" : (PATTERNS.find((p) => p.match.test(error.message))?.code ?? error.code);
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
  if (gate) {
    // omp's "update available" band: dashed rule, title, the message, what unlocks it, dashed rule.
    const body = lines.flatMap((l) => wrap(l, theme.width - 1)).map((l) => " " + l);
    const unlock = wrap(gate.note, theme.width - 1).map((l) => " " + paint(theme, "muted", l));
    const fixLine = gate.fix ? footer([[copy.error.fix, gate.fix]], theme) : [];
    return [rule(theme, undefined, "warn", "╌"), ...wrap(title, theme.width - 1).map((l) => " " + paint(theme, "warn", l)), ...body, ...unlock, ...fixLine, rule(theme, undefined, "warn", "╌")];
  }
  return callout("bad", title, lines, theme, tag);
}

/** The CLI suggests its own agent form. People get the human form. */
export const humanize = (cmd: string) => cmd.replace(/\s--format json/g, "").replace(/\s--full-output/g, "");
