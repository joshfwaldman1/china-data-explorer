/**
 * Server-side data layer for the China Data Explorer.
 *
 * Reuses the same open sources the EconStats agent uses:
 *   - Eastmoney datacenter — mirrors official NBS / PBOC / Customs releases
 *   - NBS new data portal (esData) — for series Eastmoney lacks (unemployment)
 *
 * All fetching happens server-side, which both matches how FRED works (its
 * frontend calls its own API, not the source agencies) and sidesteps the
 * browser CORS restrictions that would block a pure client-side page.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

export interface SeriesPoint {
  date: string; // "YYYY-MM"
  value: number;
}
export interface Series {
  label: string;
  points: SeriesPoint[];
}
export interface SeriesResult {
  key: string;
  title: string;
  agency: string;
  sourceUrl: string;
  frequency: string;
  unit: string;
  series: Series[];
  /** When the served copy was last written to the store, ISO. */
  updatedAt?: string;
  /** Which path answered: the store, a live fetch, or a stale copy after a failed refresh. */
  source?: "store" | "live" | "stale";
}

/**
 * Search terms for the headline series, so "inflation" finds CPI and
 * "jobless" finds unemployment. Chinese terms let a Chinese-reading analyst
 * reach the English-titled series too.
 */
export const CURATED_SYNONYMS: Record<string, string[]> = {
  gdp: ["gdp", "growth", "output", "national accounts", "国内生产总值", "经济增长"],
  provincial_gdp: ["guangdong", "provincial gdp", "regional gdp", "广东", "地区生产总值"],
  industrial_production: ["industrial production", "industry", "value added", "factory output", "工业增加值", "工业生产"],
  cpi: ["cpi", "inflation", "consumer prices", "prices", "cost of living", "居民消费价格", "通胀", "物价"],
  ppi: ["ppi", "producer prices", "factory gate prices", "deflation", "工业生产者价格", "出厂价格"],
  unemployment: ["unemployment", "jobless", "joblessness", "youth unemployment", "labor market", "labour market", "employment", "失业率", "青年失业", "就业"],
  retail_sales: ["retail sales", "consumption", "consumer spending", "shopping", "社会消费品零售", "消费"],
  money_supply: ["money supply", "m1", "m2", "liquidity", "broad money", "货币供应量", "广义货币"],
  new_loans: ["new loans", "credit", "bank lending", "yuan loans", "新增贷款", "人民币贷款", "信贷"],
  trade: ["trade", "exports", "imports", "trade balance", "customs", "进出口", "出口", "进口", "贸易"],
  forex_reserves: ["forex reserves", "foreign exchange reserves", "fx reserves", "gold reserves", "外汇储备", "黄金储备"],
  real_estate: ["real estate", "property", "housing", "real estate climate", "房地产", "国房景气指数", "楼市"],
  pmi: ["pmi", "manufacturing pmi", "purchasing managers", "factory activity", "采购经理指数", "制造业"],
  caixin_pmi: ["caixin", "caixin pmi", "private pmi", "财新", "财新制造业"],
  caixin_services_pmi: ["caixin services", "services pmi", "财新服务业"],
  electricity: ["electricity", "power consumption", "electricity consumption", "energy", "用电量", "电力"],
  lpr: ["lpr", "loan prime rate", "interest rate", "policy rate", "benchmark rate", "贷款市场报价利率", "利率"],
};

// ── Catalog ───────────────────────────────────────────────────────────────────

interface EastmoneyField {
  field: string;
  label: string;
}
interface EastmoneyIndicator {
  kind: "eastmoney";
  group: string;
  title: string;
  agency: string;
  frequency: string;
  unit: string;
  reportName: string;
  fields: EastmoneyField[];
}
interface NbsSeriesId {
  id: string;
  label: string;
  valueOffset?: number;
}
export interface NbsRegion {
  text: string;
  value: string;
}
interface NbsIndicator {
  kind: "nbs";
  group: string;
  title: string;
  agency: string;
  frequency: string;
  unit: string;
  cid: string;
  rootId: string;
  ids: NbsSeriesId[];
  region?: NbsRegion;
  /** Every region this series exists for. One request each — esData answers only the first `das`. */
  regions?: NbsRegion[];
}
// AkShare (via a local AKTools HTTP server) — huge breadth of fresh Chinese
// series maintained by the AkShare community. Optional: only these indicators
// need AKTools running (start it with `python -m aktools`); everything else
// works without it. Base URL overridable via AKTOOLS_URL.
interface AktoolsIndicator {
  kind: "aktools";
  group: string;
  title: string;
  agency: string;
  frequency: string;
  unit: string;
  fn: string; // AkShare function name, e.g. "macro_china_lpr"
  dateField: string; // record key holding the date
  // AkShare date formats vary by function; normalize to "YYYY-MM":
  //   iso      -> "2026-08-20T..." (slice by dateLen)
  //   cn_dot   -> "2026.7"
  //   cn_month -> "2026年07月份"
  dateFormat: "iso" | "cn_dot" | "cn_month";
  dateLen?: number; // iso only: 7 (YYYY-MM) or 10 (YYYY-MM-DD)
  fields: EastmoneyField[]; // one entry per series to extract
}
type Indicator = EastmoneyIndicator | NbsIndicator | AktoolsIndicator;

const AKTOOLS_URL = process.env.AKTOOLS_URL ?? "http://127.0.0.1:8080";

function nbsProvince(text: string, gbt2260: string): NbsRegion {
  return { text, value: gbt2260.padEnd(12, "0") };
}

const GUANGDONG = nbsProvince("广东省", "440000");

// NBS `das` values are the six-digit GB/T 2260 province code followed by six
// zeroes. Three live captures (Beijing, Shanghai, and Guangdong) confirmed the
// format. Keep the complete mainland province-level mapping here so additional
// regional series can be added without another round of code discovery.
export const NBS_PROVINCES: NbsRegion[] = [
  nbsProvince("北京市", "110000"),
  nbsProvince("天津市", "120000"),
  nbsProvince("河北省", "130000"),
  nbsProvince("山西省", "140000"),
  nbsProvince("内蒙古自治区", "150000"),
  nbsProvince("辽宁省", "210000"),
  nbsProvince("吉林省", "220000"),
  nbsProvince("黑龙江省", "230000"),
  nbsProvince("上海市", "310000"),
  nbsProvince("江苏省", "320000"),
  nbsProvince("浙江省", "330000"),
  nbsProvince("安徽省", "340000"),
  nbsProvince("福建省", "350000"),
  nbsProvince("江西省", "360000"),
  nbsProvince("山东省", "370000"),
  nbsProvince("河南省", "410000"),
  nbsProvince("湖北省", "420000"),
  nbsProvince("湖南省", "430000"),
  GUANGDONG,
  nbsProvince("广西壮族自治区", "450000"),
  nbsProvince("海南省", "460000"),
  nbsProvince("重庆市", "500000"),
  nbsProvince("四川省", "510000"),
  nbsProvince("贵州省", "520000"),
  nbsProvince("云南省", "530000"),
  nbsProvince("西藏自治区", "540000"),
  nbsProvince("陕西省", "610000"),
  nbsProvince("甘肃省", "620000"),
  nbsProvince("青海省", "630000"),
  nbsProvince("宁夏回族自治区", "640000"),
  nbsProvince("新疆维吾尔自治区", "650000"),
];

export const CATALOG: Record<string, Indicator> = {
  gdp: {
    kind: "eastmoney", group: "Growth & Output",
    title: "Gross Domestic Product", agency: "National Bureau of Statistics",
    frequency: "Quarterly", unit: "Percent change from year ago",
    reportName: "RPT_ECONOMY_GDP",
    fields: [{ field: "SUM_SAME", label: "Real GDP (YoY %)" }],
  },
  provincial_gdp: {
    kind: "nbs", group: "Regional",
    title: "Provincial Real GDP Growth", agency: "National Bureau of Statistics",
    // NBS publishes this as 本期累计 — cumulative year to date — so Q2 is
    // first-half growth and Q4 is the full year. Not a single-quarter rate.
    frequency: "Quarterly", unit: "Percent change from year ago, cumulative year to date",
    cid: "44ecf9ea21884caea5451c35e9c08fff",
    rootId: "854f819b04104191a5ae2f2cba270e6c",
    region: GUANGDONG,
    regions: NBS_PROVINCES,
    ids: [{
      id: "23c7f329424d4e90b22abc092a5b676f",
      label: "Real GDP, cumulative YTD (YoY %)",
      // NBS reports this as an index where the same period a year ago = 100.
      valueOffset: -100,
    }],
  },
  industrial_production: {
    kind: "eastmoney", group: "Growth & Output",
    title: "Industrial Production (Value-Added, Large Firms)", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Percent change from year ago",
    reportName: "RPT_ECONOMY_INDUS_GROW",
    fields: [{ field: "BASE_SAME", label: "Industrial production (YoY %)" }],
  },
  cpi: {
    kind: "eastmoney", group: "Prices",
    title: "Consumer Price Index", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Percent change from year ago",
    reportName: "RPT_ECONOMY_CPI",
    fields: [{ field: "NATIONAL_SAME", label: "CPI (YoY %)" }],
  },
  ppi: {
    kind: "eastmoney", group: "Prices",
    title: "Producer Price Index", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Percent change from year ago",
    reportName: "RPT_ECONOMY_PPI",
    fields: [{ field: "BASE_SAME", label: "PPI (YoY %)" }],
  },
  unemployment: {
    kind: "nbs", group: "Labor",
    title: "Surveyed Urban Unemployment Rate", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Percent",
    cid: "ee3b7046b390415b9b7745e3d16f6052",
    rootId: "fc982599aa684be7969d7b90b1bd0e84",
    ids: [
      { id: "3888eac6062945a79c8a27e5f13d4953", label: "Surveyed urban (%)" },
      { id: "bd6da1abb26046c2acb38aa701d90e86", label: "Youth 16-24, ex-students (%)" },
      { id: "7bc1bd5daeac48ae8bb413c34ece1d08", label: "Age 25-29, ex-students (%)" },
      { id: "c03a36c9562246b6bc8aab010951ef1c", label: "Age 30-59, ex-students (%)" },
    ],
  },
  retail_sales: {
    kind: "eastmoney", group: "Consumption",
    title: "Retail Sales of Consumer Goods", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Percent change from year ago",
    reportName: "RPT_ECONOMY_TOTAL_RETAIL",
    fields: [{ field: "RETAIL_TOTAL_SAME", label: "Retail sales (YoY %)" }],
  },
  money_supply: {
    kind: "eastmoney", group: "Money & Credit",
    title: "Money Supply (M1 / M2 Growth)", agency: "People's Bank of China",
    frequency: "Monthly", unit: "Percent change from year ago",
    reportName: "RPT_ECONOMY_CURRENCY_SUPPLY",
    fields: [
      { field: "BASIC_CURRENCY_SAME", label: "M2 (YoY %)" },
      { field: "CURRENCY_SAME", label: "M1 (YoY %)" },
    ],
  },
  new_loans: {
    kind: "eastmoney", group: "Money & Credit",
    title: "New Yuan Loans (Monthly Flow)", agency: "People's Bank of China",
    frequency: "Monthly", unit: "Hundred million yuan (亿元)",
    reportName: "RPT_ECONOMY_RMB_LOAN",
    fields: [{ field: "RMB_LOAN", label: "New RMB loans (100M yuan)" }],
  },
  trade: {
    kind: "eastmoney", group: "Trade & External",
    title: "Merchandise Trade (Exports / Imports)", agency: "General Administration of Customs",
    frequency: "Monthly", unit: "Percent change from year ago",
    reportName: "RPT_ECONOMY_CUSTOMS",
    fields: [
      { field: "EXIT_BASE_SAME", label: "Exports (YoY %)" },
      { field: "IMPORT_BASE_SAME", label: "Imports (YoY %)" },
    ],
  },
  forex_reserves: {
    kind: "eastmoney", group: "Trade & External",
    title: "Official Foreign Exchange Reserves", agency: "People's Bank of China",
    frequency: "Monthly", unit: "Hundred million USD (亿美元)",
    reportName: "RPT_ECONOMY_GOLD_CURRENCY",
    fields: [{ field: "FOREX", label: "FX reserves (100M USD)" }],
  },
  real_estate: {
    kind: "aktools", group: "Property",
    title: "Real Estate Climate Index (国房景气指数)", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Index (100 = neutral)",
    fn: "macro_china_real_estate", dateField: "日期", dateFormat: "iso", dateLen: 7,
    fields: [{ field: "最新值", label: "Real estate climate index" }],
  },
  pmi: {
    kind: "eastmoney", group: "Sentiment",
    title: "Purchasing Managers' Index", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Diffusion index (50 = neutral)",
    reportName: "RPT_ECONOMY_PMI",
    fields: [
      { field: "MAKE_INDEX", label: "Manufacturing PMI" },
      { field: "NMAKE_INDEX", label: "Non-manufacturing PMI" },
    ],
  },
  caixin_pmi: {
    kind: "aktools", group: "Sentiment",
    title: "Caixin Manufacturing PMI", agency: "Caixin / S&P Global",
    frequency: "Monthly", unit: "Diffusion index (50 = neutral)",
    fn: "macro_china_cx_pmi_yearly", dateField: "日期", dateFormat: "iso", dateLen: 7,
    fields: [{ field: "今值", label: "Caixin Manufacturing PMI" }],
  },
  caixin_services_pmi: {
    kind: "aktools", group: "Sentiment",
    title: "Caixin Services PMI", agency: "Caixin / S&P Global",
    frequency: "Monthly", unit: "Diffusion index (50 = neutral)",
    fn: "macro_china_cx_services_pmi_yearly", dateField: "日期", dateFormat: "iso", dateLen: 7,
    fields: [{ field: "今值", label: "Caixin Services PMI" }],
  },
  electricity: {
    kind: "aktools", group: "Growth & Output",
    title: "Electricity Consumption (Total Society)", agency: "National Energy Administration",
    frequency: "Monthly", unit: "Percent change from year ago",
    fn: "macro_china_society_electricity", dateField: "统计时间", dateFormat: "cn_dot",
    fields: [{ field: "全社会用电量同比", label: "Total electricity use (YoY %)" }],
  },
  lpr: {
    kind: "aktools", group: "Interest Rates",
    title: "Loan Prime Rate (LPR)", agency: "People's Bank of China",
    frequency: "Monthly", unit: "Percent per annum",
    fn: "macro_china_lpr", dateField: "TRADE_DATE", dateFormat: "iso", dateLen: 7,
    fields: [
      { field: "LPR1Y", label: "LPR 1-Year (%)" },
      { field: "LPR5Y", label: "LPR 5-Year (%)" },
    ],
  },
};

export interface CatalogEntry {
  key: string;
  title: string;
  group: string;
  agency: string;
  frequency: string;
  unit: string;
}

export function catalogList(): CatalogEntry[] {
  return Object.entries(CATALOG).map(([key, c]) => ({
    key, title: c.title, group: c.group, agency: c.agency,
    frequency: c.frequency, unit: c.unit,
  }));
}

// ── Server-side fetchers ──────────────────────────────────────────────────────

function toMonth(reportDate: string): string {
  const m = reportDate.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : reportDate;
}

async function fetchEastmoney(key: string, cfg: EastmoneyIndicator, limit: number): Promise<SeriesResult> {
  const params = new URLSearchParams({
    reportName: cfg.reportName, columns: "ALL", pageNumber: "1",
    pageSize: String(limit), sortColumns: "REPORT_DATE", sortTypes: "-1",
  });
  const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?${params.toString()}`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json, text/plain, */*" } });
  const json = await res.json();
  const rows: Record<string, unknown>[] = json?.result?.data ?? [];

  const series: Series[] = cfg.fields.map((f) => {
    const points: SeriesPoint[] = [];
    for (const row of rows) {
      const rawDate = row.REPORT_DATE;
      const rawVal = row[f.field];
      if (typeof rawDate !== "string") continue;
      const num = typeof rawVal === "number" ? rawVal : Number(rawVal);
      if (rawVal === null || rawVal === "" || Number.isNaN(num)) continue;
      points.push({ date: toMonth(rawDate), value: num });
    }
    points.sort((a, b) => a.date.localeCompare(b.date));
    return { label: f.label, points };
  });

  return {
    key, title: cfg.title, agency: cfg.agency,
    sourceUrl: "https://data.eastmoney.com/cjsj/",
    frequency: cfg.frequency, unit: cfg.unit, series,
  };
}

function nbsMonthlyRange(limit: number): string {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), 1);
  const start = new Date(end.getFullYear(), end.getMonth() - (limit - 1), 1);
  const ym = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  return `${ym(start)}MM-${ym(end)}MM`;
}

function nbsQuarterlyRange(limit: number): string {
  const now = new Date();
  const endIndex = now.getFullYear() * 4 + Math.floor(now.getMonth() / 3);
  const startIndex = endIndex - (limit - 1);
  const label = (index: number) => {
    const year = Math.floor(index / 4);
    const quarter = index % 4 + 1;
    return `${year}0${quarter}SS`;
  };
  return `${label(startIndex)}-${label(endIndex)}`;
}

function nbsRange(cfg: NbsIndicator, limit: number): string {
  return cfg.frequency === "Quarterly" ? nbsQuarterlyRange(limit) : nbsMonthlyRange(limit);
}

function nbsPeriod(code: string): string {
  const quarter = code.match(/^(\d{4})0([1-4])SS$/);
  if (quarter) return `${quarter[1]}-Q${quarter[2]}`;
  const month = code.match(/^(\d{4})(\d{2})/);
  return month ? `${month[1]}-${month[2]}` : code;
}

async function fetchNbs(key: string, cfg: NbsIndicator, limit: number): Promise<SeriesResult> {
  const region = cfg.region ?? { text: "全国", value: "000000000000" };
  const payload = {
    cid: cfg.cid, indicatorIds: cfg.ids.map((i) => i.id), daCatalogId: "",
    das: [region], showType: "1",
    dts: [nbsRange(cfg, limit)], rootId: cfg.rootId,
  };
  const res = await fetch(
    "https://data.stats.gov.cn/dg/website/publicrelease/web/external/stream/esData",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        Origin: "https://data.stats.gov.cn",
        Referer: "https://data.stats.gov.cn/dg/website/page.html",
        "User-Agent": UA,
      },
      body: JSON.stringify(payload),
    },
  );
  const json = await res.json();
  const periods: { code?: string; name?: string; values?: { _id?: string; da?: string; value?: unknown }[] }[] =
    json?.data ?? [];

  const series: Series[] = cfg.ids.map((idcfg) => {
    const points: SeriesPoint[] = [];
    for (const period of periods) {
      const code = typeof period.code === "string" ? period.code : "";
      const date = nbsPeriod(code);
      const found = (period.values ?? []).find(
        (value) => value._id === idcfg.id && (value.da === undefined || value.da === region.value),
      );
      const num = typeof found?.value === "number" ? found.value : Number(found?.value);
      if (found?.value === null || found?.value === undefined || found?.value === "" || Number.isNaN(num)) continue;
      const adjusted = num + (idcfg.valueOffset ?? 0);
      const value = idcfg.valueOffset === undefined ? adjusted : Math.round(adjusted * 10) / 10;
      points.push({ date, value });
    }
    points.sort((a, b) => a.date.localeCompare(b.date));
    return { label: idcfg.label, points };
  });

  return {
    key, title: cfg.title, agency: cfg.agency,
    sourceUrl: "https://data.stats.gov.cn/dg/website/page.html",
    frequency: cfg.frequency, unit: cfg.unit, series,
  };
}

// Normalize AkShare's varied date strings to a chart-friendly "YYYY-MM".
function normalizeAktoolsDate(raw: string, cfg: AktoolsIndicator): string | null {
  if (cfg.dateFormat === "iso") return raw.slice(0, cfg.dateLen ?? 7);
  if (cfg.dateFormat === "cn_dot") {
    // "2026.7" -> "2026-07"
    const m = raw.match(/^(\d{4})\.(\d{1,2})/);
    return m ? `${m[1] ?? ""}-${(m[2] ?? "").padStart(2, "0")}` : null;
  }
  if (cfg.dateFormat === "cn_month") {
    // "2026年07月份" -> "2026-07"
    const m = raw.match(/^(\d{4})\D+(\d{1,2})/);
    return m ? `${m[1] ?? ""}-${(m[2] ?? "").padStart(2, "0")}` : null;
  }
  return null;
}

async function fetchAktools(key: string, cfg: AktoolsIndicator, _limit: number): Promise<SeriesResult> {
  // AkShare functions can take 15-25s, so give them a generous timeout.
  // AKTools is a local Python service, not a remote portal. Say so when it is
  // down, or the page blames NBS for a service that was never started.
  let res: Response;
  try {
    res = await fetch(`${AKTOOLS_URL}/api/public/${cfg.fn}`, {
      signal: AbortSignal.timeout(45000),
    });
  } catch (error) {
    // A timeout is AKTools being slow (some AkShare functions scrape for 20s+);
    // anything else is the service not being there at all.
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new Error(timedOut
      ? `AKTools did not answer within 45s for ${cfg.fn}. The upstream AkShare call is slow or blocked; try again later.`
      : `AKTools is not running at ${AKTOOLS_URL}. This series comes from AkShare through a local AKTools service: start it with 'python -m aktools' and try again.`);
  }
  if (!res.ok) {
    throw new Error(`AKTools ${cfg.fn} -> HTTP ${res.status} (is 'python -m aktools' running on ${AKTOOLS_URL}?)`);
  }
  const rows: Record<string, unknown>[] = await res.json();
  if (!Array.isArray(rows)) throw new Error(`AKTools ${cfg.fn} returned an unexpected shape`);

  const series: Series[] = cfg.fields.map((f) => {
    const points: SeriesPoint[] = [];
    for (const row of rows) {
      const rawDate = row[cfg.dateField];
      const rawVal = row[f.field];
      if (typeof rawDate !== "string") continue;
      const date = normalizeAktoolsDate(rawDate, cfg);
      if (date === null) continue;
      const num = typeof rawVal === "number" ? rawVal : Number(rawVal);
      if (rawVal === null || rawVal === undefined || rawVal === "" || Number.isNaN(num)) continue;
      points.push({ date, value: num });
    }
    points.sort((a, b) => a.date.localeCompare(b.date));
    return { label: f.label, points };
  });

  return {
    key, title: cfg.title, agency: cfg.agency,
    sourceUrl: "https://github.com/akfamily/akshare",
    frequency: cfg.frequency, unit: cfg.unit, series,
  };
}

// Small in-memory cache — repeat clicks are instant, and slow AkShare calls
// happen at most once per TTL. (Bun's process holds this for the server's life.)
interface CacheEntry { at: number; data: SeriesResult; }
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function getSeries(key: string, limit = 120): Promise<SeriesResult | null> {
  const cfg = CATALOG[key];
  if (!cfg) return null;

  const cacheKey = `${key}:${limit}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  let data: SeriesResult;
  if (cfg.kind === "nbs") data = await fetchNbs(key, cfg, limit);
  else if (cfg.kind === "aktools") data = await fetchAktools(key, cfg, limit);
  else data = await fetchEastmoney(key, cfg, limit);

  cache.set(cacheKey, { at: Date.now(), data });
  return data;
}

/**
 * The region a catalog entry describes — empty for national series, and the
 * NBS region label (for example 广东省) for provincial ones. The store keys
 * observations by this so provinces stay distinct rows.
 */
export function seriesRegion(key: string): string {
  const cfg = CATALOG[key];
  if (cfg && cfg.kind === "nbs" && cfg.region) return cfg.regions ? cfg.region.value : cfg.region.text;
  return "";
}

/** The regions a curated series is published for, or an empty list. */
export function seriesRegions(key: string): NbsRegion[] {
  const cfg = CATALOG[key];
  return cfg && cfg.kind === "nbs" && cfg.regions ? cfg.regions : [];
}

/**
 * Fetch one region of a multi-region curated series. The store keys these
 * by the NBS `das` code, the same convention as catalog series.
 */
export async function fetchLiveRegion(key: string, region: NbsRegion, limit = 120): Promise<SeriesResult | null> {
  const cfg = CATALOG[key];
  if (!cfg || cfg.kind !== "nbs") return null;
  return fetchNbs(key, { ...cfg, region }, limit);
}

/**
 * Fetch straight from the upstream source, skipping the in-memory cache.
 * The ingest job uses this; the server should prefer the stored copy.
 */
export async function fetchLive(key: string, limit = 120): Promise<SeriesResult | null> {
  const cfg = CATALOG[key];
  if (!cfg) return null;
  if (cfg.kind === "nbs") return fetchNbs(key, cfg, limit);
  if (cfg.kind === "aktools") return fetchAktools(key, cfg, limit);
  return fetchEastmoney(key, cfg, limit);
}
