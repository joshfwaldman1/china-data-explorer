/**
 * "Index minus 100" is a year-on-year change only for an index on a
 * year-earlier base. Asked of a level it subtracted 100 from deposits of
 * 3,476,700 亿元 and called 3,476,600 a percentage change ("Up 11,997.3 pp").
 * These hold the rule: such a request gets the real year-on-year change.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// nbs-catalog imports the store, so the store is pointed at a scratch path first.
const scratch = mkdtempSync(join(tmpdir(), "china-transform-"));
process.env.CHINA_DB_PATH ??= join(scratch, "store.db");
process.env.CHINA_CATALOG_DB_PATH ??= join(scratch, "catalog.db");
process.env.CHINA_SEED = "off";
const { resolveTransform, transformPoints, transformLabel, defaultNbsTransform } = await import("./nbs-catalog.ts");
const { isYearEarlierIndex } = await import("../shared/measure.ts");

test("only an index on a year-earlier base is read as index minus 100", () => {
  expect(isYearEarlierIndex("居民消费价格指数(上年同月=100)")).toBe(true);
  expect(isYearEarlierIndex("商品零售价格指数 (上年同期=100)")).toBe(true);
  expect(isYearEarlierIndex("居民消费价格指数 (上年=100)")).toBe(true);
  expect(isYearEarlierIndex("index, prior-year month = 100")).toBe(true);
  // The annual producer price indices' base, and the quarterly one.
  expect(isYearEarlierIndex("麻类生产价格指数 (上年价格=100)")).toBe(true);
  expect(isYearEarlierIndex("农产品生产价格指数 (上年同季=100)")).toBe(true);
  // The English glosses gloss.ts and data.ts write.
  expect(isYearEarlierIndex("Value-added of industry, Growth Rate (The same period last year=100)")).toBe(true);
  expect(isYearEarlierIndex("house prices, same month last year = 100")).toBe(true);
  // A level, an index on a fixed year or on the previous month, a neutral-100 diffusion index.
  expect(isYearEarlierIndex("Hundred million yuan (亿元) Deposits and Loans of Financial Institutions (RMB)")).toBe(false);
  expect(isYearEarlierIndex("Index, 2020 = 100")).toBe(false);
  expect(isYearEarlierIndex("居民消费价格指数(上月=100)")).toBe(false);
  expect(isYearEarlierIndex("Index (100 = neutral)")).toBe(false);
});

test("index minus 100 asked of a level series gives the level's real year-on-year change", () => {
  const describing = "Hundred million yuan (亿元) Deposits and Loans of Financial Institutions (RMB)";
  const transform = resolveTransform("index_growth", describing);
  expect(transform).toBe("yoy");
  expect(transformLabel(transform)).toBe("Percent change from year ago");
  const levels = [{ date: "2025-08", value: 3_300_000 }, { date: "2026-08", value: 3_476_700 }];
  const shown = transformPoints(levels, transform, "Monthly");
  // 3,476,700 on 3,300,000 is 5.355 percent, never 3,476,600.
  expect(shown).toEqual([{ date: "2026-08", value: 5.355 }]);
});

test("an annual producer price index on last year's prices is shown as index minus 100, by default and on request", () => {
  // nbs_0118a7ee34ce47c3aa70c278d48bd42c, 麻类生产价格指数 (上年价格=100), Liaoning: 110.1 reads as 10.1.
  const describing = "麻类生产价格指数 (上年价格=100)";
  expect(defaultNbsTransform({ name: describing, shortName: "" })).toBe("index_growth");
  expect(defaultNbsTransform({ name: "农产品生产价格指数 (上年同季=100)", shortName: "" })).toBe("index_growth");
  const transform = resolveTransform("index_growth", describing);
  expect(transform).toBe("index_growth");
  expect(transformPoints([{ date: "2023", value: 96.4 }, { date: "2024", value: 110.1 }], transform, "Annual")).toEqual([{ date: "2023", value: -3.6 }, { date: "2024", value: 10.1 }]);
});

test("a year-to-date series stays year to date in its transformed label", () => {
  expect(transformLabel("yoy", "Hundred million yuan (亿元), cumulative year to date")).toBe("Percent change from year ago, cumulative year to date");
  expect(transformLabel("index_growth", "上年同期=100 固定资产投资价格指数(累计)")).toBe("Percent change from year ago, cumulative year to date");
  expect(transformLabel("yoy", "Hundred million yuan (亿元)")).toBe("Percent change from year ago");
});

test("index minus 100 still applies to an index on a year-earlier base, and other transforms pass through", () => {
  expect(resolveTransform("index_growth", "居民消费价格指数(上年同月=100)")).toBe("index_growth");
  expect(transformPoints([{ date: "2026-08", value: 100.8 }], resolveTransform("index_growth", "上年同月=100"), "Monthly")).toEqual([{ date: "2026-08", value: 0.8 }]);
  for (const transform of ["raw", "change", "percent_change", "yoy"] as const) {
    expect(resolveTransform(transform, "Hundred million yuan (亿元)")).toBe(transform);
  }
});
