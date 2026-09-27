/**
 * Customs' release calendar, so the site knows when trade figures are due.
 *
 * The General Administration of Customs publishes a calendar for each year
 * on its English site (Statistics > Release Calendar, ColumnId=4): for every
 * month, the day of the preliminary release (the 7th to the 14th of the
 * following month; January and February together in March), the monthly
 * bulletin (the 18th) and the online query tables (the 20th). The numbered
 * tables this site reads — total values by country and region, major exports
 * and imports — are out with the preliminary release: August 2026's were
 * read on 15 September, before the bulletin.
 *
 * NBS's calendar is served as an agenda of dated items; Customs' months are
 * turned into the same shape so the release plan schedules a refresh ten
 * minutes after the preliminary release and a series page can say when the
 * next one is. The calendar for a year appears on the English site some
 * weeks into the year (2025's on 6 February, 2024's on 12 March); until it
 * does, `fetchCustomsCalendar` answers null and the site falls back to the
 * indicator's `releaseDay`.
 */

import { upstreamFetch } from "./upstream";

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const LISTING = "http://english.customs.gov.cn/Statistics/Statistics?ColumnId=4";
/** The hour, China Standard Time, the preliminary release is taken to appear. Customs does not publish a time. */
const RELEASE_TIME = "10:00:00";

export interface CustomsCalendarMonth {
  /** The month of publication, 1-12. */
  month: number;
  /** Day of the preliminary release, or null when the month has none (February). */
  preliminary: number | null;
  bulletin: number | null;
  online: number | null;
}

export interface CustomsCalendar { year: number; months: CustomsCalendarMonth[] }

/** The shape the NBS agenda uses; see app.ts. */
export interface CustomsReleaseItem { _id: string; fb_time: string; content: string; en: string; keys: string[]; categories: string[] }

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function cellText(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

/** "1 3 th" -> 13; "7th" -> 7; "-" -> null. The page splits digits across spans. */
function dayOf(cell: string | undefined): number | null {
  if (!cell) return null;
  const digits = cell.replace(/\s+/g, "").match(/^(\d{1,2})(?:st|nd|rd|th)?$/i);
  if (!digits) return null;
  const day = Number(digits[1]);
  return day >= 1 && day <= 31 ? day : null;
}

/** The calendar on one year's page, or null when the page carries no calendar table. */
export function parseCustomsCalendar(html: string): CustomsCalendar | null {
  const text = cellText(html);
  const yearMatch = text.match(/Release\s+Ca[nl]+endar\s+of\s+((?:\d\s*){4})/i);
  if (!yearMatch?.[1]) return null;
  const year = Number(yearMatch[1].replace(/\s+/g, ""));
  const months: CustomsCalendarMonth[] = [];
  for (const row of html.matchAll(/<tr[\s\S]*?<\/tr>/g)) {
    const cells = [...row[0].matchAll(/<td[\s\S]*?<\/td>/g)].map((cell) => cellText(cell[0]));
    const month = MONTHS.indexOf(cells[0] ?? "") + 1;
    if (month === 0 || cells.length < 4) continue;
    months.push({ month, preliminary: dayOf(cells[1]), bulletin: dayOf(cells[2]), online: dayOf(cells[3]) });
  }
  return months.length > 0 ? { year, months } : null;
}

/** The link to one year's calendar on the listing page, or null when the year is not listed yet. */
export function findCalendarLink(listingHtml: string, year: number): string | null {
  for (const anchor of listingHtml.matchAll(/<a\s+[^>]*href=["']?([^"'\s>]+)["']?[^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = cellText(anchor[2] ?? "").replace(/\s+/g, "");
    if (new RegExp(`Ca[nl]+endarof${year}$`, "i").test(label)) return new URL(anchor[1] ?? "", LISTING).toString();
  }
  return null;
}

function monthLabel(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * The preliminary releases of a calendar as agenda items, for the window
 * `start`..`end` ("YYYY-MM-DD", inclusive). Each item reports the previous
 * month; March's reports January and February together and says so.
 */
export function customsReleaseItems(calendar: CustomsCalendar, start: string, end: string, keys: string[]): CustomsReleaseItem[] {
  const items: CustomsReleaseItem[] = [];
  for (const entry of calendar.months) {
    if (entry.preliminary === null) continue;
    const date = `${calendar.year}-${String(entry.month).padStart(2, "0")}-${String(entry.preliminary).padStart(2, "0")}`;
    if (date < start.slice(0, 10) || date > end.slice(0, 10)) continue;
    const reported = entry.month === 1 ? monthLabel(calendar.year - 1, 12) : monthLabel(calendar.year, entry.month - 1);
    const period = entry.month === 3 ? `January-February ${calendar.year}` : new Date(Date.UTC(Number(reported.slice(0, 4)), Number(reported.slice(5, 7)) - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    items.push({
      _id: `customs-${date}`,
      fb_time: `${date} ${RELEASE_TIME}`,
      content: `海关统计数据 初步数据 ${period}`,
      en: `Customs trade statistics, preliminary release for ${period}`,
      keys, categories: [],
    });
  }
  return items;
}

const cache = new Map<number, { at: number; calendar: CustomsCalendar | null }>();
const CACHE_MS = 24 * 60 * 60 * 1000;
const MISS_MS = 6 * 60 * 60 * 1000;

async function get(url: string): Promise<string> {
  const response = await upstreamFetch(url, { headers: { "User-Agent": USER_AGENT }, timeoutMs: 30_000, redirect: "follow" });
  if (!response.ok) throw new Error(`Customs -> HTTP ${response.status}`);
  return response.text();
}

/**
 * The calendar for `year` from the English site, cached for a day (six hours
 * when the year is not listed yet). Null when Customs has not published it.
 */
export async function fetchCustomsCalendar(year: number, read: (url: string) => Promise<string> = get): Promise<CustomsCalendar | null> {
  const hit = cache.get(year);
  if (hit && Date.now() - hit.at < (hit.calendar ? CACHE_MS : MISS_MS)) return hit.calendar;
  const link = findCalendarLink(await read(LISTING), year);
  const calendar = link ? parseCustomsCalendar(await read(link)) : null;
  cache.set(year, { at: Date.now(), calendar });
  return calendar;
}

/** Customs release items across the years a window spans; a year without a calendar contributes none. */
export async function fetchCustomsReleases(start: string, end: string, keys: string[], read?: (url: string) => Promise<string>): Promise<CustomsReleaseItem[]> {
  const items: CustomsReleaseItem[] = [];
  for (let year = Number(start.slice(0, 4)); year <= Number(end.slice(0, 4)); year += 1) {
    const calendar = await fetchCustomsCalendar(year, read);
    if (calendar) items.push(...customsReleaseItems(calendar, start, end, keys));
  }
  return items;
}
