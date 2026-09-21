// Date presets: what each resolves to on a pinned clock, that argv without one is untouched, and the
// events range Whop refuses. `render.ts` pins the clock to 2026-09-19T12:00:00Z.
import { test } from "node:test";
import assert from "node:assert/strict";
import { eventsRange, resolveDates, takesDates, windowFor, EVENTS_RANGE_MESSAGE } from "../src/dates.ts";
import "./render.ts";

test("dates: only stats get and events list take presets; everything else is untouched", () => {
  assert.equal(takesDates(["stats", "get", "net_revenue"]), "stats");
  assert.equal(takesDates(["events", "list"]), "events");
  assert.equal(takesDates(["memberships", "list", "--last", "5"]), null, "memberships list has its own --last, a page size");
  assert.deepEqual(resolveDates(["memberships", "list", "--last", "5"]).argv, ["memberships", "list", "--last", "5"]);
  assert.deepEqual(resolveDates(["stats", "get", "net_revenue", "--from", "2026-09-01", "--to", "2026-09-10"]).argv, ["stats", "get", "net_revenue", "--from", "2026-09-01", "--to", "2026-09-10"]);
});

test("dates: stats presets are whole UTC days, ending yesterday for --last Nd like home and gtm", () => {
  assert.deepEqual(resolveDates(["stats", "get", "net_revenue", "--last", "7d"]), { argv: ["stats", "get", "net_revenue", "--from", "2026-09-12", "--to", "2026-09-18"], preset: "last 7d" });
  assert.deepEqual(resolveDates(["stats", "get", "net_revenue", "--last=30d", "--interval", "day"]).argv, ["stats", "get", "net_revenue", "--interval", "day", "--from", "2026-08-20", "--to", "2026-09-18"]);
  assert.deepEqual(resolveDates(["stats", "get", "gross_revenue", "--this", "month"]).argv.slice(-4), ["--from", "2026-09-01", "--to", "2026-09-19"]);
  assert.deepEqual(resolveDates(["stats", "get", "gross_revenue", "--last", "month"]).argv.slice(-4), ["--from", "2026-08-01", "--to", "2026-08-31"]);
  assert.equal(resolveDates(["stats", "get", "gross_revenue", "--last", "month"]).preset, "last month");
  // Applying it twice changes nothing: the session and the one-shot path both resolve.
  const once = resolveDates(["stats", "get", "net_revenue", "--last", "90d"]).argv;
  assert.deepEqual(resolveDates(once).argv, once);
});

test("dates: events presets are timestamps, --last Nd rolls to now so 30d is exactly thirty days", () => {
  const r = resolveDates(["events", "list", "--last", "30d"]);
  assert.deepEqual(r.argv, ["events", "list", "--from", "2026-08-20T12:00:00Z", "--to", "2026-09-19T12:00:00Z"]);
  assert.equal(r.error, undefined);
  assert.deepEqual(resolveDates(["events", "list", "--last", "month"]).argv.slice(-4), ["--from", "2026-08-01T00:00:00Z", "--to", "2026-08-31T23:59:59Z"]);
  assert.deepEqual(resolveDates(["events", "list", "--this", "month"]).argv.slice(-4), ["--from", "2026-09-01T00:00:00Z", "--to", "2026-09-19T12:00:00Z"]);
});

test("dates: a range over thirty days on events list is refused before whop runs, in Whop's words", () => {
  const r = resolveDates(["events", "list", "--from", "2026-07-01T00:00:00Z", "--to", "2026-09-01T00:00:00Z"]);
  assert.equal(r.error?.code, "EVENTS_RANGE");
  assert.equal(r.error?.message, EVENTS_RANGE_MESSAGE);
  assert.match(r.error?.hint ?? "", /62 days from 2026-07-01T00:00:00Z to 2026-09-01T00:00:00Z/);
  assert.equal(resolveDates(["events", "list", "--last", "90d"]).error?.code, "EVENTS_RANGE");
  assert.equal(resolveDates(["events", "list", "--from", "2026-08-20", "--to", "2026-09-19"]).error, undefined, "thirty days exactly is allowed");
  assert.equal(resolveDates(["stats", "get", "net_revenue", "--last", "90d"]).error, undefined, "stats has no such limit");
  assert.deepEqual(eventsRange(["events", "list", "--from=2026-09-01", "--to=2026-09-11"]), { from: "2026-09-01", to: "2026-09-11", days: 10 });
  assert.equal(eventsRange(["events", "list", "--identifier", "prsn_x"]), null);
});

test("dates: a bad preset or a preset next to --from is refused with the list of presets", () => {
  const bad = resolveDates(["stats", "get", "net_revenue", "--last", "week"]);
  assert.equal(bad.error?.code, "BAD_PRESET");
  assert.match(bad.error?.message ?? "", /--last week is not a date preset/);
  assert.match(bad.error?.hint ?? "", /--this month/);
  assert.equal(resolveDates(["stats", "get", "net_revenue", "--last", "0d"]).error?.code, "BAD_PRESET");
  assert.equal(resolveDates(["stats", "get", "net_revenue", "--this", "week"]).error?.code, "BAD_PRESET");
  const both = resolveDates(["stats", "get", "net_revenue", "--last", "7d", "--from", "2026-09-01"]);
  assert.equal(both.error?.code, "BAD_PRESET");
  assert.match(both.error?.message ?? "", /not both/);
  assert.equal(windowFor("stats", "last", "x"), null);
});
