/**
 * Fiscal revenue and expenditure from the Ministry of Finance.
 *
 * The ministry's treasury department (国库司) publishes 财政收支情况 monthly,
 * around the 15th to the 25th, as a text release: the year-to-date general
 * public budget revenue (with tax and non-tax revenue), expenditure, the
 * government fund budget (with land sale revenue) and their growth on a year
 * earlier. Every figure is cumulative for the year — "1-7月" is January to
 * July — and the series here say so in their titles. The half year, first
 * quarter, three quarters and full year carry their own titles.
 *
 * The site is served through a CDN that answers 502 now and then from
 * abroad and 200 a moment later, so a fetch retries; only http answers (the
 * https host returns 502 every time). The release pages sometimes carry
 * stray spaces inside numbers ("4 .7%", "2 5 880") from the editor, so the
 * text is read with all whitespace removed — Chinese needs none.
 */

import type { SeriesPoint, SeriesResult } from "./data";

const SITE = "http://gks.mof.gov.cn";
const LISTING = `${SITE}/tongjishuju/`;
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const PAUSE_MS = 1000;
const ATTEMPTS = 4;

export interface MofIndicator {
  kind: "mof";
  group: string;
  title: string;
  agency: string;
  frequency: string;
  unit: string;
  home?: boolean;
  ended?: string;
  endedNote?: string;
  /** The levels (亿元, year to date) or the published growth rates. */
  measure: "level" | "growth";
  /** Day of the month by which the publisher's release is normally out (server/due.ts). */
  releaseDay?: number;
  /** The items served, in order. */
  items: MofItem[];
}

export type MofItem = "revenue" | "tax" | "nonTax" | "expenditure" | "fundRevenue" | "landSales" | "fundExpenditure";

/** The phrase that introduces each item in the release, and the site's label for it. */
export const MOF_ITEMS: Record<MofItem, { phrase: string; label: string }> = {
  revenue: { phrase: "全国一般公共预算收入", label: "General public budget revenue, year to date" },
  tax: { phrase: "全国税收收入", label: "Tax revenue, year to date" },
  nonTax: { phrase: "非税收入", label: "Non-tax revenue, year to date" },
  expenditure: { phrase: "全国一般公共预算支出", label: "General public budget expenditure, year to date" },
  fundRevenue: { phrase: "全国政府性基金预算收入", label: "Government fund budget revenue, year to date" },
  landSales: { phrase: "国有土地使用权出让收入", label: "Land sale revenue, year to date" },
  fundExpenditure: { phrase: "全国政府性基金预算支出", label: "Government fund budget expenditure, year to date" },
};

export interface MofRelease { title: string; url: string; publishedAt: string; period: string }

/** "2026年1-7月" -> 2026-07; 上半年 -> 06; 一季度 -> 03; 前三季度 -> 09; "2025年财政收支情况" -> 2025-12. */
export function periodOfTitle(title: string): string | null {
  const year = title.match(/(\d{4})年/)?.[1];
  if (!year) return null;
  const range = title.match(/年\s*1\s*[-－~～至]\s*(\d{1,2})\s*月/);
  if (range?.[1]) return `${year}-${range[1].padStart(2, "0")}`;
  if (/上半年/.test(title)) return `${year}-06`;
  if (/前三季度/.test(title)) return `${year}-09`;
  if (/一季度/.test(title)) return `${year}-03`;
  if (/^\d{4}年财政收支情况/.test(title.trim())) return `${year}-12`;
  return null;
}

/** The 财政收支情况 releases on one listing page, in page order (newest first). */
export function parseListing(html: string, base = LISTING): MofRelease[] {
  const out: MofRelease[] = [];
  for (const match of html.matchAll(/<a[^>]*href=["']([^"']+)["'][^>]*title=["']([^"']*财政收支情况)["'][^>]*>[\s\S]*?<\/a>\s*(?:<span[^>]*>\s*([\d-]+)\s*<\/span>)?/g)) {
    const title = match[2] ?? "";
    const period = periodOfTitle(title);
    if (!period) continue;
    out.push({ title, url: new URL(match[1] ?? "", base).toString(), publishedAt: match[3] ?? "", period });
  }
  return out;
}

export interface MofFigures { level: Partial<Record<MofItem, number>>; growth: Partial<Record<MofItem, number>> }

/** The figures of one release: each item's year-to-date level in 亿元 and growth on a year earlier. */
export function parseFiscalRelease(html: string): MofFigures | null {
  const text = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/\s+/g, "");
  const figures: MofFigures = { level: {}, growth: {} };
  for (const [item, { phrase }] of Object.entries(MOF_ITEMS) as [MofItem, { phrase: string }][]) {
    const match = new RegExp(`${phrase}([\\d.]+)亿元[，,]?(?:(?:同比|比上年)(增长|下降)([\\d.]+)%)?`).exec(text);
    if (!match) continue;
    const level = Number(match[1]);
    if (!Number.isFinite(level)) continue;
    figures.level[item] = level;
    if (match[2] && match[3]) figures.growth[item] = match[2] === "增长" ? Number(match[3]) : -Number(match[3]);
  }
  return figures.level.revenue !== undefined ? figures : null;
}

async function get(url: string): Promise<string> {
  let last = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(30_000), redirect: "follow" });
    if (response.ok) return response.text();
    last = `MOF -> HTTP ${response.status}`;
    if (response.status < 500 && response.status !== 429) break;
    await Bun.sleep(2000 * attempt);
  }
  throw new Error(last || "MOF -> no answer");
}

/** Parsed releases by URL: a release never changes, so a process reads each once. */
const parsed = new Map<string, MofFigures | null>();

/**
 * The series of one key over the newest `limit` releases. Listing pages are
 * read in order (index.htm, index_1.htm, …) until enough releases are found
 * or a page carries none.
 */
export async function fetchMof(key: string, cfg: MofIndicator, limit: number, read: (url: string) => Promise<string> = get): Promise<SeriesResult> {
  const pause = read === get ? PAUSE_MS : 0;
  const releases: MofRelease[] = [];
  for (let page = 0; page < 12 && releases.length < limit; page += 1) {
    const url = `${LISTING}${page === 0 ? "index.htm" : `index_${page}.htm`}`;
    if (page > 0 && pause > 0) await Bun.sleep(pause);
    const found = parseListing(await read(url), LISTING);
    if (found.length === 0) break;
    releases.push(...found);
  }
  const lines = new Map<string, Map<string, number>>();
  let fetched = 0;
  for (const release of releases.slice(0, limit)) {
    let figures = parsed.get(release.url);
    if (figures === undefined) {
      if (fetched > 0 && pause > 0) await Bun.sleep(pause);
      fetched += 1;
      figures = parseFiscalRelease(await read(release.url));
      parsed.set(release.url, figures);
    }
    if (!figures) continue;
    for (const item of cfg.items) {
      const value = cfg.measure === "level" ? figures.level[item] : figures.growth[item];
      if (value === undefined) continue;
      const label = MOF_ITEMS[item].label + (cfg.measure === "growth" ? " (YoY %)" : "");
      const line = lines.get(label) ?? new Map<string, number>();
      if (!line.has(release.period)) line.set(release.period, value); // the newest release of a period wins
      lines.set(label, line);
    }
  }
  return {
    key, title: cfg.title, agency: cfg.agency, sourceUrl: LISTING, frequency: cfg.frequency, unit: cfg.unit,
    series: mofLabels(cfg).filter((label) => lines.has(label)).map((label) => ({
      label, points: [...(lines.get(label) ?? new Map<string, number>()).entries()].map(([date, value]): SeriesPoint => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date)),
    })),
  };
}

export function mofLabels(cfg: MofIndicator): string[] {
  return cfg.items.map((item) => MOF_ITEMS[item].label + (cfg.measure === "growth" ? " (YoY %)" : ""));
}
