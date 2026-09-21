// A one-line editor as a pure reducer, plus its renderer. State in, state out; the session owns the TTY.
import { width } from "../ansi.ts";
import { paint, type Role, type Theme } from "../tokens.ts";
import { rule } from "../primitives/rule.ts";
import type { Key } from "./keys.ts";

export interface EditorState {
  text: string;
  /** Cursor position in code points. */
  cursor: number;
  history: string[];
  /** Index into history while browsing, -1 when editing the live line. */
  hIdx: number;
  /** The live line, kept while browsing history. */
  draft: string;
}

export type EditorAction = "submit" | "quit" | "complete" | "redraw" | "cancel";

export const emptyEditor = (history: string[] = []): EditorState => ({ text: "", cursor: 0, history, hIdx: -1, draft: "" });

const chars = (s: string) => [...s];
const isWord = (c: string) => /[\w-]/.test(c);

function insert(s: EditorState, text: string): EditorState {
  const cs = chars(s.text);
  const t = chars(text.replace(/\r?\n/g, " "));
  cs.splice(s.cursor, 0, ...t);
  return { ...s, text: cs.join(""), cursor: s.cursor + t.length, hIdx: -1 };
}

function del(s: EditorState, from: number, to: number): EditorState {
  const cs = chars(s.text);
  const a = Math.max(0, Math.min(from, to));
  const b = Math.min(cs.length, Math.max(from, to));
  cs.splice(a, b - a);
  return { ...s, text: cs.join(""), cursor: a, hIdx: -1 };
}

/** Start of the word before the cursor. */
function wordLeft(s: EditorState): number {
  const cs = chars(s.text);
  let i = s.cursor;
  while (i > 0 && !isWord(cs[i - 1])) i--;
  while (i > 0 && isWord(cs[i - 1])) i--;
  return i;
}

/** End of the word after the cursor. */
function wordRight(s: EditorState): number {
  const cs = chars(s.text);
  let i = s.cursor;
  while (i < cs.length && !isWord(cs[i])) i++;
  while (i < cs.length && isWord(cs[i])) i++;
  return i;
}

function history(s: EditorState, dir: -1 | 1): EditorState {
  if (s.history.length === 0) return s;
  // history[0] is the newest. Up moves to older entries, down back toward the live draft.
  const next = s.hIdx - dir;
  if (next < -1 || next >= s.history.length) return s;
  const draft = s.hIdx === -1 ? s.text : s.draft;
  const text = next === -1 ? draft : s.history[next];
  return { ...s, hIdx: next, draft, text, cursor: chars(text).length };
}

/** Applies one key. Returns the next state and, when the key means something beyond editing, an action. */
export function applyKey(s: EditorState, k: Key): { state: EditorState; action?: EditorAction } {
  const len = chars(s.text).length;
  if (k.name === "paste") return { state: insert(s, k.ch ?? "") };
  if (k.name === "char" && !k.ctrl && !k.meta) return { state: insert(s, k.ch ?? "") };
  if (k.name === "enter") return { state: s, action: "submit" };
  if (k.name === "tab") return { state: s, action: "complete" };
  if (k.name === "escape") return { state: s, action: "cancel" };
  if (k.ctrl) {
    switch (k.name) {
      case "c":
        return s.text ? { state: { ...s, text: "", cursor: 0, hIdx: -1 }, action: "cancel" } : { state: s, action: "quit" };
      case "d":
        return s.text ? { state: del(s, s.cursor, s.cursor + 1) } : { state: s, action: "quit" };
      case "l":
        return { state: s, action: "redraw" };
      case "a":
        return { state: { ...s, cursor: 0 } };
      case "e":
        return { state: { ...s, cursor: len } };
      case "b":
        return { state: { ...s, cursor: Math.max(0, s.cursor - 1) } };
      case "f":
        return { state: { ...s, cursor: Math.min(len, s.cursor + 1) } };
      case "u":
        return { state: del(s, 0, s.cursor) };
      case "k":
        return { state: del(s, s.cursor, len) };
      case "w":
        return { state: del(s, wordLeft(s), s.cursor) };
      case "p":
        return { state: history(s, -1) };
      case "n":
        return { state: history(s, 1) };
      case "left":
        return { state: { ...s, cursor: wordLeft(s) } };
      case "right":
        return { state: { ...s, cursor: wordRight(s) } };
    }
    return { state: s };
  }
  if (k.meta) {
    switch (k.name) {
      case "b":
      case "left":
        return { state: { ...s, cursor: wordLeft(s) } };
      case "f":
      case "right":
        return { state: { ...s, cursor: wordRight(s) } };
      case "d":
        return { state: del(s, s.cursor, wordRight(s)) };
      case "backspace":
        return { state: del(s, wordLeft(s), s.cursor) };
    }
    return { state: s };
  }
  switch (k.name) {
    case "backspace":
      return { state: s.cursor === 0 ? s : del(s, s.cursor - 1, s.cursor) };
    case "delete":
      return { state: del(s, s.cursor, s.cursor + 1) };
    case "left":
      return { state: { ...s, cursor: Math.max(0, s.cursor - 1) } };
    case "right":
      return { state: { ...s, cursor: Math.min(len, s.cursor + 1) } };
    case "home":
      return { state: { ...s, cursor: 0 } };
    case "end":
      return { state: { ...s, cursor: len } };
    case "up":
      return { state: history(s, -1) };
    case "down":
      return { state: history(s, 1) };
  }
  return { state: s };
}

/** Replace the span [start, end) with text and put the cursor after it. Used by completion. */
export function replaceSpan(s: EditorState, start: number, end: number, text: string): EditorState {
  const cs = chars(s.text);
  cs.splice(start, end - start, ...chars(text));
  return { ...s, text: cs.join(""), cursor: start + chars(text).length, hIdx: -1 };
}

export interface Candidate {
  name: string;
  desc?: string;
}

export interface EditorRender {
  lines: string[];
  /** Row within `lines` where the cursor sits. */
  cursorRow: number;
  /** Zero-based column of the cursor on that row. */
  cursorCol: number;
}

export const PROMPT = "❯";
export const MAX_CANDIDATES = 8;

export interface EditorRenderOptions {
  /** The key hint for the current state. Always the last line. */
  hint: string;
  candidates?: Candidate[];
  /** Index into `candidates` drawn with a pointer. */
  selected?: number;
  /** A one-line message in place of the hint. */
  notice?: string;
  noticeRole?: Role;
}

/** The slice of a candidate list to show so that `selected` stays in view. */
export function candidateWindow(selected: number, total: number, max = MAX_CANDIDATES): { start: number; end: number } {
  if (total <= max) return { start: 0, end: total };
  const start = Math.max(0, Math.min(selected - Math.floor(max / 2), total - max));
  return { start, end: start + max };
}

/**
 * The live region: a rule, the prompt line, a rule, then completion candidates when there are
 * any, then the key hint or a notice. Text longer than the line scrolls horizontally so the
 * cursor stays visible.
 */
export function renderEditor(s: EditorState, theme: Theme, opts: EditorRenderOptions): EditorRender {
  const lead = ` ${paint(theme, "accent", PROMPT)} `;
  const room = Math.max(8, theme.width - 3 - 1);
  const cs = chars(s.text);
  let start = 0;
  if (cs.length > room) start = Math.max(0, Math.min(s.cursor - Math.floor(room * 0.75), cs.length - room));
  const visible = cs.slice(start, start + room).join("");
  const prompt = lead + visible;
  const lines = [rule(theme), prompt, rule(theme)];
  if (opts.candidates?.length) {
    const all = opts.candidates;
    const sel = opts.selected ?? -1;
    const win = candidateWindow(Math.max(0, sel), all.length);
    const cands = all.slice(win.start, win.end);
    const nameW = Math.max(...cands.map((c) => width(c.name)));
    if (win.start > 0) lines.push("   " + paint(theme, "muted", `↑ ${win.start} above`));
    cands.forEach((c, i) => {
      const on = win.start + i === sel;
      const mark = on ? paint(theme, "accent", PROMPT) + " " : "  ";
      const desc = c.desc ? "  " + paint(theme, "muted", truncateTo(c.desc, theme.width - 4 - nameW - 2)) : "";
      lines.push(" " + mark + (on ? paint(theme, "accent", padTo(c.name, nameW)) : padTo(c.name, nameW)) + desc);
    });
    if (win.end < all.length) lines.push("   " + paint(theme, "muted", `↓ ${all.length - win.end} below`));
  }
  if (opts.notice) lines.push(" " + paint(theme, opts.noticeRole ?? "warn", truncateTo(opts.notice, theme.width - 1)));
  else lines.push(" " + paint(theme, "muted", truncateTo(opts.hint, theme.width - 1)));
  return { lines, cursorRow: 1, cursorCol: 3 + width(cs.slice(start, s.cursor).join("")) };
}

const padTo = (s: string, n: number) => s + " ".repeat(Math.max(0, n - width(s)));

function truncateTo(s: string, n: number): string {
  if (width(s) <= n) return s;
  const cs = chars(s);
  let out = "";
  for (const c of cs) {
    if (width(out) + width(c) > n - 1) break;
    out += c;
  }
  return out.trimEnd() + "…";
}
