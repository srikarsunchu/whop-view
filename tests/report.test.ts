// `wv report`: the six numbers against last week, the next actions, and the Markdown face.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fmtChange, fmtValue, kpis, nextActions, rankSummary, reportData, reportMarkdown, total } from "../src/views/report.ts";
import { envelope, FIXTURES, REPORT, synth } from "./render.ts";

test("report: totals sum counts and money, average rates, and read an error as an error", () => {
  assert.equal(total(envelope("stats.net_revenue"), "currency").value, 18.56);
  assert.equal(total(envelope("stats.page_visits"), "count").value, 0, "no points is zero, not missing");
  assert.equal(total(synth({ data: { points: [{ timestamp: 1, value: 0.1 }, { timestamp: 2, value: 0.3 }] } }), "percent").value, 0.2);
  assert.match(total(envelope("error.gated"), "count").error ?? "", /HTTP_403/);
  const k = kpis([{ key: "net_revenue", unit: "currency", now: envelope("stats.net_revenue"), prev: synth({ data: { points: [{ timestamp: 1, value: 9.28 }] } }) }]);
  assert.equal(k[0].now, 18.56);
  assert.equal(k[0].prev, 9.28);
  assert.equal(k[0].change, 1);
  assert.equal(fmtChange(1), "+100%");
  assert.equal(fmtChange(-0.25), "-25%");
  assert.equal(fmtChange(undefined), "—");
  assert.equal(fmtValue(0.123, "percent"), "12.3%");
  assert.equal(fmtValue(1234.5, "currency"), "$1,234.50");
  assert.equal(kpis([{ key: "x", unit: "count", now: synth({ data: { points: [] } }), prev: synth({ data: { points: [] } }) }])[0].change, undefined, "no change against a zero week");
});

test("report: the brief as data carries kpis, blockers, money, store, campaigns, recommendations, and next actions", () => {
  const d = reportData(REPORT) as { ok: boolean; kpis: { key: string }[]; doctor: { ok: boolean; failing: unknown[] }; gaps: unknown[]; money: { payoutsBlocked: string | null }; store: { forSale: number; products: number }; campaigns: { title: string; verdicts: Record<string, number> }[]; next: { what: string; run: string[] }[] };
  assert.equal(d.kpis.length, 6);
  assert.equal(d.doctor.ok, false, "the recorded account blocks on identity");
  assert.equal(d.money.payoutsBlocked, "kyc_completed");
  assert.equal(d.store.forSale, 2);
  assert.equal(d.campaigns[0].title, "Launch · Hypermotion");
  assert.equal(d.campaigns[0].verdicts.pause, 1);
  assert.ok(d.next.some((n) => n.run.join(" ").startsWith("whop verifications create")), "the identity fix is a next action");
  assert.ok(d.next.some((n) => n.run.join(" ").includes("ad-groups pause")), "the losing group is a next action");
  assert.ok(d.next.some((n) => n.run.join(" ").includes("economic-intelligence update reca_x1 --status executed")), "a ready recommendation waits for a yes");
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(d)));
  const s = rankSummary(REPORT.ranks[0]);
  assert.equal(s.action?.verdict, "pause");
  assert.equal(nextActions(REPORT).length, d.next.length);
});

test("report: the Markdown face is the same facts, snapshotted", () => {
  const out = reportMarkdown(REPORT).join("\n") + "\n";
  assert.match(out, /^# Hypermotion · weekly brief$/m);
  assert.match(out, /\| net revenue \| \$18\.56 \| \$9\.28 \| \+100% \|/);
  assert.match(out, /## Next/);
  assert.equal(out.includes("\x1b["), false);
  const file = join(FIXTURES, "..", "snapshots", "report.md");
  if (process.env.UPDATE_SNAPSHOTS || !existsSync(file)) {
    writeFileSync(file, out);
    return;
  }
  assert.equal(out, readFileSync(file, "utf8"));
});
