// The log tail's pure parts: keys, ordering, the poll argv, the line format, and the interval.
import { test } from "node:test";
import assert from "node:assert/strict";
import { clock, followIntervalMs, keyOf, logLines, newEntries, newest, pollArgv, requestPart, DEFAULT_FOLLOW_MS } from "../src/views/logs.ts";
import { ownFlags } from "../src/bin.ts";
import { strip } from "../src/ansi.ts";
import { theme, LOG_ROWS } from "./render.ts";

test("logs: entries are keyed by request, time, and message, and a page yields the unseen ones oldest first", () => {
  const seen = new Set<string>();
  const first = newEntries(seen, LOG_ROWS);
  assert.deepEqual(first.map((r) => clock(r.created_at)), ["09:00:01", "09:00:02", "09:00:02", "09:00:05"], "newest-first input comes out oldest first");
  assert.equal(newEntries(seen, LOG_ROWS).length, 0, "nothing new on a repeated page");
  const more = [...LOG_ROWS, { request_id: "req_5", created_at: "2026-09-18T09:00:09.000Z", level: "info", source: "console", message: "later" }];
  assert.deepEqual(newEntries(seen, more).map((r) => r.message), ["later"]);
  assert.equal(keyOf({ request_id: "a", created_at: "t", message: "m" }), "a|t|m");
  assert.deepEqual(newEntries(new Set(), LOG_ROWS, 2).map((r) => clock(r.created_at)), ["09:00:02", "09:00:05"], "the limit keeps the newest");
  assert.equal(newest(LOG_ROWS), "2026-09-18T09:00:05.000Z");
  assert.equal(newest([]), undefined);
});

test("logs: the poll argv drops --follow and windows on the newest line seen", () => {
  assert.deepEqual(pollArgv(["apps", "logs", "app_x", "--level", "error"]), ["apps", "logs", "app_x", "--level", "error"]);
  assert.deepEqual(pollArgv(["apps", "logs", "app_x", "--level", "error"], "2026-09-18T09:00:05.000Z"), ["apps", "logs", "app_x", "--level", "error", "--created_after", "2026-09-18T09:00:05.000Z"]);
  assert.deepEqual(pollArgv(["apps", "logs", "app_x", "--created_after", "old"], "new"), ["apps", "logs", "app_x", "--created_after", "new"]);
  assert.deepEqual(pollArgv(["apps", "logs", "app_x", "--created_after=old"], "new"), ["apps", "logs", "app_x", "--created_after", "new"]);
  const own = ownFlags(["apps", "logs", "app_x", "--follow", "--query", "slot"]);
  assert.equal(own.follow, true);
  assert.deepEqual(own.argv, ["apps", "logs", "app_x", "--query", "slot"], "--follow never reaches whop");
  assert.equal(ownFlags(["apps", "logs", "app_x", "-f"]).follow, true);
});

test("logs: a line is time, level, request, and the message, wrapped under a hanging indent", () => {
  const t = theme(60, false);
  const err = logLines(LOG_ROWS[2], t);
  assert.match(strip(err[0]), /^ 09:00:02  error  GET \/api\/slots 500 · TypeError: Cannot/);
  assert.ok(err.length > 1 && err[1].startsWith(" ".repeat(18)), "continuation lines hang under the message");
  assert.equal(requestPart(LOG_ROWS[3]), "", "console lines carry no request");
  assert.equal(strip(logLines(LOG_ROWS[3], t)[0]), " 09:00:01  info   booted");
  assert.match(strip(logLines(LOG_ROWS[0], t).join(" ")), /…$/, "a truncated message ends in an ellipsis");
  assert.equal(clock("nope"), "--:--:--");
  const colored = logLines(LOG_ROWS[2], theme(80, true));
  assert.ok(colored[0].includes("\x1b[31m"), "error is painted bad");
});

test("logs: the poll interval is three seconds unless WV_FOLLOW_MS says otherwise", () => {
  assert.equal(followIntervalMs({}), DEFAULT_FOLLOW_MS);
  assert.equal(followIntervalMs({ WV_FOLLOW_MS: "50" }), 50);
  assert.equal(followIntervalMs({ WV_FOLLOW_MS: "junk" }), DEFAULT_FOLLOW_MS);
});
