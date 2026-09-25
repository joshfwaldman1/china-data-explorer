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
const { THEMES, allThemeCharts, themeData } = await import("./themes.ts");

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

test("themeData returns every section with a stored series read and filtered to the chart's lines", () => {
  const trade = CATALOG["trade"]!;
  writeSeries({
    key: "trade", title: trade.title, agency: trade.agency, unit: trade.unit, frequency: trade.frequency, sourceUrl: "http://www.customs.gov.cn/", fetchedAt: new Date().toISOString(),
    series: [
      { label: "Exports (YoY %)", points: [{ date: "2025-06", value: 5.8 }, { date: "2025-07", value: 7.2 }] },
      { label: "Imports (YoY %)", points: [{ date: "2025-06", value: 1.1 }, { date: "2025-07", value: 4.1 }] },
      { label: "Trade balance (USD bn)", points: [{ date: "2025-06", value: 114.8 }, { date: "2025-07", value: 98.2 }] },
    ],
  } as never, seriesRegions("trade")[0]!.value, new Date().toISOString());
  const data = themeData("trade");
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

test("an unknown theme is null, so the route can answer 404", () => {
  expect(themeData("weather")).toBeNull();
});
