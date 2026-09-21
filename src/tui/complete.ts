// Tab completion for the session. Groups and verbs come from `whop --help`; flags from `whop <g> <v> --help`.
import { ID_RE } from "../infer.ts";
import type { HelpOption } from "../views/help.ts";
import type { Candidate } from "./editor.ts";

export interface Catalog {
  groups(): Promise<Candidate[]>;
  verbs(group: string): Promise<Candidate[]>;
  options(group: string, verb: string): Promise<HelpOption[]>;
  /** Ids on screen from the last list, newest first. */
  ids(): string[];
}

/** Built-in words the session understands that `whop` does not. */
export const BUILTINS: Candidate[] = [
  { name: "home", desc: "identity, balance, and a 7-day net revenue sparkline" },
  { name: "gtm", desc: "funnel, people, audiences, campaigns, offers, and launch gaps" },
  { name: "doctor", desc: "is this business set up to sell: login, identity, api key, pixel, page, products, webhooks" },
  { name: "help", desc: "every command group" },
  { name: "copy", desc: "copy a row's id, or json for the agent command, to the clipboard" },
  { name: "next", desc: "the next page of the last list" },
  { name: "clear", desc: "clear the screen" },
  { name: "quit", desc: "leave the session" },
];

export interface Completion {
  candidates: Candidate[];
  /** When there is one candidate, or a common prefix longer than the token: what to insert. */
  replace?: { start: number; end: number; text: string };
}

/** Splits a command line into words with their start offsets. Quotes group, backslash escapes. */
export function tokenize(text: string): { word: string; start: number; end: number }[] {
  const out: { word: string; start: number; end: number }[] = [];
  let i = 0;
  const cs = [...text];
  while (i < cs.length) {
    while (i < cs.length && cs[i] === " ") i++;
    if (i >= cs.length) break;
    const start = i;
    let word = "";
    let quote: string | null = null;
    while (i < cs.length && (quote || cs[i] !== " ")) {
      const c = cs[i];
      if (quote) {
        if (c === quote) quote = null;
        else word += c;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === "\\" && i + 1 < cs.length) word += cs[++i];
      else word += c;
      i++;
    }
    out.push({ word, start, end: i });
  }
  return out;
}

/** Shell-style argv from a line. Leading `wv` or `whop` is dropped so people can paste either. */
export function toArgv(text: string): string[] {
  const words = tokenize(text).map((t) => t.word);
  while (words.length && (words[0] === "wv" || words[0] === "whop")) words.shift();
  return words;
}

/**
 * How well `query` matches `name`, higher is better, 0 is no match. Prefix beats subsequence,
 * denser matches beat sparse ones. Borrowed from the Dodo CLI's palette.
 */
export function score(query: string, name: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const n = name.toLowerCase();
  if (n.startsWith(q)) return 100 + (q.length / n.length) * 20;
  let qi = 0;
  for (let ni = 0; ni < n.length && qi < q.length; ni++) if (n[ni] === q[qi]) qi++;
  return qi === q.length ? 50 + (q.length / n.length) * 20 : 0;
}

/**
 * Candidates that match `word`. Prefix matches win outright, in catalog order, so tab keeps
 * behaving like a shell. Only when nothing starts with the word do in-order subsequence matches
 * appear, best first, so `mbr` finds memberships and `pl` still lists plans before anything else.
 */
export function rank(pool: Candidate[], word: string): Candidate[] {
  const heads = pool.filter((c) => score(word, c.name) >= 100);
  if (heads.length || !word) return heads.length ? heads : pool;
  return pool
    .map((c, i) => ({ c, s: score(word, c.name), i }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || a.c.name.length - b.c.name.length || a.i - b.i)
    .map((r) => r.c);
}

function commonPrefix(names: string[]): string {
  if (names.length === 0) return "";
  let p = names[0];
  for (const n of names.slice(1)) {
    let i = 0;
    while (i < p.length && i < n.length && p[i] === n[i]) i++;
    p = p.slice(0, i);
  }
  return p;
}

export async function complete(text: string, cursor: number, catalog: Catalog): Promise<Completion> {
  const cs = [...text];
  const before = cs.slice(0, cursor).join("");
  const tokens = tokenize(before);
  const atWordEnd = tokens.length > 0 && tokens[tokens.length - 1].end === cursor && before[cursor - 1] !== " ";
  const cur = atWordEnd ? tokens[tokens.length - 1] : { word: "", start: cursor, end: cursor };
  const prior = (atWordEnd ? tokens.slice(0, -1) : tokens).map((t) => t.word).filter((w, i) => !(i === 0 && (w === "wv" || w === "whop")));

  let pool: Candidate[] = [];
  let suffix = " ";
  if (prior.length === 0) {
    pool = [...(await catalog.groups()), ...BUILTINS];
  } else if (prior.length === 1) {
    if (prior[0] === "copy") pool = [{ name: "json", desc: "the agent command under the last view" }, ...catalog.ids().map((id) => ({ name: id }))];
    else if (!BUILTINS.some((b) => b.name === prior[0])) pool = await catalog.verbs(prior[0]);
  } else {
    const [group, verb] = prior;
    const prev = prior[prior.length - 1];
    const opts = await catalog.options(group, verb);
    const prevOpt = opts.find((o) => o.flag === prev);
    if (cur.word.startsWith("-")) {
      const used = new Set(prior.filter((w) => w.startsWith("--")));
      pool = opts.filter((o) => !used.has(o.flag)).map((o) => ({ name: o.flag, desc: (o.arg ? o.arg + "  " : "") + o.desc }));
    } else if (prevOpt?.arg && !/_id>|<string>/.test(prevOpt.arg) && prevOpt.arg.includes("|")) {
      pool = prevOpt.arg.slice(1, -1).split("|").map((v) => ({ name: v }));
    } else if ((prevOpt?.arg && /_id/.test(prevOpt.flag)) || (!prevOpt && prior.length === 2)) {
      // A positional after the verb, or a value for an `--x_id` flag: offer ids from the last list.
      pool = catalog.ids().map((id) => ({ name: id }));
    } else if (prevOpt?.arg) {
      pool = [];
    } else if (!prevOpt) {
      pool = [];
    }
  }
  const candidates = rank(pool, cur.word);
  if (candidates.length === 0) return { candidates: [] };
  if (candidates.length === 1) return { candidates, replace: { start: cur.start, end: cur.end, text: candidates[0].name + suffix } };
  // Several prefix matches fill the common prefix. Subsequence matches share none, so the line stays put.
  const prefix = commonPrefix(candidates.map((c) => c.name));
  const replace = prefix.length > [...cur.word].length ? { start: cur.start, end: cur.end, text: prefix } : undefined;
  return { candidates, replace };
}

/** Whether a word is a Whop id, for the row-number and positional shortcuts. */
export const looksLikeId = (s: string) => ID_RE.test(s);
