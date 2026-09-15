/**
 * A browser session on the statistics bureau's portal, for the collectors.
 *
 * The bureau's metadata endpoints answer a plain HTTP client with a JavaScript
 * challenge served as HTTP 200 — so a "successful" fetch returns an HTML page
 * where JSON was asked for. Loading the portal in a real browser and making the
 * requests from inside that page gives the collector the session a visitor has.
 * The session expires during a long crawl, so the challenge is answered by
 * opening the portal again rather than by waiting longer.
 *
 * Only the collectors need this. The observations endpoint (stream/esData) is
 * not challenged, which is why the running site needs no browser.
 */

import { mkdir } from "node:fs/promises";
import { chromium, type Browser, type Page } from "playwright";

const API = "https://data.stats.gov.cn/dg/website/publicrelease/web/external";
const PORTAL_URL = "https://data.stats.gov.cn/dg/website/page.html";

export interface PortalSession {
  /** GET one metadata path under /external, retrying and re-opening the portal as needed. */
  getJson(path: string): Promise<unknown>;
  /** Requests made, including retries — a crawl reports it so pacing can be judged. */
  requestCount(): number;
  close(): Promise<void>;
}

export interface PortalOptions {
  /** Browser channel; the real Chrome is what the challenge is happiest with. */
  channel?: string;
  headless?: boolean;
  /** Base pause between retries, doubled each attempt. */
  delayMs?: number;
  attempts?: number;
  /**
   * Directory to keep answered requests in. A crawl of the whole index takes
   * hours because the portal throttles a visitor who asks a lot, and an
   * interrupted crawl otherwise starts from nothing; with a cache the second
   * run replays what it already knows and only asks for the rest.
   */
  cacheDir?: string;
}

export async function openPortal(options: PortalOptions = {}): Promise<PortalSession> {
  const { channel = "chrome", headless = true, delayMs = 1000, attempts = 8, cacheDir } = options;
  if (cacheDir) await mkdir(cacheDir, { recursive: true });
  const cachePath = (path: string) => `${cacheDir}/${Bun.hash(path).toString(16)}.json`;
  const browser: Browser = await chromium.launch({ channel, headless });
  let page: Page = await browser.newPage({ locale: "zh-CN" });
  let requests = 0;

  async function load(): Promise<void> {
    if (!page.isClosed()) await page.close().catch(() => undefined);
    page = await browser.newPage({ locale: "zh-CN" });
    await page.goto(PORTAL_URL, { waitUntil: "commit", timeout: 60_000 });
    await page.getByRole("menuitem", { name: /地区数据/ }).waitFor({ timeout: 60_000 });
  }

  await load();

  async function getJson(path: string): Promise<unknown> {
    if (cacheDir) {
      const cached = Bun.file(cachePath(path));
      if (await cached.exists()) {
        try { return await cached.json() as unknown; } catch { /* rewrite it below */ }
      }
    }
    let lastError = "unknown response";
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      requests += 1;
      try {
        const text = await page.evaluate(async (url: string) => {
          const response = await fetch(url, { headers: { Accept: "application/json" } });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.text();
        }, `${API}${path}`);
        if (!text.trimStart().startsWith("{")) throw new Error("received the portal anti-bot page");
        const parsed: unknown = JSON.parse(text);
        if (cacheDir) await Bun.write(cachePath(path), text);
        return parsed;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt >= attempts) break;
        await Bun.sleep(Math.min(60_000, delayMs * 2 ** attempt));
        if (attempt >= 2) await load().catch(() => undefined);
      }
    }
    throw new Error(`${path} -> ${lastError} after ${attempts} attempts`);
  }

  return {
    getJson,
    requestCount: () => requests,
    close: async () => { await browser.close(); },
  };
}
