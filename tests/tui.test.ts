// The session's pure parts: key parsing, the editor reducer, completion, and the editor render.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseKeys } from "../src/tui/keys.ts";
import { applyKey, emptyEditor, renderEditor, replaceSpan, type EditorState } from "../src/tui/editor.ts";
import { complete, tokenize, toArgv, type Catalog } from "../src/tui/complete.ts";
import { parseHelp, parseOptions } from "../src/views/help.ts";
import { fixture, theme } from "./render.ts";
import { strip, width } from "../src/ansi.ts";

test("keys: printable, control, and escape sequences", () => {
  assert.deepEqual(parseKeys("ab"), [{ name: "char", ch: "a" }, { name: "char", ch: "b" }]);
  assert.deepEqual(parseKeys("\r"), [{ name: "enter" }]);
  assert.deepEqual(parseKeys("\t"), [{ name: "tab" }]);
  assert.deepEqual(parseKeys("\x7f"), [{ name: "backspace" }]);
  assert.deepEqual(parseKeys("\x03"), [{ name: "c", ctrl: true }]);
  assert.deepEqual(parseKeys("\x04"), [{ name: "d", ctrl: true }]);
  assert.deepEqual(parseKeys("\x1b[A\x1b[D"), [{ name: "up", ctrl: false, meta: false }, { name: "left", ctrl: false, meta: false }]);
  assert.deepEqual(parseKeys("\x1b[3~"), [{ name: "delete", ctrl: false, meta: false }]);
  assert.deepEqual(parseKeys("\x1b[1;5C"), [{ name: "right", ctrl: true, meta: false }]);
  assert.deepEqual(parseKeys("\x1bb"), [{ name: "b", meta: true }]);
  assert.deepEqual(parseKeys("\x1b\x7f"), [{ name: "backspace", meta: true }]);
  assert.deepEqual(parseKeys("\x1b"), [{ name: "escape" }]);
  assert.deepEqual(parseKeys("é"), [{ name: "char", ch: "é" }]);
});

test("keys: bracketed paste arrives as one insert", () => {
  assert.deepEqual(parseKeys("\x1b[200~products list\x1b[201~"), [{ name: "paste", ch: "products list" }]);
});

const type = (s: EditorState, text: string) => {
  for (const k of parseKeys(text)) s = applyKey(s, k).state;
  return s;
};

test("editor: insert, move, delete", () => {
  let s = type(emptyEditor(), "prodcts");
  assert.equal(s.text, "prodcts");
  s = applyKey(s, { name: "left" }).state;
  s = applyKey(s, { name: "left" }).state;
  s = applyKey(s, { name: "left" }).state;
  s = type(s, "u");
  assert.equal(s.text, "products");
  assert.equal(s.cursor, 5);
  s = applyKey(s, { name: "e", ctrl: true }).state;
  s = type(s, " list");
  s = applyKey(s, { name: "w", ctrl: true }).state;
  assert.equal(s.text, "products ");
  s = applyKey(s, { name: "u", ctrl: true }).state;
  assert.equal(s.text, "");
});

test("editor: history walks newest first and keeps the draft", () => {
  let s = emptyEditor(["plans list", "products list"]);
  s = type(s, "mem");
  s = applyKey(s, { name: "up" }).state;
  assert.equal(s.text, "plans list");
  s = applyKey(s, { name: "up" }).state;
  assert.equal(s.text, "products list");
  s = applyKey(s, { name: "up" }).state;
  assert.equal(s.text, "products list", "stops at the oldest");
  s = applyKey(s, { name: "down" }).state;
  s = applyKey(s, { name: "down" }).state;
  assert.equal(s.text, "mem", "the draft comes back");
});

test("editor: actions", () => {
  assert.equal(applyKey(emptyEditor(), { name: "enter" }).action, "submit");
  assert.equal(applyKey(emptyEditor(), { name: "tab" }).action, "complete");
  assert.equal(applyKey(emptyEditor(), { name: "d", ctrl: true }).action, "quit", "ctrl-d on an empty line quits");
  assert.equal(applyKey(emptyEditor(), { name: "c", ctrl: true }).action, "quit", "ctrl-c on an empty line quits");
  const r = applyKey(type(emptyEditor(), "abc"), { name: "c", ctrl: true });
  assert.equal(r.action, "cancel");
  assert.equal(r.state.text, "", "ctrl-c with text clears it");
  assert.equal(applyKey(type(emptyEditor(), "abc"), { name: "d", ctrl: true }).action, undefined, "ctrl-d with text is delete");
});

test("editor: render fits the width and scrolls long lines", () => {
  const t = theme(40, false);
  const long = type(emptyEditor(), "products list --query something-very-long-indeed --first 50");
  const r = renderEditor(long, t, { hint: "hint" });
  for (const l of r.lines) assert.ok(width(l) <= 40, `line exceeds 40: ${JSON.stringify(strip(l))}`);
  assert.equal(r.cursorRow, 1);
  assert.ok(r.cursorCol < 40);
  assert.ok(strip(r.lines[1]).endsWith("50"), "the cursor end of the line is visible");
  const short = renderEditor(type(emptyEditor(), "plans"), t, { hint: "hint", candidates: [{ name: "list", desc: "List Plans" }, { name: "get", desc: "Retrieve Plan" }] });
  assert.equal(strip(short.lines[1]), " ❯ plans");
  assert.equal(short.cursorCol, 3 + 5);
  assert.match(strip(short.lines[3]), /list\s+List Plans/);
});

test("tokenize and toArgv honour quotes and drop a leading wv/whop", () => {
  assert.deepEqual(toArgv(`whop products update prod_x --title "Frame Pro"`), ["products", "update", "prod_x", "--title", "Frame Pro"]);
  assert.deepEqual(toArgv("wv plans list"), ["plans", "list"]);
  assert.deepEqual(
    tokenize("a  bb c").map((t) => [t.word, t.start, t.end]),
    [
      ["a", 0, 1],
      ["bb", 3, 5],
      ["c", 6, 7],
    ],
  );
});

const catalog: Catalog = {
  groups: async () => parseHelp(fixture("help.txt")).groups.flatMap((g) => g.entries.map((e) => ({ name: e.name, desc: e.desc }))),
  verbs: async (g) => (g === "products" ? parseHelp(fixture("help.products.txt")).groups.flatMap((x) => x.entries.map((e) => ({ name: e.name, desc: e.desc }))) : []),
  options: async (g, v) =>
    g === "products" && v === "list"
      ? parseOptions(
          [
            "whop products list — List Products",
            "",
            "Options:",
            "  --account_id <string>   The account.",
            "  --direction <asc|desc>  Sort direction.",
            "  --first <number>        Page size. (default: 20)",
            "",
            "Global Options:",
            "  --format <toon|json>    Output format",
          ].join("\n"),
        )
      : [],
  ids: () => ["prod_DQf7IZAtveRoK", "prod_iQ2Zub6GFQS5Q"],
};

test("complete: groups, verbs, flags, enum values, ids", async () => {
  const g = await complete("prod", 4, catalog);
  assert.deepEqual(g.candidates.map((c) => c.name), ["products"]);
  assert.equal(g.replace?.text, "products ");

  const v = await complete("products l", 10, catalog);
  assert.deepEqual(v.candidates.map((c) => c.name), ["list"]);

  const p = await complete("products p", 10, catalog);
  assert.deepEqual(p.candidates.map((c) => c.name).sort(), ["publish"]);

  const many = await complete("products ", 9, catalog);
  assert.ok(many.candidates.length >= 7);
  assert.equal(many.replace, undefined);

  const f = await complete("products list --", 16, catalog);
  assert.deepEqual(f.candidates.map((c) => c.name), ["--account_id", "--direction", "--first"]);
  assert.equal(f.replace, undefined, "common prefix is the token itself");

  const used = await complete("products list --first 5 --", 26, catalog);
  assert.deepEqual(used.candidates.map((c) => c.name), ["--account_id", "--direction"]);

  const e = await complete("products list --direction ", 26, catalog);
  assert.deepEqual(e.candidates.map((c) => c.name), ["asc", "desc"]);

  const id = await complete("products get prod_D", 19, catalog);
  assert.equal(id.replace?.text, "prod_DQf7IZAtveRoK ");

  const builtin = await complete("ho", 2, catalog);
  assert.deepEqual(builtin.candidates.map((c) => c.name), ["home"]);
});

test("complete: common prefix is filled in", async () => {
  const c = await complete("products list --account_id biz_x --", 35, catalog);
  assert.deepEqual(c.candidates.map((x) => x.name), ["--direction", "--first"]);
  const s = replaceSpan(emptyEditor(), 0, 0, "x");
  assert.equal(s.text, "x");
});

test("parseOptions skips global options and reads arguments", () => {
  const opts = parseOptions(["Options:", "  --amount <number>        The amount. (required)", "  --platform_covers_fees   Whether.", "", "Global Options:", "  --format <toon|json>  Output format"].join("\n"));
  assert.deepEqual(
    opts.map((o) => [o.flag, o.arg, o.required]),
    [
      ["--amount", "<number>", true],
      ["--platform_covers_fees", undefined, false],
    ],
  );
});
