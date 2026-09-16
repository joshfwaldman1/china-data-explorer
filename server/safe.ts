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

/** The last `limit` quarters of each configured item, from the current workbook. */
export async function fetchSafe(key: string, cfg: SafeIndicator, limit: number, read: (url: string) => Promise<ArrayBuffer> = get): Promise<SeriesResult> {
  const page = new TextDecoder().decode(await read(PAGE));
  const link = workbookLink(page);
  if (!link) throw new Error("SAFE: the time-series page carries no workbook link");
  const series = parseBopWorkbook(await read(link), cfg.items);
  return {
    key, title: cfg.title, agency: cfg.agency, sourceUrl: PAGE, frequency: cfg.frequency, unit: cfg.unit,
    series: cfg.items.filter((item) => series.has(item.label)).map((item) => ({ label: item.label, points: (series.get(item.label) ?? []).slice(-Math.max(1, limit)) })),
  };
}
