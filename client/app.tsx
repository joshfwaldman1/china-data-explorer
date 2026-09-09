import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import "./styles.css";
import { FREQUENCY_RANK, coarsestFrequency, convertTrack, deltaText, fmt, fmtDate, fmtTick, canonicalPeriod, isAggregation, isRate, isTargetFrequency, observationLabel, periodPretty, periodTime, rebase, type Aggregation, type SeriesPoint, type TargetFrequency, type Track, isUpcoming } from "./lib";
import { ActionMenu, ChartPanelHeader, PageHeader } from "./primitives";
import { niceTicks, visibleTracks, type ShareInput } from "./export";
import { canCopyImage, copyImage, downloadBlob, renderShareImage, shareFileName, warmShareFonts } from "./share";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CuratedEntry { key: string; title: string; group: string; agency: string; frequency: string; unit: string; ended?: string; endedNote?: string; home?: boolean; }
interface NbsCatalogEntry {
  key: string; id: string; name: string; nameEn?: string; shortName: string; unit: string; note: string;
  annotation: string; datasetCode: number; dataset: string; frequency: string; geography: string; categories: string[];
  noteEn?: string; annotationEn?: string; datasetEn?: string; categoriesEn?: string[];
  family?: { head: string; members: string[]; span: string };
  firstPeriod?: string; lastPeriod?: string;
  nameEnSource?: "nbs-official" | "generated" | "unavailable"; nameEnSourceUrl?: string; nameEnCapturedAt?: string;
  legacyDatabase?: string; legacyIndicatorCode?: string;
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
/** A region's name for the UI: the English name where we have one, else what NBS sent. */
function regionLabel(region: Region): string {
  if (region.en) return region.en;
  if (region.value === "000000000000" || region.text === "全国") return "China, national";
  return PROVINCES.find((province) => province.code === region.value)?.en ?? region.text;
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
interface SearchResponse { total: number; offset: number; limit: number; results: NbsCatalogEntry[]; }
interface DatasetStat { code: number; name: string; frequency: string; geography: string; count: number; }
interface CatalogStats { generatedAt: string; seriesCount: number; storedCount?: number; categoryCount: number; categories: { name: string; count: number }[]; datasets: DatasetStat[]; }
interface Release { id: string; date: string; title: string; en: string; keys: string[]; }
interface Vintage { value: number | null; fetchedAt: string; }
interface Revised { label: string; period: string; vintages: Vintage[]; }

type Route =
  | { view: "home" }
  | { view: "series"; keys: string[]; show: string; range: string; region: string; from: string; to: string; freq: string; agg: string; lny: string }
  | { view: "search"; q: string; freq: string; cat: string; dataset: string }
  | { view: "browse"; cat: string }
  | { view: "releases"; month: string }
  | { view: "regions" }
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
};
/** English for the units NBS writes. */
const UNIT_EN: Record<string, string> = {
  "亿元": "100 million yuan", "万元": "10,000 yuan", "亿美元": "100 million US dollars", "万美元": "10,000 US dollars",
  "万吨": "10,000 tonnes", "吨": "tonnes", "万吨标准煤": "10,000 t of standard coal", "亿千瓦时": "100 million kWh", "万千瓦时": "10,000 kWh",
  "万人": "10,000 persons", "人": "persons", "万辆": "10,000 vehicles", "辆": "vehicles", "万平方米": "10,000 m²", "万台": "10,000 units",
  "亿件": "100 million pieces", "万件": "10,000 pieces", "万户": "10,000 households", "个": "count", "%": "%", "无": "no unit",
  "上年同期=100": "index, prior-year period = 100", "上年同月=100": "index, prior-year month = 100", "上月=100": "index, prior month = 100",
  "上年=100": "index, prior year = 100", "元": "yuan", "亿": "100 million", "万": "10,000", "百分点": "percentage points", "天": "days", "小时": "hours",
};
/** Two sentences each, written for a reader rather than a catalog. */
const ABOUT: Record<string, string> = {
  gdp: "Real GDP growth, year over year, from the NBS quarterly national accounts. Constant-price series are chain-linked by base period, and quarterly values are not seasonally adjusted.",
  provincial_gdp: "Guangdong's real GDP growth as reported by the provincial bureau. NBS publishes it as a cumulative year-to-date index against the same period a year earlier, so the Q2 figure is first-half growth.",
  industrial_production: "Value added of industrial enterprises above designated size (annual revenue over 20 million yuan), year over year. January and February are published together to avoid Lunar New Year distortion.",
  cpi: "Consumer price index, year over year, from the NBS monthly price survey. Food carries a large weight, so pork and vegetable prices move the headline more than in most economies.",
  ppi: "Producer price index for industrial products at the factory gate, year over year. It tracks commodity prices closely and turns negative in deflationary stretches.",
  unemployment: "Surveyed urban unemployment from the monthly labour force survey, with age breakdowns. The 16–24 series was suspended after June 2023 and resumed in December 2023 excluding students; the two segments are not comparable.",
  retail_sales: "Retail sales of consumer goods, nominal, year over year. Includes goods sold to households and to institutions; catering is included, most services are not.",
  money_supply: "M1 (cash plus demand deposits) and M2 (M1 plus savings and time deposits), year over year, from the People's Bank of China. M1 was redefined in January 2025 to include personal demand deposits.",
  new_loans: "New yuan-denominated loans extended by financial institutions in the month, from the PBOC. Strongly seasonal: January is always the largest month.",
  trade: "Merchandise exports and imports in US dollar terms, year over year, from the General Administration of Customs. Lunar New Year timing shifts January and February.",
  forex_reserves: "Official foreign exchange reserves held by the PBOC, in US dollars. Valuation effects from currency and bond prices move the total even with no intervention.",
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
  electricity_output: "Electricity output of industrial enterprises above designated size, year over year, from the NBS monthly energy production release. Watched as a proxy for industrial activity because generation is hard to smooth.",
  lpr: "The loan prime rate, the benchmark for new bank lending, set monthly by the PBOC from quotes by 18 banks. The 1-year rate anchors corporate loans; the 5-year rate anchors mortgages.",
};
const READING: Record<string, string[]> = {
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
    note: "NBS suspended the 16–24 unemployment rate after June 2023 and resumed it in December 2023 on a new basis that excludes students. Readings before and after the shaded gap are not comparable, and a change across it should not be read as a change in labour-market conditions.",
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
  const english = entry.categories.map((category, index) => strip(entry.categoriesEn?.[index] || categoryEn(category) || category));
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
  if (head === "search") return { view: "search", q: query.get("q") ?? "", freq: query.get("freq") ?? "", cat: query.get("cat") ?? "", dataset: query.get("dataset") ?? "" };
  if (head === "browse") return { view: "browse", cat: "" };
  if (head === "category" && parts[1]) return { view: "search", q: "", freq: "", cat: decodeURIComponent(parts[1]), dataset: "" };
  if (head === "releases") return { view: "releases", month: query.get("month") ?? "" };
  if (head === "regions") return { view: "regions" };
  if (head === "saved") return { view: "saved" };
  if (head === "recent") return { view: "recent" };
  return { view: "home" };
}
function routeHash(route: Route): string {
  const qs = (pairs: [string, string][]) => { const query = new URLSearchParams(pairs.filter(([, value]) => value)); const text = query.toString(); return text ? `?${text}` : ""; };
  switch (route.view) {
    case "home": return "#/";
    case "series": return `#/series/${route.keys.join(",")}${qs([["show", route.show], ["range", route.range], ["region", route.region], ["from", route.from], ["to", route.to], ["freq", route.freq], ["agg", route.agg], ["lny", route.lny]])}`;
    case "search": return `#/search${qs([["q", route.q], ["freq", route.freq], ["cat", route.cat], ["dataset", route.dataset]])}`;
    case "browse": return "#/browse";
    case "releases": return `#/releases${qs([["month", route.month]])}`;
    case "regions": return "#/regions";
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
  const tick = (value: number) => {
    const date = new Date(value);
    return spanYears > 6 ? String(date.getUTCFullYear()) : date.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
  };
  const ticks = spanYears > 6
    ? Array.from({ length: new Date(max).getUTCFullYear() - new Date(min).getUTCFullYear() + 1 }, (_, index) => Date.UTC(new Date(min).getUTCFullYear() + index, 0, 1)).filter((value) => value >= min && value <= max)
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
  const description = `${props.title}. ${shown.length} series, ${props.unit}. Use the Table tab for the values.`;
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

function csvOf(results: SeriesResult[], tracks: Track[], notes: string[]): string {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const head = [
    `# Series: ${results.map((result) => result.title).join(" | ")}`,
    `# Unit: ${[...new Set(results.map((result) => result.unit))].join(" | ")}`,
    `# Source: ${[...new Set(results.map((result) => result.agency))].join(", ")}`,
    ...notes.map((note) => `# Note: ${note}`),
    `# Retrieved: ${new Date().toISOString().slice(0, 10)} via EconStats China Data`,
  ];
  const frequency = new Set(tracks.map((track) => track.frequency)).size === 1 ? (tracks[0]?.frequency ?? "Monthly") : "Mixed";
  const keyed = tracks.map((track) => new Map(track.points.map((point) => [canonicalPeriod(point.p, frequency), point.v])));
  const periods = [...new Set(keyed.flatMap((points) => [...points.keys()]))].sort((a, b) => periodTime(a) - periodTime(b));
  const lines = [["period", ...tracks.map((track) => track.name)].map(quote).join(",")];
  for (const period of periods) {
    lines.push([period, ...keyed.map((points) => { const value = points.get(period); return value === undefined ? "" : String(value); })].map(quote).join(","));
  }
  return [...head, ...lines].join("\n");
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function Sidebar(props: { stats: CatalogStats | null; curated: CuratedEntry[]; route: Route; saved: string[]; recent: string[] }) {
  const [mobileOpen, setMobileOpen] = useState(false);
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
            <a key={dataset.code} className="nav-row" href={routeHash({ view: "search", q: "", freq: "", cat: "", dataset: String(dataset.code) })} aria-current={activeDataset === String(dataset.code) ? "page" : undefined} aria-label={`${dataset.geography} ${dataset.frequency.toLowerCase()} dataset, ${dataset.count.toLocaleString("en-US")} series`}>
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
        </div>
      </details>
      </div>
    </aside>
  );
}

// ── Home ──────────────────────────────────────────────────────────────────────

const HERO_KEYS = ["gdp", "cpi", "unemployment", "pmi"];
const GROUP_ORDER = ["Growth & Output", "Prices", "Labor", "Consumption", "Money & Credit", "Interest Rates", "Exchange Rates", "Trade & External", "Property", "Sentiment", "Markets", "Public Finance", "Demographics", "Regional"];
const groupRank = (group: string) => { const index = GROUP_ORDER.indexOf(group); return index < 0 ? GROUP_ORDER.length : index; };
function unitSuffix(unit: string): string { return isRate(unit) && unit !== "%" && !/index/i.test(unit) ? "%" : ""; }
function shortAgency(agency: string): string { return agency === "National Bureau of Statistics" ? "NBS" : agency === "People's Bank of China" ? "PBOC" : agency; }
function Sparkline(props: { points: SeriesPoint[]; alarm?: boolean }) {
  const values = props.points.map((point) => point.value);
  if (values.length < 2) return <svg viewBox="0 0 160 28" aria-hidden="true" />;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const path = values.map((value, index) => `${(index / (values.length - 1)) * 160},${26 - ((value - min) / span) * 24}`).join(" ");
  return <svg viewBox="0 0 160 28" preserveAspectRatio="none" aria-hidden="true"><polyline points={path} fill="none" stroke={props.alarm ? "var(--red)" : "var(--chart-1)"} strokeWidth="1.8" strokeLinejoin="round" /><circle cx="160" cy={26 - ((values[values.length - 1] ?? 0) - min) / span * 24} r="2.5" fill={props.alarm ? "var(--red)" : "var(--chart-1)"} /></svg>;
}

function Home(props: { stats: CatalogStats | null; curated: CuratedEntry[]; releases: Release[]; releaseError: string; onSearch: (q: string) => void }) {
  const [headline, setHeadline] = useState<Map<string, SeriesResult>>(new Map());
  const [draft, setDraft] = useState("");
  const headlineEntries = props.curated.filter((entry) => entry.home !== false);
  const byAgency = (agency: string) => headlineEntries.filter((entry) => entry.agency.includes(agency)).length;
  useEffect(() => {
    let cancelled = false;
    // Each indicator lands as it arrives; one slow source must not hold the whole page blank.
    for (const entry of props.curated.filter((entry) => entry.home !== false)) {
      json(`/api/series/${entry.key}?limit=24`).then((body) => {
        if (cancelled || !isSeriesResult(body)) return;
        setHeadline((current) => new Map(current).set(entry.key, body));
      }).catch(() => undefined);
    }
    return () => { cancelled = true; };
  }, [props.curated.map((entry) => entry.key).join(",")]);
  const upcoming = props.releases.filter((release) => isUpcoming(release.date)).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
  const monthly = props.stats?.datasets.find((dataset) => dataset.frequency === "Monthly")?.count ?? 0;
  const quarterly = props.stats?.datasets.find((dataset) => dataset.frequency === "Quarterly")?.count ?? 0;
  return (
    <main id="main" tabIndex={-1} className="page home">
      <section className="hero">
        <h1>China Economic Data</h1>
        <p className="lede">{(props.stats?.seriesCount ?? 0).toLocaleString("en-US")} series from the National Bureau of Statistics, searchable in English and Chinese, plus {props.curated.filter((entry) => entry.home !== false && !entry.agency.includes("National Bureau of Statistics")).length} indicators from the People's Bank of China, Customs and Caixin, and {props.curated.filter((entry) => entry.home === false).length} international series on China via FRED.</p>
        <form className="hero-search" onSubmit={(event) => { event.preventDefault(); if (draft.trim()) props.onSearch(draft.trim()); }}>
          <div className="global-search"><SearchIcon /><input id="home-series-search" aria-label="Search series" aria-keyshortcuts="/" autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} placeholder='Try "youth unemployment", "steel output", or 居民消费价格' /></div>
        </form>
        <div className="chips">Common searches:{["youth unemployment", "CPI", "PMI", "exports", "house prices", "LPR"].map((term) => <a key={term} href={routeHash({ view: "search", q: term, freq: "", cat: "", dataset: "" })}>{term}</a>)}</div>
      </section>

      <section className="section" aria-labelledby="h-headline">
        <div className="section-head"><h2 id="h-headline">Headline Indicators</h2><span>Latest value, % change from a year ago unless noted</span></div>
        <div className="hero-tiles">
          {HERO_KEYS.map((key) => props.curated.find((entry) => entry.key === key)).filter((entry): entry is CuratedEntry => entry !== undefined).map((entry) => {
            const result = headline.get(entry.key);
            const first = result?.series[0];
            const latest = first?.points[first.points.length - 1];
            const previous = first?.points[first.points.length - 2];
            return (
              <a key={entry.key} className="tile" href={seriesHash([entry.key])}>
                <span className="label">{entry.title}</span>
                <span className="tile-value">{latest ? fmt(latest.value, entry.unit) : "—"}<span className="tile-unit">{unitSuffix(entry.unit)}</span></span>
                {first && <Sparkline points={first.points} />}
                <small>{first && first.label !== entry.title ? `${first.label}, ` : ""}{entry.ended ? `Ended ${periodPretty(entry.ended)}` : latest ? observationLabel(latest.date, entry.frequency) : entry.frequency}{!entry.ended && latest && previous ? `, ${deltaText(latest, previous, entry.unit, "short")}` : ""}</small>
              </a>
            );
          })}
        </div>
        <div className="indicator-list">
          {[...new Set(props.curated.filter((entry) => !HERO_KEYS.includes(entry.key) && entry.home !== false).map((entry) => entry.group))].sort((a, b) => groupRank(a) - groupRank(b)).map((group) => (
            <section key={group} aria-label={group}>
              <h3>{group}</h3>
              {props.curated.filter((entry) => entry.group === group && !HERO_KEYS.includes(entry.key) && entry.home !== false).map((entry) => {
                const result = headline.get(entry.key);
                const first = result?.series[0];
                const latest = first?.points[first.points.length - 1];
                const previous = first?.points[first.points.length - 2];
                return (
                  <a key={entry.key} className="indicator-row" href={seriesHash([entry.key])}>
                    <span className="name">{entry.title}<small>{first && first.label !== entry.title ? `${first.label}, ` : ""}{shortAgency(entry.agency)}</small></span>
                    <span className="value">{latest ? fmt(latest.value, entry.unit) : "—"}<i>{unitSuffix(entry.unit)}</i></span>
                    <span className="change">{deltaText(latest, previous, entry.unit, "short")}</span>
                    <span className={`period${entry.ended || (latest && isBehind(latest.date, entry.frequency)) ? " behind" : ""}`}>{entry.ended ? `Ended ${periodPretty(entry.ended)}` : latest ? observationLabel(latest.date, entry.frequency) : entry.frequency}</span>
                    <span className="spark">{first && <Sparkline points={first.points} />}</span>
                  </a>
                );
              })}
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
                    {release.keys.length > 0 && <div className="links">{release.keys.map((key) => { const entry = props.curated.find((item) => item.key === key); return entry ? <a key={key} href={seriesHash([key])}>{entry.title}</a> : null; })}</div>}
                  </div>
                </div>
              );
            })}</div>}
        </div>
        <div className="card">
          <div className="card-head"><h2>Coverage</h2><span>English titles are machine translations; the Chinese is official</span></div>
          <div className="coverage">
            <div><h3>Included</h3><ul><li>{monthly.toLocaleString("en-US")} national monthly NBS series</li><li>{quarterly.toLocaleString("en-US")} national quarterly NBS series</li>{props.stats?.storedCount !== undefined && <li>{props.stats.storedCount.toLocaleString("en-US")} of them stored locally; the rest came back empty from NBS and are retried monthly, or are fetched on first view</li>}<li>{headlineEntries.length} headline indicators with notes and revision history: {byAgency("National Bureau of Statistics")} of the NBS series above, plus {byAgency("People's Bank of China")} from the People's Bank of China, {byAgency("Customs")} from Customs and {byAgency("Caixin")} from Caixin</li><li>Quarterly GDP for all 31 provinces, back to 2005</li><li>New and existing home prices for the 70 surveyed cities</li><li>{props.curated.filter((entry) => entry.home === false).length} international series via FRED: BIS, OECD, IMF, World Bank, US Census</li></ul></div>
            <div><h3>Not included</h3><ul><li>Provincial series beyond GDP, and city series beyond home prices</li><li>Annual series</li><li>Hong Kong, Macao and Taiwan</li></ul></div>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="h-cats">
        <div className="section-head"><h2 id="h-cats">NBS Categories</h2><span>Top-level groups, by number of series</span></div>
        <div className="cats">
          {props.stats?.categories.slice(0, 12).map((category) => (
            <a key={category.name} className="cat" href={`#/category/${encodeURIComponent(category.name)}`}>
              <b><Zh>{category.name}</Zh></b>
              {categoryEn(category.name) && <span className="gloss">{categoryEn(category.name)}</span>}
              <small>{category.count.toLocaleString("en-US")} series</small>
            </a>
          ))}
        </div>
      </section>
    </main>
  );
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
    return query;
  };
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    const timer = window.setTimeout(() => {
      json(`/api/search?${params(0)}`).then((body) => { if (cancelled) return; if (isSearchResponse(body)) { setResponse(body); setStatus("ok"); } else setStatus("error"); }).catch(() => { if (!cancelled) setStatus("error"); });
    }, 160);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [props.route.q, props.route.freq, props.route.cat, props.route.dataset]);
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
  return (
    <main id="main" tabIndex={-1} className="page">
      <div className="breadcrumbs"><a href="#/">Home</a><span aria-hidden="true">›</span>{props.route.cat ? <><a href="#/browse">Categories</a><span aria-hidden="true">›</span><span><Zh>{props.route.cat}</Zh></span></> : <span>Search</span>}</div>
      <h1>{props.route.cat && catEn ? <>{catEn}<Zh className="gloss">{props.route.cat}</Zh></> : CJK.test(title) ? <Zh>{title}</Zh> : title}</h1>
      <div className="facets">
        <select aria-label="Frequency" value={props.route.freq} onChange={(event) => set({ freq: event.target.value })}><option value="">All frequencies</option>{freqs.map((freq) => <option key={freq} value={freq}>{freq} ({(props.stats?.datasets.filter((dataset) => dataset.frequency === freq).reduce((sum, dataset) => sum + dataset.count, 0) ?? 0).toLocaleString("en-US")})</option>)}</select>
        {geos.length > 1 && <select aria-label="Region" value="" onChange={() => undefined}>{geos.map((geo) => <option key={geo}>{geo}</option>)}</select>}
        {props.stats && props.stats.datasets.length > 1 && <select aria-label="Dataset" value={props.route.dataset} onChange={(event) => set({ dataset: event.target.value })}><option value="">All datasets</option>{props.stats.datasets.map((dataset) => <option key={dataset.code} value={String(dataset.code)}>{dataset.geography} {dataset.frequency.toLowerCase()} ({dataset.count.toLocaleString("en-US")})</option>)}</select>}
        {(props.route.freq || props.route.cat || props.route.dataset) && <button className="button" onClick={() => props.navigate({ view: "search", q: props.route.q, freq: "", cat: "", dataset: "" })}>Clear filters</button>}
      </div>
      <p className="result-count" role="status" aria-live="polite">{status === "loading" ? "Searching…" : status === "error" ? "" : response ? `Showing ${response.results.length.toLocaleString("en-US")} of ${response.total.toLocaleString("en-US")} series` : ""}</p>
      {status === "error" && <div className="state"><b>Search unavailable</b><p>The catalog did not respond. Try again in a moment.</p><div className="actions"><button className="button" onClick={() => set({})}>Try again</button></div></div>}
      {status === "ok" && response && response.results.length === 0 && (
        <div className="state">
          <b>No series match {props.route.q ? `“${props.route.q}”` : "these filters"}</b>
          <p>This catalog holds national monthly and quarterly NBS series ({(props.stats?.seriesCount ?? 0).toLocaleString("en-US")}). It does not yet include 70-city house prices, annual, provincial or city data.</p>
          <p>Try a Chinese term such as <a href={routeHash({ view: "search", q: "失业率", freq: "", cat: "", dataset: "" })}>失业率</a> or <a href={routeHash({ view: "search", q: "居民消费价格", freq: "", cat: "", dataset: "" })}>居民消费价格</a>, or <a href="#/browse">browse the categories</a>. English matches common terms (GDP, CPI, PPI, exports, steel) and the headline indicators.</p>
        </div>
      )}
      {status !== "error" && response && response.results.length > 0 && (
        <div className="result-list">
          {response.results.map((entry) => {
            const curated = entry.datasetCode === 0;
            const zhFirst = props.lang === "zh" || !entry.nameEn;
            return (
              <article className="result" key={entry.key}>
                <a className="main" href={seriesHash([entry.key])}>
                  <span className="title">{zhFirst ? <Zh>{entry.name}</Zh> : entry.nameEn}</span>
                  {entry.nameEn && !curated && <span className="gloss">{zhFirst ? entry.nameEn : <Zh>{entry.name}</Zh>} <span className="tag">{entry.nameEnSource === "nbs-official" ? "NBS English" : "auto-translated"}</span></span>}
                  {!curated && <span className="path">{categoryPath(entry)}</span>}
                  <span className="meta">{entry.frequency}, {curated ? entry.dataset : "NBS"}, {unitLabel(entry.unit)}{entry.firstPeriod && entry.lastPeriod ? <>, {observationLabel(entry.firstPeriod, entry.frequency)} to {observationLabel(entry.lastPeriod, entry.frequency)}{isEndedPeriod(entry.lastPeriod) && <span className="ended"> ended</span>}</> : null}</span>
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
  return (
    <main id="main" tabIndex={-1} className="page">
      <div className="breadcrumbs"><a href="#/">Home</a><span aria-hidden="true">›</span><span>Categories</span></div>
      <h1>NBS Categories</h1>
      <p className="lede">The {props.stats?.categoryCount ?? 0} NBS categories, grouped by top-level heading. Chinese names are official; English names are glosses.</p>
      <div className="cats" style={{ marginTop: 20 }}>
        {props.stats?.categories.map((category) => (
          <a key={category.name} className="cat" href={`#/category/${encodeURIComponent(category.name)}`}>
            <b><Zh>{category.name}</Zh></b>
            {categoryEn(category.name) && <span className="gloss">{categoryEn(category.name)}</span>}
            <small>{category.count.toLocaleString("en-US")} series</small>
          </a>
        ))}
      </div>
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
      {props.keys.length === 0 ? <div className="state"><b>{props.empty}</b><p>Saved series and recently viewed series live in this browser only.</p></div> : (
        <div className="result-list" style={{ marginTop: 20 }}>
          {props.keys.map((key) => { const entry = entries.get(key); return <article className="result" key={key}><a className="main" href={seriesHash([key])}><span className="title">{entry ? <Zh>{entry.title}</Zh> : key}</span>{entry && <span className="meta"><Zh>{entry.sub}</Zh></span>}</a></article>; })}
        </div>
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
      setItems(data.map((item) => ({ id: str(item, "_id"), date: str(item, "fb_time"), title: str(item, "content"), en: str(item, "en"), keys: listOf(item, "keys").filter((key): key is string => typeof key === "string") })).filter((item) => item.id && item.title));
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
      <div className="month-nav"><button className="button" onClick={() => shift(-1)} aria-label="Previous month">‹</button><b>{new Date(year ?? now.getFullYear(), (monthIndex ?? 1) - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })}</b><button className="button" onClick={() => shift(1)} aria-label="Next month">›</button></div>
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
                <div className="release-date"><b>{day.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</b><span>{day.toLocaleDateString("en-US", { weekday: "short" })}</span></div>
                <div>{releases.map((release) => (
                  <article className="release" key={release.id}>
                    <time dateTime={release.date}>{release.date.slice(11, 16)}</time>
                    <div>
                      <div className="en">{release.en || <Zh>{release.title.replace(/\s*[（(]\d{1,2}:\d{2}[)）]\s*$/, "")}</Zh>}</div>
                      {release.en && <div className="zh"><Zh>{release.title.replace(/\s*[（(]\d{1,2}:\d{2}[)）]\s*$/, "")}</Zh></div>}
                      {release.keys.length > 0 && <div className="links">{release.keys.map((key) => { const entry = props.curated.find((item) => item.key === key); return entry ? <a key={key} href={seriesHash([key])}>{entry.title}</a> : null; })}</div>}
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

function AddSeries(props: { keys: string[]; lang: string; navigate: (route: Route) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [results, setResults] = useState<NbsCatalogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => {
    if (!draft.trim()) { setResults([]); return; }
    let cancelled = false;
    setBusy(true);
    const timer = window.setTimeout(() => {
      json(`/api/search?q=${encodeURIComponent(draft.trim())}&limit=8`).then((body) => {
        if (cancelled) return;
        if (isSearchResponse(body)) setResults(body.results.filter((entry) => !props.keys.includes(entry.key)));
      }).catch(() => { if (!cancelled) setResults([]); }).finally(() => { if (!cancelled) setBusy(false); });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [draft, props.keys.join(",")]);
  if (props.keys.length >= 4) return <p className="add-series-note">Four series is the most one chart can carry legibly. Remove one to add another.</p>;
  if (!open) return <button className="button" onClick={() => setOpen(true)} aria-expanded={false}>Add series</button>;
  return (
    <>
    <button className="button" aria-expanded={true} onClick={() => { setOpen(false); setDraft(""); }}>Add series</button>
    <div className="add-series" role="search">
      <div className="global-search"><SearchIcon /><input ref={inputRef} aria-label="Search for a series to add" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { setOpen(false); setDraft(""); } }} placeholder="Search in English or Chinese: GDP, 工业增加值, steel output" /></div>
      <div className="add-series-results" role="listbox" aria-label="Matching series" aria-busy={busy}>
        {draft.trim() && !busy && results.length === 0 && <p className="add-series-note">No series match “{draft.trim()}”. The catalog holds national monthly and quarterly NBS series.</p>}
        {results.map((entry) => {
          const zhFirst = props.lang === "zh" || !entry.nameEn || entry.datasetCode === 0;
          return (
            <button key={entry.key} role="option" aria-selected={false} className="add-series-row" onClick={() => { setOpen(false); setDraft(""); props.navigate({ view: "series", keys: [...props.keys, entry.key], show: "", range: "", region: "", from: "", to: "", freq: "", agg: "", lny: "" }); }}>
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

  if (status === "loading") return <main id="main" tabIndex={-1} className="page"><div className="state" role="status"><span className="loader" aria-hidden="true" />{firstView ? <p>Fetching from NBS for the first time. This takes a couple of seconds. Future views load instantly from the stored copy.</p> : <p>Loading…</p>}</div><div className="skeleton" aria-hidden="true" /></main>;
  if (status === "error" || !primary) return <main id="main" tabIndex={-1} className="page"><div className="state" role="alert"><b>Series unavailable</b><p>{/Unknown/.test(error) ? "There is no series with this ID. Check the link, or search for the series by name." : /AKTools/.test(error) ? error : /esData|NBS|HTTP 5\d\d|Unable to connect|timed out/i.test(error) ? "NBS didn't respond, and this series has no stored copy yet, so there's nothing to show." : error || "No observations came back."}</p><div className="actions"><button className="button" onClick={() => set({})}>Try again</button><a className="button" href="#/">Home</a></div></div></main>;

  const firstSeries = built.tracks[0];
  const headline = primary.series[0];
  const latest = headline?.points[headline.points.length - 1];
  const previous = headline?.points[headline.points.length - 2];
  const saved = props.saved.includes(primary.key);
  const meta = primary.metadata;
  const curated = props.curated.find((entry) => entry.key === primary.key);
  const definition = meta?.noteEn || meta?.note || ABOUT[primary.key] || "";
  const definitionZh = meta?.noteEn && meta.note ? meta.note : "";
  const readingNotes = [
    ...(READING[primary.key] ?? (meta?.annotation ? [meta.annotationEn || meta.annotation] : built.notes)),
    ...(curated?.endedNote ? [curated.endedNote] : []),
    ...(meta?.family ? [`NBS publishes this table in ${meta.family.members.length} year-range pieces; they are joined here into one series covering ${meta.family.span}. Where two pieces overlap, the newer one is used.`] : []),
  ];
  const readingNotesZh = meta?.annotationEn && meta.annotation ? meta.annotation : "";
  const nextRelease = props.releases.filter((release) => release.keys.includes(primary.key) && isUpcoming(release.date)).sort((a, b) => a.date.localeCompare(b.date))[0];
  const stale = primary.source === "stale";
  const zhFirst = props.lang === "zh" || !meta?.nameEn;
  const via = primary.sourceUrl.includes("eastmoney") ? "Eastmoney datacenter, which mirrors the official release" : primary.sourceUrl.includes("akshare") ? "AkShare, an open-source data library" : primary.sourceUrl.includes("fred.stlouisfed") ? "FRED, the Federal Reserve Bank of St. Louis database" : "the NBS data portal";
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
      onSelect: () => downloadBlob(shareFileName(props.route.keys, "csv"), new Blob([csvOf(results, tracks, built.notes)], { type: "text/csv;charset=utf-8" })),
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
  const shareInput = (): ShareInput => ({
    // A compare of one series across provinces keeps the measure in the title: "Provincial Real GDP Growth: Guangdong, Shanghai".
    title: results.length > 1 && results.every((result) => result.key === primary.key && result.region)
      ? `${primary.title}: ${results.map((result) => displayTitle(result, results)).join(", ")}`
      : results.map((result) => (props.lang !== "zh" && result.metadata?.nameEn) || displayTitle(result, results)).join(", "),
    unit: unitLabel(unit),
    frequencies: [...new Set(tracks.map((track) => track.frequency))],
    tracks: visibleTracks(tracks, years, windowStart, windowEnd),
    gaps: built.gaps,
    notes: [...endedNotes, ...built.notes, ...(targetFrequency && converted.length > 0 ? [`${converted.map((track) => track.name).join(", ")}: ${targetFrequency.toLowerCase()} ${aggregationLabel} of ${converted[0]?.frequency.toLowerCase()} data.`] : [])],
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
        title={<>{zhFirst ? <Zh>{primary.title}</Zh> : meta?.nameEn}{meta?.nameEn && <span className="gloss">{zhFirst ? meta.nameEn : <Zh>{primary.title}</Zh>} <span className="tag">{meta.nameEnSource === "nbs-official" ? "NBS English" : "auto-translated"}</span></span>}</>}
        subtitle={results.length > 1 ? <p className="lede">{primary.region && primary.region.value !== "000000000000" ? `${regionLabel(primary.region)}, compared with ` : "Compared with "}{listWords(results.slice(1).map((result) => displayTitle(result, results)))}</p> : undefined}
        actions={<>
          <button className="button" aria-pressed={saved} onClick={() => props.onToggleSaved(primary.key)}><StarIcon filled={saved} />{saved ? "Saved" : "Save"}</button>
          <ActionMenu label="Download" items={downloadItems} />
          <ActionMenu label="Share" items={shareItems} />
        </>}
      />
      <div className="meta-line"><span>{primary.frequency}</span><span>{unitLabel(primary.unit)}</span><span>{primary.agency}</span>{!/seasonal|季调/i.test(`${primary.title} ${primary.unit}`) && <span>Not seasonally adjusted</span>}{primary.region && primary.region.value !== "000000000000" && <span>Region: {regionLabel(primary.region)} <Zh>{regionLabel(primary.region) === primary.region.text ? "" : primary.region.text}</Zh></span>}</div>

      {latest && (
        <p className="stat-line" aria-label="Latest observation">
          <span className="stat-value">{fmt(latest.value, primary.unit)}</span>
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
      {!curated?.ended && latest && isBehind(latest.date, primary.frequency) && <div className="notice"><div><b>Latest available observation is {observationLabel(latest.date, primary.frequency)}.</b>The source has published nothing newer; the store was last checked {fmtDate(primary.updatedAt) || "today"}.</div></div>}
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
          <button className="button" aria-expanded={optionsOpen} aria-controls="chart-options" onClick={() => setOptionsOpen((value) => !value)}>Options</button>
          <AddSeries keys={props.route.keys} lang={props.lang} navigate={props.navigate} />
          </>}
        />
        {optionsOpen && <div className="chart-options" id="chart-options">
          <label>Frequency<select value={chosenFrequency} onChange={(event) => set({ freq: event.target.value === "" ? "" : event.target.value })}><option value="">{autoFrequency ? `Native (${autoFrequency.toLowerCase()} for this compare)` : "Native"}</option><option value="Quarterly">Quarterly</option><option value="Annual">Annual</option></select></label>
          {targetFrequency && <label>Aggregate<select value={aggregation} onChange={(event) => set({ agg: event.target.value === "avg" ? "" : event.target.value })}><option value="avg">Average</option><option value="sum">Sum</option><option value="last">End of period</option></select></label>}
          <label>Show as<select value={show} onChange={(event) => { if (isShow(event.target.value)) set({ show: event.target.value === "default" ? "" : event.target.value }); }}>{SHOW_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          {canLog && <label><input type="checkbox" checked={logScale} onChange={(event) => setLogScale(event.target.checked)} /> Log scale</label>}
          {results.some((result) => result.frequency === "Monthly") && <label><input type="checkbox" checked={lunar} onChange={(event) => set({ lny: event.target.checked ? "1" : "" })} /> Shade Lunar New Year</label>}
        </div>}
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === "chart" && (
            <>
              <div className="range-row" role="group" aria-label="Date range">{RANGES.map((item) => <button key={item.label} aria-pressed={!windowed && years === item.years} onClick={() => { setCustomDates(false); set({ range: item.years === null ? "max" : `${item.years}y`, from: "", to: "" }); }}>{item.label}</button>)}<button aria-pressed={customDates || windowed} onClick={() => setCustomDates((value) => !value)}>Custom</button>{(customDates || windowed) && <><label className="date-pick">From<input type="month" value={props.route.from} max={props.route.to || undefined} onChange={(event) => set({ from: event.target.value })} aria-label="Start month" /></label><label className="date-pick">To<input type="month" value={props.route.to} min={props.route.from || undefined} onChange={(event) => set({ to: event.target.value })} aria-label="End month" /></label></>}</div>
              <div><SeriesChart tracks={tracks} gaps={built.gaps} years={years} start={windowStart} end={windowEnd} logScale={logScale && canLog} lunar={lunar} unit={unit} title={results.map((result) => result.title).join(", ")} /></div>
              {tracks.length > 1 && <div className="chart-legend" aria-label="Legend">{tracks.map((track) => <span key={track.id}><i className={track.dash ? "dashed" : ""} style={{ color: track.color }} />{track.name}</span>)}</div>}
              {built.notes.map((note) => <p className="chart-caption" key={note}><Zh>{note}</Zh></p>)}
              {targetFrequency && converted.length > 0 && <p className="chart-caption">{converted.map((track) => track.name).join(", ")}: {targetFrequency.toLowerCase()} {aggregationLabel} of {converted[0]?.frequency.toLowerCase()} data; an incomplete final period is omitted.</p>}
              {!built.notes.length && firstSeries && <p className="chart-caption">{unitLabel(unit)}{lunar && primary.frequency === "Monthly" ? ". January and February are shaded: Lunar New Year falls in either month and distorts both." : ""}</p>}
            </>
          )}
          {tab === "table" && (
            <>
              <div className="table-scroll"><table><thead><tr><th scope="col">Period</th>{tracks.map((track) => <th key={track.id} scope="col">{track.name}</th>)}</tr></thead><tbody>{shownRows.map((row) => <tr key={row.period}><td>{observationLabel(row.period, tableFrequency)}</td>{row.cells.map((cell, index) => <td key={index}>{cell === null ? "—" : fmt(cell, unit)}</td>)}</tr>)}</tbody></table></div>
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
          {readingNotesZh && <p><Zh className="gloss block">{readingNotesZh}</Zh></p>}
        </div>
        <div className="card">
          <h2>Series Details</h2>
          <dl>
            <dt>Source</dt><dd>{primary.agency}</dd>
            <dt>Retrieved via</dt><dd>{via}. <a href={sourceLink} target="_blank" rel="noreferrer">{meta ? "Open on data.stats.gov.cn" : "Open the source"}</a></dd>
            {meta && <><dt>Dataset</dt><dd>{meta.datasetEn ? <>{meta.datasetEn} <Zh className="gloss">{meta.dataset}</Zh></> : <Zh>{meta.dataset}</Zh>}</dd></>}
            <dt>Category</dt><dd>{meta ? categoryPath(meta) : curated?.group ?? "—"}</dd>
            <dt>Region</dt><dd>{primary.region ? <>{regionLabel(primary.region)}{regionLabel(primary.region) !== primary.region.text && <> <Zh className="gloss">{primary.region.text}</Zh></>}</> : "China, national"}</dd>
            <dt>Frequency</dt><dd>{primary.frequency}</dd>
            <dt>Unit</dt><dd>{unitLabel(primary.unit)}</dd>
            <dt>Range</dt><dd>{headline && headline.points.length > 0 ? `${observationLabel(headline.points[0]?.date ?? "", primary.frequency)} to ${observationLabel(headline.points[headline.points.length - 1]?.date ?? "", primary.frequency)}` : "—"}</dd>
            <dt>Updated</dt><dd>{primary.source === "live" ? "Just now" : fmtDate(primary.updatedAt) || "—"}</dd>
            <dt>Next release</dt><dd>{nextRelease ? `${fmtDate(nextRelease.date.slice(0, 10))}, ${nextRelease.date.slice(11, 16)} CST, ${nextRelease.en}` : "Not scheduled this month"}</dd>
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
        {revised !== null && revised.length > 0 && <div className="table-scroll"><table><thead><tr><th scope="col">Period</th><th scope="col" style={{ textAlign: "left" }}>Series</th><th scope="col">Current</th><th scope="col">Previously</th></tr></thead><tbody>{revised.map((row) => <tr key={`${row.label}${row.period}`}><td>{row.period}</td><td style={{ textAlign: "left", fontFamily: "var(--sans)" }}>{row.label}</td><td>{row.vintages.at(-1)?.value === null || row.vintages.at(-1) === undefined ? "—" : fmt(row.vintages.at(-1)?.value ?? 0, primary.unit)}</td><td>{row.vintages.slice(0, -1).map((vintage) => `${vintage.value === null ? "—" : fmt(vintage.value, primary.unit)} (${fmtDate(vintage.fetchedAt)})`).join(", ")}</td></tr>)}</tbody></table></div>}
      </section>
      <div className="cite"><p>Cite: {citation}</p><button className="button" onClick={() => navigator.clipboard?.writeText(citation).then(() => props.toast("Citation copied"))}>Copy</button></div>

      {!curated && meta && related.length > 0 && <section className="related"><div className="section-head"><h2>Related Series</h2><span>{categoryPath({ categories: meta.categories.slice(-1), categoriesEn: meta.categoriesEn?.slice(-1), family: meta.family })}</span><a className="more" href={`#/category/${encodeURIComponent(meta.categories.at(-1) ?? "")}`}>All in this category</a></div><div className="tiles">{related.map((entry) => <a key={entry.key} className="tile" href={seriesHash([entry.key])}><span className="label">{entry.nameEn || entry.name}</span>{entry.nameEn && <small><Zh>{entry.name}</Zh></small>}<small>{entry.frequency}, {unitLabel(entry.unit)}</small></a>)}</div></section>}
      {curated && <section className="related"><div className="section-head"><h2>Related Series</h2><span>{curated.group}</span></div><div className="tiles">{props.curated.filter((entry) => entry.group === curated.group && entry.key !== curated.key).slice(0, 4).map((entry) => <a key={entry.key} className="tile" href={seriesHash([entry.key])}><span className="label">{entry.title}</span><small>{entry.frequency}, {entry.agency}</small></a>)}</div></section>}
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
const PROVINCES: Province[] = [
  { code: "230000000000", abbr: "HLJ", en: "Heilongjiang", zh: "黑龙江", col: 8, row: 1 },
  { code: "650000000000", abbr: "XJ", en: "Xinjiang", zh: "新疆", col: 1, row: 2 },
  { code: "150000000000", abbr: "NMG", en: "Inner Mongolia", zh: "内蒙古", col: 5, row: 2 },
  { code: "220000000000", abbr: "JL", en: "Jilin", zh: "吉林", col: 8, row: 2 },
  { code: "620000000000", abbr: "GS", en: "Gansu", zh: "甘肃", col: 3, row: 3 },
  { code: "640000000000", abbr: "NX", en: "Ningxia", zh: "宁夏", col: 4, row: 3 },
  { code: "110000000000", abbr: "BJ", en: "Beijing", zh: "北京", col: 6, row: 3 },
  { code: "120000000000", abbr: "TJ", en: "Tianjin", zh: "天津", col: 7, row: 3 },
  { code: "210000000000", abbr: "LN", en: "Liaoning", zh: "辽宁", col: 8, row: 3 },
  { code: "630000000000", abbr: "QH", en: "Qinghai", zh: "青海", col: 2, row: 4 },
  { code: "610000000000", abbr: "SAX", en: "Shaanxi", zh: "陕西", col: 4, row: 4 },
  { code: "140000000000", abbr: "SX", en: "Shanxi", zh: "山西", col: 5, row: 4 },
  { code: "130000000000", abbr: "HEB", en: "Hebei", zh: "河北", col: 6, row: 4 },
  { code: "370000000000", abbr: "SD", en: "Shandong", zh: "山东", col: 7, row: 4 },
  { code: "540000000000", abbr: "XZ", en: "Tibet", zh: "西藏", col: 1, row: 5 },
  { code: "510000000000", abbr: "SC", en: "Sichuan", zh: "四川", col: 3, row: 5 },
  { code: "410000000000", abbr: "HEN", en: "Henan", zh: "河南", col: 5, row: 5 },
  { code: "320000000000", abbr: "JS", en: "Jiangsu", zh: "江苏", col: 7, row: 5 },
  { code: "310000000000", abbr: "SH", en: "Shanghai", zh: "上海", col: 8, row: 5 },
  { code: "500000000000", abbr: "CQ", en: "Chongqing", zh: "重庆", col: 3, row: 6 },
  { code: "420000000000", abbr: "HUB", en: "Hubei", zh: "湖北", col: 5, row: 6 },
  { code: "340000000000", abbr: "AH", en: "Anhui", zh: "安徽", col: 6, row: 6 },
  { code: "330000000000", abbr: "ZJ", en: "Zhejiang", zh: "浙江", col: 8, row: 6 },
  { code: "530000000000", abbr: "YN", en: "Yunnan", zh: "云南", col: 2, row: 7 },
  { code: "520000000000", abbr: "GZ", en: "Guizhou", zh: "贵州", col: 3, row: 7 },
  { code: "430000000000", abbr: "HUN", en: "Hunan", zh: "湖南", col: 5, row: 7 },
  { code: "360000000000", abbr: "JX", en: "Jiangxi", zh: "江西", col: 6, row: 7 },
  { code: "350000000000", abbr: "FJ", en: "Fujian", zh: "福建", col: 7, row: 7 },
  { code: "450000000000", abbr: "GX", en: "Guangxi", zh: "广西", col: 4, row: 8 },
  { code: "440000000000", abbr: "GD", en: "Guangdong", zh: "广东", col: 5, row: 8 },
  { code: "460000000000", abbr: "HI", en: "Hainan", zh: "海南", col: 4, row: 9 },
];
const RAMP = ["#eef3f8", "#cfe0ee", "#9dc0dc", "#5b93c4", "#2e6da4", "#1c4f7c"];

interface RegionalValue { region: Region; value: number | null; period: string | null; points: SeriesPoint[]; }
interface RegionalResponse { key: string; title: string; unit: string; frequency: string; agency: string; updatedAt: string | null; periods: string[]; values: RegionalValue[]; }

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

function RegionsPage(props: { toast: (text: string) => void }) {
  const [data, setData] = useState<RegionalResponse | null>(null);
  const [period, setPeriod] = useState("");
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [selected, setSelected] = useState<string>("");
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    json(`/api/regional/provincial_gdp${period ? `?period=${encodeURIComponent(period)}` : ""}`).then((body) => {
      if (cancelled) return;
      if (isRegionalResponse(body)) { setData(body); setStatus("ok"); } else setStatus("error");
    }).catch(() => { if (!cancelled) setStatus("error"); });
    return () => { cancelled = true; };
  }, [period]);

  const rows = (data?.values ?? []).map((item) => ({ ...item, province: PROVINCES.find((province) => province.code === item.region.value) })).filter((item) => item.province && item.value !== null);
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
      <div className="breadcrumbs"><a href="#/">Home</a><span aria-hidden="true">›</span><span>Provinces</span></div>
      <div className="series-head">
        <div>
          <h1>Real GDP Growth by Province</h1>
          <p className="lede">Year-to-date real GDP, % change from the same period a year earlier: Q2 is first-half growth, Q4 is full-year growth. Source: provincial statistical bureaus, via NBS.</p>
        </div>
        <div className="actions">
          <label className="button" style={{ gap: 8 }}>Period<select value={period || shownPeriod || ""} onChange={(event) => setPeriod(event.target.value)} style={{ border: 0, background: "transparent", color: "inherit", font: "inherit" }}>{(data?.periods ?? []).map((item) => <option key={item} value={item}>{periodPretty(item)}</option>)}</select></label>
        </div>
      </div>

      {status === "loading" && <div className="state" role="status"><span className="loader" aria-hidden="true" />Loading provinces…</div>}
      {status === "error" && <div className="state" role="alert"><b>Provincial data unavailable</b><p>The store has no provincial rows yet. Run the ingest and try again.</p></div>}
      {status === "ok" && data && (
        <div className="regional-grid">
          <section className="card" aria-label="Map of provinces">
            <div className="card-head"><h2>Tile map</h2><span>{shownPeriod ? periodPretty(shownPeriod) : ""}, approximate geography</span></div>
            <div className="tile-map" role="group" aria-label="Provinces; select one to see its series">
              {rows.map((item) => {
                const province = item.province;
                if (!province) return null;
                const step = stepFor(item.value ?? 0, breaks);
                return (
                  <button key={province.code} className={`ptile ${step >= 3 ? "dark" : "light"}`} style={{ gridColumn: province.col, gridRow: province.row, background: RAMP[step] }} aria-pressed={selected === province.code} aria-label={`${province.en}, ${fmt(item.value ?? 0, "%")}%`} onClick={() => setSelected(selected === province.code ? "" : province.code)} onMouseEnter={() => undefined}>
                    <span>{province.abbr}</span><b>{fmt(item.value ?? 0, "%")}</b>
                  </button>
                );
              })}
            </div>
            <div className="ramp" aria-hidden="true">
              <span>% change</span>
              <div>
                <div className="steps">{RAMP.map((color) => <i key={color} style={{ background: color }} />)}</div>
                <div className="ticks">{breaks.map((edge) => <span key={edge} style={{ marginLeft: 0 }}>{edge}</span>)}</div>
              </div>
            </div>
          </section>
          <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
            {current && current.province && (
              <section className="card" style={{ padding: 16 }} aria-live="polite">
                <div className="section-head" style={{ marginBottom: 6 }}><h2 style={{ margin: 0 }}>{current.province.en} <Zh className="gloss">{current.province.zh}</Zh></h2></div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}><span className="latest-value" style={{ fontSize: 32 }}>{fmt(current.value ?? 0, "%")}</span><span className="unit" style={{ color: "var(--muted)", fontSize: 13 }}>%, {shownPeriod ? periodPretty(shownPeriod) : ""}, year to date</span></div>
                <Sparkline points={current.points} />
                <div className="actions" style={{ marginTop: 10 }}>
                  <a className="button" href={seriesHash(["provincial_gdp"], { region: current.province.code })}>Open series</a>
                  {picked.includes(current.province.code)
                    ? <button className="button" onClick={() => setPicked(picked.filter((code) => code !== current.province?.code))}>Remove from comparison</button>
                    : <button className="button" disabled={picked.length >= 4} onClick={() => setPicked([...picked, current.province?.code ?? ""].filter(Boolean))}>{picked.length >= 4 ? "Comparison is full" : "Add to comparison"}</button>}
                </div>
              </section>
            )}
            {picked.length > 0 && (
              <section className="card" style={{ padding: 16 }} aria-live="polite">
                <div className="section-head" style={{ marginBottom: 8 }}><h2 style={{ margin: 0 }}>Compare Provinces</h2><span>{picked.length} of 4</span></div>
                <div className="chip-row" style={{ margin: "0 0 10px" }}>{picked.map((code) => { const province = PROVINCES.find((item) => item.code === code); return <span className="chip" key={code}>{province?.en ?? code}<button onClick={() => setPicked(picked.filter((item) => item !== code))} aria-label={`Remove ${province?.en ?? code}`}>×</button></span>; })}</div>
                <a className="button" href={seriesHash(picked.map((code) => `provincial_gdp@${code}`), { range: "10y" })} aria-disabled={picked.length < 2}>{picked.length < 2 ? "Pick at least two" : `Chart ${picked.length} provinces together`}</a>
              </section>
            )}
            <section className="card">
              <div className="card-head"><h2>Ranking</h2><span>{shownPeriod ? periodPretty(shownPeriod) : ""}, highest to lowest</span></div>
              <div className="ranked" role="group" aria-label="Provinces ranked highest to lowest; select one to see its series">
                {ranked.map((item) => {
                  const province = item.province;
                  if (!province) return null;
                  const step = stepFor(item.value ?? 0, breaks);
                  return (
                    <button key={province.code} className={`r${selected === province.code ? " selected" : ""}`} aria-label={`${province.en}, ${fmt(item.value ?? 0, "%")}%`} style={{ border: 0, background: selected === province.code ? "var(--panel-2)" : "none", textAlign: "left", width: "100%", cursor: "pointer" }} onClick={() => setSelected(selected === province.code ? "" : province.code)} aria-pressed={selected === province.code}>
                      <span>{province.en}</span>
                      <span className="bar">{zeroPct > 0 && zeroPct < 100 && <b style={{ left: `${zeroPct}%` }} />}<i style={{ left: `${Math.min(zeroPct, ((item.value ?? 0) - low) / span * 100)}%`, width: `${Math.abs((item.value ?? 0) / span) * 100}%`, background: RAMP[step] }} /></span>
                      <span className="val">{fmt(item.value ?? 0, "%")}</span>
                    </button>
                  );
                })}
              </div>
            </section>
            <section className="card" style={{ padding: 16 }}>
              <h2>Notes on Provincial Data</h2>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                <li>NBS publishes provincial GDP growth as 本期累计, cumulative for the year. Provincial figures are compiled by provincial bureaus and have historically summed to more than the national total, so treat the ranking as indicative.</li>
                <li>Growth in small western provinces moves on a low base, so a high rate there is not comparable in weight to Guangdong or Jiangsu.</li>
                <li>Hong Kong, Macao and Taiwan publish through their own statistical offices and are not in this series.</li>
              </ul>
            </section>
          </div>
        </div>
      )}
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
      setReleases(data.map((item) => ({ id: str(item, "_id"), date: str(item, "fb_time"), title: str(item, "content"), en: str(item, "en"), keys: listOf(item, "keys").filter((key): key is string => typeof key === "string") })).filter((item) => item.id));
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
    if (route.view !== "search") setDraft("");
    document.title = route.view === "home" ? "EconStats China Data" : `${route.view === "series" ? route.keys.join(", ") : route.view} - EconStats China Data`;
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
      const current = route.view === "search" ? route : { view: "search" as const, q: "", freq: "", cat: "", dataset: "" };
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
        <a className="brand" href="#/"><span className="brand-mark" lang="zh-Hans" aria-hidden="true">数</span><span><strong>EconStats</strong><small>China Data</small></span></a>
        <div className="global-search"><SearchIcon /><input id="global-series-search" aria-label="Search series" aria-keyshortcuts="/" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { setDraft(""); event.currentTarget.blur(); if (route.view === "search") navigate(lastSeries.current.length ? { view: "series", keys: lastSeries.current, show: "", range: "", region: "", from: "", to: "", freq: "", agg: "", lny: "" } : { view: "home" }); } if (event.key === "Enter" && draft.trim()) navigate({ view: "search", q: draft.trim(), freq: "", cat: "", dataset: "" }); }} placeholder={`Search ${(stats?.seriesCount ?? 15000).toLocaleString("en-US")} series in English or Chinese`} /><kbd aria-hidden="true">/</kbd></div>
        <nav className="tab-nav" aria-label="Primary">
          <a href="#/" aria-current={current("home")}>Home</a>
          <a href="#/browse" aria-current={route.view === "browse" || (route.view === "search" && !route.q) ? "page" : undefined}>Browse</a>
          <a href="#/regions" aria-current={current("regions")}>Provinces</a>
          <a href="#/releases" aria-current={current("releases")}>Releases</a>
        </nav>
        <div className="topbar-tools">
          <button className="icon-button" onClick={cycleTheme} aria-label="Switch theme"><ThemeIcon /></button>
        </div>
      </header>
      <div className={route.view === "home" ? "body-grid no-sidebar" : "body-grid"}>
        {route.view !== "home" && <Sidebar stats={stats} curated={curated} route={route} saved={saved} recent={recent} />}
        {route.view === "home" && <Home stats={stats} curated={curated} releases={releases} releaseError={releaseError} onSearch={(q) => navigate({ view: "search", q, freq: "", cat: "", dataset: "" })} />}
        {route.view === "series" && <SeriesPage route={route} curated={curated} saved={saved} releases={releases} lang={lang} onToggleSaved={toggleSaved} navigate={navigate} toast={setToast} />}
        {route.view === "search" && <SearchPage route={route} stats={stats} chartKeys={lastSeries.current} lang={lang} navigate={navigate} />}
        {route.view === "browse" && <BrowsePage stats={stats} />}
        {route.view === "releases" && <ReleasesPage route={route} curated={curated} navigate={navigate} />}
        {route.view === "regions" && <RegionsPage toast={setToast} />}
        {route.view === "saved" && <KeyListPage title="Saved Series" keys={saved} empty="No saved series" />}
        {route.view === "recent" && <KeyListPage title="Recently Viewed" keys={recent} empty="No recently viewed series" />}
      </div>
      <footer>Official statistics from NBS, PBOC, Customs and Caixin. Independent project, not affiliated with any statistical agency.</footer>
      {/* The status region is always present so assistive tech announces the text when it changes; a live region inserted with its text already in it is often missed. */}
      <div role="status" aria-live="polite">{toast && <div className="toast">{toast}</div>}</div>
    </div>
  );
}

const rootElement = document.getElementById("root");
if (rootElement) createRoot(rootElement).render(<App />);
