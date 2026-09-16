/**
 * Walking Customs' archive a bounded step at a time, and knowing when the
 * archive has ended.
 */

import { test, expect } from "bun:test";
import { findTable, monthsToFetch, type ListingEntry } from "./customs.ts";

const now = new Date("2026-09-15T00:00:00Z");

test("a first view asks for the recent window only", () => {
  const months = monthsToFetch(240, null, now);
  expect(months.length).toBe(36);
  expect(months[0]).toBe("2026-08");
  expect(months[35]).toBe("2023-09");
});

test("an ingest that knows the store's oldest month adds a bounded older slice", () => {
  const months = monthsToFetch(240, "2023-09", now);
  expect(months.length).toBe(36 + 24);
  expect(months[36]).toBe("2023-08");
  expect(months[59]).toBe("2021-09");
  // The next run starts where this one ended, and never repeats the recent window.
  const next = monthsToFetch(240, "2021-09", now);
  expect(next[36]).toBe("2021-08");
  expect(new Set(next).size).toBe(next.length);
});

test("a small limit stays within the recent window", () => {
  expect(monthsToFetch(4, "2020-01", now)).toEqual(["2026-08", "2026-07", "2026-06", "2026-05"]);
});

function entry(month: string, table: ListingEntry["table"], href: string): ListingEntry {
  return { title: `${table} ${month}`, href, month, table, usd: true, currency: "USD" };
}

test("the listing walk finds a month on a later page and stops when the archive ends", async () => {
  const pages: ListingEntry[][] = [
    [entry("2026-08", "by-country", "a"), entry("2026-08", "major-exports", "b")],
    [entry("2026-07", "by-country", "c")],
    [entry("2026-06", "by-country", "d")],
    [entry("2026-06", "by-country", "d")], // the last page, served again past the end
  ];
  const reads: number[] = [];
  const read = async (page: number) => { reads.push(page); return pages[Math.min(page, pages.length) - 1] ?? []; };

  expect((await findTable("by-country", "2026-07", { pages: read} ))?.href).toBe("c");
  reads.length = 0;
  // A month older than the archive: the repeated last page ends the walk.
  expect(await findTable("by-country", "2021-01", { pages: read} )).toBeNull();
  expect(reads.length).toBeLessThanOrEqual(5);
  // A month the archive skips over: the walk stops once every entry is older.
  expect(await findTable("major-exports", "2026-07", { pages: read} )).toBeNull();
});
