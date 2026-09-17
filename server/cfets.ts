/**
 * Government bond yields from CFETS, the China Foreign Exchange Trade System.
 *
 * The closing yield curve for Chinese government bonds (中债国债收益率曲线,
 * bond type CYCC000) is published every trading day on chinamoney.com.cn,
 * CFETS's site. Its history endpoint answers a POST with JSON — a GET gets the
 * challenge page — and one request for a month returns every key tenor for
 * every trading day in it, from one month to fifty years.
 *
 * The site's frame is monthly, quarterly and annual, so this serves the
 * month-end close of each tenor as a monthly series and says so in the unit.
 * The daily closes are read and could be stored once the store has a daily
 * frequency; until then the month end is the figure kept.
 *
 * The same host publishes the money-market fixings the same way: SHIBOR
 * (eight tenors, overnight to one year, fixed each trading day at 11:00 from
 * the panel banks' quotes) and the repo fixing rates (FR001/007/014 across
 * all institutions and FDR001/007/014 among depository institutions, fixed
 * from the morning's pledged-repo trades). Each has a history endpoint that
 * answers a month's trading days in one POST. A series is either the last
 * fixing of the month or the month's average of daily fixings, and the unit
 * says which.
 *
 * Two more tables are the yuan's own prices: the central parity the PBOC
 * authorises CFETS to publish at 9:15 each trading day (CcprHisNew, one row
 * per day with a value per requested currency pair, the band the spot may
 * trade in set around it) and the CFETS RMB index (RmbIdxHis, weekly on
 * Fridays and on the month's last trading day, with the BIS- and SDR-basket
 * indices beside it, 31 December 2014 = 100).
 */

import type { SeriesPoint, SeriesResult } from "./data";

const ENDPOINT = "https://www.chinamoney.com.cn/ags/ms/cm-u-bk-currency/ClsYldCurvHis";
const SHIBOR_ENDPOINT = "https://www.chinamoney.com.cn/ags/ms/cm-u-bk-shibor/ShiborHis";
const FIXING_ENDPOINT = "https://www.chinamoney.com.cn/ags/ms/cm-u-bk-currency/FrrHis";
const PARITY_ENDPOINT = "https://www.chinamoney.com.cn/ags/ms/cm-u-bk-ccpr/CcprHisNew";
const RMB_INDEX_ENDPOINT = "https://www.chinamoney.com.cn/ags/ms/cm-u-bk-fx/RmbIdxHis";
export type CfetsTable = "yields" | "shibor" | "repo_fixing" | "central_parity" | "rmb_index";
export type CfetsMeasure = "month_end" | "month_average";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const PAUSE_MS = 800;
const BOND_TYPE = "CYCC000"; // 中债国债收益率曲线

export interface CfetsIndicator {
  kind: "cfets";
  group: string;
  title: string;
  agency: string;
  frequency: string;
  unit: string;
  home?: boolean;
  ended?: string;
  endedNote?: string;
  /** Which publication: the closing yield curve (default), SHIBOR, or the repo fixing rates. */
  table?: CfetsTable;
  /** The last fixing of the month (default) or the month's average of daily fixings. */
  measure?: CfetsMeasure;
  /** Tenors as the endpoint writes them: "1.0", "10.0" for yields; "ON", "1W", "3M" for SHIBOR; "FR007", "FDR007" for fixings; "USD/CNY" for parity; "CFETS", "BIS", "SDR" for the index. */
  tenors: { term: string; label: string }[];
}

export interface YieldRecord { date: string; term: string; yield: number }

/** The records of one response: date, tenor and closing yield to maturity. */
export function parseYieldRecords(raw: unknown): YieldRecord[] {
  const records = typeof raw === "object" && raw !== null ? Reflect.get(raw, "records") : undefined;
  if (!Array.isArray(records)) return [];
  const out: YieldRecord[] = [];
  for (const record of records) {
    if (typeof record !== "object" || record === null) continue;
    const date = Reflect.get(record, "newDateValueCN");
    const term = Reflect.get(record, "yearTermStr");
    const value = Number(Reflect.get(record, "maturityYieldStr"));
    if (typeof date !== "string" || typeof term !== "string" || !Number.isFinite(value)) continue;
    out.push({ date, term, yield: value });
  }
  return out;
}

const SHIBOR_TERMS = ["ON", "1W", "2W", "1M", "3M", "6M", "9M", "1Y"];

/** The records of a SHIBOR history response: one row per trading day with a column per tenor. */
export function parseShiborRecords(raw: unknown): YieldRecord[] {
  const records = typeof raw === "object" && raw !== null ? Reflect.get(raw, "records") : undefined;
  if (!Array.isArray(records)) return [];
  const out: YieldRecord[] = [];
  for (const record of records) {
    if (typeof record !== "object" || record === null) continue;
    const date = Reflect.get(record, "showDateCN");
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    for (const term of SHIBOR_TERMS) {
      const value = Number(Reflect.get(record, term));
      if (Number.isFinite(value) && String(Reflect.get(record, term) ?? "").trim() !== "") out.push({ date, term, yield: value });
    }
  }
  return out;
}

/** The records of a repo fixing history response: one row per trading day with the six fixings in a map. */
export function parseFixingRecords(raw: unknown): YieldRecord[] {
  const records = typeof raw === "object" && raw !== null ? Reflect.get(raw, "records") : undefined;
  if (!Array.isArray(records)) return [];
  const out: YieldRecord[] = [];
  for (const record of records) {
    if (typeof record !== "object" || record === null) continue;
    const map = Reflect.get(record, "frValueMap");
    if (typeof map !== "object" || map === null) continue;
    const date = Reflect.get(map, "date");
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    for (const [term, raw] of Object.entries(map as Record<string, unknown>)) {
      if (term === "date") continue;
      const value = Number(raw);
      if (Number.isFinite(value) && String(raw ?? "").trim() !== "") out.push({ date, term, yield: value });
    }
  }
  return out;
}

/** The records of a central parity response: one row per trading day with a value per currency pair, in the order the response lists them. */
export function parseParityRecords(raw: unknown): YieldRecord[] {
  if (typeof raw !== "object" || raw === null) return [];
  const records = Reflect.get(raw, "records");
  const data = Reflect.get(raw, "data");
  const pairs = typeof data === "object" && data !== null ? Reflect.get(data, "searchlist") : undefined;
  if (!Array.isArray(records) || !Array.isArray(pairs)) return [];
  const out: YieldRecord[] = [];
  for (const record of records) {
    if (typeof record !== "object" || record === null) continue;
    const date = Reflect.get(record, "date");
    const values = Reflect.get(record, "values");
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(values)) continue;
    pairs.forEach((pair, index) => {
      const value = Number(values[index]);
      if (typeof pair === "string" && Number.isFinite(value) && String(values[index] ?? "").trim() !== "") out.push({ date, term: pair, yield: value });
    });
  }
  return out;
}

const INDEX_FIELDS: Record<string, string> = { CFETS: "cfetsIndexRateStr", BIS: "bisIndexRateStr", SDR: "sdrIndexRateStr" };

/** The records of an RMB index response: one row per weekly fixing with the three basket indices. */
export function parseRmbIndexRecords(raw: unknown): YieldRecord[] {
  const records = typeof raw === "object" && raw !== null ? Reflect.get(raw, "records") : undefined;
  if (!Array.isArray(records)) return [];
  const out: YieldRecord[] = [];
  for (const record of records) {
    if (typeof record !== "object" || record === null) continue;
    const date = Reflect.get(record, "showDate");
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    for (const [term, field] of Object.entries(INDEX_FIELDS)) {
      const value = Number(Reflect.get(record, field));
      if (Number.isFinite(value) && String(Reflect.get(record, field) ?? "").trim() !== "") out.push({ date, term, yield: value });
    }
  }
  return out;
}

/** The average of a tenor's daily fixings in each month, to four decimals. */
export function monthAverages(records: YieldRecord[], term: string): SeriesPoint[] {
  const byMonth = new Map<string, number[]>();
  for (const record of records) {
    if (record.term !== term) continue;
    const month = record.date.slice(0, 7);
    byMonth.set(month, [...(byMonth.get(month) ?? []), record.yield]);
  }
  return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, values]) => ({ date: month, value: Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 10_000) / 10_000 }));
}

/**
 * The last trading day of each month for one tenor, as monthly points.
 * A month with no trading days for the tenor yields no point.
 */
export function monthEnds(records: YieldRecord[], term: string): SeriesPoint[] {
  const lastByMonth = new Map<string, YieldRecord>();
  for (const record of records) {
    if (record.term !== term) continue;
    const month = record.date.slice(0, 7);
    const held = lastByMonth.get(month);
    if (!held || record.date > held.date) lastByMonth.set(month, record);
  }
  return [...lastByMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, record]) => ({ date: month, value: record.yield }));
}

/** The endpoint, its extra form fields, its parser and the page it belongs to, per table. */
const TABLES: Record<CfetsTable, { endpoint: string; fields: Record<string, string>; parse: (raw: unknown) => YieldRecord[]; page: string }> = {
  yields: { endpoint: ENDPOINT, fields: { reference: "1", bondType: BOND_TYPE }, parse: parseYieldRecords, page: `https://www.chinamoney.com.cn/chinese/bkcurvclosedyhis/?bondType=${BOND_TYPE}&reference=1` },
  shibor: { endpoint: SHIBOR_ENDPOINT, fields: {}, parse: parseShiborRecords, page: "https://www.chinamoney.com.cn/chinese/bkshibor/" },
  repo_fixing: { endpoint: FIXING_ENDPOINT, fields: {}, parse: parseFixingRecords, page: "https://www.chinamoney.com.cn/chinese/bkfrr/" },
  central_parity: { endpoint: PARITY_ENDPOINT, fields: {}, parse: parseParityRecords, page: "https://www.chinamoney.com.cn/chinese/bkccpr/" },
  rmb_index: { endpoint: RMB_INDEX_ENDPOINT, fields: {}, parse: parseRmbIndexRecords, page: "https://www.chinamoney.com.cn/chinese/bkrmbidx/" },
};

export type CfetsPost = (endpoint: string, body: URLSearchParams) => Promise<unknown>;

async function post(endpoint: string, body: URLSearchParams): Promise<unknown> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "User-Agent": USER_AGENT, Referer: "https://www.chinamoney.com.cn/", "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`CFETS -> HTTP ${response.status}`);
  const text = await response.text();
  if (!text.trimStart().startsWith("{")) throw new Error("CFETS answered with its challenge page rather than JSON");
  return JSON.parse(text);
}

async function fetchMonth(table: CfetsTable, year: number, month: number, send: CfetsPost, tenors: string[] = []): Promise<YieldRecord[]> {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;
  // The parity endpoint answers only the currency pairs asked for.
  const currency: Record<string, string> = table === "central_parity" ? { currency: tenors.join(",") } : {};
  const body = new URLSearchParams({ lang: "CN", ...TABLES[table].fields, ...currency, startDate: start, endDate: end, pageNum: "1", pageSize: "1000" });
  return TABLES[table].parse(await send(TABLES[table].endpoint, body));
}

/**
 * The month-end close of each configured tenor over the last `limit` months.
 * One request per month, paced; the current month is included so the latest
 * close is served before the month is over, labelled with that month.
 */
export async function fetchCfets(key: string, cfg: CfetsIndicator, limit: number, send: CfetsPost = post, options: { since?: string | null } = {}): Promise<SeriesResult> {
  const table = cfg.table ?? "yields";
  const now = new Date();
  // A refresh of a stored series re-reads from the last stored month (its own
  // late days and any revision) rather than the whole history: three requests
  // a day per key instead of two hundred and forty.
  const sinceMonth = options.since?.match(/^(\d{4})-(\d{2})/);
  const monthsSince = sinceMonth ? (now.getUTCFullYear() - Number(sinceMonth[1])) * 12 + (now.getUTCMonth() + 1 - Number(sinceMonth[2])) + 1 : Number.POSITIVE_INFINITY;
  const months = Math.max(1, Math.min(limit, 240, monthsSince));
  const records: YieldRecord[] = [];
  for (let back = months - 1; back >= 0; back -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    records.push(...await fetchMonth(table, date.getUTCFullYear(), date.getUTCMonth() + 1, send, cfg.tenors.map((tenor) => tenor.term)));
    if (back > 0 && send === post) await Bun.sleep(PAUSE_MS);
  }
  const reduce = cfg.measure === "month_average" ? monthAverages : monthEnds;
  return {
    key, title: cfg.title, agency: cfg.agency, sourceUrl: TABLES[table].page,
    frequency: cfg.frequency, unit: cfg.unit,
    series: cfg.tenors.map((tenor) => ({ label: tenor.label, points: reduce(records, tenor.term) })),
  };
}
