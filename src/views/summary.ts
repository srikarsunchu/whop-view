import { kv, type KvSection } from "../primitives/kv.ts";
import { footer } from "../primitives/footer.ts";
import { teach } from "../argv.ts";
import { paint, type Theme } from "../tokens.ts";
import { statusLabel, statusRole } from "../status.ts";
import { copy } from "../copy.ts";
import { num } from "../format.ts";
import { truncate, width } from "../ansi.ts";

export interface SummaryInput {
  argv: string[];
  total: number;
  groups: Record<string, Record<string, number>>;
}

/**
 * Counts by facet: `disputes summary`, `resolution-center-cases summary`. One section per facet,
 * one row per bucket. Status buckets take the status color so `needs_response 3` reads as urgent.
 * Zero rows stay, since "won 0" is an answer; an empty facet (no currencies yet) is skipped.
 */
export function summaryView(input: SummaryInput, theme: Theme): string[] {
  const { argv, total, groups } = input;
  const out: string[] = [];
  // Under width pressure the count goes first, then the name truncates. `resolution-center-cases summary` is 31 wide on its own.
  const name = argv.slice(0, 2).join(" ");
  const count = ` · ${copy.summary.total(total)}`;
  const room = theme.width - 1;
  const head = width(name) + width(count) <= room ? paint(theme, "accent", name) + paint(theme, "muted", count) : paint(theme, "accent", truncate(name, room));
  out.push(" " + head);
  out.push("");
  const sections: KvSection[] = Object.entries(groups).map(([facet, buckets]) => ({
    title: copy.summary.facet(facet),
    rows: Object.entries(buckets).map(([k, n]) => ({
      key: facet === "status" ? statusLabel(k) : k.replace(/_/g, " "),
      value: num(n),
      role: n === 0 ? "muted" : facet === "status" ? statusRole(k) : "text",
    })),
  }));
  const body = kv(sections, theme);
  if (body.length) out.push(...body, "");
  else out.push(" " + copy.summary.empty, "");
  out.push(...footer([[copy.list.json, teach(argv)]], theme));
  return out;
}
