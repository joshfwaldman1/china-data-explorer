/**
 * A theme is a fixed list of charts naming series the site already holds.
 * These tests hold every key, region and line a theme names to the catalog,
 * so a panel that would draw nothing fails the build instead of the page.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-themes-")), "test.db");
process.env.CHINA_SEED = "off";
const { CATALOG, configuredLabels, seriesRegion, seriesRegions } = await import("./data.ts");
const { writeSeries } = await import("./db.ts");
const { readCatalogSnapshot } = await import("./catalog-file.ts");
const { THEMES, allThemeCharts, themeData, trailingTwelveMonths, percentOf, sharesOfSum, indexedTo } = await import("./themes.ts");

interface Entry { id: string; datasetCode: number; geography: string }
const isEntry = (value: unknown): value is Entry =>
  typeof value === "object" && value !== null && typeof Reflect.get(value, "id") === "string";
const snapshot: unknown = await readCatalogSnapshot();
const list = typeof snapshot === "object" && snapshot !== null ? Reflect.get(snapshot, "entries") : undefined;
const byId = new Map((Array.isArray(list) ? list : []).filter(isEntry).map((entry) => [entry.id, entry]));

test("every chart names a curated key or a national series in the bureau's catalog", () => {
  for (const { theme, chart } of allThemeCharts()) {
    if (CATALOG[chart.key]) continue;
    const entry = byId.get(chart.key.replace(/^nbs_/, ""));
    expect(entry, `${theme}: ${chart.key}`).toBeDefined();
    // National datasets only: 1 monthly, 2 quarterly, 3 annual. A provincial id drawn without a region would show one province under a national title.
    expect([1, 2, 3], `${theme}: ${chart.key} is in dataset ${entry?.datasetCode}`).toContain(entry?.datasetCode ?? -1);
  }
});

test("every line a composed chart reads, and every series it divides by, is a national series in the bureau's catalog", () => {
  for (const { theme, chart } of allThemeCharts()) {
    const keys = [...(chart.lines ?? []).map((line) => line.key), ...(chart.per ? [chart.per] : [])];
    for (const key of keys) {
      const entry = byId.get(key.replace(/^nbs_/, ""));
      expect(entry, `${theme}: ${chart.title ?? chart.key} reads ${key}`).toBeDefined();
      expect([1, 2, 3], `${theme}: ${key} is in dataset ${entry?.datasetCode}`).toContain(entry?.datasetCode ?? -1);
    }
    // Steps that only make sense on composed lines are never set on a single stored series.
    if (!chart.lines) expect(Boolean(chart.ttm || chart.per || chart.shareOfLines || chart.indexTo), `${theme}: ${chart.title ?? chart.key}`).toBe(false);
  }
});

test("a twelve-month sum is this year to date plus last year's total less last year to the same month, with no January the table lacks", () => {
  const ytd = [
    { date: "2024-02", value: 20 }, { date: "2024-03", value: 35 }, { date: "2024-12", value: 150 },
    { date: "2025-02", value: 30 }, { date: "2025-03", value: 50 }, { date: "2025-12", value: 200 },
    { date: "2026-02", value: 0 }, { date: "2026-03", value: 60 },
  ];
  expect(trailingTwelveMonths(ytd)).toEqual([
    { date: "2024-12", value: 150 },
    { date: "2025-02", value: 160 },
    { date: "2025-03", value: 165 },
    { date: "2025-12", value: 200 },
    // A placeholder zero is skipped rather than read as a month with no output.
    { date: "2026-03", value: 210 },
  ]);
});

test("a ratio, shares of a sum and an index are worked out at matching dates only", () => {
  // R&D spending and nominal GDP for 2025, in 100 million yuan: 2.80% of GDP.
  expect(percentOf([{ date: "2024", value: 36326.76 }, { date: "2025", value: 39262 }], [{ date: "2025", value: 1401879.2 }])).toEqual([{ date: "2025", value: 2.8 }]);
  expect(sharesOfSum([[{ date: "2024", value: 1 }, { date: "2023", value: 1 }], [{ date: "2024", value: 3 }]])).toEqual([[{ date: "2024", value: 25 }], [{ date: "2024", value: 75 }]]);
  expect(indexedTo([{ date: "2023-12", value: 80 }, { date: "2024-06", value: 100 }], "2023-12")).toEqual([{ date: "2023-12", value: 100 }, { date: "2024-06", value: 125 }]);
  expect(indexedTo([{ date: "2024-06", value: 100 }], "2023-12")).toEqual([]);
});

test("every region a chart names is one the series has, and every line is one the series draws", () => {
  for (const { theme, chart } of allThemeCharts()) {
    const where = `${theme}: ${chart.title ?? chart.key}`;
    if (chart.region) {
      const regions = seriesRegions(chart.key).map((region) => region.value);
      expect(regions, where).toContain(chart.region);
    } else if (seriesRegions(chart.key).length > 0) {
      expect(seriesRegion(chart.key), `${where} names no region and the series has no default`).not.toBe("");
    }
    // Customs labels are the store's own (a commodity's quantity unit), so only configured keys can be checked here.
    const known = chart.labels ? configuredLabels(chart.key) : null;
    if (chart.labels && known) for (const label of chart.labels) expect(known, where).toContain(label);
  }
});

test("a theme's titles are its own and its charts are few enough to read", () => {
  for (const [name, theme] of Object.entries(THEMES)) {
    expect(theme.title.length, name).toBeGreaterThan(0);
    expect(theme.sections.length, name).toBeGreaterThan(0);
    const total = theme.sections.reduce((sum, section) => sum + section.charts.length, 0);
    expect(total, `${name} has ${total} charts`).toBeLessThanOrEqual(40);
    const titles = theme.sections.map((section) => section.title);
    expect(new Set(titles).size, `${name} repeats a section title`).toBe(titles.length);
  }
});

test("themeData returns every section with a stored series read and filtered to the chart's lines", async () => {
  const trade = CATALOG["trade"]!;
  writeSeries({
    key: "trade", title: trade.title, agency: trade.agency, unit: trade.unit, frequency: trade.frequency, sourceUrl: "http://www.customs.gov.cn/", fetchedAt: new Date().toISOString(),
    series: [
      { label: "Exports (YoY %)", points: [{ date: "2025-06", value: 5.8 }, { date: "2025-07", value: 7.2 }] },
      { label: "Imports (YoY %)", points: [{ date: "2025-06", value: 1.1 }, { date: "2025-07", value: 4.1 }] },
      { label: "Trade balance (USD bn)", points: [{ date: "2025-06", value: 114.8 }, { date: "2025-07", value: 98.2 }] },
    ],
  } as never, seriesRegions("trade")[0]!.value, new Date().toISOString());
  const data = await themeData("trade");
  expect(data).not.toBeNull();
  expect(data!.sections.map((section) => section.title)).toEqual(THEMES.trade!.sections.map((section) => section.title));
  const headline = data!.sections[0]!.charts.find((chart) => chart.key === "trade")!;
  expect(headline.result).not.toBeNull();
  expect(headline.result!.title).toBe("Exports and imports, growth on a year earlier, month");
  expect(headline.result!.series.map((line) => line.label)).toEqual(["Exports (YoY %)", "Imports (YoY %)"]);
  // A chart whose series is not stored yet is handed to the page as null, never as an empty result that would draw a blank axis.
  const unstored = data!.sections.flatMap((section) => section.charts).find((chart) => chart.key === "gdp_contributions");
  expect(unstored?.result).toBeNull();
});

test("an unknown theme is null, so the route can answer 404", async () => {
  expect(await themeData("weather")).toBeNull();
});

test("the share aged 65 and over is worked out from the bureau's counts, year by year, and links to the age table", async () => {
  const stamp = new Date().toISOString();
  writeSeries({
    key: "population_age", title: "Population by Age Group", agency: "National Bureau of Statistics", unit: "Ten thousand persons (万人)", frequency: "Annual", sourceUrl: "https://data.stats.gov.cn/",
    series: [
      { label: "Aged 65 and over (10,000 persons)", points: [{ date: "2024", value: 22023 }, { date: "2025", value: 22365 }] },
      { label: "Aged 15 to 64 (10,000 persons)", points: [{ date: "2024", value: 96565 }] },
    ],
  } as never, "", stamp);
  writeSeries({
    key: "population_nbs", title: "Population", agency: "National Bureau of Statistics", unit: "Ten thousand persons (万人)", frequency: "Annual", sourceUrl: "https://data.stats.gov.cn/",
    series: [{ label: "Total, year end (10,000 persons)", points: [{ date: "2024", value: 140828 }, { date: "2025", value: 140489 }] }],
  } as never, "", stamp);
  const data = await themeData("demographics");
  const chart = data!.sections.flatMap((section) => section.charts).find((item) => item.derive === "share_65")!;
  expect(chart.key).toBe("population_age");
  expect(chart.result?.agency).toBe("National Bureau of Statistics");
  expect(chart.result?.series[0]?.points).toEqual([{ date: "2024", value: 15.64 }, { date: "2025", value: 15.92 }]);
});

test("the three-month trade average gives January and February the combined two-month rate and skips a short window", async () => {
  const stamp = new Date().toISOString();
  writeSeries({
    key: "trade", title: "Merchandise Trade", agency: "General Administration of Customs", unit: "Percent change from year ago", frequency: "Monthly", sourceUrl: "http://english.customs.gov.cn/",
    series: [
      { label: "Exports (YoY %)", points: [{ date: "2025-11", value: 5.9 }, { date: "2025-12", value: 6.6 }, { date: "2026-02", value: 39.6 }, { date: "2026-03", value: 2.5 }, { date: "2026-04", value: 14.1 }] },
      { label: "Imports (YoY %)", points: [{ date: "2025-11", value: 1.9 }, { date: "2025-12", value: 5.7 }, { date: "2026-02", value: 13.8 }, { date: "2026-03", value: 27.8 }, { date: "2026-04", value: 25.3 }] },
      { label: "Exports, year to date (YoY %)", points: [{ date: "2026-02", value: 21.8 }, { date: "2026-03", value: 15.2 }] },
      { label: "Imports, year to date (YoY %)", points: [{ date: "2026-02", value: 18.6 }, { date: "2026-03", value: 21.9 }] },
    ],
  } as never, seriesRegions("trade")[0]!.value, stamp);
  const data = await themeData("trade");
  const chart = data!.sections.flatMap((section) => section.charts).find((item) => item.derive === "trade_3m")!;
  const exports = chart.result?.series.find((line) => line.label.startsWith("Exports"))?.points ?? [];
  const at = (date: string) => exports.find((point) => point.date === date)?.value;
  // January and February 2026 are both 21.8, the combined rate: January averages 5.9, 6.6 and 21.8, February 6.6, 21.8 and 21.8.
  expect(at("2026-01")).toBe(11.4);
  expect(at("2026-02")).toBe(16.7);
  expect(at("2026-03")).toBe(15.4);
  expect(at("2026-04")).toBe(12.8);
  // November 2025 has no September and October behind it here, so no point.
  expect(at("2025-11")).toBeUndefined();
});
