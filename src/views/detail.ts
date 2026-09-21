import type { Rec } from "../envelope.ts";
import { ID_RE, infer, labelFor, type Cell } from "../infer.ts";
import type { Hints } from "../hints.ts";
import { kv, type KvRow, type KvSection } from "../primitives/kv.ts";
import { footer } from "../primitives/footer.ts";
import { paint, type Theme } from "../tokens.ts";
import { copy } from "../copy.ts";

export interface DetailInput {
  group: string;
  argv: string[];
  record: Rec;
  hints: Hints;
}

const noun = (group: string) => group.replace(/-/g, " ").replace(/s$/, "");

export function detailView(input: DetailInput, theme: Theme): string[] {
  const { group, argv, record, hints } = input;
  const sections: Record<keyof typeof copy.detail.sections, KvRow[]> = { identity: [], status: [], money: [], dates: [], relations: [], other: [] };

  const primaryKey = hints.primary ?? ["title", "name", "key"].find((k) => typeof record[k] === "string");
  const raw = primaryKey && typeof record[primaryKey] === "string" ? (record[primaryKey] as string) : "";
  // An id is not a title. Fall back to the resource noun and let the id show in the header.
  const title = ID_RE.test(raw) ? "" : raw;
  const id = typeof record.id === "string" ? record.id : "";

  for (const [key, value] of Object.entries(record)) {
    if (key === "id" || (key === primaryKey && title)) continue;
    const cell = infer(key, value, record, hints);
    if (cell.kind === "hidden" || cell.kind === "empty") continue;
    const row: KvRow = { key: labelFor(key, hints), value: cell.long, role: cell.role === "mono" ? "muted" : cell.role, extra: cell.extra };
    sections[bucket(key, cell)].push(row);
  }

  const out: string[] = [];
  const fallback = id ? noun(group) : argv.slice(0, 2).join(" ");
  const head = `${paint(theme, "accent", title || fallback)}${id ? "  " + paint(theme, "muted", id) : ""}`;
  out.push(" " + head);
  out.push("");
  const kvSections: KvSection[] = (Object.keys(sections) as (keyof typeof sections)[]).map((k) => ({ title: copy.detail.sections[k], rows: sections[k] }));
  const body = kv(kvSections, theme);
  if (body.length) out.push(...body, "");
  out.push(...footer([[copy.list.json, ["whop", ...argv, "--format", "json"].join(" ")]], theme));
  return out;
}

function bucket(key: string, cell: Cell): keyof typeof copy.detail.sections {
  if (/route|url|slug|email|username|domain|origin/.test(key) || cell.kind === "image") return "identity";
  if (cell.kind === "status" || cell.kind === "bool") return "status";
  if (cell.kind === "money" || cell.kind === "plan") return "money";
  if (cell.kind === "date") return "dates";
  if (cell.kind === "relation" || cell.kind === "user" || cell.kind === "id" || key.endsWith("_id")) return "relations";
  return "other";
}
