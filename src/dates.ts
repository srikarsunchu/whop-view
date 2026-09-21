// Date presets for the two commands that demand explicit ranges. `--last 7d`, `--this month`, and
// `--last month` become `--from`/`--to` in UTC before `whop` sees the argv, so the teaching footer
// shows the dates that were actually sent. Pure: the clock comes from format.ts so tests can pin it.
import { isoDay, now } from "./format.ts";
import { copy } from "./copy.ts";

/** Whop's own rule for `events list`, in Whop's words. */
export const EVENTS_MAX_DAYS = 30;
export const EVENTS_RANGE_MESSAGE = "Time range cannot exceed 30 days";

export interface Resolved {
  argv: string[];
  /** The preset that was applied, for the person. Absent when the argv carried no preset. */
  preset?: string;
  /** A refusal: nothing should run. */
  error?: { code: "BAD_PRESET" | "EVENTS_RANGE"; message: string; hint?: string };
}

/** The two commands with a date window. `stats get` takes dates; `events list` takes timestamps. */
export function takesDates(argv: string[]): "stats" | "events" | null {
  if (argv[0] === "stats" && argv[1] === "get") return "stats";
  if (argv[0] === "events" && argv[1] === "list") return "events";
  return null;
}

type Window = { from: Date; to: Date; preset: string };

const DAY = 86_400_000;
const utcDay = (t: number) => {
  const d = new Date(t);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};
const seconds = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * The window a preset names. Stats: whole UTC days, ending yesterday for `--last Nd` like `home` and
 * `gtm`, ending today for `--this month`. Events: a rolling window ending now for `--last Nd`, so
 * `--last 30d` is exactly thirty days and the API accepts it; month presets start at midnight.
 */
export function windowFor(kind: "stats" | "events", flag: "last" | "this", value: string): Window | null {
  const t = now();
  const today = utcDay(t);
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  if (flag === "last") {
    const days = /^(\d+)d$/.exec(value);
    if (days) {
      const n = Number(days[1]);
      if (!n) return null;
      return kind === "stats" ? { from: new Date(today.getTime() - n * DAY), to: new Date(today.getTime() - DAY), preset: `last ${n}d` } : { from: new Date(t - n * DAY), to: new Date(t), preset: `last ${n}d` };
    }
    if (value === "month") {
      const from = new Date(Date.UTC(y, m - 1, 1));
      const to = kind === "stats" ? new Date(Date.UTC(y, m, 0)) : new Date(Date.UTC(y, m, 0, 23, 59, 59));
      return { from, to, preset: "last month" };
    }
    return null;
  }
  if (value === "month") return { from: new Date(Date.UTC(y, m, 1)), to: kind === "stats" ? today : new Date(t), preset: "this month" };
  return null;
}

/** Rewrites a preset into `--from`/`--to`. Argv without a preset comes back unchanged, so this is idempotent. */
export function resolveDates(argv: string[]): Resolved {
  const kind = takesDates(argv);
  if (!kind) return { argv };
  const out: string[] = [];
  let window: Window | null | undefined;
  let bad: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = /^--(last|this)=(.+)$/.exec(a);
    const flag = eq ? (eq[1] as "last" | "this") : a === "--last" || a === "--this" ? (a.slice(2) as "last" | "this") : null;
    if (!flag) {
      out.push(a);
      continue;
    }
    const value = eq ? eq[2] : (argv[++i] ?? "");
    window = windowFor(kind, flag, value);
    if (!window) bad = `--${flag} ${value}`.trim();
  }
  if (bad) return { argv, error: { code: "BAD_PRESET", message: copy.dates.badPreset(bad), hint: copy.dates.presets } };
  if (window) {
    if (out.includes("--from") || out.includes("--to") || out.some((a) => /^--(from|to)=/.test(a))) return { argv, error: { code: "BAD_PRESET", message: copy.dates.both(window.preset) } };
    const fmt = kind === "stats" ? (d: Date) => isoDay(d) : seconds;
    out.push("--from", fmt(window.from), "--to", fmt(window.to));
  }
  const resolved = { argv: out, preset: window?.preset };
  if (kind === "events") {
    const range = eventsRange(out);
    if (range && range.days > EVENTS_MAX_DAYS) return { ...resolved, error: { code: "EVENTS_RANGE", message: EVENTS_RANGE_MESSAGE, hint: copy.dates.rangeHint(range.days, range.from, range.to) } };
  }
  return resolved;
}

/** The span an `events list` argv asks for, in days, when both ends parse. */
export function eventsRange(argv: string[]): { from: string; to: string; days: number } | null {
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    if (i >= 0) return argv[i + 1];
    return argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  };
  const from = get("from");
  const to = get("to");
  if (!from || !to) return null;
  const f = Date.parse(from);
  const t = Date.parse(to);
  if (!Number.isFinite(f) || !Number.isFinite(t)) return null;
  return { from, to, days: Math.round(((t - f) / DAY) * 100) / 100 };
}
