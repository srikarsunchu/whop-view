import type { PageInfo, Rec } from "../envelope.ts";
import { chooseColumns, infer } from "../infer.ts";
import type { Hints } from "../hints.ts";
import { table, type TableCell, type TableColumn } from "../primitives/table.ts";
import { footer } from "../primitives/footer.ts";
import { teach as teachArgv } from "../argv.ts";
import { paint, type Theme } from "../tokens.ts";
import { padStart, width } from "../ansi.ts";
import { copy } from "../copy.ts";
import { takesAccount } from "../status.ts";

export interface ListInput {
  group: string;
  argv: string[];
  rows: Rec[];
  page: PageInfo;
  hints: Hints;
  accountTitle?: string;
  /** Whether `whop <group> create` exists. Decides the empty-state hint. */
  canCreate?: boolean;
  /** Muted row numbers in a leading gutter, for the session's `N opens a row` shortcut. */
  numbered?: boolean;
  /** What the rows are, for the header and the empty state. Defaults to the group. */
  noun?: string;
}

/** The gutter's column key. Never a real field, never in the teaching footer. */
export const ROW_KEY = "#";

export interface ListRender {
  lines: string[];
  /** Index in `lines` of the first data row, and how many rows follow. Absent for an empty list. */
  rowStart?: number;
  rowCount?: number;
  /** The agent command the footer teaches, as argv. */
  teach?: string[];
  /** wv argv for the next page, when there is one. */
  next?: string[];
}

export function listView(input: ListInput, theme: Theme): string[] {
  return listViewWithMeta(input, theme).lines;
}

/** `listView` plus where the rows landed, so the session can repaint a picked row in place. */
export function listViewWithMeta(input: ListInput, theme: Theme): ListRender {
  const { group, argv, rows, page, hints } = input;
  const noun = input.noun ?? group;
  const out: string[] = [];
  const left = paint(theme, "accent", noun) + paint(theme, "muted", ` · ${rows.length}`);
  const right = input.accountTitle ? paint(theme, "muted", input.accountTitle) : "";
  const gap = theme.width - 1 - width(left) - width(right);
  out.push(" " + left + (right ? padStart(right, Math.max(2, gap) + width(right)) : ""));
  out.push("");

  if (rows.length === 0) {
    out.push(" " + copy.list.empty(noun));
    if (input.canCreate) out.push(...footer([["try", copy.list.emptyHint(group)]], theme));
    return { lines: out };
  }

  const columns = chooseColumns(rows, hints, theme.breakpoint);
  const cells = rows.map((r, i) => {
    const c: Record<string, TableCell> = {};
    if (input.numbered) c[ROW_KEY] = { text: String(i + 1), role: "muted" };
    for (const col of columns) {
      const cell = infer(col.key, r[col.key], r, hints);
      c[col.key] = { text: cell.short, role: col.key === "id" ? "muted" : cell.role };
    }
    return c;
  });
  const tcols: TableColumn[] = columns.map((c) => {
    const first = rows.find((r) => r[c.key] != null) ?? rows[0];
    const align = infer(c.key, first[c.key], first, hints).align;
    const max = c.key === "id" ? 22 : c.priority === 0 ? 36 : 28;
    return { key: c.key, label: c.label, align, priority: c.priority, max };
  });
  if (input.numbered) tcols.unshift({ key: ROW_KEY, label: "", align: "right", priority: 0 });
  const t = table(tcols, cells, theme);
  const rowStart = out.length + 1;
  out.push(...t.lines);
  out.push("");

  // The teaching line filters to the primary column on screen. whop's `--filter-output` on a page is a
  // slice, `data[0,N].field`; `data[*]` returns nothing, and two filters on one slice keep only the last,
  // so one column is the most a working command can teach. N is the rows on screen.
  const shown = t.kept.filter((k) => k !== ROW_KEY);
  const primary = columns.find((c) => c.priority === 0 && shown.includes(c.key))?.key ?? shown[0];
  const pageLine = page.has_next_page && page.end_cursor ? copy.list.next(page.end_cursor) : copy.list.noMore;
  const scoped = takesAccount(argv) && !argv.includes("--account_id") ? [...argv, "--account_id", "<biz_id>"] : argv;
  const teach = teachArgv(scoped, "--filter-output", pageFilter(rows.length, primary));
  out.push(...footer([`${copy.list.of(rows.length, null)} · ${pageLine}`, [copy.list.json, teach]], theme));
  const next = page.has_next_page && page.end_cursor ? withAfter(argv, page.end_cursor) : undefined;
  return { lines: out, rowStart, rowCount: rows.length, teach, next };
}

/** whop's slice filter for one field across a page: `data[0,N].field`. Verified against 0.18.2. */
export const pageFilter = (rows: number, field: string) => `data[0,${rows}].${field}`;

/** The same list one page on: replaces an existing `--after`, else appends one. */
export function withAfter(argv: string[], cursor: string): string[] {
  const i = argv.indexOf("--after");
  if (i >= 0 && i + 1 < argv.length) return [...argv.slice(0, i + 1), cursor, ...argv.slice(i + 2)];
  return [...argv.filter((a) => !a.startsWith("--after=")), "--after", cursor];
}
