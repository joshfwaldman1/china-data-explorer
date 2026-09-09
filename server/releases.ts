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
];

export function describeRelease(title: string): ReleaseMapping | null {
  const stem = title.replace(/\s*[（(]\d{1,2}:\d{2}[)）]\s*$/, "");
  return RELEASE_MAP.find((entry) => stem.includes(entry.match)) ?? null;
}
