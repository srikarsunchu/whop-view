// `wv money`: treasury on one screen, and `wv money close`: month end as one plan. The screen is the "know"
// stage: the available balance per currency, Whop's live payout limits per speed with the block behind a zero,
// the saved payout methods, the reserves, the recent payouts. The recipe exports the month's ledger and pays
// out what is available above a floor, two writes with one approval. Reads only here; bin.ts gathers and runs.
import type { Parsed, Rec } from "../envelope.ts";
import { copy, type Mode } from "../copy.ts";
import { money, relative, shortDate } from "../format.ts";
import { footer, type FooterLine } from "../primitives/footer.ts";
import { kv, type KvRow, type KvSection } from "../primitives/kv.ts";
import { breadcrumb } from "../primitives/rule.ts";
import { table, type TableCell, type TableColumn } from "../primitives/table.ts";
import { teach } from "../argv.ts";
import { paint, type Role, type Theme } from "../tokens.ts";
import { wrap } from "../ansi.ts";
import { statusLabel, statusRole } from "../status.ts";
import { describeMethod, limitFor, type WhopLimit } from "./confirm.ts";
import { recipeData, stepKey, type RecipePlan, type RecipeRow, type RecipeStep } from "./recipe.ts";

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);
const rows = (p: Parsed | undefined): Rec[] | undefined => (p && p.ok && p.payload.kind === "page" ? p.payload.rows : undefined);
const isObj = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);
const recordOf = (p: Parsed | undefined): Rec | undefined => (p && p.ok && "record" in p.payload ? p.payload.record : undefined);
const errLine = (p: Parsed) => (p.ok ? "" : `${p.error.code} ${p.error.message.split("\n")[0]}`);

/** One currency's balance from `ledgers report --report_type balance_summary --currency <c>`. */
export interface Balance {
  currency: string;
  available?: number;
  /** Rows other than `available`, as the report names them: `pending`, `reserved`, and so on. */
  other: { category: string; amount: number }[];
  error?: string;
}

export function balanceOf(currency: string, p: Parsed): Balance {
  if (!p.ok) return { currency, other: [], error: errLine(p) };
  if (p.payload.kind !== "report") return { currency, other: [], available: undefined };
  const other: Balance["other"] = [];
  let available: number | undefined;
  for (const r of p.payload.rows) {
    const cat = str(r.line_category) ?? str(r.grouping) ?? "";
    const amount = num(r.amount);
    if (amount === undefined) continue;
    if (cat === "available") available = amount;
    else other.push({ category: cat, amount });
  }
  return { currency, available: available ?? p.payload.total, other };
}

export interface MoneyInput {
  accountTitle?: string;
  accountId?: string;
  mode?: Mode;
  /** One per currency, `usd` first, then every currency a saved method pays in. */
  balances: Balance[];
  /** `payouts methods --include_limits` */
  methods: Parsed;
  /** `payouts list --first 5` */
  payouts: Parsed;
  /** `accounts reserves` */
  reserves: Parsed;
  /** `verifications list` */
  verifications: Parsed;
  /** `ledgers list --first 100`: where the currencies the ledger holds come from. */
  ledger?: Parsed;
  now?: number;
  commands: string[][];
}

/**
 * Every currency the account holds money in: `usd`, the currency of every saved method, every currency on the
 * ledger's last page, and every reserve. The ledger is the one read that sees a EUR sale on an account whose only
 * method pays USD; without it the screen would show one balance and hide the rest.
 */
export function currenciesOf(methods: Parsed, ledger?: Parsed, reserves?: Parsed): string[] {
  const out = ["usd"];
  const add = (v: unknown) => {
    const c = typeof v === "string" ? v.toLowerCase() : "";
    if (c && !out.includes(c)) out.push(c);
  };
  for (const m of rows(methods) ?? []) add(m.currency);
  for (const l of rows(ledger) ?? []) add(isObj(l.currency) ? l.currency.code : l.currency);
  for (const r of rows(reserves) ?? []) add(r.currency);
  return out;
}

/** The currencies a saved method can pay out. A balance in any other currency has to be swapped first. */
export function payableCurrencies(methods: Parsed): Set<string> {
  return new Set((rows(methods) ?? []).map((m) => (typeof m.currency === "string" ? m.currency.toLowerCase() : "")).filter(Boolean));
}

/** Balances nothing can pay out: money sitting in a currency no saved method delivers. */
export function unpayable(input: MoneyInput): Balance[] {
  const payable = payableCurrencies(input.methods);
  // With no method at all every balance is stuck, and the methods row already says so; a swap would not help.
  if (!payable.size) return [];
  return input.balances.filter((b) => !b.error && (b.available ?? 0) > 0 && !payable.has(b.currency.toLowerCase()));
}

/** The two speeds' limits, with the block behind a zero, from the `limits` sibling on the methods page. */
export function limitsOf(methods: Parsed): { standard?: WhopLimit; instant?: WhopLimit } {
  const extra = methods.ok && methods.payload.kind === "page" ? methods.payload.extra : undefined;
  return { standard: limitFor(extra?.limits, "standard"), instant: limitFor(extra?.limits, "instant") };
}

/** Which saved method a payout should use: the one named, else the default, else the only one. */
export function pickMethod(methods: Rec[], id?: string): { method?: Rec; reason?: "named_missing" | "none" | "several" } {
  if (id) {
    const m = methods.find((r) => r.id === id);
    return m ? { method: m } : { reason: "named_missing" };
  }
  if (!methods.length) return { reason: "none" };
  const def = methods.find((r) => r.is_default === true);
  if (def) return { method: def };
  return methods.length === 1 ? { method: methods[0] } : { reason: "several" };
}

export function moneyData(input: MoneyInput): Rec {
  const limits = limitsOf(input.methods);
  const methods = rows(input.methods) ?? [];
  const payable = payableCurrencies(input.methods);
  return {
    ok: input.balances.every((b) => !b.error) && input.methods.ok,
    account: input.accountId || input.accountTitle ? { id: input.accountId, title: input.accountTitle } : undefined,
    mode: input.mode ?? "production",
    balances: input.balances.map((b) => ({ ...b, payable: payable.has(b.currency.toLowerCase()) })),
    /** Currencies with money in them that no saved method delivers; each needs a swap first. */
    unpayable: unpayable(input).map((b) => b.currency),
    limits,
    /** Whop blocks payouts when the standard limit carries an error code; that is the identity check. */
    payoutsBlocked: limits.standard?.code ? { code: limits.standard.code, message: limits.standard.message } : undefined,
    methods: methods.map((m) => ({ id: m.id, nickname: m.nickname, institution: m.institution_name, currency: m.currency, is_default: m.is_default, status: m.status, reference: m.account_reference })),
    reserves: rows(input.reserves) ?? (input.reserves.ok ? [] : { error: errLine(input.reserves) }),
    verifications: rows(input.verifications) ?? (input.verifications.ok ? [] : { error: errLine(input.verifications) }),
    payouts: rows(input.payouts) ?? (input.payouts.ok ? [] : { error: errLine(input.payouts) }),
    commands: input.commands.map((c) => teach(c)),
  };
}

function balanceRows(input: MoneyInput): KvRow[] {
  const c = copy.money;
  const payable = payableCurrencies(input.methods);
  const anyMethod = payable.size > 0;
  return input.balances.map((b) => {
    if (b.error) return { key: b.currency, value: b.error, role: "warn" as Role };
    const parts = [b.available === undefined ? copy.detail.empty : `${money(b.available, b.currency)} ${c.available}`, ...b.other.map((o) => `${money(o.amount, b.currency)} ${o.category.replace(/_/g, " ")}`)];
    // A balance no saved method delivers is marked; the footer names the swap. Silent when there is no method at all, since the methods row already says so.
    const stuck = anyMethod && (b.available ?? 0) > 0 && !payable.has(b.currency.toLowerCase());
    if (stuck) parts.push(c.noMethodFor);
    return { key: b.currency, value: parts.join(" · "), role: stuck ? "warn" : (b.available ?? 0) > 0 ? "good" : "muted" };
  });
}

function limitRows(input: MoneyInput): KvRow[] {
  const c = copy.money;
  const cur = input.balances[0]?.currency ?? "usd";
  const l = limitsOf(input.methods);
  const out: KvRow[] = [];
  if (!input.methods.ok) return [{ key: c.limits, value: errLine(input.methods), role: "warn" }];
  if (!l.standard && !l.instant) return [{ key: c.limits, value: c.noLimits, role: "muted" }];
  for (const [speed, lim] of [["standard", l.standard], ["instant", l.instant]] as const) {
    if (!lim) continue;
    const blocked = lim.code !== undefined;
    const value = blocked ? `${c.blocked} · ${lim.message ?? lim.code}` : [c.upTo(money(lim.max, cur)), lim.dailyRemaining != null ? copy.confirm.dailyLeft(money(lim.dailyRemaining, cur)) : ""].filter(Boolean).join(" · ");
    out.push({ key: speed, value, role: blocked ? "bad" : "text" });
  }
  return out;
}

function methodRows(input: MoneyInput): KvRow[] {
  const c = copy.money;
  const list = rows(input.methods);
  if (!list) return [{ key: c.methods, value: errLine(input.methods) || copy.detail.empty, role: "warn" }];
  if (!list.length) return [{ key: c.methods, value: c.noMethods, role: "warn" }];
  return list.map((m) => ({
    key: str(m.nickname) ?? str(m.institution_name) ?? String(m.id),
    value: [describeMethod(m, String(m.id)), str(m.currency), m.is_default === true ? c.isDefault : "", str(m.status) ? statusLabel(m.status as string) : ""].filter(Boolean).join(" · "),
    role: m.status === "broken" ? "bad" : m.is_default === true ? "text" : "muted",
  }));
}

function payoutTable(input: MoneyInput, theme: Theme): string[] {
  const c = copy.money;
  const list = rows(input.payouts);
  if (!list) return wrap(errLine(input.payouts) || copy.detail.empty, theme.width - 1).map((l) => " " + paint(theme, input.payouts.ok ? "muted" : "warn", l));
  if (!list.length) return wrap(c.noPayouts, theme.width - 1).map((l) => " " + paint(theme, "muted", l));
  const cols: TableColumn[] = [
    { key: "amount", label: c.cols.amount, align: "right", priority: 0 },
    { key: "status", label: c.cols.status, align: "left", priority: 1 },
    { key: "speed", label: c.cols.speed, align: "left", priority: 4 },
    { key: "created", label: c.cols.created, align: "left", priority: 2 },
    { key: "id", label: "id", align: "left", priority: 3, max: 22 },
  ];
  const cells = list.map((p) => {
    const row: Record<string, TableCell> = {};
    const cur = str(p.currency) ?? "usd";
    row.amount = { text: money(num(p.amount) ?? 0, cur), role: "text" };
    row.status = { text: statusLabel(str(p.status) ?? ""), role: statusRole(str(p.status) ?? "") };
    row.speed = { text: str(p.speed) ?? copy.detail.empty, role: "muted" };
    row.created = { text: str(p.created_at) ? relative(p.created_at as string) : copy.detail.empty, role: "muted" };
    row.id = { text: String(p.id ?? ""), role: "muted" };
    return row;
  });
  return table(cols, cells, theme).lines;
}

export function moneyView(input: MoneyInput, theme: Theme): string[] {
  const c = copy.money;
  const out: string[] = [];
  out.push(...breadcrumb(theme, [[input.accountTitle ?? "", "accent"], [input.accountId ?? "", "muted"], [copy.session.mode(input.mode ?? "production"), input.mode === "sandbox" ? "good" : "warn"], [c.title, "accent"]]));
  out.push("");
  const reserves = rows(input.reserves);
  const sections: KvSection[] = [
    { title: c.balances, rows: balanceRows(input) },
    { title: c.limits, rows: limitRows(input) },
    { title: c.methods, rows: methodRows(input) },
  ];
  if (reserves?.length) sections.push({ title: c.reserves, rows: reserves.map((r) => ({ key: str(r.currency) ?? str(r.id) ?? c.reserves, value: `${money(num(r.amount) ?? 0, str(r.currency) ?? "usd")}${str(r.reason) ? ` · ${r.reason}` : ""}${str(r.releases_at) ? ` · ${c.releases(shortDate(r.releases_at as string))}` : ""}`, role: "warn" })) });
  out.push(...kv(sections, theme));
  out.push("");
  out.push(" " + paint(theme, "accent", c.recent));
  out.push(...payoutTable(input, theme));
  out.push("");
  const l = limitsOf(input.methods);
  if (l.standard?.code) {
    for (const line of wrap(c.blockedNote, theme.width - 3)) out.push("   " + paint(theme, "muted", line));
    out.push("");
  }
  const lines: FooterLine[] = [];
  if (l.standard?.code) lines.push([copy.doctor.fix, ["whop", "verifications", "create", "--account_id", input.accountId ?? "<biz_id>"]]);
  const target = [...payableCurrencies(input.methods)][0] ?? "usd";
  for (const b of unpayable(input)) if (payableCurrencies(input.methods).size) lines.push([c.swap, ["wv", "money", "swap", "--from", b.currency, "--to", target, "--amount", String(b.available ?? 0), "--plan"]]);
  lines.push([c.close, ["wv", "money", "close", "--plan"]]);
  for (const cmd of input.commands) lines.push([copy.list.json, teach(cmd)]);
  out.push(...footer(lines, theme), "");
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// `wv money close`: export the period's ledger, then pay out what is available above a floor.

export interface CloseOptions {
  /** How much stays in the balance. */
  keep: number;
  method?: string;
  currency: string;
  speed: "standard" | "instant";
  /** `last` month or `this` month, the export window. */
  period: "last" | "this";
  notes?: string;
  key?: string;
}

export const CLOSE_FLAGS = ["--keep", "--method", "--currency", "--speed", "--period", "--notes", "--idempotency-key"];

export function parseCloseArgs(argv: string[]): { opts?: CloseOptions; error?: string } {
  const rest = argv[0] === "money" && argv[1] === "close" ? argv.slice(2) : argv;
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith("--")) return { error: copy.launch.extraArg(a) };
    const eq = a.indexOf("=");
    const name = eq > 0 ? a.slice(0, eq) : a;
    if (!CLOSE_FLAGS.includes(name)) return { error: copy.money.unknownFlag(name) };
    flags[name] = eq > 0 ? a.slice(eq + 1) : (rest[++i] ?? "");
  }
  const keep = flags["--keep"] === undefined ? 0 : Number(flags["--keep"]);
  if (!Number.isFinite(keep) || keep < 0) return { error: copy.launch.badNumber("--keep", flags["--keep"] ?? "") };
  const speed = flags["--speed"] ?? "standard";
  if (speed !== "standard" && speed !== "instant") return { error: copy.money.badSpeed(speed) };
  const period = flags["--period"] ?? "last";
  if (period !== "last" && period !== "this") return { error: copy.money.badPeriod(period) };
  return { opts: { keep, method: flags["--method"], currency: (flags["--currency"] ?? "usd").toLowerCase(), speed, period, notes: flags["--notes"], key: flags["--idempotency-key"] } };
}

export interface CloseReads {
  balance: Balance;
  methods: Parsed;
  accountTitle?: string;
  accountId?: string;
  mode?: Mode;
  /** `WV_PAYOUT_CAP` in production. */
  cap?: number | null;
  now?: Date;
}

export interface ClosePlan extends RecipePlan {
  opts: CloseOptions;
  amount: number;
  window: { from: string; to: string; label: string };
  limit?: WhopLimit;
  method?: Rec;
}

/** The period's window in UTC: `last` is the previous calendar month, `this` is the month so far. */
export function closeWindow(period: "last" | "this", now: Date): { from: string; to: string; label: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const start = period === "last" ? new Date(Date.UTC(y, m - 1, 1)) : new Date(Date.UTC(y, m, 1));
  const end = period === "last" ? new Date(Date.UTC(y, m, 1)) : now;
  const label = start.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return { from: start.toISOString().replace(/\.\d{3}Z$/, "Z"), to: end.toISOString().replace(/\.\d{3}Z$/, "Z"), label };
}

export function buildClose(argv: string[], opts: CloseOptions, reads: CloseReads): ClosePlan {
  const c = copy.money;
  const now = reads.now ?? new Date();
  const mode = reads.mode ?? "production";
  const key = opts.key ?? "{key}";
  const biz = reads.accountId ?? "<biz_id>";
  const cur = opts.currency;
  const window = closeWindow(opts.period, now);
  const blockers: string[] = [];
  const warnings: string[] = [];
  const available = reads.balance.available ?? 0;
  const amount = Math.max(0, Math.round((available - opts.keep) * 100) / 100);
  const limits = limitsOf(reads.methods);
  const limit = limits[opts.speed];
  const picked = pickMethod(rows(reads.methods) ?? [], opts.method);
  if (reads.balance.error) blockers.push(c.noBalance(cur, reads.balance.error));
  else if (amount <= 0) blockers.push(c.nothingToPay(money(available, cur), money(opts.keep, cur)));
  if (!reads.methods.ok) blockers.push(c.noMethodsRead(errLine(reads.methods)));
  else if (picked.reason === "none") blockers.push(c.noMethods);
  else if (picked.reason === "named_missing") blockers.push(c.methodMissing(opts.method ?? ""));
  else if (picked.reason === "several") blockers.push(c.severalMethods);
  const live = mode !== "sandbox";
  if (live && limit?.code) blockers.push(c.payoutsBlocked(limit.message ?? limit.code));
  else if (live && limit && amount > limit.max) blockers.push(copy.confirm.refused.whopBody(money(amount, cur), money(limit.max, cur), opts.speed));
  if (live && reads.cap != null && amount > reads.cap) blockers.push(`${copy.confirm.refused.capBody(money(amount, cur), money(reads.cap, cur))} ${copy.confirm.refused.raise(Math.ceil(amount))}`);
  if (opts.speed === "instant" && !limits.instant) warnings.push(c.instantUnknown);

  const method = picked.method;
  const steps: RecipeStep[] = [
    {
      key: "export",
      label: c.stepLabels.export,
      what: c.exportLine(window.label, cur),
      group: "exports",
      verb: "create",
      argv: ["exports", "create", "--account_id", biz, "--resource", "financial-activity", "--filters", JSON.stringify({ currency: cur, posted_after: window.from, posted_before: window.to }), "--idempotency-key", stepKey(key, "export")],
    },
    {
      key: "payout",
      label: c.stepLabels.payout,
      what: c.payoutLine(money(amount, cur), method ? describeMethod(method, String(method.id)) : opts.method ?? c.methodTbd, opts.speed),
      group: "payouts",
      verb: "create",
      argv: ["payouts", "create", "--account_id", biz, "--amount", String(amount), "--currency", cur, "--payout_method_id", method ? String(method.id) : (opts.method ?? "{method}"), "--speed", opts.speed, "--notes", opts.notes ?? c.defaultNotes(window.label), "--idempotency-key", stepKey(key, "payout")],
    },
  ];
  const summary: RecipeRow[] = [
    { key: c.balance, value: reads.balance.error ? reads.balance.error : `${money(available, cur)} ${c.available}${reads.balance.other.length ? " · " + reads.balance.other.map((o) => `${money(o.amount, cur)} ${o.category.replace(/_/g, " ")}`).join(" · ") : ""}`, role: reads.balance.error ? "warn" : "text" },
    { key: c.keep, value: money(opts.keep, cur), role: "muted" },
    { key: c.payout, value: `${money(amount, cur)} · ${opts.speed}`, role: amount > 0 ? "warn" : "muted" },
    { key: copy.confirm.to, value: method ? describeMethod(method, String(method.id)) : picked.reason === "several" ? c.severalShort : c.noMethods, role: method ? "text" : "warn" },
  ];
  if (limit) summary.push({ key: copy.confirm.cap, value: limit.code ? `${c.blocked} · ${limit.message ?? limit.code}` : [copy.confirm.whopLimit(money(limit.max, cur), opts.speed), reads.cap !== undefined ? (reads.cap === null ? copy.confirm.noCap : copy.confirm.wvCap(money(reads.cap, cur))) : ""].filter(Boolean).join(" · "), role: limit.code ? "bad" : "muted" });
  summary.push({ key: c.window, value: `${window.label} · ${shortDate(window.from)} to ${shortDate(window.to)}`, role: "muted" });
  return {
    name: "close",
    title: c.closeTitle,
    argv,
    mode,
    account: reads.accountId || reads.accountTitle ? { id: reads.accountId, title: reads.accountTitle } : undefined,
    summary,
    steps,
    blockers,
    warnings,
    typedAmount: live && amount > 0 ? { amount, currency: cur } : undefined,
    data: { balance: reads.balance, keep: opts.keep, amount, currency: cur, speed: opts.speed, method: method ? { id: method.id, nickname: method.nickname, institution: method.institution_name } : undefined, limit, cap: reads.cap, window },
    done: (results) => closeChecks(results),
    opts,
    amount,
    window,
    limit,
    method,
  };
}

export const closeData = (plan: ClosePlan): Rec => recipeData(plan);

/** "Done when": the export completes and has a download URL, the payout reaches `completed`, the balance moved. */
export function closeChecks(results: Partial<Record<string, Rec>>): { label: string; argv: string[] }[] {
  const c = copy.money.check;
  const out: { label: string; argv: string[] }[] = [];
  if (results.export?.id) out.push({ label: c.export, argv: ["whop", "exports", "get", String(results.export.id), "--format", "json"] });
  if (results.payout?.id) out.push({ label: c.payout, argv: ["whop", "payouts", "get", String(results.payout.id), "--format", "json"] });
  out.push({ label: c.balance, argv: ["wv", "money"] });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// `wv money swap --from eur --to usd --amount 80`: a quote first, then one fiat swap at the quoted rate.

export interface SwapOptions {
  from: string;
  to: string;
  amount: number;
  key?: string;
}

export const SWAP_FLAGS = ["--from", "--to", "--amount", "--idempotency-key"];

export function parseSwapArgs(argv: string[]): { opts?: SwapOptions; error?: string } {
  const c = copy.money.swap_;
  const rest = argv[0] === "money" && argv[1] === "swap" ? argv.slice(2) : argv;
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith("--")) return { error: copy.launch.extraArg(a) };
    const eq = a.indexOf("=");
    const name = eq > 0 ? a.slice(0, eq) : a;
    if (!SWAP_FLAGS.includes(name)) return { error: c.unknownFlag(name) };
    flags[name] = eq > 0 ? a.slice(eq + 1) : (rest[++i] ?? "");
  }
  const from = (flags["--from"] ?? "").toLowerCase();
  const to = (flags["--to"] ?? "").toLowerCase();
  if (!from || !to) return { error: c.needsPair };
  if (from === to) return { error: c.samePair(from) };
  const amount = Number(flags["--amount"]);
  if (flags["--amount"] === undefined || !Number.isFinite(amount) || amount <= 0) return { error: c.needsAmount };
  return { opts: { from, to, amount, key: flags["--idempotency-key"] } };
}

/** A quote as Whop sends it: `amount_in`, `amount_out`, `rate`, `fee_bps`, `fee_amount`, strings. */
export interface SwapQuote {
  amountIn?: number;
  amountOut?: number;
  rate?: number;
  feeBps?: number;
  feeAmount?: number;
  error?: string;
}

export function quoteOf(p: Parsed): SwapQuote {
  if (!p.ok) return { error: errLine(p) };
  const r = recordOf(p);
  if (!r) return { error: copy.money.swap_.noQuote };
  return { amountIn: num(r.amount_in), amountOut: num(r.amount_out), rate: num(r.rate), feeBps: num(r.fee_bps), feeAmount: num(r.fee_amount) };
}

export interface SwapReads {
  quote: Parsed;
  from: Balance;
  to: Balance;
  accountTitle?: string;
  accountId?: string;
  mode?: Mode;
}

export interface SwapPlan extends RecipePlan {
  opts: SwapOptions;
  quote: SwapQuote;
  after: { from?: number; to?: number };
}

export function buildSwap(argv: string[], opts: SwapOptions, reads: SwapReads): SwapPlan {
  const c = copy.money.swap_;
  const mode = reads.mode ?? "production";
  const key = opts.key ?? "{key}";
  const biz = reads.accountId ?? "<biz_id>";
  const quote = quoteOf(reads.quote);
  const blockers: string[] = [];
  const warnings: string[] = [];
  const available = reads.from.available;
  if (reads.from.error) blockers.push(copy.money.noBalance(opts.from, reads.from.error));
  else if ((available ?? 0) < opts.amount) blockers.push(c.insufficient(money(opts.amount, opts.from), money(available ?? 0, opts.from)));
  if (quote.error) blockers.push(c.quoteFailed(quote.error));
  else if (quote.amountOut === undefined) blockers.push(c.noQuote);
  if (reads.to.error) warnings.push(copy.money.noBalance(opts.to, reads.to.error));
  if ((quote.feeBps ?? 0) > 0) warnings.push(c.fee(quote.feeBps ?? 0, quote.feeAmount !== undefined ? money(quote.feeAmount, opts.from) : undefined));
  // The from side never shows below zero: a short balance is a blocker, and the card says so in words instead.
  const after = {
    from: available === undefined ? undefined : Math.max(0, Math.round((available - opts.amount) * 100) / 100),
    to: reads.to.error || quote.amountOut === undefined ? undefined : Math.round(((reads.to.available ?? 0) + quote.amountOut) * 100) / 100,
  };
  const steps: RecipeStep[] = [
    {
      key: "swap",
      label: c.stepLabel,
      what: c.swapLine(money(opts.amount, opts.from), quote.amountOut !== undefined ? money(quote.amountOut, opts.to) : opts.to),
      group: "swaps",
      verb: "create",
      argv: ["swaps", "create", "--account_id", biz, "--from_token", opts.from, "--to_token", opts.to, "--amount", String(opts.amount), "--idempotency-key", stepKey(key, "swap")],
    },
  ];
  const line = (b: Balance, next?: number) => (b.error ? b.error : `${money(b.available ?? 0, b.currency)} ${copy.money.available}${next !== undefined ? ` → ${money(next, b.currency)}` : ""}`);
  const summary: RecipeRow[] = [
    { key: c.fromKey, value: line(reads.from, after.from), role: reads.from.error ? "warn" : "text" },
    { key: c.toKey, value: line(reads.to, after.to), role: reads.to.error ? "warn" : "text" },
    { key: c.rateKey, value: quote.error ? quote.error : quote.rate !== undefined ? c.rateLine(opts.from, money(quote.rate, opts.to), quote.feeBps ?? 0) : c.noQuote, role: quote.error ? "warn" : "muted" },
    { key: c.amountKey, value: `${money(opts.amount, opts.from)} → ${quote.amountOut !== undefined ? money(quote.amountOut, opts.to) : copy.detail.empty}`, role: "warn" },
  ];
  const live = mode !== "sandbox";
  return {
    name: "swap",
    title: c.title,
    argv,
    mode,
    account: reads.accountId || reads.accountTitle ? { id: reads.accountId, title: reads.accountTitle } : undefined,
    summary,
    steps,
    blockers,
    warnings,
    typedAmount: live ? { amount: opts.amount, currency: opts.from } : undefined,
    data: { from: reads.from, to: reads.to, quote, amount: opts.amount, after },
    done: (results) => swapChecks(results),
    opts,
    quote,
    after,
  };
}

/** "Done when": the swap is `completed` (fiat pairs fill at once; crypto finishes in the background), and both balances moved. */
export function swapChecks(results: Partial<Record<string, Rec>>): { label: string; argv: string[] }[] {
  const c = copy.money.swap_.check;
  const out: { label: string; argv: string[] }[] = [];
  if (results.swap?.id) out.push({ label: c.swap, argv: ["whop", "swaps", "get", String(results.swap.id), "--format", "json"] });
  out.push({ label: c.balance, argv: ["wv", "money"] });
  return out;
}
