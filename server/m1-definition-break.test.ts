/**
 * The bank widened M1 from January 2025 data, and its 2024 table keeps the
 * old definition. A 2025 level over a 2024 level read +62% for January 2025,
 * where the bank printed 0.4%. These tests hold that no rate is computed
 * across that break, that rates on one definition still are, and that the
 * figures already stored are retracted once with their trail kept.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-m1-break-")), "test.db");
process.env.CHINA_SEED = "off";
const { db, writeSeries, readSeries, readRevisionHistory, retractM1AcrossDefinitionBreak, M1_ACROSS_DEFINITION_BREAK } = await import("./db.ts");
const { moneyGrowth } = await import("./pboc.ts");

// January M1 levels in 亿元 as the bank's 货币供应量 tables print them: 2024 on
// the old definition (the bank's 2024 table), 2025 and 2026 on the new one
// (money-2025.htm, money-2026.htm).
const M1_LEVELS = new Map([["2024-01", 694197.88], ["2025-01", 1124457.45], ["2026-01", 1179680.52]]);

test("no M1 rate is computed across the January 2025 redefinition", () => {
  const growth = moneyGrowth("M1", M1_LEVELS);
  expect(growth.has("2025-01")).toBe(false);
});

test("an M1 rate with both years on the new definition is still computed, to the bank's 4.9", () => {
  expect(moneyGrowth("M1", M1_LEVELS).get("2026-01")).toBe(4.9);
});

test("the break is M1's alone: an M2 rate for January 2025 on a 2024 level is computed", () => {
  // Illustrative levels; M2's definition did not change.
  const growth = moneyGrowth("M2", new Map([["2024-01", 1000], ["2025-01", 1070]]));
  expect(growth.get("2025-01")).toBe(7);
});

test("the stored 2025 M1 rates are retracted, M2 and other years stand, and the trail is kept", () => {
  const months = M1_ACROSS_DEFINITION_BREAK.periods;
  writeSeries({
    key: "money_stock_growth", title: "Money Stock Growth", agency: "People's Bank of China", unit: "Percent", frequency: "Monthly", sourceUrl: "https://www.pbc.gov.cn/",
    series: [
      { label: "M1", points: [{ date: "2024-12", value: -1.4 }, ...months.map((date) => ({ date, value: 62 })), { date: "2026-01", value: 4.9 }] },
      { label: "M2", points: months.map((date) => ({ date, value: 7 })) },
    ],
  } as never, "", "2026-09-01T00:00:00.000Z");
  const before = db().query<{ observations: number }, []>("SELECT observations FROM store_stats WHERE id = 1").get()?.observations ?? 0;

  expect(retractM1AcrossDefinitionBreak(db(), new Date("2026-10-05T00:00:00.000Z"))).toBe(12);

  const stored = readSeries("money_stock_growth", 48);
  const line = (label: string) => new Map(stored?.series.find((item) => item.label === label)?.points.map((point) => [point.date, point.value]));
  for (const month of months) expect(line("M1").has(month)).toBe(false);
  expect(line("M1").get("2024-12")).toBe(-1.4);
  expect(line("M1").get("2026-01")).toBe(4.9);
  expect(line("M2").get("2025-06")).toBe(7);
  const trail = readRevisionHistory("money_stock_growth", "").find((row) => row.label === "M1" && row.period === "2025-01");
  expect(trail?.vintages.map((vintage) => vintage.value)).toEqual([62, null]);
  // The retraction rows are counted like any other.
  expect(db().query<{ observations: number }, []>("SELECT observations FROM store_stats WHERE id = 1").get()?.observations).toBe(before + 12);
});

test("the retraction does nothing a second time", () => {
  expect(retractM1AcrossDefinitionBreak(db())).toBe(0);
});
