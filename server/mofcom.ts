/**
 * Foreign direct investment from the Ministry of Commerce, by two paths.
 *
 * The ministry's data centre (data.mofcom.gov.cn, 利用外资 > 吸收外商直接投资
 * 月报) answers a POST with every month since January 2008: the number of
 * newly established foreign-invested enterprises for the year to date with
 * its growth, and the month's actual use of foreign investment in US dollars
 * — which the ministry stopped publishing after July 2023, when it moved the
 * headline to renminbi. Since then the renminbi figure lives only in the
 * monthly news release "N年1-M月全国吸收外资X亿元人民币" on the ministry's
 * site, whose news list renders from a CMS API (jpaas-publish-server) that
 * returns twenty items of HTML per page.
 *
 * Both paths carry the enterprise count, so the two are held against each
 * other by the concordance audit. Every figure but the old USD amount is
 * cumulative for the year, and the series say so.
 */

import type { SeriesPoint, SeriesResult } from "./data";
import { upstreamFetch } from "./upstream";

const DATA_CENTRE = "https://data.mofcom.gov.cn/datamofcom/front/lywz/direct/query";
const SITE = "https://www.mofcom.gov.cn";
const LIST_API = `${SITE}/api-gateway/jpaas-publish-server/front/page/build/unit`;
/** The 日常新闻发布 column's unit, as its page names it. */
const LIST_UNIT = { parseType: "bulidstatic", webId: "8f43c7ad3afc411fb56f281724b73708", tplSetId: "52551ea0e2c14bca8c84792f7aa37ead", pageType: "column", tagId: "分页列表", editType: "null", pageId: "95d89972d8aa4fcea511701cd0f212d9" };
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const PAUSE_MS = 800;
const MAX_LIST_PAGES = 60;

export interface MofcomIndicator {
  kind: "mofcom";
  group: string;
  title: string;
  agency: string;
  frequency: string;
  unit: string;
  home?: boolean;
  ended?: string;
  endedNote?: string;
  /** Which figures the key serves. */
  measure: "enterprises" | "usd" | "cny" | "growth";
  /** Day of the month by which the publisher's release is normally out (server/due.ts). */
  releaseDay?: number;
}

export interface DataCentreRow { period: string; enterprises: number | null; enterprisesGrowth: number | null; usd: number | null; usdGrowth: number | null }

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value === "—" || value.trim() === "") return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

/** The data centre's rows, oldest first. Its answer is a list whose first member is the list of rows. */
export function parseDataCentre(raw: unknown): DataCentreRow[] {
  const outer = Array.isArray(raw) ? raw : [];
  const rows = Array.isArray(outer[0]) ? outer[0] : outer;
  const out: DataCentreRow[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const when = String(Reflect.get(row, "data_time") ?? "");
    const match = when.match(/^(\d{4})(\d{2})$/);
    if (!match) continue;
    out.push({
      period: `${match[1]}-${match[2]}`,
      enterprises: num(Reflect.get(row, "project_number")), enterprisesGrowth: num(Reflect.get(row, "project_per")),
      usd: num(Reflect.get(row, "actual_amount")), usdGrowth: num(Reflect.get(row, "actual_amount_per")),
    });
  }
  return out.sort((a, b) => a.period.localeCompare(b.period));
}

export interface FdiRelease { title: string; url: string; period: string }

/** "2026年1-7月全国吸收外资4383.3亿元人民币" -> 2026-07; "2025年全国吸收外资…" -> 2025-12. */
export function periodOfTitle(title: string): string | null {
  const year = title.match(/(\d{4})年/)?.[1];
  if (!year || !/全国吸收外资/.test(title)) return null;
  const range = title.match(/年\s*1\s*[-－~～至]\s*(\d{1,2})\s*月/);
  if (range?.[1]) return `${year}-${range[1].padStart(2, "0")}`;
  if (/上半年/.test(title)) return `${year}-06`;
  if (/一季度/.test(title)) return `${year}-03`;
  if (/^\d{4}年全国吸收外资/.test(title.trim())) return `${year}-12`;
  return null;
}

/** The FDI releases on one page of the news list (the API's HTML, or the JSON that wraps it). */
export function parseNewsList(text: string): FdiRelease[] {
  let html = text;
  try { const body: unknown = JSON.parse(text); const inner = typeof body === "object" && body !== null ? Reflect.get(Reflect.get(body, "data") ?? {}, "html") : undefined; if (typeof inner === "string") html = inner; } catch { /* plain HTML */ }
  const out: FdiRelease[] = [];
  for (const match of html.matchAll(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/g)) {
    const title = (match[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const period = periodOfTitle(title);
    if (!period) continue;
    out.push({ title, url: new URL(match[1] ?? "", SITE).toString(), period });
  }
  return out;
}

export interface FdiFigures { enterprises: number | null; enterprisesGrowth: number | null; cny: number | null; cnyGrowth: number | null; manufacturing: number | null; services: number | null; highTech: number | null; highTechGrowth: number | null }

function growthAfter(text: string, at: number): number | null {
  const match = text.slice(at, at + 30).match(/同比(增长|下降)([\d.]+)%/);
  return match ? (match[1] === "增长" ? Number(match[2]) : -Number(match[2])) : null;
}

/** The figures of one release: the year-to-date count and renminbi amounts with their growth. */
export function parseFdiRelease(html: string): FdiFigures | null {
  const text = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, "");
  const grab = (pattern: RegExp): { value: number | null; growth: number | null } => {
    const match = pattern.exec(text);
    if (!match || match.index === undefined) return { value: null, growth: null };
    return { value: num(match[1]), growth: growthAfter(text, match.index + match[0].length) };
  };
  const enterprises = grab(/新设立外商投资企业([\d.]+)家/);
  const cny = grab(/实际使用外资金额([\d.]+)亿元人民币/);
  if (enterprises.value === null && cny.value === null) return null;
  const manufacturing = grab(/制造业实际使用外资([\d.]+)亿元/), services = grab(/服务业实际使用外资([\d.]+)亿元/), highTech = grab(/高技术产业实际使用外资([\d.]+)亿元/);
  return { enterprises: enterprises.value, enterprisesGrowth: enterprises.growth, cny: cny.value, cnyGrowth: cny.growth, manufacturing: manufacturing.value, services: services.value, highTech: highTech.value, highTechGrowth: highTech.growth };
}

async function post(url: string, body: string): Promise<string> {
  const response = await upstreamFetch(url, { method: "POST", headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded", Referer: "https://data.mofcom.gov.cn/lywz/inmr.shtml" }, body, timeoutMs: 30_000 });
  if (!response.ok) throw new Error(`MOFCOM data centre -> HTTP ${response.status}`);
  return response.text();
}

async function get(url: string): Promise<string> {
  const response = await upstreamFetch(url, { headers: { "User-Agent": USER_AGENT, Referer: `${SITE}/xwfb/rcxwfb/index.html` }, timeoutMs: 30_000, redirect: "follow" });
  if (!response.ok) throw new Error(`MOFCOM -> HTTP ${response.status}`);
  return response.text();
}

export interface MofcomReaders { dataCentre: (body: string) => Promise<string>; page: (url: string) => Promise<string> }
const live: MofcomReaders = { dataCentre: (body) => post(DATA_CENTRE, body), page: get };

export function listPageUrl(pageNo: number): string {
  return `${LIST_API}?${new URLSearchParams({ ...LIST_UNIT, paramJson: JSON.stringify({ pageNo, pageSize: 20 }) }).toString()}`;
}

/** Parsed releases by URL: a release never changes, so a process reads each once. */
const parsed = new Map<string, FdiFigures | null>();

/** Labels per measure, in order. */
export function mofcomLabels(cfg: MofcomIndicator): string[] {
  switch (cfg.measure) {
    case "enterprises": return ["New foreign-invested enterprises, year to date", "New foreign-invested enterprises, year to date (ministry release)"];
    case "usd": return ["Actual use of foreign investment, month (USD)"];
    case "cny": return ["Actual use of foreign investment, year to date", "Manufacturing, year to date", "Services, year to date", "High-technology industries, year to date"];
    case "growth": return ["Actual use of foreign investment, year to date (YoY %)", "High-technology industries, year to date (YoY %)", "New foreign-invested enterprises, year to date (YoY %)"];
  }
}

/**
 * The series of one key. The data centre is one request; the renminbi
 * releases are found by walking the news list, twenty items a page, until
 * `limit` releases are in hand or the list is exhausted.
 */
export async function fetchMofcom(key: string, cfg: MofcomIndicator, limit: number, readers: MofcomReaders = live): Promise<SeriesResult> {
  const pause = readers === live ? PAUSE_MS : 0;
  const lines = new Map<string, Map<string, number>>();
  const put = (label: string, period: string, value: number | null) => {
    if (value === null) return;
    const line = lines.get(label) ?? new Map<string, number>();
    if (!line.has(period)) line.set(period, value);
    lines.set(label, line);
  };
  if (cfg.measure === "enterprises" || cfg.measure === "usd" || cfg.measure === "growth") {
    const rows = parseDataCentre(JSON.parse(await readers.dataCentre("startDate=2008-01&endDate=2099-12")));
    for (const row of rows) {
      if (cfg.measure === "enterprises") put("New foreign-invested enterprises, year to date", row.period, row.enterprises);
      if (cfg.measure === "usd") put("Actual use of foreign investment, month (USD)", row.period, row.usd);
      if (cfg.measure === "growth") put("New foreign-invested enterprises, year to date (YoY %)", row.period, row.enterprisesGrowth);
    }
  }
  if (cfg.measure !== "usd") {
    const releases: FdiRelease[] = [];
    for (let pageNo = 1; pageNo <= MAX_LIST_PAGES && releases.length < limit; pageNo += 1) {
      if (pageNo > 1 && pause > 0) await Bun.sleep(pause);
      const found = parseNewsList(await readers.page(listPageUrl(pageNo)));
      releases.push(...found);
      if (pageNo > 3 && found.length === 0 && releases.length === 0) break;
    }
    let fetched = 0;
    for (const release of releases.slice(0, limit)) {
      let figures = parsed.get(release.url);
      if (figures === undefined) {
        if (fetched > 0 && pause > 0) await Bun.sleep(pause);
        fetched += 1;
        figures = parseFdiRelease(await readers.page(release.url));
        parsed.set(release.url, figures);
      }
      if (!figures) continue;
      if (cfg.measure === "enterprises") put("New foreign-invested enterprises, year to date (ministry release)", release.period, figures.enterprises);
      if (cfg.measure === "cny") {
        put("Actual use of foreign investment, year to date", release.period, figures.cny);
        put("Manufacturing, year to date", release.period, figures.manufacturing);
        put("Services, year to date", release.period, figures.services);
        put("High-technology industries, year to date", release.period, figures.highTech);
      }
      if (cfg.measure === "growth") {
        put("Actual use of foreign investment, year to date (YoY %)", release.period, figures.cnyGrowth);
        put("High-technology industries, year to date (YoY %)", release.period, figures.highTechGrowth);
      }
    }
  }
  return {
    key, title: cfg.title, agency: cfg.agency, sourceUrl: cfg.measure === "usd" ? "https://data.mofcom.gov.cn/lywz/inmr.shtml" : `${SITE}/xwfb/rcxwfb/index.html`,
    frequency: cfg.frequency, unit: cfg.unit,
    series: mofcomLabels(cfg).filter((label) => lines.has(label)).map((label) => ({
      label, points: [...(lines.get(label) ?? new Map<string, number>()).entries()].map(([date, value]): SeriesPoint => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date)).slice(-Math.max(1, limit)),
    })),
  };
}
