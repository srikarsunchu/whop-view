import { infer } from "../infer.ts";
import type { Hints } from "../hints.ts";
import { callout } from "../primitives/callout.ts";
import { footer } from "../primitives/footer.ts";
import { kv, type KvRow } from "../primitives/kv.ts";
import { paint, type Role, type Theme } from "../tokens.ts";
import { copy, type Mode } from "../copy.ts";
import { DESTRUCTIVE_VERBS, MONEY_GROUPS } from "../status.ts";
import { money } from "../format.ts";
import { wrap } from "../ansi.ts";
import { shellJoin } from "../argv.ts";
import type { Rec } from "../envelope.ts";

export interface Balance {
  available: number;
  currency: string;
}

export interface ConfirmInput {
  group: string;
  verb: string;
  argv: string[];
  hints: Hints;
  accountTitle?: string;
  accountId?: string;
  /** `sandbox` when wv is pointed at the sandbox host. Default production. */
  mode?: Mode;
  /** Where the money goes: the saved payout method behind `--payout_method_id`, if wv could find it. */
  destination?: string;
  /** The ledger the payout draws from, in the payout's currency. */
  balance?: Balance;
  /** Per-payout cap in whole currency units. `null` when turned off. Absent for non-money writes. */
  cap?: number | null;
  /** How long the prompt stays open, in seconds. Absent means it waits. */
  timeoutSeconds?: number;
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

/** The amount and currency a money command names, or null when it names none. */
export function moneyOf(argv: string[]): { amount: number; currency: string } | null {
  const flags = flagsToRecord(argv);
  if (typeof flags.amount !== "number") return null;
  return { amount: flags.amount, currency: typeof flags.currency === "string" ? flags.currency.toLowerCase() : "usd" };
}

/** One line for a saved payout method: nickname or bank, then the last digits. Falls back to the id. */
export function describeMethod(m: Rec | undefined, id: string): string {
  if (!m) return id;
  const pick = (...keys: string[]) => keys.map((k) => m[k]).find((v) => typeof v === "string" && v) as string | undefined;
  const label = pick("nickname", "bank_name", "display_name", "title", "name", "type");
  const last = pick("last4", "last_four", "account_last4");
  const parts = [label, last ? `••${last}` : undefined].filter(Boolean);
  return parts.length ? `${parts.join(" ")}  ${id}` : id;
}

/** The rows under the command line: flags first, then who pays and from what. */
function summaryRows(input: ConfirmInput): KvRow[] {
  const { argv, hints } = input;
  const flags = flagsToRecord(argv);
  const positional = argv.slice(2).find((a) => !a.startsWith("--") && !Object.values(flags).some((v) => String(v) === a));
  const rows: KvRow[] = [];
  if (positional) rows.push({ key: "target", value: positional, role: "muted" });
  const currency = typeof flags.currency === "string" ? flags.currency : "usd";
  for (const [k, v] of Object.entries(flags)) {
    if (k === "yes" || k === "idempotency-key") continue;
    if (k === "currency" && "amount" in flags) continue;
    const cell = infer(k, v, flags, hints);
    let value = cell.kind === "hidden" ? String(v) : cell.long || cell.short;
    let role = cell.role;
    let key = k.replace(/_/g, " ");
    if (k === "amount" && typeof v === "number") value = `${money(v, currency)} ${currency}`;
    if (k === "payout_method_id" && typeof v === "string") {
      key = copy.confirm.to;
      value = input.destination ?? `${v}  ${copy.confirm.unknownMethod}`;
      role = input.destination ? "text" : "warn";
    }
    rows.push({ key, value, role });
  }
  if (input.accountTitle) rows.push({ key: copy.confirm.from, value: `${input.accountTitle}  ${input.accountId ?? ""}`.trim() });
  const m = moneyOf(argv);
  if (m && input.balance) {
    const after = input.balance.available - m.amount;
    rows.push({ key: copy.confirm.balance, value: copy.confirm.available(money(input.balance.available, m.currency), money(after, m.currency)), role: after < 0 ? "bad" : "good" });
  }
  if (m && input.cap !== undefined) rows.push({ key: copy.confirm.cap, value: input.cap === null ? copy.confirm.noCap : copy.confirm.perPayout(money(input.cap, m.currency)), role: "muted" });
  return rows;
}

const commandLine = (argv: string[]) => shellJoin(["whop", ...argv.filter((a) => a !== "--yes")]);

export function confirmView(input: ConfirmInput, theme: Theme): string[] {
  const { group, verb, argv } = input;
  const mode = input.mode ?? "production";
  const isMoney = MONEY_GROUPS.has(group);
  const role: Role = mode === "sandbox" ? "warn" : isMoney || DESTRUCTIVE_VERBS.has(verb) ? "bad" : "warn";

  const out = callout(role, copy.confirm.title(group, verb), [paint(theme, "mono", commandLine(argv))], theme, copy.confirm.badge(mode));
  out.push("");
  out.push(...kv([{ rows: summaryRows(input) }], theme));
  out.push("");
  const notes = [mode === "sandbox" ? copy.confirm.sandboxWarning : copy.confirm.warning];
  if (isMoney && mode !== "sandbox") notes.push(copy.confirm.money);
  if (input.timeoutSeconds) notes.push(copy.confirm.expires(input.timeoutSeconds));
  for (const l of wrap(notes.join(" "), theme.width - 3)) out.push("   " + paint(theme, "muted", l));
  out.push("");
  // The sandbox path, visible under every production money write. Never a hidden env var.
  if (isMoney && mode !== "sandbox") out.push(...footer([[copy.confirm.tryFirst, ["wv", "--sandbox", ...argv.filter((a) => a !== "--yes")]]], theme), "");
  return out;
}

export interface RefusedInput extends ConfirmInput {
  reason: "cap" | "balance";
}

/** Printed instead of the prompt when the amount is over the cap or the balance. `whop` is never called. */
export function refusedView(input: RefusedInput, theme: Theme): string[] {
  const { argv } = input;
  const m = moneyOf(argv);
  const amount = m ? money(m.amount, m.currency) : "";
  const title = input.reason === "cap" ? copy.confirm.refused.cap : copy.confirm.refused.balance;
  const body =
    input.reason === "cap"
      ? copy.confirm.refused.capBody(amount, money(input.cap ?? 0, m?.currency))
      : copy.confirm.refused.balanceBody(amount, money(input.balance?.available ?? 0, m?.currency));
  const out = callout("bad", title, [paint(theme, "mono", commandLine(argv))], theme, copy.confirm.refused.badge);
  out.push("");
  out.push(...kv([{ rows: summaryRows(input) }], theme));
  out.push("");
  const notes = [body];
  if (input.reason === "cap" && m) notes.push(copy.confirm.refused.raise(Math.ceil(m.amount)));
  for (const l of wrap(notes.join(" "), theme.width - 3)) out.push("   " + paint(theme, "muted", l));
  out.push("");
  out.push(...footer([[copy.confirm.tryFirst, ["wv", "--sandbox", ...argv.filter((a) => a !== "--yes")]]], theme), "");
  return out;
}
