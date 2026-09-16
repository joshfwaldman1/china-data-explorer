/**
 * Aggregate financing to the real economy (社会融资规模, "total social
 * financing") from the People's Bank of China.
 *
 * The bank's statistics section (调查统计 > 统计数据) links one index page
 * per year for 社会融资规模, and each index carries the year's two tables as
 * attachments in three formats: the flow table (增量, 100 million yuan, one
 * row per month with the instruments across) and the stock table (存量,
 * trillion yuan, one column pair per month — the stock and its growth on a
 * year earlier — with the instruments down). The htm attachments are read;
 * they are GBK-encoded and carry English labels beside the Chinese, and the
 * parser keys on the English.
 *
 * The site answered a plain client from abroad on 16 September 2026; the
 * challenge page it is known for would surface as a non-table response, which
 * the parsers refuse rather than store.
 */

import type { SeriesPoint, SeriesResult } from "./data";

const SITE = "https://www.pbc.gov.cn";
const STATISTICS = `${SITE}/diaochatongjisi/116219/116319/index.html`;
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const PAUSE_MS = 1000;

export interface PbocIndicator {
  kind: "pboc";
  group: string;
  title: string;
  agency: string;
  frequency: string;
  unit: string;
  home?: boolean;
  ended?: string;
  endedNote?: string;
  /** Which table and reading this key serves. */
  table: "flow" | "stock" | "stock_growth";
  /** Day of the month by which the publisher's release is normally out (server/due.ts). */
  releaseDay?: number;
  /** The instruments served, in order, by their English label in the tables. */
  instruments: { match: RegExp; label: string }[];
}

/** The flow table's columns, in the bank's order, keyed by their English header. */
export const FLOW_COLUMNS: { match: RegExp; label: string }[] = [
  { match: /^AFRE\s*\(flow\)/i, label: "Total" },
  { match: /^RMB loans/i, label: "RMB loans" },
  { match: /^Foreign currency/i, label: "Foreign-currency loans" },
  { match: /^Entrusted loans/i, label: "Entrusted loans" },
  { match: /^Trust loans/i, label: "Trust loans" },
  { match: /^Undiscounted bankers/i, label: "Undiscounted bankers' acceptances" },
  { match: /corporate bonds/i, label: "Corporate bonds" },
  { match: /^Government bonds/i, label: "Government bonds" },
  { match: /^Equity financing/i, label: "Equity financing" },
  { match: /^Asset-backed securities/i, label: "Asset-backed securities" },
  { match: /^Loans written off/i, label: "Loans written off" },
];

export const STOCK_ROWS: { match: RegExp; label: string }[] = [
  { match: /AFRE\s*\(stock\)/i, label: "Total" },
  { match: /^RMB loans/i, label: "RMB loans" },
  { match: /^Foreign currency/i, label: "Foreign-currency loans" },
  { match: /^Entrusted loans/i, label: "Entrusted loans" },
  { match: /^Trust loans/i, label: "Trust loans" },
  { match: /^Undiscounted bankers/i, label: "Undiscounted bankers' acceptances" },
  { match: /corporate bonds/i, label: "Corporate bonds" },
  { match: /^Government bonds/i, label: "Government bonds" },
  { match: /^Equity financing/i, label: "Equity financing" },
];

function cellsOf(html: string): string[][] {
  return [...html.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((row) =>
    [...row[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((cell) => (cell[1] ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()));
}

/** The English part of a bilingual cell: "社会融资规模存量 AFRE(stock)" -> "AFRE(stock)". */
function english(cell: string): string {
  return cell.replace(/[　-鿿（）：、％]+/g, " ").replace(/\s+/g, " ").trim();
}

function num(cell: string | undefined): number | null {
  if (!cell) return null;
  const value = Number(cell.replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

/** "2026.01" or "2026.1" -> "2026-01". */
function periodOf(cell: string | undefined): string | null {
  const match = (cell ?? "").match(/^(\d{4})\.(\d{1,2})$/);
  return match ? `${match[1] ?? ""}-${String(Number(match[2] ?? "0")).padStart(2, "0")}` : null;
}

export interface FlowRow { period: string; values: Record<string, number | null> }

/** The flow table: one row per month, instruments across, 100 million yuan. Refuses a table without the AFRE(flow) header. */
export function parseFlowTable(html: string): FlowRow[] {
  const rows = cellsOf(html);
  const header = rows.find((row) => row.some((cell) => /AFRE\s*\(flow\)/i.test(cell)));
  if (!header) throw new Error("PBOC flow table: header not found");
  const columns = header.map((cell) => FLOW_COLUMNS.find((column) => column.match.test(english(cell)))?.label ?? null);
  // The header rows carry no cell for the month column that leads every data row.
  const offset = columns[0] ? 1 : 0;
  const out: FlowRow[] = [];
  for (const row of rows) {
    const period = periodOf(row[0]);
    if (!period || row.slice(1).every((cell) => cell === "")) continue;
    const values: Record<string, number | null> = {};
    columns.forEach((label, index) => { if (label) values[label] = num(row[index + offset]); });
    out.push({ period, values });
  }
  return out;
}

export interface StockPoint { period: string; instrument: string; stock: number | null; growth: number | null }

/** The stock table: months across in (stock, growth) pairs, instruments down, trillion yuan and percent. */
export function parseStockTable(html: string): StockPoint[] {
  const rows = cellsOf(html);
  const periodRow = rows.find((row) => row.filter((cell) => periodOf(cell)).length >= 6);
  if (!periodRow) throw new Error("PBOC stock table: period header not found");
  // Each period heads a pair of columns; the first data column is the one under the first period.
  const periods = periodRow.map((cell) => periodOf(cell));
  const firstColumn = periods.findIndex((period) => period !== null);
  const out: StockPoint[] = [];
  for (const row of rows) {
    const instrument = STOCK_ROWS.find((item) => item.match.test(english(row[0] ?? "")))?.label;
    if (!instrument) continue;
    periods.forEach((period, index) => {
      if (!period || index < firstColumn) return;
      const at = firstColumn + (index - firstColumn) * 2;
      const stock = num(row[at]), growth = num(row[at + 1]);
      if (stock === null && growth === null) return;
      out.push({ period, instrument, stock, growth });
    });
  }
  if (!out.some((point) => point.instrument === "Total")) throw new Error("PBOC stock table: AFRE(stock) row not found");
  return out;
}

/** The yearly 社会融资规模 index pages linked from the statistics section, newest first, with the year each covers. */
export function yearIndexLinks(statisticsHtml: string, now = new Date()): { year: number; url: string }[] {
  const links = [...statisticsHtml.matchAll(/href=["']([^"']+)["'][^>]*>\s*社会融资规模\s*<\/a>/g)].map((match) => match[1] ?? "");
  const first = links[0]?.match(/(\d{4})ntjsj/);
  const firstYear = first ? Number(first[1]) : now.getUTCFullYear();
  return links.map((path, index) => ({ year: firstYear - index, url: new URL(path, SITE).toString() }));
}

/** The htm attachments of one year's index: the flow and stock tables (not the by-province one). */
export function tableLinks(indexHtml: string): { flow: string | null; stock: string | null } {
  const out = { flow: null as string | null, stock: null as string | null };
  for (const table of indexHtml.matchAll(/<table[^>]*class="a2015"[\s\S]*?<\/table>/g)) {
    const title = (table[0].match(/<div class="titp20">([\s\S]*?)<\/div>/)?.[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const htm = table[0].match(/href=["']([^"']+)["'][^>]*>\s*htm\s*</)?.[1];
    if (!htm || /地区|Province/i.test(title)) continue;
    if (/增量统计表/.test(title)) out.flow = new URL(htm, SITE).toString();
    else if (/存量统计表/.test(title)) out.stock = new URL(htm, SITE).toString();
  }
  return out;
}

/** The bank's attachments are GBK; a page that says otherwise is read as it says. */
export function decodePage(bytes: ArrayBuffer): string {
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 2048));
  const charset = head.match(/charset=["']?([\w-]+)/i)?.[1]?.toLowerCase();
  return new TextDecoder(charset && /utf-?8/.test(charset) ? "utf-8" : "gbk").decode(bytes);
}

async function get(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(45_000), redirect: "follow" });
  if (!response.ok) throw new Error(`PBOC -> HTTP ${response.status}`);
  return response.arrayBuffer();
}

/**
 * The series of one key over the years that cover the last `limit` months: one
 * index page and two tables per year, paced. A year whose index lacks a table
 * (the current year in January) contributes what it has.
 */
export async function fetchPboc(key: string, cfg: PbocIndicator, limit: number, read: (url: string) => Promise<ArrayBuffer> = get): Promise<SeriesResult> {
  const pause = read === get ? PAUSE_MS : 0;
  const years = Math.min(15, Math.max(1, Math.ceil(limit / 12) + 1));
  const indexes = yearIndexLinks(decodePage(await read(STATISTICS))).slice(0, years);
  const flows: FlowRow[] = [];
  const stocks: StockPoint[] = [];
  for (const index of indexes) {
    if (pause > 0) await Bun.sleep(pause);
    const links = tableLinks(decodePage(await read(index.url)));
    const wanted = cfg.table === "flow" ? links.flow : links.stock;
    if (!wanted) continue;
    if (pause > 0) await Bun.sleep(pause);
    const html = decodePage(await read(wanted));
    if (cfg.table === "flow") flows.push(...parseFlowTable(html));
    else stocks.push(...parseStockTable(html));
  }
  const lines = new Map<string, Map<string, number>>();
  const put = (label: string, period: string, value: number | null) => {
    if (value === null) return;
    const line = lines.get(label) ?? new Map<string, number>();
    line.set(period, value);
    lines.set(label, line);
  };
  if (cfg.table === "flow") {
    for (const row of flows) for (const instrument of cfg.instruments) put(instrument.label, row.period, row.values[instrument.label] ?? null);
  } else {
    for (const point of stocks) {
      const instrument = cfg.instruments.find((item) => item.label === point.instrument);
      if (instrument) put(instrument.label, point.period, cfg.table === "stock" ? point.stock : point.growth);
    }
  }
  const series = cfg.instruments.filter((instrument) => lines.has(instrument.label)).map((instrument) => ({
    label: instrument.label,
    points: [...(lines.get(instrument.label) ?? new Map<string, number>()).entries()].map(([date, value]): SeriesPoint => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date)),
  }));
  return { key, title: cfg.title, agency: cfg.agency, sourceUrl: STATISTICS, frequency: cfg.frequency, unit: cfg.unit, series };
}
