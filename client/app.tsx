import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import "./styles.css";
import { PROVINCE_PLACES } from "../shared/places.ts";
import { FREQUENCY_RANK, coarsestFrequency, convertTrack, csvOf, deltaText, fmt, fmtDate, fmtTick, ordinal, canonicalPeriod, isAggregation, isRate, isTargetFrequency, observationLabel, periodPretty, periodTime, rebase, regionalCsv, type Aggregation, type SeriesPoint, type TargetFrequency, type Track, isUpcoming, yearEarlier, yearOnYearText } from "./lib";
import { measureOf, type Measure } from "../shared/measure";
import { ActionMenu, ChartPanelHeader, PageHeader } from "./primitives";
import { niceTicks, visibleTracks, type ShareInput } from "./export";
import { canCopyImage, copyImage, downloadBlob, renderShareImage, shareFileName, warmShareFonts } from "./share";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CuratedEntry { key: string; title: string; group: string; agency: string; frequency: string; unit: string; ended?: string; endedNote?: string; home?: boolean; refreshBlocked?: string; source?: string; releaseDay?: number; homeRegions?: string[]; homeRank?: number; homeTitle?: string; homeRows?: { rank: number; title?: string; line?: string; group?: string }[]; measure?: Measure; }
interface NbsCatalogEntry {
  key: string; id: string; name: string; nameEn?: string; shortName: string; unit: string; note: string;
  annotation: string; datasetCode: number; dataset: string; frequency: string; geography: string; categories: string[];
  noteEn?: string; annotationEn?: string; datasetEn?: string; categoriesEn?: string[];
  family?: { head: string; members: string[]; span: string };
  februaryFrom?: string;
  growthSibling?: { key: string; name: string };
  firstPeriod?: string; lastPeriod?: string;
  nameEnSource?: "nbs-official" | "generated" | "unavailable"; nameEnSourceUrl?: string; nameEnCapturedAt?: string;
  legacyDatabase?: string; legacyIndicatorCode?: string;
  /** Set when the query named a place: the region this result should open at. */
  region?: Region;
}
interface Series { label: string; points: SeriesPoint[]; shareColorWith?: string; dashed?: boolean; }
interface Region { text: string; value: string; en?: string; }
interface SeriesResult {
  key: string; title: string; agency: string; sourceUrl: string; frequency: string; unit: string;
  series: Series[]; metadata?: NbsCatalogEntry; region?: Region; transform?: string;
  source?: string; updatedAt?: string;
  /** The URL spec this result answers: the key, or key@region for one province of a regional series. */
  spec?: string;
}

/** "provincial_gdp@440000000000" → { key, region }; a bare key has no region. */
function splitSpec(spec: string): { key: string; region: string } {
  const at = spec.indexOf("@");
  return at < 0 ? { key: spec, region: "" } : { key: spec.slice(0, at), region: spec.slice(at + 1) };
}
/**
 * "Guangdong, " in front of a Home row's small print when the headline payload is one region's
 * series, so the row names the geography its value belongs to; nothing for national series.
 */
function regionPrefix(result: SeriesResult | undefined): string {
  if (!result?.region || result.region.value === "000000000000" || result.region.text === "全国") return "";
  return `${regionLabel(result.region)}, `;
}
/** A region's name for the UI: the English name where we have one, else what NBS sent. */
function regionLabel(region: Region): string {
  if (region.en) return region.en;
  if (region.value === "000000000000" || region.text === "全国") return "China, national";
  return PROVINCES.find((province) => province.code === region.value)?.en ?? region.text;
}
/** Names that take "the" in a sentence: "Exports to the United States", "Imports from the European Union". */
const THE = new Set(["United States", "European Union", "United Kingdom", "Netherlands", "Philippines", "United Arab Emirates", "Czech Republic", "Bahamas", "Maldives"]);
function withArticle(name: string): string { return THE.has(name) ? `the ${name}` : name; }
/** A 12-digit NBS place code that is a province or city, not the nation. */
function isPlaceCode(value: string): boolean { return /^\d{12}$/.test(value) && value !== "000000000000"; }
/**
 * The full name of one region's series, so a title says what and where at once:
 * "Guangdong Real GDP Growth" rather than "Provincial Real GDP Growth" with the
 * province in the small print; "Exports to the United States" for a Customs
 * partner row; "Trade by Partner: ASEAN" when the line has no direction.
 */
function regionalTitle(title: string, regionName: string, firstLabel?: string): string {
  const direction = firstLabel?.match(/^(Exports|Imports)\b/)?.[1];
  if (direction) return `${direction} ${direction === "Exports" ? "to" : "from"} ${withArticle(regionName)}`;
  if (/^Provincial /.test(title)) return `${regionName} ${title.replace(/^Provincial /, "")}`;
  return `${title}: ${regionName}`;
}
/** What to call a result on a chart shared with others: the province when the key repeats. */
function displayTitle(result: SeriesResult, all: SeriesResult[]): string {
  const title = result.metadata?.nameEn || result.title;
  const sameKey = all.filter((other) => other.key === result.key);
  if (sameKey.length > 1 && result.region) return all.every((other) => other.key === result.key) ? regionLabel(result.region) : `${title} (${regionLabel(result.region)})`;
  return title;
}
/** Months between an observation's period and today; 0 for the current month. */
function monthsOld(period: string): number {
  const t = periodTime(period);
  if (!Number.isFinite(t)) return 0;
  const now = new Date();
  return (now.getUTCFullYear() - new Date(t).getUTCFullYear()) * 12 + (now.getUTCMonth() - new Date(t).getUTCMonth());
}
/**
 * A series whose latest observation is older than its source's normal lag has
 * stopped arriving: four months for monthly data, ten for quarterly (the BIS
 * publishes a quarter about six months after it ends), two years for annual
 * (World Bank estimates for a year appear the following summer).
 */
function isBehind(period: string, frequency: string): boolean {
  const months = monthsOld(period);
  return frequency === "Monthly" ? months > 4 : frequency === "Quarterly" ? months > 10 : months > 24;
}
interface SearchResponse { total: number; offset: number; limit: number; results: NbsCatalogEntry[]; place?: { text: string; en: string; kind: string }; }
interface DatasetStat { code: number; name: string; frequency: string; geography: string; count: number; categories?: { name: string; count: number }[]; }

/** The bureau's datasets in English, in the order the Browse page shows them: the nation, its provinces and cities, then the comparisons. */
const DATASET_EN: Record<number, string> = {
  1: "National, monthly", 2: "National, quarterly", 3: "National, annual",
  4: "Provinces, monthly", 5: "Provinces, quarterly", 6: "Provinces, annual",
  7: "Cities, monthly prices", 8: "Cities, annual",
  10: "Hong Kong, Macao and Taiwan, annual",
  12: "Three major economies, monthly", 13: "International commodity prices, monthly", 14: "Major countries, annual",
};
const DATASET_ORDER = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 13, 14];
interface CatalogStats { generatedAt: string; seriesCount: number; storedCount?: number; officialEnglishCount?: number; categoryCount: number; categories: { name: string; count: number }[]; datasets: DatasetStat[]; }
interface Release { id: string; date: string; title: string; en: string; keys: string[]; categories: string[]; }
interface Vintage { value: number | null; fetchedAt: string; }
interface Revised { label: string; period: string; vintages: Vintage[]; }

type Route =
  | { view: "home" }
  | { view: "series"; keys: string[]; show: string; range: string; region: string; from: string; to: string; freq: string; agg: string; lny: string }
  | { view: "search"; q: string; freq: string; cat: string; dataset: string; geo: string }
  | { view: "browse"; cat: string }
  | { view: "releases"; month: string }
  | { view: "regions"; period: string; key: string }
  | { view: "methodology"; key: string }
  | { view: "health" }
  | { view: "province"; code: string }
  | { view: "theme"; name: string }
  | { view: "saved" }
  | { view: "recent" };

type Tab = "chart" | "table";
type Show = "default" | "raw" | "change" | "percent_change" | "yoy" | "index_growth";

// ── Guards ────────────────────────────────────────────────────────────────────

function obj(value: unknown, key: string): unknown { return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined; }
function str(value: unknown, key: string): string { const found = obj(value, key); return typeof found === "string" ? found : ""; }
function num(value: unknown, key: string): number | null { const found = obj(value, key); return typeof found === "number" ? found : null; }
function listOf(value: unknown, key: string): unknown[] { const found = obj(value, key); return Array.isArray(found) ? found : []; }
function isCurated(value: unknown): value is CuratedEntry {
  return typeof value === "object" && value !== null && typeof obj(value, "key") === "string" && typeof obj(value, "title") === "string" && typeof obj(value, "group") === "string";
}
function isNbsEntry(value: unknown): value is NbsCatalogEntry {
  const categories = obj(value, "categories");
  return typeof value === "object" && value !== null && typeof obj(value, "key") === "string" && typeof obj(value, "id") === "string"
    && typeof obj(value, "name") === "string" && typeof obj(value, "datasetCode") === "number" && Array.isArray(categories);
}
function isSearchResponse(value: unknown): value is SearchResponse {
  const results = obj(value, "results");
  return typeof obj(value, "total") === "number" && Array.isArray(results) && results.every(isNbsEntry);
}
function isStats(value: unknown): value is CatalogStats {
  return typeof obj(value, "seriesCount") === "number" && Array.isArray(obj(value, "categories")) && Array.isArray(obj(value, "datasets"));
}
function isSeriesResult(value: unknown): value is SeriesResult {
  return typeof obj(value, "key") === "string" && Array.isArray(obj(value, "series"));
}
function isShow(value: string): value is Show {
  return value === "default" || value === "raw" || value === "change" || value === "percent_change" || value === "yoy" || value === "index_growth";
}

// ── Vocabulary ────────────────────────────────────────────────────────────────

const SHOW_OPTIONS: { value: Show; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "raw", label: "Level" },
  { value: "change", label: "Change from previous period" },
  { value: "percent_change", label: "% change from previous period" },
  { value: "yoy", label: "% change from a year ago" },
  { value: "index_growth", label: "Index minus 100 (= % change)" },
];
const RANGES: { label: string; years: number | null }[] = [
  { label: "1Y", years: 1 }, { label: "5Y", years: 5 }, { label: "10Y", years: 10 }, { label: "20Y", years: 20 }, { label: "Max", years: null },
];
const CHART_TOKENS = ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5", "--chart-6", "--chart-7", "--chart-8"];
// A dash per slot so identity is never hue alone (a colour-vision requirement).
const DASHES = ["", "6 3", "2 3", "8 3 2 3", "", "6 3", "2 3", "8 3 2 3"];

/** English for the NBS top-level categories. The Chinese stays authoritative. */
const CATEGORY_EN: Record<string, string> = {
  "对外经济": "Foreign trade and investment", "采购经理指数": "Purchasing managers' index", "城镇调查失业率": "Surveyed urban unemployment", "服务业生产指数": "Index of services production",
  "工业": "Industry", "价格指数": "Price indices", "固定资产投资 (不含农户)": "Fixed-asset investment (excl. rural households)",
  "固定资产投资（不含农户）": "Fixed-asset investment (excl. rural households)", "国内贸易": "Domestic trade", "邮电通信": "Post and telecommunications",
  "交通运输": "Transport", "人民生活": "Household living standards", "能源": "Energy", "国民经济核算": "National accounts",
  "财政": "Public finance", "金融": "Finance", "对外经济贸易": "Foreign trade and investment", "农业": "Agriculture", "房地产": "Real estate",
  "建筑业": "Construction", "就业和工资": "Employment and wages", "人口": "Population", "旅游": "Tourism", "综合": "Overview",
  "科学技术": "Science and technology", "教育": "Education", "卫生": "Health", "环境": "Environment", "文化": "Culture",
  "社会保障": "Social security", "劳动": "Labour", "就业": "Employment", "工资": "Wages", "价格": "Prices",
  "科技": "Science and technology",
  "批发和零售业": "Wholesale and retail trade",
  "固定资产投资和房地产": "Fixed-asset investment and real estate",
  "住宿和餐饮业": "Accommodation and catering",
  "运输和邮电": "Transport, post and telecommunications",
  "公共管理、社会保障及其他": "Public administration, social security and other",
  "体育": "Sport",
  "就业人员和工资": "Employment and wages",
  "资源和环境": "Resources and environment",
  "金融业": "Finance",
  "社会服务": "Social services",
  "城市概况": "City profile",
  "旅游业": "Tourism",
  "经济": "Economy",
  "国际市场商品价格指数 (2010=100)": "World commodity price indices (2010 = 100)",
  "贸易": "Trade",
  "货币": "Money",
  "贫困与收入": "Poverty and income",
  "居民收入与价格": "Household income and prices",
  "能源生产和使用": "Energy production and use",
  "劳动力与就业": "Labour force and employment",
  "财政金融": "Public finance and money",
  "开发区高新技术企业主要经济指标": "High-technology enterprises in development zones",
  "政府财政": "Government finance",
  "教育、卫生、文化": "Education, health and culture",
  "财政和金融": "Public finance and money",
  "交通和通讯": "Transport and communications",
  "投资环境": "Investment climate",
  "交通": "Transport",
  "人口和就业": "Population and employment",
  "噪声监测": "Noise monitoring",
  "信息科技": "Information technology",
  "贸易经济": "Trade and economy",
  "进出口": "Imports and exports",
  "工业生产增长率": "Industrial production growth",
  "零售额增长率": "Retail sales growth",
  "失业率": "Unemployment rate",
  "消费者价格涨跌幅": "Consumer price change",
  "国际市场商品价格": "World commodity prices",
  "社会消费品零售总额": "Retail sales of consumer goods",
};
/** English for the units NBS writes. */
const UNIT_EN: Record<string, string> = {
  "亿元": "100 million yuan", "万元": "10,000 yuan", "亿美元": "100 million US dollars", "万美元": "10,000 US dollars",
  "万吨": "10,000 tonnes", "吨": "tonnes", "万吨标准煤": "10,000 t of standard coal", "亿千瓦时": "100 million kWh", "万千瓦时": "10,000 kWh",
  "万人": "10,000 persons", "人": "persons", "万辆": "10,000 vehicles", "辆": "vehicles", "万平方米": "10,000 m²", "万台": "10,000 units",
  "亿件": "100 million pieces", "万件": "10,000 pieces", "万户": "10,000 households", "个": "count", "%": "%", "无": "no unit",
  "上年同期=100": "index, prior-year period = 100", "上年同月=100": "index, prior-year month = 100", "上月=100": "index, prior month = 100",
  "上年=100": "index, prior year = 100", "元": "yuan", "亿": "100 million", "万": "10,000", "百分点": "percentage points", "天": "days", "小时": "hours",
  // The rest of the server's unit dictionary (gloss.ts), so a result line never shows a bare Chinese unit the series page glosses.
  "亿立方米": "100 million m³", "万立方米": "10,000 m³", "万千瓦": "10,000 kW", "千瓦": "kW", "亿米": "100 million metres", "万米": "10,000 metres",
  "万千升": "10,000 kilolitres", "亿吨公里": "100 million tonne-km", "亿人公里": "100 million passenger-km", "万公里": "10,000 km", "台": "units", "户": "households",
  "上年同季=100": "index, prior-year quarter = 100", "2015年=100": "index, 2015 = 100", "2020年=100": "index, 2020 = 100",
  "件": "pieces", "项": "items", "百万美元": "million USD", "所": "institutions", "人年": "person-years", "万人次": "10,000 person-times", "千公顷": "1,000 hectares", "1/10万": "per 100,000", "篇": "papers", "万人年": "10,000 person-years", "种": "kinds", "日": "days", "千人次": "1,000 person-times", "米": "metres", "次": "times", "万个": "10,000 units", "公斤/公顷": "kg per hectare", "亿千瓦小时": "100 million kWh", "千克": "kg", "公里": "km", "万场次": "10,000 performances", "时": "hours", "起": "cases", "千场次": "1,000 performances", "件/套": "pieces or sets", "公斤": "kg", "万张": "10,000 sheets", "部": "units", "万册": "10,000 volumes", "亿吨": "100 million tonnes", "张": "sheets", "元/公斤": "yuan per kg", "批": "batches", "万盒": "10,000 boxes", "亿印张": "100 million printed sheets", "万公顷": "10,000 hectares", "座": "units", "亿册": "100 million volumes", "上年价格=100": "index, prior-year prices = 100", "元/人": "yuan per person", "亿人次": "100 million person-times", "万头": "10,000 head", "元/户": "yuan per household", "人次": "person-times", "处": "sites", "集": "episodes", "万分钟": "10,000 minutes", "公斤/人": "kg per person", "份": "copies", "家": "firms", "人口抽样调查": "population sample survey", "起/万人": "cases per 10,000 people", "公顷": "hectares", "万册、份": "10,000 volumes or copies", "套": "sets", "千美元": "thousand USD", "万份": "10,000 copies", "教师人数=1": "per teacher", "1978年=100": "index, 1978 = 100", "盒、张": "boxes or sheets", "亿条": "100 million messages", "万笔": "10,000 transactions", "架": "aircraft", "万部": "10,000 units", "万套": "10,000 sets", "万只": "10,000 head", "万件、套": "10,000 pieces or sets", "亿人": "100 million persons", "万千米": "10,000 km", "千米": "km",
};
/** Two sentences each, written for a reader rather than a catalog. */
const ABOUT: Record<string, string> = {
  gdp: "Real GDP growth, year over year, from the NBS quarterly national accounts. Constant-price series are chain-linked by base period, and quarterly values are not seasonally adjusted.",
  provincial_industry: "Growth in the value added of large industrial firms, by province, for the month and the year to date. NBS publishes it for the 31 provinces a few days after the national figure, around the 20th.",
  provincial_cpi: "A province's consumer price index against a year earlier, from NBS's provincial monthly table. The bureau republishes the table every five years; the earlier ones are stitched behind the current one.",
  provincial_gdp: "Guangdong's real GDP growth as reported by the provincial bureau. NBS publishes it as a cumulative year-to-date index against the same period a year earlier, so the Q2 figure is first-half growth.",
  industrial_production: "Value added of industrial enterprises above designated size (annual revenue over 20 million yuan), year over year. January and February are published together to avoid Lunar New Year distortion. The February point carries the combined January-February figure and there is no January point.",
  cpi: "Consumer price index, year over year, from the NBS monthly price survey. Food carries a large weight, so pork and vegetable prices move the headline more than in most economies.",
  ppi: "Producer price index for industrial products at the factory gate, year over year. It tracks commodity prices closely and turns negative in deflationary stretches.",
  retail_by_category: "What above-scale retailers sold in the month, by commodity, from NBS's monthly tables: motor vehicles, oil products, food, clothing, appliances, phones, furniture, building materials, jewellery, cosmetics, medicines, tobacco and alcohol. Above-scale units are firms over a revenue threshold, so this is a large share of retail rather than all of it.",
  retail_by_category_growth: "Growth on a year earlier of each commodity category's retail sales. Motor vehicles are the largest category and the one the car market is read from, since the trade associations' unit-sales releases are not reachable from here.",
  gdp_nominal: "Output at current prices in the quarter, for the whole economy and its three sectors, from NBS's quarterly table. The headline GDP series on this site is the real growth rate; this is the level that ratios need, such as debt to GDP or a sector's share.",
  gdp_nominal_ytd: "The same current-price output, cumulative from the start of the year; the fourth quarter is the year.",
  gdp_by_industry: "Value added at current prices in the quarter by industry, from the same table: manufacturing and industry inside the secondary sector, then real estate, finance, wholesale and retail, construction, information technology, transport, agriculture, leasing and business services, accommodation and catering, and everything else.",
  port_throughput: "Tonnage handled at China's ports in the month, from NBS's monthly table: all ports, the foreign-trade cargo inside that, and the coastal ports' share. The 2005-2018 table is stitched behind the one the bureau began in 2019.",
  port_throughput_growth: "Growth on a year earlier of port tonnage, for the month and the year to date, as NBS prints them beside the levels.",
  cross_border_flows: "What banks received from and paid to non-residents on their customers' behalf (银行代客涉外收付款), from SAFE's monthly workbook: the net, the two sides, and the net split by current account, goods, services and the capital and financial account. Wider than FX settlement, which counts only the currency actually exchanged.",
  cross_border_flows_usd: "The same cross-border flows valued in US dollars, from the dollar sheet of SAFE's workbook.",
  tax_by_type: "The main taxes from the Ministry of Finance's monthly fiscal release, each January to the month in 亿元: domestic VAT, corporate and personal income tax, consumption tax, import VAT, tariffs, export rebates (a deduction, shown as printed), stamp duty and the securities stamp duty within it, land appreciation tax, deed tax and vehicle purchase tax.",
  tax_by_type_growth: "Growth on a year earlier of each main tax, year to date, as the ministry prints it. A month the ministry describes as more than doubled rather than in percent has no point.",
  lgb_issuance: "Local government bonds issued in the month, from the Ministry of Finance's Debt Management Department release, in total and split two ways: general against special bonds, and new against refinancing bonds. Published about six weeks after the month.",
  lgb_debt: "Local government debt outstanding at the month's end from the same release: total, general and special. Bonds are nearly all of it; the remainder is legacy non-bond debt.",
  lgb_rate: "The average issuance rate of local government bonds sold in the month, from the same release.",
  household_income_growth: "Per-capita disposable income from NBS's quarterly household survey, year to date, nominal growth on a year earlier, for all residents and for the urban and rural tables published beside it. The fourth quarter is the full year.",
  household_income: "Per-capita disposable income in yuan, year to date, from the quarterly household survey; the fourth quarter is the full year.",
  household_spending_growth: "Per-capita consumption spending from the quarterly household survey, year to date, nominal growth on a year earlier, all residents and urban and rural.",
  household_spending: "Per-capita consumption spending in yuan, year to date, from the quarterly household survey.",
  services_production: "NBS's index of services production, the services counterpart of industrial production: growth on a year earlier for the month and for the year to date. January and February are published together, so the month line's February value covers both months.",
  working_hours: "Average hours worked per week by enterprise employees, from NBS's monthly labour force survey: the one measure of labour intensity the bureau publishes monthly.",
  employment: "NBS's year-end count of employed persons, total and by urban and rural residence, from the annual dataset. China publishes no monthly labour force participation rate.",
  population_nbs: "NBS's year-end population, total and by urban and rural residence. The World Bank series on the site is a UN estimate on a different basis.",
  population_rates: "Births, deaths and natural growth per thousand population, annual, from NBS. Natural growth turned negative in 2022.",
  population_age: "Year-end population by age group from NBS's annual dataset: under 15, working age 15 to 64, and 65 and over.",
  migrant_workers: "NBS's quarterly count of rural labour working away from home (外出务工农村劳动力), at the quarter's end, from the migrant-worker monitoring survey. There is no fourth-quarter reading; the annual survey covers the year.",
  migrant_workers_income: "Average monthly income of rural migrant workers away from home, from the same quarterly survey, in yuan.",
  unemployment: "Surveyed urban unemployment from the monthly labour force survey, with age breakdowns. The 16-24 series was suspended after June 2023 and resumed in December 2023 excluding students; the two segments are not comparable.",
  retail_sales: "Retail sales of consumer goods, nominal, year over year. Includes goods sold to households and to institutions; catering is included, most services are not. January and February are published together; the February point carries the combined figure and there is no January point.",
  money_supply: "M1 (cash plus demand deposits) and M2 (M1 plus savings and time deposits), year over year, from the People's Bank of China. M1 was redefined in January 2025 to include personal demand deposits.",
  new_loans: "New yuan-denominated loans extended by financial institutions in the month, from the PBOC. Strongly seasonal: January is always the largest month.",
  trade: "Merchandise exports and imports in US dollar terms, year over year, from the General Administration of Customs. Lunar New Year timing shifts January and February.",
  forex_reserves: "Official foreign exchange reserves held by the PBOC, in US dollars. Valuation effects from currency and bond prices move the total even with no intervention.",
  gold_reserves: "Official gold reserves held by the PBOC, valued in US dollars at market prices, so the series moves with the gold price as well as with purchases. The PBOC reports holdings in troy ounces; this is the dollar value from the same monthly release.",
  real_estate: "The national real estate climate index compiled by NBS from investment, sales, construction and financing indicators. 100 is neutral; below 95 is weak.",
  pmi: "The official NBS manufacturing purchasing managers' index, a diffusion index where 50 separates expansion from contraction. Weighted toward large state-owned firms.",
  caixin_pmi: "The Caixin/S&P Global manufacturing PMI, a private survey weighted toward smaller, export-oriented private firms. Often diverges from the official PMI.",
  caixin_services_pmi: "The Caixin/S&P Global services PMI, covering private service-sector firms. 50 separates expansion from contraction.",
  house_prices: "NBS surveys sales prices of newly built and existing commercial residential buildings in 70 large and medium cities each month. Values here are the index against the same month a year earlier, minus 100, so they read as a percentage change. The 70-city average is a simple mean of the city figures; NBS publishes no official composite.",
  fx_usdcny: "The onshore yuan against the US dollar, monthly average of daily fixings, from the Federal Reserve Board via FRED.",
  reer_bis: "The BIS real broad effective exchange rate: the yuan against a trade-weighted basket of 60 currencies, adjusted for relative consumer prices. A rise means the yuan is stronger in real terms.",
  credit_private_bis: "BIS credit to the private non-financial sector, households plus non-financial corporations, from banks and all other lenders, as a share of GDP. The standard measure of economy-wide leverage.",
  credit_households_bis: "BIS credit to households and non-profit institutions serving households, as a share of GDP.",
  credit_corporate_bis: "BIS credit to non-financial corporations, including state-owned enterprises, as a share of GDP.",
  gov_debt_imf: "IMF World Economic Outlook estimate of general government gross debt as a share of GDP. Excludes local government financing vehicles, which is why it reads lower than broader measures.",
  house_prices_real_bis: "BIS residential property price index for China, deflated by consumer prices, 2010 = 100.",
  epu: "The Economic Policy Uncertainty index built from the frequency of policy-uncertainty terms in mainland Chinese newspapers, by Baker, Bloom and Davis.",
  tpu: "The Trade Policy Uncertainty index built from mainland Chinese newspapers, by Baker, Bloom and Davis.",
  oecd_cli: "The OECD composite leading indicator for China, amplitude adjusted, designed to signal turning points in activity about six months ahead.",
  consumer_confidence_oecd: "OECD standardised consumer confidence for China, long-term average = 100.",
  shibor_3m: "The 3-month interbank offered rate, from the People's Bank of China via the OECD.",
  us_imports_from_china: "US goods imports from China on a customs basis, not seasonally adjusted, from the US Census Bureau.",
  us_exports_to_china: "US goods exports to mainland China on a free-alongside-ship basis, not seasonally adjusted, from the US Census Bureau.",
  us_treasury_holdings: "China's holdings of US Treasury securities, long- and short-term, from the Treasury International Capital system.",
  us_import_prices_china: "The US Bureau of Labor Statistics import price index for goods from China, all industries, December 2003 = 100.",
  golden_dragon: "The NASDAQ Golden Dragon China index of US-listed Chinese companies, shown as a monthly average of daily closes.",
  population: "World Bank total population estimate, in millions.",
  fertility: "World Bank total fertility rate, births per woman.",
  population_65: "World Bank estimate of the share of the population aged 65 and over.",
  life_expectancy: "World Bank life expectancy at birth, both sexes.",
  gdp_usd: "World Bank GDP at current US dollars, in trillions.",
  gdp_per_capita_usd: "World Bank GDP per capita at current US dollars.",
  gini: "World Bank Gini index of income inequality, 0 (perfect equality) to 100. Published for survey years only.",
  electricity_output: "Electricity output of industrial enterprises above designated size, year over year, from the NBS monthly energy production release. Watched as a proxy for industrial activity because generation is hard to smooth. January and February are published together; the February point carries the combined figure and there is no January point.",
  lpr: "The loan prime rate, the benchmark for new bank lending, set monthly by the PBOC from quotes by 18 banks. The 1-year rate anchors corporate loans; the 5-year rate anchors mortgages.",
};
const READING: Record<string, string[]> = {
  migrant_workers: ["A quarter-end stock, not a flow: compare with the same quarter a year earlier, since the count falls every first quarter around the Lunar New Year.", "MOHRSS's urban new jobs (城镇新增就业) is not on the site: the ministry's portal answers with a script challenge."],
  unemployment: [
    "The youth rate rises every summer as graduates enter the labour market, so compare July with July, not with June.",
    "The urban survey excludes most rural migrant workers who return home when work ends, so it understates slack relative to a total-labour-force measure.",
    "Figures are not seasonally adjusted; Lunar New Year shifts between January and February and distorts both months.",
  ],
  cpi: ["Food is roughly a fifth of the basket; pork alone can swing the headline by a few tenths.", "Core CPI (excluding food and energy) is published alongside and is usually the steadier read."],
  gdp: ["The 不变价 (constant-price) level series is at prior-year prices, so arithmetic year-over-year on it is not the headline growth rate; use the growth series NBS publishes.", "Quarterly GDP is revised after the annual figure and again after economic censuses; the store keeps every vintage."],
  provincial_gdp: ["Provincial GDP figures have historically summed to more than the national total; treat cross-province ranking as indicative.", "The series is cumulative year-to-date: Q4 equals the full year."],
  trade: ["Customs reports in US dollars and in yuan; the two growth rates diverge when the exchange rate moves.", "Front-loading ahead of tariff changes shows up as spikes that reverse within a quarter."],
  pmi: ["Diffusion indices measure breadth, not magnitude: 49 with a large firm base can coincide with rising output.", "The official PMI leans to large state firms; the Caixin PMI to smaller private exporters."],
};
const BREAKS: { key: string; match: RegExp; from: string; to: string; before: string; after: string; note: string }[] = [
  {
    key: "unemployment", match: /16-24/, from: "2023-07", to: "2023-11",
    before: "Youth 16-24, incl. students (%)", after: "Youth 16-24, ex-students (%)",
    note: "NBS suspended the 16-24 unemployment rate after June 2023 and resumed it in December 2023 on a new basis that excludes students. Readings before and after the shaded gap are not comparable, and a change across it should not be read as a change in labour-market conditions.",
  },
];

// ── Small helpers ─────────────────────────────────────────────────────────────

const CJK = /[㐀-鿿]/;
function Zh(props: { children: string; className?: string }) {
  return CJK.test(props.children) ? <span lang="zh-Hans" className={props.className}>{props.children}</span> : <span className={props.className}>{props.children}</span>;
}
function unitEn(unit: string): string { return UNIT_EN[unit] ?? ""; }
/** A stored series whose last period is more than two years old has stopped publishing. */
function isEndedPeriod(lastPeriod: string): boolean { const year = Number(lastPeriod.slice(0, 4)); return Number.isFinite(year) && new Date().getUTCFullYear() - year > 2; }
/** "A", "A and B", "A, B and C". */
function listWords(items: string[]): string { return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`; }
function unitLabel(unit: string): string {
  if (!unit) return "Unit not stated";
  if (unit === "%") return "Percent";
  // English first, the Chinese alongside: "100 million yuan (亿元)".
  const en = unitEn(unit);
  return en && en !== unit ? `${en} (${unit})` : unit;
}
function categoryEn(name: string): string { return CATEGORY_EN[name] ?? ""; }
/** A category path in English where the translation table has it, otherwise the Chinese, never a middle dot. */
/** The year-range suffix on a sliced NBS table's category, in either language: (2016-2020), (-2015), (to 2015), (2026-). */
const SLICE_SUFFIX = /\s*[（(]\s*(?:to\s+\d{4}|\d{4}\s*[-–]\s*(?:\d{4}|present|至今)?|[-–]\s*\d{4})\s*[)）]\s*$/i;
function categoryPath(entry: { categories: string[]; categoriesEn?: string[]; family?: { span: string } }): React.ReactNode {
  const strip = (text: string) => (entry.family ? text.replace(SLICE_SUFFIX, "") : text);
  // The curated English name first, so a category reads the same on its own page and on every card.
  const english = entry.categories.map((category, index) => strip(categoryEn(category) || entry.categoriesEn?.[index] || category));
  const chinese = entry.categories.map(strip).join(" › ");
  const englishPath = english.join(" › ");
  if (englishPath === chinese) return <Zh>{chinese}</Zh>;
  return <><Zh>{englishPath}</Zh><Zh className="gloss block">{chinese}</Zh></>;
}

function chartColor(index: number): string { return `var(${CHART_TOKENS[index % CHART_TOKENS.length]})`; }

async function json(url: string): Promise<unknown> {
  const response = await fetch(url);
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(str(body, "error") || `Request failed (${response.status})`);
  return body;
}
function readList(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch { return []; }
}
function writeList(key: string, values: string[]): void { try { localStorage.setItem(key, JSON.stringify(values)); } catch { /* private mode */ } }
function readPref(key: string): string { try { return localStorage.getItem(key) ?? ""; } catch { return ""; } }
function writePref(key: string, value: string): void { try { localStorage.setItem(key, value); } catch { /* private mode */ } }

// ── Routing ───────────────────────────────────────────────────────────────────

function parseRoute(hash: string): Route {
  const [path = "", queryText = ""] = hash.replace(/^#/, "").split("?");
  const query = new URLSearchParams(queryText);
  const parts = path.split("/").filter(Boolean);
  const head = parts[0] ?? "";
  if (head === "series" && parts[1]) {
    return { view: "series", keys: parts[1].split(",").filter(Boolean).slice(0, 4), show: query.get("show") ?? "", range: query.get("range") ?? "", region: query.get("region") ?? "", from: query.get("from") ?? "", to: query.get("to") ?? "", freq: query.get("freq") ?? "", agg: query.get("agg") ?? "", lny: query.get("lny") ?? "" };
  }
  if (head === "search") return { view: "search", q: query.get("q") ?? "", freq: query.get("freq") ?? "", cat: query.get("cat") ?? "", dataset: query.get("dataset") ?? "", geo: query.get("geo") ?? "" };
  if (head === "browse") return { view: "browse", cat: "" };
  if (head === "category" && parts[1]) return { view: "search", q: "", freq: "", cat: decodeURIComponent(parts[1]), dataset: "", geo: "" };
  if (head === "releases") return { view: "releases", month: query.get("month") ?? "" };
  if (head === "regions") return { view: "regions", period: query.get("period") ?? "", key: query.get("key") ?? "" };
  if (head === "methodology") return { view: "methodology", key: query.get("key") ?? "" };
  if (head === "health") return { view: "health" };
  if (head === "province") return { view: "province", code: query.get("code") ?? "" };
  if (head && THEME_PAGES.some((page) => page.name === head)) return { view: "theme", name: head };
  if (head === "saved") return { view: "saved" };
  if (head === "recent") return { view: "recent" };
  return { view: "home" };
}
function routeHash(route: Route): string {
  const qs = (pairs: [string, string][]) => { const query = new URLSearchParams(pairs.filter(([, value]) => value)); const text = query.toString(); return text ? `?${text}` : ""; };
  switch (route.view) {
    case "home": return "#/";
    case "series": return `#/series/${route.keys.join(",")}${qs([["show", route.show], ["range", route.range], ["region", route.region], ["from", route.from], ["to", route.to], ["freq", route.freq], ["agg", route.agg], ["lny", route.lny]])}`;
    case "search": return `#/search${qs([["q", route.q], ["freq", route.freq], ["cat", route.cat], ["dataset", route.dataset], ["geo", route.geo]])}`;
    case "browse": return "#/browse";
    case "releases": return `#/releases${qs([["month", route.month]])}`;
    case "regions": return `#/regions${qs([["period", route.period], ["key", route.key]])}`;
    case "methodology": return `#/methodology${qs([["key", route.key]])}`;
    case "health": return "#/health";
    case "province": return `#/province${qs([["code", route.code]])}`;
    case "theme": return `#/${route.name}`;
    case "saved": return "#/saved";
    case "recent": return "#/recent";
  }
}
function seriesHash(keys: string[], extra: Partial<{ show: string; range: string; region: string; from: string; to: string }> = {}): string {
  return routeHash({ view: "series", keys, show: extra.show ?? "", range: extra.range ?? "", region: extra.region ?? "", from: extra.from ?? "", to: extra.to ?? "", freq: "", agg: "", lny: "" });
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function SearchIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m16 16 5 5" /></svg>; }
function StarIcon(props: { filled: boolean }) { return <svg viewBox="0 0 24 24" aria-hidden="true" className={props.filled ? "filled" : ""}><path d="m12 2.8 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3-5.6-3-5.6 3 1.1-6.3-4.6-4.5 6.3-.9z" /></svg>; }
function ThemeIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 4v16a8 8 0 0 0 0-16z" fill="currentColor" stroke="none" /></svg>; }

// ── Data shaping for charts ───────────────────────────────────────────────────


function applyBreaks(result: SeriesResult): { series: Series[]; notes: string[]; gaps: { from: string; to: string }[] } {
  const notes: string[] = [];
  const gaps: { from: string; to: string }[] = [];
  const series: Series[] = [];
  for (const one of result.series) {
    const rule = BREAKS.find((item) => item.key === result.key && item.match.test(one.label));
    if (!rule) { series.push(one); continue; }
    // Both halves are one statistic: same hue, and the earlier basis dashed.
    series.push({ label: rule.before, points: one.points.filter((point) => point.date < rule.from), shareColorWith: rule.after, dashed: true });
    series.push({ label: rule.after, points: one.points.filter((point) => point.date > rule.to), dashed: false });
    notes.push(rule.note);
    gaps.push({ from: rule.from, to: rule.to });
  }
  // The NBS annotation is shown in the Notes card below the chart, in both languages, not as a caption.
  return { series, notes, gaps };
}

function buildTracks(results: SeriesResult[], colors: Map<string, number>): { tracks: Track[]; notes: string[]; gaps: { from: string; to: string }[] } {
  const tracks: Track[] = [];
  const notes: string[] = [];
  const gaps: { from: string; to: string }[] = [];
  // A label stands alone on a compare when no other track shares it; otherwise the series title is prefixed.
  const labelCounts = new Map<string, number>();
  for (const result of results) for (const one of applyBreaks(result).series) labelCounts.set(one.label, (labelCounts.get(one.label) ?? 0) + 1);
  for (const result of results) {
    const shaped = applyBreaks(result);
    notes.push(...shaped.notes.filter((note) => !notes.includes(note)));
    gaps.push(...shaped.gaps);
    for (const one of shaped.series) {
      const ident = result.spec ?? result.key;
      const id = `${ident} ${one.label}`;
      const colorId = one.shareColorWith ? `${ident} ${one.shareColorWith}` : id;
      if (!colors.has(colorId)) {
        const used = new Set(colors.values());
        let slot = 0;
        while (used.has(slot)) slot += 1;
        colors.set(colorId, slot);
      }
      const slot = colors.get(colorId) ?? 0;
      tracks.push({
        id, name: results.length > 1 ? (results.every((other) => other.key === result.key) && result.region ? regionLabel(result.region) : shaped.series.length === 1 ? displayTitle(result, results) : labelCounts.get(one.label) === 1 ? one.label : `${displayTitle(result, results)}: ${one.label}`) : one.label, unit: result.unit, frequency: result.frequency,
        color: chartColor(slot), dash: one.dashed ? "6 3" : one.dashed === false ? "" : (DASHES[slot % DASHES.length] ?? ""),
        points: one.points.map((point) => ({ t: periodTime(point.date), v: point.value, p: point.date })).filter((point) => Number.isFinite(point.t)),
        // februaryFrom marks a February taken from the year-to-date sibling, which is the combined
        // January-February figure; only such a series has a whole quarter in two monthly readings.
        combinedFebruary: result.metadata?.februaryFrom !== undefined,
      });
    }
  }
  return { tracks, notes, gaps };
}



// ── Chart ─────────────────────────────────────────────────────────────────────

function ChartTip(props: { active?: boolean; payload?: unknown[]; unit: string }) {
  if (!props.active || !props.payload || props.payload.length === 0) return null;
  const first = props.payload[0];
  const period = str(obj(first, "payload"), "p");
  return (
    <div className="chart-tip" role="presentation">
      <b>{periodPretty(period)}</b>
      {props.payload.map((item, index) => {
        const value = num(obj(item, "payload"), "v");
        const color = str(item, "color") || str(item, "stroke");
        const name = str(item, "name");
        return <div key={index}><i style={{ color }} /><span className="n">{name}</span><span className="v">{value === null ? "—" : fmt(value, props.unit)}</span></div>;
      })}
    </div>
  );
}

function SeriesChart(props: { tracks: Track[]; gaps: { from: string; to: string }[]; years: number | null; logScale: boolean; lunar: boolean; unit: string; title: string; start?: number; end?: number }) {
  const shown = visibleTracks(props.tracks, props.years, props.start, props.end);
  const times = shown.flatMap((track) => track.points.map((point) => point.t));
  const min = Math.min(...times), max = Math.max(...times);
  const spanYears = (max - min) / (365.25 * 86400000);
  // Annual points are dated December of their year, so their year labels sit on the points themselves
  // rather than at the following January, where each value would read a year late.
  const annual = shown.length > 0 && shown.every((track) => track.frequency === "Annual");
  const tick = (value: number) => {
    const date = new Date(value);
    return annual || spanYears > 6 ? String(date.getUTCFullYear()) : date.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
  };
  const tickMonth = annual ? new Date(min).getUTCMonth() : 0;
  const ticks = annual || spanYears > 6
    ? Array.from({ length: new Date(max).getUTCFullYear() - new Date(min).getUTCFullYear() + 1 }, (_, index) => Date.UTC(new Date(min).getUTCFullYear() + index, tickMonth, 1)).filter((value) => value >= min && value <= max)
    : undefined;
  const hasZero = isRate(props.unit) && !props.logScale;
  const shownValues = shown.flatMap((track) => track.points.map((point) => point.v));
  const yScale = niceTicks(Math.min(...shownValues), Math.max(...shownValues), 5);
  // Lunar New Year falls in January or February and shifts between them, so
  // monthly comparisons across that window mislead. Shade it, faintly, on
  // monthly charts short enough for the bands to read.
  const lunar = props.lunar && props.tracks.some((track) => track.frequency === "Monthly") && spanYears <= 12
    ? Array.from({ length: new Date(max).getUTCFullYear() - new Date(min).getUTCFullYear() + 1 }, (_, index) => new Date(min).getUTCFullYear() + index)
      .map((year) => ({ year, x1: Date.UTC(year, 0, 1), x2: Date.UTC(year, 2, 1) })).filter((band) => band.x2 >= min && band.x1 <= max)
    : [];
  const indexBase = /=100|= 100/.test(props.unit) ? 100 : null;
  const description = `${props.title}. ${shown.length} series, ${props.unit}. Arrow keys step through the points; the Table tab lists the values.`;
  return (
    <div className="chart-wrap" style={{ width: "100%", height: 460 }}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={0}>
        <LineChart margin={{ top: 12, right: 24, bottom: 4, left: 4 }} title={props.title} desc={description}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis type="number" dataKey="t" domain={[min, max]} scale="time" ticks={ticks} tickFormatter={tick} minTickGap={48} tickMargin={10} tick={{ fontSize: 11, fill: "var(--muted)" }} stroke="var(--line-strong)" tickLine={false} />
          <YAxis width={64} scale={props.logScale ? "log" : "auto"} domain={props.logScale ? ["auto", "auto"] : [yScale.lo, yScale.hi]} ticks={props.logScale ? undefined : yScale.ticks} tickFormatter={fmtTick} tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
          {hasZero && <ReferenceLine y={0} stroke="var(--line-strong)" />}
          {indexBase !== null && !props.logScale && <ReferenceLine y={indexBase} stroke="var(--line-strong)" />}
          {lunar.map((band) => <ReferenceArea key={`lny-${band.year}`} x1={Math.max(band.x1, min)} x2={Math.min(band.x2, max)} fill="var(--ink)" fillOpacity={0.035} stroke="none" />)}
          {props.gaps.map((gap) => (
            <ReferenceArea key={gap.from} x1={periodTime(gap.from)} x2={periodTime(gap.to)} fill="var(--amber)" fillOpacity={0.09} stroke="var(--amber)" strokeOpacity={0.5} strokeDasharray="4 4" label={{ value: "series suspended", position: "insideTop", fontSize: 10, fill: "var(--amber)" }} />
          ))}
          <Tooltip content={<ChartTip unit={props.unit} />} cursor={{ stroke: "var(--line-strong)" }} isAnimationActive={false} />
          {shown.map((track) => (
            <Line key={track.id} data={track.points} dataKey="v" name={track.name} type="linear" stroke={track.color} strokeWidth={2} strokeDasharray={track.dash || undefined} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--panel)" }} isAnimationActive={false} connectNulls={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Exports ───────────────────────────────────────────────────────────────────


// ── Sidebar ───────────────────────────────────────────────────────────────────

function Sidebar(props: { stats: CatalogStats | null; curated: CuratedEntry[]; route: Route; saved: string[]; recent: string[] }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  // On a phone the catalog is a panel above the page; following a link in it closes it, so the
  // reader lands on the series rather than under the catalog.
  useEffect(() => { setMobileOpen(false); }, [routeHash(props.route)]);
  const groups = new Map<string, CuratedEntry[]>();
  for (const entry of props.curated) groups.set(entry.group, [...(groups.get(entry.group) ?? []), entry]);
  const activeKey = props.route.view === "series" ? splitSpec(props.route.keys[0] ?? "").key : "";
  const activeCat = props.route.view === "search" ? props.route.cat : "";
  const activeDataset = props.route.view === "search" ? props.route.dataset : "";
  return (
    <aside className={`sidebar${mobileOpen ? " mobile-open" : ""}`} aria-label="Catalog">
      <button className="catalog-toggle" type="button" aria-expanded={mobileOpen} aria-controls="catalog-navigation" onClick={() => setMobileOpen((open) => !open)}>
        <span>Browse data</span><span aria-hidden="true">{mobileOpen ? "Close" : "Open"}</span>
      </button>
      <div className="sidebar-content" id="catalog-navigation">
      <details open>
        <summary>Headline Indicators</summary>
        <div className="side-list">
          {[...groups.entries()].map(([group, entries]) => (
            <React.Fragment key={group}>
              <div className="group-label">{group}</div>
              {entries.map((entry) => (
                <a key={entry.key} className="nav-row" href={seriesHash([entry.key])} aria-current={activeKey === entry.key ? "page" : undefined}>
                  <span className="label"><span className="nav-title">{entry.title}</span><small>{entry.frequency}{entry.agency !== "National Bureau of Statistics" ? `, ${entry.agency}` : ""}</small></span>
                </a>
              ))}
            </React.Fragment>
          ))}
        </div>
      </details>
      <details>
        <summary>Browse</summary>
        <div className="side-list">
          <div className="group-label">Datasets</div>
          {props.stats?.datasets.map((dataset) => (
            <a key={dataset.code} className="nav-row" href={routeHash({ view: "search", q: "", freq: "", cat: "", dataset: String(dataset.code), geo: "" })} aria-current={activeDataset === String(dataset.code) ? "page" : undefined} aria-label={`${dataset.geography} ${dataset.frequency.toLowerCase()} dataset, ${dataset.count.toLocaleString("en-US")} series`}>
              <span className="label"><span className="nav-title">{dataset.geography} {dataset.frequency.toLowerCase()}</span><small>{dataset.count.toLocaleString("en-US")} series</small></span>
            </a>
          ))}
          <div className="group-label">Categories</div>
          {props.stats?.categories.map((category) => (
            <a key={category.name} className="nav-row" href={`#/category/${encodeURIComponent(category.name)}`} aria-current={activeCat === category.name ? "page" : undefined}>
              <span className="label"><span className="nav-title"><Zh>{category.name}</Zh></span>{categoryEn(category.name) && <small>{categoryEn(category.name)}</small>}</span>
              <span className="count">{category.count.toLocaleString("en-US")}</span>
            </a>
          ))}
        </div>
      </details>
      <details>
        <summary>Saved and Recent</summary>
        <div className="side-list">
          <a className="nav-row" href="#/saved" aria-current={props.route.view === "saved" ? "page" : undefined}><span className="label">Saved series</span><span className="count">{props.saved.length}</span></a>
          <a className="nav-row" href="#/recent" aria-current={props.route.view === "recent" ? "page" : undefined}><span className="label">Recently viewed</span><span className="count">{props.recent.length}</span></a>
          <a className="nav-row" href="#/methodology" aria-current={props.route.view === "methodology" ? "page" : undefined}><span className="label">How these figures are made</span></a>
          <a className="nav-row" href="#/health" aria-current={props.route.view === "health" ? "page" : undefined}><span className="label">Data health</span></a>
        </div>
      </details>
      </div>
    </aside>
  );
}

// ── Home ──────────────────────────────────────────────────────────────────────

const HERO_KEYS = ["gdp", "cpi", "unemployment", "pmi"];
// Briefing order: activity, then prices and labour, property, money and rates, the yuan, the external accounts, the budget, sentiment, the provinces.
const GROUP_ORDER = ["Growth & Output", "Consumption", "Prices", "Labor", "Property", "Money & Credit", "Interest Rates", "Exchange Rates", "Trade & External", "Public Finance", "Sentiment", "Markets", "Demographics", "Regional"];
const homeRank = (entry: CuratedEntry) => entry.homeRank ?? Number.MAX_SAFE_INTEGER;
/**
 * Where the rest of a multi-region row's places are ranked. A group may hold
 * more than one such row, so the link says what it ranks as well as where.
 */
function allRegionsLink(entry: CuratedEntry): { href: string; label: string } {
  const href = routeHash({ view: "regions", period: "", key: entry.key });
  if (entry.key === "trade_partners") return { href, label: "All trading partners, ranked" };
  if (entry.key.startsWith("provincial_")) return { href, label: `All 31 provinces: ${entry.title.replace(/^Provincial /, "")}` };
  return { href, label: `All places: ${entry.title}` };
}
const groupRank = (group: string) => { const index = GROUP_ORDER.indexOf(group); return index < 0 ? GROUP_ORDER.length : index; };
/** What a series is, from its own fields; derived from the unit only for an entry that predates them. */
function measureOfEntry(entry: CuratedEntry): Measure { return entry.measure ?? measureOf(entry.unit); }
const AGENCY_SHORT: Record<string, string> = {
  "National Bureau of Statistics": "NBS", "People's Bank of China": "PBOC", "General Administration of Customs": "Customs",
  "State Administration of Foreign Exchange": "SAFE", "Ministry of Finance": "MOF", "Ministry of Commerce": "MOFCOM",
  "National Energy Administration": "NEA", "China Foreign Exchange Trade System": "CFETS", "Caixin / S&P Global": "Caixin",
};
function shortAgency(agency: string): string { return AGENCY_SHORT[agency] ?? agency; }
/** "PBOC, Customs, SAFE and Caixin": the domestic publishers behind the curated series, in order of how many each supplies. */
function publisherList(entries: CuratedEntry[]): string {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.agency, (counts.get(entry.agency) ?? 0) + 1);
  const names = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([agency]) => shortAgency(agency));
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
/** What distinguishes the bureau's three international datasets, which share a geography and mostly a frequency. */
const DATASET_NOTE: Record<number, string> = { 12: "the US, the EU and Japan", 13: "world commodity prices", 14: "major countries" };
/** The year a period falls in, whatever shape the period is written in. */
function periodYear(period: string): string {
  return period.slice(0, 4);
}

/**
 * A sparkline, with the years it covers written under it.
 *
 * A line with no time axis is a shape, not a reading: the same width of chart
 * held six years of quarters and two years of months, and nothing on the page
 * said which. The end years are small and muted, and they are the years the
 * line actually draws rather than the series' full range, so the label cannot
 * claim more than the picture shows.
 */
function Sparkline(props: { points: SeriesPoint[]; alarm?: boolean; years?: boolean }) {
  const values = props.points.map((point) => point.value);
  if (values.length < 2) return <svg viewBox="0 0 160 28" aria-hidden="true" />;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const path = values.map((value, index) => `${(index / (values.length - 1)) * 160},${26 - ((value - min) / span) * 24}`).join(" ");
  const from = periodYear(props.points[0]?.date ?? ""), to = periodYear(props.points[props.points.length - 1]?.date ?? "");
  const chart = <svg viewBox="0 0 160 28" preserveAspectRatio="none" aria-hidden="true"><polyline points={path} fill="none" stroke={props.alarm ? "var(--red)" : "var(--chart-1)"} strokeWidth="1.8" strokeLinejoin="round" /><circle cx="160" cy={26 - ((values[values.length - 1] ?? 0) - min) / span * 24} r="2.5" fill={props.alarm ? "var(--red)" : "var(--chart-1)"} /></svg>;
  if (!props.years || !from || !to) return chart;
  return (
    <span className="spark-dated">
      {chart}
      <span className="spark-years" aria-label={`${from} to ${to}`}><i>{from}</i>{from !== to && <i>{to}</i>}</span>
    </span>
  );
}

/**
 * Why a Home row is showing an old figure, when it is.
 *
 * The period alone turns amber and leaves the reader to guess. There are two
 * quite different reasons a row can be behind, and the difference is the
 * publisher's reputation: either nothing newer has been published, or the
 * publisher has published and this deployment cannot reach it. The Caixin
 * surveys are the second — they come through a service the deployment does
 * not run, so their figures stop dead while the page around them stays
 * current. The series page has always said so; the Home page said nothing.
 */
function staleNote(entry: CuratedEntry, latest: SeriesPoint | undefined): string {
  if (entry.ended || !latest || !isBehind(latest.date, entry.frequency)) return "";
  return entry.refreshBlocked ? `, not refreshed here (needs ${entry.refreshBlocked})` : ", nothing newer published";
}

function Home(props: { stats: CatalogStats | null; curated: CuratedEntry[]; releases: Release[]; releaseError: string; onSearch: (q: string) => void }) {
  const [headline, setHeadline] = useState<Map<string, SeriesResult>>(new Map());
  const [homeFailed, setHomeFailed] = useState(false);
  const [draft, setDraft] = useState("");
  const headlineEntries = props.curated.filter((entry) => entry.home !== false);
  // The curated series from publishers other than the bureau and FRED, counted whether or not they sit on this page.
  const domesticEntries = props.curated.filter((entry) => entry.source !== "fred" && !entry.agency.includes("National Bureau of Statistics"));
  // Every Home row, paired with the entry it comes from; a row may sit in another group.
  const homeRows = props.curated.flatMap((entry) => (entry.homeRows ?? []).map((row) => ({ entry, row })));
  const publisherCounts = [...new Set(domesticEntries.map((entry) => entry.agency))].map((agency) => ({ agency, count: domesticEntries.filter((entry) => entry.agency === agency).length })).sort((a, b) => b.count - a.count);
  useEffect(() => {
    let cancelled = false;
    // Each indicator lands as it arrives; one slow source must not hold the whole page blank.
    // One request for every headline series, sent once on mount rather than after the catalog
    // arrives. Only if it fails does the page fall back to one request per indicator.
    json("/api/home").then((body) => {
      if (cancelled) return;
      if (typeof body !== "object" || body === null) throw new Error("no home payload");
      const next = new Map<string, SeriesResult>();
      for (const [key, value] of Object.entries(body)) if (isSeriesResult(value)) next.set(key, value);
      if (next.size === 0) throw new Error("empty home payload");
      setHeadline(next);
    }).catch(() => { if (!cancelled) setHomeFailed(true); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!homeFailed) return;
    let cancelled = false;
    for (const entry of props.curated.filter((entry) => entry.home !== false)) {
      json(`/api/series/${entry.key}?limit=24`).then((body) => {
        if (cancelled || !isSeriesResult(body)) return;
        setHeadline((current) => new Map(current).set(entry.key, body));
      }).catch(() => undefined);
    }
    return () => { cancelled = true; };
  }, [homeFailed, props.curated.map((entry) => entry.key).join(",")]);
  const upcoming = props.releases.filter((release) => isUpcoming(release.date)).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
  // The datasets the catalog actually holds, largest first, so this list stays
  // true as families are added rather than naming two of them by hand.
  const datasets = [...(props.stats?.datasets ?? [])].sort((a, b) => b.count - a.count);
  const hasNationalAnnual = datasets.some((dataset) => dataset.geography === "National" && dataset.frequency === "Annual");
  return (
    <main id="main" tabIndex={-1} className="page home">
      <section className="hero">
        <h1>China Economic Data</h1>
        <p className="lede">{(props.stats?.seriesCount ?? 0).toLocaleString("en-US")} series from the National Bureau of Statistics, searchable in English and Chinese, plus {domesticEntries.length} indicators from {publisherList(domesticEntries)}, and {props.curated.filter((entry) => entry.source === "fred").length} international series on China via FRED.</p>
        <form className="hero-search" onSubmit={(event) => { event.preventDefault(); if (draft.trim()) props.onSearch(draft.trim()); }}>
          <div className="global-search"><SearchIcon /><input id="home-series-search" aria-label="Search series" aria-keyshortcuts="/" autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} placeholder='Try "youth unemployment", "steel output", or 居民消费价格' /></div>
        </form>
      </section>

      <section className="section" aria-labelledby="h-headline">
        <div className="section-head"><h2 id="h-headline">Headline Indicators</h2><span>Latest value; change in points from the period before for a rate, from a year earlier for a level</span></div>
        <div className="hero-tiles">
          {HERO_KEYS.map((key) => props.curated.find((entry) => entry.key === key)).filter((entry): entry is CuratedEntry => entry !== undefined).map((entry) => {
            const result = headline.get(entry.key);
            const first = result?.series[0];
            const latest = first?.points[first.points.length - 1];
            const measure = measureOfEntry(entry);
            const previous = first?.points[first.points.length - 2];
            return (
              <a key={entry.key} className="tile" href={seriesHash([entry.key])}>
                <span className="label">{entry.title}</span>
                <span className="tile-value">{latest ? fmt(latest.value, measure) : "—"}<span className="tile-unit">{measure.suffix}</span></span>
                {first && <Sparkline points={first.points} years />}
                <small>{regionPrefix(result)}{first && first.label !== entry.title ? `${first.label}, ` : ""}{entry.ended ? `Ended ${periodPretty(entry.ended)}` : latest ? observationLabel(latest.date, entry.frequency) : entry.frequency}{!entry.ended && latest && previous ? `, ${deltaText(latest, previous, measure, "short")}` : ""}</small>
              </a>
            );
          })}
        </div>
        <div className="indicator-list">
          {[...new Set(homeRows.map(({ entry, row }) => row.group ?? entry.group))].sort((a, b) => groupRank(a) - groupRank(b)).map((group) => (
            <section key={group} aria-label={group}>
              <h3>{group}</h3>
              {homeRows.filter(({ entry, row }) => (row.group ?? entry.group) === group)
                .sort((a, b) => a.row.rank - b.row.rank)
                .flatMap(({ entry, row }) => {
                // A series that names home regions (trade by partner) is one row per
                // region, named for the region; a table whose lines each get a row is one
                // row per named line; the rest are one row each.
                const rows = entry.homeRegions ? entry.homeRegions.map((code) => ({ entry, spec: `${entry.key}@${code}`, region: code })) : [{ entry, spec: entry.key, region: "" }];
                return rows.map(({ spec, region }) => {
                const result = headline.get(spec);
                const first = row.line ? result?.series.find((line) => line.label === row.line) : result?.series[0];
                const rowTitle = row.title ?? entry.homeTitle;
                const latest = first?.points[first.points.length - 1];
                const previous = first?.points[first.points.length - 2];
                // A row for one place is named for the place and the measure together; the
                // small print then carries the line and the publisher, not the place again.
                const placed = !region && result?.region && isPlaceCode(result.region.value) ? regionLabel(result.region) : "";
                const name = region ? regionalTitle(entry.title, result?.region ? regionLabel(result.region) : region, first?.label) : placed ? regionalTitle(rowTitle ?? entry.title, placed) : rowTitle ?? entry.title;
                // The small print names the table the row comes from when the row is named for its line, else the line.
                const tableNote = !region && rowTitle && rowTitle !== entry.title ? `${entry.title}, ` : "";
                // A level (a flow, a stock, a count) is read against a year earlier; a rate against the period before.
                const measure = measureOfEntry(entry);
                const levelChange = latest && measure.kind === "level" ? yearOnYearText(latest, first?.points.find((point) => point.date === yearEarlier(latest.date)), { absolute: /\b(net|balance)\b/i.test(`${first?.label ?? ""} ${entry.title}`), unit: measure }) : "";
                return (
                  <a key={`${spec}|${row.line ?? ""}`} className="indicator-row" href={region ? seriesHash([entry.key], { region }) : seriesHash([entry.key])}>
                    <span className="name">{name}<small>{region ? `${entry.title}, ` : placed || tableNote ? "" : regionPrefix(result)}{tableNote || (!region && first && first.label !== entry.title ? `${first.label}, ` : "")}{shortAgency(entry.agency)}{staleNote(entry, latest)}</small></span>
                    <span className="value">{latest ? fmt(latest.value, measure) : "—"}<i>{latest ? measure.suffix : ""}</i></span>
                    <span className="change">{levelChange || deltaText(latest, previous, measure, "short")}</span>
                    <span className={`period${entry.ended || (latest && isBehind(latest.date, entry.frequency)) ? " behind" : ""}`}>{entry.ended ? `Ended ${periodPretty(entry.ended)}` : latest ? observationLabel(latest.date, entry.frequency) : entry.frequency}</span>
                    <span className="spark">{first && <Sparkline points={first.points} years />}</span>
                  </a>
                );
                });
              })}
              {props.curated.filter((entry) => entry.group === group && entry.homeRegions && entry.home !== false && (entry.homeRows ?? []).some((row) => (row.group ?? entry.group) === group)).map((entry) => { const link = allRegionsLink(entry); return <a key={`${entry.key}-all`} className="group-more" href={link.href}>{link.label} ›</a>; })}
            </section>
          ))}
        </div>
      </section>

      <section className="section two-col">
        <div className="card">
          <div className="card-head"><h2>Upcoming NBS Releases</h2><span>China Standard Time</span></div>
          {props.releaseError ? <div className="state"><p>The NBS release calendar didn't respond. The schedule is also published at stats.gov.cn.</p></div>
            : upcoming.length === 0 ? <div className="state"><p>No further releases scheduled this month. <a href="#/releases">See the calendar</a>.</p></div>
            : <div className="cal">{upcoming.map((release) => {
              const date = new Date(`${release.date.slice(0, 10)}T00:00:00`);
  return (
                <div className="cal-row" key={release.id}>
                  <div className="cal-date"><span>{date.toLocaleDateString("en-US", { month: "short" })}</span><b>{date.getDate()}</b></div>
                  <div>
                    <div className="what">{release.en || <Zh>{release.title}</Zh>}</div>
                    {release.en && <small><Zh>{release.title.replace(/\s*[（(]\d{1,2}:\d{2}[)）]\s*$/, "")}</Zh>, {release.date.slice(11, 16)} CST</small>}
                    {(release.keys.length > 0 || release.categories.length > 0) && <div className="links">{release.keys.map((key) => { const entry = props.curated.find((item) => item.key === key); return entry ? <a key={key} href={seriesHash([key])}>{entry.title}</a> : null; })}{release.categories.map((name) => <a key={name} href={`#/category/${encodeURIComponent(name)}`}>{categoryEn(name) || name} series</a>)}</div>}
                  </div>
                </div>
              );
            })}</div>}
        </div>
        <div className="card">
          <div className="card-head"><h2>Coverage</h2><span>{props.stats?.officialEnglishCount ? `${props.stats.officialEnglishCount.toLocaleString("en-US")} English titles are NBS's own; the rest are machine translations, marked as such` : "English titles are machine translations; the Chinese is official"}</span></div>
          <div className="coverage">
            <div><h3>Included</h3><ul>
              {datasets.map((dataset) => <li key={dataset.code}>{dataset.count.toLocaleString("en-US")} {dataset.geography === "National" ? "national" : dataset.geography === "Province" ? "provincial" : dataset.geography === "City" ? "city" : dataset.geography} {dataset.frequency.toLowerCase()} NBS series{dataset.geography === "Province" ? ", each published for 31 provinces" : dataset.geography === "City" ? ", each published for the surveyed cities" : DATASET_NOTE[dataset.code] ? `: ${DATASET_NOTE[dataset.code]}` : ""}</li>)}
              {props.stats?.storedCount !== undefined && <li>{props.stats.storedCount.toLocaleString("en-US")} stored locally; the rest are fetched on first view, and tables NBS lists but has published no data for are retried monthly</li>}
              <li>{props.curated.filter((entry) => entry.source !== "fred").length} curated series with notes and revision history: {props.curated.filter((entry) => entry.source !== "fred" && entry.agency.includes("National Bureau of Statistics")).length} from the NBS tables above, plus {publisherCounts.map((item, index) => `${index > 0 ? (index === publisherCounts.length - 1 ? " and " : ", ") : ""}${item.count} from ${shortAgency(item.agency)}`).join("")}</li>
              <li>Quarterly GDP for all 31 provinces, back to 2005, and new and existing home prices for the 70 surveyed cities</li>
              <li>{props.curated.filter((entry) => entry.source === "fred").length} international series via FRED: BIS, OECD, IMF, World Bank, US Census, US Treasury and BLS</li>
            </ul></div>
            <div><h3>Not included</h3><ul>
              {!hasNationalAnnual && <li>The annual national dataset, which is being collected</li>}
              <li>Census releases and the ministries' own datasets, which NBS lists separately</li>
              <li>Seasonal adjustment, and any correction for the Lunar New Year moving between January and February</li>
            </ul></div>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="h-cats">
        <div className="section-head"><h2 id="h-cats">NBS Categories</h2><span>Top-level groups, by number of series</span></div>
        <div className="cats">
          {props.stats?.categories.slice(0, 12).map((category) => (
            <a key={category.name} className="cat" href={`#/category/${encodeURIComponent(category.name)}`}>
              {categoryEn(category.name)
                ? <><b>{categoryEn(category.name)}</b><span className="gloss"><Zh>{category.name}</Zh></span></>
                : <b><Zh>{category.name}</Zh></b>}
              <small>{category.count.toLocaleString("en-US")} series</small>
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}

/** How the site names an NBS geography in a filter: what the series are published for. */
function geographyLabel(geography: string): string {
  if (geography === "National") return "National";
  if (geography === "Province") return "By province";
  if (geography === "City") return "By city";
  if (geography === "International") return "International";
  return geography;
}

// ── Search & browse ───────────────────────────────────────────────────────────

function SearchPage(props: { route: Extract<Route, { view: "search" }>; stats: CatalogStats | null; chartKeys: string[]; lang: string; navigate: (route: Route) => void }) {
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [more, setMore] = useState(false);
  const params = (offset: number) => {
    const query = new URLSearchParams({ q: props.route.q, limit: "60", offset: String(offset) });
    if (props.route.freq) query.set("frequency", props.route.freq);
    if (props.route.cat) query.set("category", props.route.cat);
    if (props.route.dataset) query.set("dataset", props.route.dataset);
    if (props.route.geo) query.set("geography", props.route.geo);
    return query;
  };
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    const timer = window.setTimeout(() => {
      json(`/api/search?${params(0)}`).then((body) => { if (cancelled) return; if (isSearchResponse(body)) { setResponse(body); setStatus("ok"); } else setStatus("error"); }).catch(() => { if (!cancelled) setStatus("error"); });
    }, 160);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [props.route.q, props.route.freq, props.route.cat, props.route.dataset, props.route.geo]);
  const loadMore = () => {
    if (!response) return;
    setMore(true);
    json(`/api/search?${params(response.results.length)}`).then((body) => { if (isSearchResponse(body)) setResponse({ ...body, results: [...response.results, ...body.results] }); }).catch(() => undefined).finally(() => setMore(false));
  };
  const catEn = props.route.cat ? (categoryEn(props.route.cat) || (() => { const hit = response?.results.find((entry) => entry.categories.includes(props.route.cat)); return hit?.categoriesEn?.[hit.categories.indexOf(props.route.cat)] ?? ""; })()) : "";
  const title = props.route.q ? `Results for “${props.route.q}”` : props.route.cat ? props.route.cat : props.route.dataset ? (props.stats?.datasets.find((dataset) => String(dataset.code) === props.route.dataset)?.name ?? "Dataset") : "All series";
  const freqs = (props.stats?.datasets ?? []).map((dataset) => dataset.frequency).filter((value, index, list) => list.indexOf(value) === index);
  const geos = (props.stats?.datasets ?? []).map((dataset) => dataset.geography).filter((value, index, list) => list.indexOf(value) === index);
  const set = (patch: Partial<Extract<Route, { view: "search" }>>) => props.navigate({ ...props.route, ...patch });
  // The facet counts are whole-catalog totals; beside a query or a category they read as counts
  // within it ("Monthly (8,776)" on an 88-series category), so they show only on the full list.
  const wholeCatalog = !props.route.q && !props.route.cat;
  const withCount = (label: string, count: number) => (wholeCatalog ? `${label} (${count.toLocaleString("en-US")})` : label);
  return (
    <main id="main" tabIndex={-1} className="page">
      <div className="breadcrumbs"><a href="#/">Home</a><span aria-hidden="true">›</span>{props.route.cat ? <><a href="#/browse">Categories</a><span aria-hidden="true">›</span><span><Zh>{props.route.cat}</Zh></span></> : <span>Search</span>}</div>
      <h1>{props.route.cat && catEn ? <>{catEn}<Zh className="gloss">{props.route.cat}</Zh></> : CJK.test(title) ? <Zh>{title}</Zh> : title}</h1>
      <div className="facets">
        <select aria-label="Frequency" value={props.route.freq} onChange={(event) => set({ freq: event.target.value })}><option value="">All frequencies</option>{freqs.map((freq) => <option key={freq} value={freq}>{withCount(freq, props.stats?.datasets.filter((dataset) => dataset.frequency === freq).reduce((sum, dataset) => sum + dataset.count, 0) ?? 0)}</option>)}</select>
        {geos.length > 1 && <select aria-label="Geography" value={props.route.geo} onChange={(event) => set({ geo: event.target.value })}><option value="">All geographies</option>{geos.map((geo) => <option key={geo} value={geo}>{withCount(geographyLabel(geo), props.stats?.datasets.filter((dataset) => dataset.geography === geo).reduce((sum, dataset) => sum + dataset.count, 0) ?? 0)}</option>)}</select>}
        {props.stats && props.stats.datasets.length > 1 && <select aria-label="Dataset" value={props.route.dataset} onChange={(event) => set({ dataset: event.target.value })}><option value="">All datasets</option>{props.stats.datasets.map((dataset) => <option key={dataset.code} value={String(dataset.code)}>{withCount(`${dataset.geography} ${dataset.frequency.toLowerCase()}`, dataset.count)}</option>)}</select>}
        {(props.route.freq || props.route.cat || props.route.dataset || props.route.geo) && <button className="button" onClick={() => props.navigate({ view: "search", q: props.route.q, freq: "", cat: "", dataset: "", geo: "" })}>Clear filters</button>}
      </div>
      <p className="result-count" role="status" aria-live="polite">{status === "loading" ? "Searching…" : status === "error" ? "" : response && response.total > 0 ? `Showing ${response.results.length.toLocaleString("en-US")} of ${response.total.toLocaleString("en-US")} series` : ""}</p>
      {status === "error" && <div className="state"><b>Search unavailable</b><p>The catalog did not respond. Try again in a moment.</p><div className="actions"><button className="button" onClick={() => set({})}>Try again</button></div></div>}
      {status === "ok" && response && response.results.length === 0 && (
        <div className="state" role="status">
          <b>No series match {props.route.q ? `“${props.route.q}”` : "these filters"}</b>
          <p>This catalog holds {(props.stats?.seriesCount ?? 0).toLocaleString("en-US")} NBS series: national monthly, quarterly and annual, and the provincial and city tables. Filters narrow it; clearing them searches everything.</p>
          <p>Try a Chinese term such as <a href={routeHash({ view: "search", q: "失业率", freq: "", cat: "", dataset: "", geo: "" })}>失业率</a> or <a href={routeHash({ view: "search", q: "居民消费价格", freq: "", cat: "", dataset: "", geo: "" })}>居民消费价格</a>, or <a href="#/browse">browse the categories</a>. English matches common terms (GDP, CPI, PPI, exports, steel) and the headline indicators.</p>
        </div>
      )}
      {status !== "error" && response && response.results.length > 0 && (
        <div className="result-list">
          {response.results.map((entry) => {
            const curated = entry.datasetCode === 0;
            const zhFirst = props.lang === "zh" || !entry.nameEn;
            return (
              <article className="result" key={entry.key}>
                <a className="main" href={entry.region ? seriesHash([entry.key], { region: entry.region.value }) : seriesHash([entry.key])}>
                  <span className="title">{entry.region && entry.region.value !== "000000000000" ? (zhFirst ? <Zh>{regionalTitle(entry.name, entry.region.en ?? entry.region.text)}</Zh> : regionalTitle(entry.nameEn ?? entry.name, regionLabel(entry.region))) : zhFirst ? <Zh>{entry.name}</Zh> : entry.nameEn}</span>
                  {entry.nameEn && !curated && <span className="gloss">{zhFirst ? entry.nameEn : <Zh>{entry.name}</Zh>} <span className="tag">{entry.nameEnSource === "nbs-official" ? "NBS English" : "auto-translated"}</span></span>}
                  {!curated && <span className="path">{categoryPath(entry)}</span>}
                  <span className="meta">{entry.frequency}, {curated ? entry.dataset : "NBS"}, {unitLabel(entry.unit)}{entry.firstPeriod && entry.lastPeriod ? <>, {observationLabel(entry.firstPeriod, entry.frequency)} to {observationLabel(entry.lastPeriod, entry.frequency)}{isEndedPeriod(entry.lastPeriod) && <span className="ended"> ended</span>}</> : !curated ? <>, <span className="ended">not fetched yet</span></> : null}</span>
                </a>
                {props.chartKeys.length > 0 && props.chartKeys.length < 4 && !props.chartKeys.includes(entry.key)
                  && <a className="button" href={seriesHash([...props.chartKeys, entry.key])} aria-label={`Add ${entry.name} to the chart`}>Add to chart</a>}
              </article>
            );
          })}
        </div>
      )}
      {response && response.results.length < response.total && status === "ok" && <button className="load-more" disabled={more} onClick={loadMore}>{more ? "Loading…" : `Load ${Math.min(60, response.total - response.results.length)} more`}</button>}
    </main>
  );
}

function BrowsePage(props: { stats: CatalogStats | null }) {
  // One block per dataset, so a heading in the three-economies table is never
  // mistaken for the nation's. Within a block, headings with the same English
  // name are one card, the Chinese names listed on it.
  const datasets = [...(props.stats?.datasets ?? [])].sort((a, b) => (DATASET_ORDER.indexOf(a.code) + 1 || 99) - (DATASET_ORDER.indexOf(b.code) + 1 || 99));
  return (
    <main id="main" tabIndex={-1} className="page">
      <div className="breadcrumbs"><a href="#/">Home</a><span aria-hidden="true">›</span><span>Browse</span></div>
      <h1>Browse</h1>
      {datasets.map((dataset) => {
        const cards = new Map<string, { en: string; zh: string[]; count: number }>();
        for (const category of dataset.categories ?? []) {
          const en = categoryEn(category.name) || category.name;
          const card = cards.get(en) ?? { en, zh: [], count: 0 };
          card.zh.push(category.name); card.count += category.count; cards.set(en, card);
        }
        return (
          <section key={dataset.code} className="browse-dataset" aria-label={DATASET_EN[dataset.code] ?? dataset.name}>
            <h2>{DATASET_EN[dataset.code] ?? dataset.name} <Zh className="gloss">{dataset.name}</Zh> <small className="quiet">{dataset.count.toLocaleString("en-US")} series</small></h2>
            <div className="cats">
              {[...cards.values()].sort((a, b) => b.count - a.count).map((card) => (
                <a key={card.en} className="cat" href={routeHash({ view: "search", q: "", freq: "", cat: card.zh[0] ?? "", dataset: String(dataset.code), geo: "" })}>
                  {card.en !== card.zh[0]
                    ? <><b>{card.en}</b><span className="gloss"><Zh>{card.zh.join(" / ")}</Zh></span></>
                    : <b><Zh>{card.zh.join(" / ")}</Zh></b>}
                  <small>{card.count.toLocaleString("en-US")} series</small>
                </a>
              ))}
            </div>
          </section>
        );
      })}
    </main>
  );
}

function KeyListPage(props: { title: string; keys: string[]; empty: string }) {
  const [entries, setEntries] = useState<Map<string, { title: string; sub: string }>>(new Map());
  useEffect(() => {
    let cancelled = false;
    Promise.all(props.keys.map((key) => json(`/api/entry/${splitSpec(key).key}`).then((body): [string, { title: string; sub: string }] | null => {
      if (isCurated(body)) return [key, { title: body.title, sub: `${body.frequency}, ${body.agency}` }];
      if (isNbsEntry(body)) return [key, { title: body.name, sub: `${body.frequency}, ${body.categories.join(" › ")}` }];
      return null;
    }).catch(() => null))).then((pairs) => { if (!cancelled) setEntries(new Map(pairs.filter((pair): pair is [string, { title: string; sub: string }] => pair !== null))); });
    return () => { cancelled = true; };
  }, [props.keys.join(",")]);
  return (
    <main id="main" tabIndex={-1} className="page">
      <div className="breadcrumbs"><a href="#/">Home</a><span aria-hidden="true">›</span><span>Saved and Recent</span></div>
      <h1>{props.title}</h1>
      {props.keys.length === 0 ? <div className="state"><b>{props.empty}</b><p>Save a series from its page with the Save button. Saved and recently viewed series live in this browser only.</p></div> : (
        <div className="result-list" style={{ marginTop: 20 }}>
          {props.keys.map((key) => { const entry = entries.get(key); return <article className="result" key={key}><a className="main" href={seriesHash([key])}><span className="title">{entry ? <Zh>{entry.title}</Zh> : key}</span>{entry && <span className="meta"><Zh>{entry.sub}</Zh></span>}</a></article>; })}
        </div>
      )}
    </main>
  );
}

// ── Theme pages ───────────────────────────────────────────────────────────────

/** The pages, in the order the owner named them. The names are the hashes and the server's theme names. */
const THEME_PAGES = [
  { name: "manufacturing", label: "Manufacturing" },
  { name: "property", label: "Property" },
  { name: "trade", label: "Trade & flows" },
  { name: "equities", label: "Equities" },
  { name: "energy", label: "Energy" },
  { name: "demographics", label: "Demographics" },
  { name: "labour", label: "Labour" },
] as const;

/** One row under the top bar naming every page: the headline, the provinces, and each theme. */
function PageStrip(props: { route: Route }) {
  const { route } = props;
  const at = (name: string) => (route.view === "theme" && route.name === name) ? "page" as const : undefined;
  return (
    <nav className="page-strip" aria-label="Pages">
      <a href="#/" aria-current={route.view === "home" ? "page" : undefined}>Headline</a>
      <a href="#/regions" aria-current={route.view === "regions" || route.view === "province" ? "page" : undefined}>Provinces</a>
      {THEME_PAGES.map((page) => <a key={page.name} href={`#/${page.name}`} aria-current={at(page.name)}>{page.label}</a>)}
    </nav>
  );
}

interface ThemeChartData { title?: string; key: string; region?: string; labels?: string[]; years?: number; note?: string; result: SeriesResult | null; place?: Region }
interface ThemeData { name: string; title: string; lede: string; sections: { title: string; lede?: string; charts: ThemeChartData[] }[] }

/**
 * One story told with the series the site already holds, every panel drawn
 * by the same chart the series page uses and opening on that series. The
 * definition lives on the server (`server/themes.ts`), held to the catalog
 * by a test, so this page only draws what it is handed.
 */
function ThemePage(props: { route: Extract<Route, { view: "theme" }> }) {
  const [data, setData] = useState<ThemeData | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error" | "unknown">("loading");
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    fetch(`/api/theme/${encodeURIComponent(props.route.name)}`).then(async (response) => {
      if (cancelled) return;
      if (response.status === 404) { setStatus("unknown"); return; }
      setData((await response.json()) as ThemeData); setStatus("ok");
    }).catch(() => { if (!cancelled) setStatus("error"); });
    return () => { cancelled = true; };
  }, [props.route.name]);
  return (
    <main id="main" tabIndex={-1} className="page page-wide">
      <div className="breadcrumbs"><a href="#/">Home</a><span aria-hidden="true">›</span><span>{data?.title ?? "Theme"}</span></div>
      {status === "loading" && <div className="state"><span className="loader" aria-hidden="true" />Loading…</div>}
      {status === "unknown" && <div className="state"><b>No such page</b></div>}
      {status === "error" && <div className="state"><b>The page is unavailable</b><p>The server did not answer.</p></div>}
      {status === "ok" && data && (
        <>
          <h1>{data.title}</h1>
          {data.lede && <p className="lede">{data.lede}</p>}
          {data.sections.map((section) => (
            <section key={section.title} className="theme-section" aria-label={section.title}>
              <h2>{section.title}</h2>
              {section.lede && <p className="quiet theme-lede">{section.lede}</p>}
              <div className="theme-grid">
                {section.charts.map((chart) => {
                  const result = chart.result;
                  const built = result ? buildTracks([result], new Map()) : null;
                  const hasPoints = built ? built.tracks.some((track) => track.points.length > 1) : false;
                  const title = chart.title ?? result?.title ?? chart.key;
                  return (
                    <article key={`${chart.key}|${chart.region ?? ""}|${title}`} className="theme-card">
                      {/* The heading is the link to the series; nothing else on the card says "open". */}
                      <h3 className="theme-card-title"><a href={chart.region ? seriesHash([chart.key], { region: chart.region }) : seriesHash([chart.key])}>{title}</a></h3>
                      {hasPoints && built && result
                        ? <>
                            <SeriesChart tracks={built.tracks} gaps={built.gaps} years={chart.years ?? 10} logScale={false} lunar={false} unit={result.unit} title={title} />
                            {built.tracks.length > 1 && <div className="chart-legend" aria-label="Legend">{built.tracks.map((track) => <span key={track.id}><i className={track.dash ? "dashed" : ""} style={{ color: track.color }} />{track.name}</span>)}</div>}
                          </>
                        : <div className="state small"><b>Nothing stored yet</b></div>}
                      <small className="theme-note">{result ? `${result.agency}${result.unit ? `, ${unitLabel(result.unit)}` : ""}` : ""}{chart.note ? `. ${chart.note}` : ""}</small>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </>
      )}
    </main>
  );
}

// ── Province profile ──────────────────────────────────────────────────────────

interface ProfileRow { key: string; label: string; agency: string; frequency: string; unit: string; measure: Measure; ended?: string; endedNote?: string; lastPeriod: string | null; latest: number | null; previous: number | null; points: SeriesPoint[] }
interface Share { key: string; label: string; value: number; share: number }
interface ProvinceProfile {
  code: string; region: { value: string; text: string; en: string };
  sections: { title: string; note?: string; rows: ProfileRow[] }[];
  structure: { year: string; gdp: number; sectors: Share[]; industries: { year: string; gdp: number; items: Share[] } | null } | null;
}

/**
 * One province across everything the site holds for it. The regions page
 * ranks every province on one series; this is the other direction. Growth
 * from the curated provincial keys, then size, the makeup of the economy,
 * labour and households, and trade from the bureau's own provincial tables —
 * all read from the store by the province's code, so it stays current with
 * the crawl and needs no adapter of its own.
 */
function ProvincePage(props: { route: Extract<Route, { view: "province" }> }) {
  const [data, setData] = useState<ProvinceProfile | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error" | "unknown">("loading");
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    if (!props.route.code) { setStatus("unknown"); return; }
    fetch(`/api/province/${encodeURIComponent(props.route.code)}`).then(async (response) => {
      if (cancelled) return;
      if (response.status === 404) { setStatus("unknown"); return; }
      const body = (await response.json()) as ProvinceProfile;
      setData(body); setStatus("ok");
    }).catch(() => { if (!cancelled) setStatus("error"); });
    return () => { cancelled = true; };
  }, [props.route.code]);
  const name = data?.region.en ?? "";
  return (
    <main id="main" tabIndex={-1} className="page">
      <div className="breadcrumbs"><a href="#/">Home</a><span aria-hidden="true">›</span><a href="#/regions">Provinces</a><span aria-hidden="true">›</span><span>{name || "Province"}</span></div>
      {status === "loading" && <div className="state"><span className="loader" aria-hidden="true" />Loading…</div>}
      {status === "unknown" && <div className="state"><b>No such province</b><p>Pick one from the <a href="#/regions">provinces page</a>.</p></div>}
      {status === "error" && <div className="state"><b>The profile is unavailable</b><p>The server did not answer.</p></div>}
      {status === "ok" && data && (
        <>
          <h1>{name} <Zh className="gloss">{data.region.text}</Zh></h1>
          <p className="lede">Every series the site holds for {name}, from the bureau's provincial tables and the curated provincial headlines. Annual figures lag the monthly ones by up to a year.</p>
          <div className="indicator-list">
            {data.sections.map((section) => (
              <section key={section.title} aria-label={section.title}>
                <h3>{section.title}{section.note && <small className="quiet">: {section.note}</small>}</h3>
                {section.rows.map((row) => {
                  const latest = row.points.at(-1), previous = row.points.at(-2);
                  const levelChange = latest && row.measure.kind === "level" ? yearOnYearText(latest, row.points.find((point) => point.date === yearEarlier(latest.date)), { absolute: false, unit: row.measure }) : "";
                  return (
                    <a key={row.key} className="indicator-row" href={seriesHash([row.key], { region: data.region.value })}>
                      <span className="name">{row.label}<small>{row.frequency}, {shortAgency(row.agency)}{row.ended ? `, ended ${row.ended}` : ""}</small></span>
                      <span className="value">{latest ? fmt(latest.value, row.measure) : "—"}<i>{latest ? row.measure.suffix : ""}</i></span>
                      <span className="change">{levelChange || deltaText(latest, previous, row.measure, "short")}</span>
                      <span className={`period${row.ended ? " behind" : ""}`}>{row.ended ? `Ended ${row.ended}` : latest ? observationLabel(latest.date, row.frequency) : row.frequency}</span>
                      <span className="spark">{row.points.length > 1 && <Sparkline points={row.points} years />}</span>
                    </a>
                  );
                })}
                {section.rows.some((row) => row.endedNote) && <p className="quiet profile-note">{section.rows.find((row) => row.endedNote)?.endedNote}</p>}
              </section>
            ))}
            {data.structure && (
              <section aria-label="Structure of the economy">
                <h3>Structure of the economy<small className="quiet">: {data.structure.year}, share of gross regional product, from the bureau's annual value-added tables</small></h3>
                <div className="share-list">
                  {data.structure.sectors.map((item) => (
                    <a key={item.key} className="share-row" href={seriesHash([item.key], { region: data.region.value })}>
                      <span className="share-label">{item.label}</span>
                      <span className="share-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, item.share)}%` }} /></span>
                      <span className="share-value">{item.share.toFixed(1)}%</span>
                    </a>
                  ))}
                </div>
                {data.structure.industries && <h4 className="quiet">Largest industries, by value added, {data.structure.industries.year}{data.structure.industries.year !== data.structure.year ? ", the latest year the bureau has published them for" : ""}</h4>}
                <div className="share-list">
                  {(data.structure.industries?.items ?? []).map((item) => (
                    <a key={item.key} className="share-row" href={seriesHash([item.key], { region: data.region.value })}>
                      <span className="share-label">{item.label}</span>
                      <span className="share-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, item.share * 2)}%` }} /></span>
                      <span className="share-value">{item.share.toFixed(1)}%</span>
                    </a>
                  ))}
                </div>
                <p className="quiet profile-note">Shares are computed from the published levels for the same year, so they refer to the year beside them; the three sectors divide gross regional product between them by identity, which the nightly audit holds. The named industries are the ones the bureau breaks out and do not sum to the whole.</p>
              </section>
            )}
          </div>
        </>
      )}
    </main>
  );
}

// ── Data health ───────────────────────────────────────────────────────────────

interface Finding { name: string; kind: string; note?: string; latest?: { period: string; left: number; right: number }; disagreements: { period: string; left: number; right: number }[] }
interface FailingSource { key: string; title: string; agency: string; failures: number; since: string; latest: string; message: string; recoveredAt?: string }
interface BehindSeries { key: string; title: string; agency: string; frequency: string; lastPeriod: string | null; expected: string; blocked?: string; ended?: string }
interface CrawlFailures { series: number; attempts: number; reasons: { reason: string; series: number }[] }
interface Health {
  headline: string; ranAt: string;
  checks: { total: number; ok: number; findings: Finding[]; missing: string[] };
  sources: { failing: FailingSource[]; recovered?: FailingSource[]; crawl: CrawlFailures; consideredSince: string };
  behind: { publisher: BehindSeries[]; blocked: BehindSeries[]; ended: BehindSeries[] };
  store: { observations: number; keys: number; lastFetch: string | null };
}

/**
 * What is wrong with the data, where a reader can see it.
 *
 * The site runs 54 cross-checks a night and records every fetch, and showed
 * neither. Customs changed the wording above its tables, the parser refused
 * every month before the change, and that repeated on every run for weeks
 * into a log nobody reads, while the page looked healthy because the months
 * it could still read were the recent ones. This page is where that would
 * have been visible on the first day.
 */
function HealthPage() {
  const [data, setData] = useState<Health | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  useEffect(() => {
    let cancelled = false;
    json("/api/health-report").then((body) => {
      if (cancelled) return;
      setData(body as unknown as Health);
      setStatus("ok");
    }).catch(() => { if (!cancelled) setStatus("error"); });
    return () => { cancelled = true; };
  }, []);
  const day = (iso: string | null) => iso ? fmtDate(iso.slice(0, 10)) : "—";
  const clean = data && data.checks.findings.length === 0 && data.sources.failing.length === 0 && data.behind.publisher.length === 0;
  return (
    <main id="main" tabIndex={-1} className="page">
      <div className="breadcrumbs"><a href="#/">Home</a><span aria-hidden="true">›</span><span>Data health</span></div>
      <h1>Data Health</h1>
      <p className="lede">Everything the site knows to be wrong with its own data: readings that disagree, sources it cannot parse, and series that have not advanced. Read from the store, so opening this costs the publishers nothing.</p>
      {status === "loading" && <div className="state"><span className="loader" aria-hidden="true" />Checking…</div>}
      {status === "error" && <div className="state"><b>The health report is unavailable</b><p>The server did not answer.</p></div>}
      {status === "ok" && data && (
        <>
          <p className={clean ? "health-headline ok" : "health-headline bad"}>{data.headline}</p>

          <section>
            <h2>Cross-checks</h2>
            <p>{data.checks.ok} of {data.checks.total} pairs agree. A pair is one statistic read two ways, or an identity the numbers must satisfy. A disagreement means something here may be wrong.</p>
            {data.checks.findings.length === 0
              ? <p className="quiet">Nothing disagrees.</p>
              : <ul className="health-list">{data.checks.findings.map((finding) => (
                  <li key={finding.name}>
                    <b>{finding.name}</b>
                    {finding.latest && <div className="quiet">{finding.latest.period}: {finding.latest.left} against {finding.latest.right}{finding.disagreements.length > 1 ? `, and ${finding.disagreements.length - 1} more period${finding.disagreements.length === 2 ? "" : "s"}` : ""}</div>}
                    {finding.note && <div className="quiet">{finding.note}</div>}
                  </li>
                ))}</ul>}
            {data.checks.missing.length > 0 && <p className="quiet">{data.checks.missing.length} pair{data.checks.missing.length === 1 ? " has" : "s have"} no overlapping period to compare yet.</p>}
          </section>

          <section>
            <h2>Sources that will not parse</h2>
            <p>A publisher's page is reachable and the site cannot read it. Nothing shown on the site is wrong; something is missing. Counted since {day(data.sources.consideredSince)}.</p>
            {data.sources.failing.length === 0
              ? <p className="quiet">Every source read cleanly.</p>
              : <ul className="health-list">{data.sources.failing.map((source) => (
                  <li key={source.key}>
                    <b><a href={seriesHash([source.key])}>{source.title}</a></b> <span className="quiet">{source.agency}</span>
                    <div className="quiet">Failed {source.failures} time{source.failures === 1 ? "" : "s"}, first on {day(source.since)}, most recently {day(source.latest)}.</div>
                    <div className="health-message">{source.message}</div>
                  </li>
                ))}</ul>}
            {data.sources.recovered && data.sources.recovered.length > 0 && (
              <>
                <h3>Recovered</h3>
                <p className="quiet">
                  Failed in the window and has fetched cleanly since. Listed so the history is not lost, and kept out of the
                  count above so it does not read as a live fault: a failure is news only while it is the latest thing that
                  happened to a source.
                </p>
                <ul className="health-list">{data.sources.recovered.map((source) => (
                  <li key={source.key}>
                    <b><a href={seriesHash([source.key])}>{source.title}</a></b> <span className="quiet">{source.agency}</span>
                    <div className="quiet">Failed {source.failures} time{source.failures === 1 ? "" : "s"}, last on {day(source.latest)}; fetching cleanly since {day(source.recoveredAt ?? null)}.</div>
                  </li>
                ))}</ul>
              </>
            )}
            {data.sources.crawl && data.sources.crawl.series > 0 && (
              <>
                <h3>The catalog crawl</h3>
                <p className="quiet">
                  Separate, because it is a volume rather than a list. The crawl walks every series the bureau indexes, and a good
                  many are entries it lists with nothing behind them. {data.sources.crawl.series.toLocaleString("en-US")} of them
                  failed at least once ({data.sources.crawl.attempts.toLocaleString("en-US")} attempts). None of this affects a
                  curated series.
                </p>
                <ul className="health-list">{data.sources.crawl.reasons.map((reason) => (
                  <li key={reason.reason}><b>{reason.series.toLocaleString("en-US")} series</b> <span className="quiet">{reason.reason}</span></li>
                ))}</ul>
              </>
            )}
          </section>

          <section>
            <h2>Series that have not advanced</h2>
            {data.behind.publisher.length === 0
              ? <p className="quiet">Every series is as current as its publisher's cadence implies.</p>
              : <>
                  <p>The newest figure is older than the publishing cadence implies. Either the publisher has not released, or the site has not managed to read what it released.</p>
                  <ul className="health-list">{data.behind.publisher.map((row) => (
                    <li key={row.key}><b><a href={seriesHash([row.key])}>{row.title}</a></b> <span className="quiet">{row.agency}, newest {row.lastPeriod ?? "nothing stored"}, expected {row.expected}</span></li>
                  ))}</ul>
                </>}
            {data.behind.blocked.length > 0 && (
              <>
                <h3>Not refreshable on this deployment</h3>
                <p className="quiet">The publisher is still publishing. These reach the site through a service this deployment does not run, so the gap is ours, not theirs.</p>
                <ul className="health-list">{data.behind.blocked.map((row) => (
                  <li key={row.key}><b><a href={seriesHash([row.key])}>{row.title}</a></b> <span className="quiet">{row.agency}, newest {row.lastPeriod ?? "nothing stored"}, needs {row.blocked}</span></li>
                ))}</ul>
              </>
            )}
            {data.behind.ended.length > 0 && (
              <>
                <h3>Discontinued by the publisher</h3>
                <p className="quiet">Kept and labelled rather than deleted, so a reader can still see what was published while it existed.</p>
                <ul className="health-list">{data.behind.ended.map((row) => (
                  <li key={row.key}><b><a href={seriesHash([row.key])}>{row.title}</a></b> <span className="quiet">{row.agency}, ended {row.ended}</span></li>
                ))}</ul>
              </>
            )}
          </section>

          <section>
            <h2>The store</h2>
            <p>{data.store.observations.toLocaleString("en-US")} observations across {data.store.keys.toLocaleString("en-US")} series. Last written {data.store.lastFetch ? `${day(data.store.lastFetch)}` : "never"}. Checked {day(data.ranAt)}.</p>
          </section>
        </>
      )}
    </main>
  );
}

// ── Methodology ───────────────────────────────────────────────────────────────

interface SourceSection { id: string; title: string; publisher: string; reads: string; how: string; revisions: string; caveats: string[]; keys: string[] }
interface KeyMethod { key: string; title: string; agency: string; source: string; frequency: string; unit: string; caveats: string[]; check: { kind: string; names?: string[]; reason?: string } }

/**
 * How each figure was made and how it reached the site. A section per path the
 * data takes, the site's own handling, and, when a series is named in the
 * link, that series first.
 */
function MethodologyPage(props: { route: Extract<Route, { view: "methodology" }>; curated: CuratedEntry[] }) {
  const [sources, setSources] = useState<SourceSection[]>([]);
  const [keys, setKeys] = useState<KeyMethod[]>([]);
  const [site, setSite] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  useEffect(() => {
    let cancelled = false;
    json("/api/methodology").then((body) => {
      if (cancelled) return;
      const rawSources = listOf(body, "sources");
      setSources(rawSources.map((item) => ({
        id: str(item, "id"), title: str(item, "title"), publisher: str(item, "publisher"),
        reads: str(item, "reads"), how: str(item, "how"), revisions: str(item, "revisions"),
        caveats: listOf(item, "caveats").filter((line): line is string => typeof line === "string"),
        keys: listOf(item, "keys").filter((key): key is string => typeof key === "string"),
      })));
      setKeys(listOf(body, "keys").map((item) => ({
        key: str(item, "key"), title: str(item, "title"), agency: str(item, "agency"), source: str(item, "source"),
        frequency: str(item, "frequency"), unit: str(item, "unit"),
        caveats: listOf(item, "caveats").filter((line): line is string => typeof line === "string"),
        check: { kind: str(obj(item, "check") ?? {}, "kind"), names: listOf(obj(item, "check") ?? {}, "names").filter((name): name is string => typeof name === "string"), reason: str(obj(item, "check") ?? {}, "reason") },
      })));
      const rawSite = obj(body, "site");
      setSite(rawSite ? Object.fromEntries(Object.entries(rawSite).filter(([, value]) => typeof value === "string")) as Record<string, string> : {});
      setStatus("ok");
    }).catch(() => { if (!cancelled) setStatus("error"); });
    return () => { cancelled = true; };
  }, []);
  const named = props.route.key ? keys.find((item) => item.key === props.route.key) : undefined;
  const checkLine = (item: KeyMethod) =>
    item.check.kind === "pair" ? `Cross-checked by: ${(item.check.names ?? []).join("; ")}.`
    : item.check.kind === "foreign" ? "Not a Chinese official statistic; carried for comparison and not cross-checked here."
    : `No independent reading: ${item.check.reason}`;
  return (
    <main id="main" tabIndex={-1} className="page">
      <div className="breadcrumbs"><a href="#/">Home</a><span aria-hidden="true">›</span><span>Methodology</span></div>
      <h1>How These Figures Are Made</h1>
      <p className="lede">Who compiled each number, how it reached this site, what the publisher revises, and how the figure is checked here.</p>
      {status === "loading" && <div className="state"><span className="loader" aria-hidden="true" />Loading…</div>}
      {status === "error" && <div className="state"><b>Methodology unavailable</b><p>The server did not answer.</p></div>}
      {status === "ok" && (
        <>
          {named && (
            <section className="method-key">
              <h2>{named.title}</h2>
              <p>{named.agency}. {named.frequency}. {named.unit}.</p>
              <p>{checkLine(named)}</p>
              {named.caveats.length > 0 && <ul>{named.caveats.map((line) => <li key={line}>{line}</li>)}</ul>}
              <p><a href={seriesHash([named.key])}>Back to the series ›</a></p>
            </section>
          )}
          <section>
            <h2>What this site does with a figure</h2>
            <dl className="method-site">
              {[["Storage", site.storage], ["Checking", site.audit], ["Attribution", site.attribution], ["Derivation", site.derivation]].map(([label, text]) => text ? (
                <div key={label}><dt>{label}</dt><dd>{text}</dd></div>
              ) : null)}
            </dl>
          </section>
          {sources.map((section) => (
            <section key={section.id} id={`source-${section.id}`}>
              <h2>{section.title}</h2>
              <p><b>Publisher.</b> {section.publisher}</p>
              <p><b>What is read.</b> {section.reads}</p>
              <p><b>How.</b> {section.how}</p>
              <p><b>Revisions.</b> {section.revisions}</p>
              {section.caveats.length > 0 && <ul>{section.caveats.map((line) => <li key={line}>{line}</li>)}</ul>}
              <details>
                <summary>{section.keys.length} series on this path</summary>
                <div className="links">{section.keys.map((key) => {
                  const entry = props.curated.find((item) => item.key === key);
                  return <a key={key} href={seriesHash([key])}>{entry?.title ?? key}</a>;
                })}</div>
              </details>
            </section>
          ))}
        </>
      )}
    </main>
  );
}

// ── Releases ──────────────────────────────────────────────────────────────────

function ReleasesPage(props: { route: Extract<Route, { view: "releases" }>; curated: CuratedEntry[]; navigate: (route: Route) => void }) {
  const [items, setItems] = useState<Release[]>([]);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const now = new Date();
  const month = props.route.month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [year, monthIndex] = month.split("-").map(Number);
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    const start = new Date(year ?? now.getFullYear(), (monthIndex ?? 1) - 1, 1);
    const end = new Date(year ?? now.getFullYear(), monthIndex ?? 1, 0);
    const day = (date: Date) => `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
    json(`/api/releases?start=${encodeURIComponent(`${day(start)} 00:00:00`)}&end=${encodeURIComponent(`${day(end)} 23:59:59`)}`).then((body) => {
      if (cancelled) return;
      const data = obj(body, "data");
      if (!Array.isArray(data)) { setStatus("error"); return; }
      setItems(data.map((item) => ({ id: str(item, "_id"), date: str(item, "fb_time"), title: str(item, "content"), en: str(item, "en"), keys: listOf(item, "keys").filter((key): key is string => typeof key === "string"), categories: listOf(item, "categories").filter((name): name is string => typeof name === "string") })).filter((item) => item.id && item.title));
      setStatus("ok");
    }).catch(() => { if (!cancelled) setStatus("error"); });
    return () => { cancelled = true; };
  }, [month]);
  const grouped = new Map<string, Release[]>();
  for (const item of [...items].sort((a, b) => a.date.localeCompare(b.date))) grouped.set(item.date.slice(0, 10), [...(grouped.get(item.date.slice(0, 10)) ?? []), item]);
  const shift = (delta: number) => { const date = new Date(year ?? now.getFullYear(), (monthIndex ?? 1) - 1 + delta, 1); props.navigate({ view: "releases", month: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}` }); };
  return (
    <main id="main" tabIndex={-1} className="page">
      <div className="breadcrumbs"><a href="#/">Home</a><span aria-hidden="true">›</span><span>Releases</span></div>
      <h1>NBS Release Calendar</h1>
      <p className="lede">Official publication schedule, China Standard Time. Each release links to the series it updates.</p>
      <div className="month-nav"><button className="button" onClick={() => shift(-1)} aria-label="Previous month">‹</button><b role="status">{new Date(year ?? now.getFullYear(), (monthIndex ?? 1) - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })}</b><button className="button" onClick={() => shift(1)} aria-label="Next month">›</button></div>
      {status === "loading" && <div className="state"><span className="loader" aria-hidden="true" />Loading the calendar…</div>}
      {status === "error" && <div className="state"><b>Release calendar unavailable</b><p>NBS didn't respond. The schedule is also published at <a href="https://www.stats.gov.cn/sj/fbrc/" target="_blank" rel="noreferrer">stats.gov.cn</a>.</p><div className="actions"><button className="button" onClick={() => shift(0)}>Try again</button></div></div>}
      {status === "ok" && grouped.size === 0 && (month > `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
        ? <div className="state"><b>Calendar not published yet</b><p>NBS has not released its schedule for this month. The coming year's calendar appears each December.</p></div>
        : <div className="state"><b>Nothing scheduled</b><p>NBS lists no releases for this month.</p></div>)}
      {status === "ok" && grouped.size > 0 && (
        <div className="release-list">
          {[...grouped.entries()].map(([date, releases]) => {
            const day = new Date(`${date}T00:00:00`);
            return (
              <section className="release-day" key={date}>
                <div className="release-date"><b>{day.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</b><span className="visually-hidden">, </span><span>{day.toLocaleDateString("en-US", { weekday: "short" })}</span></div>
                <div>{releases.map((release) => (
                  <article className="release" key={release.id}>
                    <time dateTime={release.date}>{release.date.slice(11, 16)}</time>
                    <div>
                      <div className="en">{release.en || <Zh>{release.title.replace(/\s*[（(]\d{1,2}:\d{2}[)）]\s*$/, "")}</Zh>}</div>
                      {release.en && <div className="zh"><Zh>{release.title.replace(/\s*[（(]\d{1,2}:\d{2}[)）]\s*$/, "")}</Zh></div>}
                      {(release.keys.length > 0 || release.categories.length > 0) && <div className="links">{release.keys.map((key) => { const entry = props.curated.find((item) => item.key === key); return entry ? <a key={key} href={seriesHash([key])}>{entry.title}</a> : null; })}{release.categories.map((name) => <a key={name} href={`#/category/${encodeURIComponent(name)}`}>{categoryEn(name) || name} series</a>)}</div>}
                    </div>
                  </article>
                ))}</div>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}

// ── Add a series ──────────────────────────────────────────────────────────────
//
// The same search as the search page, inline on the chart, so a comparison
// starts where the reader already is. Picking a result appends it to the URL.

/**
 * The search box that puts another series on a chart, and — with `onPick` — any
 * other place a series has to be chosen, such as the map on the Provinces page.
 * `geography` narrows the search to the tables published for places.
 */
function AddSeries(props: { keys: string[]; lang: string; navigate: (route: Route) => void; label?: string; geography?: string; onPick?: (entry: NbsCatalogEntry) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [results, setResults] = useState<NbsCatalogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  // Opening moves focus into the search box; closing (Escape, the button, a pick) returns it to
  // the button, so a keyboard user is not dropped at the top of the document.
  useEffect(() => {
    if (open) inputRef.current?.focus();
    else if (wasOpen.current) buttonRef.current?.focus();
    wasOpen.current = open;
  }, [open]);
  useEffect(() => {
    if (!draft.trim()) { setResults([]); return; }
    let cancelled = false;
    setBusy(true);
    const timer = window.setTimeout(() => {
      json(`/api/search?q=${encodeURIComponent(draft.trim())}&limit=8${props.geography ? `&geography=${encodeURIComponent(props.geography)}` : ""}`).then((body) => {
        if (cancelled) return;
        if (isSearchResponse(body)) setResults(body.results.filter((entry) => !props.keys.includes(entry.key)));
      }).catch(() => { if (!cancelled) setResults([]); }).finally(() => { if (!cancelled) setBusy(false); });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [draft, props.keys.join(","), props.geography]);
  if (!props.onPick && props.keys.length >= 4) return <p className="add-series-note">Four series is the most one chart can carry legibly. Remove one to add another.</p>;
  if (!open) return <button ref={buttonRef} className="button" onClick={() => setOpen(true)} aria-expanded={false}>{props.label ?? "Add series"}</button>;
  return (
    <>
    <button ref={buttonRef} className="button" aria-expanded={true} onClick={() => { setOpen(false); setDraft(""); }}>{props.label ?? "Add series"}</button>
    <div className="add-series" role="search">
      <div className="global-search"><SearchIcon /><input ref={inputRef} aria-label="Search for a series to add" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { setOpen(false); setDraft(""); } }} placeholder="Search in English or Chinese" /></div>
      <div className="add-series-results" role="listbox" aria-label="Matching series" aria-busy={busy}>
        {draft.trim() && !busy && results.length === 0 && <p className="add-series-note">No series match “{draft.trim()}”{props.geography === "Province" ? " among the series published by province" : props.geography === "City" ? " among the series published by city" : ""}.</p>}
        {results.map((entry) => {
          const zhFirst = props.lang === "zh" || !entry.nameEn || entry.datasetCode === 0;
          return (
            <button key={entry.key} role="option" aria-selected={false} className="add-series-row" onClick={() => {
              setOpen(false);
              setDraft("");
              if (props.onPick) props.onPick(entry);
              else props.navigate({ view: "series", keys: [...props.keys, entry.key], show: "", range: "", region: "", from: "", to: "", freq: "", agg: "", lny: "" });
            }}>
              <span className="title">{zhFirst ? <Zh>{entry.name}</Zh> : entry.nameEn}</span>
              {entry.nameEn && entry.datasetCode !== 0 && <span className="gloss">{zhFirst ? entry.nameEn : <Zh>{entry.name}</Zh>}</span>}
              {entry.datasetCode !== 0 && entry.categories.length > 0 && <span className="meta"><Zh>{(entry.categoriesEn?.every(Boolean) ? entry.categoriesEn : entry.categories).slice(-2).join(" › ")}</Zh></span>}
              <span className="meta">{entry.frequency}, {entry.datasetCode === 0 ? entry.dataset : "NBS"}, {unitLabel(entry.unit)}</span>
            </button>
          );
        })}
      </div>
      <button className="button" onClick={() => { setOpen(false); setDraft(""); }}>Cancel</button>
    </div>
    </>
  );
}

// ── Series page ───────────────────────────────────────────────────────────────

/**
 * The name a series view goes by outside the page: the browser tab, a bookmark and the share
 * image all use it. A compare across provinces keeps the measure ("Provincial Real GDP Growth:
 * Guangdong, Shanghai"); a single province or city names it ("Provincial Real GDP Growth: Hainan").
 */
function seriesViewTitle(results: SeriesResult[], lang: string): string {
  const primary = results[0];
  if (!primary) return "";
  if (results.length > 1 && results.every((result) => result.key === primary.key && result.region)) return `${primary.title}: ${results.map((result) => displayTitle(result, results)).join(", ")}`;
  if (results.length === 1 && primary.region && primary.region.value !== "000000000000" && primary.region.value !== "avg") return regionalTitle((lang !== "zh" && primary.metadata?.nameEn) || primary.title, regionLabel(primary.region), primary.series.length === 1 ? primary.series[0]?.label : undefined);
  return results.map((result) => (lang !== "zh" && result.metadata?.nameEn) || displayTitle(result, results)).join(", ");
}

function SeriesPage(props: {
  route: Extract<Route, { view: "series" }>; curated: CuratedEntry[]; saved: string[]; releases: Release[]; lang: string;
  onToggleSaved: (key: string) => void; navigate: (route: Route) => void; toast: (text: string) => void;
}) {
  const [results, setResults] = useState<SeriesResult[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("chart");
  const [logScale, setLogScale] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(Boolean(props.route.freq || props.route.show || props.route.lny));
  useEffect(() => { void warmShareFonts(); }, []);
  const [customDates, setCustomDates] = useState(Boolean(props.route.from || props.route.to));
  const [revised, setRevised] = useState<Revised[] | null>(null);
  // How the latest period got here: with a release the site watched for, or in a backfill.
  const [arrival, setArrival] = useState<{ period: string; sentence: string; kind: string; release?: { title: string; url: string } } | null>(null);
  const [related, setRelated] = useState<NbsCatalogEntry[]>([]);
  const [firstView, setFirstView] = useState(false);
  const colors = useRef(new Map<string, number>());
  const show: Show = isShow(props.route.show || "default") ? (isShow(props.route.show) ? props.route.show : "default") : "default";
  const years = props.route.range === "max" ? null : Number(props.route.range.replace("y", "")) || 10;
  const windowStart = props.route.from ? periodTime(props.route.from) : Number.NaN;
  const windowEnd = props.route.to ? periodTime(props.route.to) + 31 * 86400000 : Number.NaN;
  const windowed = Number.isFinite(windowStart) || Number.isFinite(windowEnd);
  const keysText = props.route.keys.join(",");

  useEffect(() => {
    // When the newest period of a single-series page arrived, and with what.
    setArrival(null);
    if (props.route.keys.length !== 1) return;
    const spec = splitSpec(props.route.keys[0] ?? "");
    if (!spec.key) return;
    let cancelled = false;
    json(`/api/arrivals/${encodeURIComponent(spec.key)}?limit=1${props.route.region ? `&region=${encodeURIComponent(props.route.region)}` : ""}`).then((body) => {
      if (cancelled) return;
      const first = listOf(body, "arrivals")[0];
      if (!first) return;
      const release = obj(first, "release");
      setArrival({
        period: str(first, "period"), sentence: str(first, "sentence"), kind: str(first, "kind"),
        ...(release ? { release: { title: str(release, "title"), url: str(release, "url") } } : {}),
      });
    }).catch(() => { /* an arrival is extra; the chart does not depend on it */ });
    return () => { cancelled = true; };
  }, [keysText, props.route.region]);

  useEffect(() => {
    // Any single-key page may have a region dimension: NBS catalog series or a curated one such as provincial GDP.
    const dynamic = props.route.keys.length === 1 ? splitSpec(props.route.keys[0] ?? "").key : "";
    setRegions([]);
    if (!dynamic) return;
    json(`/api/dimensions/${dynamic}`).then((body) => {
      const list = obj(body, "regions");
      if (Array.isArray(list)) setRegions(list.filter((item): item is Region => typeof str(item, "text") === "string" && str(item, "value") !== ""));
    }).catch(() => setRegions([]));
  }, [keysText]);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setFirstView(props.route.keys.some((key) => key.startsWith("nbs_")));
    const query = new URLSearchParams({ limit: "600" });
    if (props.route.region) query.set("region", props.route.region);
    if (show !== "default") query.set("transform", show);
    const fetchSpec = (spec: string, transform?: string): Promise<unknown> => {
      const { key, region } = splitSpec(spec);
      const params = new URLSearchParams(query);
      if (region) params.set("region", region);
      if (transform) params.set("transform", transform);
      return json(`/api/series/${key}?${params}`).then((body) => (isSeriesResult(body) ? { ...body, spec } : body));
    };
    Promise.all(props.route.keys.map((spec) => fetchSpec(spec)))
      .then(async (bodies) => {
        let parsed = bodies.filter(isSeriesResult);
        // Comparing a rate with a level puts a line at zero next to one in
        // the hundreds of thousands. When no transform was chosen and units
        // disagree, bring the level series to year-over-year so all share %.
        if (show === "default" && new Set(parsed.map((result) => result.unit)).size > 1 && parsed.some((result) => isRate(result.unit))) {
          parsed = await Promise.all(parsed.map(async (result) => {
            if (isRate(result.unit)) return result;
            const body = await fetchSpec(result.spec ?? result.key, /=100/.test(result.unit) ? "index_growth" : "yoy").catch(() => null);
            return isSeriesResult(body) ? body : result;
          }));
        }
        if (cancelled) return;
        setResults(parsed); setStatus("ok");
      })
      .catch((reason) => { if (cancelled) return; setError(reason instanceof Error ? reason.message : String(reason)); setStatus("error"); });
    return () => { cancelled = true; };
  }, [keysText, props.route.region, show]);

  useEffect(() => {
    if (results.length === 0) return;
    const primary = results[0];
    if (!primary) return;
    const query = new URLSearchParams();
    if (primary.region?.value) query.set("region", primary.region.value);
    json(`/api/revisions/${primary.key}?${query}`).then((body) => {
      const list = obj(body, "revised");
      if (!Array.isArray(list)) { setRevised([]); return; }
      setRevised(list.map((item) => ({ label: str(item, "label"), period: str(item, "period"), vintages: listOf(item, "vintages").map((vintage) => ({ value: num(vintage, "value"), fetchedAt: str(vintage, "fetchedAt") })) })));
    }).catch(() => setRevised([]));
  }, [results.map((result) => result.key).join(",")]);

  useEffect(() => {
    // Siblings in the same NBS category, for a single catalog series: the cheapest way to browse a table.
    const first = results[0];
    const category = first?.metadata?.categories.at(-1);
    if (results.length !== 1 || !first?.metadata || !category) { setRelated([]); return; }
    const query = new URLSearchParams({ category, limit: "12" });
    json(`/api/search?${query}`).then((body) => {
      if (!isSearchResponse(body)) { setRelated([]); return; }
      const family = new Set(first.metadata?.family?.members ?? []);
      setRelated(body.results.filter((entry) => entry.key !== first.key && !family.has(entry.key)).slice(0, 6));
    }).catch(() => setRelated([]));
  }, [results.map((result) => result.key).join(",")]);

  const primary = results[0];
  const built = useMemo(() => buildTracks(results, colors.current), [results]);
  const units = [...new Set(results.map((result) => result.unit))];
  const mixed = units.length > 1;
  const lastT = Math.max(0, ...built.tracks.flatMap((track) => track.points.map((point) => point.t)));
  const rangeStart = years === null ? -Infinity : lastT - years * 365.25 * 86400000;
  // Frequency: an explicit choice wins; otherwise a compare that mixes
  // monthly and quarterly series is brought to the coarser one, so twelve
  // points a year are never drawn against four on the same axis.
  const chosenFrequency = isTargetFrequency(props.route.freq) ? props.route.freq : "";
  const autoFrequency = chosenFrequency ? "" : coarsestFrequency(built.tracks);
  const targetFrequency: TargetFrequency | "" = chosenFrequency || autoFrequency;
  // The frequencies this chart can actually be converted to: coarser than the
  // finest series on it. Everything here is annual once the annual datasets land.
  const finestRank = Math.min(...built.tracks.map((track) => FREQUENCY_RANK[track.frequency] ?? 1), 3);
  const coarserFrequencies = (["Quarterly", "Annual"] satisfies TargetFrequency[]).filter((item) => (FREQUENCY_RANK[item] ?? 0) > finestRank);
  const aggregation: Aggregation = isAggregation(props.route.agg) ? props.route.agg : "avg";
  const nativeTracks = targetFrequency ? built.tracks.map((track) => convertTrack(track, targetFrequency, aggregation)) : built.tracks;
  const converted = targetFrequency ? built.tracks.filter((track) => (FREQUENCY_RANK[track.frequency] ?? 0) < (FREQUENCY_RANK[targetFrequency] ?? 0)) : [];
  const convertedTitles = [...new Set(results.filter((result) => targetFrequency && (FREQUENCY_RANK[result.frequency] ?? 0) < (FREQUENCY_RANK[targetFrequency] ?? 0)).map((result) => displayTitle(result, results)))];
  // Mixed level units are rebased to a common index; a percentage cannot be
  // rebased meaningfully, so a mix that includes a rate shares one raw axis.
  const rebased = mixed && !nativeTracks.some((track) => isRate(track.unit));
  const tracks = rebased ? rebase(nativeTracks, rangeStart) : nativeTracks;
  const unit = rebased ? "Index, first shown period = 100" : mixed ? units.join("; ") : (primary?.unit ?? "");
  const aggregationLabel = aggregation === "sum" ? "sums" : aggregation === "last" ? "end-of-period values" : "averages";
  const canLog = tracks.every((track) => track.points.every((point) => point.v > 0));
  const set = (patch: Partial<Extract<Route, { view: "series" }>>) => props.navigate({ ...props.route, ...patch });

  // The tab and any bookmark carry the series name once it has loaded, the key until then.
  const tabTitle = status === "ok" && primary ? seriesViewTitle(results, props.lang) : "";
  useEffect(() => { document.title = `${tabTitle || props.route.keys.join(", ")} - EconStats China Data`; }, [tabTitle, routeHash(props.route)]);

  if (status === "loading") return <main id="main" tabIndex={-1} className="page"><div className="state" role="status"><span className="loader" aria-hidden="true" />{firstView ? <p>Fetching from NBS for the first time. This takes a couple of seconds. Future views load instantly from the stored copy.</p> : <p>Loading…</p>}</div><div className="skeleton" aria-hidden="true" /></main>;
  if (status === "error" || !primary) return <main id="main" tabIndex={-1} className="page"><div className="state" role="alert"><b>Series unavailable</b><p>{/Unknown/.test(error) ? "There is no series with this ID. Check the link, or search for the series by name." : /AKTools/.test(error) ? error : /returned no observations/i.test(error) ? "NBS lists this table but has published no data for it, so there is nothing to chart. The other series in its category may have what you need." : /esData|NBS|HTTP 5\d\d|Unable to connect|timed out/i.test(error) ? "NBS didn't respond, and this series has no stored copy yet, so there's nothing to show." : error || "No observations came back."}</p><div className="actions"><button className="button" onClick={() => set({})}>Try again</button><a className="button" href="#/">Home</a></div></div></main>;

  const firstSeries = built.tracks[0];
  const headline = primary.series[0];
  const latest = headline?.points[headline.points.length - 1];
  const previous = headline?.points[headline.points.length - 2];
  const saved = props.saved.includes(primary.key);
  const meta = primary.metadata;
  const curated = props.curated.find((entry) => entry.key === primary.key);
  // Other curated series in the same group; a series alone in its group (provincial GDP) gets no Related section.
  const curatedSiblings = curated ? props.curated.filter((entry) => entry.group === curated.group && entry.key !== curated.key).slice(0, 4) : [];
  const definition = meta?.noteEn || meta?.note || ABOUT[primary.key] || "";
  const definitionZh = meta?.noteEn && meta.note ? meta.note : "";
  const readingNotes = [
    ...(READING[primary.key] ?? (meta?.annotation ? [meta.annotationEn || meta.annotation] : built.notes)),
    ...(curated?.endedNote ? [curated.endedNote] : []),
    ...(meta?.februaryFrom ? ["NBS publishes January and February together. The February point is the combined figure, taken from the year-to-date series of the same table; there is no January point."] : []),
    // The pieces' nominal span is what NBS names them by; the Range row states what they hold, which
    // can start later (a 2003 piece with data from 2007) or leave years uncovered between pieces.
    ...(meta?.family ? [`NBS publishes this table in ${meta.family.members.length} year-range pieces, nominally ${meta.family.span}; they are joined here into one series, and the Range below is what the pieces hold. Where two pieces overlap, the newer one is used.`] : []),
  ];
  const readingNotesZh = meta?.annotationEn && meta.annotation ? meta.annotation : "";
  const nextRelease = props.releases.filter((release) => release.keys.includes(primary.key) && isUpcoming(release.date)).sort((a, b) => a.date.localeCompare(b.date))[0];
  const stale = primary.source === "stale";
  const zhFirst = props.lang === "zh" || !meta?.nameEn;
  // One place's series is headed by the place and the measure together ("Guangdong Real GDP
  // Growth"); the lede then carries only the place's Chinese name.
  const placed = results.length === 1 && primary.region && primary.region.value !== "000000000000" && primary.region.value !== "avg" && primary.region.text !== "全国" ? regionLabel(primary.region) : "";
  const headingLine = primary.series.length === 1 ? primary.series[0]?.label : undefined;
  const zhTitle = placed && zhFirst ? regionalTitle(primary.title, placed, headingLine) : primary.title;
  const enTitle = placed && meta?.nameEn ? regionalTitle(meta.nameEn, placed, headingLine) : meta?.nameEn;
  const via = primary.sourceUrl.includes("eastmoney") ? "Eastmoney datacenter, which mirrors the official release" : primary.sourceUrl.includes("akshare") ? "AkShare, an open-source data library" : primary.sourceUrl.includes("fred.stlouisfed") ? "FRED, the Federal Reserve Bank of St. Louis database" : "NBS's own data portal";
  const sourceLink = meta ? "https://data.stats.gov.cn/dg/website/page.html" : primary.sourceUrl;
  const citation = `${primary.agency}, "${primary.title}"${meta?.nameEn ? ` [${meta.nameEn}]` : ""}, series ${primary.key}, retrieved ${fmtDate(new Date().toISOString())} from EconStats China Data, ${window.location.origin}/${seriesHash([primary.key])}`;
  const tableFrequency = new Set(tracks.map((track) => track.frequency)).size === 1 ? (tracks[0]?.frequency ?? "Monthly") : "Mixed";
  const tableRows = (() => {
    const rows = new Map<string, { period: string; t: number; cells: (number | null)[] }>();
    tracks.forEach((track, index) => {
      for (const point of track.points) {
        const key = canonicalPeriod(point.p, tableFrequency);
        const row = rows.get(key) ?? { period: key, t: periodTime(key), cells: tracks.map(() => null) };
        row.cells[index] = point.v;
        rows.set(key, row);
      }
    });
    return [...rows.values()].sort((a, b) => b.t - a.t);
  })();
  const shownRows = tableRows.slice(0, 500);
  const delta = deltaText(latest, previous, primary.unit, "long", primary.frequency);
  const downloadItems = [
    {
      label: "Download CSV",
      onSelect: () => downloadBlob(shareFileName(props.route.keys, "csv"), new Blob([csvOf(results.map((result) => ({ title: result.title, unit: result.unit, agency: result.agency, region: result.region && result.region.value !== "000000000000" ? regionLabel(result.region) : undefined })), tracks, built.notes)], { type: "text/csv;charset=utf-8" })),
    },
    {
      label: "Download JSON",
      onSelect: () => downloadBlob(shareFileName(props.route.keys, "json"), new Blob([JSON.stringify(results, null, 2)], { type: "application/json" })),
    },
  ];
  const lunar = props.route.lny === "1";
  // A shared image of a discontinued series says so; the page's amber notice does not travel with the picture.
  const endedNotes = results.flatMap((result) => {
    const entry = props.curated.find((item) => item.key === result.key);
    return entry?.ended ? [`${result.title} ended in ${periodPretty(entry.ended)}; the last value shown is the final one published.`] : [];
  });
  // The page's February note travels with the picture too: a reader of the image alone would
  // otherwise take the combined January-February point for a February reading.
  const februaryNotes = results.filter((result) => result.metadata?.februaryFrom).map((result) => `${results.length > 1 ? `${displayTitle(result, results)}: ` : ""}February is the combined January-February figure NBS publishes; there is no January point.`);
  // A series whose last value is older than its schedule allows says so on the picture, as the page
  // does in its notice; a reader of the image alone would otherwise take Q4 2019 as current.
  const behindNotes = results.flatMap((result) => {
    const entry = props.curated.find((item) => item.key === result.key);
    const last = result.series[0]?.points.at(-1)?.date;
    if (!last || entry?.ended || !isBehind(last, result.frequency)) return [];
    const name = results.length > 1 ? `${displayTitle(result, results)}: last` : "Last";
    const when = observationLabel(last, result.frequency);
    return [entry?.refreshBlocked ? `${name} value ${when}; refreshed through ${entry.refreshBlocked}, which this deployment does not run.` : `${name} published ${when}; nothing newer has been published.`];
  });
  const shareInput = (): ShareInput => ({
    title: seriesViewTitle(results, props.lang),
    unit: unitLabel(unit),
    frequencies: [...new Set(tracks.map((track) => track.frequency))],
    tracks: visibleTracks(tracks, years, windowStart, windowEnd),
    gaps: built.gaps,
    notes: [...endedNotes, ...behindNotes, ...februaryNotes, ...built.notes, ...(targetFrequency && converted.length > 0 ? [`${converted.map((track) => track.name).join(", ")}: ${targetFrequency.toLowerCase()} ${aggregationLabel} of ${converted[0]?.frequency.toLowerCase()} data.`] : [])],
    logScale: logScale && canLog,
    lunar,
    source: [...new Set(results.map((result) => result.agency))].join(", ") + (results.some((result) => result.sourceUrl.includes("eastmoney")) ? " via Eastmoney" : ""),
    url: window.location.href,
    date: fmtDate(new Date().toISOString()),
  });
  const noImage = tracks.every((track) => track.points.length === 0);
  const shareItems = [
    {
      label: "Copy image",
      disabled: noImage,
      onSelect: () => {
        const image = renderShareImage(shareInput());
        if (!canCopyImage()) {
          image.then((blob) => { downloadBlob(shareFileName(props.route.keys, "png"), blob); props.toast("Image downloaded. Copying is not supported in this browser."); }).catch(() => props.toast("Could not make the image"));
          return;
        }
        copyImage(image).then(() => props.toast("Image copied")).catch(() => {
          image.then((blob) => { downloadBlob(shareFileName(props.route.keys, "png"), blob); props.toast("Copy was blocked. Image downloaded instead."); }).catch(() => props.toast("Could not make the image"));
        });
      },
    },
    {
      label: "Download image",
      disabled: noImage,
      onSelect: () => { renderShareImage(shareInput()).then((blob) => downloadBlob(shareFileName(props.route.keys, "png"), blob)).catch(() => props.toast("Could not make the image")); },
    },
    {
      label: "Copy link",
      onSelect: () => { navigator.clipboard?.writeText(window.location.href).then(() => props.toast("Link copied")).catch(() => props.toast("Could not copy the link")); },
    },
  ];

  return (
    <main id="main" tabIndex={-1} className="page">
      <div className="breadcrumbs">
        <a href="#/">Home</a><span aria-hidden="true">›</span>
        {meta ? <><a href="#/browse">Categories</a>{meta.categories.slice(0, 2).map((category, index) => <React.Fragment key={category}><span aria-hidden="true">›</span><a href={`#/category/${encodeURIComponent(category)}`}><Zh>{meta.categoriesEn?.[index] || categoryEn(category) || category}</Zh></a></React.Fragment>)}</>
          : <><span>Headline Indicators</span><span aria-hidden="true">›</span><span>{curated?.group ?? primary.agency}</span></>}
      </div>
      <PageHeader
        title={<>{zhFirst ? <Zh>{zhTitle}</Zh> : enTitle}{meta?.nameEn && <span className="gloss">{zhFirst ? enTitle : <Zh>{primary.title}</Zh>} <span className="tag">{meta.nameEnSource === "nbs-official" ? "NBS English" : "auto-translated"}</span></span>}</>}
        subtitle={results.length > 1
          ? <p className="lede">{primary.region && primary.region.value !== "000000000000" ? `${regionLabel(primary.region)}, compared with ` : "Compared with "}{listWords(results.slice(1).map((result) => displayTitle(result, results)))}</p>
          // One regional series: the heading names the measure, so the lede names the place (not for the national or the 70-city average views).
          : primary.region && primary.region.value !== "000000000000" && primary.region.value !== "avg"
            ? (placed
              ? (regionLabel(primary.region) !== primary.region.text ? <p className="lede"><Zh className="gloss">{primary.region.text}</Zh></p> : undefined)
              : <p className="lede">{regionLabel(primary.region)}{regionLabel(primary.region) !== primary.region.text && <> <Zh className="gloss">{primary.region.text}</Zh></>}</p>)
            : undefined}
        actions={<>
          <button className="button" aria-pressed={saved} onClick={() => props.onToggleSaved(primary.key)}><StarIcon filled={saved} />{saved ? "Saved" : "Save"}</button>
          <ActionMenu label="Download" items={downloadItems} />
          <ActionMenu label="Share" items={shareItems} />
        </>}
      />
      <div className="meta-line"><span>{primary.frequency}</span><span>{unitLabel(primary.unit)}</span><span>{primary.agency}</span>{primary.frequency !== "Annual" && !/seasonal|季调/i.test(`${primary.title} ${primary.unit}`) && <span>Not seasonally adjusted</span>}{primary.region && primary.region.value !== "000000000000" && <span>Region: {regionLabel(primary.region)} <Zh>{regionLabel(primary.region) === primary.region.text ? "" : primary.region.text}</Zh></span>}</div>

      {/* The stat line carries a hidden prefix, not an aria-label: on a paragraph the label would replace the value for a screen reader. */}
      {latest && (
        <p className="stat-line"><span className="visually-hidden">Latest observation: </span>
          <span className="stat-value">{fmt(latest.value, primary.unit)}</span><span className="visually-hidden">, </span>
          <span className="stat-text">{unitLabel(primary.unit)}, {primary.region && primary.region.value !== "000000000000" ? `${regionLabel(primary.region)}, ` : ""}{primary.series.length > 1 && headline?.label && headline.label !== primary.title ? `${headline.label}, ` : ""}{observationLabel(latest.date, primary.frequency)}{delta ? `. ${delta}.` : ""}{stale && <span className="stale"> Stored copy from {fmtDate(primary.updatedAt)}; NBS was unreachable today.</span>}</span>
        </p>
      )}

      <div className="chip-row">
        {results.length > 1 && results.map((result) => { const ident = result.spec ?? result.key; const track = built.tracks.find((item) => item.id.startsWith(`${ident} `)); const title = displayTitle(result, results); return <span className="chip" key={ident}><i className="swatch" style={{ background: track?.color }} />{title}<button onClick={() => set({ keys: props.route.keys.filter((spec) => spec !== ident) })} aria-label={`Remove ${title} from the chart`}>×</button></span>; })}
      </div>
      {autoFrequency && converted.length > 0 && <div className="notice info"><div>{listWords(convertedTitles)} {convertedTitles.length === 1 ? "is" : "are"} shown as {autoFrequency.toLowerCase()} {aggregationLabel} so the frequencies on this chart match. Change this under Options.</div></div>}
      {rebased && <div className="notice info"><div>These series have different units ({units.join("; ")}), so each is shown as an index with the first period = 100. Choose a common transform under Options.</div></div>}
      {mixed && !rebased && <div className="notice"><div>These series have different units ({units.join("; ")}) and share one axis, so compare their shapes, not their levels. Choose a common transform under Options.</div></div>}
      {!mixed && show === "default" && results.length > 1 && results.some((result) => result.transform && result.transform !== "raw" && !props.route.show) && <div className="notice info"><div>Level series are shown as % change from a year ago so their units match the rates on this chart. Change this under Options.</div></div>}
      {curated?.ended && <div className="notice"><div><b>This series ended in {periodPretty(curated.ended)}.</b>{curated.endedNote}</div></div>}
      {!curated?.ended && latest && isBehind(latest.date, primary.frequency) && <div className="notice"><div><b>Latest available observation is {observationLabel(latest.date, primary.frequency)}.</b>{curated?.refreshBlocked
        ? `This series is refreshed through ${curated.refreshBlocked}, which this deployment does not run, so nothing newer can appear here until it does.`
        : `The source has published nothing newer; the store was last checked ${fmtDate(primary.updatedAt) || "today"}.`}</div></div>}
      {stale && <div className="notice"><div><b>Showing data stored {fmtDate(primary.updatedAt)}.</b>NBS was unreachable at today's refresh. The values are the last good copy.</div></div>}

      <section className="card data-card">
        <ChartPanelHeader
          views={<div className="segmented" role="tablist" aria-label="View" onKeyDown={(event) => {
            // Arrow keys move between tabs, as the tablist pattern expects.
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            const next: Tab = tab === "chart" ? "table" : "chart";
            setTab(next);
            document.getElementById(`tab-${next}`)?.focus();
            event.preventDefault();
          }}>
            {(["chart", "table"] satisfies Tab[]).map((item) => <button key={item} role="tab" id={`tab-${item}`} tabIndex={tab === item ? 0 : -1} aria-selected={tab === item} aria-controls={`panel-${item}`} onClick={() => setTab(item)}>{item.charAt(0).toUpperCase() + item.slice(1)}</button>)}
          </div>}
          controls={<>
          {regions.length > 1 && !props.route.keys.some((spec) => spec.includes("@")) && <label>Region<select value={props.route.region || regions[0]?.value} onChange={(event) => set({ region: event.target.value })}>{regions.map((item) => <option key={item.value} value={item.value}>{regionLabel(item) === item.text ? item.text : `${regionLabel(item)} ${item.text}`}</option>)}</select></label>}
          {/* Every place at once: the map and ranking, for a series published by place. */}
          {regions.length > 4 && props.route.keys.length === 1 && <a className="button" href={routeHash({ view: "regions", period: "", key: splitSpec(props.route.keys[0] ?? "").key })}>{curated?.source === "customs" ? (curated.key === "trade_partners" ? "All partners" : "All commodities") : "All places"}</a>}
          <button className="button" aria-expanded={optionsOpen} aria-controls="chart-options" onClick={() => setOptionsOpen((value) => !value)}>Options</button>
          <AddSeries keys={props.route.keys} lang={props.lang} navigate={props.navigate} />
          </>}
        />
        {optionsOpen && <div className="chart-options" id="chart-options">
          {/* Only frequencies coarser than what is on the chart: an annual
              series cannot be shown quarterly, and offering it does nothing. */}
          <label>Frequency<select value={chosenFrequency} onChange={(event) => set({ freq: event.target.value === "" ? "" : event.target.value })}><option value="">{autoFrequency ? `Native (${autoFrequency.toLowerCase()} for this compare)` : "Native"}</option>{coarserFrequencies.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          {targetFrequency && <label>Aggregate<select value={aggregation} onChange={(event) => set({ agg: event.target.value === "avg" ? "" : event.target.value })}><option value="avg">Average</option><option value="sum">Sum</option><option value="last">End of period</option></select></label>}
          <label>Show as<select value={show} onChange={(event) => { if (isShow(event.target.value)) set({ show: event.target.value === "default" ? "" : event.target.value }); }}>{SHOW_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          {canLog && <label><input type="checkbox" checked={logScale} onChange={(event) => setLogScale(event.target.checked)} /> Log scale</label>}
          {results.some((result) => result.frequency === "Monthly") && <label><input type="checkbox" checked={lunar} onChange={(event) => set({ lny: event.target.checked ? "1" : "" })} /> Shade Lunar New Year</label>}
        </div>}
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === "chart" && (
            <>
              <div className="range-row" role="group" aria-label="Date range">{RANGES.map((item) => <button key={item.label} aria-pressed={!windowed && years === item.years} onClick={() => { setCustomDates(false); set({ range: item.years === null ? "max" : `${item.years}y`, from: "", to: "" }); }}>{item.label}</button>)}<button aria-pressed={customDates || windowed} onClick={() => setCustomDates((value) => !value)}>Custom</button>{(customDates || windowed) && <><label className="date-pick">From<input type="month" value={props.route.from} max={props.route.to || undefined} onChange={(event) => set({ from: event.target.value })} aria-label="Start month" autoFocus={customDates && !windowed} /></label><label className="date-pick">To<input type="month" value={props.route.to} min={props.route.from || undefined} onChange={(event) => set({ to: event.target.value })} aria-label="End month" /></label></>}</div>
              <div><SeriesChart tracks={tracks} gaps={built.gaps} years={years} start={windowStart} end={windowEnd} logScale={logScale && canLog} lunar={lunar} unit={unit} title={results.map((result) => result.title).join(", ")} /></div>
              {tracks.length > 1 && <div className="chart-legend" aria-label="Legend">{tracks.map((track) => <span key={track.id}><i className={track.dash ? "dashed" : ""} style={{ color: track.color }} />{track.name}</span>)}</div>}
              {built.notes.map((note) => <p className="chart-caption" key={note}><Zh>{note}</Zh></p>)}
              {targetFrequency && converted.length > 0 && <p className="chart-caption">{converted.map((track) => track.name).join(", ")}: {targetFrequency.toLowerCase()} {aggregationLabel} of {converted[0]?.frequency.toLowerCase()} data; an incomplete final period is omitted.</p>}
              {!built.notes.length && firstSeries && <p className="chart-caption">{unitLabel(unit)}{lunar && primary.frequency === "Monthly" ? ". January and February are shaded: Lunar New Year falls in either month and distorts both." : ""}</p>}
            </>
          )}
          {tab === "table" && (
            <>
              <div className="table-scroll"><table><caption className="visually-hidden">{seriesViewTitle(results, props.lang)}: {unitLabel(unit)}, {tableFrequency.toLowerCase()} data, one row per period, newest first.</caption><thead><tr><th scope="col">Period</th>{tracks.map((track) => <th key={track.id} scope="col">{track.name}</th>)}</tr></thead><tbody>{shownRows.map((row) => <tr key={row.period}><td>{observationLabel(row.period, tableFrequency)}</td>{row.cells.map((cell, index) => <td key={index}>{cell === null ? "—" : fmt(cell, unit)}</td>)}</tr>)}</tbody></table></div>
              <div className="table-foot"><span>{unit}</span><span>{tableRows.length > shownRows.length ? `Showing the latest ${shownRows.length} of ${tableRows.length} periods. The CSV download has all of them.` : `${tableRows.length} periods`}</span></div>
            </>
          )}
        </div>
      </section>

      <section className="details">
        <div className="card about">
          <h2>Notes</h2>
          {definition ? <p><Zh>{definition}</Zh>{definitionZh && <Zh className="gloss block">{definitionZh}</Zh>}</p> : readingNotes.length === 0 ? <p className="muted">The source publishes no definition or methodology note for this series.</p> : null}
          {readingNotes.length > 0 && (definition ? <ul>{readingNotes.map((note) => <li key={note}><Zh>{note}</Zh></li>)}</ul> : readingNotes.map((note) => <p key={note}><Zh>{note}</Zh></p>))}
          {meta?.growthSibling && <p>NBS publishes a growth rate for this table, <a href={seriesHash([meta.growthSibling.key], { region: primary.region?.value })}><Zh>{meta.growthSibling.name}</Zh></a>, computed on a scope held comparable with the year before. These levels are on the current scope, so a year-over-year change worked out from them will differ from the published rate.</p>}
          {readingNotesZh && <p><Zh className="gloss block">{readingNotesZh}</Zh></p>}
        </div>
        <div className="card">
          <h2>Series Details</h2>
          <dl>
            <dt>Source</dt><dd>{primary.agency}{curated && <>. <a href={routeHash({ view: "methodology", key: primary.key })}>How this figure is made ›</a></>}</dd>
            {arrival && <><dt>How it arrived</dt><dd>{arrival.sentence}{arrival.release?.url && <> <a href={arrival.release.url} target="_blank" rel="noreferrer">Open the release</a></>}</dd></>}
            <dt>Retrieved via</dt><dd>{via}. <a href={sourceLink} target="_blank" rel="noreferrer">{meta ? "Open on data.stats.gov.cn" : "Open the source"}</a></dd>
            {meta && <><dt>Dataset</dt><dd>{meta.datasetEn ? <>{meta.datasetEn} <Zh className="gloss">{meta.dataset}</Zh></> : <Zh>{meta.dataset}</Zh>}</dd></>}
            <dt>Category</dt><dd>{meta ? categoryPath(meta) : curated?.group ?? "—"}</dd>
            <dt>Region</dt><dd>{primary.region ? <>{regionLabel(primary.region)}{regionLabel(primary.region) !== primary.region.text && <> <Zh className="gloss">{primary.region.text}</Zh></>}</> : "China, national"}</dd>
            <dt>Frequency</dt><dd>{primary.frequency}</dd>
            <dt>Unit</dt><dd>{unitLabel(primary.unit)}</dd>
            <dt>Range</dt><dd>{headline && headline.points.length > 0 ? `${observationLabel(headline.points[0]?.date ?? "", primary.frequency)} to ${observationLabel(headline.points[headline.points.length - 1]?.date ?? "", primary.frequency)}` : "—"}</dd>
            <dt>Updated</dt><dd>{primary.source === "live" ? "Just now" : fmtDate(primary.updatedAt) || "—"}</dd>
            <dt>Next release</dt><dd>{nextRelease ? `${fmtDate(nextRelease.date.slice(0, 10))}, ${nextRelease.date.slice(11, 16)} CST, ${nextRelease.en}${curated?.refreshBlocked ? `; not refreshed on this deployment, which does not run ${curated.refreshBlocked}` : ""}` : /National Bureau of Statistics/.test(primary.agency) ? "Not in the NBS calendar for this month or next" : curated?.releaseDay ? `Published by ${primary.agency} by about the ${ordinal(curated.releaseDay)} of the following month; its calendar for this period is not on its site yet` : `Not in the NBS calendar; published by ${primary.agency}`}</dd>
            <dt>Series ID</dt><dd><code className="series-id">{primary.key}</code></dd>
            {meta?.nameEn && <><dt>English title</dt><dd>{meta.nameEnSource === "nbs-official" && meta.nameEnSourceUrl
              ? <a href={meta.nameEnSourceUrl} target="_blank" rel="noreferrer">Official NBS English catalog</a>
              : "Auto-translated from the official Chinese title"}</dd></>}
          </dl>
        </div>
      </section>

      <section className="card revisions">
        <div className="revisions-head"><h2>Revisions</h2><span>{revised === null ? "Loading…" : revised.length === 0 ? "None recorded" : `${revised.length} restated ${revised.length === 1 ? "value" : "values"}`}</span></div>
        {revised !== null && revised.length === 0 && <p>No stored value for this series has been revised by the source. Revised values are kept alongside the original.</p>}
        {revised !== null && revised.length > 0 && <div className="table-scroll"><table><caption className="visually-hidden">Revisions to {displayTitle(primary, results)}: each restated period with its current value and the values published before.</caption><thead><tr><th scope="col">Period</th><th scope="col" style={{ textAlign: "left" }}>Series</th><th scope="col">Current</th><th scope="col">Previously</th></tr></thead><tbody>{revised.map((row) => <tr key={`${row.label}${row.period}`}><td>{row.period}</td><td style={{ textAlign: "left", fontFamily: "var(--sans)" }}>{row.label}</td><td>{row.vintages.at(-1)?.value === null || row.vintages.at(-1) === undefined ? "—" : fmt(row.vintages.at(-1)?.value ?? 0, primary.unit)}</td><td>{row.vintages.slice(0, -1).map((vintage) => `${vintage.value === null ? "—" : fmt(vintage.value, primary.unit)} (${fmtDate(vintage.fetchedAt)})`).join(", ")}</td></tr>)}</tbody></table></div>}
      </section>
      <div className="cite"><p>Cite: {citation}</p><button className="button" onClick={() => navigator.clipboard?.writeText(citation).then(() => props.toast("Citation copied"))}>Copy</button></div>

      {!curated && meta && related.length > 0 && <section className="related"><div className="section-head"><h2>Related Series</h2><span>{categoryPath({ categories: meta.categories.slice(-1), categoriesEn: meta.categoriesEn?.slice(-1), family: meta.family })}</span><a className="more" href={`#/category/${encodeURIComponent(meta.categories.at(-1) ?? "")}`}>All in this category</a></div><div className="tiles">{related.map((entry) => <a key={entry.key} className="tile" href={seriesHash([entry.key])}><span className="label">{entry.nameEn || entry.name}</span>{entry.nameEn && <small><Zh>{entry.name}</Zh></small>}<small>{entry.frequency}, {unitLabel(entry.unit)}</small></a>)}</div></section>}
      {curated && curatedSiblings.length > 0 && <section className="related"><div className="section-head"><h2>Related Series</h2><span>{curated.group}</span></div><div className="tiles">{curatedSiblings.map((entry) => <a key={entry.key} className="tile" href={seriesHash([entry.key])}><span className="label">{entry.title}</span><small>{entry.frequency}, {entry.agency}</small></a>)}</div></section>}
    </main>
  );
}

// ── Regions ───────────────────────────────────────────────────────────────────
//
// A tile cartogram: equal-area tiles arranged roughly by geography, so the
// municipalities stay readable beside the large provinces and the map does not
// imply a precision the data does not have. Positions follow the design mock
// on an eight-column grid.

interface Province { code: string; abbr: string; en: string; zh: string; col: number; row: number; }

// Only the grid position lives here; the names come from the shared place list
// so the map, the region picker and the downloads all say the same thing.
const TILES: { code: string; col: number; row: number }[] = [
  { code: "230000000000", col: 8, row: 1 },
  { code: "650000000000", col: 1, row: 2 },
  { code: "150000000000", col: 5, row: 2 },
  { code: "220000000000", col: 8, row: 2 },
  { code: "620000000000", col: 3, row: 3 },
  { code: "640000000000", col: 4, row: 3 },
  { code: "110000000000", col: 6, row: 3 },
  { code: "120000000000", col: 7, row: 3 },
  { code: "210000000000", col: 8, row: 3 },
  { code: "630000000000", col: 2, row: 4 },
  { code: "610000000000", col: 4, row: 4 },
  { code: "140000000000", col: 5, row: 4 },
  { code: "130000000000", col: 6, row: 4 },
  { code: "370000000000", col: 7, row: 4 },
  { code: "540000000000", col: 1, row: 5 },
  { code: "510000000000", col: 3, row: 5 },
  { code: "410000000000", col: 5, row: 5 },
  { code: "320000000000", col: 7, row: 5 },
  { code: "310000000000", col: 8, row: 5 },
  { code: "500000000000", col: 3, row: 6 },
  { code: "420000000000", col: 5, row: 6 },
  { code: "340000000000", col: 6, row: 6 },
  { code: "330000000000", col: 8, row: 6 },
  { code: "530000000000", col: 2, row: 7 },
  { code: "520000000000", col: 3, row: 7 },
  { code: "430000000000", col: 5, row: 7 },
  { code: "360000000000", col: 6, row: 7 },
  { code: "350000000000", col: 7, row: 7 },
  { code: "450000000000", col: 4, row: 8 },
  { code: "440000000000", col: 5, row: 8 },
  { code: "460000000000", col: 4, row: 9 },
];
const PROVINCES: Province[] = TILES.map((tile) => {
  const place = PROVINCE_PLACES.find((item) => item.code === tile.code);
  return { code: tile.code, abbr: place?.abbr ?? "", en: place?.en ?? tile.code, zh: place?.zh ?? "", col: tile.col, row: tile.row };
});

// Paper to the brand red: the map reads as one ink getting heavier, not a second hue.
const RAMP = ["#f4f2ec", "#e5d2cc", "#d1a69c", "#b8776a", "#9a4034", "#6c1f18"];

interface RegionalValue { region: Region; value: number | null; period: string | null; points: SeriesPoint[]; }
interface RegionalResponse { key: string; title: string; unit: string; frequency: string; agency: string; geography?: string; stored?: number; labels?: string[]; label?: string | null; updatedAt: string | null; periods: string[]; values: RegionalValue[]; }

function isRegionalResponse(value: unknown): value is RegionalResponse {
  return typeof obj(value, "key") === "string" && Array.isArray(obj(value, "values")) && Array.isArray(obj(value, "periods"));
}

/** Six class breaks from the quantiles of the values shown, so every step is used. */
function breaksFor(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return [0, 0, 0, 0, 0];
  return [1, 2, 3, 4, 5].map((step) => { const at = (step / 6) * (sorted.length - 1); const low = sorted[Math.floor(at)] ?? 0; const high = sorted[Math.ceil(at)] ?? low; return Math.round((low + (high - low) * (at - Math.floor(at))) * 10) / 10; });
}
function stepFor(value: number, breaks: number[]): number { let step = 0; for (const edge of breaks) if (value >= edge) step += 1; return Math.min(step, RAMP.length - 1); }

interface ProvinceCard {
  code: string; en: string; zh: string;
  gdpGrowth: { period: string; value: number } | null;
  industrialGrowth: { period: string; value: number } | null;
  grp: { year: string; value: number } | null;
  population: { year: string; value: number } | null;
  sectors: Share[];
  industries: { year: string; items: Share[] } | null;
}

/**
 * One card per province under the map, largest economy first: growth,
 * industrial output, size, residents, the three sectors and the largest
 * industries, each card opening on the province's profile. A field the
 * store lacks is a dash, never a stand-in.
 */
function ProvinceCards() {
  const [cards, setCards] = useState<ProvinceCard[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    json("/api/provinces").then((body) => { if (!cancelled && Array.isArray(body)) setCards(body as ProvinceCard[]); }).catch(() => { if (!cancelled) setCards([]); });
    return () => { cancelled = true; };
  }, []);
  if (!cards || cards.length === 0) return null;
  const pct = (item: { value: number } | null) => item ? `${item.value.toFixed(1)}%` : "–";
  const millions = (item: { value: number } | null) => item ? `${(item.value / 100).toFixed(1)}m` : "–";
  const yuan = (item: { value: number } | null) => item ? Math.round(item.value).toLocaleString("en-US") : "–";
  const growthPeriod = cards.find((card) => card.gdpGrowth)?.gdpGrowth?.period;
  const grpYear = cards.find((card) => card.grp)?.grp?.year;
  return (
    <section className="province-cards" aria-label="Province profiles">
      <div className="section-head"><h2>Province profiles</h2><span>Largest economy first. Each card opens the province's full profile.</span></div>
      <div className="province-grid">
        {cards.map((card) => (
          <a key={card.code} className="province-card" href={routeHash({ view: "province", code: card.code })}>
            <h3>{card.en} <Zh className="gloss">{card.zh}</Zh></h3>
            <dl>
              <div><dt>Real GDP growth{card.gdpGrowth && card.gdpGrowth.period !== growthPeriod ? `, ${periodPretty(card.gdpGrowth.period)}` : ""}</dt><dd>{pct(card.gdpGrowth)}</dd></div>
              <div><dt>Industrial output growth</dt><dd>{pct(card.industrialGrowth)}</dd></div>
              <div><dt>GRP{card.grp && card.grp.year !== grpYear ? `, ${card.grp.year}` : ""}</dt><dd>{card.grp ? <>{yuan(card.grp)}<small> 100M yuan</small></> : "–"}</dd></div>
              <div><dt>Residents</dt><dd>{millions(card.population)}</dd></div>
            </dl>
            {card.sectors.length > 0 && (
              <div className="province-shares" aria-label="Sector shares of GRP">
                {card.sectors.map((item) => (
                  <div key={item.key}><span>{item.label.replace(/ industry$/i, "")}</span><i aria-hidden="true"><b style={{ width: `${Math.min(100, item.share)}%` }} /></i><em>{item.share.toFixed(1)}%</em></div>
                ))}
              </div>
            )}
            {card.industries && card.industries.items.length > 0 && (
              <p className="quiet province-industries">Largest industries, {card.industries.year}: {card.industries.items.map((item) => `${item.label} ${item.share.toFixed(1)}%`).join(", ")}</p>
            )}
          </a>
        ))}
      </div>
      <p className="quiet">Growth is year to date, {growthPeriod ? periodPretty(growthPeriod) : "latest"}; GRP and residents are the bureau's annual figures{grpYear ? ` for ${grpYear}` : ""}; sector shares are computed from that year's published levels.</p>
    </section>
  );
}

function RegionsPage(props: { route: Extract<Route, { view: "regions" }>; lang: string; navigate: (route: Route) => void; toast: (text: string) => void }) {
  const [data, setData] = useState<RegionalResponse | null>(null);
  // Provincial GDP is the page's own series; any other regional series in the
  // catalog can be mapped by naming it in the URL.
  const key = props.route.key || "provincial_gdp";
  const gdp = key === "provincial_gdp";
  // The period lives in the URL, so a view of Q1 2020 can be shared and bookmarked.
  const period = props.route.period;
  const setPeriod = (value: string) => props.navigate({ view: "regions", period: value, key: props.route.key });
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [selected, setSelected] = useState<string>("");
  const [picked, setPicked] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);
  // The line ranked, for a series with several (exports, imports, balance).
  const [label, setLabel] = useState("");
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    const query = [period ? `period=${encodeURIComponent(period)}` : "", label ? `label=${encodeURIComponent(label)}` : ""].filter(Boolean).join("&");
    json(`/api/regional/${encodeURIComponent(key)}${query ? `?${query}` : ""}`).then((body) => {
      if (cancelled) return;
      if (isRegionalResponse(body)) { setData(body); setStatus("ok"); } else setStatus("error");
    }).catch(() => { if (!cancelled) setStatus("error"); });
    return () => { cancelled = true; };
  }, [key, period, label, attempt]);
  // A link to a quarter the store lacks (a stale bookmark, a typo) falls back to the latest quarter and says so,
  // rather than drawing an empty map under that quarter's heading.
  useEffect(() => {
    if (status !== "ok" || !period || !data || data.values.some((item) => item.value !== null)) return;
    props.toast(`Nothing published for ${periodPretty(period)}; showing the latest period`);
    props.navigate({ view: "regions", period: "", key: props.route.key });
  }, [status, data, period]);

  const unit = data?.unit ?? "%";
  // Trade by partner and by commodity rank rather than map, and their copy names
  // the publisher; the "Total" row of the partner table is the whole month, shown apart.
  const trade = data?.geography === "Partner" || data?.geography === "Commodity";
  const what = data?.geography === "Partner" ? "partner" : data?.geography === "Commodity" ? "commodity" : data?.geography === "International" ? "country" : data?.geography === "City" ? "city" : "province";
  const allRows = (data?.values ?? []).map((item) => ({ ...item, province: PROVINCES.find((province) => province.code === item.region.value) })).filter((item) => item.value !== null);
  const total = trade ? allRows.find((item) => item.region.value === "total") : undefined;
  const rows = total ? allRows.filter((item) => item !== total) : allRows;
  // The tile map is a map of the provinces; a city series has no tiles, so it
  // gets the ranking alone rather than a map with most of the country missing.
  const mapped = rows.filter((item) => item.province);
  const hasMap = mapped.length >= rows.length / 2 && mapped.length > 4;
  const values = rows.map((item) => item.value ?? 0);
  const breaks = breaksFor(values);
  const max = Math.max(0, ...values);
  // Bars anchor at zero: a contraction extends left of the zero line, an expansion right.
  const low = Math.min(0, ...values);
  const span = max - low || 1;
  const zeroPct = ((0 - low) / span) * 100;
  const ranked = [...rows].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const shownPeriod = rows[0]?.period ?? period;
  const current = rows.find((item) => item.province?.code === selected);

  return (
    <main id="main" tabIndex={-1} className="page">
      <div className="breadcrumbs"><a href="#/">Home</a><span aria-hidden="true">›</span>{gdp ? <span>Provinces</span> : trade ? <><a href={seriesHash([key])}>{data?.title ?? "Series"}</a><span aria-hidden="true">›</span><span>By {what}</span></> : <><a href="#/regions">Provinces</a><span aria-hidden="true">›</span><span>{data?.title ?? "Series"}</span></>}</div>
      <div className="series-head">
        <div>
          <h1>{gdp ? "Real GDP Growth by Province" : `${data?.title ?? "Series"} by ${what.charAt(0).toUpperCase()}${what.slice(1)}`}</h1>
          <p className="lede">{gdp
            ? "Year-to-date real GDP, % change from the same period a year earlier: Q2 is first-half growth, Q4 is full-year growth. Source: provincial statistical bureaus, via NBS."
            : `${data?.label ? `${data.label}, ` : ""}${unitLabel(unit)}, ${(data?.frequency ?? "").toLowerCase()}. Source: ${data?.agency ?? "National Bureau of Statistics"}.${total && shownPeriod ? ` All partners, ${periodPretty(shownPeriod)}: ${fmt(total.value ?? 0, unit)} ${unitLabel(unit)}.` : ""}`}</p>
        </div>
        <div className="actions">
          {(data?.labels?.length ?? 0) > 1 && <label className="button" style={{ gap: 8 }}>Rank by<select aria-label="Line to rank by" value={data?.label ?? ""} onChange={(event) => setLabel(event.target.value)} style={{ border: 0, background: "transparent", color: "inherit", font: "inherit" }}>{(data?.labels ?? []).map((name) => <option key={name} value={name}>{name}</option>)}</select></label>}
          <label className="button" style={{ gap: 8 }}>Period<select value={period || shownPeriod || ""} onChange={(event) => setPeriod(event.target.value)} style={{ border: 0, background: "transparent", color: "inherit", font: "inherit" }}>{(data?.periods ?? []).map((item) => <option key={item} value={item}>{periodPretty(item)}</option>)}</select></label>
          {/* Any series published by province can be mapped, not only GDP. */}
          <AddSeries keys={[]} lang={props.lang} navigate={props.navigate} label="Map another series" geography={data?.geography === "City" ? "City" : "Province"}
            onPick={(entry) => props.navigate({ view: "regions", period: "", key: entry.key })} />
          {rows.length > 0 && <button className="button" onClick={() => downloadBlob(
            `econstats-china-${key}-${shownPeriod || "latest"}.csv`,
            new Blob([regionalCsv(
              { title: data?.label ? `${data.title}: ${data.label}` : (data?.title ?? key), unit: unitLabel(unit), period: shownPeriod ? periodPretty(shownPeriod) : "", agency: data?.agency ?? "National Bureau of Statistics" },
              [...(total ? [total] : []), ...ranked].map((item) => ({ en: regionLabel(item.region), zh: item.region.text, code: item.region.value, value: item.value })),
            )], { type: "text/csv;charset=utf-8" }),
          )}>Download CSV</button>}
        </div>
      </div>

      {status === "loading" && <div className="state" role="status"><span className="loader" aria-hidden="true" />Loading places…</div>}
      {status === "error" && <div className="state" role="alert"><b>Regional data unavailable</b><p>The series did not load. Try again in a moment.</p><div className="actions"><button className="button" onClick={() => setAttempt(attempt + 1)}>Try again</button></div></div>}
      {status === "ok" && data && rows.length === 0 && (
        <div className="state" role="status">
          <b>Nothing stored for this series yet</b>
          <p>The catalog lists it for {(data.values.length).toLocaleString("en-US")} places; the crawl fetches place by place and has not reached this table. Open the series itself to fetch one place now.</p>
          <div className="actions"><a className="button" href={seriesHash([key])}>Open series</a></div>
        </div>
      )}
      {status === "ok" && data && rows.length > 0 && (
        <div className={hasMap ? "regional-grid" : "regional-grid one-column"}>
          {hasMap && (
            <section className="card" aria-label="Map of provinces">
              <div className="card-head"><h2>Tile map</h2><span>{shownPeriod ? periodPretty(shownPeriod) : ""}, approximate geography</span></div>
              <div className="tile-map" role="group" aria-label="Provinces; select one to see its series">
                {mapped.map((item) => {
                  const province = item.province;
                  if (!province) return null;
                  const step = stepFor(item.value ?? 0, breaks);
                  return (
                    <button key={province.code} className={`ptile ${step >= 3 ? "dark" : "light"}`} style={{ gridColumn: province.col, gridRow: province.row, background: RAMP[step] }} aria-pressed={selected === province.code} aria-label={`${province.en}, ${fmt(item.value ?? 0, unit)}`} onClick={() => setSelected(selected === province.code ? "" : province.code)}>
                      <span>{province.abbr}</span><b>{fmt(item.value ?? 0, unit)}</b>
                    </button>
                  );
                })}
              </div>
              <div className="ramp" aria-hidden="true">
                <span>{unitLabel(unit)}</span>
                <div>
                  <div className="steps">{RAMP.map((color) => <i key={color} style={{ background: color }} />)}</div>
                  <div className="ticks">{breaks.map((edge) => <span key={edge} style={{ marginLeft: 0 }}>{edge.toFixed(1)}</span>)}</div>
                </div>
              </div>
            </section>
          )}
          <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
            {current && (
              <section className="card" style={{ padding: 16 }} aria-live="polite">
                <div className="section-head" style={{ marginBottom: 6 }}><h2 style={{ margin: 0 }}>{regionLabel(current.region)} <Zh className="gloss">{current.region.text}</Zh></h2></div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}><span className="latest-value" style={{ fontSize: 32 }}>{fmt(current.value ?? 0, unit)}</span><span className="unit" style={{ color: "var(--muted)", fontSize: 13 }}>{unitLabel(unit)}, {shownPeriod ? periodPretty(shownPeriod) : ""}{gdp ? ", year to date" : ""}</span></div>
                <Sparkline points={current.points} />
                <div className="actions" style={{ marginTop: 10 }}>
                  {current.province && <a className="button" href={routeHash({ view: "province", code: current.region.value })}>Province profile</a>}
                  <a className="button" href={seriesHash([key], { region: current.region.value })}>Open series</a>
                  {picked.includes(current.region.value)
                    ? <button className="button" onClick={() => setPicked(picked.filter((code) => code !== current.region.value))}>Remove from comparison</button>
                    : <button className="button" disabled={picked.length >= 4} onClick={() => setPicked([...picked, current.region.value])}>{picked.length >= 4 ? "Comparison is full" : "Add to comparison"}</button>}
                </div>
              </section>
            )}
            {picked.length > 0 && (
              <section className="card" style={{ padding: 16 }} aria-live="polite">
                <div className="section-head" style={{ marginBottom: 8 }}><h2 style={{ margin: 0 }}>Compare Places</h2><span>{picked.length} of 4</span></div>
                <div className="chip-row" style={{ margin: "0 0 10px" }}>{picked.map((code) => { const place = rows.find((item) => item.region.value === code)?.region; return <span className="chip" key={code}>{place ? regionLabel(place) : code}<button onClick={() => setPicked(picked.filter((item) => item !== code))} aria-label={`Remove ${place ? regionLabel(place) : code}`}>×</button></span>; })}</div>
                {picked.length < 2
                  ? <button className="button" type="button" disabled>Pick at least two</button>
                  : <a className="button" href={seriesHash(picked.map((code) => `${key}@${code}`), { range: "10y" })}>Chart {picked.length} places together</a>}
              </section>
            )}
            <section className="card">
              <div className="card-head"><h2>Ranking</h2><span>{shownPeriod ? periodPretty(shownPeriod) : ""}, {data.label ? `${data.label.toLowerCase()}, ` : ""}highest to lowest</span></div>
              <div className="ranked" role="group" aria-label="Places ranked highest to lowest; select one to see its series">
                {ranked.map((item) => {
                  const step = stepFor(item.value ?? 0, breaks);
                  const code = item.region.value;
                  return (
                    <button key={code} className={`r${selected === code ? " selected" : ""}`} aria-label={`${regionLabel(item.region)}, ${fmt(item.value ?? 0, unit)}`} style={{ border: 0, background: selected === code ? "var(--panel-2)" : "none", textAlign: "left", width: "100%", cursor: "pointer" }} onClick={() => setSelected(selected === code ? "" : code)} aria-pressed={selected === code}>
                      <span>{regionLabel(item.region)}</span>
                      <span className="bar">{zeroPct > 0 && zeroPct < 100 && <b style={{ left: `${zeroPct}%` }} />}<i style={{ left: `${Math.min(zeroPct, ((item.value ?? 0) - low) / span * 100)}%`, width: `${Math.abs((item.value ?? 0) / span) * 100}%`, background: RAMP[step] }} /></span>
                      <span className="val">{fmt(item.value ?? 0, unit)}</span>
                    </button>
                  );
                })}
              </div>
            </section>
            <section className="card" style={{ padding: 16 }}>
              <h2>{trade ? "Notes on Trade Data" : "Notes on Regional Data"}</h2>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {gdp && <li>NBS publishes provincial GDP growth as 本期累计, cumulative for the year. Provincial figures are compiled by provincial bureaus and have historically summed to more than the national total, so treat the ranking as indicative.</li>}
                {gdp && <li>Growth in small western provinces moves on a low base, so a high rate there is not comparable in weight to Guangdong or Jiangsu.</li>}
                {trade && <li>Customs' preliminary release, in US dollars, for the month; the following release can revise it. The balance is exports less imports as published.</li>}
                {trade && total && <li>The Total row is the whole month across every partner and is shown above the ranking rather than in it.</li>}
                {!gdp && !trade && <li>Provincial and city figures are compiled by local bureaus to the national definition. A level series is published on each year's own reporting scope, so a place's history is not always a like-for-like run.</li>}
                {!gdp && !trade && data.stored !== undefined && data.stored < data.values.length && <li>{data.stored} of {data.values.length} places are stored so far. The crawl fills the rest in over the following days.</li>}
                {!trade && <li>Hong Kong, Macao and Taiwan publish through their own statistical offices and are in their own dataset, not this one.</li>}
              </ul>
            </section>
          </div>
        </div>
      )}
      {status === "ok" && gdp && <ProvinceCards />}
    </main>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  const [stats, setStats] = useState<CatalogStats | null>(null);
  const [curated, setCurated] = useState<CuratedEntry[]>([]);
  const [releases, setReleases] = useState<Release[]>([]);
  const [releaseError, setReleaseError] = useState("");
  const [saved, setSaved] = useState<string[]>(() => readList("china-favorites"));
  const [recent, setRecent] = useState<string[]>(() => readList("china-recent"));
  const [draft, setDraft] = useState(route.view === "search" ? route.q : "");
  const [theme, setTheme] = useState(() => readPref("china-theme"));
  // Titles are English-first with the official Chinese alongside; a Chinese-first UI is a separate project.
  const lang = "en";
  const [toast, setToast] = useState("");
  const lastSeries = useRef<string[]>(route.view === "series" ? route.keys : []);

  const navigate = (next: Route) => {
    const hash = routeHash(next);
    if (window.location.hash !== hash) window.history.pushState(null, "", hash);
    setRoute(next);
  };

  useEffect(() => {
    json("/api/catalog/stats").then((body) => { if (isStats(body)) setStats(body); }).catch(() => setStats(null));
    json("/api/catalog").then((body) => { if (Array.isArray(body)) setCurated(body.filter(isCurated)); }).catch(() => setCurated([]));
    json("/api/releases").then((body) => {
      const data = obj(body, "data");
      if (!Array.isArray(data)) { setReleaseError("unavailable"); return; }
      setReleases(data.map((item) => ({ id: str(item, "_id"), date: str(item, "fb_time"), title: str(item, "content"), en: str(item, "en"), keys: listOf(item, "keys").filter((key): key is string => typeof key === "string"), categories: listOf(item, "categories").filter((name): name is string => typeof name === "string") })).filter((item) => item.id));
    }).catch(() => setReleaseError("unavailable"));
  }, []);

  useEffect(() => {
    const update = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", update);
    window.addEventListener("popstate", update);
    return () => { window.removeEventListener("hashchange", update); window.removeEventListener("popstate", update); };
  }, []);

  useEffect(() => {
    if (route.view === "series") {
      lastSeries.current = route.keys;
      const key = route.keys[0];
      if (key) { const next = [key, ...recent.filter((item) => item !== key)].slice(0, 20); setRecent(next); writeList("china-recent", next); }
    }
    // The topbar box shows the query being viewed: cleared off the search page, set to the query on it
    // (a hero search or a chip arrives here with the box otherwise empty).
    setDraft(route.view === "search" ? route.q : "");
    // The series page sets its own title once the series has loaded (a child effect would lose to this one).
    if (route.view !== "series") {
      const viewTitle = route.view === "home" ? "" : route.view === "search" ? (route.q ? `Search: ${route.q}` : "Search") : route.view === "browse" ? "Browse" : route.view === "releases" ? "NBS Release Calendar" : route.view === "theme" ? (THEME_PAGES.find((page) => page.name === route.name)?.label ?? route.name) : route.view === "province" ? "Province" : route.view === "health" ? "Data Health" : route.view === "methodology" ? "How These Figures Are Made" : route.view === "regions" ? "Real GDP Growth by Province" : route.view === "saved" ? "Saved Series" : "Recently Viewed";
      document.title = viewTitle ? `${viewTitle} - EconStats China Data` : "EconStats China Data";
    }
    const main = document.getElementById("main");
    if (main && route.view !== "home") main.focus({ preventScroll: true });
  }, [routeHash(route)]);

  useEffect(() => {
    if (theme) document.documentElement.setAttribute("data-theme", theme); else document.documentElement.removeAttribute("data-theme");
  }, [theme]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      const input = document.getElementById(route.view === "home" ? "home-series-search" : "global-series-search");
      if (input instanceof HTMLInputElement) { event.preventDefault(); input.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Typing searches after a pause; focus alone changes nothing.
  useEffect(() => {
    if (!draft.trim()) return;
    const timer = window.setTimeout(() => {
      const current = route.view === "search" ? route : { view: "search" as const, q: "", freq: "", cat: "", dataset: "", geo: "" };
      if (current.q !== draft.trim()) navigate({ ...current, q: draft.trim() });
    }, 220);
    return () => window.clearTimeout(timer);
  }, [draft]);

  const toggleSaved = (key: string) => setSaved((current) => { const next = current.includes(key) ? current.filter((item) => item !== key) : [key, ...current]; writeList("china-favorites", next); return next; });
  const cycleTheme = () => { const next = theme === "" ? "dark" : theme === "dark" ? "light" : ""; setTheme(next); writePref("china-theme", next); setToast(next === "" ? "Theme follows your system" : next === "dark" ? "Dark theme" : "Light theme"); };
  const current = (view: Route["view"]) => route.view === view ? "page" : undefined;

  return (
    <div className="app-shell">
      {/* Routes live in the hash, so a plain #main link would navigate to Home; move focus instead. */}
      <a className="skip-link" href="#main" onClick={(event) => { event.preventDefault(); const main = document.getElementById("main"); if (main) { main.focus(); main.scrollIntoView(); } }}>Skip to content</a>
      <header className={route.view === "home" ? "topbar topbar-home" : "topbar"}>
        <a className="brand" href="#/"><span><strong>EconStats</strong><small>China Data</small></span></a>
        <div className="global-search"><SearchIcon /><input id="global-series-search" aria-label="Search series" aria-keyshortcuts="/" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { setDraft(""); event.currentTarget.blur(); if (route.view === "search") navigate(lastSeries.current.length ? { view: "series", keys: lastSeries.current, show: "", range: "", region: "", from: "", to: "", freq: "", agg: "", lny: "" } : { view: "home" }); } if (event.key === "Enter" && draft.trim()) navigate({ view: "search", q: draft.trim(), freq: "", cat: "", dataset: "", geo: "" }); }} placeholder={`Search ${(stats?.seriesCount ?? 66302).toLocaleString("en-US")} series in English or Chinese`} /><kbd aria-hidden="true">/</kbd></div>
        <nav className="tab-nav" aria-label="Primary">
          <a href="#/" aria-current={current("home")}>Home</a>
          <a href="#/browse" aria-current={route.view === "browse" || (route.view === "search" && !route.q) ? "page" : undefined}>Browse</a>
          <a href="#/regions" aria-current={current("regions")}>Provinces</a>
          <a href="#/releases" aria-current={current("releases")}>Releases</a>
        </nav>
        <div className="topbar-tools">
          <button className="icon-button" onClick={cycleTheme} aria-label={`Switch theme, now ${theme === "" ? "following your system" : theme === "dark" ? "dark" : "light"}`}><ThemeIcon /></button>
        </div>
      </header>
      <PageStrip route={route} />
      <div className={route.view === "home" ? "body-grid no-sidebar" : "body-grid"}>
        {route.view !== "home" && <Sidebar stats={stats} curated={curated} route={route} saved={saved} recent={recent} />}
        {route.view === "home" && <Home stats={stats} curated={curated} releases={releases} releaseError={releaseError} onSearch={(q) => navigate({ view: "search", q, freq: "", cat: "", dataset: "", geo: "" })} />}
        {route.view === "series" && <SeriesPage route={route} curated={curated} saved={saved} releases={releases} lang={lang} onToggleSaved={toggleSaved} navigate={navigate} toast={setToast} />}
        {route.view === "search" && <SearchPage route={route} stats={stats} chartKeys={lastSeries.current} lang={lang} navigate={navigate} />}
        {route.view === "browse" && <BrowsePage stats={stats} />}
        {route.view === "releases" && <ReleasesPage route={route} curated={curated} navigate={navigate} />}
        {route.view === "methodology" && <MethodologyPage route={route} curated={curated} />}
        {route.view === "health" && <HealthPage />}
        {route.view === "province" && <ProvincePage route={route} />}
        {route.view === "theme" && <ThemePage route={route} />}
        {route.view === "regions" && <RegionsPage route={route} lang={lang} navigate={navigate} toast={setToast} />}
        {route.view === "saved" && <KeyListPage title="Saved Series" keys={saved} empty="No saved series" />}
        {route.view === "recent" && <KeyListPage title="Recently Viewed" keys={recent} empty="No recently viewed series" />}
      </div>
      <footer>Official statistics from NBS, {publisherList(curated.filter((entry) => entry.source !== "fred" && !entry.agency.includes("National Bureau of Statistics")))}, and international agencies via FRED. Independent project, not affiliated with any statistical agency.</footer>
      {/* The status region is always present so assistive tech announces the text when it changes; a live region inserted with its text already in it is often missed. */}
      <div role="status" aria-live="polite">{toast && <div className="toast">{toast}</div>}</div>
    </div>
  );
}

const rootElement = document.getElementById("root");
if (rootElement) createRoot(rootElement).render(<App />);
