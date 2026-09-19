import { padEnd, padStart, truncate, width } from "../ansi.ts";
import { GUTTER, paint, type Role, type Theme } from "../tokens.ts";

export interface TableColumn {
  key: string;
  label: string;
  align: "left" | "right";
  /** Lower is kept longer under width pressure. 0 never drops. */
  priority: number;
  /** Cap in columns. Longer cells truncate. Applied before any column is dropped. */
  max?: number;
}

export interface TableCell {
  text: string;
  role: Role;
}

/** Renders rows to lines. Drops low-priority columns until the table fits, then truncates the primary. */
export interface TableResult {
  lines: string[];
  /** Keys of the columns that survived width pressure, in order. */
  kept: string[];
}

export function table(columns: TableColumn[], rows: Record<string, TableCell>[], theme: Theme): TableResult {
  let cols = [...columns];
  const natural = () => cols.map((c) => Math.min(c.max ?? Infinity, Math.max(width(c.label), ...rows.map((r) => width(r[c.key]?.text ?? "")))));
  const total = (w: number[]) => w.reduce((a, b) => a + b, 0) + GUTTER * (w.length - 1) + 1;

  let widths = natural();
  while (total(widths) > theme.width && cols.length > 1) {
    const droppable = cols.filter((c) => c.priority > 0).sort((a, b) => b.priority - a.priority)[0];
    if (!droppable) break;
    cols = cols.filter((c) => c !== droppable);
    widths = natural();
  }
  // Still too wide: shrink the widest left-aligned column (the primary is usually it).
  while (total(widths) > theme.width) {
    const i = widths.indexOf(Math.max(...widths.filter((_, j) => cols[j].align === "left")));
    if (i < 0 || widths[i] <= 8) break;
    widths[i] = Math.max(8, widths[i] - (total(widths) - theme.width));
  }

  const line = (cells: string[], roles: Role[]) =>
    " " +
    cells
      .map((c, i) => {
        const t = truncate(c, widths[i]);
        const last = i === cols.length - 1;
        const padded = cols[i].align === "right" ? padStart(t, widths[i]) : last ? t : padEnd(t, widths[i]);
        return paint(theme, roles[i], padded);
      })
      .join(" ".repeat(GUTTER))
      .trimEnd();

  const out = [line(cols.map((c) => c.label), cols.map(() => "muted" as Role))];
  for (const r of rows) out.push(line(cols.map((c) => r[c.key]?.text ?? ""), cols.map((c) => r[c.key]?.role ?? "text")));
  return { lines: out, kept: cols.map((c) => c.key) };
}
