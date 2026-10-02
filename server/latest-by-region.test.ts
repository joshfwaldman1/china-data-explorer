/**
 * The scheduler's "what is the newest period we hold" questions are about a
 * few named series, and must be answered for those series alone: a read
 * across every stored place took the HTTP thread for each release attempt.
 * These hold the keyed reads to the same answers the summary gives.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-latest-")), "test.db");
process.env.CHINA_SEED = "off";
const { writeSeries, latestByRegion, latestPeriods } = await import("./db.ts");

const series = (key: string, points: { date: string; value: number }[]) => ({
  key, title: "Test", agency: "National Bureau of Statistics",
  sourceUrl: "https://data.stats.gov.cn/", frequency: "Monthly", unit: "Percent",
  series: [{ label: "Value", points }],
});

writeSeries(series("latest_test_a", [{ date: "2026-06", value: 1 }]), "beijing", "2026-09-01T00:00:00.000Z");
writeSeries(series("latest_test_a", [{ date: "2026-08", value: 2 }]), "shanghai", "2026-09-01T00:00:00.000Z");
writeSeries(series("latest_test_ab", [{ date: "2026-09", value: 3 }]), "", "2026-09-01T00:00:00.000Z");

test("each place of a named series reports its own newest period, and only the series named", () => {
  const rows = latestByRegion(["latest_test_a", "latest_test_a"]);
  expect(rows.map((row) => `${row.key}@${row.region}=${row.lastPeriod}`).sort())
    .toEqual(["latest_test_a@beijing=2026-06", "latest_test_a@shanghai=2026-08"]);
});

test("a series reports the newest period of whichever place reaches furthest, and nothing when none is stored", () => {
  const latest = latestPeriods(["latest_test_a", "latest_test_missing"]);
  expect(latest.get("latest_test_a")).toBe("2026-08");
  expect(latest.get("latest_test_missing")).toBeNull();
  expect(latestByRegion([])).toEqual([]);
});
