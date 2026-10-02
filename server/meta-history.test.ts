/**
 * A series' unit, title, frequency and agency are overwritten in place at each
 * write; a change to one is kept as a row, so a publisher switching 万 for 亿 or
 * renaming a table leaves a trail. An unchanged write leaves none.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-meta-")), "test.db");
process.env.CHINA_SEED = "off";
const { writeSeries, recentMetaChanges } = await import("./db.ts");

const result = (unit: string, title = "Steel output", sourceUrl = "https://example.gov.cn/1") => ({
  key: "meta_history_test", title, agency: "National Bureau of Statistics",
  sourceUrl, frequency: "Monthly", unit,
  series: [{ label: "全国", points: [{ date: "2026-08", value: 1 }] }],
});
const mine = () => recentMetaChanges(100).filter((row) => row.key === "meta_history_test");

test("a first write and an unchanged one leave no trail; a moved source URL is not a change", () => {
  writeSeries(result("万吨"), "", "2026-09-01T00:00:00.000Z");
  writeSeries(result("万吨", "Steel output", "https://example.gov.cn/2"), "", "2026-09-02T00:00:00.000Z");
  expect(mine()).toEqual([]);
});

test("a changed unit and title are each kept, with what they were", () => {
  writeSeries(result("亿吨", "Crude steel output"), "", "2026-09-03T00:00:00.000Z");
  expect(mine().map(({ field, oldValue, newValue, changedAt }) => ({ field, oldValue, newValue, changedAt })).sort((a, b) => a.field.localeCompare(b.field))).toEqual([
    { field: "title", oldValue: "Steel output", newValue: "Crude steel output", changedAt: "2026-09-03T00:00:00.000Z" },
    { field: "unit", oldValue: "万吨", newValue: "亿吨", changedAt: "2026-09-03T00:00:00.000Z" },
  ]);
  writeSeries(result("亿吨", "Crude steel output"), "", "2026-09-04T00:00:00.000Z");
  expect(mine()).toHaveLength(2);
});
