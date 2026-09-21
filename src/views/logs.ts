// `apps logs`: one line per entry, oldest first like a tail, and the pure parts of `--follow`. The API
// returns newest first with no entry id, so an entry is keyed by request id, time, and message.
import type { PageInfo, Rec } from "../envelope.ts";
import { footer } from "../primitives/footer.ts";
import { teach } from "../argv.ts";
import { paint, type Role, type Theme } from "../tokens.ts";
import { padEnd, truncate, width, wrap } from "../ansi.ts";
import { copy } from "../copy.ts";
import { withAfter } from "./list.ts";

export interface LogsInput {
  argv: string[];
  rows: Rec[];
  page: PageInfo;
}

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

const LEVEL_ROLE: Record<string, Role> = { error: "bad", warn: "warn", info: "text", log: "text", debug: "muted" };

/** `HH:MM:SS` in UTC; the date is in the header, and a tail wants seconds. */
export function clock(iso: unknown): string {
  const t = typeof iso === "string" ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString().slice(11, 19) : "--:--:--";
}

/** Request summaries carry method, path, and status; console lines carry none. */
export function requestPart(row: Rec): string {
  const parts = [str(row.request_method), str(row.request_path), row.response_status != null ? String(row.response_status) : undefined].filter(Boolean);
  return parts.join(" ");
}

/** One entry as lines: time, level, request, then the message wrapped under a hanging indent. */
export function logLines(row: Rec, theme: Theme): string[] {
  const level = str(row.level) ?? "log";
  const role: Role = str(row.source) === "exception" ? "bad" : (LEVEL_ROLE[level] ?? "text");
  const head = " " + paint(theme, "muted", clock(row.created_at)) + "  " + paint(theme, role, padEnd(level, 5));
  const hang = " ".repeat(1 + 8 + 2 + 5 + 2);
  const req = requestPart(row);
  const message = (str(row.message) ?? "").replace(/\s+$/, "") + (row.truncated === true ? "…" : "");
  // A middle dot, because `wrap` collapses runs of spaces once a line has to break.
  const body = [req ? paint(theme, "accent", req) : "", message].filter(Boolean).join(" · ");
  const room = Math.max(16, theme.width - hang.length);
  const lines = wrap(body, room);
  if (!lines.length) return [head];
  return [head + "  " + lines[0], ...lines.slice(1).map((l) => hang + l)];
}

/** Entries the page holds that were not seen before, oldest first, at most `limit` of the newest. */
export function newEntries(seen: Set<string>, rows: Rec[], limit = Infinity): Rec[] {
  const fresh: Rec[] = [];
  for (const r of rows) {
    const k = keyOf(r);
    if (seen.has(k)) continue;
    seen.add(k);
    fresh.push(r);
  }
  fresh.sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
  return Number.isFinite(limit) && fresh.length > limit ? fresh.slice(fresh.length - limit) : fresh;
}

export const keyOf = (r: Rec) => `${r.request_id ?? ""}|${r.created_at ?? ""}|${r.message ?? ""}`;

/** The newest timestamp on the page, for the next poll's `--created_after`. */
export function newest(rows: Rec[]): string | undefined {
  let best: string | undefined;
  for (const r of rows) {
    const t = str(r.created_at);
    if (t && (!best || t > best)) best = t;
  }
  return best;
}

/** The same `apps logs` argv, windowed to what came after the last entry. `--follow` never reaches whop. */
export function pollArgv(argv: string[], after?: string): string[] {
  const out = argv.filter((a) => a !== "--follow");
  if (!after) return out;
  const i = out.indexOf("--created_after");
  if (i >= 0 && i + 1 < out.length) return [...out.slice(0, i + 1), after, ...out.slice(i + 2)];
  return [...out.filter((a) => !a.startsWith("--created_after=")), "--created_after", after];
}

export function logsView(input: LogsInput, theme: Theme): string[] {
  const { argv, rows, page } = input;
  const id = argv[2] ?? "";
  const out: string[] = [" " + paint(theme, "accent", copy.logs.title) + paint(theme, "muted", ` · ${id} · ${rows.length}`), ""];
  if (!rows.length) {
    out.push(...wrap(copy.logs.empty, theme.width - 1).map((l) => " " + l), "");
    out.push(...footer([[copy.list.json, teach(argv)], [copy.logs.follow, ["wv", ...argv, "--follow"]]], theme));
    return out;
  }
  const ordered = [...rows].sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
  for (const r of ordered) out.push(...logLines(r, theme));
  out.push("");
  const pageLine = page.has_next_page && page.end_cursor ? copy.list.next(page.end_cursor) : copy.logs.oldestFirst;
  out.push(...footer([`${copy.list.of(rows.length, null)} · ${pageLine}`, [copy.list.json, teach(argv)], [copy.logs.follow, ["wv", ...argv, "--follow"]]], theme));
  return out;
}

/** What `--follow` prints before the first line: the app, the cadence, how to stop, and the agent command. */
export function followHeader(argv: string[], intervalSeconds: number, theme: Theme): string[] {
  const id = argv[2] ?? "";
  const filters = [argv.includes("--level") ? `level ${argv[argv.indexOf("--level") + 1]}` : "", argv.includes("--query") ? `query ${truncate(argv[argv.indexOf("--query") + 1] ?? "", 24)}` : ""].filter(Boolean);
  const head = " " + paint(theme, "accent", copy.logs.title) + paint(theme, "muted", truncate(` · ${id}${filters.length ? " · " + filters.join(" · ") : ""}`, theme.width - 2 - width(copy.logs.title)));
  const tag = paint(theme, "good", copy.logs.following(intervalSeconds));
  const gap = theme.width - 1 - width(head) - width(tag);
  // Too narrow for both: the tag takes its own line, like the callout's badge.
  const top = gap >= 2 ? [head + " ".repeat(gap) + tag] : [head, " " + tag];
  return [...top, " " + paint(theme, "muted", copy.logs.stop), ...footer([[copy.list.json, teach(pollArgv(argv))]], theme), ""];
}

export function followStopped(count: number, theme: Theme): string[] {
  return ["", " " + paint(theme, "muted", copy.logs.stopped(count))];
}

/** Three seconds between polls unless `WV_FOLLOW_MS` says otherwise; tests and demos use less. */
export const DEFAULT_FOLLOW_MS = 3000;
export function followIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.WV_FOLLOW_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_FOLLOW_MS;
}

export { withAfter };
