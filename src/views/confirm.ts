import { infer } from "../infer.ts";
import type { Hints } from "../hints.ts";
import { callout } from "../primitives/callout.ts";
import { kv } from "../primitives/kv.ts";
import { paint, type Role, type Theme } from "../tokens.ts";
import { copy } from "../copy.ts";
import { DESTRUCTIVE_VERBS, MONEY_GROUPS } from "../status.ts";
import { money } from "../format.ts";

export interface ConfirmInput {
  group: string;
  verb: string;
  argv: string[];
  hints: Hints;
  accountTitle?: string;
  accountId?: string;
}

/** Turns `--flag value` pairs into a record. Bare flags become true. */
export function flagsToRecord(argv: string[]): Record<string, unknown> {
  const rec: Record<string, unknown> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq > 0) {
      rec[a.slice(2, eq)] = coerce(a.slice(eq + 1));
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      rec[a.slice(2)] = coerce(next);
      i++;
    } else rec[a.slice(2)] = true;
  }
  return rec;
}

const coerce = (s: string): unknown => (s === "true" ? true : s === "false" ? false : /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s);

export function confirmView(input: ConfirmInput, theme: Theme): string[] {
  const { group, verb, argv, hints } = input;
  const isMoney = MONEY_GROUPS.has(group);
  const role: Role = isMoney || DESTRUCTIVE_VERBS.has(verb) ? "bad" : "warn";
  const flags = flagsToRecord(argv);
  const positional = argv.slice(2).find((a) => !a.startsWith("--") && !Object.values(flags).some((v) => String(v) === a));

  const rows: { key: string; value: string; role?: Role }[] = [];
  if (positional) rows.push({ key: "target", value: positional, role: "muted" });
  const currency = typeof flags.currency === "string" ? flags.currency : "usd";
  for (const [k, v] of Object.entries(flags)) {
    if (k === "yes" || k === "idempotency-key") continue;
    if (k === "currency" && "amount" in flags) continue;
    const cell = infer(k, v, flags, hints);
    let value = cell.kind === "hidden" ? String(v) : cell.long || cell.short;
    if (k === "amount" && typeof v === "number") value = `${money(v, currency)} ${currency}`;
    rows.push({ key: k.replace(/_/g, " "), value, role: cell.role });
  }
  if (input.accountTitle) rows.push({ key: "from", value: `${input.accountTitle}  ${input.accountId ?? ""}`.trim() });

  const cmd = ["whop", ...argv.filter((a) => a !== "--yes")].join(" ");
  const out = callout(role, copy.confirm.title(group, verb), [paint(theme, "mono", cmd)], theme, copy.confirm.badge);
  out.push("");
  out.push(...kv([{ rows }], theme));
  out.push("");
  out.push("   " + paint(theme, "muted", copy.confirm.warning + (isMoney ? " " + copy.confirm.money : "")));
  out.push("");
  return out;
}
