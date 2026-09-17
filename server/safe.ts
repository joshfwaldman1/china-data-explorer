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
 *
 * The same site publishes bank FX settlement and sales (银行结售汇): one
 * workbook, replaced each month around the 15th, with monthly and annual
 * sheets in yuan and in dollars. The monthly sheets carry Excel date serials
 * across row 4 (one per month from January 2010) and the items down column
 * A in three sections: settlement (结汇), sales (售汇) and the difference
 * (差额), each broken down by the banks' own account and their customers.
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
  /** Which SAFE publication: the balance of payments (default) or bank FX settlement and sales. */
  table?: "bop" | "fx_settlement";
  /** The workbook sheet read for fx_settlement (a monthly or annual sheet, in yuan or dollars). */
  sheet?: string;
  /** Day of the month by which the monthly release is normally out. */
  releaseDay?: number;
  /** The items served, in order, by the row label in the workbook. */
  items: SafeItem[];
}

export interface SafeItem {
  /** Matches the row's label in column A (or column B for the forward rows, whose column A is blank). */
  match: RegExp;
  label: string;
  /** For fx_settlement: the section (一、结汇 / 二、售汇 / 三、差额) the row must sit under, since the sub-rows repeat in each. */
  section?: RegExp;
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

/** The 银行结售汇 rows served, the net figure first: it is the headline. */
export const FX_SETTLEMENT_ITEMS: SafeItem[] = [
  { match: /^三、\s*差额/, label: "Net settlement" },
  { match: /^一、\s*结汇/, label: "Settlement" },
  { match: /^二、\s*售汇/, label: "Sales" },
  { section: /^三、/, match: /^[(（]二[)）]\s*银行代客/, label: "Net settlement, bank customers" },
  { section: /^三、/, match: /^1\.\s*经常项目/, label: "Net settlement, current account" },
  { section: /^三、/, match: /^2\.\s*资本与金融项目/, label: "Net settlement, capital and financial account" },
  { section: /^四、/, match: /^差额$/, label: "Forward contracts signed, net" },
];

const FX_PAGE = `${SITE}/safe/2023/0215/22329.html`;

/** An Excel date serial (days since 30 December 1899) as "YYYY-MM"; SAFE's month headers are dates inside the month. */
function serialMonth(serial: number): string {
  const date = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Every item's series from one sheet of the bank FX settlement workbook. The
 * header row is whichever of the first twelve rows carries the most period
 * cells: date serials on a monthly sheet, "2010年" on an annual one. Values
 * are in 亿元 or 亿美元 to two decimals, as the workbook keeps them to more.
 */
export function parseFxWorkbook(bytes: ArrayBuffer | Uint8Array, sheetName: string, items = FX_SETTLEMENT_ITEMS): Map<string, SeriesPoint[]> {
  const sheet = readXlsx(bytes).find((candidate) => candidate.name === sheetName);
  if (!sheet) throw new Error(`SAFE FX workbook: no ${sheetName} sheet`);
  let headerRow = 0, periods: { column: number; period: string }[] = [];
  for (let row = 1; row <= 12; row += 1) {
    const found: { column: number; period: string }[] = [];
    for (let column = 2; column <= 600; column += 1) {
      const value = sheet.cells.get(`${columnLetters(column)}${row}`);
      if (typeof value === "number" && value > 36_000 && value < 80_000) found.push({ column, period: serialMonth(value) });
      else if (typeof value === "string" && /^\d{4}年$/.test(value.trim())) found.push({ column, period: value.trim().slice(0, 4) });
    }
    if (found.length > periods.length) { periods = found; headerRow = row; }
  }
  if (periods.length === 0) throw new Error("SAFE FX workbook: no period header");
  // A monthly header must step one month at a time; a slipped serial would shift every later month.
  for (let index = 1; index < periods.length; index += 1) {
    const previous = periods[index - 1]!.period, current = periods[index]!.period;
    if (previous.length === 7 && current !== nextMonth(previous)) throw new Error(`SAFE FX workbook: header jumps from ${previous} to ${current}`);
  }
  const out = new Map<string, SeriesPoint[]>();
  let section = "";
  for (let row = headerRow + 1; row <= 200; row += 1) {
    const a = sheet.cells.get(`A${row}`), b = sheet.cells.get(`B${row}`);
    const own = typeof a === "string" ? a.trim() : "";
    if (/^[一二三四五六七八九十]+、/.test(own)) section = own;
    const label = own || (typeof b === "string" ? b.trim() : "");
    if (!label) continue;
    const item = items.find((candidate) => candidate.match.test(label) && (!candidate.section || candidate.section.test(section)));
    if (!item || out.has(item.label)) continue;
    const points: SeriesPoint[] = [];
    for (const { column, period } of periods) {
      const value = sheet.cells.get(`${columnLetters(column)}${row}`);
      if (typeof value === "number" && Number.isFinite(value)) points.push({ date: period, value: Math.round(value * 100) / 100 });
    }
    if (points.length > 0) out.set(item.label, points);
  }
  if (!out.has("Net settlement") && !out.has("Settlement")) throw new Error("SAFE FX workbook: no settlement row found");
  return out;
}

function nextMonth(period: string): string {
  const year = Number(period.slice(0, 4)), month = Number(period.slice(5, 7));
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
}

export interface FxHeadline { period: string; settlement: number; sales: number; settlementUsd: number; salesUsd: number }

/**
 * The monthly release ("国家外汇管理局公布N年M月银行结售汇和银行代客涉外收付款数据")
 * states the month's settlement and sales in yuan and in dollars, rounded to
 * whole 亿; this reads them so the workbook can be checked against them.
 */
export function parseFxHeadline(html: string): FxHeadline | null {
  const text = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, "");
  const cny = text.match(/(\d{4})年(\d{1,2})月，银行结汇(-?\d+)亿元人民币，售汇(-?\d+)亿元人民币/);
  const usd = text.match(/按美元计值，(\d{4})年(\d{1,2})月，银行结汇(-?\d+)亿美元，售汇(-?\d+)亿美元/);
  if (!cny || !usd) return null;
  return { period: `${cny[1]}-${cny[2]!.padStart(2, "0")}`, settlement: Number(cny[3]), sales: Number(cny[4]), settlementUsd: Number(usd[3]), salesUsd: Number(usd[4]) };
}

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
export function workbookLink(pageHtml: string, named?: RegExp): string | null {
  for (const anchor of pageHtml.matchAll(/<a[^>]*href=["']([^"']+\.xlsx?)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    if (named && !named.test(anchor[0])) continue;
    return new URL(anchor[1]!, SITE).toString();
  }
  return null;
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
  if (cfg.table === "fx_settlement") return fetchFxSettlement(key, cfg, limit, read);
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

/**
 * The last `limit` periods of each configured item from one sheet of the bank
 * FX settlement workbook, which the statistics page links as the time series
 * (the link changes with each month's replacement).
 */
async function fetchFxSettlement(key: string, cfg: SafeIndicator, limit: number, read: (url: string) => Promise<ArrayBuffer>): Promise<SeriesResult> {
  const page = new TextDecoder().decode(await read(FX_PAGE));
  const link = workbookLink(page, /时间序列/);
  if (!link) throw new Error("SAFE: the bank FX settlement page carries no time-series workbook link");
  if (!cfg.sheet) throw new Error(`${key}: a SAFE fx_settlement series names its sheet`);
  const bytes = await read(link);
  const series = parseFxWorkbook(bytes, cfg.sheet, cfg.items);
  // The annual sheet's last column is the current year so far (January to the
  // latest month) under a plain year header; it is not a year until the
  // monthly sheet of the same currency reaches December.
  if (cfg.sheet.includes("年度")) {
    const monthly = parseFxWorkbook(bytes, cfg.sheet.replace("年度", "月度"), cfg.items);
    const lastMonth = [...monthly.values()].map((points) => points.at(-1)?.date ?? "").sort().at(-1) ?? "";
    if (lastMonth && !lastMonth.endsWith("-12")) {
      for (const [label, points] of series) series.set(label, points.filter((point) => point.date !== lastMonth.slice(0, 4)));
    }
  }
  return {
    key, title: cfg.title, agency: cfg.agency, sourceUrl: FX_PAGE, frequency: cfg.frequency, unit: cfg.unit,
    series: cfg.items.filter((item) => series.has(item.label)).map((item) => ({ label: item.label, points: (series.get(item.label) ?? []).slice(-Math.max(1, limit)) })),
  };
}
