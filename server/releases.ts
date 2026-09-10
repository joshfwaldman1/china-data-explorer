/**
 * The NBS publication calendar comes back as Chinese report titles. This maps
 * each recurring title to an English name and to the series it updates, so
 * the Releases page can link to series and a series page can say when its
 * next number is due.
 *
 * Titles carry a trailing "(HH:MM)" on the portal; match on the stem.
 */

export interface ReleaseMapping {
  /** Substring of the NBS release title, without the time suffix. */
  match: string;
  en: string;
  /** Curated keys, and catalog keys where a headline series lives there. */
  keys: string[];
  /** Top-level NBS catalog categories this release updates, for the release-triggered refresh. */
  categories?: string[];
}

export const RELEASE_MAP: ReleaseMapping[] = [
  { match: "居民消费价格指数", en: "Consumer price index (CPI), monthly", keys: ["cpi"], categories: ["价格指数"] },
  { match: "工业生产者价格指数", en: "Producer price index (PPI), monthly", keys: ["ppi"], categories: ["价格指数"] },
  { match: "商品住宅销售价格", en: "70-city new home prices, monthly", keys: ["house_prices"], categories: ["价格指数"] },
  { match: "国民经济运行情况", en: "National economy monthly bundle: industrial output, retail sales, investment, unemployment", keys: ["industrial_production", "retail_sales", "unemployment"], categories: ["工业", "国内贸易", "固定资产投资 (不含农户)", "房地产", "城镇调查失业率", "服务业生产指数", "能源"] },
  { match: "规模以上工业生产", en: "Industrial production (large firms), monthly", keys: ["industrial_production"], categories: ["工业"] },
  { match: "能源生产情况", en: "Energy production, monthly", keys: ["electricity_output"], categories: ["能源"] },
  { match: "固定资产投资", en: "Fixed-asset investment (excluding rural households), monthly", keys: [], categories: ["固定资产投资 (不含农户)"] },
  { match: "房地产开发和销售", en: "Real estate development and sales, monthly", keys: ["real_estate"], categories: ["房地产"] },
  { match: "社会消费品零售总额", en: "Retail sales of consumer goods, monthly", keys: ["retail_sales"], categories: ["国内贸易"] },
  { match: "工业经济效益", en: "Industrial profits, monthly", keys: [], categories: ["工业"] },
  { match: "采购经理指数", en: "Purchasing managers' index (PMI), monthly", keys: ["pmi"], categories: ["采购经理指数"] },
  { match: "国内生产总值", en: "Gross domestic product (GDP), quarterly", keys: ["gdp", "provincial_gdp"], categories: ["国民经济核算"] },
  { match: "居民收支", en: "Household income and expenditure, quarterly", keys: [], categories: ["人民生活"] },
  { match: "服务业生产指数", en: "Index of services production, monthly", keys: [], categories: ["服务业生产指数"] },
  { match: "季度主要行业增加值", en: "Value added by major industry, preliminary quarterly estimate", keys: [], categories: ["国民经济核算"] },
  { match: "工业产能利用率", en: "Industrial capacity utilisation, quarterly", keys: [], categories: ["工业"] },
  { match: "文化及相关产业", en: "Culture and related industries (large firms), quarterly", keys: [], categories: ["文化"] },
];

/** Months whose "national economy" briefing also announces the previous quarter's GDP. */
const QUARTERLY_BUNDLE_MONTHS = new Set([1, 4, 7, 10]);

/**
 * The mapping for an agenda title. NBS never lists GDP as its own release:
 * the quarterly figure is announced inside the "national economy" bundle in
 * January, April, July and October, so in those months the bundle also
 * refreshes the GDP series. `when` is the release time, "YYYY-MM-DD HH:MM:SS".
 */
/**
 * An agenda bound as NBS's calendar wants it. A caller who passes a bare date for `end`
 * ("2026-11-30") would otherwise be read as midnight and lose that day's releases, so a
 * bare date takes the start or end of its day; a value that already carries a time is kept.
 */
export function agendaBound(value: string, endOfDay: boolean): string {
  return /^\d{4}[-/]\d{2}[-/]\d{2}$/.test(value.trim()) ? `${value.trim()} ${endOfDay ? "23:59:59" : "00:00:00"}` : value;
}

export function describeRelease(title: string, when = ""): ReleaseMapping | null {
  const stem = title.replace(/\s*[（(]\d{1,2}:\d{2}[)）]\s*$/, "");
  const entry = RELEASE_MAP.find((candidate) => stem.includes(candidate.match)) ?? null;
  if (!entry || entry.match !== "国民经济运行情况" || !QUARTERLY_BUNDLE_MONTHS.has(Number(when.slice(5, 7)))) return entry;
  return { ...entry, en: "National economy quarterly bundle: GDP, industrial output, retail sales, investment, unemployment", keys: ["gdp", ...entry.keys] };
}
