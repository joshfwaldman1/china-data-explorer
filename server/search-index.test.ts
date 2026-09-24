/**
 * The candidate index only decides which entries the scorer looks at. These
 * tests hold the indexed ranking identical to the full scan's over a spread
 * of query shapes — Chinese of one, two and many characters, Latin words
 * singular and plural, pinyin, aliases, an id prefix, a place — and hold the
 * index to being faster.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-search-index-")), "test.db");
process.env.CHINA_SEED = "off";
process.env.NBS_QUERY_EXPANSION = "off"; // deterministic: no model calls, as in search.test.ts
const { searchNbsCatalog, setCandidateIndexEnabled } = await import("./nbs-catalog.ts");

const QUERIES = [
  "钢", "水泥", "居民消费价格", "猪肉价格", "城镇调查失业率", "汽车销量",
  "gdp", "cpi", "cpi food", "youth unemployment", "steel output", "exports to japan", "eggs", "egg", "soybeans",
  "shiyelv", "chengzhen diaocha", "population by province", "guangdong gdp", "fixed asset investment", "ppi",
  "nbs_1d550f3", "1d550f3ec77a", "2010=100", "u.s. dollar", "gdp增长", "价格 index", "16—24岁", "16-24岁失业率", "youth", "70个大中城市", "m2",
];

const keysFor = async (query: string) => (await searchNbsCatalog({ query, limit: 100 })).results.map((entry) => entry.key);

test("the indexed ranking is the scanned ranking, query for query", async () => {
  for (const query of QUERIES) {
    setCandidateIndexEnabled(false);
    const scanned = await keysFor(query);
    setCandidateIndexEnabled(true);
    const indexed = await keysFor(query);
    expect(indexed, query).toEqual(scanned);
  }
}, 600000);

test("the index makes a query at least three times faster than the scan", async () => {
  const timed = async () => {
    const startedAt = performance.now();
    for (const query of ["youth unemployment", "steel output", "居民消费价格", "cement", "猪肉价格"]) await keysFor(query);
    return performance.now() - startedAt;
  };
  setCandidateIndexEnabled(true); await timed(); // warm
  const indexed = await timed();
  setCandidateIndexEnabled(false); await timed();
  const scanned = await timed();
  setCandidateIndexEnabled(true);
  expect(indexed * 3, `indexed ${indexed.toFixed(0)}ms, scanned ${scanned.toFixed(0)}ms`).toBeLessThan(scanned);
}, 600000);
