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
  electricity_output: ["electricity", "power generation", "electricity output", "energy", "发电量", "电力"],
  house_prices: ["house prices", "home prices", "property prices", "housing", "70 cities", "70-city", "房价", "住宅销售价格", "70个大中城市"],
  fx_usdcny: ["exchange rate", "yuan", "renminbi", "rmb", "usdcny", "cny", "fx", "汇率", "人民币"],
  reer_bis: ["exchange rate", "reer", "effective exchange rate", "汇率"],
  credit_private_bis: ["credit", "leverage", "debt", "bis", "杠杆率", "信贷"],
  credit_households_bis: ["household debt", "household credit", "leverage", "居民杠杆"],
  credit_corporate_bis: ["corporate debt", "corporate credit", "leverage", "企业杠杆"],
  gov_debt_imf: ["government debt", "public debt", "fiscal", "政府债务"],
  house_prices_real_bis: ["house prices", "property prices", "real house prices", "房价"],
  epu: ["uncertainty", "policy uncertainty", "epu", "不确定性"],
  tpu: ["trade policy uncertainty", "tariffs", "trade war", "贸易政策"],
  oecd_cli: ["leading indicator", "cli", "oecd", "先行指标"],
  consumer_confidence_oecd: ["consumer confidence", "sentiment", "消费者信心"],
  shibor_3m: ["shibor", "interbank", "money market", "同业拆借"],
  us_imports_from_china: ["us imports", "trade war", "tariffs", "美国进口"],
  us_exports_to_china: ["us exports", "soybeans", "trade war", "美国出口"],
  us_treasury_holdings: ["treasuries", "treasury holdings", "us debt", "美债"],
  us_import_prices_china: ["import prices", "tariffs", "进口价格"],
  golden_dragon: ["stocks", "adr", "nasdaq", "equities", "中概股"],
  population: ["population", "demographics", "人口"],
  fertility: ["fertility", "births", "demographics", "生育率"],
  population_65: ["ageing", "aging", "elderly", "demographics", "老龄化"],
  life_expectancy: ["life expectancy", "demographics", "预期寿命"],
  gdp_usd: ["gdp dollars", "nominal gdp", "world bank", "美元gdp"],
  gdp_per_capita_usd: ["gdp per capita", "income per head", "人均gdp"],
  gini: ["inequality", "gini", "基尼系数"],
  lpr: ["lpr", "loan prime rate", "interest rate", "policy rate", "benchmark rate", "贷款市场报价利率", "利率"],
};

// ── Catalog ───────────────────────────────────────────────────────────────────

interface EastmoneyField {
  field: string;
  label: string;
  /** Added to every value: an index where last year = 100 becomes a % change with -100. */
  valueOffset?: number;
}
interface EastmoneyIndicator {
  kind: "eastmoney";
  group: string;
  title: string;
  /** Set when the source stopped publishing: the last period, and why. */
  ended?: string;
  endedNote?: string;
  /** false keeps a series off the Home list (still in the sidebar, search and catalog). */
  home?: boolean;
  agency: string;
  frequency: string;
  unit: string;
  reportName: string;
  /** The date column; most reports use REPORT_DATE, the LPR report TRADE_DATE. */
  dateField?: string;
  fields: EastmoneyField[];
  /**
   * A table with one row per region and month (the 70-city house price
   * table): the column that names the region, the regions to serve, and an
   * optional computed average region. The table is downloaded once per
   * refresh and cached, then split by region.
   */
  regionField?: string;
  regions?: NbsRegion[];
  regionAverage?: NbsRegion;
  /** How many 500-row pages to pull for the full history. */
  pages?: number;
}
interface FredIndicator {
  kind: "fred";
  group: string;
  title: string;
  ended?: string;
  endedNote?: string;
  home?: boolean;
  agency: string;
  frequency: "Monthly" | "Quarterly" | "Annual";
  unit: string;
  seriesId: string;
  /** For a daily FRED series: how to bring it to the monthly frequency. */
  aggregate?: "avg" | "eop";
  /** Multiply every value: 1e-12 turns current dollars into trillions. */
  scale?: number;
  label: string;
}
interface NbsSeriesId {
  id: string;
  label: string;
  valueOffset?: number;
}
export interface NbsRegion {
  text: string;
  value: string;
  /** English name for display; the text stays the source's own label. */
  en?: string;
}
interface NbsIndicator {
  kind: "nbs";
  group: string;
  title: string;
  /** Set when the source stopped publishing: the last period, and why. */
  ended?: string;
  endedNote?: string;
  home?: boolean;
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
  /** Set when the source stopped publishing: the last period, and why. */
  ended?: string;
  endedNote?: string;
  home?: boolean;
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
type Indicator = EastmoneyIndicator | NbsIndicator | AktoolsIndicator | FredIndicator;

// AKTOOLS_URL=off says a deployment has no AKTools at all, so the AkShare
// series serve from the store and their refresh is skipped with a plain
// message — rather than probing localhost, which on a platform that puts
// this very app on :8080 answers 404 and reads like a mystery.
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

/** The 70 large and medium cities in NBS's monthly sales price survey, in NBS's own order. */
export const CITIES_70: NbsRegion[] = [
  { text: "北京", value: "beijing", en: "Beijing" },
  { text: "天津", value: "tianjin", en: "Tianjin" },
  { text: "石家庄", value: "shijiazhuang", en: "Shijiazhuang" },
  { text: "太原", value: "taiyuan", en: "Taiyuan" },
  { text: "呼和浩特", value: "hohhot", en: "Hohhot" },
  { text: "沈阳", value: "shenyang", en: "Shenyang" },
  { text: "大连", value: "dalian", en: "Dalian" },
  { text: "长春", value: "changchun", en: "Changchun" },
  { text: "哈尔滨", value: "harbin", en: "Harbin" },
  { text: "上海", value: "shanghai", en: "Shanghai" },
  { text: "南京", value: "nanjing", en: "Nanjing" },
  { text: "杭州", value: "hangzhou", en: "Hangzhou" },
  { text: "宁波", value: "ningbo", en: "Ningbo" },
  { text: "合肥", value: "hefei", en: "Hefei" },
  { text: "福州", value: "fuzhou", en: "Fuzhou" },
  { text: "厦门", value: "xiamen", en: "Xiamen" },
  { text: "南昌", value: "nanchang", en: "Nanchang" },
  { text: "济南", value: "jinan", en: "Jinan" },
  { text: "青岛", value: "qingdao", en: "Qingdao" },
  { text: "郑州", value: "zhengzhou", en: "Zhengzhou" },
  { text: "武汉", value: "wuhan", en: "Wuhan" },
  { text: "长沙", value: "changsha", en: "Changsha" },
  { text: "广州", value: "guangzhou", en: "Guangzhou" },
  { text: "深圳", value: "shenzhen", en: "Shenzhen" },
  { text: "南宁", value: "nanning", en: "Nanning" },
  { text: "海口", value: "haikou", en: "Haikou" },
  { text: "重庆", value: "chongqing", en: "Chongqing" },
  { text: "成都", value: "chengdu", en: "Chengdu" },
  { text: "贵阳", value: "guiyang", en: "Guiyang" },
  { text: "昆明", value: "kunming", en: "Kunming" },
  { text: "西安", value: "xian", en: "Xi'an" },
  { text: "兰州", value: "lanzhou", en: "Lanzhou" },
  { text: "西宁", value: "xining", en: "Xining" },
  { text: "银川", value: "yinchuan", en: "Yinchuan" },
  { text: "乌鲁木齐", value: "urumqi", en: "Urumqi" },
  { text: "唐山", value: "tangshan", en: "Tangshan" },
  { text: "秦皇岛", value: "qinhuangdao", en: "Qinhuangdao" },
  { text: "包头", value: "baotou", en: "Baotou" },
  { text: "丹东", value: "dandong", en: "Dandong" },
  { text: "锦州", value: "jinzhou", en: "Jinzhou" },
  { text: "吉林", value: "jilin", en: "Jilin" },
  { text: "牡丹江", value: "mudanjiang", en: "Mudanjiang" },
  { text: "无锡", value: "wuxi", en: "Wuxi" },
  { text: "扬州", value: "yangzhou", en: "Yangzhou" },
  { text: "徐州", value: "xuzhou", en: "Xuzhou" },
  { text: "温州", value: "wenzhou", en: "Wenzhou" },
  { text: "金华", value: "jinhua", en: "Jinhua" },
  { text: "蚌埠", value: "bengbu", en: "Bengbu" },
  { text: "安庆", value: "anqing", en: "Anqing" },
  { text: "泉州", value: "quanzhou", en: "Quanzhou" },
  { text: "九江", value: "jiujiang", en: "Jiujiang" },
  { text: "赣州", value: "ganzhou", en: "Ganzhou" },
  { text: "烟台", value: "yantai", en: "Yantai" },
  { text: "济宁", value: "jining", en: "Jining" },
  { text: "洛阳", value: "luoyang", en: "Luoyang" },
  { text: "平顶山", value: "pingdingshan", en: "Pingdingshan" },
  { text: "宜昌", value: "yichang", en: "Yichang" },
  { text: "襄阳", value: "xiangyang", en: "Xiangyang" },
  { text: "岳阳", value: "yueyang", en: "Yueyang" },
  { text: "常德", value: "changde", en: "Changde" },
  { text: "惠州", value: "huizhou", en: "Huizhou" },
  { text: "湛江", value: "zhanjiang", en: "Zhanjiang" },
  { text: "韶关", value: "shaoguan", en: "Shaoguan" },
  { text: "桂林", value: "guilin", en: "Guilin" },
  { text: "北海", value: "beihai", en: "Beihai" },
  { text: "三亚", value: "sanya", en: "Sanya" },
  { text: "泸州", value: "luzhou", en: "Luzhou" },
  { text: "南充", value: "nanchong", en: "Nanchong" },
  { text: "遵义", value: "zunyi", en: "Zunyi" },
  { text: "大理", value: "dali", en: "Dali" },
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
    ended: "2025-09", endedNote: "Caixin ended its sponsorship of the S&P Global China PMI in 2025. From October 2025 the same survey is published as the RatingDog China General PMI, which no free source carries yet. This series stops at September 2025.",
    fn: "macro_china_cx_pmi_yearly", dateField: "日期", dateFormat: "iso", dateLen: 7,
    fields: [{ field: "今值", label: "Caixin Manufacturing PMI" }],
  },
  caixin_services_pmi: {
    kind: "aktools", group: "Sentiment",
    title: "Caixin Services PMI", agency: "Caixin / S&P Global",
    frequency: "Monthly", unit: "Diffusion index (50 = neutral)",
    ended: "2025-09", endedNote: "Caixin ended its sponsorship of the S&P Global China PMI in 2025. From October 2025 the same survey is published as the RatingDog China General PMI, which no free source carries yet. This series stops at September 2025.",
    fn: "macro_china_cx_services_pmi_yearly", dateField: "日期", dateFormat: "iso", dateLen: 7,
    fields: [{ field: "今值", label: "Caixin Services PMI" }],
  },
  house_prices: {
    kind: "eastmoney", group: "Property",
    title: "New Home Prices, 70 Cities", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Percent change from year ago",
    // NBS's 70-city sales price index, mirrored by Eastmoney: one row per
    // city and month, "same month last year = 100". The average region is a
    // simple mean of the 70 cities; NBS publishes no official composite.
    reportName: "RPT_ECONOMY_HOUSE_PRICE", regionField: "CITY", pages: 30,
    regions: CITIES_70,
    regionAverage: { text: "70城平均", value: "avg", en: "70-city average" },
    fields: [
      { field: "FIRST_COMHOUSE_SAME", label: "New homes (YoY %)", valueOffset: -100 },
      { field: "SECOND_HOUSE_SAME", label: "Existing homes (YoY %)", valueOffset: -100 },
    ],
  },
  electricity_output: {
    kind: "nbs", group: "Growth & Output",
    title: "Electricity Generation", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Percent change from year ago",
    cid: "1abb1cfea75847b8bf1a0e395d85966b",
    rootId: "fc982599aa684be7969d7b90b1bd0e84",
    ids: [{ id: "5cc686f383d84ed9bd11f4293ab4170e", label: "Electricity output (YoY %)" }],
  },
  lpr: {
    kind: "eastmoney", group: "Interest Rates",
    title: "Loan Prime Rate (LPR)", agency: "People's Bank of China",
    frequency: "Monthly", unit: "Percent per annum",
    // Eastmoney mirrors the monthly PBOC fixing, dated by the fixing day.
    reportName: "RPTA_WEB_RATE", dateField: "TRADE_DATE",
    fields: [
      { field: "LPR1Y", label: "LPR 1-Year (%)" },
      { field: "LPR5Y", label: "LPR 5-Year (%)" },
    ],
  },
  // ── International sources via FRED ─────────────────────────────────────
  fx_usdcny: { kind: "fred", group: "Exchange Rates", home: false, title: "Yuan per US Dollar", agency: "Federal Reserve Board", frequency: "Monthly", unit: "Yuan per US dollar", seriesId: "EXCHUS", label: "CNY per USD, monthly average" },
  reer_bis: { kind: "fred", group: "Exchange Rates", home: false, title: "Real Effective Exchange Rate", agency: "Bank for International Settlements", frequency: "Monthly", unit: "Index, 2020 = 100", seriesId: "RBCNBIS", label: "Real broad effective exchange rate" },
  credit_private_bis: { kind: "fred", group: "Money & Credit", home: false, title: "Credit to the Private Non-Financial Sector", agency: "Bank for International Settlements", frequency: "Quarterly", unit: "Percent of GDP", seriesId: "QCNPAM770A", label: "Private non-financial credit (% of GDP)" },
  credit_households_bis: { kind: "fred", group: "Money & Credit", home: false, title: "Household Credit", agency: "Bank for International Settlements", frequency: "Quarterly", unit: "Percent of GDP", seriesId: "QCNHAM770A", label: "Household credit (% of GDP)" },
  credit_corporate_bis: { kind: "fred", group: "Money & Credit", home: false, title: "Non-Financial Corporate Credit", agency: "Bank for International Settlements", frequency: "Quarterly", unit: "Percent of GDP", seriesId: "QCNNAM770A", label: "Non-financial corporate credit (% of GDP)" },
  gov_debt_imf: { kind: "fred", group: "Public Finance", home: false, title: "General Government Gross Debt", agency: "International Monetary Fund", frequency: "Annual", unit: "Percent of GDP", seriesId: "GGGDTACNA188N", label: "General government gross debt (% of GDP)" },
  house_prices_real_bis: { kind: "fred", group: "Property", home: false, title: "Real Residential Property Prices", agency: "Bank for International Settlements", frequency: "Quarterly", unit: "Index, 2010 = 100", seriesId: "QCNR628BIS", label: "Real residential property price index" },
  epu: { kind: "fred", group: "Sentiment", home: false, title: "Economic Policy Uncertainty Index", agency: "Baker, Bloom and Davis", frequency: "Monthly", unit: "Index", seriesId: "CHNMAINLANDEPU", label: "Economic policy uncertainty, mainland papers" },
  tpu: { kind: "fred", group: "Sentiment", home: false, title: "Trade Policy Uncertainty Index", agency: "Baker, Bloom and Davis", frequency: "Monthly", unit: "Index", seriesId: "CHNMAINLANDTPU", label: "Trade policy uncertainty, mainland papers" },
  oecd_cli: { kind: "fred", group: "Sentiment", home: false, title: "OECD Composite Leading Indicator", agency: "OECD", frequency: "Monthly", unit: "Index, long-term average = 100", seriesId: "CHNLOLITOAASTSAM", label: "Composite leading indicator, amplitude adjusted" },
  consumer_confidence_oecd: { kind: "fred", group: "Sentiment", home: false, title: "Consumer Confidence (OECD)", agency: "OECD", frequency: "Monthly", unit: "Index, long-term average = 100", seriesId: "CSCICP02CNM460S", label: "Consumer confidence, OECD standardised" },
  shibor_3m: { kind: "fred", group: "Interest Rates", home: false, title: "3-Month Interbank Rate", agency: "OECD, from the People's Bank of China", frequency: "Monthly", unit: "Percent per annum", seriesId: "IR3TIB01CNM156N", label: "3-month interbank rate" },
  us_imports_from_china: { kind: "fred", group: "Trade & External", home: false, title: "US Imports from China", agency: "US Census Bureau", frequency: "Monthly", unit: "Millions of US dollars", seriesId: "IMPCH", label: "US goods imports from China, customs basis" },
  us_exports_to_china: { kind: "fred", group: "Trade & External", home: false, title: "US Exports to China", agency: "US Census Bureau", frequency: "Monthly", unit: "Millions of US dollars", seriesId: "EXPCH", label: "US goods exports to China, FAS basis" },
  us_treasury_holdings: { kind: "fred", group: "Trade & External", home: false, title: "China's Holdings of US Treasuries", agency: "US Department of the Treasury", frequency: "Monthly", unit: "Millions of US dollars", seriesId: "FORTREASPOS41408", label: "Holdings of US Treasury securities" },
  us_import_prices_china: { kind: "fred", group: "Prices", home: false, title: "US Import Price Index from China", agency: "US Bureau of Labor Statistics", frequency: "Monthly", unit: "Index, December 2003 = 100", seriesId: "CHNTOT", label: "Import price index, all industries, from China" },
  golden_dragon: { kind: "fred", group: "Markets", home: false, title: "NASDAQ Golden Dragon China Index", agency: "Nasdaq", frequency: "Monthly", unit: "Index, monthly average", seriesId: "NASDAQHXC", aggregate: "avg", label: "Golden Dragon China index, monthly average" },
  population: { kind: "fred", group: "Demographics", home: false, title: "Population", agency: "World Bank", frequency: "Annual", unit: "Millions of people", seriesId: "POPTOTCNA647NWDB", scale: 1e-6, label: "Total population" },
  fertility: { kind: "fred", group: "Demographics", home: false, title: "Fertility Rate", agency: "World Bank", frequency: "Annual", unit: "Births per woman", seriesId: "SPDYNTFRTINCHN", label: "Total fertility rate" },
  population_65: { kind: "fred", group: "Demographics", home: false, title: "Population Aged 65 and Over", agency: "World Bank", frequency: "Annual", unit: "Percent of total population", seriesId: "SPPOP65UPTOZSCHN", label: "Share aged 65 and over" },
  life_expectancy: { kind: "fred", group: "Demographics", home: false, title: "Life Expectancy at Birth", agency: "World Bank", frequency: "Annual", unit: "Years", seriesId: "SPDYNLE00INCHN", label: "Life expectancy at birth" },
  gdp_usd: { kind: "fred", group: "Growth & Output", home: false, title: "GDP in US Dollars", agency: "World Bank", frequency: "Annual", unit: "Trillions of current US dollars", seriesId: "MKTGDPCNA646NWDB", scale: 1e-12, label: "GDP, current US dollars" },
  gdp_per_capita_usd: { kind: "fred", group: "Growth & Output", home: false, title: "GDP per Capita in US Dollars", agency: "World Bank", frequency: "Annual", unit: "Current US dollars", seriesId: "PCAGDPCNA646NWDB", label: "GDP per capita, current US dollars" },
  gini: { kind: "fred", group: "Demographics", home: false, title: "Gini Index", agency: "World Bank", frequency: "Annual", unit: "Index, 0 to 100", seriesId: "SIPOVGINICHN", label: "Gini index" },
};

export interface CatalogEntry {
  key: string;
  title: string;
  group: string;
  agency: string;
  frequency: string;
  unit: string;
  ended?: string;
  endedNote?: string;
  home?: boolean;
}

export function catalogList(): CatalogEntry[] {
  return Object.entries(CATALOG).map(([key, c]) => ({
    key, title: c.title, group: c.group, agency: c.agency,
    frequency: c.frequency, unit: c.unit,
    ...(c.ended ? { ended: c.ended, endedNote: c.endedNote } : {}),
    ...(c.home === false ? { home: false } : {}),
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
    pageSize: String(limit), sortColumns: cfg.dateField ?? "REPORT_DATE", sortTypes: "-1",
  });
  const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?${params.toString()}`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json, text/plain, */*" } });
  const json = await res.json();
  const rows: Record<string, unknown>[] = json?.result?.data ?? [];

  const series: Series[] = cfg.fields.map((f) => {
    const points: SeriesPoint[] = [];
    for (const row of rows) {
      const rawDate = row[cfg.dateField ?? "REPORT_DATE"];
      const rawVal = row[f.field];
      if (typeof rawDate !== "string") continue;
      const num = typeof rawVal === "number" ? rawVal : Number(rawVal);
      if (rawVal === null || rawVal === "" || Number.isNaN(num)) continue;
      points.push({ date: toMonth(rawDate), value: offsetValue(num, f.valueOffset) });
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

function offsetValue(value: number, offset: number | undefined): number {
  return offset === undefined ? value : Math.round((value + offset) * 10) / 10;
}

// A regional Eastmoney table is one download per refresh, not one per region:
// the 70-city table is 13,000 rows, and the ingest asks for 71 regions in a row.
const eastmoneyTables = new Map<string, { at: number; pages: number; complete: boolean; rows: Record<string, unknown>[] }>();
const EASTMONEY_TABLE_TTL_MS = 15 * 60 * 1000;
const EASTMONEY_PAGE_SIZE = 500;

/** The newest `pages` pages of a regional table, fetched in parallel batches and cached. */
async function loadEastmoneyTable(cfg: EastmoneyIndicator, pages: number): Promise<Record<string, unknown>[]> {
  const wanted = Math.max(1, Math.min(pages, cfg.pages ?? 1));
  const cached = eastmoneyTables.get(cfg.reportName);
  if (cached && Date.now() - cached.at < EASTMONEY_TABLE_TTL_MS && (cached.complete || cached.pages >= wanted)) return cached.rows;
  const fetchPage = async (page: number): Promise<{ rows: Record<string, unknown>[]; totalPages: number }> => {
    const params = new URLSearchParams({
      reportName: cfg.reportName, columns: "ALL", pageNumber: String(page),
      pageSize: String(EASTMONEY_PAGE_SIZE), sortColumns: cfg.dateField ?? "REPORT_DATE", sortTypes: "-1",
    });
    const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?${params.toString()}`;
    const headers = { "User-Agent": UA, Accept: "application/json, text/plain, */*" };
    // Eastmoney occasionally stalls a page; one retry covers it.
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(45_000) }).catch(() => fetch(url, { headers, signal: AbortSignal.timeout(45_000) }));
    const json = await res.json();
    const data: unknown = json?.result?.data;
    const rows: Record<string, unknown>[] = [];
    if (Array.isArray(data)) for (const row of data) if (typeof row === "object" && row !== null) rows.push(row);
    return { rows, totalPages: typeof json?.result?.pages === "number" ? json.result.pages : wanted };
  };
  const first = await fetchPage(1);
  const last = Math.min(wanted, first.totalPages);
  const rows = [...first.rows];
  for (let page = 2; page <= last; page += 9) {
    const batch = await Promise.all(Array.from({ length: Math.min(9, last - page + 1) }, (_, offset) => fetchPage(page + offset)));
    for (const part of batch) rows.push(...part.rows);
  }
  eastmoneyTables.set(cfg.reportName, { at: Date.now(), pages: last, complete: last >= first.totalPages, rows });
  return rows;
}

/** One region of a regional Eastmoney table, or the simple average across regions for the average region. */
async function fetchEastmoneyRegion(key: string, cfg: EastmoneyIndicator, region: NbsRegion, limit: number): Promise<SeriesResult> {
  // Enough pages for `limit` months of every region, plus one for the ragged newest month.
  const regionCount = cfg.regions?.length ?? 1;
  const rows = await loadEastmoneyTable(cfg, Math.ceil((limit * regionCount) / EASTMONEY_PAGE_SIZE) + 1);
  const dateField = cfg.dateField ?? "REPORT_DATE";
  const regionField = cfg.regionField ?? "CITY";
  const isAverage = cfg.regionAverage !== undefined && region.value === cfg.regionAverage.value;
  const series: Series[] = cfg.fields.map((f) => {
    // month -> values across the rows that belong to this region (or all regions for the average)
    const byMonth = new Map<string, number[]>();
    for (const row of rows) {
      const rawDate = row[dateField];
      if (typeof rawDate !== "string") continue;
      if (!isAverage && row[regionField] !== region.text) continue;
      const rawVal = row[f.field];
      const num = typeof rawVal === "number" ? rawVal : Number(rawVal);
      if (rawVal === null || rawVal === "" || Number.isNaN(num)) continue;
      const month = toMonth(rawDate);
      byMonth.set(month, [...(byMonth.get(month) ?? []), num]);
    }
    const points: SeriesPoint[] = [...byMonth.entries()].map(([date, values]) => {
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      return { date, value: offsetValue(isAverage ? Math.round(mean * 100) / 100 : mean, f.valueOffset) };
    });
    points.sort((a, b) => a.date.localeCompare(b.date));
    return { label: f.label, points: points.slice(-limit) };
  });
  return {
    key, title: cfg.title, agency: cfg.agency,
    sourceUrl: "https://data.eastmoney.com/cjsj/newhouse.html",
    frequency: cfg.frequency, unit: cfg.unit, series,
  };
}

// ── FRED ──────────────────────────────────────────────────────────────────────
//
// The St. Louis Fed's FRED mirrors series from the BIS, OECD, IMF, World Bank
// and US agencies that NBS does not publish. Needs FRED_API_KEY.

async function fetchFred(key: string, cfg: FredIndicator, limit: number): Promise<SeriesResult> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) throw new Error("FRED_API_KEY is not configured on this deployment; this series serves from the store only.");
  const monthsPerPeriod = cfg.frequency === "Monthly" ? 1 : cfg.frequency === "Quarterly" ? 3 : 12;
  const start = new Date();
  start.setUTCMonth(start.getUTCMonth() - limit * monthsPerPeriod);
  const params = new URLSearchParams({ series_id: cfg.seriesId, api_key: apiKey, file_type: "json" });
  // Annual series are short and sometimes sparse (a Gini survey every few years): always take the full history.
  if (cfg.frequency !== "Annual") params.set("observation_start", start.toISOString().slice(0, 10));
  if (cfg.aggregate) {
    params.set("frequency", cfg.frequency === "Monthly" ? "m" : cfg.frequency === "Quarterly" ? "q" : "a");
    params.set("aggregation_method", cfg.aggregate);
  }
  const res = await fetch(`https://api.stlouisfed.org/fred/series/observations?${params.toString()}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`FRED ${cfg.seriesId} -> HTTP ${res.status}`);
  const json: unknown = await res.json();
  const observations: unknown = typeof json === "object" && json !== null ? Reflect.get(json, "observations") : undefined;
  if (!Array.isArray(observations)) throw new Error(`FRED ${cfg.seriesId} returned no observations`);
  const points: SeriesPoint[] = [];
  for (const row of observations) {
    if (typeof row !== "object" || row === null) continue;
    const date = Reflect.get(row, "date"), raw = Reflect.get(row, "value");
    if (typeof date !== "string" || typeof raw !== "string" || raw === ".") continue;
    const value = Number(raw) * (cfg.scale ?? 1);
    if (!Number.isFinite(value)) continue;
    points.push({ date: fredPeriod(date, cfg.frequency), value: Math.round(value * 10000) / 10000 });
  }
  points.sort((a, b) => a.date.localeCompare(b.date));
  return {
    key, title: cfg.title, agency: cfg.agency,
    sourceUrl: `https://fred.stlouisfed.org/series/${cfg.seriesId}`,
    frequency: cfg.frequency, unit: cfg.unit, series: [{ label: cfg.label, points }],
  };
}

/** FRED dates a quarter by its first day; the store dates it by its last month, as NBS does. Years are "YYYY". */
function fredPeriod(date: string, frequency: FredIndicator["frequency"]): string {
  const year = date.slice(0, 4), month = Number(date.slice(5, 7));
  if (frequency === "Annual") return year;
  if (frequency === "Quarterly") return `${year}-${String(month + 2).padStart(2, "0")}`;
  return date.slice(0, 7);
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
  if (AKTOOLS_URL === "off") {
    throw new Error(`AKTools is not configured on this deployment; ${cfg.fn} serves from the stored copy until it is.`);
  }
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
  else if (cfg.kind === "fred") data = await fetchFred(key, cfg, limit);
  else if (cfg.regions) data = await fetchEastmoneyRegion(key, cfg, cfg.regionAverage ?? cfg.regions[0] ?? { text: "", value: "" }, limit);
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
  if (cfg && cfg.kind === "eastmoney" && cfg.regions) return (cfg.regionAverage ?? cfg.regions[0])?.value ?? "";
  return "";
}

/** What kind of place a regional series is split by. */
export function seriesGeography(key: string): "Province" | "City" {
  const cfg = CATALOG[key];
  return cfg && cfg.kind === "eastmoney" && cfg.regions ? "City" : "Province";
}

/** The regions a curated series is published for, or an empty list. */
export function seriesRegions(key: string): NbsRegion[] {
  const cfg = CATALOG[key];
  if (cfg && cfg.kind === "nbs" && cfg.regions) return cfg.regions;
  if (cfg && cfg.kind === "eastmoney" && cfg.regions) return cfg.regionAverage ? [cfg.regionAverage, ...cfg.regions] : cfg.regions;
  return [];
}

/**
 * Fetch one region of a multi-region curated series. The store keys these
 * by the NBS `das` code, the same convention as catalog series.
 */
export async function fetchLiveRegion(key: string, region: NbsRegion, limit = 120): Promise<SeriesResult | null> {
  const cfg = CATALOG[key];
  if (!cfg) return null;
  if (cfg.kind === "nbs") return fetchNbs(key, { ...cfg, region }, limit);
  if (cfg.kind === "eastmoney" && cfg.regions) return fetchEastmoneyRegion(key, cfg, region, limit);
  return null;
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
  if (cfg.kind === "fred") return fetchFred(key, cfg, limit);
  if (cfg.regions) return fetchEastmoneyRegion(key, cfg, cfg.regionAverage ?? cfg.regions[0] ?? { text: "", value: "" }, limit);
  return fetchEastmoney(key, cfg, limit);
}
