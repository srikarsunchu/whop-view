// Ported unchanged from whop-desktop src/lib/format.ts.

export interface Money {
  amount: string | number;
  currency: string;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const compactNum = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const plain = new Intl.NumberFormat("en-US");

export function money(m: Money | number | string | null | undefined, currency = "usd"): string {
  if (m == null) return "—";
  const amount = typeof m === "object" ? Number(m.amount) : Number(m);
  const cur = typeof m === "object" ? m.currency : currency;
  if (!Number.isFinite(amount)) return "—";
  if (cur.toLowerCase() === "usd") return usd.format(amount);
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: cur.toUpperCase() }).format(amount);
  } catch {
    return `${plain.format(amount)} ${cur}`;
  }
}

export const num = (n: number | null | undefined) => (n == null ? "—" : plain.format(n));
export const compact = (n: number | null | undefined) => (n == null ? "—" : compactNum.format(n));

/** Injected clock so snapshots are stable. */
export let now = () => Date.now();
export const setNow = (fn: () => number) => (now = fn);

const toMs = (iso: string | number) => (typeof iso === "number" ? iso * (iso < 1e12 ? 1000 : 1) : Date.parse(iso));

export function relative(iso: string | number | null | undefined): string {
  if (!iso) return "—";
  const t = toMs(iso);
  if (!Number.isFinite(t)) return "—";
  const diff = now() - t;
  // A date still ahead reads `in 25d`, so an expiry or a reset is never "just now".
  const future = diff < 0;
  const tag = (n: number, unit: string) => (future ? `in ${n}${unit}` : `${n}${unit} ago`);
  const s = Math.round(Math.abs(diff) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return tag(m, "m");
  const h = Math.round(m / 60);
  if (h < 36) return tag(h, "h");
  const d = Math.round(h / 24);
  if (d < 30) return tag(d, "d");
  const mo = Math.round(d / 30);
  if (mo < 12) return tag(mo, "mo");
  return tag(Math.round(mo / 12), "y");
}

export function shortDate(iso: string | number | null | undefined): string {
  if (!iso) return "—";
  const t = toMs(iso);
  if (!Number.isFinite(t)) return "—";
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Absolute for detail views: `Sep 16, 2026 00:04 UTC`. */
export function longDate(iso: string | number | null | undefined): string {
  if (!iso) return "—";
  const t = toMs(iso);
  if (!Number.isFinite(t)) return "—";
  const d = new Date(t);
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const time = d.toISOString().slice(11, 16);
  return `${date} ${time} UTC`;
}

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function daysAgo(n: number): Date {
  const d = new Date(now());
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

export function pctDelta(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export const titleCase = (s: string | null | undefined) =>
  (s ?? "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function planPrice(plan: { plan_type?: string; billing_period?: number | null; initial_price?: Money; renewal_price?: Money } | null | undefined): string {
  if (!plan) return "—";
  const renewal = plan.renewal_price && Number(plan.renewal_price.amount) > 0 ? plan.renewal_price : null;
  const initial = plan.initial_price ?? renewal;
  if (!initial) return "—";
  const base = money(initial);
  if (plan.plan_type === "renewal" && renewal) {
    const days = plan.billing_period ?? 30;
    const unit = days === 7 ? "wk" : days === 365 ? "yr" : days === 90 ? "qtr" : "mo";
    return `${money(renewal)}/${unit}`;
  }
  if (Number(initial.amount) === 0) return "Free";
  return base;
}
