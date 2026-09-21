// `wv support lookup <key>`: one customer on one screen, joined from the reads a ticket needs. `wv support
// refund <pay_id>`: the payment, what was already refunded, then the gated refund. `wv support dispute <dsp_id>`:
// the deadline, the evidence, then upload and submit as one plan. The dispute clock is the whole value: a
// dispute has a due date, and the recipe refuses to submit without evidence or after the window closed.
import type { Parsed, Rec } from "../envelope.ts";
import { copy, type Mode } from "../copy.ts";
import { longDate, money, relative, shortDate } from "../format.ts";
import { footer, type FooterLine } from "../primitives/footer.ts";
import { kv, type KvRow, type KvSection } from "../primitives/kv.ts";
import { breadcrumb } from "../primitives/rule.ts";
import { table, type TableCell, type TableColumn } from "../primitives/table.ts";
import { teach } from "../argv.ts";
import { paint, type Theme } from "../tokens.ts";
import { wrap } from "../ansi.ts";
import { statusLabel, statusRole } from "../status.ts";
import { recipeData, stepKey, type RecipePlan, type RecipeRow, type RecipeStep } from "./recipe.ts";

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const isObj = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);
const rows = (p: Parsed | undefined): Rec[] | undefined => (p && p.ok && p.payload.kind === "page" ? p.payload.rows : undefined);
const errLine = (p: Parsed) => (p.ok ? "" : `${p.error.code} ${p.error.message.split("\n")[0]}`);
/** A Whop money object or a number, as a number. */
export const amountOf = (v: unknown): number | undefined => (isObj(v) ? (typeof v.amount === "string" || typeof v.amount === "number" ? Number(v.amount) : undefined) : typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : undefined);
const currencyOf = (v: unknown, fallback = "usd") => (isObj(v) && typeof v.currency === "string" ? v.currency : fallback);

export type KeyKind = "email" | "user" | "membership" | "payment" | "member" | "person" | "license";

/** What a support key is, from its shape. Anything that is not an id or an email is tried as a license key. */
export function classifyKey(key: string): KeyKind {
  if (key.includes("@")) return "email";
  if (/^user_/.test(key)) return "user";
  if (/^mem_/.test(key)) return "membership";
  if (/^pay_/.test(key)) return "payment";
  if (/^mber_/.test(key)) return "member";
  if (/^prsn_/.test(key)) return "person";
  return "license";
}

export interface LookupInput {
  key: string;
  kind: KeyKind;
  accountTitle?: string;
  accountId?: string;
  mode?: Mode;
  /** The buyer, once resolved. Absent when the key led nowhere. */
  user?: { id: string; name?: string; username?: string; email?: string };
  /** `people list` row, when there is one. */
  person?: Rec;
  /** `members list --user_ids`, when there is one. */
  member?: Rec;
  memberships: Parsed;
  payments: Parsed;
  /** `disputes list`, narrowed to this buyer's payments. */
  disputes: Parsed;
  /** `resolution-center-cases list --user_id`. */
  cases: Parsed;
  now?: number;
  commands: string[][];
}

/** The buyer from whatever record resolved the key: a person's `user`, a payment's `user`, a membership's `user_id`. */
export function userFrom(rec: Rec | undefined): LookupInput["user"] | undefined {
  if (!rec) return undefined;
  if (isObj(rec.user) && str(rec.user.id)) return { id: rec.user.id as string, name: str(rec.user.name), username: str(rec.user.username), email: str(rec.user.email) ?? str(rec.email) ?? str(rec.customer_email) };
  if (str(rec.user_id)) return { id: rec.user_id as string, email: str(rec.email) ?? str(rec.customer_email), name: str(rec.name) };
  if (/^user_/.test(str(rec.id) ?? "")) return { id: rec.id as string, name: str(rec.name), username: str(rec.username), email: str(rec.email) };
  return undefined;
}

/** Disputes whose payment is one of the buyer's. `disputes list` has no user filter, so this is client side. */
export function disputesFor(all: Parsed, paymentIds: Set<string>): Parsed {
  if (!all.ok || all.payload.kind !== "page") return all;
  return { ...all, payload: { ...all.payload, rows: all.payload.rows.filter((d) => paymentIds.has(str(isObj(d.payment) ? d.payment.id : d.payment_id) ?? "")) } };
}

export function lookupData(input: LookupInput): Rec {
  return {
    ok: !!input.user,
    key: input.key,
    kind: input.kind,
    account: input.accountId || input.accountTitle ? { id: input.accountId, title: input.accountTitle } : undefined,
    user: input.user,
    person: input.person ? { id: input.person.id, ltv: input.person.ltv, purchase_count: input.person.purchase_count, first_seen_at: input.person.first_seen_at, last_seen_at: input.person.last_seen_at, first_source: input.person.first_source, last_source: input.person.last_source } : undefined,
    member: input.member ? { id: input.member.id, status: input.member.status, joined_at: input.member.joined_at, last_accessed_at: input.member.last_accessed_at } : undefined,
    memberships: rows(input.memberships) ?? { error: errLine(input.memberships) },
    payments: rows(input.payments) ?? { error: errLine(input.payments) },
    disputes: rows(input.disputes) ?? { error: errLine(input.disputes) },
    cases: rows(input.cases) ?? { error: errLine(input.cases) },
    actions: actionsFor(input).map((a) => ({ what: a.label, run: a.argv })),
    commands: input.commands.map((c) => teach(c)),
  };
}

/** The writes a ticket usually ends in, as wv commands, from what the screen found. */
export function actionsFor(input: LookupInput): { label: string; argv: string[] }[] {
  const c = copy.support.actions;
  const out: { label: string; argv: string[] }[] = [];
  const pays = rows(input.payments) ?? [];
  const latestPaid = pays.find((p) => p.status === "paid" && p.refundable !== false && (amountOf(p.refunded_amount) ?? 0) < (amountOf(p.presentment_total) ?? amountOf(p.amount_after_fees) ?? Infinity));
  if (latestPaid) out.push({ label: c.refund, argv: ["wv", "support", "refund", String(latestPaid.id)] });
  const active = (rows(input.memberships) ?? []).find((m) => ["active", "trialing", "past_due"].includes(str(m.status) ?? ""));
  if (active) {
    out.push({ label: c.extend, argv: ["wv", "memberships", "extend", String(active.id), "--days", "7"] });
    out.push({ label: c.cancel, argv: ["wv", "memberships", "cancel", String(active.id), "--cancel_at_period_end", "true"] });
  }
  for (const d of rows(input.disputes) ?? []) if (d.status === "needs_response") out.push({ label: c.dispute, argv: ["wv", "support", "dispute", String(d.id), "--evidence", "<file_id>"] });
  for (const k of rows(input.cases) ?? []) if (k.status === "awaiting_merchant") out.push({ label: c.reply, argv: ["wv", "resolution-center-cases", "reply", String(k.id), "--message", "<text>"] });
  return out;
}

function personRows(input: LookupInput): KvRow[] {
  const c = copy.support;
  const u = input.user;
  const p = input.person;
  const m = input.member;
  const rowsOut: KvRow[] = [];
  if (!u) return [{ key: c.who, value: c.notFound(input.key, c.kinds[input.kind]), role: "warn" }];
  rowsOut.push({ key: c.who, value: [u.name ?? "", u.username ? `@${u.username}` : "", u.id].filter(Boolean).join("  "), role: "text" });
  if (u.email) rowsOut.push({ key: c.email, value: u.email });
  if (p) {
    rowsOut.push({ key: c.spent, value: `${money(amountOf(p.ltv) ?? 0)} ${c.over(Number(p.purchase_count ?? 0))}` });
    rowsOut.push({ key: c.seen, value: [str(p.first_seen_at) ? c.firstSeen(relative(p.first_seen_at as string)) : "", str(p.last_seen_at) ? c.lastSeen(relative(p.last_seen_at as string)) : "", str(p.first_source) ? c.from(p.first_source as string) : ""].filter(Boolean).join(" · "), role: "muted" });
  }
  if (m) rowsOut.push({ key: c.member, value: [statusLabel(str(m.status) ?? ""), str(m.joined_at) ? c.joined(shortDate(m.joined_at as string)) : "", str(m.last_accessed_at) ? c.lastAccess(relative(m.last_accessed_at as string)) : "", String(m.id)].filter(Boolean).join(" · "), role: statusRole(str(m.status) ?? "") });
  return rowsOut;
}

function membershipTable(input: LookupInput, theme: Theme): string[] {
  const c = copy.support;
  const list = rows(input.memberships);
  if (!list) return [" " + paint(theme, input.memberships.ok ? "muted" : "warn", errLine(input.memberships) || copy.detail.empty)];
  if (!list.length) return [" " + paint(theme, "muted", c.noMemberships)];
  const cols: TableColumn[] = [
    { key: "product", label: c.cols.product, align: "left", priority: 0, max: 30 },
    { key: "status", label: c.cols.status, align: "left", priority: 1 },
    { key: "until", label: c.cols.until, align: "left", priority: 2 },
    { key: "id", label: "id", align: "left", priority: 3, max: 22 },
  ];
  const cells = list.map((m) => {
    const row: Record<string, TableCell> = {};
    const product = isObj(m.product) ? str(m.product.title) : undefined;
    row.product = { text: product ?? str(m.product_id) ?? "", role: "text" };
    const status = str(m.status) ?? "";
    row.status = { text: m.cancel_at_period_end === true ? `${statusLabel(status)} · ${c.cancels}` : statusLabel(status), role: m.cancel_at_period_end === true ? "warn" : statusRole(status) };
    row.until = { text: str(m.current_period_end) ? shortDate(m.current_period_end as string) : c.oneTime, role: "muted" };
    row.id = { text: String(m.id ?? ""), role: "muted" };
    return row;
  });
  return table(cols, cells, theme).lines;
}

function paymentTable(input: LookupInput, theme: Theme): string[] {
  const c = copy.support;
  const list = rows(input.payments);
  if (!list) return [" " + paint(theme, input.payments.ok ? "muted" : "warn", errLine(input.payments) || copy.detail.empty)];
  if (!list.length) return [" " + paint(theme, "muted", c.noPayments)];
  const cols: TableColumn[] = [
    { key: "amount", label: c.cols.amount, align: "right", priority: 0 },
    { key: "status", label: c.cols.status, align: "left", priority: 1 },
    { key: "refunded", label: c.cols.refunded, align: "right", priority: 2 },
    { key: "reason", label: c.cols.reason, align: "left", priority: 5 },
    { key: "date", label: c.cols.date, align: "left", priority: 3 },
    { key: "id", label: "id", align: "left", priority: 4, max: 22 },
  ];
  const cells = list.map((p) => {
    const row: Record<string, TableCell> = {};
    const cur = str(p.currency) ?? currencyOf(p.presentment_total);
    const total = amountOf(p.presentment_total) ?? amountOf(p.amount_after_fees) ?? 0;
    const refunded = amountOf(p.refunded_amount) ?? 0;
    row.amount = { text: money(total, cur), role: "text" };
    row.status = { text: statusLabel(str(p.status) ?? ""), role: statusRole(str(p.status) ?? "") };
    row.refunded = { text: refunded > 0 ? money(refunded, cur) : copy.detail.empty, role: refunded > 0 ? "warn" : "muted" };
    row.reason = { text: (str(p.billing_reason) ?? "").replace(/_/g, " "), role: "muted" };
    row.date = { text: str(p.paid_at ?? p.created_at) ? shortDate((p.paid_at ?? p.created_at) as string) : copy.detail.empty, role: "muted" };
    row.id = { text: String(p.id ?? ""), role: "muted" };
    return row;
  });
  return table(cols, cells, theme).lines;
}

function caseTable(input: LookupInput, theme: Theme): string[] {
  const c = copy.support;
  const disputes = rows(input.disputes);
  const cases = rows(input.cases);
  const out: string[] = [];
  if (!disputes || !cases) {
    if (!disputes) out.push(" " + paint(theme, input.disputes.ok ? "muted" : "warn", errLine(input.disputes) || copy.detail.empty));
    if (!cases) out.push(" " + paint(theme, input.cases.ok ? "muted" : "warn", errLine(input.cases) || copy.detail.empty));
    return out;
  }
  const all = [...disputes.map((d) => ({ kind: d.inquiry === true ? c.inquiry : c.chargeback, rec: d, due: str(d.evidence_due_at) })), ...cases.map((k) => ({ kind: c.case, rec: k, due: str(k.response_due_at) }))];
  if (!all.length) return [" " + paint(theme, "muted", c.noCases)];
  const now = input.now ?? Date.now();
  const cols: TableColumn[] = [
    { key: "kind", label: c.cols.kind, align: "left", priority: 2 },
    { key: "status", label: c.cols.status, align: "left", priority: 0 },
    { key: "due", label: c.cols.due, align: "left", priority: 1 },
    { key: "amount", label: c.cols.amount, align: "right", priority: 3 },
    { key: "reason", label: c.cols.reason, align: "left", priority: 4 },
    { key: "id", label: "id", align: "left", priority: 5, max: 22 },
  ];
  const cells = all.map(({ kind, rec, due }) => {
    const row: Record<string, TableCell> = {};
    const status = str(rec.status) ?? "";
    const open = status === "needs_response" || status === "awaiting_merchant";
    const dueMs = due ? Date.parse(due) : NaN;
    const hoursLeft = Number.isFinite(dueMs) ? (dueMs - now) / 3_600_000 : undefined;
    row.kind = { text: kind, role: "muted" };
    row.status = { text: statusLabel(status), role: open ? "bad" : statusRole(status) };
    row.due = { text: due ? (hoursLeft !== undefined && hoursLeft < 0 ? c.passed : `${relative(due)}${hoursLeft !== undefined && hoursLeft < 48 ? ` · ${c.soon}` : ""}`) : copy.detail.empty, role: open && hoursLeft !== undefined && hoursLeft < 48 ? "bad" : "muted" };
    row.amount = { text: money(amountOf(rec.amount) ?? 0, str(rec.currency) ?? "usd"), role: "text" };
    row.reason = { text: (str(rec.reason) ?? "").replace(/_/g, " "), role: "muted" };
    row.id = { text: String(rec.id ?? ""), role: "muted" };
    return row;
  });
  return table(cols, cells, theme).lines;
}

export function lookupView(input: LookupInput, theme: Theme): string[] {
  const c = copy.support;
  const out: string[] = [];
  out.push(...breadcrumb(theme, [[input.accountTitle ?? "", "accent"], [input.accountId ?? "", "muted"], [copy.session.mode(input.mode ?? "production"), input.mode === "sandbox" ? "good" : "warn"], [c.title, "accent"], [input.key, "muted"]]));
  out.push("");
  const sections: KvSection[] = [{ rows: personRows(input) }];
  out.push(...kv(sections, theme));
  out.push("");
  if (input.user) {
    out.push(" " + paint(theme, "accent", c.memberships));
    out.push(...membershipTable(input, theme), "");
    out.push(" " + paint(theme, "accent", c.payments));
    out.push(...paymentTable(input, theme), "");
    out.push(" " + paint(theme, "accent", c.cases));
    out.push(...caseTable(input, theme), "");
  }
  const lines: FooterLine[] = actionsFor(input).map((a) => [a.label, a.argv] as FooterLine);
  for (const cmd of input.commands) lines.push([copy.list.json, teach(cmd)]);
  out.push(...footer(lines, theme), "");
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// `wv support refund <pay_id> [--amount N]`: the payment first, then one gated refund.

export interface RefundOptions {
  payment: string;
  amount?: number;
  key?: string;
}

export function parseRefundArgs(argv: string[]): { opts?: RefundOptions; error?: string } {
  const rest = argv[0] === "support" && argv[1] === "refund" ? argv.slice(2) : argv;
  const flags: Record<string, string> = {};
  let positional: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const name = eq > 0 ? a.slice(0, eq) : a;
      if (!["--amount", "--idempotency-key"].includes(name)) return { error: copy.support.refund.unknownFlag(name) };
      flags[name] = eq > 0 ? a.slice(eq + 1) : (rest[++i] ?? "");
    } else if (!positional) positional = a;
    else return { error: copy.launch.extraArg(a) };
  }
  if (!positional || !/^pay_/.test(positional)) return { error: copy.support.refund.needsPayment };
  const amount = flags["--amount"] === undefined ? undefined : Number(flags["--amount"]);
  if (amount !== undefined && !(Number.isFinite(amount) && amount > 0)) return { error: copy.launch.badNumber("--amount", flags["--amount"]) };
  return { opts: { payment: positional, amount, key: flags["--idempotency-key"] } };
}

export interface RefundReads {
  payment?: Rec;
  paymentError?: string;
  accountTitle?: string;
  accountId?: string;
  mode?: Mode;
}

export interface RefundPlan extends RecipePlan {
  opts: RefundOptions;
  amount: number;
  currency: string;
}

export function buildRefund(argv: string[], opts: RefundOptions, reads: RefundReads): RefundPlan {
  const c = copy.support.refund;
  const mode = reads.mode ?? "production";
  const key = opts.key ?? "{key}";
  const p = reads.payment;
  const cur = str(p?.currency) ?? currencyOf(p?.presentment_total);
  const total = amountOf(p?.presentment_total) ?? amountOf(p?.amount_after_fees) ?? 0;
  const refunded = amountOf(p?.refunded_amount) ?? 0;
  const remaining = Math.max(0, Math.round((total - refunded) * 100) / 100);
  const amount = opts.amount !== undefined ? Math.round(opts.amount * 100) / 100 : remaining;
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!p) blockers.push(c.noPayment(opts.payment, reads.paymentError ?? ""));
  else {
    if (p.status !== "paid") blockers.push(c.notPaid(str(p.status) ?? "unknown"));
    if (p.refundable === false) blockers.push(c.notRefundable);
    if (remaining <= 0) blockers.push(c.nothingLeft(money(total, cur)));
    else if (amount > remaining) blockers.push(c.overRemaining(money(amount, cur), money(remaining, cur)));
    if (refunded > 0 && remaining > 0) warnings.push(c.partialBefore(money(refunded, cur)));
    if (str(p.dispute_alerted_at)) warnings.push(c.disputeAlerted);
  }
  const partial = amount < remaining - 0.005;
  const steps: RecipeStep[] = [
    {
      key: "refund",
      label: c.stepLabel,
      what: partial ? c.partialLine(money(amount, cur), money(remaining, cur)) : c.fullLine(money(amount, cur)),
      group: "payments",
      verb: "refund",
      argv: ["payments", "refund", opts.payment, ...(partial ? ["--partial_amount", String(amount)] : []), "--idempotency-key", stepKey(key, "refund")],
    },
  ];
  const summary: RecipeRow[] = [];
  if (p) {
    summary.push({ key: c.payment, value: `${money(total, cur)} · ${statusLabel(str(p.status) ?? "")} · ${str(p.paid_at) ? shortDate(p.paid_at as string) : ""} · ${opts.payment}`, role: "text" });
    const buyer = userFrom(p);
    if (buyer) summary.push({ key: copy.support.who, value: [buyer.name ?? "", buyer.email ?? "", buyer.id].filter(Boolean).join("  "), role: "muted" });
    if (isObj(p.line_items) || str(p.product_id)) summary.push({ key: copy.launch.product, value: str(p.product_id) ?? "", role: "muted" });
    summary.push({ key: c.refundedSoFar, value: refunded > 0 ? money(refunded, cur) : copy.detail.empty, role: refunded > 0 ? "warn" : "muted" });
    summary.push({ key: c.refundNow, value: `${money(amount, cur)}${partial ? ` · ${c.partial}` : ` · ${c.full}`}`, role: "warn" });
  }
  return {
    name: "refund",
    title: c.title,
    argv,
    mode,
    account: reads.accountId || reads.accountTitle ? { id: reads.accountId, title: reads.accountTitle } : undefined,
    summary,
    steps,
    blockers,
    warnings,
    typedAmount: mode !== "sandbox" && amount > 0 ? { amount, currency: cur } : undefined,
    data: { payment: p ? { id: p.id, status: p.status, total, refunded, remaining, currency: cur, buyer: userFrom(p), membership_id: p.membership_id, product_id: p.product_id } : undefined, amount, partial },
    done: (results) => refundChecks(opts.payment, results),
    opts,
    amount,
    currency: cur,
  };
}

export function refundChecks(paymentId: string, results: Partial<Record<string, Rec>>): { label: string; argv: string[] }[] {
  const c = copy.support.refund.check;
  const out: { label: string; argv: string[] }[] = [];
  if (results.refund?.id) out.push({ label: c.refund, argv: ["whop", "refunds", "list", "--payment_id", paymentId, "--format", "json"] });
  out.push({ label: c.payment, argv: ["whop", "payments", "get", paymentId, "--format", "json"] });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// `wv support dispute <dsp_id> --evidence file_x[:type] …`: the deadline, the evidence, then upload and submit.

export const EVIDENCE_TYPES = ["return_policy", "shipping_policy", "physical_fulfillment", "customer_order_history", "product_image", "prior_transactions", "customer_session", "digital_fulfillment", "subscription"];
export const DEFAULT_EVIDENCE_TYPE = "digital_fulfillment";

export interface DisputeOptions {
  dispute: string;
  evidence: { id: string; type: string }[];
  key?: string;
}

export function parseDisputeArgs(argv: string[]): { opts?: DisputeOptions; error?: string } {
  const rest = argv[0] === "support" && argv[1] === "dispute" ? argv.slice(2) : argv;
  const evidence: { id: string; type: string }[] = [];
  let positional: string | undefined;
  let key: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const name = eq > 0 ? a.slice(0, eq) : a;
      const value = eq > 0 ? a.slice(eq + 1) : (rest[++i] ?? "");
      if (name === "--idempotency-key") key = value;
      else if (name === "--evidence") {
        for (const part of value.split(",").filter(Boolean)) {
          const [id, type] = part.split(":");
          if (!/^file_/.test(id)) return { error: copy.support.dispute.badEvidence(part) };
          if (type && !EVIDENCE_TYPES.includes(type)) return { error: copy.support.dispute.badType(type, EVIDENCE_TYPES.join(", ")) };
          evidence.push({ id, type: type ?? DEFAULT_EVIDENCE_TYPE });
        }
      } else return { error: copy.support.dispute.unknownFlag(name) };
    } else if (!positional) positional = a;
    else return { error: copy.launch.extraArg(a) };
  }
  if (!positional || !/^dsp_/.test(positional)) return { error: copy.support.dispute.needsDispute };
  return { opts: { dispute: positional, evidence, key } };
}

export interface DisputeReads {
  dispute?: Rec;
  disputeError?: string;
  accountTitle?: string;
  accountId?: string;
  mode?: Mode;
  now?: number;
}

export interface DisputePlan extends RecipePlan {
  opts: DisputeOptions;
  hoursLeft?: number;
}

export function buildDispute(argv: string[], opts: DisputeOptions, reads: DisputeReads): DisputePlan {
  const c = copy.support.dispute;
  const mode = reads.mode ?? "production";
  const key = opts.key ?? "{key}";
  const d = reads.dispute;
  const now = reads.now ?? Date.now();
  const due = str(d?.evidence_due_at);
  const hoursLeft = due ? (Date.parse(due) - now) / 3_600_000 : undefined;
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!d) blockers.push(c.noDispute(opts.dispute, reads.disputeError ?? ""));
  else {
    if (d.status !== "needs_response") blockers.push(c.notOpen(statusLabel(str(d.status) ?? "unknown")));
    if (d.evidence_editable === false) blockers.push(c.locked((str(d.evidence_locked_reason) ?? "").replace(/_/g, " ")));
    if (hoursLeft !== undefined && hoursLeft <= 0) blockers.push(c.passed(longDate(due!)));
    else if (hoursLeft !== undefined && hoursLeft < 48) warnings.push(c.soon(Math.floor(hoursLeft)));
    if (!opts.evidence.length) blockers.push(c.noEvidence);
    if (d.inquiry === true) warnings.push(c.inquiry);
  }
  const cur = str(d?.currency) ?? "usd";
  const steps: RecipeStep[] = [
    {
      key: "evidence",
      label: c.stepLabels.evidence,
      what: c.evidenceLine(opts.evidence.length, [...new Set(opts.evidence.map((e) => e.type.replace(/_/g, " ")))].join(", ")),
      group: "disputes",
      verb: "upload_evidence",
      argv: ["disputes", "upload_evidence", opts.dispute, "--documents", JSON.stringify(opts.evidence.map((e) => ({ id: e.id, document_type: e.type }))), "--idempotency-key", stepKey(key, "evidence")],
    },
    {
      key: "submit",
      label: c.stepLabels.submit,
      what: c.submitLine,
      group: "disputes",
      verb: "submit",
      argv: ["disputes", "submit", opts.dispute, "--idempotency-key", stepKey(key, "submit")],
    },
  ];
  const summary: RecipeRow[] = [];
  if (d) {
    summary.push({ key: c.dispute, value: `${money(amountOf(d.amount) ?? 0, cur)} · ${(str(d.reason) ?? "").replace(/_/g, " ")}${d.inquiry === true ? ` · ${copy.support.inquiry}` : ""} · ${opts.dispute}`, role: "text" });
    summary.push({ key: copy.support.cols.status, value: statusLabel(str(d.status) ?? ""), role: d.status === "needs_response" ? "bad" : statusRole(str(d.status) ?? "") });
    summary.push({ key: c.due, value: due ? `${longDate(due)} · ${hoursLeft !== undefined && hoursLeft > 0 ? c.hoursLeft(Math.floor(hoursLeft)) : c.passedShort}` : copy.detail.empty, role: hoursLeft !== undefined && hoursLeft < 48 ? "bad" : "muted" });
    const buyer = isObj(d.buyer) ? d.buyer : undefined;
    if (buyer) summary.push({ key: copy.support.who, value: [str(buyer.name) ?? "", str(buyer.email) ?? "", str(buyer.id) ?? ""].filter(Boolean).join("  "), role: "muted" });
    const pay = isObj(d.payment) ? d.payment : undefined;
    if (pay) summary.push({ key: c.payment, value: [str(pay.id) ?? "", str(pay.paid_at) ? shortDate(pay.paid_at as string) : ""].filter(Boolean).join(" · "), role: "muted" });
    const existing = isObj(d.evidence) && Array.isArray(d.evidence.documents) ? d.evidence.documents.length : 0;
    if (existing) warnings.push(c.replaces(existing));
  }
  return {
    name: "dispute",
    title: c.title,
    argv,
    mode,
    account: reads.accountId || reads.accountTitle ? { id: reads.accountId, title: reads.accountTitle } : undefined,
    summary,
    steps,
    blockers,
    warnings,
    data: { dispute: d ? { id: d.id, status: d.status, reason: d.reason, amount: amountOf(d.amount), currency: cur, evidence_due_at: due, hoursLeft: hoursLeft === undefined ? undefined : Math.floor(hoursLeft), evidence_editable: d.evidence_editable, inquiry: d.inquiry } : undefined, evidence: opts.evidence },
    done: (results) => disputeChecks(opts.dispute, results),
    opts,
    hoursLeft,
  };
}

export function disputeChecks(id: string, _results: Partial<Record<string, Rec>>): { label: string; argv: string[] }[] {
  return [{ label: copy.support.dispute.check.status, argv: ["whop", "disputes", "get", id, "--format", "json"] }];
}

export const refundData = (plan: RefundPlan): Rec => recipeData(plan);
export const disputeData = (plan: DisputePlan): Rec => recipeData(plan);
void wrap;
