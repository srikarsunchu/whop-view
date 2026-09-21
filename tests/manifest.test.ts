// `wv agent`: the markers, the schema reading, and the payouts page from recorded schemas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { manifest, manifestIndex, markers, PREREQS, takesJson, typeOf, type VerbSchema } from "../src/views/manifest.ts";
import { parseHelp } from "../src/views/help.ts";
import { FIXTURES, fixture } from "./render.ts";

const schemaOf = (g: string, v: string) => JSON.parse(fixture(`schema.${g}.${v}.json`));

test("manifest: markers follow status.ts, and a money verb is also a write", () => {
  assert.deepEqual(markers("payouts", "create"), ["write", "money"]);
  assert.deepEqual(markers("payouts", "cancel"), ["write", "money", "destructive"]);
  assert.deepEqual(markers("payouts", "list"), ["read"]);
  assert.deepEqual(markers("payouts", "quotes"), ["read"]);
  assert.deepEqual(markers("products", "delete"), ["write", "destructive"]);
  assert.deepEqual(markers("products", "get"), ["read"]);
  assert.deepEqual(markers("ads", "create"), ["write"]);
});

test("manifest: types read through anyOf, and object or array flags switch the JSON spellings on", () => {
  assert.equal(typeOf({ type: "string" }), "string");
  assert.equal(typeOf({ anyOf: [{ type: "string" }, { type: "null" }] }), "string | null");
  assert.equal(typeOf({}), "unknown");
  assert.equal(takesJson(schemaOf("ads", "create")), true);
  assert.equal(takesJson(schemaOf("payouts", "list")), false);
  assert.equal(takesJson(null), false);
});

test("manifest: the payouts page from recorded schemas", () => {
  const help = parseHelp(fixture("help.payouts.txt"));
  const withSchema = new Set(["cancel", "create", "list", "methods"]);
  const verbs: VerbSchema[] = help.groups.flatMap((g) => g.entries).map((e) => ({ verb: e.name, desc: e.desc, schema: withSchema.has(e.name) ? schemaOf("payouts", e.name) : null }));
  const out = manifest({ group: "payouts", desc: "Send money from a balance to a bank or wallet.", verbs, version: "whop@0.18.2", api: "2026-09-15" }).join("\n") + "\n";
  assert.match(out, /^# wv agent payouts$/m);
  assert.match(out, /## Writes go through wv/, "a group with writes carries the protocol once");
  assert.match(out, /CONFIRMATION_REQUIRED/);
  assert.match(out, /`identity` \(identity\)/, "payouts depend on the identity check");
  assert.match(out, /\| `whop payouts cancel` \| write, money, destructive \|/);
  assert.match(out, /\| `--amount` \| number \| yes \|/);
  assert.match(out, /\| `--notes` \| string \| null \| no \|/, "nullable reads through anyOf");
  assert.match(out, /Arguments: <id> Payout ID/);
  assert.match(out, /No schema: `get` is a command group/, "a verb without a schema says so instead of an empty table");
  assert.equal(out.includes("\x1b["), false, "plain Markdown, no escapes");
  const file = join(FIXTURES, "..", "snapshots", "agent.payouts.md");
  if (process.env.UPDATE_SNAPSHOTS || !existsSync(file)) {
    writeFileSync(file, out);
    return;
  }
  assert.equal(out, readFileSync(file, "utf8"));
});

test("manifest: stats get carries the date presets, and the index lists every group under its section", () => {
  const out = manifest({ group: "stats", verbs: [{ verb: "get", desc: "Get Stats", schema: schemaOf("stats", "get") }] }).join("\n");
  assert.match(out, /--last 7d/);
  assert.match(out, /Arguments: <metric>/);
  const index = manifestIndex(parseHelp(fixture("help.txt")), "whop@0.18.2").join("\n");
  assert.match(index, /^## money$/m);
  assert.match(index, /^- `wv agent payouts` · Send money/m);
  assert.match(index, /## Writes go through wv/);
  for (const g of Object.keys(PREREQS)) assert.ok(index.includes(`wv agent ${g}\``), `${g} is a real group`);
});
