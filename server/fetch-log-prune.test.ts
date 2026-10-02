/**
 * The fetch log is pruned, but never of an answer a reader still needs: the
 * newest row of each (key, region, status) stays whatever its age, rows
 * inside their kind's window stay, and successes that changed values stay as
 * the record of when a revision arrived.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-prune-")), "test.db");
process.env.CHINA_SEED = "off";
const { db, logFetch, pruneFetchLog } = await import("./db.ts");

const now = Date.parse("2026-10-02T00:00:00.000Z");
const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString();
const log = (key: string, region: string, status: "ok" | "error" | "empty", days: number, changed = 0) =>
  logFetch({ key, region, startedAt: daysAgo(days), finishedAt: daysAgo(days), status, points: 0, changed, message: `${status} ${days}` });
/** One full sweep from the first id, in small slices, as the scheduler runs it. */
const sweep = () => {
  let cursor = 0, removed = 0;
  for (;;) { const slice = pruneFetchLog(cursor, 3, now); removed += slice.removed; cursor = slice.nextId; if (slice.wrapped) return removed; }
};
const remaining = (key: string) => db()
  .query<{ region: string; status: string; message: string }, { $key: string }>("SELECT region, status, message FROM fetch_log WHERE key = $key ORDER BY id")
  .all({ $key: key }).map((row) => `${row.region}:${row.message}`);

test("superseded rows past their window go; the newest of each kind and anything inside its window stay", () => {
  // Empty answers: 14 days. The crawl re-asks the same empty target daily.
  log("prune_empty", "beijing", "empty", 40);
  log("prune_empty", "beijing", "empty", 20);
  log("prune_empty", "beijing", "empty", 10);
  log("prune_empty", "shanghai", "empty", 40); // newest for its place: kept
  // Successes: 31 days, and only those that changed nothing.
  log("prune_ok", "", "ok", 60);
  log("prune_ok", "", "ok", 50, 3); // carried a revision: kept
  log("prune_ok", "", "ok", 20);
  log("prune_ok", "", "ok", 1);
  // Errors: 45 days. An old error is the newest of its status, so it stays.
  log("prune_error", "", "error", 90);
  log("prune_error", "", "error", 50);
  log("prune_error", "", "error", 30);
  log("prune_lone", "", "error", 200);

  expect(sweep()).toBe(5);
  expect(remaining("prune_empty")).toEqual(["beijing:empty 10", "shanghai:empty 40"]);
  expect(remaining("prune_ok")).toEqual([":ok 50", ":ok 20", ":ok 1"]);
  expect(remaining("prune_error")).toEqual([":error 30"]);
  expect(remaining("prune_lone")).toEqual([":error 200"]);
  // A second sweep finds nothing more.
  expect(sweep()).toBe(0);
});

test("a slice looks only at its own ids, and the cursor wraps to the first row after the last", () => {
  const firstId = db().query<{ id: number }, []>("SELECT MAX(id) + 1 AS id FROM fetch_log").get()?.id ?? 1;
  for (let day = 100; day > 20; day -= 1) log("prune_slice", "", "empty", day);
  // The first ten of the eighty are all superseded and past the window.
  expect(pruneFetchLog(firstId, 10, now)).toEqual({ removed: 10, nextId: firstId + 10, wrapped: false });
  const rest = pruneFetchLog(firstId + 10, 1_000, now);
  expect(rest.removed).toBe(80 - 10 - 1); // all but the newest
  expect(rest.wrapped).toBe(true);
  expect(rest.nextId).toBe(db().query<{ id: number }, []>("SELECT MIN(id) AS id FROM fetch_log").get()?.id ?? -1);
});
