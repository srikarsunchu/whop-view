// JSON flags for humans: the three spellings assemble to exactly what a hand-written JSON flag would be,
// a plain agent command is never touched, and the failure modes name the cause.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assembleJson, coerce, needsAssembly, setPath } from "../src/jsonflags.ts";

const HAND = '{"ad_campaign_id":"adcamp_x1","title":"US 25-44 · purchase","budget_amount":40,"budget_type":"daily","demographics":{"minimum_age":25,"maximum_age":44,"gender":"all"},"regions":{"include":{"countries":["US","CA"]}}}';

test("json flags: a plain agent command is never touched and never needs the schema", () => {
  const agent = ["ads", "create", "--title", "v1", "--ad_group", HAND, "--headlines", '["a","b"]'];
  assert.equal(needsAssembly(agent), false);
  assert.deepEqual(assembleJson(agent).argv, agent);
  assert.equal(needsAssembly(["products", "update", "prod_1", "--title", "Frame Pro"]), false);
  assert.equal(needsAssembly(["users", "get", "@sri"]), false, "an @handle is not a file");
});

test("json flags: dotted paths round-trip to the hand-written JSON flag", () => {
  const typed = [
    "ads", "create", "--title", "v1",
    "--ad_group.ad_campaign_id", "adcamp_x1",
    "--ad_group.title", "US 25-44 · purchase",
    "--ad_group.budget_amount", "40",
    "--ad_group.budget_type", "daily",
    "--ad_group.demographics.minimum_age", "25",
    "--ad_group.demographics.maximum_age", "44",
    "--ad_group.demographics.gender", "all",
    "--ad_group.regions.include.countries", "US",
    "--ad_group.regions.include.countries", "CA",
    "--url", "https://hypermotion.art/frame",
  ];
  const r = assembleJson(typed);
  assert.deepEqual(r.assembled, ["ad_group"]);
  assert.deepEqual(r.argv, ["ads", "create", "--title", "v1", "--ad_group", HAND, "--url", "https://hypermotion.art/frame"], "the assembled flag sits where it was first mentioned, as compact JSON");
  assert.deepEqual(JSON.parse(r.argv[5]), JSON.parse(HAND));
  assert.deepEqual(assembleJson(r.argv).argv, r.argv, "the result is an agent command: assembling again changes nothing");
});

test("json flags: a repeated flag is an array, an index is an array, and the schema wraps a lone array value", () => {
  assert.deepEqual(assembleJson(["ads", "create", "--headlines", "It is live", "--headlines", "Ship the cut"]).argv, ["ads", "create", "--headlines", '["It is live","Ship the cut"]']);
  assert.deepEqual(assembleJson(["ads", "create", "--creatives.0.id", "file_a", "--creatives.0.format", "vertical", "--creatives.1.id", "file_b"]).argv, ["ads", "create", "--creatives", '[{"id":"file_a","format":"vertical"},{"id":"file_b"}]']);
  const schema = { headlines: { type: "array" }, placements: { type: ["string", "array"] }, title: { type: "string" } };
  assert.deepEqual(assembleJson(["ads", "create", "--headlines", "It is live", "--ad_group.x", "1"], schema).argv, ["ads", "create", "--headlines", '["It is live"]', "--ad_group", '{"x":1}']);
  assert.deepEqual(assembleJson(["ad-groups", "create", "--placements", "automatic", "--regions.include.countries", "US"], schema).argv, ["ad-groups", "create", "--placements", "automatic", "--regions", '{"include":{"countries":"US"}}'], "string-or-array stays a string");
  assert.deepEqual(assembleJson(["ads", "create", "--headlines", "solo", "--ad_group.x", "1"]).argv[3], "solo", "without the schema a lone value is left alone");
});

test("json flags: @file embeds the file whole or at a path, and dotted paths merge into a JSON flag", () => {
  const dir = mkdtempSync(join(tmpdir(), "wv-json-"));
  const file = join(dir, "group.json");
  writeFileSync(file, HAND);
  const whole = assembleJson(["ads", "create", "--ad_group", `@${file}`]);
  assert.deepEqual(JSON.parse(whole.argv[3]), JSON.parse(HAND));
  const at = assembleJson(["ads", "create", "--ad_group.regions", `@${file}`, "--ad_group.title", "t"]);
  assert.deepEqual(JSON.parse(at.argv[3]), { regions: JSON.parse(HAND), title: "t" });
  const merged = assembleJson(["ads", "create", "--ad_group", '{"title":"old","budget_amount":40}', "--ad_group.title", "new"]);
  assert.deepEqual(JSON.parse(merged.argv[3]), { title: "new", budget_amount: 40 }, "the dotted path wins");
  const missing = assembleJson(["ads", "create", "--ad_group", "@/nonexistent/group.json"]);
  assert.equal(missing.error?.code, "JSON_FLAGS");
  assert.match(missing.error?.message ?? "", /no such file/);
  writeFileSync(join(dir, "bad.json"), "{oops");
  assert.match(assembleJson(["ads", "create", "--ad_group", `@${join(dir, "bad.json")}`]).error?.message ?? "", /is not JSON/);
});

test("json flags: values coerce, and a node cannot be both an array and an object", () => {
  assert.deepEqual([coerce("40"), coerce("4.5"), coerce("true"), coerce("null"), coerce("US"), coerce("02134")], [40, 4.5, true, null, "US", 2134]);
  assert.deepEqual(setPath(undefined, ["a", "b"], 1, false), { root: { a: { b: 1 } } });
  assert.deepEqual(setPath({ a: 1 }, ["a"], 2, true), { root: { a: [1, 2] } });
  assert.match(setPath({ a: { b: 1 } }, ["a", "0"], 2, false).error ?? "", /mixes/);
  const r = assembleJson(["ads", "create", "--x.a", "1", "--x.0", "2"]);
  assert.equal(r.error?.code, "JSON_FLAGS");
  assert.deepEqual(assembleJson(["ads", "create", "--x.flag", "--x.other", "1"]).argv, ["ads", "create", "--x", '{"flag":true,"other":1}'], "a bare dotted flag is true");
  assert.deepEqual(assembleJson(["ads", "create", "--x.a=1"]).argv, ["ads", "create", "--x", '{"a":1}'], "the = spelling works too");
});
