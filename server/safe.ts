/**
 * The balance of payments from the State Administration of Foreign Exchange.
 *
 * SAFE keeps one workbook of the whole BPM6 time series (1998 on) and
 * replaces it with each quarter's final release, about three months after
 * the quarter ends; the preliminary figures two months after the quarter
 * come as a news release the workbook does not yet hold. The English page
 * "The time-series data of Balance of Payments of China" links the current
 * workbook (the link changes with each release), whose quarterly(USD) sheet
 * has the periods across row 4 as "2026Q1" and the standard items down
 * column A, in 100 million US dollars, with the sign convention of BPM6: a
 * financial-account outflow is negative, and reserve assets rising is negative.
 */

import type { SeriesPoint, SeriesResult } from "./data";
import { columnLetters, readXlsx } from "./xlsx";

const SITE = "https://www.safe.gov.cn";
const PAGE = `${SITE}/en/2019/0329/1496.html`;
/** The 外汇新闻 listing, where each quarter's preliminary release appears two months after the quarter. */
const NEWS = `${SITE}/safe/whxw/`;
const MAX_NEWS_PAGES = 8;
const SHEET = "quarterly(USD)";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export interface SafeIndicator {
  kind: "safe";
  group: string;
  title: string;
  agency: string;
  frequency: string;
  unit: string;
  home?: boolean;
  ended?: string;
  endedNote?: string;
  /** The items served, in order, by the row label in the workbook. */
  items: { match: RegExp; label: string }[];
}

export const BOP_ITEMS: { match: RegExp; label: string }[] = [
  { match: /^1\.\s*Current account/i, label: "Current account" },
  { match: /^1\.A\.a\s+Goods/i, label: "Goods" },
  { match: /^1\.A\.b\s+Services/i, label: "Services" },
  { match: /^1\.B\s+Primary income/i, label: "Primary income" },
  { match: /^1\.C\s+Secondary income/i, label: "Secondary income" },
  { match: /^2\.1\s+Capital account/i, label: "Capital account" },
  { match: /^2\.2\.1\s+Financial account excluding reserve/i, label: "Financial account excluding reserves" },
  { match: /^2\.2\.1\.1\s+Direct investment/i, label: "Direct investment" },
  { match: /^2\.2\.1\.2\s+Portfolio investment/i, label: "Portfolio investment" },
  { match: /^2\.2\.1\.4\s+Other investment/i, label: "Other investment" },
  { match: /^2\.2\.2\s+Reserve assets/i, label: "Reserve assets" },
  { match: /^3\.\s*Net errors and omissions/i, label: "Net errors and omissions" },
];

/**
 * The preliminary release ("国家外汇管理局公布N年X季度…国际收支平衡表初步数")
 * carries a table of the quarter with 亿元, 亿美元 and SDR columns and the
 * same BPM6 codes as the workbook. Seven of its rows are the workbook's
 * items outright; the financial account it prints includes net errors and
 * omissions and is not taken, and it prints no portfolio or other investment.
 */
const PRELIMINARY_ROWS: { code: RegExp; label: string }[] = [
  { code: /^1\.\s*经常账户/, label: "Current account" },
  { code: /^1\.A\.a\s*货物/, label: "Goods" },
  { code: /^1\.A\.b\s*服务/, label: "Services" },
  { code: /^1\.B\s*初次收入/, label: "Primary income" },
  { code: /^1\.C\s*二次收入/, label: "Secondary income" },
  { code: /^2\.1\s*资本账户/, label: "Capital account" },
  { code: /^2\.2\.2\s*储备资产/, label: "Reserve assets" },
];

/** "2026年二季度" -> "2026-Q2"; the half-year and full-year releases name their last quarter. */
export function preliminaryPeriod(title: string): string | null {
  const match = title.match(/(\d{4})\s*年\s*(一|二|三|四)季度/);
  if (!match) return null;
  return `${match[1]}-Q${"一二三四".indexOf(match[2] ?? "") + 1}`;
}

export interface PreliminaryRelease { title: string; url: string; period: string }

/** The preliminary releases on one page of the news listing, newest first. */
export function parseNewsListing(html: string): PreliminaryRelease[] {
  const out: PreliminaryRelease[] = [];
  for (const match of html.matchAll(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/g)) {
    const title = (match[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!/国际收支平衡表初步数/.test(title)) continue;
    const period = preliminaryPeriod(title);
    if (period) out.push({ title, url: new URL(match[1] ?? "", SITE).toString(), period });
  }
  return out;
}

/** The quarter's items from a preliminary release page, in 100 million US dollars. */
export function parsePreliminary(html: string): { period: string; values: Map<string, number> } | null {
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
  const period = preliminaryPeriod(title);
  if (!period) return null;
  const values = new Map<string, number>();
  for (const table of html.matchAll(/<table[\s\S]*?<\/table>/g)) {
    const rows = [...table[0].matchAll(/<tr[\s\S]*?<\/tr>/g)].map((row) => [...row[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((cell) => (cell[1] ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()));
    const header = rows.find((row) => row.some((cell) => /亿美元/.test(cell)));
    if (!header) continue;
    const usd = header.findIndex((cell) => /亿美元/.test(cell));
    for (const row of rows) {
      const item = PRELIMINARY_ROWS.find((candidate) => candidate.code.test(row[0] ?? ""));
      if (!item || values.has(item.label)) continue;
      const value = Number((row[usd] ?? "").replace(/,/g, ""));
      if (Number.isFinite(value)) values.set(item.label, value);
    }
    if (values.size > 0) break;
  }
  return values.has("Current account") ? { period, values } : null;
}

/** The current workbook's URL on the English time-series page. */
export function workbookLink(pageHtml: string): string | null {
  const match = pageHtml.match(/href=["']([^"']+\.xlsx?)["']/i);
  return match?.[1] ? new URL(match[1], SITE).toString() : null;
}

/**
 * Every item's quarterly series from the workbook's quarterly(USD) sheet.
 * Refuses a workbook without that sheet or without a period header.
 */
export function parseBopWorkbook(bytes: ArrayBuffer | Uint8Array, items = BOP_ITEMS): Map<string, SeriesPoint[]> {
  const sheet = readXlsx(bytes).find((candidate) => candidate.name === SHEET);
  if (!sheet) throw new Error(`SAFE workbook: no ${SHEET} sheet`);
  // The header row is whichever row carries the most "YYYYQn" cells.
  let headerRow = 0, periods: { column: number; period: string }[] = [];
  for (let row = 1; row <= 12; row += 1) {
    const found: { column: number; period: string }[] = [];
    for (let column = 2; column <= 400; column += 1) {
      const value = sheet.cells.get(`${columnLetters(column)}${row}`);
      const match = String(value ?? "").match(/^(\d{4})Q([1-4])$/);
      if (match) found.push({ column, period: `${match[1]}-Q${match[2]}` });
    }
    if (found.length > periods.length) { periods = found; headerRow = row; }
  }
  if (periods.length === 0) throw new Error("SAFE workbook: no period header");
  const out = new Map<string, SeriesPoint[]>();
  for (let row = headerRow + 1; row <= 600; row += 1) {
    const label = sheet.cells.get(`A${row}`);
    if (typeof label !== "string") continue;
    const item = items.find((candidate) => candidate.match.test(label.trim()));
    if (!item || out.has(item.label)) continue;
    const points: SeriesPoint[] = [];
    for (const { column, period } of periods) {
      const value = sheet.cells.get(`${columnLetters(column)}${row}`);
      if (typeof value === "number" && Number.isFinite(value)) points.push({ date: period, value: Math.round(value * 100) / 100 });
    }
    if (points.length > 0) out.set(item.label, points);
  }
  if (!out.has("Current account")) throw new Error("SAFE workbook: current account row not found");
  return out;
}

async function get(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(60_000), redirect: "follow" });
  if (!response.ok) throw new Error(`SAFE -> HTTP ${response.status}`);
  return response.arrayBuffer();
}

/**
 * The last `limit` quarters of each configured item: the workbook's final
 * figures, then any later quarter the preliminary release already carries.
 * A preliminary point is replaced by the final one when the workbook catches
 * up, and the store keeps the earlier value as a revision.
 */
export async function fetchSafe(key: string, cfg: SafeIndicator, limit: number, read: (url: string) => Promise<ArrayBuffer> = get): Promise<SeriesResult> {
  const page = new TextDecoder().decode(await read(PAGE));
  const link = workbookLink(page);
  if (!link) throw new Error("SAFE: the time-series page carries no workbook link");
  const series = parseBopWorkbook(await read(link), cfg.items);
  const lastFinal = series.get("Current account")?.at(-1)?.date ?? "";
  const pause = read === get ? 800 : 0;
  // Walk the news listing until a release no newer than the workbook appears.
  const releases: PreliminaryRelease[] = [];
  for (let pageNo = 0; pageNo < MAX_NEWS_PAGES; pageNo += 1) {
    if (pageNo > 0 && pause > 0) await Bun.sleep(pause);
    let found: PreliminaryRelease[] = [];
    try { found = parseNewsListing(new TextDecoder().decode(await read(`${NEWS}${pageNo === 0 ? "index.html" : `index_${pageNo}.html`}`))); } catch { break; }
    releases.push(...found.filter((release) => release.period > lastFinal));
    if (found.some((release) => release.period <= lastFinal)) break;
  }
  for (const release of releases) {
    if (pause > 0) await Bun.sleep(pause);
    const parsed = parsePreliminary(new TextDecoder().decode(await read(release.url)));
    if (!parsed) continue;
    for (const item of cfg.items) {
      const value = parsed.values.get(item.label);
      if (value === undefined) continue;
      const points = series.get(item.label) ?? [];
      if (!points.some((point) => point.date === parsed.period)) { points.push({ date: parsed.period, value }); points.sort((a, b) => a.date.localeCompare(b.date)); series.set(item.label, points); }
    }
  }
  return {
    key, title: cfg.title, agency: cfg.agency, sourceUrl: PAGE, frequency: cfg.frequency, unit: cfg.unit,
    series: cfg.items.filter((item) => series.has(item.label)).map((item) => ({ label: item.label, points: (series.get(item.label) ?? []).slice(-Math.max(1, limit)) })),
  };
}
