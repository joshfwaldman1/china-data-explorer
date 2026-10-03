/** User journeys and recovery states, served locally with every publisher blocked. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { startOfflineServer, TEST_CATALOG } from "./test-server";
import adjustmentCatalog from "./fixtures/nbs-adjustment-metadata.json";
import { collectCatalogNotes } from "../shared/catalog-notes";

const scratch = mkdtempSync(join(tmpdir(), "china-portal-ux-"));
const env = { ...process.env, CHINA_DB_PATH: join(scratch, "test.db"), CHINA_CATALOG_DB_PATH: join(scratch, "catalog.db"), NBS_CATALOG_PATH: join(scratch, "catalog.json"), CHINA_SEED: "off", NBS_QUERY_EXPANSION: "off", CATALOG_CRAWL: "off", CHINA_LIVE_FALLBACK: "0", INGEST_EVERY_HOURS: "0", PORT: "0", NODE_ENV: "test" };
let server: Awaited<ReturnType<typeof startOfflineServer>>;
let browser: Browser;
const stats = { generatedAt: "2026-09-01", seriesCount: 1234, categoryCount: 1, categories: [{ name: "价格", count: 1234 }], datasets: [{ code: 1, name: "月度数据", frequency: "Monthly", geography: "National", count: 1234, categories: [{ name: "价格", count: 1234 }] }] };
const catalog = [
  { key: "gdp", title: "Gross Domestic Product", group: "Growth & Output", frequency: "Quarterly", unit: "Percent change from year ago", agency: "National Bureau of Statistics", source: "nbs", homeRows: [] },
  { key: "fai", title: "Fixed-Asset Investment Growth, Year to Date", group: "Growth & Output", frequency: "Monthly", unit: "Percent change from year ago, cumulative year to date", agency: "National Bureau of Statistics", source: "nbs", homeRows: [{ title: "Investment Growth, Year to Date", rank: 1 }] },
  { key: "trade_partners", title: "Trade by Partner", group: "Trade & External", frequency: "Monthly", unit: "Million USD", agency: "General Administration of Customs", source: "customs", homeRegions: ["united-states", "asean"], homeRows: [{ line: "Exports", rank: 2 }] },
];
const series = (key: string, label: string, value: number, region?: { value: string; en: string; text: string }) => ({ key, title: key, frequency: "Monthly", unit: "%", agency: "NBS", sourceUrl: "", region, series: [{ label, points: [{ date: "2025-08", value: value - 1 }, { date: "2026-08", value }] }] });
const home = { gdp: series("gdp", "Real GDP (YoY %)", 4.3), fai: series("fai", "Investment, year to date (YoY %)", -7.2), "trade_partners@united-states": series("trade_partners", "Exports", 42480, { value: "united-states", en: "United States", text: "美国" }), "trade_partners@asean": series("trade_partners", "Exports", 74380, { value: "asean", en: "ASEAN", text: "东盟" }) };
const result = (key: string) => ({ ...TEST_CATALOG.entries[0], key, nameEn: key, nameEnSource: "nbs-official" });
const response = (keys: string[], total = keys.length) => ({ results: keys.map(result), total, offset: 0, limit: 60 });

beforeAll(async () => {
  await Bun.write(env.NBS_CATALOG_PATH, JSON.stringify(TEST_CATALOG));
  server = await startOfflineServer(env);
  const channel = process.env.PLAYWRIGHT_CHANNEL ?? "chrome";
  browser = await chromium.launch({ headless: true, ...(channel === "chromium" ? {} : { channel }) });
}, 60_000);
afterAll(async () => { await browser?.close(); await server?.stop(); });

async function openPage(): Promise<Page> {
  const page = await browser.newPage();
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== server.url) { await route.abort(); return; }
    const payload = url.pathname === "/api/catalog" ? catalog : url.pathname === "/api/catalog/stats" ? stats : url.pathname === "/api/home" ? home : url.pathname === "/api/releases" ? { data: [] } : undefined;
    if (payload) await route.fulfill({ json: payload }); else await route.continue();
  });
  return page;
}

// Wait on a observable UI state instead of sleeps or implementation timing.
async function hasResults(page: Page, key: string) { await page.locator(".result .title", { hasText: key }).waitFor(); }

test("pending coverage and releases never masquerade as zero series or an empty calendar", async () => {
  const page = await openPage();
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    await page.route("**/api/catalog/stats", async route => { await gate; await route.fulfill({ json: stats }); });
    await page.route("**/api/releases", async route => { await gate; await route.fulfill({ json: { data: [] } }); });
    await page.goto(server.url);
    await page.getByText("Loading the release calendar…").waitFor();
    expect(await page.locator(".coverage-summary").innerText()).not.toContain("0 NBS");
    expect(await page.getByText("No further releases scheduled", { exact: false }).count()).toBe(0);
    release();
    await page.getByText("1,234", { exact: true }).waitFor();
    await page.getByText("No further releases scheduled", { exact: false }).waitFor();
  } finally { release(); await page.close(); }
}, 60_000);

test("a failed overview retries one bulk request and the catalog can recover on Browse", async () => {
  const page = await openPage();
  let overviewAttempts = 0;
  let statsAttempts = 0;
  let individualRequests = 0;
  page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/series/")) individualRequests++; });
  try {
    await page.route("**/api/home", route => ++overviewAttempts === 1 ? route.fulfill({ status: 503, json: { error: "offline" } }) : route.fulfill({ json: home }));
    await page.route("**/api/catalog/stats", route => ++statsAttempts === 1 ? route.fulfill({ status: 503, json: {} }) : route.fulfill({ json: stats }));
    await page.goto(server.url);
    await page.getByRole("button", { name: "Retry overview" }).click();
    await page.locator(".tile-value", { hasText: "4.3" }).waitFor();
    expect(overviewAttempts).toBe(2);
    expect(await page.locator(".hero-tiles .label").innerText()).toBe("Real GDP growth");
    expect(individualRequests).toBe(0);
    await page.getByRole("link", { name: "Browse", exact: true }).click();
    await page.getByText("Catalog unavailable", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await page.locator(".browse-dataset").waitFor();
    expect(statsAttempts).toBe(2);
  } finally { await page.close(); }
}, 60_000);

test("search waits for submission, a failed search retries, and slash follows navigation", async () => {
  const page = await openPage();
  let attempts = 0;
  try {
    await page.route("**/api/search?*", route => ++attempts === 1 ? route.fulfill({ status: 503, json: {} }) : route.fulfill({ json: response(["Consumer prices"]) }));
    await page.goto(server.url);
    const hero = page.getByRole("searchbox", { name: "Search series", exact: true });
    await hero.fill("CPI");
    await hero.press("Tab");
    expect(page.url()).not.toContain("search");
    expect(attempts).toBe(0);
    await hero.press("Enter");
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await hasResults(page, "Consumer prices");
    expect(attempts).toBe(2);
    await page.locator("#main").focus();
    await page.keyboard.press("/");
    expect(await page.locator("#global-series-search").evaluate(el => el === document.activeElement)).toBe(true);
    await page.locator("#global-series-search").fill("GDP");
    expect(page.url()).toContain("CPI");
    await page.getByRole("navigation", { name: "Primary", exact: true }).getByRole("link", { name: "Home", exact: true }).click();
    await page.keyboard.press("/");
    expect(await page.locator("#home-series-search").evaluate(el => el === document.activeElement)).toBe(true);
  } finally { await page.close(); }
}, 60_000);

test("a late pagination response cannot mix one query into the next", async () => {
  const page = await openPage();
  let release = () => {};
  let received = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const requested = new Promise<void>(resolve => { received = resolve; });
  try {
    await page.route("**/api/search?*", async route => {
      const query = new URL(route.request().url()).searchParams;
      if (query.get("q") === "old" && query.get("offset") !== "0") {
        received(); await gate;
        await route.fulfill({ json: response(["Old trailing result"], 2) }).catch(() => {});
      } else await route.fulfill({ json: query.get("q") === "old" ? response(["Old first result"], 2) : response(["New result"]) });
    });
    await page.goto(`${server.url}/#/search?q=old`);
    await hasResults(page, "Old first result");
    await page.getByRole("button", { name: "Load 1 more", exact: true }).click();
    await requested;
    await page.locator("#global-series-search").fill("new");
    await page.locator("#global-series-search").press("Enter");
    await hasResults(page, "New result");
    release();
    // The pending request was aborted; navigation back and forth also verifies the URL is authoritative.
    await page.goBack();
    await hasResults(page, "Old first result");
    await page.goForward();
    await hasResults(page, "New result");
    expect(await page.locator(".result .title").allTextContents()).toEqual(["New result"]);
  } finally { release(); await page.close(); }
}, 60_000);

test("pagination failures preserve results and expose a working retry", async () => {
  const page = await openPage();
  let attempts = 0;
  try {
    await page.route("**/api/search?*", route => {
      const offset = new URL(route.request().url()).searchParams.get("offset");
      if (offset === "0") return route.fulfill({ json: response(["First result"], 2) });
      return ++attempts === 1 ? route.fulfill({ status: 503, json: {} }) : route.fulfill({ json: response(["Second result"], 2) });
    });
    await page.goto(`${server.url}/#/search?q=CPI`);
    await page.getByRole("button", { name: "Load 1 more", exact: true }).click();
    await page.getByRole("alert").waitFor();
    expect(await page.locator(".result .title").allTextContents()).toEqual(["First result"]);
    await page.getByRole("button", { name: "Retry loading more" }).click();
    await hasResults(page, "Second result");
    expect(await page.locator(".result").count()).toBe(2);
  } finally { await page.close(); }
}, 60_000);

test("key indicators filter individual places and retain YTD dates at mobile and tablet widths", async () => {
  const page = await openPage();
  try {
    await page.goto(server.url);
    await page.locator(".indicator-row", { hasText: "United States" }).waitFor();
    await page.getByRole("searchbox", { name: "Filter key indicators" }).fill("United States");
    expect(await page.locator(".indicator-row").count()).toBe(1);
    expect(await page.locator(".filter-summary").innerText()).toContain("1 matching indicators");
    expect(await page.locator(".indicator-row .value").innerText()).toContain("42.48");
    expect(await page.locator(".indicator-row .value").innerText()).toContain("billion US dollars");
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    for (const width of [360, 390, 768, 900, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const name of ["Browse", "Releases", "Saved"]) expect(await page.getByRole("navigation", { name: "Primary", exact: true }).getByRole("link", { name, exact: true }).isVisible()).toBe(true);
      const period = page.locator(".indicator-row", { hasText: "Investment Growth" }).locator(".period");
      expect(await period.isVisible()).toBe(true);
      expect(await period.innerText()).toBe("Jan to Aug 2026");
    }
    await page.getByRole("searchbox", { name: "Filter key indicators" }).fill("no-such-indicator");
    await page.getByText("No matching indicators", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    expect(await page.locator(".indicator-row").count()).toBe(3);
  } finally { await page.close(); }
}, 60_000);

const chartFixture = {
  ...series("gdp", "Fixture value", 0), title: "Chart range fixture", source: "cache", updatedAt: "2026-09-01", unit: "Million USD",
  series: [{ label: "Fixture value", points: [
    { date: "2020-01", value: 10 }, { date: "2024-01", value: 100 }, { date: "2024-02", value: 200 }, { date: "2024-03", value: 300 }, { date: "2024-04", value: 400 }, { date: "2024-05", value: 500 },
  ] }],
};
async function chartPage(): Promise<Page> {
  const page = await openPage();
  await page.route("**/api/series/gdp?*", route => route.fulfill({ json: chartFixture }));
  await page.route("**/api/dimensions/gdp", route => route.fulfill({ json: { regions: [] } }));
  await page.route("**/api/arrivals/gdp?*", route => route.fulfill({ json: { arrivals: [] } }));
  await page.route("**/api/revisions/gdp?*", route => route.fulfill({ json: { revised: [] } }));
  return page;
}
async function readCsvDownload(page: Page, label: string): Promise<string> {
  await page.locator("summary").filter({ hasText: "Download" }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: label, exact: true }).click();
  const download = await pending;
  return Bun.file((await download.path())!).text();
}

test("a failed series load can be retried without changing its URL", async () => {
  const page = await chartPage();
  let attempts = 0;
  try {
    await page.route("**/api/series/gdp?*", route => ++attempts === 1 ? route.fulfill({ status: 503, json: { error: "Service unavailable" } }) : route.fulfill({ json: chartFixture }));
    await page.goto(`${server.url}/#/series/gdp`);
    await page.getByText("Series unavailable", { exact: true }).waitFor();
    const url = page.url();
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await page.getByRole("heading", { name: "Chart range fixture", exact: true }).waitFor();
    expect(attempts).toBe(2);
    expect(page.url()).toBe(url);
  } finally { await page.close(); }
}, 60_000);

test("failed revision history is not reported as no revisions and can recover", async () => {
  const page = await chartPage();
  let attempts = 0;
  try {
    await page.route("**/api/revisions/gdp?*", route => ++attempts === 1 ? route.fulfill({ status: 503, json: {} }) : route.fulfill({ json: { revised: [{ label: "Fixture value", period: "2024-02", vintages: [{ value: 199, fetchedAt: "2026-08-01" }, { value: 200, fetchedAt: "2026-09-01" }] }] } }));
    await page.goto(`${server.url}/#/series/gdp`);
    await page.getByRole("button", { name: "Retry revision history" }).waitFor();
    expect(await page.locator(".revisions").innerText()).not.toContain("None recorded");
    await page.getByRole("button", { name: "Retry revision history" }).click();
    await page.locator(".revisions tbody tr").waitFor();
    expect(await page.locator(".revisions").innerText()).toContain("199");
    expect(await page.locator(".revisions").innerText()).toContain("200");
    expect(attempts).toBe(2);
  } finally { await page.close(); }
}, 60_000);

test("chart, table and selected-view CSV share exact month boundaries and smoothing", async () => {
  const page = await chartPage();
  try {
    await page.goto(`${server.url}/#/series/gdp?from=2024-02&to=2024-02&ma=3`);
    await page.locator(".view-summary", { hasText: "1 period in view" }).waitFor();
    await page.getByRole("tab", { name: "Table", exact: true }).click();
    expect(await page.locator("#panel-table tbody tr").count()).toBe(1);
    expect(await page.locator("#panel-table tbody").innerText()).toContain("Feb 2024");
    expect(await page.locator("#panel-table tbody").innerText()).toContain("150");
    const csv = await readCsvDownload(page, "Download view (CSV)");
    expect(csv).toContain('"2024-02","150"');
    expect(csv).not.toContain('"2024-03"');
    expect(csv).toContain("Three-month trailing average");
    const full = await readCsvDownload(page, "Download all periods (CSV)");
    expect(full).toContain('"2020-01"');
    expect(full).toContain('"2024-05"');
    await page.getByLabel("End month", { exact: true }).fill("2024-04");
    await page.locator(".view-summary", { hasText: "3 periods in view" }).waitFor();
    expect(await page.locator("#panel-table tbody").innerText()).not.toContain("May 2024");
    for (const width of [360, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.getByLabel("Start month", { exact: true }).isVisible()).toBe(true);
      expect(await page.getByLabel("End month", { exact: true }).isVisible()).toBe(true);
    }
    await page.getByRole("button", { name: "Custom", exact: true }).click();
    await page.locator(".view-summary", { hasText: "6 periods in view" }).waitFor();
    expect(page.url()).not.toContain("from=");
  } finally { await page.close(); }
}, 60_000);

test("empty date ranges explain how to recover and do not offer blank image exports", async () => {
  const page = await chartPage();
  try {
    await page.goto(`${server.url}/#/series/gdp?from=2025-01&to=2025-02`);
    await page.getByText("No observations in this date range. Choose another range or Max.", { exact: true }).waitFor();
    await page.locator("summary").filter({ hasText: "Share" }).click();
    expect(await page.getByRole("menuitem", { name: "Download image", exact: true }).isEnabled()).toBe(false);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Max", exact: true }).click();
    await page.locator(".view-summary", { hasText: "6 periods in view" }).waitFor();
    for (const width of [360, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  } finally { await page.close(); }
}, 60_000);

test("an end-only range and a rebased comparison export the periods and units actually shown", async () => {
  const page = await chartPage();
  try {
    await page.goto(`${server.url}/#/series/gdp?to=2020-01&range=1y`);
    await page.locator(".view-summary", { hasText: "1 period in view" }).waitFor();
    expect(await readCsvDownload(page, "Download view (CSV)")).toContain('"2020-01","10"');
    await page.route("**/api/series/cpi?*", route => route.fulfill({ json: { ...chartFixture, key: "cpi", title: "Second level fixture", unit: "Hundred million yuan" } }));
    await page.goto(`${server.url}/#/series/gdp,cpi?from=2024-02&to=2024-03`);
    await page.locator(".view-summary", { hasText: "2 periods in view" }).waitFor();
    const csv = await readCsvDownload(page, "Download view (CSV)");
    expect(csv).toContain("# Unit: Index, first shown period = 100");
    expect(csv).toContain('"2024-02","100","100"');
    expect(csv).toContain('"2024-03","150","150"');
    expect(csv).toContain("rebased to 100");
    expect(csv).not.toContain("# Unit: Million USD");
  } finally { await page.close(); }
}, 60_000);

test("seasonal adjustment follows Home, topic cards, comparison tables and downloaded CSV", async () => {
  const page = await chartPage();
  const pmi = { ...chartFixture, key: "pmi", title: "Purchasing Managers' Index", unit: "Diffusion index (50 = neutral)", series: [{ label: "Manufacturing PMI", points: chartFixture.series[0]!.points }] };
  try {
    await page.route("**/api/catalog", route => route.fulfill({json:[...catalog,{...catalog[0],key:"pmi",title:pmi.title,unit:pmi.unit,frequency:"Monthly"}]}));
    await page.route("**/api/home", route => route.fulfill({json:{...home,pmi}}));
    await page.goto(server.url);
    const tile=page.locator(".hero-tiles .tile").filter({hasText:"Manufacturing PMI"});
    await tile.locator(".adjustment-label",{hasText:"Seasonally adjusted"}).waitFor();
    expect(await tile.innerText()).not.toContain("Not seasonally adjusted");
    expect(await page.locator(".indicator-row").filter({hasText:"Investment Growth, Year to Date"}).locator(".name small").innerText()).not.toMatch(/·\s*$/);
    const catalogMetadata = adjustmentCatalog.entries[0]!;
    const catalogSeries = {...chartFixture,key:catalogMetadata.key,title:"GDP quarter-on-quarter growth",frequency:"Quarterly",metadata:catalogMetadata};
    await page.route("**/api/theme/labor", route => route.fulfill({json:{name:"labor",title:"Labor fixture",lede:"",sections:[{title:"Employment",charts:[{key:"pmi_manufacturing",title:"PMI employment",result:{...pmi,key:"pmi_manufacturing",series:[{...pmi.series[0],label:"Employment"}]}},{key:"unverified",title:"Unspecified labor series",result:{...pmi,key:"unverified",title:"Unspecified labor series",series:[{...pmi.series[0],label:"Labor series"}]}},{key:catalogMetadata.key,title:catalogSeries.title,result:catalogSeries}]}]}}));
    await page.goto(`${server.url}/#/labor`);
    await page.getByRole("heading",{name:"Labor fixture",exact:true}).waitFor();
    expect(await page.locator(".theme-card").filter({hasText:"PMI employment"}).locator(".adjustment-caption").innerText()).toBe("Seasonally adjusted");
    expect(await page.locator(".theme-card").filter({hasText:"Unspecified labor series"}).locator(".adjustment-caption").count()).toBe(0);
    expect(await page.locator(".theme-card").filter({hasText:catalogSeries.title}).locator(".adjustment-caption").innerText()).toBe("Seasonally adjusted");
    expect(await page.locator("main").innerText()).not.toContain("not verified");
    await page.route(`**/api/series/${catalogMetadata.key}?*`, route => route.fulfill({json:catalogSeries}));
    await page.goto(`${server.url}/#/series/${catalogMetadata.key}`);
    await page.locator(".data-card .adjustment-caption",{hasText:"Seasonally adjusted"}).waitFor();
    expect(await readCsvDownload(page,"Download view (CSV)")).toContain("# Seasonal adjustment: Seasonally adjusted");
    await page.route("**/api/series/pmi?*", route => route.fulfill({json:pmi}));
    await page.goto(`${server.url}/#/series/gdp,pmi?ma=3`);
    await page.locator(".data-card .adjustment-caption",{hasText:"Purchasing Managers' Index: Seasonally adjusted"}).waitFor();
    expect(await page.locator(".data-card .adjustment-caption").innerText()).toContain("Chart range fixture: Not seasonally adjusted");
    await page.getByRole("tab",{name:"Table",exact:true}).click();
    expect(await page.locator(".data-card .adjustment-caption").innerText()).toContain("Purchasing Managers' Index: Seasonally adjusted");
    const csv=await readCsvDownload(page,"Download view (CSV)");
    expect(csv).toContain("Seasonally adjusted");
    expect(csv).toContain("Not seasonally adjusted");
    for (const width of [360,768,1280]) {
      await page.setViewportSize({width,height:900});
      expect(await page.locator(".data-card .adjustment-caption").isVisible()).toBe(true);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
  } finally { await page.close(); }
},60_000);

test("comparison notes and CSV retain each series' complete catalogue prose and older slice scope", async () => {
  const page = await chartPage();
  const older = { ...TEST_CATALOG.entries[0]!, key: "nbs_notes_older", categories: ["Old table (-2023)"], note: "早期定义", noteEn: "Earlier definition", annotation: "旧口径\n原注第二行" };
  const current = { ...TEST_CATALOG.entries[0]!, key: "nbs_notes_current", nameEn: "Current series", categories: ["New table (2024-)"], note: "", annotation: "", family: { head: "nbs_notes_current", members: [older.key, "nbs_notes_current"], span: "to present" }, sourceNotes: collectCatalogNotes([older]) };
  const second = { ...TEST_CATALOG.entries[0]!, key: "nbs_notes_second", nameEn: "Second series", note: "另一指标定义", annotation: "Second series scope caveat" };
  try {
    for (const metadata of [current, second]) await page.route(`**/api/series/${metadata.key}?*`, route => route.fulfill({ json: { ...chartFixture, key: metadata.key, title: metadata.nameEn, metadata } }));
    await page.goto(`${server.url}/#/series/${current.key},${second.key}`);
    await page.getByRole("heading", { name: "NBS definition", exact: true }).first().waitFor();
    const notes = page.locator(".series-notes");
    expect(await notes.count()).toBe(2);
    expect(await notes.nth(0).innerText()).toContain("Earlier definition");
    expect(await notes.nth(0).innerText()).toContain("早期定义");
    expect(await notes.nth(0).innerText()).toContain("原注第二行");
    expect(await notes.nth(1).innerText()).toContain("另一指标定义");
    expect(await notes.nth(1).innerText()).toContain("Second series scope caveat");
    await notes.nth(0).locator("summary").first().click();
    expect(await notes.nth(0).getByRole("link", { name: "Old table (-2023)", exact: true }).first().isVisible()).toBe(true);
    const csv = await readCsvDownload(page, "Download view (CSV)");
    for (const text of ["Earlier definition", "早期定义", "原注第二行", "另一指标定义", "Second series scope caveat", "Old table (-2023)"]) expect(csv).toContain(text);
    expect(csv).toContain("# Note: 原注第二行");
    for (const width of [360, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  } finally { await page.close(); }
}, 60_000);
