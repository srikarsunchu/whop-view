// Snapshot every scene at 80 and 120 columns, with color and without.
// UPDATE_SNAPSHOTS=1 pnpm test rewrites them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCENES, theme } from "./render.ts";
import { strip, width } from "../src/ansi.ts";

const dir = join(import.meta.dirname, "snapshots");
mkdirSync(dir, { recursive: true });
const update = !!process.env.UPDATE_SNAPSHOTS;

for (const [name, scene] of Object.entries(SCENES)) {
  for (const w of [80, 120]) {
    for (const color of [false, true]) {
      const file = join(dir, `${name}.${w}.${color ? "color" : "plain"}.txt`);
      test(`${name} @ ${w} ${color ? "color" : "plain"}`, () => {
        const out = scene(theme(w, color)).join("\n") + "\n";
        // Nothing may exceed the width, and plain mode must contain no escapes.
        for (const line of out.split("\n")) assert.ok(width(line) <= w, `line exceeds ${w}: ${JSON.stringify(strip(line))}`);
        if (!color) assert.equal(out.includes("\x1b["), false, "plain output contains escapes");
        if (update || !existsSync(file)) {
          writeFileSync(file, out);
          return;
        }
        assert.equal(out, readFileSync(file, "utf8"));
      });
    }
  }
}

test("color and plain differ only by escapes", () => {
  for (const [, scene] of Object.entries(SCENES)) {
    const plain = scene(theme(80, false)).join("\n");
    const color = strip(scene(theme(80, true)).join("\n"));
    assert.equal(color, plain);
  }
});
