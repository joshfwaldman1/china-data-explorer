/**
 * China Customs (GAC) monthly trade tables, from the bureau's English site.
 *
 * The General Administration of Customs publishes its preliminary release as
 * a set of HTML tables on english.customs.gov.cn: total trade, trade by mode,
 * **trade by country and region** (about thirty partners and blocs), and
 * **major exports and imports by quantity and value** (around thirty-five
 * commodities each), month and year to date, in USD and in CNY. The listing
 * paginates one month per page or so, back to 2022 at least. The Chinese site
 * and the interactive statistics portal answer a foreign address with HTTP
 * 412; the English site does not, and it carries the same tables.
 *
 * This is the site's first official-release-table adapter. The parsers are
 * deterministic and fixture-tested; a table whose header is not the one they
 * expect is refused rather than guessed at.
 *
 * Series shape: one curated key per table, with the partner or commodity as
 * the region, so the existing region picker, the map-less ranking page and
 * the per-place store all apply. Values are USD millions as published.
 */

import type { NbsRegion, SeriesPoint, SeriesResult } from "./data";

const CUSTOMS_BASE = "http://english.customs.gov.cn";
const LISTING_COLUMN = 1; // the preliminary release
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const PAUSE_MS = 800;

export type CustomsTable = "by-country" | "major-exports" | "major-imports";

const TABLE_TITLES: Record<CustomsTable, RegExp> = {
  "by-country": /by Country\/Region/i,
  "major-exports": /Major Exports by Quantity and Value/i,
  "major-imports": /Major Imports by Quantity and Value/i,
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** "Aug 2026", "July 2024" or "June 2022" in a listing title → "2026-08". */
export function monthOfTitle(title: string): string | null {
  const match = title.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s*,?\s*(\d{4})\b/i);
  if (!match || !match[1] || !match[2]) return null;
  const month = MONTHS[match[1].toLowerCase()];
  return month ? `${match[2]}-${String(month).padStart(2, "0")}` : null;
}

export type CustomsCurrency = "USD" | "CNY";
export interface ListingEntry { title: string; href: string; month: string | null; table: CustomsTable | null; usd: boolean; currency: CustomsCurrency }

/** The table links on one listing page. The site writes some hrefs unquoted. */
export function parseListing(html: string): ListingEntry[] {
  const entries: ListingEntry[] = [];
  for (const match of html.matchAll(/<a[^>]+href=\s*"?([^\s">]+)"?[^>]*>([\s\S]*?)<\/a>/g)) {
    const href = match[1] ?? "";
    if (!/\/Statics\//i.test(href)) continue;
    const title = decode(match[2] ?? "").replace(/\s+/g, " ").trim();
    const table = (Object.keys(TABLE_TITLES) as CustomsTable[]).find((kind) => TABLE_TITLES[kind].test(title)) ?? null;
    // Every table is published twice, "(in USD)" and "(in CNY)"; the title says which.
    const currency: CustomsCurrency = /CNY|RMB/i.test(title) ? "CNY" : "USD";
    entries.push({ title, href: href.startsWith("http") ? href : `${CUSTOMS_BASE}${href}`, month: monthOfTitle(title), table, usd: currency === "USD", currency });
  }
  return entries;
}

function decode(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, "\"").replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

/** A number as the tables write it: "55,768.0", "-" or "—" for none. */
function cellNumber(text: string): number | null {
  const cleaned = text.replace(/,/g, "").trim();
  if (cleaned === "" || cleaned === "-" || cleaned === "—" || cleaned === "－") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function rowsOf(html: string): string[][] {
  const rows: string[][] = [];
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...(row[1] ?? "").matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((cell) => decode(cell[1] ?? "").replace(/\s+/g, " ").trim());
    if (cells.some((cell) => cell !== "")) rows.push(cells);
  }
  return rows;
}

/** "of which: Germany" and "United States (US)" → "Germany", "United States". */
function partnerName(text: string): string {
  return text.replace(/^of which:\s*/i, "").replace(/\s*\([^)]*\)\s*$/, "").trim();
}

export interface PartnerRow { name: string; exports: number | null; imports: number | null; total: number | null; ytdExports: number | null; ytdImports: number | null; ytdTotal: number | null }

/**
 * The by-country table: month and year-to-date exports, imports and total for
 * each partner, USD millions. Refuses a table whose unit line or header is not
 * what the parser was written for, so a changed layout fails loudly.
 */
/** The unit line each currency's tables carry: "USD 1 Million", "CNY 100 Million" (亿元). */
const UNIT_LINE: Record<CustomsCurrency, RegExp> = { USD: /USD\s*1\s*Milli/i, CNY: /CNY\s*100\s*Milli/i };

export function parseByCountry(html: string, currency: CustomsCurrency = "USD"): PartnerRow[] {
  const rows = rowsOf(html);
  const unit = rows.find((row) => /^Unit/i.test(row[0] ?? ""))?.[0] ?? "";
  if (!UNIT_LINE[currency].test(unit)) throw new Error(`by-country table: unexpected unit line "${unit}" for ${currency}`);
  // The header has been written three ways since 2023: two label rows
  // ("Import Source" / "Export Destination"), the same with merged cells, and
  // one merged label cell over a row that begins with the month number. All
  // of them name the source column and say "Export & Import" beside it, and
  // the data rows beneath are the same seven columns in every year.
  const header = rows.find((row) => /Import Source/i.test(row[0] ?? "") && row.some((cell) => /Export\s*&\s*Import/i.test(cell)));
  if (!header) throw new Error("by-country table: header not recognised");
  const out: PartnerRow[] = [];
  for (const row of rows) {
    // "Unit:" is the unit line; "United States" is a partner. A partner has
    // letters in its name; the month-number row of the 2023 layout does not.
    if (row.length < 7 || !row[0] || /^(Unit\s*:|Note|Import Source|Export Destinati)/i.test(row[0])) continue;
    if (row[0].startsWith("(") || !/[A-Za-z]/.test(row[0]) || /^\d/.test(row[1] ?? "") === false) continue;
    out.push({
      name: partnerName(row[0]),
      total: cellNumber(row[1] ?? ""), ytdTotal: cellNumber(row[2] ?? ""),
      exports: cellNumber(row[3] ?? ""), ytdExports: cellNumber(row[4] ?? ""),
      imports: cellNumber(row[5] ?? ""), ytdImports: cellNumber(row[6] ?? ""),
    });
  }
  if (out.length < 10) throw new Error(`by-country table: only ${out.length} partner rows found`);
  return out;
}

export interface CommodityRow { name: string; quantityUnit: string; quantity: number | null; value: number | null; ytdQuantity: number | null; ytdValue: number | null }

/** The major exports or imports table: quantity and value, month and year to date. */
export function parseCommodities(html: string, currency: CustomsCurrency = "USD"): CommodityRow[] {
  const rows = rowsOf(html);
  const unit = rows.find((row) => /^Unit/i.test(row[0] ?? ""))?.[0] ?? "";
  if (!UNIT_LINE[currency].test(unit)) throw new Error(`commodity table: unexpected unit line "${unit}" for ${currency}`);
  const header = rows.find((row) => /^Commodity/i.test(row[0] ?? "") && /Unit/i.test(row[1] ?? ""));
  if (!header) throw new Error("commodity table: header not recognised");
  const out: CommodityRow[] = [];
  for (const row of rows) {
    if (row.length < 6 || !row[0] || /^(Unit\s*:|Note|Commodity|Quantity)/i.test(row[0]) || row[0].startsWith("(")) continue;
    out.push({
      name: row[0].trim(), quantityUnit: (row[1] ?? "").replace(/^[-—]$/, ""),
      quantity: cellNumber(row[2] ?? ""), value: cellNumber(row[3] ?? ""),
      ytdQuantity: cellNumber(row[4] ?? ""), ytdValue: cellNumber(row[5] ?? ""),
    });
  }
  if (out.length < 10) throw new Error(`commodity table: only ${out.length} rows found`);
  return out;
}

/** A stable region code from a partner or commodity name: "United States" → "united-states". */
export function slugOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ── Fetching ─────────────────────────────────────────────────────────────────

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html" }, signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error(`Customs -> HTTP ${response.status} for ${url}`);
  return await response.text();
}

const listingCache = new Map<number, { at: number; entries: ListingEntry[] }>();
const tableCache = new Map<string, { at: number; html: string }>();

// Pacing belongs to the fetch, not to the loop that asks: a cached page or
// table costs the portal nothing and should cost the caller nothing. A run over
// thirty partners reads each table once and each listing page once.
async function listingPage(page: number): Promise<ListingEntry[]> {
  const hit = listingCache.get(page);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.entries;
  const html = await fetchText(`${CUSTOMS_BASE}/Statistics/Statistics?ColumnId=${LISTING_COLUMN}&page=${page}`);
  const entries = parseListing(html);
  listingCache.set(page, { at: Date.now(), entries });
  await Bun.sleep(PAUSE_MS);
  return entries;
}

/**
 * The USD table of one kind for one month, walking the listing pages until
 * it appears. The listing runs newest first, roughly a month per page, so a
 * month two years back is some twenty-five pages in; each page is read once
 * per six hours.
 */
export async function findTable(table: CustomsTable, month: string, options: { maxPages?: number; pages?: (page: number) => Promise<ListingEntry[]>; currency?: CustomsCurrency } = {}): Promise<ListingEntry | null> {
  const { maxPages = 120, pages = listingPage, currency = "USD" } = options;
  let sawOlder = false;
  let previous = "";
  for (let page = 1; page <= maxPages; page += 1) {
    const entries = await pages(page);
    // Past the last page the site serves the last page again; a page that
    // repeats the one before it is the end of the archive.
    const signature = entries.map((entry) => entry.href).join("|");
    if (entries.length === 0 || signature === previous) return null;
    previous = signature;
    const found = entries.find((entry) => entry.table === table && entry.currency === currency && entry.month === month);
    if (found) return found;
    if (entries.some((entry) => entry.month && entry.month < month)) sawOlder = true;
    if (sawOlder && entries.every((entry) => !entry.month || entry.month < month)) return null;
  }
  return null;
}

async function tableHtml(entry: ListingEntry): Promise<string> {
  const hit = tableCache.get(entry.href);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.html;
  const html = await fetchText(entry.href);
  tableCache.set(entry.href, { at: Date.now(), html });
  await Bun.sleep(PAUSE_MS);
  return html;
}

/** The months to ask for: the last `limit`, newest first, ending with last month. */
function recentMonths(limit: number, now = new Date()): string[] {
  const months: string[] = [];
  for (let back = 1; back <= limit; back += 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    months.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

/** How many months back a first view or a page read goes; the ingest goes further, a slice at a time. */
export const RECENT_MONTHS = 36;
/** How many months older than the store's oldest one ingest run adds. */
export const BACKFILL_MONTHS_PER_RUN = 24;

/**
 * The months one fetch should ask for, newest first.
 *
 * The recent window is always asked for, so revisions to the last three years
 * are seen. When the store's oldest month for this series is known, a further
 * slice of `backfillPerRun` months older than it is added, so each ingest run
 * carries the history back a bounded step — to 2022, where Customs' English
 * listing begins — instead of one run walking the whole archive.
 */
export function monthsToFetch(limit: number, oldestStored: string | null, now = new Date(), backfillPerRun = BACKFILL_MONTHS_PER_RUN): string[] {
  const recent = recentMonths(Math.min(limit, RECENT_MONTHS), now);
  if (!oldestStored || limit <= RECENT_MONTHS) return recent;
  const older: string[] = [];
  const [year, month] = oldestStored.split("-").map(Number);
  if (!year || !month) return recent;
  for (let back = 1; back <= backfillPerRun && recent.length + older.length < limit; back += 1) {
    const date = new Date(Date.UTC(year, month - 1 - back, 1));
    older.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return [...recent, ...older.filter((item) => !recent.includes(item))];
}

export interface CustomsIndicator {
  kind: "customs";
  group: string;
  title: string;
  agency: string;
  frequency: string;
  unit: string;
  home?: boolean;
  ended?: string;
  endedNote?: string;
  table: CustomsTable;
  regions: NbsRegion[];
  /** The denomination of the table read; Customs publishes each in both. USD when omitted. */
  currency?: CustomsCurrency;
  /** Day of the month by which the previous month's tables are out (server/due.ts). */
  releaseDay?: number;
  /** Region codes listed as their own rows on the home page: the partners a reader looks for first. */
  homeRegions?: string[];
}

/**
 * One partner's or commodity's series over the last `limit` months. A month
 * whose table is not published yet (or not found) is skipped, not zeroed. The
 * first fetch of a two-year window is about fifty requests; every table read
 * is cached, so the second partner in the same table costs nothing.
 */
export async function fetchCustomsRegion(key: string, cfg: CustomsIndicator, region: NbsRegion, limit: number, options: { oldestStored?: string | null } = {}): Promise<SeriesResult> {
  const months = monthsToFetch(limit, options.oldestStored ?? null);
  const points: Record<string, SeriesPoint[]> = {};
  const push = (label: string, date: string, value: number | null) => {
    if (value === null) return;
    (points[label] ??= []).push({ date, value });
  };
  let missing = 0;
  for (const month of months) {
    const entry = await findTable(cfg.table, month, { currency: cfg.currency ?? "USD" });
    // Three missing in a row is the end of the archive (or a table Customs did
    // not publish that year); a single gap is skipped.
    if (!entry) { missing += 1; if (missing >= 3) break; continue; }
    missing = 0;
    const html = await tableHtml(entry);
    if (cfg.table === "by-country") {
      const row = parseByCountry(html, cfg.currency ?? "USD").find((item) => slugOf(item.name) === region.value);
      if (!row) continue;
      push("Exports", month, row.exports);
      push("Imports", month, row.imports);
      push("Balance", month, row.exports !== null && row.imports !== null ? Math.round((row.exports - row.imports) * 10) / 10 : null);
    } else {
      const row = parseCommodities(html, cfg.currency ?? "USD").find((item) => slugOf(item.name) === region.value);
      if (!row) continue;
      push("Value", month, row.value);
      if (row.quantityUnit) push(`Quantity (${row.quantityUnit})`, month, row.quantity);
    }
  }
  const series = Object.entries(points).map(([label, list]) => ({ label, points: list.sort((a, b) => a.date.localeCompare(b.date)) }));
  return {
    key, title: cfg.title, agency: cfg.agency, sourceUrl: `${CUSTOMS_BASE}/Statistics/Statistics?ColumnId=${LISTING_COLUMN}`,
    frequency: cfg.frequency, unit: cfg.unit, series,
  };
}

/** The partners and commodities named in the current tables, as region options. */
export async function customsRegions(table: CustomsTable): Promise<NbsRegion[]> {
  const month = recentMonths(2)[0] ?? "";
  const entry = (await findTable(table, month)) ?? (await findTable(table, recentMonths(2)[1] ?? ""));
  if (!entry) return [];
  const html = await tableHtml(entry);
  const names = table === "by-country" ? parseByCountry(html).map((row) => row.name) : parseCommodities(html).map((row) => row.name);
  return names.map((name) => ({ text: name, value: slugOf(name), en: name }));
}
