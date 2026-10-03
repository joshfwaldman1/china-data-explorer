/**
 * Electricity demand from the National Energy Administration.
 *
 * NEA publishes 全社会用电量 (electricity consumption by all users) around
 * the middle of each month for the month before, as a short release in its
 * 新闻发布 feed: the month's total in 亿千瓦时 with its growth on a year
 * earlier, the split by primary, secondary and tertiary industry and
 * households, and then the same for the year to date. January and February
 * are published together in March, and a year's total in January.
 *
 * The site is a Xinhua CMS: a listing page renders from a JSON datasource
 * next to it (xwfb/ds_<id>.json, every item since 2020), and each release
 * is a plain page with the text in its article body. Two shapes of page
 * exist — the 2025+ pages hold the text in #detailContent, the older ones in
 * a table inside .article-content — and the text reads the same in both, so
 * the parser works on the page's text rather than its markup.
 *
 * The month series carries no January or February point: the release gives
 * only the combined two months, and that belongs to the year-to-date line.
 */

import type { SeriesPoint, SeriesResult } from "./data";
import { upstreamFetch } from "./upstream";
import { ReleaseCache } from "./release-cache";

const SITE = "https://www.nea.gov.cn";
/** The 新闻发布 category's datasource, as the listing page names it. */
const FEED = `${SITE}/xwfb/ds_4f3484af7ea244e7ab18d094856c82a6.json`;
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const PAUSE_MS = 800;

export interface NeaIndicator {
  kind: "nea";
  group: string;
  title: string;
  agency: string;
  frequency: string;
  unit: string;
  home?: boolean;
  ended?: string;
  endedNote?: string;
  /** Which figures of the release this key serves: the levels in 亿千瓦时, or the published growth rates. */
  measure: "level" | "growth";
  /** Day of the month by which the publisher's release is normally out (server/due.ts). */
  releaseDay?: number;
}

export interface NeaRelease { title: string; url: string; publishedAt: string }

/** One release's figures. Levels in 亿千瓦时, growth in percent on a year earlier. */
export interface NeaFigures {
  /** The month reported, "YYYY-MM"; for a January-February or annual release, the last month covered. */
  period: string;
  /** The single month's figures; absent for January-February and annual releases. */
  month?: NeaBreakdown;
  /** The year-to-date figures, through `period`. */
  yearToDate?: NeaBreakdown;
}

export interface NeaBreakdown {
  total: number; totalGrowth: number | null;
  primary: number | null; primaryGrowth: number | null;
  secondary: number | null; secondaryGrowth: number | null;
  tertiary: number | null; tertiaryGrowth: number | null;
  households: number | null; householdsGrowth: number | null;
}

function pageText(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&emsp;/g, " ").replace(/\s+/g, " ").trim();
}

/** "同比增长4.7%" -> 4.7, "同比下降2.0%" -> -2.0, nothing -> null. */
function growthAfter(text: string, at: number): number | null {
  const match = text.slice(at, at + 40).match(/同比(增长|下降|减少)\s*([\d.]+)\s*%/);
  if (!match) return null;
  const value = Number(match[2]);
  return match[1] === "增长" ? value : -value;
}

/** The level and growth of one item ("第一产业用电量167亿千瓦时，同比下降2.0%") within a paragraph. */
function itemOf(paragraph: string, name: string): { level: number | null; growth: number | null } {
  const match = new RegExp(`${name}用电量\\s*([\\d,]+(?:\\.\\d+)?)\\s*亿千瓦时`).exec(paragraph);
  if (!match || match.index === undefined) return { level: null, growth: null };
  return { level: Number((match[1] ?? "").replace(/,/g, "")), growth: growthAfter(paragraph, match.index + match[0].length) };
}

function breakdown(paragraph: string, totalMatch: RegExpExecArray): NeaBreakdown {
  const primary = itemOf(paragraph, "第一产业"), secondary = itemOf(paragraph, "第二产业"), tertiary = itemOf(paragraph, "第三产业"), households = itemOf(paragraph, "城乡居民生活");
  return {
    total: Number((totalMatch[1] ?? "").replace(/,/g, "")), totalGrowth: growthAfter(paragraph, (totalMatch.index ?? 0) + totalMatch[0].length),
    primary: primary.level, primaryGrowth: primary.growth,
    secondary: secondary.level, secondaryGrowth: secondary.growth,
    tertiary: tertiary.level, tertiaryGrowth: tertiary.growth,
    households: households.level, householdsGrowth: households.growth,
  };
}

// "全社会用电量71730亿千瓦时", "全社会用电量累计71730亿千瓦时", and the August 2026
// phrasing "全社会用电量再破万亿，达到10332亿千瓦时", where a clause sits between the
// subject and its figure. The clause may not contain a full stop or another figure.
const TOTAL = /全社会用电量\s*(?:累计)?\s*(?:[^。\d]{0,12}?达到\s*)?([\d,]+(?:\.\d+)?)\s*亿千瓦时/g;

/** The dashes a range is written with: hyphen, tilde, en dash, em dash, full-width dash, or 至. */
const RANGE_DASH = "[-~～–—－至]";

/**
 * The figures of one release page. `publishedAt` ("YYYY-MM-DD") gives the
 * year when the title does not carry one: a "12月份" release appears in January.
 */
export function parseNeaRelease(html: string, publishedAt: string): NeaFigures | null {
  const text = pageText(html);
  const publishYear = Number(publishedAt.slice(0, 4)), publishMonth = Number(publishedAt.slice(5, 7));
  const yearOf = (month: number) => (month > publishMonth ? publishYear - 1 : publishYear);
  let result: NeaFigures | null = null;
  // Every "全社会用电量 N亿千瓦时" figure, each read with the sentence that introduces it.
  for (const match of text.matchAll(TOTAL)) {
    const at = match.index ?? 0;
    // The sentence the figure sits in, from the previous full stop. The period marker
    // is a clause of that sentence: "7月份，全社会用电量…" usually, but February 2022
    // reads "2月份，我国经济持续稳定恢复，全社会用电量持续增长，达到6235亿千瓦时", and a
    // lead of the two dozen characters before the subject held no month at all, so
    // the release gave only its year to date and the month line kept an old misread.
    const lead = text.slice(Math.max(0, at - 80, text.lastIndexOf("。", at) + 1), at);
    const paragraph = text.slice(at, text.indexOf("。", at + 600) > 0 ? Math.min(at + 700, text.length) : text.length);
    const exec = TOTAL.exec.bind(new RegExp(TOTAL.source))(text.slice(at));
    if (!exec) continue;
    const figures = breakdown(paragraph, exec);
    // The marker nearest the subject wins: "3月15日，…发布…2月份，" names February.
    const singles = [...lead.matchAll(new RegExp(`(?:^|[^\\d${RANGE_DASH.slice(1, -1)}])(\\d{1,2})\\s*月份?\\s*，`, "g"))];
    const single = singles.at(-1);
    const range = [...lead.matchAll(new RegExp(`(\\d{1,2})\\s*${RANGE_DASH}\\s*(\\d{1,2})\\s*月份?\\s*，`, "g"))].at(-1);
    const annual = [...lead.matchAll(/(\d{4})\s*年\s*，/g)].at(-1);
    if (single?.[1] && !range) {
      const month = Number(single[1]);
      result = { ...(result ?? { period: "" }), period: `${yearOf(month)}-${String(month).padStart(2, "0")}`, month: figures };
    } else if (range?.[2]) {
      const month = Number(range[2]);
      result = { ...(result ?? { period: "" }), period: `${yearOf(month)}-${String(month).padStart(2, "0")}`, yearToDate: figures };
    } else if (annual?.[1]) {
      result = { ...(result ?? { period: "" }), period: `${annual[1]}-12`, yearToDate: figures };
    }
  }
  // A month is part of its year to date, never equal to it. When both are read and they
  // match, the release was misread rather than the country having used no power since January.
  if (result?.month && result.yearToDate && result.month.total !== undefined && result.month.total === result.yearToDate.total && !result.period.endsWith("-01")) {
    throw new Error(`NEA release for ${result.period}: the month and the year to date are both ${result.month.total} 亿千瓦时`);
  }
  return result && result.period ? result : null;
}

/**
 * The demand releases in the 新闻发布 feed, newest first: the "全社会用电量同比"
 * notes, not the fuller 电力工业统计数据 releases that follow them.
 */
export function demandReleases(feed: unknown): NeaRelease[] {
  const list = typeof feed === "object" && feed !== null ? Reflect.get(feed, "datasource") : undefined;
  if (!Array.isArray(list)) return [];
  const out: NeaRelease[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const rawTitle = Reflect.get(item, "showTitle"), url = Reflect.get(item, "publishUrl"), when = Reflect.get(item, "publishTime");
    if (typeof rawTitle !== "string" || typeof url !== "string" || typeof when !== "string") continue;
    const title = pageText(rawTitle);
    if (!/全社会用电量/.test(title) || /算力|：/.test(title)) continue;
    out.push({ title, url: url.startsWith("http") ? url : new URL(url.replace(/^\.\.\//, "/"), SITE).toString(), publishedAt: when.slice(0, 10) });
  }
  return out.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

async function get(url: string): Promise<string> {
  const response = await upstreamFetch(url, { headers: { "User-Agent": USER_AGENT }, timeoutMs: 30_000, redirect: "follow" });
  if (!response.ok) throw new Error(`NEA -> HTTP ${response.status}`);
  return response.text();
}

/** Revisit the same URL periodically in case the publisher corrects it. */
const parsed = new ReleaseCache<NeaFigures | null>();

// The central feed omits this release; NEA's Northwest office republishes it.
// Keep the source URL here, and read the figures from the publisher each time.
const SUPPLEMENTAL_RELEASES = [{
  title: "2026年5月份全社会用电量同比增长6.9%", period: "2026-05", publishedAt: "2026-06-26",
  url: "https://xbj.nea.gov.cn/dtyw/hyxx/202606/t20260626_303637.html",
}];

/**
 * The series of one key over the newest `limit` releases: the levels or the
 * growth rates, month and year to date, total and by user group.
 */
export async function fetchNea(key: string, cfg: NeaIndicator, limit: number, read: (url: string) => Promise<string> = get): Promise<SeriesResult> {
  const releases = demandReleases(JSON.parse(await read(FEED))).slice(0, Math.max(1, limit));
  const supplements = SUPPLEMENTAL_RELEASES.filter(release => releases.length > 0 && release.publishedAt >= releases.at(-1)!.publishedAt);
  const figures: NeaFigures[] = [];
  const pause = read === get ? PAUSE_MS : 0; // pacing is for the site, not for a test's fixtures
  let fetched = 0;
  for (const release of [...releases, ...supplements]) {
    if ("period" in release && figures.some(item => item.period === release.period)) continue;
    let item = read === get ? parsed.get(release.url) : undefined;
    if (item === undefined) {
      if (fetched > 0 && pause > 0) await Bun.sleep(pause);
      fetched += 1;
      item = parseNeaRelease(await read(release.url), release.publishedAt);
      if (read === get) parsed.set(release.url, item);
    }
    if (item) figures.push(item);
  }
  const lines: Record<string, SeriesPoint[]> = {};
  const push = (label: string, date: string, value: number | null) => { if (value !== null && Number.isFinite(value)) (lines[label] ??= []).push({ date, value }); };
  const level = cfg.measure === "level";
  for (const item of figures) {
    if (item.month) {
      push(level ? "All users, month" : "All users, month (YoY %)", item.period, level ? item.month.total : item.month.totalGrowth);
      push(level ? "Primary industry, month" : "Primary industry, month (YoY %)", item.period, level ? item.month.primary : item.month.primaryGrowth);
      push(level ? "Secondary industry, month" : "Secondary industry, month (YoY %)", item.period, level ? item.month.secondary : item.month.secondaryGrowth);
      push(level ? "Tertiary industry, month" : "Tertiary industry, month (YoY %)", item.period, level ? item.month.tertiary : item.month.tertiaryGrowth);
      push(level ? "Households, month" : "Households, month (YoY %)", item.period, level ? item.month.households : item.month.householdsGrowth);
    }
    if (item.yearToDate) push(level ? "All users, year to date" : "All users, year to date (YoY %)", item.period, level ? item.yearToDate.total : item.yearToDate.totalGrowth);
  }
  const order = level
    ? ["All users, month", "All users, year to date", "Primary industry, month", "Secondary industry, month", "Tertiary industry, month", "Households, month"]
    : ["All users, month (YoY %)", "All users, year to date (YoY %)", "Primary industry, month (YoY %)", "Secondary industry, month (YoY %)", "Tertiary industry, month (YoY %)", "Households, month (YoY %)"];
  return {
    key, title: cfg.title, agency: cfg.agency, sourceUrl: `${SITE}/xwfb/index.htm`,
    frequency: cfg.frequency, unit: cfg.unit,
    series: order.filter((label) => lines[label]).map((label) => ({ label, points: [...new Map((lines[label] ?? []).map((point) => [point.date, point])).values()].sort((a, b) => a.date.localeCompare(b.date)) })),
  };
}

/** The labels a key serves, for the store's configured-line filter. */
export function neaLabels(cfg: NeaIndicator): string[] {
  return cfg.measure === "level"
    ? ["All users, month", "All users, year to date", "Primary industry, month", "Secondary industry, month", "Tertiary industry, month", "Households, month"]
    : ["All users, month (YoY %)", "All users, year to date (YoY %)", "Primary industry, month (YoY %)", "Secondary industry, month (YoY %)", "Tertiary industry, month (YoY %)", "Households, month (YoY %)"];
}
