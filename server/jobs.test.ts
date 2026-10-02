/**
 * Scheduled work outlives the process: a clock remembers the last run, and a
 * release job keeps its attempt and due time until it is settled.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-jobs-")), "test.db");
process.env.CHINA_SEED = "off";
const { scheduleJob, settleJob, getJob, pendingJobs, lastRun, recordRun, delayUntilDue, pruneSettledJobs, beginIngestProgress, markIngestKeyDone, finishIngestProgress } = await import("./jobs.ts");

const HOUR = 60 * 60 * 1000;

test("a recurring job that has never run waits only the minimum; one that ran recently waits out its period", () => {
  const now = Date.UTC(2026, 8, 27, 12);
  expect(delayUntilDue(null, 24 * HOUR, 2 * 60 * 1000, now)).toBe(2 * 60 * 1000);
  expect(delayUntilDue(now - 3 * HOUR, 24 * HOUR, 2 * 60 * 1000, now)).toBe(21 * HOUR);
  // Overdue: the minimum, not a negative wait.
  expect(delayUntilDue(now - 30 * HOUR, 24 * HOUR, 2 * 60 * 1000, now)).toBe(2 * 60 * 1000);
});

test("a clock's last run is read back as written, and a later run replaces it", () => {
  expect(lastRun("test-ingest")).toBeNull();
  recordRun("test-ingest", 1_000);
  expect(lastRun("test-ingest")).toBe(1_000);
  recordRun("test-ingest", 2_000);
  expect(lastRun("test-ingest")).toBe(2_000);
  // A clock is not a pending job.
  expect(pendingJobs("clock").map((job) => job.id)).not.toContain("clock:test-ingest");
});

test("a release job keeps its payload, attempt and due time until it is settled, then drops out of the pending list", () => {
  const item = { _id: "agenda-42", content: "8月份国民经济运行情况", keys: ["retail_sales"], categories: ["批发和零售业"] };
  scheduleJob({ id: "release:agenda-42", kind: "release", payload: item, attempt: 1, nextAt: 5_000 });
  scheduleJob({ id: "release:agenda-43", kind: "release", payload: { ...item, _id: "agenda-43" }, attempt: 1, nextAt: 3_000 });
  expect(pendingJobs("release").map((job) => job.id)).toEqual(["release:agenda-43", "release:agenda-42"]);

  scheduleJob({ id: "release:agenda-42", kind: "release", payload: item, attempt: 4, nextAt: 9_000 });
  const retried = getJob<typeof item>("release:agenda-42")!;
  expect(retried).toMatchObject({ attempt: 4, nextAt: 9_000, state: "pending" });
  expect(retried.payload).toEqual(item);

  settleJob("release:agenda-42", "done");
  settleJob("release:agenda-43", "abandoned");
  expect(pendingJobs("release")).toHaveLength(0);
  expect(getJob("release:agenda-43")?.state).toBe("abandoned");
});

test("pruning removes settled jobs past the cut-off and never a pending one", () => {
  scheduleJob({ id: "release:still-waiting", kind: "release", payload: {}, attempt: 2, nextAt: 1 });
  // A minute from now, everything the earlier tests settled is past a zero-day cut-off.
  pruneSettledJobs(0, Date.now() + 60_000);
  expect(getJob("release:still-waiting")?.state).toBe("pending");
  expect(getJob("release:agenda-42")).toBeNull();
});

test("an ingest cut off mid-run resumes with the keys it finished; a finished or stale run starts afresh", () => {
  const start = Date.UTC(2026, 9, 2, 6);
  const first = beginIngestProgress(24 * HOUR, start);
  expect(first).toEqual({ startedAt: start, done: [] });
  markIngestKeyDone(first, "gdp");
  markIngestKeyDone(first, "cpi");
  markIngestKeyDone(first, "cpi");
  // A deploy: the next process reads the progress back from the store.
  expect(beginIngestProgress(24 * HOUR, start + HOUR)).toEqual({ startedAt: start, done: ["gdp", "cpi"] });
  // A day later the cut-off run belongs to an earlier cycle.
  expect(beginIngestProgress(24 * HOUR, start + 25 * HOUR)).toEqual({ startedAt: start + 25 * HOUR, done: [] });
  // Finished: the next run begins at the first key.
  const second = beginIngestProgress(24 * HOUR, start + 26 * HOUR);
  markIngestKeyDone(second, "gdp");
  finishIngestProgress();
  expect(beginIngestProgress(24 * HOUR, start + 27 * HOUR)).toEqual({ startedAt: start + 27 * HOUR, done: [] });
});
