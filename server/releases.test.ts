import { expect, test } from "bun:test";
import { agendaBound, describeRelease } from "./releases";

test("the national economy bundle refreshes GDP only in the months that announce a quarter", () => {
  const monthly = describeRelease("国民经济运行情况(10:00)", "2026-09-15 10:00:00");
  expect(monthly?.keys).toEqual(["industrial_production", "retail_sales", "unemployment"]);
  expect(monthly?.en).toContain("monthly bundle");
  const quarterly = describeRelease("国民经济运行情况(10:00)", "2026-10-19 10:00:00");
  expect(quarterly?.keys).toEqual(["gdp", "industrial_production", "retail_sales", "unemployment"]);
  expect(quarterly?.en).toContain("GDP");
});

test("titles match on their stem without the time suffix", () => {
  expect(describeRelease("居民消费价格指数月度报告(09:30)")?.keys).toEqual(["cpi", "cpi_detail"]);
  expect(describeRelease("不存在的报告(09:30)")).toBeNull();
});

test("the quarterly reports NBS lists beside the monthly ones have English names", () => {
  expect(describeRelease("季度主要行业增加值初步核算报告(09:30)")?.en).toContain("Value added by major industry");
  expect(describeRelease("全国工业产能利用率季度报告(10:00)")?.en).toContain("capacity utilisation");
  expect(describeRelease("规模以上文化及相关产业生产经营季度报告(09:30)")?.en).toContain("Culture and related industries");
});

test("a bare date for an agenda bound takes the start or end of its day; a value with a time is kept", () => {
  expect(agendaBound("2026-11-30", true)).toBe("2026-11-30 23:59:59");
  expect(agendaBound("2026/11/01", false)).toBe("2026/11/01 00:00:00");
  expect(agendaBound("2026/11/30 23:59:59", true)).toBe("2026/11/30 23:59:59");
});

test("a release refreshes the curated series drawn from its own tables, not only the headline", () => {
  // The release-day refresh fetches exactly these keys; a series left off waits for the daily ingest.
  expect(describeRelease("采购经理指数(09:30)")?.keys).toEqual(["pmi", "pmi_manufacturing", "pmi_nonmanufacturing"]);
  expect(describeRelease("工业生产者价格指数(09:30)")?.keys).toContain("ppi_detail");
  expect(describeRelease("70个大中城市商品住宅销售价格变动情况(09:30)")?.keys).toContain("house_prices_nbs");
  expect(describeRelease("居民收支情况(10:00)")?.keys).toContain("household_income");
  // These two releases mapped to no series at all, so their day refreshed nothing curated.
  expect(describeRelease("工业产能利用率(10:00)")?.keys).toEqual(["capacity_utilisation"]);
  expect(describeRelease("季度主要行业增加值初步核算结果(09:30)")?.keys).toEqual(["gdp_by_industry"]);
});
