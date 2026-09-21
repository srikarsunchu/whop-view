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

/** Whop's live cap for one payout speed, from `payouts methods --include_limits`. Amounts in currency units. */
export interface WhopLimit {
  speed: string;
  max: number;
  /** Set when the cap is a block rather than a number: `kyc_completed`, `restricted_account`. */
  code?: string;
  message?: string;
  dailyRemaining?: number;
}

/** Picks the limit for the payout's speed out of the `limits` object. Tolerates a missing scope. */
export function limitFor(limits: unknown, speed: string): WhopLimit | undefined {
  if (!limits || typeof limits !== "object") return undefined;
  const l = (limits as Rec)[speed];
  if (!l || typeof l !== "object") return undefined;
  const r = l as Rec;
  if (typeof r.max_amount !== "number") return undefined;
  return {
    speed,
    max: r.max_amount,
    code: typeof r.error_code === "string" ? r.error_code : undefined,
    message: typeof r.error_message === "string" ? r.error_message : undefined,
    dailyRemaining: typeof r.daily_amount_remaining === "number" ? r.daily_amount_remaining : undefined,
  };
}

/** `10`, `10.00`, `$10`, `$10.00`, and the formatted form all read back as the amount. */
export function amountMatcher(amount: number): (answer: string) => boolean {
  return (answer) => {
    const n = Number(answer.trim().replace(/^[^\d.-]+/, "").replace(/,/g, ""));
    return Number.isFinite(n) && Math.abs(n - amount) < 0.005;
  };
}

/** The speed a payout asked for. Whop defaults to standard. */
export const speedOf = (argv: string[]) => {
  const s = flagsToRecord(argv).speed;
  return typeof s === "string" ? s : "standard";
};

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
  /** Whop's own cap for this speed, when the account exposes it. */
  limit?: WhopLimit;
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

/**
 * One line for a saved payout method, from the fields the API documents: `nickname`, then
 * `institution_name`, then the destination category; `account_reference` is already masked
 * ("••••4242" or an email), so it is shown as sent. Falls back to the id.
 */
export function describeMethod(m: Rec | undefined, id: string): string {
  if (!m) return id;
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const dest = m.destination && typeof m.destination === "object" ? (m.destination as Rec) : undefined;
  const label = str(m.nickname) ?? str(m.institution_name) ?? str(dest?.category)?.replace(/_/g, " ");
  const ref = str(m.account_reference);
  const parts = [label, ref].filter(Boolean);
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
  if (m && (input.cap !== undefined || input.limit)) {
    const parts: string[] = [];
    if (input.limit) parts.push(copy.confirm.whopLimit(money(input.limit.max, m.currency), input.limit.speed));
    if (input.cap !== undefined) parts.push(input.cap === null ? copy.confirm.noCap : input.limit ? copy.confirm.wvCap(money(input.cap, m.currency)) : copy.confirm.perPayout(money(input.cap, m.currency)));
    if (input.limit?.dailyRemaining != null) parts.push(copy.confirm.dailyLeft(money(input.limit.dailyRemaining, m.currency)));
    const blocked = input.limit && m.amount > input.limit.max;
    rows.push({ key: copy.confirm.cap, value: parts.join(" · "), role: blocked ? "bad" : "muted" });
  }
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
  reason: "cap" | "balance" | "whop";
}

/** Printed instead of the prompt when the amount is over the cap or the balance. `whop` is never called. */
export function refusedView(input: RefusedInput, theme: Theme): string[] {
  const { argv } = input;
  const m = moneyOf(argv);
  const amount = m ? money(m.amount, m.currency) : "";
  const title = input.reason === "cap" ? copy.confirm.refused.cap : input.reason === "whop" ? copy.confirm.refused.whop : copy.confirm.refused.balance;
  const body =
    input.reason === "cap"
      ? copy.confirm.refused.capBody(amount, money(input.cap ?? 0, m?.currency))
      : input.reason === "whop"
        ? // Whop's own words when it sent them: "complete identity verification" beats any paraphrase.
          input.limit?.message ?? copy.confirm.refused.whopBody(amount, money(input.limit?.max ?? 0, m?.currency), input.limit?.speed ?? "standard")
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
