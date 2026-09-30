/**
 * The partner series' Februaries of 2022 to 2025 were misread from a table
 * with no month column. The store is append-only, so the correction is a
 * null revision written once at boot; these tests hold that it retracts
 * exactly those figures, keeps the trail, and does nothing a second time.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-retraction-")), "test.db");
process.env.CHINA_SEED = "off";
const { db, writeSeries, readSeries, readRevisionHistory, retractMisreadFebruaries, MISREAD_FEBRUARIES } = await import("./db.ts");

const partner = (key: string, region: string, points: { date: string; exports: number; imports: number }[]) => writeSeries({
  key, title: "Trade by partner", agency: "General Administration of Customs", unit: "Million USD", frequency: "Monthly", sourceUrl: "http://english.customs.gov.cn/",
  series: [
    { label: "Exports", points: points.map((p) => ({ date: p.date, value: p.exports })) },
    { label: "Imports", points: points.map((p) => ({ date: p.date, value: p.imports })) },
    { label: "Balance", points: points.map((p) => ({ date: p.date, value: Math.round((p.exports - p.imports) * 10) / 10 })) },
  ],
} as never, region, "2026-09-01T00:00:00.000Z");

test("the misread Februaries are retracted as null revisions and the months around them stand", () => {
  partner("trade_partners", "japan", [
    { date: "2024-12", exports: 12528.2, imports: 15920.7 },
    { date: "2025-02", exports: 21023.3, imports: 0.7 },
    { date: "2025-03", exports: 13910.6, imports: 13515 },
    { date: "2026-02", exports: 11786.1, imports: 12002.2 },
  ]);
  partner("major_exports", "ships", [{ date: "2025-02", exports: 3000, imports: 0 }]);
  expect(retractMisreadFebruaries(db(), new Date("2026-09-24T00:00:00.000Z"))).toBe(3);
  const stored = readSeries("trade_partners", 12, "japan");
  const at = (label: string, date: string) => stored?.series.find((line) => line.label === label)?.points.find((point) => point.date === date)?.value;
  // A retracted month is not served at all: no point, rather than a null every reader must guard.
  expect(at("Exports", "2025-02")).toBeUndefined();
  expect(at("Imports", "2025-02")).toBeUndefined();
  expect(at("Balance", "2025-02")).toBeUndefined();
  expect(at("Exports", "2024-12")).toBe(12528.2);
  expect(at("Exports", "2025-03")).toBe(13910.6);
  // 2026's release carries a February column and its figure is real.
  expect(at("Exports", "2026-02")).toBe(11786.1);
  // Another Customs series with a February point is not touched.
  expect(readSeries("major_exports", 12, "ships")?.series[0]?.points[0]?.value).toBe(3000);
});

test("the retraction keeps the trail and runs once", () => {
  const trail = readRevisionHistory("trade_partners", "japan").find((row) => row.label === "Exports" && row.period === "2025-02");
  expect(trail?.vintages.map((vintage) => vintage.value)).toEqual([21023.3, null]);
  expect(retractMisreadFebruaries(db())).toBe(0);
  expect(MISREAD_FEBRUARIES.periods).not.toContain("2026-02");
});

test("commodity quantity lines named for a misread number are removed outright; real lines stand", async () => {
  const { removeMisparsedQuantityLines } = await import("./db.ts");
  writeSeries({
    key: "major_exports", title: "Major exports", agency: "General Administration of Customs", unit: "Million USD", frequency: "Monthly", sourceUrl: "http://english.customs.gov.cn/",
    series: [
      { label: "Value", points: [{ date: "2025-03", value: 9590.9 }, { date: "2025-04", value: 215.8 }, { date: "2025-05", value: 11990.6 }] },
      { label: "Quantity (10,000 Autos)", points: [{ date: "2025-03", value: 56.8 }, { date: "2025-05", value: 69.5 }] },
      // April 2025's table had no unit column; the parser named the line for the number it found in the unit cell.
      { label: "Quantity (62.0)", points: [{ date: "2025-04", value: 11164.1 }] },
    ],
  } as never, "motor-vehicles-including-chassis-fitted-with-engines", "2026-09-01T00:00:00.000Z");
  expect(removeMisparsedQuantityLines(db())).toBe(1);
  const stored = readSeries("major_exports", 12, "motor-vehicles-including-chassis-fitted-with-engines");
  expect(stored?.series.map((line) => line.label)).toEqual(["Value", "Quantity (10,000 Autos)"]);
  // The value line's misread April is a real period; it stays for the next ingest to revise in place.
  expect(stored?.series[0]?.points.find((point) => point.date === "2025-04")?.value).toBe(215.8);
  expect(removeMisparsedQuantityLines(db())).toBe(0);
});

test("a period the source publishes no figure for is retracted as a null revision, once, and the trail keeps it", async () => {
  const { retractUnpublished } = await import("./db.ts");
  writeSeries({
    key: "major_exports", title: "Major exports", agency: "General Administration of Customs", unit: "Million USD", frequency: "Monthly", sourceUrl: "http://english.customs.gov.cn/",
    series: [
      { label: "Value", points: [{ date: "2025-02", value: 18654.8 }, { date: "2025-03", value: 9288.1 }] },
      { label: "Quantity (10,000 Sets)", points: [{ date: "2025-02", value: 10922.2 }, { date: "2025-03", value: 5000 }] },
    ],
  } as never, "mobile-phones", "2026-09-01T00:00:00.000Z");
  const unpublished = { labels: ["Value", "Quantity (10,000 Sets)"], periods: ["2025-02", "2024-02"] };
  // Two labels hold a February 2025 figure; nothing is stored for 2024, so nothing is written for it.
  expect(retractUnpublished("major_exports", "mobile-phones", unpublished, "2026-09-26T00:00:00.000Z")).toBe(2);
  const stored = readSeries("major_exports", 12, "mobile-phones");
  const at = (label: string, date: string) => stored?.series.find((line) => line.label === label)?.points.find((point) => point.date === date)?.value;
  expect(at("Value", "2025-02")).toBeUndefined();
  expect(at("Quantity (10,000 Sets)", "2025-02")).toBeUndefined();
  expect(at("Value", "2025-03")).toBe(9288.1);
  expect(readRevisionHistory("major_exports", "mobile-phones").find((row) => row.label === "Value" && row.period === "2025-02")?.vintages.map((vintage) => vintage.value)).toEqual([18654.8, null]);
  expect(retractUnpublished("major_exports", "mobile-phones", unpublished, "2026-09-27T00:00:00.000Z")).toBe(0);
});
