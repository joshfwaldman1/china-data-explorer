/** User journeys and recovery states, served locally with every publisher blocked. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { startOfflineServer, TEST_CATALOG } from "./test-server";

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
