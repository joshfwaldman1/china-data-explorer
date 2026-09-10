/**
 * Ranking invariants over the real catalog snapshot. These are the queries
 * the design audit found broken; each one is a regression guard, not a
 * demonstration. They read catalog.db (or build it) and never call NBS.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratch = mkdtempSync(join(tmpdir(), "china-search-"));
process.env.CHINA_DB_PATH = join(scratch, "store.db");
process.env.CHINA_CATALOG_DB_PATH = join(scratch, "catalog.db");
process.env.NBS_QUERY_EXPANSION = "off"; // deterministic: no model calls
process.env.CHINA_SEED = "off";

const { searchNbsCatalog, nbsCatalogStats, stitchPoints, rawUnitOf, isCurrent, defaultNbsTransform, queryVariants, tableQualifiedTitle, normalizeQuery, februarySiblingName, fillFebruary } = await import("./nbs-catalog.ts");

test("the catalog loads and counts", async () => {
  const stats = await nbsCatalogStats();
  // 15,403 entries collapse to about 9,700 once year-range slices of one series count as one.
  expect(stats.seriesCount).toBeGreaterThan(9000);
  expect(stats.seriesCount).toBeLessThan(11000);
  expect(stats.datasets.map((dataset) => dataset.code)).toEqual([1, 2]);
}, 30000);

test("a specific concept outranks a long generic title on a two-character term", async () => {
  const result = await searchNbsCatalog({ query: "steel output", limit: 3 });
  expect(result.results[0]?.name.startsWith("粗钢产量")).toBe(true);
});

test("an English phrasing reaches the Chinese series through the alias dictionary", async () => {
  const result = await searchNbsCatalog({ query: "youth unemployment", limit: 5 });
  expect(result.results.some((entry) => entry.name.includes("16—24岁"))).toBe(true);
});

test("pinyin, spaced or not, finds the series", async () => {
  const spaced = await searchNbsCatalog({ query: "shi ye lv", limit: 3 });
  const joined = await searchNbsCatalog({ query: "shiyelv", limit: 3 });
  expect(spaced.results[0]?.name).toContain("失业率");
  expect(joined.results[0]?.name).toContain("失业率");
});

test("Latin terms match on word boundaries: house is not household", async () => {
  // The audit's case: the household-goods CPI glosses to "household …" and
  // used to rank first for "house prices" on a substring match.
  const byTitle = await searchNbsCatalog({ query: "生活用品及服务类居民消费价格指数", limit: 5 });
  const target = byTitle.results.find((entry) => entry.name.startsWith("生活用品及服务类居民消费价格指数"));
  expect(target).toBeDefined();
  const household = await searchNbsCatalog({ query: "household", limit: 200 });
  expect(household.results.some((entry) => entry.key === target?.key)).toBe(true);
  const house = await searchNbsCatalog({ query: "house", limit: 200 });
  expect(house.results.some((entry) => entry.key === target?.key)).toBe(false);
});

test("a pasted key finds exactly its series, without expansion", async () => {
  const result = await searchNbsCatalog({ query: "nbs_b704155cd926437b8ee9c65fe058210d", limit: 3 });
  expect(result.total).toBe(1);
  expect(result.results[0]?.key).toBe("nbs_b704155cd926437b8ee9c65fe058210d");
});

test("every entry carries an English gloss and pinyin", async () => {
  const result = await searchNbsCatalog({ query: "", limit: 100 });
  expect(result.results.every((entry) => (entry.nameEn ?? "").length > 0 && (entry.pinyin ?? "").length > 0)).toBe(true);
});

test("a plain output series outranks a ratio of it on a bare noun", async () => {
  const result = await searchNbsCatalog({ query: "steel", limit: 5 });
  const names = result.results.map((entry) => entry.nameEn ?? entry.name);
  const output = names.findIndex((name) => /crude steel output/i.test(name));
  const ratio = names.findIndex((name) => /ratio/i.test(name));
  expect(output).toBeGreaterThanOrEqual(0);
  if (ratio >= 0) expect(output).toBeLessThan(ratio);
});

test("year-range slices of one NBS table form a family and search shows only the newest", async () => {
  const result = await searchNbsCatalog({ query: "居民消费价格指数 (上月=100)", limit: 20 });
  const same = result.results.filter((entry) => entry.name === "居民消费价格指数 (上月=100)");
  expect(same.length).toBe(1);
  const head = same[0];
  expect(head?.family?.members.length).toBeGreaterThan(1);
  expect(head?.family?.head).toBe(head?.key ?? "");
});

test("slices carried by a parent category form a family too", async () => {
  // Industrial enterprise finance tables are split at the parent level:
  // "按行业分工业企业主要经济指标 (2003-2011)" > "工业企业资产总计" > the same series name in each.
  const result = await searchNbsCatalog({ query: "煤炭开采和洗选业资产总计上年同期", limit: 20 });
  const same = result.results.filter((entry) => entry.name.startsWith("煤炭开采和洗选业资产总计上年同期"));
  expect(same.length).toBe(1);
  expect(same[0]?.family?.members.length).toBe(4);
  expect(same[0]?.family?.span).toBe("2001 to present");
});

test("sub-industry PPI slices join across NBS's trailing-业 rename", async () => {
  // 2014-2017: 褐煤开采洗选业工业生产者出厂价格指数; 2018 on: 褐煤开采洗选工业生产者出厂价格指数.
  const result = await searchNbsCatalog({ query: "褐煤开采洗选工业生产者出厂价格指数", limit: 20 });
  const same = result.results.filter((entry) => entry.name.includes("褐煤开采洗选") && entry.name.includes("上年同月"));
  expect(same.length).toBe(1);
  expect(same[0]?.family?.span).toBe("2014 to present");
});

test("stitchPoints joins slices oldest to newest, newer winning on overlap", () => {
  const joined = stitchPoints([
    [{ date: "2015-11", value: 1 }, { date: "2015-12", value: 2 }],
    [{ date: "2015-12", value: 3 }, { date: "2016-01", value: 4 }],
  ]);
  expect(joined.map((point) => `${point.date}:${point.value}`)).toEqual(["2015-11:1", "2015-12:3", "2016-01:4"]);
});

test("an index table labelled 无 gets its base as the unit", () => {
  expect(rawUnitOf({ unit: "无", name: "居民消费价格指数 (上月=100)" })).toBe("Index, previous month = 100");
  expect(rawUnitOf({ unit: "无", name: "居民消费价格指数 (上年同月=100)" })).toBe("Index, same month a year earlier = 100");
  expect(rawUnitOf({ unit: "万吨", name: "粗钢产量当期值 (万吨)" })).toBe("万吨");
});

test("isCurrent: within two years of today publishes, older has stopped", () => {
  const now = new Date("2026-09-09T00:00:00Z");
  expect(isCurrent("2026-07", now)).toBe(true);
  expect(isCurrent("2024-12", now)).toBe(true);
  expect(isCurrent("2019-Q4", now)).toBe(false);
  expect(isCurrent(undefined, now)).toBe(false);
});

test("every year-on-year index base defaults to the index-minus-100 view; a previous-month base stays raw", () => {
  const entry = (name: string) => ({ name, shortName: name });
  expect(defaultNbsTransform(entry("服装类商品零售价格指数 (上年同月=100)"))).toBe("index_growth");
  expect(defaultNbsTransform(entry("服装类商品零售价格指数 (上年同期=100)"))).toBe("index_growth");
  expect(defaultNbsTransform(entry("居民消费价格指数 (上年=100)"))).toBe("index_growth");
  expect(defaultNbsTransform(entry("居民消费价格指数 (上月=100)"))).toBe("raw");
});

test("the country's names and English function words do not block a match", () => {
  const variants = queryVariants("exports to the united states");
  expect(variants).toContain("us");
  expect(variants).toContain("美国");
  expect(variants).not.toContain("to");
  expect(variants).not.toContain("the");
});

test("core inflation reaches the CPI excluding food and energy", async () => {
  const result = await searchNbsCatalog({ query: "core inflation", limit: 3 });
  expect(result.results[0]?.name.startsWith("不包括食品和能源居民消费价格指数")).toBe(true);
});

test("industry vocabulary: auto exports, semiconductor output and solar panels reach their NBS tables", async () => {
  const auto = await searchNbsCatalog({ query: "auto exports", limit: 3 });
  expect(auto.results[0]?.name.startsWith("汽车制造业出口交货值")).toBe(true);
  const chips = await searchNbsCatalog({ query: "semiconductor output", limit: 3 });
  expect(chips.results[0]?.name.startsWith("集成电路产量")).toBe(true);
  const solar = await searchNbsCatalog({ query: "solar panels", limit: 3 });
  expect(solar.results[0]?.name.startsWith("太阳能电池")).toBe(true);
});

test("PMI sub-indexes carry their table in the English title", async () => {
  expect(tableQualifiedTitle({ categories: ["采购经理指数", "制造业采购经理指数"], nameEn: "New orders index" })).toBe("Manufacturing PMI: new orders index");
  expect(tableQualifiedTitle({ categories: ["采购经理指数", "非制造业采购经理指数"], nameEn: "Employment index" })).toBe("Non-manufacturing PMI: employment index");
  expect(tableQualifiedTitle({ categories: ["采购经理指数", "制造业采购经理指数"], nameEn: "Manufacturing PMI" })).toBe("Manufacturing PMI");
  expect(tableQualifiedTitle({ categories: ["价格指数", "居民消费价格指数"], nameEn: "Consumer price index" })).toBe("Consumer price index");
  const result = await searchNbsCatalog({ query: "新订单指数", limit: 5 });
  const titles = result.results.filter((entry) => entry.name.startsWith("新订单指数")).map((entry) => entry.nameEn);
  expect(new Set(titles).size).toBe(titles.length);
});

test("a Chinese phrase matches by its two-character pieces when it appears nowhere whole", async () => {
  const pork = await searchNbsCatalog({ query: "猪肉价格", limit: 5 });
  expect(pork.results.length).toBeGreaterThan(0);
  expect(pork.results.every((entry) => entry.name.includes("猪肉"))).toBe(true);
  const fai = await searchNbsCatalog({ query: "固投", limit: 3 });
  expect(fai.results[0]?.name.startsWith("固定资产投资")).toBe(true);
});

test("a hyphen inside a phrase and a year-on-year suffix do not block a match", async () => {
  expect(normalizeQuery("Fixed-Asset  Investment")).toBe("fixed asset investment");
  expect(normalizeQuery("16-24")).toBe("16-24");
  const fai = await searchNbsCatalog({ query: "fixed-asset investment", limit: 3 });
  expect(fai.results[0]?.name.startsWith("固定资产投资")).toBe(true);
  const exports = await searchNbsCatalog({ query: "exports yoy", limit: 3 });
  expect(exports.results.length).toBeGreaterThan(0);
  expect(exports.results.every((entry) => entry.name.includes("出口") && entry.name.includes("同比"))).toBe(true);
});

test("a monthly level or growth series takes its combined February from the year-to-date sibling", () => {
  expect(februarySiblingName("柴油产量当期值 (万吨)")).toBe("柴油产量累计值 (万吨)");
  expect(februarySiblingName("柴油产量同比增长 (%)")).toBe("柴油产量累计增长 (%)");
  expect(februarySiblingName("柴油产量累计值 (万吨)")).toBeNull();
  const primary = [{ date: "2025-12", value: 1771 }, { date: "2026-03", value: 1650.5 }];
  const sibling = [{ date: "2025-12", value: 19959.4 }, { date: "2026-02", value: 3147 }, { date: "2026-03", value: 4799.9 }];
  const out = fillFebruary(primary, sibling);
  expect(out.filled).toBe(1);
  expect(out.points.map((p) => p.date)).toEqual(["2025-12", "2026-02", "2026-03"]);
  expect(fillFebruary(out.points, sibling).filled).toBe(0);
});
