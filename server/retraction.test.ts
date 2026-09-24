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
  expect(at("Exports", "2025-02")).toBeNull();
  expect(at("Imports", "2025-02")).toBeNull();
  expect(at("Balance", "2025-02")).toBeNull();
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
