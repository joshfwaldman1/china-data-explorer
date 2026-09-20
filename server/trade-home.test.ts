/**
 * The Trade section as a reader meets it: the home page lists the US, EU and
 * ASEAN rows of trade by partner, and the ranking page ranks every partner
 * for the month and downloads them. A real server on a scratch store seeded
 * from the August 2026 by-country fixture, rendered headless in Chromium.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { parseByCountry, slugOf } from "./customs.ts";
import { CUSTOMS_PARTNERS } from "./data.ts";
import { startOfflineServer, TEST_CATALOG } from "./test-server";

const scratch = mkdtempSync(join(tmpdir(), "china-trade-home-"));
const dbPath = join(scratch, "test.db");
const env = { ...process.env, CHINA_DB_PATH: dbPath, CHINA_CATALOG_DB_PATH: join(scratch, "catalog.db"), NBS_CATALOG_PATH: join(scratch, "catalog.json"), CHINA_SEED: "off", NBS_QUERY_EXPANSION: "off", CATALOG_CRAWL: "off", CHINA_LIVE_FALLBACK: "0", INGEST_EVERY_HOURS: "0", PORT: "0", NODE_ENV: "test" };

/** Every partner of the fixture month written to the scratch store, in a process of its own so the path is honoured. */
async function seed(): Promise<{ count: number; top: string }> {
  // This test exercises headline rows. A tiny, separate catalog keeps it independent
  // of the shipped 80,000-entry catalog and any other test's derived cache.
  await Bun.write(env.NBS_CATALOG_PATH, JSON.stringify(TEST_CATALOG));
  const html = await Bun.file(resolve(import.meta.dir, "fixtures/customs/by-country-2026-08-usd.html")).text();
  const rows = parseByCountry(html);
  const series = CUSTOMS_PARTNERS.flatMap((region) => {
    const row = rows.find((item) => slugOf(item.name) === region.value);
    if (!row || row.exports === null || row.imports === null) return [];
    return [{ region: region.value, exports: row.exports, imports: row.imports, balance: Math.round((row.exports - row.imports) * 10) / 10 }];
  });
  const script = `
    const { writeSeries } = await import(${JSON.stringify(resolve(import.meta.dir, "db.ts"))});
    for (const item of ${JSON.stringify(series)}) {
      writeSeries({ key: "trade_partners", title: "Trade by Partner", agency: "General Administration of Customs", sourceUrl: "", frequency: "Monthly", unit: "Million USD",
        series: [{ label: "Exports", points: [{ date: "2026-08", value: item.exports }] }, { label: "Imports", points: [{ date: "2026-08", value: item.imports }] }, { label: "Balance", points: [{ date: "2026-08", value: item.balance }] }] }, item.region, "2026-09-15T00:00:00.000Z");
    }
    // Guangdong's provincial GDP row, so the Regional section renders a placed row.
    writeSeries({ key: "provincial_gdp", title: "Provincial Real GDP Growth", agency: "National Bureau of Statistics", sourceUrl: "", frequency: "Quarterly", unit: "Percent change from year ago, cumulative year to date",
      series: [{ label: "Real GDP, cumulative YTD (YoY %)", points: [{ date: "2026-Q1", value: 4.6 }, { date: "2026-Q2", value: 4.5 }] }] }, "440000000000", "2026-09-15T00:00:00.000Z");
  `;
  const child = Bun.spawn(["bun", "-e", script], { env, stdout: "pipe", stderr: "pipe" });
  if (await child.exited !== 0) throw new Error(`seed failed: ${await new Response(child.stderr).text()}`);
  // The largest exporter destination of the month apart from the Total row: Customs
  // lists groupings (the EU, ASEAN, Belt and Road) beside countries, and they rank too.
  const top = [...series].filter((item) => item.region !== "total").sort((a, b) => b.exports - a.exports)[0];
  return { count: series.length, top: CUSTOMS_PARTNERS.find((region) => region.value === top?.region)?.en ?? "" };
}

test("the home page names the US, EU and ASEAN rows and the ranking page ranks every partner", async () => {
  const seeded = await seed();
  expect(seeded.count).toBe(30);
  const server = await startOfflineServer(env);
  // Locally the installed Chrome, as scripts/portal.ts uses it, so Playwright's own build need
  // not be downloaded; in CI the bundled Chromium the workflow installs (PLAYWRIGHT_CHANNEL=chromium).
  const channel = process.env.PLAYWRIGHT_CHANNEL ?? "chrome";
  const browser = await chromium.launch({ headless: true, ...(channel === "chromium" ? {} : { channel }) }).catch(async (error) => { await server.stop(); throw error; });
  try {
    const page = await browser.newPage();
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== server.url) { await route.abort(); return; }
      // Loading Home asks for a live release calendar even when ingestion is off.
      if (url.pathname === "/api/releases") { await route.fulfill({ json: { data: [] } }); return; }
      await route.continue();
    });
    await page.goto(`${server.url}/#/`);
    const trade = page.locator('section[aria-label="Trade & External"]');
    await trade.locator(".indicator-row", { hasText: "United States" }).waitFor({ state: "visible", timeout: 120_000 });
    const names = await trade.locator(".indicator-row .name").allInnerTexts();
    expect(names.some((name) => name.startsWith("Exports to the United States"))).toBe(true);
    expect(names.some((name) => name.startsWith("Exports to the European Union"))).toBe(true);
    expect(names.some((name) => name.startsWith("Exports to ASEAN"))).toBe(true);
    expect(names.some((name) => name.startsWith("Total"))).toBe(false);
    // The regional row names the province with the measure, not "Provincial" with the province in small print.
    const regional = page.locator('section[aria-label="Regional"]');
    await regional.locator(".indicator-row", { hasText: "Guangdong" }).waitFor({ state: "visible", timeout: 120_000 });
    const regionalNames = await regional.locator(".indicator-row .name").allInnerTexts();
    expect(regionalNames.some((name) => name.startsWith("Guangdong Real GDP Growth"))).toBe(true);
    expect(regionalNames.some((name) => name.startsWith("Provincial"))).toBe(false);
    // The series page is headed the same way.
    await regional.locator(".indicator-row", { hasText: "Guangdong" }).first().click();
    await page.locator("h1", { hasText: "Guangdong Real GDP Growth" }).waitFor({ state: "visible", timeout: 120_000 });

    await page.goto(`${server.url}/#/regions?key=trade_partners`);
    await page.locator(".ranked button").first().waitFor({ state: "visible", timeout: 120_000 });
    expect(await page.locator("h1").innerText()).toBe("Trade by Partner by Partner");
    // 30 partners, the Total row apart from the ranking.
    expect(await page.locator(".ranked button").count()).toBe(29);
    expect(await page.locator(".lede").innerText()).toContain("All partners, Aug 2026: 401,441 Million USD");
    expect(await page.locator(".ranked button").first().innerText()).toContain(seeded.top);

    // Ranking by imports reorders the list.
    await page.selectOption('select[aria-label="Line to rank by"]', "Imports");
    await page.locator(".card-head", { hasText: "imports, highest to lowest" }).waitFor({ state: "visible", timeout: 120_000 });
    expect(await page.locator(".ranked button").count()).toBe(29);

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download CSV" }).click();
    const path = await (await download).path();
    const csv = await Bun.file(path ?? "").text();
    const dataRows = csv.split("\n").filter((line) => line && !line.startsWith("#") && !line.startsWith('"place"'));
    expect(dataRows.length).toBe(30);
    expect(dataRows[0]).toContain('"Total"');
    expect(csv).toContain("# Series: Trade by Partner: Imports");
    expect((await fetch(`${server.url}/ready`)).status).toBe(200);
    expect((await fetch(`${server.url}/health`)).status).toBe(200);
  } finally {
    await browser.close();
    await server.stop();
  }
}, 300_000);
