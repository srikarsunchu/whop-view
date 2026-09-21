// The interactive session. Transcript style like Claude Code and omp: output scrolls up in the
// terminal's own buffer, and only a three-line editor block is ever redrawn. No alternate screen.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { paint, type Role, type Theme } from "../tokens.ts";
import { copy } from "../copy.ts";
import { WHOP, cachedHelpText, whopEnv, type Mode } from "../runner.ts";
import { shellJoin } from "../argv.ts";
import { parseHelp, parseOptions, type HelpOption } from "../views/help.ts";
import { breadcrumb } from "../primitives/rule.ts";
import { keyboard, type Key } from "./keys.ts";
import { applyKey, emptyEditor, renderEditor, replaceSpan, type Candidate, type EditorState } from "./editor.ts";
import { BUILTINS, complete, toArgv, type Catalog } from "./complete.ts";
import { copyText } from "./clipboard.ts";
import type { Rec } from "../envelope.ts";

/** What the session needs from the entry point: run one command and tell it what came back. */
export interface Executor {
  (argv: string[], theme: Theme): Promise<{ code: number; rows?: Rec[]; group?: string; teach?: string[] }>;
}

export interface SessionOptions {
  theme: Theme;
  execute: Executor;
  /** Identity for the status line. */
  account?: { title?: string; id?: string; profile?: string; method?: string } | null;
  input?: NodeJS.ReadStream;
  output?: NodeJS.WriteStream;
  historyFile?: string;
  /** Which of `copy.session.tips` to show. Random when unset; fixed for tests and demos. */
  tip?: number;
  /** Which host the child `whop` talks to. Shows in the banner. Default production. */
  mode?: Mode;
}

const HISTORY_MAX = 500;
/** Two escapes this close together quit, like Claude Code. */
const DOUBLE_ESC_MS = 500;
const stateDir = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
export const HISTORY_FILE = join(stateDir, "whop-view", "history");

function loadHistory(file: string): string[] {
  try {
    return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).reverse().slice(0, HISTORY_MAX) : [];
  } catch {
    return [];
  }
}

function saveHistory(file: string, history: string[]) {
  try {
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, [...history].reverse().join("\n") + "\n");
  } catch {
    /* history is best effort */
  }
}

/** Help-backed catalog for completion. Every lookup is memoized for the life of the session. */
export function helpCatalog(ids: () => string[]): Catalog {
  const memo = new Map<string, unknown>();
  const once = <T>(key: string, f: () => T): T => {
    if (!memo.has(key)) memo.set(key, f());
    return memo.get(key) as T;
  };
  return {
    groups: async () => once("groups", () => parseHelp(cachedHelpText([])).groups.flatMap((g) => g.entries.map((e) => ({ name: e.name, desc: e.desc })))),
    verbs: async (group) => once(`verbs:${group}`, () => parseHelp(cachedHelpText([group])).groups.flatMap((g) => g.entries.map((e) => ({ name: e.name, desc: e.desc })))),
    options: async (group, verb) => once(`opts:${group}.${verb}`, (): HelpOption[] => parseOptions(cachedHelpText([group, verb]))),
    ids,
  };
}

/** The banner: identity breadcrumb, then one tip. Pure, so tests and demos can pin the tip. */
export function banner(theme: Theme, account: SessionOptions["account"], api: string | undefined, headline: string, tip: number, mode: Mode = "production"): string[] {
  const a = account;
  const segs: [string, Role?][] = [];
  if (a?.title) segs.push([a.title, "accent"]);
  if (a?.id) segs.push([a.id, "muted"]);
  if (a || mode === "sandbox") segs.push([copy.session.mode(mode), mode === "sandbox" ? "good" : "warn"]);
  if (a?.profile) segs.push([`${a.profile}${a.method ? " · " + a.method : ""}`, "text"]);
  if (api) segs.push([`${copy.help.api} ${api}`, "muted"]);
  segs.push([copy.session.welcome(headline), "muted"]);
  const tips = copy.session.tips;
  const [prefix, command, suffix] = tips[((tip % tips.length) + tips.length) % tips.length];
  return [...breadcrumb(theme, segs), " " + paint(theme, "warn", "●") + " " + paint(theme, "warn", copy.session.tip) + "  " + prefix + paint(theme, "accent", command) + suffix];
}

export async function session(opts: SessionOptions): Promise<number> {
  const out = opts.output ?? process.stdout;
  const input = opts.input ?? process.stdin;
  const theme = opts.theme;
  const historyFile = opts.historyFile ?? HISTORY_FILE;
  const write = (s: string) => out.write(s);
  const print = (lines: string[]) => write(lines.join("\n") + "\n");

  let editor: EditorState = emptyEditor(loadHistory(historyFile));
  /** Open completion list, with the pointer. Tab cycles, enter picks, escape closes. */
  let picker: { candidates: Candidate[]; selected: number; span: { start: number; end: number } } | undefined;
  let notice: { text: string; role: Role } | undefined;
  let lastRows: { group: string; ids: string[] } | null = null;
  /** The agent command under the last view, for `copy json`. */
  let lastTeach: string[] | undefined;
  const mode = opts.mode ?? "production";
  const env = whopEnv(mode);
  let lastEsc = 0;
  let drawn = 0;
  let busy = false;
  let quitting = false;

  const catalog = helpCatalog(() => lastRows?.ids ?? []);
  const help = parseHelp(cachedHelpText([]));

  print(banner(theme, opts.account, help.api, help.headline, opts.tip ?? Math.floor(Math.random() * copy.session.tips.length), mode));
  print([""]);

  const hint = () => {
    if (picker) return copy.session.hints.completing;
    return (lastRows && lastRows.ids.length ? `${copy.session.rows(lastRows.ids.length)} · ` : "") + copy.session.hints.idle;
  };

  const draw = () => {
    const r = renderEditor(editor, theme, { hint: hint(), candidates: picker?.candidates, selected: picker?.selected, notice: notice?.text, noticeRole: notice?.role });
    write(r.lines.join("\n"));
    const up = r.lines.length - 1 - r.cursorRow;
    write((up > 0 ? `\x1b[${up}A` : "") + "\r" + (r.cursorCol > 0 ? `\x1b[${r.cursorCol}C` : ""));
    drawn = r.lines.length;
  };
  /** Cursor sits on the prompt row (row 1). Go to the block's first row and clear to the end of the screen. */
  const erase = () => {
    if (!drawn) return;
    write("\x1b[1A\r\x1b[0J");
    drawn = 0;
  };
  const redraw = () => {
    erase();
    draw();
  };

  const kb = keyboard(onKey, input, out);

  /** Run something that owns the terminal, then come back. */
  const suspend = async <T>(f: () => Promise<T> | T): Promise<T> => {
    busy = true;
    kb.pause();
    try {
      return await f();
    } finally {
      kb.resume();
      busy = false;
    }
  };

  /** What you typed, with the same gutter glyph callouts use, so the transcript reads as one system. */
  const echo = (text: string) => print([` ${paint(theme, "accent", "▌")} ${text}`]);

  const remember = (line: string) => {
    const history = [line, ...editor.history.filter((h) => h !== line)].slice(0, HISTORY_MAX);
    editor = { ...emptyEditor(history) };
    saveHistory(historyFile, history);
  };

  const run = async (argv: string[]) => {
    const r = await suspend(() => opts.execute(argv, theme));
    if (r.rows && r.group) lastRows = { group: r.group, ids: r.rows.map((row) => (typeof row.id === "string" ? row.id : "")).filter(Boolean) };
    if (r.teach) lastTeach = r.teach;
    return r;
  };

  /** Row `n` of the last list, or a notice explaining why not. */
  const rowId = (n: number): string | undefined => {
    const ids = lastRows?.ids ?? [];
    if (!lastRows || n < 1 || n > ids.length) {
      notice = { text: copy.session.noRow(n, ids.length), role: "warn" };
      return;
    }
    return ids[n - 1];
  };

  const submit = async () => {
    const line = editor.text.trim();
    erase();
    picker = undefined;
    notice = undefined;
    if (!line) return draw();
    echo(line);
    remember(line);
    const argv = toArgv(line);
    const [head] = argv;
    if (head === "quit" || head === "exit" || head === "q") return quit();
    if (head === "clear") {
      write("\x1b[2J\x1b[H");
      return draw();
    }
    if (head === "help" || head === "?") await run(argv.length > 1 ? [argv[1]] : []);
    else if (head === "!" || line.startsWith("!")) {
      // Raw whop, owning the terminal, exactly as typed.
      const raw = toArgv(line.replace(/^!\s*/, ""));
      await suspend(() => spawnSync(WHOP, raw, { stdio: "inherit", env }));
    } else if (head === "copy" && argv.length === 2) {
      // `copy json` puts the teaching command on the clipboard, quoted once, the same bytes the footer shows.
      const text = argv[1] === "json" ? (lastTeach ? shellJoin(lastTeach) : undefined) : /^\d+$/.test(argv[1]) ? rowId(Number(argv[1])) : argv[1];
      if (argv[1] === "json" && !text) notice = { text: copy.session.noTeach, role: "warn" };
      if (text) {
        await copyText(text, out);
        notice = { text: copy.session.copied(text), role: "good" };
      }
      return draw();
    } else if (/^\d+$/.test(head) && argv.length === 1) {
      const id = rowId(Number(head));
      if (id) {
        const verbs = await catalog.verbs(lastRows!.group);
        if (!verbs.some((v) => v.name === "get")) notice = { text: copy.session.noGet(lastRows!.group), role: "warn" };
        else await run([lastRows!.group, "get", id]);
      }
    } else await run(argv);
    print([""]);
    draw();
  };

  /** Put candidate `i` into the line, replacing the word being completed. */
  const pick = (i: number) => {
    if (!picker) return;
    const c = picker.candidates[i];
    editor = replaceSpan(editor, picker.span.start, picker.span.end, c.name + " ");
    picker = undefined;
  };

  const tab = async () => {
    if (picker) {
      picker.selected = (picker.selected + 1) % picker.candidates.length;
      return redraw();
    }
    const c = await complete(editor.text, editor.cursor, catalog);
    if (c.replace) editor = replaceSpan(editor, c.replace.start, c.replace.end, c.replace.text);
    if (c.candidates.length > 1) {
      // The word to replace on pick: whatever precedes the cursor back to the last space.
      const cs = [...editor.text].slice(0, editor.cursor).join("");
      const start = cs.lastIndexOf(" ") + 1;
      picker = { candidates: c.candidates, selected: 0, span: { start, end: editor.cursor } };
    }
    redraw();
  };

  let resolveDone: (code: number) => void = () => {};
  const done = new Promise<number>((res) => (resolveDone = res));

  const quit = () => {
    if (quitting) return;
    quitting = true;
    erase();
    print([" " + paint(theme, "muted", copy.session.bye)]);
    kb.close();
    out.off("resize", onResize);
    resolveDone(0);
  };

  function onKey(k: Key) {
    if (busy) return;
    // The picker owns enter and escape while it is open. Every other key closes it and edits.
    if (picker && k.name === "enter") {
      pick(picker.selected);
      return redraw();
    }
    if (picker && k.name === "escape") {
      picker = undefined;
      return redraw();
    }
    const { state, action } = applyKey(editor, k);
    editor = state;
    if (action !== "complete") picker = undefined;
    notice = undefined;
    if (k.name === "escape") {
      const now = Date.now();
      if (now - lastEsc < DOUBLE_ESC_MS && !editor.text) return quit();
      lastEsc = now;
    }
    switch (action) {
      case "submit":
        void submit();
        return;
      case "quit":
        quit();
        return;
      case "complete":
        void tab();
        return;
      case "redraw":
        write("\x1b[2J\x1b[H");
        drawn = 0;
        draw();
        return;
    }
    redraw();
  }

  function onResize() {
    theme.width = out.columns ?? theme.width;
    theme.breakpoint = theme.width < 80 ? "narrow" : theme.width < 120 ? "normal" : "wide";
    if (!busy) redraw();
  }
  out.on("resize", onResize);

  kb.resume();
  draw();
  return done;
}

/** The builtins, for the help view's session hint. */
export const SESSION_BUILTINS = BUILTINS;
