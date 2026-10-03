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

const firstOwnId = (db().query<{ id: number | null }, []>("SELECT MAX(id) AS id FROM fetch_log").get()?.id ?? 0) + 1;
const now = Date.parse("2026-10-02T00:00:00.000Z");
const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString();
const log = (key: string, region: string, status: "ok" | "error" | "empty", days: number, changed = 0) =>
  logFetch({ key, region, startedAt: daysAgo(days), finishedAt: daysAgo(days), status, points: 0, changed, message: `${status} ${days}` });
/** One full sweep from the first id, in small slices, as the scheduler runs it. */
const sweep = () => {
  // From this file's first row: other test files share the store, and their rows are young.
  let cursor = firstOwnId, removed = 0;
  for (;;) { const slice = pruneFetchLog(cursor, 3, now); removed += slice.removed; cursor = slice.nextId; if (slice.wrapped) return removed; }
};
const remaining = (key: string) => db()
  .query<{ region: string; status: string; message: string }, { $key: string }>("SELECT region, status, message FROM fetch_log WHERE key = $key ORDER BY id")
  .all({ $key: key }).map((row) => `${row.region}:${row.message}`);

test("superseded rows past their window go; the newest of each kind and anything inside its window stay", () => {
  // Rows are written as fetches finish, so ids rise with time; written oldest first here too.
  // Empty answers: 14 days. Successes: 31, only those that changed nothing. Errors: 45.
  log("prune_lone", "", "error", 200); // the only error of its key: kept
  log("prune_error", "", "error", 90);
  log("prune_ok", "", "ok", 60);
  log("prune_ok", "", "ok", 50, 3); // carried a revision: kept
  log("prune_error", "", "error", 50);
  log("prune_empty", "beijing", "empty", 40);
  log("prune_empty", "shanghai", "empty", 40); // newest for its place: kept
  log("prune_error", "", "error", 30);
  log("prune_empty", "beijing", "empty", 20);
  log("prune_ok", "", "ok", 20);
  log("prune_empty", "beijing", "empty", 10);
  log("prune_ok", "", "ok", 1);

  expect(sweep()).toBe(5);
  expect(remaining("prune_empty")).toEqual(["shanghai:empty 40", "beijing:empty 10"]);
  expect(remaining("prune_ok")).toEqual([":ok 50", ":ok 20", ":ok 1"]);
  expect(remaining("prune_error")).toEqual([":error 30"]);
  expect(remaining("prune_lone")).toEqual([":error 200"]);
  // A second sweep finds nothing more.
  expect(sweep()).toBe(0);
});

test("a slice looks only at its own ids, and a sweep runs to the last id even past young rows", () => {
  const firstId = db().query<{ id: number }, []>("SELECT MAX(id) + 1 AS id FROM fetch_log").get()?.id ?? 1;
  for (let day = 100; day > 80; day -= 1) log("prune_slice", "", "empty", day);
  for (let day = 0; day < 10; day += 1) log("prune_young", "", "empty", 1); // a young stretch mid-log
  for (let day = 80; day > 20; day -= 1) log("prune_slice", "", "empty", day); // older rows after it, as in production
  // The first ten of the old rows are superseded and past the window.
  expect(pruneFetchLog(firstId, 10, now)).toEqual({ removed: 10, nextId: firstId + 10, wrapped: false });
  let cursor = firstId + 10, removed = 0;
  for (;;) { const slice = pruneFetchLog(cursor, 10, now); removed += slice.removed; cursor = slice.nextId; if (slice.wrapped) break; }
  expect(removed).toBe(80 - 10 - 1); // every old row but the newest, the ones after the young stretch too
  expect(cursor).toBe(db().query<{ id: number }, []>("SELECT MIN(id) AS id FROM fetch_log").get()?.id ?? -1);
});

test("one young row logged out of order does not end the sweep", () => {
  const start = (db().query<{ id: number | null }, []>("SELECT MAX(id) AS id FROM fetch_log").get()?.id ?? 0) + 1;
  log("prune_stray", "", "empty", 2); // young, but first
  for (let day = 60; day > 40; day -= 1) log("prune_stray", "", "empty", day);
  log("prune_stray", "", "empty", 1);
  let cursor = start, removed = 0;
  for (;;) { const slice = pruneFetchLog(cursor, 5, now); removed += slice.removed; cursor = slice.nextId; if (slice.wrapped) break; }
  expect(removed).toBe(20);
});
