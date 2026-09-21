import { money, shortDate } from "../format.ts";
import { footer } from "../primitives/footer.ts";
import { kv } from "../primitives/kv.ts";
import { paint, type Theme } from "../tokens.ts";
import { copy } from "../copy.ts";
import { sparkline } from "./home.ts";

export interface SeriesInput {
  argv: string[];
  points: { timestamp: number; value: number }[];
  currency?: string;
}

/** `stats get <metric>`: total and sparkline up top, then one row per point with the money formatted. */
export function seriesView(input: SeriesInput, theme: Theme): string[] {
  const { argv, points } = input;
  const metric = argv.slice(2).find((a) => !a.startsWith("--")) ?? argv[1] ?? "";
  const values = points.map((p) => p.value);
  const total = values.reduce((a, b) => a + b, 0);
  const cur = input.currency ?? "usd";
  const title = `${metric.replace(/_/g, " ")} · ${points.length}${argv.includes("day") ? "d" : ""}`;
  const out: string[] = [];
  out.push(" " + paint(theme, "accent", title) + "  " + money(total, cur) + "  " + paint(theme, "good", sparkline(values)));
  out.push("");
  out.push(
    ...kv(
      [
        {
          rows: points.map((p) => ({ key: shortDate(p.timestamp), value: money(p.value, cur), role: p.value === 0 ? ("muted" as const) : ("text" as const) })),
        },
      ],
      theme,
    ),
  );
  out.push("");
  out.push(...footer([[copy.list.json, ["whop", ...argv, "--format", "json"].join(" ")]], theme));
  return out;
}
