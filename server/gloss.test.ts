import { test, expect } from "bun:test";
import { splitTitle, glossTitle, segmentGloss, toPinyin, baseConcepts, normalizeIndexPrefix, warmGloss } from "./gloss.ts";

test("titles split into base, measure and unit", () => {
  expect(splitTitle("粗钢产量累计增长 (%)")).toEqual({ base: "粗钢产量", measure: "累计增长", unit: "%" });
  expect(splitTitle("国内生产总值 (不变价) 当季值 (亿元)")).toEqual({ base: "国内生产总值 (不变价)", measure: "当季值", unit: "亿元" });
  expect(splitTitle("居民消费价格指数 (上年同月=100)")).toEqual({ base: "居民消费价格指数", measure: "", unit: "上年同月=100" });
});

test("the gloss composes from the dictionary when no table entry exists", () => {
  expect(glossTitle("粗钢产量累计增长 (%)")).toBe("Crude steel output, year-to-date growth, %");
  expect(glossTitle("城镇调查失业率 (%)")).toBe("Surveyed urban unemployment rate");
  expect(segmentGloss("汽车产量")).toBe("automobiles output");
});

test("an enterprise indicator's 增减 (%) reads as the change from a year ago once the table is loaded", async () => {
  await warmGloss();
  // NBS's 增减 (%) on enterprise indicators is the change from the same month a year earlier.
  expect(glossTitle("其他采矿业负债合计增减 (%)")).toBe("Other mining: total liabilities, change from a year ago, %");
  expect(glossTitle("纺织服装、服饰业存货增减 (%)")).toBe("Inventories, textile, apparel and accessories, change from a year ago, %");
  expect(glossTitle("布产销率比上年同期增减 (%)")).toBe("Cloth output-sales ratio, change from same period last year");
});

test("the by-department PPI table names its industries, so the food industry is not a twin of the food category", async () => {
  await warmGloss();
  expect(glossTitle("食品工业生产者出厂价格指数 (上年同月=100)")).toBe("PPI: food industry, same month a year earlier = 100");
  expect(glossTitle("食品类工业生产者出厂价格指数 (上年同月=100)")).toBe("PPI: food, same month a year earlier = 100");
  expect(glossTitle("化学工业生产者出厂价格指数 (上年同月=100)")).toBe("PPI: chemical industry, same month a year earlier = 100");
});

test("pinyin and base concepts", () => {
  expect(toPinyin("失业率")).toBe("shi ye lv");
  expect(baseConcepts(["粗钢产量累计值 (万吨)", "粗钢产量累计增长 (%)", "钢材产量当期值 (万吨)"])).toEqual(["粗钢产量", "钢材产量"]);
});

test("an index title keeps its base period in English", () => {
  expect(glossTitle("居民消费价格指数 (上月=100)")).toMatch(/^Consumer prices? index, previous month = 100$/);
  expect(glossTitle("食品类工业生产者出厂价格指数 (上年同月=100)")).toMatch(/same month a year earlier = 100$/);
});

test("index components read with a colon whichever way the table wrote them", () => {
  expect(normalizeIndexPrefix("PPI, food")).toBe("PPI: food");
  expect(normalizeIndexPrefix("CPI, household articles and services")).toBe("CPI: household articles and services");
  expect(normalizeIndexPrefix("PPI: clothing")).toBe("PPI: clothing");
  expect(normalizeIndexPrefix("Producer price index, food")).toBe("Producer price index, food");
});
