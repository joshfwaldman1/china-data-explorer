import { test, expect } from "bun:test";
import { splitTitle, glossTitle, segmentGloss, toPinyin, baseConcepts, normalizeIndexPrefix } from "./gloss.ts";

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
