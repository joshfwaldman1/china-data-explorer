/**
 * The regions page's province cards: one per province, largest economy
 * first, every field null where the store has nothing. These tests hold the
 * cards to the shared province list and to the store.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-cards-")), "test.db");
process.env.CHINA_SEED = "off";
const { CATALOG } = await import("./data.ts");
const { writeSeries } = await import("./db.ts");
const { PROVINCE_PLACES } = await import("../shared/places.ts");
const { provinceCards } = await import("./province.ts");

test("an empty store gives one card per province with nothing invented", () => {
  const cards = provinceCards();
  expect(cards.length).toBe(PROVINCE_PLACES.length);
  expect(new Set(cards.map((card) => card.code)).size).toBe(PROVINCE_PLACES.length);
  for (const card of cards) {
    expect(card.en.length).toBeGreaterThan(0);
    expect(card.gdpGrowth).toBeNull();
    expect(card.grp).toBeNull();
    expect(card.sectors).toEqual([]);
    expect(card.industries).toBeNull();
  }
});

test("a stored growth figure reaches its province's card and the largest economy sorts first", () => {
  const gdp = CATALOG["provincial_gdp"]!;
  const at = "2026-09-01T00:00:00.000Z";
  const growth = (code: string, value: number) => writeSeries({
    key: "provincial_gdp", title: gdp.title, agency: gdp.agency, unit: gdp.unit, frequency: gdp.frequency, sourceUrl: "https://data.stats.gov.cn/",
    series: [{ label: "Real GDP, cumulative YTD (YoY %)", points: [{ date: "2026-Q1", value: value - 0.2 }, { date: "2026-Q2", value }] }],
  } as never, code, at);
  const grp = (code: string, value: number) => writeSeries({
    key: "nbs_aff57de5ee994283974705914fbed246", title: "Gross Regional Product", agency: "National Bureau of Statistics", unit: "亿元", frequency: "Annual", sourceUrl: "https://data.stats.gov.cn/",
    series: [{ label: "全国", points: [{ date: "2025", value }] }],
  } as never, code, at);
  // Jiangsu and Zhejiang, not Guangdong: the province test writes Guangdong's structure into the same scratch store.
  growth("320000000000", 5.2); grp("320000000000", 142352);
  growth("330000000000", 5.7); grp("330000000000", 95000);
  const cards = provinceCards();
  expect(cards[0]).toMatchObject({ en: "Jiangsu", gdpGrowth: { period: "2026-Q2", value: 5.2 }, grp: { year: "2025", value: 142352 } });
  expect(cards[1]).toMatchObject({ en: "Zhejiang", gdpGrowth: { period: "2026-Q2", value: 5.7 } });
  // A province with nothing stored is still on the page, after the ones with figures.
  expect(cards.slice(2).filter((card) => card.en !== "Guangdong").every((card) => card.grp === null)).toBe(true);
});
