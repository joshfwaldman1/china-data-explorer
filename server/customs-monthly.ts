/**
 * Customs' USD monthly bulletin, table 1B. Unlike the preliminary release
 * listing, it publishes separate January and February observations and
 * restates earlier monthly levels. Read one latest issue per reference year,
 * newest first; never manufacture rates from levels of different vintages.
 */
import type { SeriesPoint, SeriesResult } from "./data";
import type { CustomsIndicator } from "./customs";
import { upstreamFetch } from "./upstream";

export const MONTHLY_INDEX = "http://english.customs.gov.cn/statics/report/monthly.html";
const PAUSE_MS = 800;
const CACHE_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; html: string }>();
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const clean = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const number = (s = ""): number | null => s.trim() && !/^[-—－]$/.test(s.trim()) && Number.isFinite(Number(s.replace(/,/g, ""))) ? Number(s.replace(/,/g, "")) : null;

export interface BulletinLink { period: string; url: string }
export interface BulletinMonth {
  period: string;
  levels: (number | null)[]; // total, exports, imports, balance; 100 million USD
  growth: (number | null)[]; // total, exports, imports; published monthly YoY
  ytdGrowth: (number | null)[]; // total, exports, imports; published YTD YoY
}

export function bulletinYears(html: string): number[] {
  return [...new Set([...html.matchAll(/<option\b[^>]*value=["']?(\d{4})["']?[^>]*>/gi)].map(m => Number(m[1])))].sort((a, b) => b - a);
}

export function parseBulletinIndex(html: string, year: number): BulletinLink[] {
  const row = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].find(m => /Summary of Imports and Exports\s*\(In USD\)\s*B\s*[:：]\s*Monthly/i.test(clean(m[1] ?? "")))?.[1];
  if (!row) return [];
  const result: BulletinLink[] = [];
  for (const m of row.matchAll(/<a\b[^>]*href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi)) {
    const month = MONTHS.indexOf(clean(m[4] ?? "").slice(0, 3).toLowerCase()) + 1;
    const url = new URL(m[1] ?? m[2] ?? m[3] ?? "", MONTHLY_INDEX);
    if (!month || url.hostname !== "english.customs.gov.cn" || !/^\/Statics\//i.test(url.pathname)) continue;
    result.push({ period: `${year}-${String(month).padStart(2, "0")}`, url: url.toString() });
  }
  return result.sort((a, b) => b.period.localeCompare(a.period));
}

export function parseMonthlyBulletin(html: string, issue: string): BulletinMonth[] {
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m =>
    [...(m[1] ?? "").matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => clean(c[1] ?? "")));
  if (!rows.some(r => r.some(c => /^Unit\s*[:：]\s*US\$\s*million$/i.test(c))) ||
      !rows.some(r => /^Year\s*&\s*Month$/i.test(r[0] ?? "") && r.slice(1, 5).join("|") === "Total|Export|Import|Balance")) {
    throw new Error(`Customs monthly bulletin ${issue}: unexpected USD unit or monthly header`);
  }
  const result: BulletinMonth[] = [];
  for (const [index, row] of rows.entries()) {
    const match = row[0]?.match(/^(\d{4})\.(\d{2})$/);
    if (!match || row.length !== 9) continue;
    const period = `${match[1]}-${match[2]}`;
    if (period > issue || Number(match[2]) < 1 || Number(match[2]) > 12) throw new Error(`Customs monthly bulletin ${issue}: invalid period ${period}`);
    const level = row.slice(1, 5).map(number);
    if (level.some(v => v === null)) throw new Error(`Customs monthly bulletin ${issue}: incomplete levels for ${period}`);
    // The first undated row after the current-year levels contains YoY; the
    // following row is MoM. Prior-year rows carry levels only.
    const rates = rows[index + 1];
    const hasRates = period.slice(0, 4) === issue.slice(0, 4) && rates?.length === 9 && rates[0] === "";
    const growth = hasRates ? rates.slice(1, 4).map(number) : [null, null, null];
    const ytdGrowth = hasRates ? rates.slice(5, 8).map(number) : [null, null, null];
    if (period.slice(0, 4) === issue.slice(0, 4) && [...growth, ...ytdGrowth].some(v => v === null)) {
      throw new Error(`Customs monthly bulletin ${issue}: missing published growth for ${period}`);
    }
    result.push({ period, levels: level.map(v => v === null ? null : v / 100), growth, ytdGrowth });
  }
  const current = result.filter(r => r.period.startsWith(issue.slice(0, 4)));
  if (current.length !== Number(issue.slice(5)) || new Set(current.map(r => r.period)).size !== current.length || !current.some(r => r.period === issue)) {
    throw new Error(`Customs monthly bulletin ${issue}: incomplete reference-year coverage`);
  }
  return result;
}

async function readPage(url: string): Promise<string> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.html;
  const response = await upstreamFetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, timeoutMs: 30_000, redirect: "follow" });
  try {
    if (!response.ok) throw new Error(`Customs monthly bulletin: HTTP ${response.status} at ${url}`);
    const html = await response.text();
    cache.set(url, { at: Date.now(), html });
    return html;
  } finally { await Bun.sleep(PAUSE_MS); }
}

export async function fetchCustomsMonthly(key: string, cfg: CustomsIndicator, limit: number, read = readPage): Promise<SeriesResult> {
  if (cfg.currency && cfg.currency !== "USD") throw new Error("Customs monthly bulletin is a USD table");
  const index = await read(MONTHLY_INDEX);
  const years = bulletinYears(index);
  if (!years.length) throw new Error("Customs monthly bulletin: reference years not found");
  const points = new Map<string, Map<string, number>>();
  const put = (label: string, period: string, value: number | null | undefined) => {
    if (value === null || value === undefined) return;
    const line = points.get(label) ?? new Map<string, number>();
    // A newer issue's restated levels take precedence over an older issue.
    if (!line.has(period)) line.set(period, value);
    points.set(label, line);
  };
  let earliestYear = years[years.length - 1] ?? 0;
  let latest: string | undefined;
  for (const year of years) {
    if (year < earliestYear) break;
    const page = year === years[0] ? index : await read(MONTHLY_INDEX.replace("monthly.html", `monthly${year}.html`));
    const issue = parseBulletinIndex(page, year)[0];
    if (!issue) {
      // The new calendar year's index can exist before its first bulletin.
      if (latest) throw new Error(`Customs monthly bulletin: missing archive for ${year}`);
      continue;
    }
    if (!latest) {
      latest = issue.period;
      earliestYear = Math.floor((year * 12 + Number(latest.slice(5)) - Math.max(1, Math.min(limit, 240))) / 12);
    }
    for (const row of parseMonthlyBulletin(await read(issue.url), issue.period)) {
      if (cfg.measure === "levels") {
        put("Exports", row.period, row.levels[1]); put("Imports", row.period, row.levels[2]);
        put("Total trade", row.period, row.levels[0]); put("Balance", row.period, row.levels[3]);
      } else {
        put("Exports (YoY %)", row.period, row.growth[1]); put("Imports (YoY %)", row.period, row.growth[2]);
        put("Total trade (YoY %)", row.period, row.growth[0]);
        put("Exports, year to date (YoY %)", row.period, row.ytdGrowth[1]);
        put("Imports, year to date (YoY %)", row.period, row.ytdGrowth[2]);
      }
    }
  }
  if (!latest) throw new Error("Customs monthly bulletin: no published issue found");
  return {
    key, title: cfg.title, agency: cfg.agency, frequency: cfg.frequency, unit: cfg.unit, sourceUrl: MONTHLY_INDEX,
    series: [...points].map(([label, values]) => ({ label, points: [...values].sort(([a], [b]) => a.localeCompare(b)).slice(-Math.max(1, Math.min(limit, 240))).map(([date, value]): SeriesPoint => ({ date, value })) })),
  };
}
