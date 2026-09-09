import { expect, test } from "bun:test";
import { describeRelease } from "./releases";

test("the national economy bundle refreshes GDP only in the months that announce a quarter", () => {
  const monthly = describeRelease("国民经济运行情况(10:00)", "2026-09-15 10:00:00");
  expect(monthly?.keys).toEqual(["industrial_production", "retail_sales", "unemployment"]);
  expect(monthly?.en).toContain("monthly bundle");
  const quarterly = describeRelease("国民经济运行情况(10:00)", "2026-10-19 10:00:00");
  expect(quarterly?.keys).toEqual(["gdp", "industrial_production", "retail_sales", "unemployment"]);
  expect(quarterly?.en).toContain("GDP");
});

test("titles match on their stem without the time suffix", () => {
  expect(describeRelease("居民消费价格指数月度报告(09:30)")?.keys).toEqual(["cpi"]);
  expect(describeRelease("规模以上文化及相关产业生产经营季度报告(09:30)")).toBeNull();
});
