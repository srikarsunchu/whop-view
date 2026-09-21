import { padEnd, truncate, width } from "../ansi.ts";
import { paint, type Theme } from "../tokens.ts";
import { copy } from "../copy.ts";
import { rule } from "../primitives/rule.ts";

export interface HelpGroup {
  title: string;
  entries: { name: string; desc: string }[];
}

export interface ParsedHelp {
  headline: string;
  api?: string;
  groups: HelpGroup[];
}

/** Parses `whop --help` and `whop <group> --help`. Groups and order come from the CLI, never from us. */
export function parseHelp(text: string): ParsedHelp {
  const lines = text.split("\n");
  const head = /^(\S+)@(\S+) — (.*)$/.exec(lines[0] ?? "") ?? /^(\S+) — (.*)$/.exec(lines[0] ?? "");
  const headline = head ? (head.length === 4 ? `${head[1]} ${head[2]}` : head[1]) : (lines[0] ?? "").trim();
  const api = /API version: (.*)/.exec(text)?.[1]?.trim();
  const groups: HelpGroup[] = [];
  let current: HelpGroup | null = null;
  for (const raw of lines.slice(1)) {
    if (/^(Usage|Global Options|Options|Arguments|Examples):?/.test(raw)) {
      current = null;
      if (/^Global Options|^Options/.test(raw)) break;
      continue;
    }
    const heading = /^([A-Z][A-Z &]+|Commands):?\s*$/.exec(raw);
    if (heading) {
      current = { title: heading[1] === "Commands" ? "COMMANDS" : heading[1].trim(), entries: [] };
      groups.push(current);
      continue;
    }
    const entry = /^\s{2,}(\S+)\s{2,}(.*)$/.exec(raw);
    if (entry && current) current.entries.push({ name: entry[1], desc: entry[2].trim() });
  }
  return { headline, api, groups: groups.filter((g) => g.entries.length) };
}

export function helpView(parsed: ParsedHelp, theme: Theme, group?: string): string[] {
  const out: string[] = [];
  // Header: headline, then the API version, then the hint. Each part is dropped, right to left,
  // before the headline itself is ever truncated.
  const hint = group ? copy.help.groupHint(group) : copy.help.hint;
  const api = parsed.api ? ` · ${copy.help.api} ${parsed.api}` : "";
  const room = theme.width - 1;
  let left = paint(theme, "accent", parsed.headline) + paint(theme, "muted", api);
  let right = hint;
  if (width(parsed.headline) + width(api) + 2 + width(hint) > room) right = "";
  if (width(parsed.headline) + width(api) > room) left = paint(theme, "accent", parsed.headline);
  if (width(parsed.headline) > room) left = paint(theme, "accent", truncate(parsed.headline, room));
  const gap = room - width(left) - width(right);
  out.push(" " + left + (right ? " ".repeat(Math.max(2, gap)) + paint(theme, "muted", right) : ""));
  out.push("");

  const nameW = Math.max(...parsed.groups.flatMap((g) => g.entries.map((e) => width(e.name))));
  const twoCol = theme.breakpoint === "wide";
  const colW = twoCol ? Math.floor((theme.width - 3) / 2) : theme.width - 1;

  const blocks = parsed.groups.map((g) => {
    const lines = [paint(theme, "accent", g.title)];
    for (const e of g.entries) lines.push("  " + padEnd(e.name, nameW) + "  " + paint(theme, "muted", truncate(e.desc, colW - nameW - 4)));
    return lines;
  });

  if (!twoCol) {
    blocks.forEach((b, i) => {
      if (i) out.push("");
      out.push(rule(theme, parsed.groups[i].title));
      out.push(...b.slice(1).map((l) => " " + l));
    });
    return out;
  }
  // Two columns: fill left column to roughly half the total lines, rest on the right.
  const total = blocks.reduce((n, b) => n + b.length + 1, 0);
  const leftBlocks: string[][] = [];
  const rightBlocks: string[][] = [];
  let acc = 0;
  for (const b of blocks) (acc < total / 2 ? leftBlocks : rightBlocks).push(b), (acc += b.length + 1);
  const flatten = (bs: string[][]) => bs.flatMap((b, i) => (i ? ["", ...b] : b));
  const L = flatten(leftBlocks);
  const R = flatten(rightBlocks);
  for (let i = 0; i < Math.max(L.length, R.length); i++) out.push(" " + padEnd(L[i] ?? "", colW) + " " + (R[i] ?? ""));
  return out;
}

export interface HelpOption {
  flag: string;
  /** `<string>`, `<asc|desc>`, or undefined for a bare boolean flag. */
  arg?: string;
  desc: string;
  required: boolean;
}

/** Parses the `Options:` block of `whop <group> <verb> --help`. Global options are excluded. */
export function parseOptions(text: string): HelpOption[] {
  const out: HelpOption[] = [];
  let inOptions = false;
  for (const raw of text.split("\n")) {
    if (/^Options:?\s*$/.test(raw)) {
      inOptions = true;
      continue;
    }
    if (/^\S/.test(raw)) inOptions = false;
    if (!inOptions) continue;
    const m = /^\s{2,}(--[a-z][\w-]*)(?:\s+(<[^>]+>))?\s{2,}(.*)$/.exec(raw);
    if (m) out.push({ flag: m[1], arg: m[2], desc: m[3].trim(), required: /\(required\)/.test(m[3]) });
  }
  return out;
}
