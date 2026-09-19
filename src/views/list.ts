import type { PageInfo, Rec } from "../envelope.ts";
import { chooseColumns, infer } from "../infer.ts";
import type { Hints } from "../hints.ts";
import { table, type TableCell, type TableColumn } from "../primitives/table.ts";
import { footer } from "../primitives/footer.ts";
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
}

export function listView(input: ListInput, theme: Theme): string[] {
  const { group, argv, rows, page, hints } = input;
  const out: string[] = [];
  const left = paint(theme, "accent", group) + paint(theme, "muted", ` · ${rows.length}`);
  const right = input.accountTitle ? paint(theme, "muted", input.accountTitle) : "";
  const gap = theme.width - 1 - width(left) - width(right);
  out.push(" " + left + (right ? padStart(right, Math.max(2, gap) + width(right)) : ""));
  out.push("");

  if (rows.length === 0) {
    out.push(" " + copy.list.empty(group));
    out.push(...footer([["try", copy.list.emptyHint(group)]], theme));
    return out;
  }

  const columns = chooseColumns(rows, hints, theme.breakpoint);
  const cells = rows.map((r) => {
    const c: Record<string, TableCell> = {};
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
  const t = table(tcols, cells, theme);
  out.push(...t.lines);
  out.push("");

  // The teaching line names exactly the columns on screen, not the ones we wished for.
  const shown = t.kept;
  const pageLine = page.has_next_page && page.end_cursor ? copy.list.next(page.end_cursor) : copy.list.noMore;
  const teach = ["whop", ...argv, "--format", "json", "--filter-output", shown.join(",")];
  if (takesAccount(argv) && !argv.includes("--account_id")) teach.splice(1 + argv.length, 0, "--account_id", "<biz_id>");
  out.push(...footer([`${copy.list.of(rows.length, null)} · ${pageLine}`, [copy.list.json, teach.join(" ")]], theme));
  return out;
}
