/**
 * The sweeps that keep the test suite's scratch stores from filling a disk.
 *
 * Each run writes a store and a catalog cache under the temp directory, a few
 * hundred megabytes, and used to delete them only on exit. An exit handler
 * does not run when a process is killed, so every interrupted run left its
 * store behind with nothing to claim it. They accumulated until the disk was
 * full, twice in one day, and both times work stopped until someone deleted
 * them by hand.
 */

import { test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, existsSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ABANDONED_AFTER_MS, sweepAbandoned, sweepOwn, sweepScratch } from "./test-scratch.ts";

/** A directory of the given age, holding a file, as a run would leave it. */
function scratchAged(base: string, name: string, ageMs: number): string {
  const path = join(base, name);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "china.db"), "x");
  const when = new Date(Date.now() - ageMs);
  utimesSync(path, when, when);
  return path;
}

const base = () => mkdtempSync(join(tmpdir(), "sweep-test-"));

test("a store abandoned by a run that never exited is reclaimed by the next one", () => {
  const dir = base();
  const old = scratchAged(dir, "china-test-run-killed", ABANDONED_AFTER_MS + 60_000);
  const removed = sweepAbandoned(dir, "china-");
  expect(removed).toEqual([old]);
  expect(existsSync(old)).toBe(false);
});

test("a store a run is still using is left alone", () => {
  const dir = base();
  const fresh = scratchAged(dir, "china-test-run-live", 60_000);
  expect(sweepAbandoned(dir, "china-")).toEqual([]);
  expect(existsSync(fresh)).toBe(true);
  // Even at the boundary: only strictly older than the threshold is nobody's.
  expect(sweepAbandoned(dir, "china-", Date.now(), ABANDONED_AFTER_MS * 10)).toEqual([]);
  expect(existsSync(fresh)).toBe(true);
});

test("the sweep touches only its own prefix", () => {
  const dir = base();
  const mine = scratchAged(dir, "china-test-run-old", ABANDONED_AFTER_MS * 2);
  const theirs = scratchAged(dir, "someone-elses-cache", ABANDONED_AFTER_MS * 2);
  sweepAbandoned(dir, "china-");
  expect(existsSync(mine)).toBe(false);
  // Another tool's temp directory is not ours to delete, however old it is.
  expect(existsSync(theirs)).toBe(true);
});

test("a finished run clears what it made, however new", () => {
  const dir = base();
  const startedAt = Date.now() - 5_000;
  const ours = scratchAged(dir, "china-test-run-ours", 1_000);
  const earlier = scratchAged(dir, "china-test-run-earlier", 60 * 60_000);
  const removed = sweepOwn(dir, "china-", startedAt);
  expect(removed).toEqual([ours]);
  expect(existsSync(ours)).toBe(false);
  // A concurrent run's store predates this one's start and is not ours to remove.
  expect(existsSync(earlier)).toBe(true);
});

test("a missing base directory is not an error, and neither is a file among the directories", () => {
  expect(sweepAbandoned(join(tmpdir(), "no-such-dir-here-12345"), "china-")).toEqual([]);
  const dir = base();
  writeFileSync(join(dir, "china-stray-file"), "x");
  // A stray file matching the prefix is removed like anything else rather than throwing.
  expect(() => sweepScratch(dir, "china-", () => true)).not.toThrow();
});
