/**
 * Network-free tests for the store and the esData parser — the two places
 * where the data traps live. The database path is set before the module is
 * imported so each run gets a fresh file.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH = join(mkdtempSync(join(tmpdir(), "china-store-")), "test.db");
process.env.CHINA_SEED = "off"; // start from an empty store, not the seed

const { writeSeries, readSeries, readRevisions, listStoredSeries, seriesFreshness } = await import("./db.ts");
const { parseEsDataPoints } = await import("./nbs-catalog.ts");

const NATIONAL = "000000000000";
const GUANGDONG = "440000000000";

function result(key: string, label: string, points: { date: string; value: number }[]) {
  return {
    key, title: "Test series", agency: "National Bureau of Statistics", sourceUrl: "",
    frequency: "Monthly", unit: "%", series: [{ label, points }],
  };
}

test("regions of one key are stored and read back separately", () => {
  const first = writeSeries(result("nbs_t", "全国", [
    { date: "2024-01", value: 1 }, { date: "2024-02", value: 2 },
  ]), NATIONAL, "2026-01-01T00:00:00.000Z");
  const second = writeSeries(result("nbs_t", "广东省", [{ date: "2024-01", value: 10 }]),
    GUANGDONG, "2026-01-01T00:00:00.000Z");
  expect(first.changed).toBe(2);
  expect(second.changed).toBe(1);

  const guangdong = readSeries("nbs_t", 600, GUANGDONG);
  expect(guangdong?.series).toHaveLength(1);
  expect(guangdong?.series[0]?.label).toBe("广东省");
  expect(guangdong?.series[0]?.points).toEqual([{ date: "2024-01", value: 10 }]);

  // No region filter still returns every region, which is what the curated
  // path relies on.
  expect(readSeries("nbs_t", 600)?.series).toHaveLength(2);
  expect(listStoredSeries("nbs_")).toEqual([
    { key: "nbs_t", region: NATIONAL }, { key: "nbs_t", region: GUANGDONG },
  ]);
  expect(seriesFreshness("nbs_t", GUANGDONG)).toBe("2026-01-01T00:00:00.000Z");
});

test("a revised value becomes a second row and an unchanged one writes nothing", () => {
  const revised = writeSeries(result("nbs_t", "全国", [
    { date: "2024-01", value: 1 }, { date: "2024-02", value: 2.5 },
  ]), NATIONAL, "2026-02-01T00:00:00.000Z");
  expect(revised.points).toBe(2);
  expect(revised.changed).toBe(1);

  const trail = readRevisions("nbs_t", "全国", "2024-02", NATIONAL);
  expect(trail.map((row) => row.value)).toEqual([2, 2.5]);
  expect(readSeries("nbs_t", 600, NATIONAL)?.series[0]?.points).toEqual([
    { date: "2024-01", value: 1 }, { date: "2024-02", value: 2.5 },
  ]);

  const repeat = writeSeries(result("nbs_t", "全国", [
    { date: "2024-01", value: 1 }, { date: "2024-02", value: 2.5 },
  ]), NATIONAL, "2026-03-01T00:00:00.000Z");
  expect(repeat.changed).toBe(0);
});

test("esData parser skips blank cells and other regions, and labels quarters", () => {
  const raw = {
    data: [
      { code: "202601MM", values: [{ _id: "X", da: NATIONAL, value: "5.2" }] },
      { code: "202602MM", values: [{ _id: "X", da: NATIONAL, value: "" }] },
      { code: "202603MM", values: [{ _id: "X", da: GUANGDONG, value: "9.9" }] },
      { code: "202604MM", values: [{ _id: "Y", da: NATIONAL, value: "7.7" }] },
      { code: "202602SS", values: [{ _id: "X", da: NATIONAL, value: "104.5" }] },
    ],
  };
  expect(parseEsDataPoints(raw, "X", NATIONAL)).toEqual([
    { date: "2026-01", value: 5.2 },
    { date: "2026-Q2", value: 104.5 },
  ]);
  // A province asked of a national section comes back as a grid of blanks:
  // that must parse to nothing, so the caller can treat it as a failure.
  expect(parseEsDataPoints(raw, "X", "310000000000")).toEqual([]);
});
