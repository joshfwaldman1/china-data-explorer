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
 */

import type { SeriesPoint, SeriesResult } from "./data";

const ENDPOINT = "https://www.chinamoney.com.cn/ags/ms/cm-u-bk-currency/ClsYldCurvHis";
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
  /** Tenors in years, as the endpoint writes them: "1.0", "10.0". */
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

async function fetchMonth(year: number, month: number): Promise<YieldRecord[]> {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;
  const body = new URLSearchParams({ lang: "CN", reference: "1", bondType: BOND_TYPE, startDate: start, endDate: end, pageNum: "1", pageSize: "1000" });
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "User-Agent": USER_AGENT, Referer: "https://www.chinamoney.com.cn/", "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`CFETS -> HTTP ${response.status}`);
  const text = await response.text();
  if (!text.trimStart().startsWith("{")) throw new Error("CFETS answered with its challenge page rather than JSON");
  return parseYieldRecords(JSON.parse(text));
}

/**
 * The month-end close of each configured tenor over the last `limit` months.
 * One request per month, paced; the current month is included so the latest
 * close is served before the month is over, labelled with that month.
 */
export async function fetchCfets(key: string, cfg: CfetsIndicator, limit: number): Promise<SeriesResult> {
  const months = Math.max(1, Math.min(limit, 240));
  const now = new Date();
  const records: YieldRecord[] = [];
  for (let back = months - 1; back >= 0; back -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    records.push(...await fetchMonth(date.getUTCFullYear(), date.getUTCMonth() + 1));
    if (back > 0) await Bun.sleep(PAUSE_MS);
  }
  return {
    key, title: cfg.title, agency: cfg.agency, sourceUrl: `https://www.chinamoney.com.cn/chinese/bkcurvclosedyhis/?bondType=${BOND_TYPE}&reference=1`,
    frequency: cfg.frequency, unit: cfg.unit,
    series: cfg.tenors.map((tenor) => ({ label: tenor.label, points: monthEnds(records, tenor.term) })),
  };
}
