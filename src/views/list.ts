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
}

export function listView(input: ListInput, theme: Theme): string[] {
  return listViewWithMeta(input, theme).lines;
}

/** `listView` plus where the rows landed, so the session can repaint a picked row in place. */
export function listViewWithMeta(input: ListInput, theme: Theme): ListRender {
  const { group, argv, rows, page, hints } = input;
  const out: string[] = [];
  const left = paint(theme, "accent", group) + paint(theme, "muted", ` · ${rows.length}`);
  const right = input.accountTitle ? paint(theme, "muted", input.accountTitle) : "";
  const gap = theme.width - 1 - width(left) - width(right);
  out.push(" " + left + (right ? padStart(right, Math.max(2, gap) + width(right)) : ""));
  out.push("");

  if (rows.length === 0) {
    out.push(" " + copy.list.empty(group));
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

  // The teaching line names exactly the columns on screen, not the ones we wished for.
  const shown = t.kept.filter((k) => k !== ROW_KEY);
  const pageLine = page.has_next_page && page.end_cursor ? copy.list.next(page.end_cursor) : copy.list.noMore;
  const scoped = takesAccount(argv) && !argv.includes("--account_id") ? [...argv, "--account_id", "<biz_id>"] : argv;
  const teach = teachArgv(scoped, "--filter-output", shown.join(","));
  out.push(...footer([`${copy.list.of(rows.length, null)} · ${pageLine}`, [copy.list.json, teach]], theme));
  return { lines: out, rowStart, rowCount: rows.length, teach };
}
