/**
 * Shanghai Stock Exchange indices, from the exchange's own quote service.
 *
 * sse.com.cn draws its index charts from yunhq.sse.com.cn, the exchange's
 * quote server, which answers a monthly K-line for an index code: one row
 * per month with the open, high, low, close, volume and turnover. That is
 * the exchange publishing its own index, so it is the source here; no
 * mirror, no data vendor. The request needs the site as its referer.
 *
 * The last row is the month in progress and is not a month-end close, so
 * it is dropped: the series says "month end" and means it.
 */

import type { SeriesPoint, SeriesResult } from "./data";
import { fetchJson } from "./http";

export interface SseIndicator {
  kind: "sse";
  group: string;
  title: string;
  agency: string;
  frequency: string;
  unit: string;
  home?: boolean;
  ended?: string;
  endedNote?: string;
  /** The exchange's index code: 000001 the Composite, 000016 the SSE 50, 000688 the STAR 50. */
  code: string;
  /** Day of the month by which the month's close is final: the first, since the month must end. */
  releaseDay?: number;
}

const QUOTE_HOST = "https://yunhq.sse.com.cn:32042";
const SITE = "https://www.sse.com.cn/market/price/indices/";
const HEADERS = { Referer: "https://www.sse.com.cn/", "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" };

/** One row of the exchange's K-line: yyyymmdd, open, high, low, close, volume, turnover. */
export interface KlineRow { date: string; open: number; high: number; low: number; close: number; volume: number; turnover: number }

export const LABELS = { close: "Close, month end", turnover: "Turnover, month (100M yuan)" } as const;

/** The rows of a K-line response, refused if the shape is not the one this was written for. */
export function parseKline(body: unknown): KlineRow[] {
  if (typeof body !== "object" || body === null) throw new Error("SSE quote: not an object");
  const kline = Reflect.get(body, "kline");
  if (!Array.isArray(kline)) throw new Error("SSE quote: no kline array");
  return kline.map((row, index) => {
    if (!Array.isArray(row) || row.length < 7 || row.slice(0, 7).some((cell) => typeof cell !== "number" || !Number.isFinite(cell))) throw new Error(`SSE quote: row ${index} is not seven numbers`);
    const [date, open, high, low, close, volume, turnover] = row as number[];
    const text = String(date);
    if (!/^\d{8}$/.test(text)) throw new Error(`SSE quote: row ${index} date ${text} is not yyyymmdd`);
    return { date: `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`, open: open!, high: high!, low: low!, close: close!, volume: volume!, turnover: turnover! };
  });
}

/**
 * Month-end closes from monthly rows. A row dated in the month that has not
 * ended yet is the running month, not a month end, and is left out; the
 * exchange writes the last trading day so far as its date.
 */
export function monthEnds(rows: KlineRow[], now = new Date()): SeriesPoint[] {
  const running = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return rows
    .map((row) => ({ date: row.date.slice(0, 7), value: row.close }))
    .filter((point) => point.date < running)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Monthly turnover in 100 million yuan from the exchange's yuan figure, same month rule. */
export function monthTurnover(rows: KlineRow[], now = new Date()): SeriesPoint[] {
  const running = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return rows
    .map((row) => ({ date: row.date.slice(0, 7), value: Math.round(row.turnover / 1e8 * 10) / 10 }))
    .filter((point) => point.date < running)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export type SseReader = (url: string) => Promise<unknown>;
const live: SseReader = async (url) => {
  const response = await fetchJson(url, { headers: HEADERS });
  if (!response.ok) throw new Error(`SSE quote: HTTP ${response.status}`);
  return response.json;
};

export function klineUrl(code: string): string {
  return `${QUOTE_HOST}/v1/sh1/dayk/${code}?begin=0&end=-1&period=month`;
}

export async function fetchSse(key: string, cfg: SseIndicator, limit: number, read: SseReader = live): Promise<SeriesResult> {
  const rows = parseKline(await read(klineUrl(cfg.code)));
  const closes = monthEnds(rows);
  const turnover = monthTurnover(rows);
  return {
    key, title: cfg.title, agency: cfg.agency, sourceUrl: SITE,
    frequency: cfg.frequency, unit: cfg.unit,
    series: [
      { label: LABELS.close, points: closes.slice(-limit) },
      { label: LABELS.turnover, points: turnover.slice(-limit) },
    ],
  };
}
