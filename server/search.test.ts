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

const { searchNbsCatalog, nbsCatalogStats } = await import("./nbs-catalog.ts");

test("the catalog loads and counts", async () => {
  const stats = await nbsCatalogStats();
  expect(stats.seriesCount).toBeGreaterThan(15000);
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
