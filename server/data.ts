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

import { fetchJson } from "./http";
import { fetchCustomsRegion, type CustomsIndicator } from "./customs";
import { fetchCfets, type CfetsIndicator } from "./cfets";
import { fetchNea, neaLabels, type NeaIndicator } from "./nea";
import { fetchPboc, FLOW_COLUMNS, STOCK_ROWS, MONEY_ROWS, RESERVE_ROWS, CREDIT_ROWS, type PbocIndicator } from "./pboc";
import { fetchMof, mofLabels, type MofIndicator } from "./mof";
import { fetchSafe, BOP_ITEMS, FX_SETTLEMENT_ITEMS, type SafeIndicator } from "./safe";
import { fetchMofcom, mofcomLabels, type MofcomIndicator } from "./mofcom";

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
  cgb_yields: ["bond yields", "government bond yield", "10-year yield", "10y", "treasury yield", "yield curve", "cgb", "国债收益率", "十年期国债"],
  trade_partners: ["trade by country", "exports by country", "imports by country", "trade partners", "bilateral trade", "分国别", "国别贸易"],
  major_exports: ["exports by commodity", "major exports", "export commodities", "主要出口商品"],
  major_imports: ["imports by commodity", "major imports", "import commodities", "主要进口商品", "crude oil imports", "soybean imports", "iron ore imports"],
  consumer_confidence: ["consumer confidence", "sentiment", "消费者信心指数", "消费者信心"],
  enterprise_boom: ["business confidence", "enterprise boom", "企业景气指数", "景气"],
  tax_revenue: ["tax revenue", "taxes", "fiscal revenue", "税收收入", "税收"],
  forex_loans: ["foreign currency loans", "fx loans", "外汇贷款"],
  commodity_prices: ["commodity prices", "commodity price index", "ccpi", "大宗商品价格指数", "大宗商品"],
  gdp: ["gdp", "growth", "output", "national accounts", "国内生产总值", "经济增长"],
  provincial_gdp: ["guangdong", "provincial gdp", "regional gdp", "广东", "地区生产总值"],
  industrial_production: ["industrial production", "ip", "industry", "value added", "factory output", "工业增加值", "工业生产"],
  cpi: ["cpi", "inflation", "inflation rate", "consumer prices", "prices", "cost of living", "居民消费价格", "通胀", "物价"],
  ppi: ["ppi", "producer prices", "factory gate prices", "deflation", "工业生产者价格", "出厂价格"],
  unemployment: ["unemployment", "jobless", "joblessness", "youth unemployment", "labor market", "labour market", "employment", "失业率", "青年失业", "就业"],
  retail_sales: ["retail sales", "consumption", "consumer spending", "shopping", "社会消费品零售", "社零", "消费"],
  money_supply: ["money supply", "m1", "m2", "liquidity", "broad money", "货币供应量", "广义货币"],
  new_loans: ["new loans", "credit", "bank lending", "yuan loans", "新增贷款", "人民币贷款", "信贷"],
  trade: ["trade", "exports", "imports", "trade balance", "customs", "进出口", "出口", "进口", "贸易"],
  forex_reserves: ["forex reserves", "foreign exchange reserves", "fx reserves", "外汇储备"],
  gold_reserves: ["gold reserves", "gold", "pboc gold", "黄金储备", "黄金"],
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
  us_imports_from_china: ["us imports", "trade war", "tariffs", "美国进口", "united states", "america", "imports from china", "china exports to us", "exports to us", "exports to the united states", "exports to america", "对美出口"],
  us_exports_to_china: ["us exports", "soybeans", "trade war", "美国出口", "united states", "america", "exports to china", "china imports from us", "imports from us", "imports from the united states", "imports from america", "自美进口"],
  us_treasury_holdings: ["treasuries", "treasury holdings", "us debt", "美债", "united states", "america"],
  us_import_prices_china: ["import prices", "tariffs", "进口价格"],
  golden_dragon: ["stocks", "adr", "nasdaq", "equities", "中概股"],
  population: ["population", "demographics", "人口"],
  fertility: ["fertility", "births", "demographics", "生育率"],
  population_65: ["ageing", "aging", "elderly", "demographics", "老龄化"],
  life_expectancy: ["life expectancy", "demographics", "预期寿命"],
  gdp_usd: ["gdp dollars", "nominal gdp", "world bank", "美元gdp"],
  gdp_per_capita_usd: ["gdp per capita", "income per head", "人均gdp"],
  gini: ["inequality", "gini", "基尼系数"],
  lpr: ["lpr", "loan prime rate", "interest rate", "policy rate", "benchmark rate", "mortgage rate", "mortgage", "贷款市场报价利率", "利率", "房贷利率"],
};

// ── Catalog ───────────────────────────────────────────────────────────────────

interface EastmoneyField {
  field: string;
  label: string;
  /** Added to every value: an index where last year = 100 becomes a % change with -100. */
  valueOffset?: number;
  /**
   * NBS publishes January and February of the activity series together, and
   * Eastmoney leaves the February row's monthly column empty with the
   * combined figure in the year-to-date column. Named here, that column
   * fills the February point; January stays absent, as published.
   */
  januaryFebruaryField?: string;
}

/** The value a row holds for a field, taking the combined January-February figure for an empty February. */
export function eastmoneyValue(row: Record<string, unknown>, field: EastmoneyField, month: string): unknown {
  const primary = row[field.field];
  const empty = primary === null || primary === undefined || primary === "";
  if (empty && field.januaryFebruaryField && month.endsWith("-02")) return row[field.januaryFebruaryField];
  return primary;
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
  /** Day of the month by which the publisher's release is out, when it is not NBS's 20th (server/due.ts). */
  releaseDay?: number;
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
  /**
   * NBS publishes January and February of the activity series together, so
   * the monthly indicator has no February value. Named here, the year-to-date
   * growth indicator of the same table (whose February value is that combined
   * figure) fills the February point; January stays absent, as published.
   */
  januaryFebruaryId?: string;
}

type NbsPeriodValue = { _id?: string; da?: string; value?: unknown };

/** The value an indicator holds for one period, taking the combined January-February figure for an empty February. */
export function nbsPeriodValue(values: NbsPeriodValue[], idcfg: NbsSeriesId, regionValue: string, date: string): unknown {
  const pick = (id: string) => values.find((value) => value._id === id && (value.da === undefined || value.da === regionValue))?.value;
  const primary = pick(idcfg.id);
  const empty = primary === null || primary === undefined || primary === "";
  if (empty && idcfg.januaryFebruaryId && date.endsWith("-02")) return pick(idcfg.januaryFebruaryId);
  return primary;
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
  /**
   * Earlier year slices of the same table under other cids (the bureau splits
   * some tables by year range). Each is fetched with the same limit and
   * merged behind the main table by label; the main table wins on overlap.
   */
  slices?: { cid: string; rootId?: string; ids: NbsSeriesId[] }[];
  /** What the regions are, when not provinces: the 70-city table is by city. */
  geography?: "City";
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
type Indicator = EastmoneyIndicator | NbsIndicator | AktoolsIndicator | FredIndicator | CustomsIndicator | CfetsIndicator | NeaIndicator | PbocIndicator | MofIndicator | SafeIndicator | MofcomIndicator;

// AKTOOLS_URL=off says a deployment has no AKTools at all, so the AkShare
// series serve from the store and their refresh is skipped with a plain
// message — rather than probing localhost, which on a platform that puts
// this very app on :8080 answers 404 and reads like a mystery.
function aktoolsUrl(): string { return process.env.AKTOOLS_URL ?? "http://127.0.0.1:8080"; }

/** False when the deployment has said it has no AKTools, so callers can skip AkShare series instead of failing on them. */
export function aktoolsConfigured(): boolean { return aktoolsUrl() !== "off"; }

function nbsProvince(text: string, gbt2260: string): NbsRegion {
  return { text, value: gbt2260.padEnd(12, "0") };
}

const GUANGDONG = nbsProvince("广东省", "440000");

// NBS `das` values are the six-digit GB/T 2260 province code followed by six
// zeroes. Three live captures (Beijing, Shanghai, and Guangdong) confirmed the
// format. Keep the complete mainland province-level mapping here so additional
// regional series can be added without another round of code discovery.
/** The partners and blocs in Customs' monthly by-country table, as published in August 2026. */
export const CUSTOMS_PARTNERS: NbsRegion[] = [
  { text: "Total", value: "total", en: "Total" },
  { text: "European Union", value: "european-union", en: "European Union" },
  { text: "Germany", value: "germany", en: "Germany" },
  { text: "Netherlands", value: "netherlands", en: "Netherlands" },
  { text: "France", value: "france", en: "France" },
  { text: "Italy", value: "italy", en: "Italy" },
  { text: "United States", value: "united-states", en: "United States" },
  { text: "ASEAN", value: "asean", en: "ASEAN" },
  { text: "Vietnam", value: "vietnam", en: "Vietnam" },
  { text: "Malaysia", value: "malaysia", en: "Malaysia" },
  { text: "Thailand", value: "thailand", en: "Thailand" },
  { text: "Singapore", value: "singapore", en: "Singapore" },
  { text: "Indonesia", value: "indonesia", en: "Indonesia" },
  { text: "Philippines", value: "philippines", en: "Philippines" },
  { text: "Japan", value: "japan", en: "Japan" },
  { text: "Hong Kong, China", value: "hong-kong-china", en: "Hong Kong, China" },
  { text: "R. O. Korea", value: "r-o-korea", en: "R. O. Korea" },
  { text: "Taiwan, China", value: "taiwan-china", en: "Taiwan, China" },
  { text: "Australia", value: "australia", en: "Australia" },
  { text: "Russian Federation", value: "russian-federation", en: "Russian Federation" },
  { text: "India", value: "india", en: "India" },
  { text: "United Kingdom", value: "united-kingdom", en: "United Kingdom" },
  { text: "Canada", value: "canada", en: "Canada" },
  { text: "New Zealand", value: "new-zealand", en: "New Zealand" },
  { text: "Latin America", value: "latin-america", en: "Latin America" },
  { text: "Brazil", value: "brazil", en: "Brazil" },
  { text: "Africa", value: "africa", en: "Africa" },
  { text: "South Africa", value: "south-africa", en: "South Africa" },
  { text: "Regional Comprehensive Economic Partnership", value: "regional-comprehensive-economic-partnership", en: "Regional Comprehensive Economic Partnership" },
  { text: "Jointly build the countries along Belt and Road Routes", value: "jointly-build-the-countries-along-belt-and-road-routes", en: "Jointly build the countries along Belt and Road Routes" },
];

/** The commodities in Customs' major exports table. */
export const CUSTOMS_EXPORT_COMMODITIES: NbsRegion[] = [
  { text: "Agriculture products*", value: "agriculture-products", en: "Agriculture products*" },
  { text: "Aquatic products", value: "aquatic-products", en: "Aquatic products" },
  { text: "Grain food", value: "grain-food", en: "Grain food" },
  { text: "Refined petroleum products", value: "refined-petroleum-products", en: "Refined petroleum products" },
  { text: "Rare-earth ore, metals, compounds", value: "rare-earth-ore-metals-compounds", en: "Rare-earth ore, metals, compounds" },
  { text: "Medical and pharmaceutical products", value: "medical-and-pharmaceutical-products", en: "Medical and pharmaceutical products" },
  { text: "Fertilizers", value: "fertilizers", en: "Fertilizers" },
  { text: "Plastic articles", value: "plastic-articles", en: "Plastic articles" },
  { text: "Suit-cases, hand bags and similar containers", value: "suit-cases-hand-bags-and-similar-containers", en: "Suit-cases, hand bags and similar containers" },
  { text: "Textile yarn, fabrics and articles thereof", value: "textile-yarn-fabrics-and-articles-thereof", en: "Textile yarn, fabrics and articles thereof" },
  { text: "Garments and clothing accessories", value: "garments-and-clothing-accessories", en: "Garments and clothing accessories" },
  { text: "Footwear", value: "footwear", en: "Footwear" },
  { text: "Ceramic products", value: "ceramic-products", en: "Ceramic products" },
  { text: "Products, of steel or iron", value: "products-of-steel-or-iron", en: "Products, of steel or iron" },
  { text: "Unwrought aluminium and aluminium products", value: "unwrought-aluminium-and-aluminium-products", en: "Unwrought aluminium and aluminium products" },
  { text: "Furniture and parts thereof", value: "furniture-and-parts-thereof", en: "Furniture and parts thereof" },
  { text: "Toys", value: "toys", en: "Toys" },
  { text: "Mechanical and electrical products *", value: "mechanical-and-electrical-products", en: "Mechanical and electrical products *" },
  { text: "General machines", value: "general-machines", en: "General machines" },
  { text: "Automatic data processing machines and parts thereof", value: "automatic-data-processing-machines-and-parts-thereof", en: "Automatic data processing machines and parts thereof" },
  { text: "Mobile phones", value: "mobile-phones", en: "Mobile phones" },
  { text: "Electric appliances of household type", value: "electric-appliances-of-household-type", en: "Electric appliances of household type" },
  { text: "Audio or video devices and parts thereof", value: "audio-or-video-devices-and-parts-thereof", en: "Audio or video devices and parts thereof" },
  { text: "Electronic integrated circuits", value: "electronic-integrated-circuits", en: "Electronic integrated circuits" },
  { text: "Motor vehicles（including chassis fitted with engines)", value: "motor-vehicles-including-chassis-fitted-with-engines", en: "Motor vehicles（including chassis fitted with engines)" },
  { text: "Parts and accessories of vehicle", value: "parts-and-accessories-of-vehicle", en: "Parts and accessories of vehicle" },
  { text: "Ships", value: "ships", en: "Ships" },
  { text: "Flat panel display modules of liquid crystals", value: "flat-panel-display-modules-of-liquid-crystals", en: "Flat panel display modules of liquid crystals" },
  { text: "Medical or surgical instruments and apparatuses", value: "medical-or-surgical-instruments-and-apparatuses", en: "Medical or surgical instruments and apparatuses" },
  { text: "Lamps and lighting fittings and parts thereof", value: "lamps-and-lighting-fittings-and-parts-thereof", en: "Lamps and lighting fittings and parts thereof" },
  { text: "Hi-tech products*", value: "hi-tech-products", en: "Hi-tech products*" },
];

/** The commodities in Customs' major imports table. */
export const CUSTOMS_IMPORT_COMMODITIES: NbsRegion[] = [
  { text: "Agriculture products*", value: "agriculture-products", en: "Agriculture products*" },
  { text: "Meat(including  meat offal)", value: "meat-including-meat-offal", en: "Meat(including  meat offal)" },
  { text: "Fresh or dried fruit and nuts", value: "fresh-or-dried-fruit-and-nuts", en: "Fresh or dried fruit and nuts" },
  { text: "Grain food", value: "grain-food", en: "Grain food" },
  { text: "Soya beans", value: "soya-beans", en: "Soya beans" },
  { text: "Edible vegetable oil", value: "edible-vegetable-oil", en: "Edible vegetable oil" },
  { text: "Iron ores and concentrates", value: "iron-ores-and-concentrates", en: "Iron ores and concentrates" },
  { text: "Copper ores and concentrates", value: "copper-ores-and-concentrates", en: "Copper ores and concentrates" },
  { text: "Coal and lignite", value: "coal-and-lignite", en: "Coal and lignite" },
  { text: "Crude petroleum oils", value: "crude-petroleum-oils", en: "Crude petroleum oils" },
  { text: "Refined petroleum products", value: "refined-petroleum-products", en: "Refined petroleum products" },
  { text: "Natural gases", value: "natural-gases", en: "Natural gases" },
  { text: "Rare-earth ore, metals, compounds", value: "rare-earth-ore-metals-compounds", en: "Rare-earth ore, metals, compounds" },
  { text: "Medicinal materials and pharmaceutical products", value: "medicinal-materials-and-pharmaceutical-products", en: "Medicinal materials and pharmaceutical products" },
  { text: "Fertilizers", value: "fertilizers", en: "Fertilizers" },
  { text: "Make-ups or personal care and toiletries", value: "make-ups-or-personal-care-and-toiletries", en: "Make-ups or personal care and toiletries" },
  { text: "Plastics in primary forms", value: "plastics-in-primary-forms", en: "Plastics in primary forms" },
  { text: "Natural and synthetic rubber(including Latex)", value: "natural-and-synthetic-rubber-including-latex", en: "Natural and synthetic rubber(including Latex)" },
  { text: "Wood Logs and Lumber", value: "wood-logs-and-lumber", en: "Wood Logs and Lumber" },
  { text: "Paper pulp", value: "paper-pulp", en: "Paper pulp" },
  { text: "Textile yarn, fabrics and articles thereof", value: "textile-yarn-fabrics-and-articles-thereof", en: "Textile yarn, fabrics and articles thereof" },
  { text: "Products, of steel or iron", value: "products-of-steel-or-iron", en: "Products, of steel or iron" },
  { text: "Unwrought copper and copper products", value: "unwrought-copper-and-copper-products", en: "Unwrought copper and copper products" },
  { text: "Mechanical and electrical products *", value: "mechanical-and-electrical-products", en: "Mechanical and electrical products *" },
  { text: "Machine tools", value: "machine-tools", en: "Machine tools" },
  { text: "Automatic data processing machines and parts thereof", value: "automatic-data-processing-machines-and-parts-thereof", en: "Automatic data processing machines and parts thereof" },
  { text: "Diodes and similar semiconductors", value: "diodes-and-similar-semiconductors", en: "Diodes and similar semiconductors" },
  { text: "Electronic integrated circuits", value: "electronic-integrated-circuits", en: "Electronic integrated circuits" },
  { text: "Motor vehicles（including chassis fitted with engines)", value: "motor-vehicles-including-chassis-fitted-with-engines", en: "Motor vehicles（including chassis fitted with engines)" },
  { text: "Parts and accessories of vehicle", value: "parts-and-accessories-of-vehicle", en: "Parts and accessories of vehicle" },
  { text: "Aircraft of an unladen weight exceeding 2T", value: "aircraft-of-an-unladen-weight-exceeding-2t", en: "Aircraft of an unladen weight exceeding 2T" },
  { text: "Flat panel display modules of liquid crystals", value: "flat-panel-display-modules-of-liquid-crystals", en: "Flat panel display modules of liquid crystals" },
  { text: "Medical or surgical instruments and apparatuses", value: "medical-or-surgical-instruments-and-apparatuses", en: "Medical or surgical instruments and apparatuses" },
  { text: "Hi-tech products*", value: "hi-tech-products", en: "Hi-tech products*" },
];

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
/** The 70 cities of NBS's house-price table, by the bureau's own codes, as its region catalog lists them. */
export const CITIES_70_NBS: NbsRegion[] = [
  { text: "北京", value: "110000000000", en: "Beijing" },
  { text: "天津", value: "120000000000", en: "Tianjin" },
  { text: "石家庄", value: "130100000000", en: "Shijiazhuang" },
  { text: "唐山", value: "130200000000", en: "Tangshan" },
  { text: "秦皇岛", value: "130300000000", en: "Qinhuangdao" },
  { text: "太原", value: "140100000000", en: "Taiyuan" },
  { text: "呼和浩特", value: "150100000000", en: "Hohhot" },
  { text: "包头", value: "150200000000", en: "Baotou" },
  { text: "沈阳", value: "210100000000", en: "Shenyang" },
  { text: "大连", value: "210200000000", en: "Dalian" },
  { text: "丹东", value: "210600000000", en: "Dandong" },
  { text: "锦州", value: "210700000000", en: "Jinzhou" },
  { text: "长春", value: "220100000000", en: "Changchun" },
  { text: "吉林", value: "220200000000", en: "Jilin" },
  { text: "哈尔滨", value: "230100000000", en: "Harbin" },
  { text: "牡丹江", value: "231000000000", en: "Mudanjiang" },
  { text: "上海", value: "310000000000", en: "Shanghai" },
  { text: "南京", value: "320100000000", en: "Nanjing" },
  { text: "无锡", value: "320200000000", en: "Wuxi" },
  { text: "徐州", value: "320300000000", en: "Xuzhou" },
  { text: "扬州", value: "321000000000", en: "Yangzhou" },
  { text: "杭州", value: "330100000000", en: "Hangzhou" },
  { text: "宁波", value: "330200000000", en: "Ningbo" },
  { text: "温州", value: "330300000000", en: "Wenzhou" },
  { text: "金华", value: "330700000000", en: "Jinhua" },
  { text: "合肥", value: "340100000000", en: "Hefei" },
  { text: "蚌埠", value: "340300000000", en: "Bengbu" },
  { text: "安庆", value: "340800000000", en: "Anqing" },
  { text: "福州", value: "350100000000", en: "Fuzhou" },
  { text: "厦门", value: "350200000000", en: "Xiamen" },
  { text: "泉州", value: "350500000000", en: "Quanzhou" },
  { text: "南昌", value: "360100000000", en: "Nanchang" },
  { text: "九江", value: "360400000000", en: "Jiujiang" },
  { text: "赣州", value: "360700000000", en: "Ganzhou" },
  { text: "济南", value: "370100000000", en: "Jinan" },
  { text: "青岛", value: "370200000000", en: "Qingdao" },
  { text: "烟台", value: "370600000000", en: "Yantai" },
  { text: "济宁", value: "370800000000", en: "Jining" },
  { text: "郑州", value: "410100000000", en: "Zhengzhou" },
  { text: "洛阳", value: "410300000000", en: "Luoyang" },
  { text: "平顶山", value: "410400000000", en: "Pingdingshan" },
  { text: "武汉", value: "420100000000", en: "Wuhan" },
  { text: "宜昌", value: "420500000000", en: "Yichang" },
  { text: "襄阳", value: "420600000000", en: "Xiangyang" },
  { text: "长沙", value: "430100000000", en: "Changsha" },
  { text: "岳阳", value: "430600000000", en: "Yueyang" },
  { text: "常德", value: "430700000000", en: "Changde" },
  { text: "广州", value: "440100000000", en: "Guangzhou" },
  { text: "韶关", value: "440200000000", en: "Shaoguan" },
  { text: "深圳", value: "440300000000", en: "Shenzhen" },
  { text: "湛江", value: "440800000000", en: "Zhanjiang" },
  { text: "惠州", value: "441300000000", en: "Huizhou" },
  { text: "南宁", value: "450100000000", en: "Nanning" },
  { text: "桂林", value: "450300000000", en: "Guilin" },
  { text: "北海", value: "450500000000", en: "Beihai" },
  { text: "海口", value: "460100000000", en: "Haikou" },
  { text: "三亚", value: "460200000000", en: "Sanya" },
  { text: "重庆", value: "500000000000", en: "Chongqing" },
  { text: "成都", value: "510100000000", en: "Chengdu" },
  { text: "泸州", value: "510500000000", en: "Luzhou" },
  { text: "南充", value: "511300000000", en: "Nanchong" },
  { text: "贵阳", value: "520100000000", en: "Guiyang" },
  { text: "遵义", value: "520300000000", en: "Zunyi" },
  { text: "昆明", value: "530100000000", en: "Kunming" },
  { text: "大理", value: "532900000000", en: "Dali" },
  { text: "拉萨", value: "540100000000", en: "Lhasa" },
  { text: "西安", value: "610100000000", en: "Xi'an" },
  { text: "兰州", value: "620100000000", en: "Lanzhou" },
  { text: "西宁", value: "630100000000", en: "Xining" },
  { text: "银川", value: "640100000000", en: "Yinchuan" },
  { text: "乌鲁木齐", value: "650100000000", en: "Urumqi" },
];

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
    kind: "nbs", group: "Growth & Output",
    title: "Gross Domestic Product", agency: "National Bureau of Statistics",
    frequency: "Quarterly", unit: "Percent change from year ago",
    // NBS publishes two rates for every quarter: the quarter's own growth
    // (当季) and growth for the year so far (累计). Q2 2026 was 4.3 on the first
    // and 4.7 on the second, and the site showed the second under a quarterly
    // label until 15 September 2026 — the Eastmoney mirror's row is the
    // cumulative one. Both are served now, from NBS's own index table, and
    // the quarterly rate leads.
    cid: "f9b694c9b79e4ce5958bc88c6410fa67",
    rootId: "a94b8b7365a94874968cabbe392cf679",
    ids: [
      { id: "170e7f00f8c24ede863c0526b42ae81f", valueOffset: -100, label: "Real GDP, quarter (YoY %)" },
      { id: "f5b82b2b6ad345a29a337d256a9d5ded", valueOffset: -100, label: "Real GDP, year to date (YoY %)" },
    ],
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
  fai: {
    kind: "nbs", group: "Growth & Output",
    title: "Fixed-Asset Investment Growth, Year to Date", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Percent change from year ago, cumulative year to date",
    // NBS's monthly 固定资产投资 (不含农户) release: cumulative for the year, as the bureau publishes it, with private investment and the three sectors.
    cid: "5129067b149d4ddfbec1ffc478d35bfb",
    rootId: "fc982599aa684be7969d7b90b1bd0e84",
    ids: [
      { id: "7e570cf8071c4734a7d78d9f0a70fbe1", label: "Fixed-asset investment, year to date (YoY %)" },
      { id: "287f55a9520d43a9b3e045860a49fedd", label: "Private investment, year to date (YoY %)" },
      { id: "14f9561997d84321bd606c97977086bb", label: "Primary industry, year to date (YoY %)" },
      { id: "92f72710d3ec46e79c6cb0e647a7fa91", label: "Secondary industry, year to date (YoY %)" },
      { id: "eea023b7fb454ae6aebcf1aefe50a936", label: "Tertiary industry, year to date (YoY %)" },
    ],
  },
  fai_by_industry: {
    kind: "nbs", group: "Growth & Output",
    title: "Fixed-Asset Investment Growth by Industry, Year to Date", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Percent change from year ago, cumulative year to date",
    // The by-industry table from 2018 (按行业分固定资产投资增速): manufacturing, the industries the bureau's infrastructure aggregate is built from, and real estate. NBS publishes the infrastructure total in its release only.
    cid: "9002859582574437a91914e0fd50166b",
    rootId: "fc982599aa684be7969d7b90b1bd0e84",
    ids: [
      { id: "d17718248ba14e2ba7b34d39623001ea", label: "Manufacturing, year to date (YoY %)" },
      { id: "26b38c5d662141f0a25aa3356d643270", label: "Mining, year to date (YoY %)" },
      { id: "1a9363c7fb9749e1b636b8fdc2fe18c8", label: "Utilities, year to date (YoY %)" },
      { id: "3cb0a5dc9962464591298ad9cb1b80cd", label: "Railways, year to date (YoY %)" },
      { id: "bcaa12f2ee2840f2ae93f8b22949e223", label: "Roads, year to date (YoY %)" },
      { id: "784615682a034f0cb873b015363e1ef4", label: "Water, environment and public facilities, year to date (YoY %)" },
      { id: "30401aeb07b24782bf0e0d0c632a8557", label: "Real estate industry, year to date (YoY %)" },
    ],
  },
  fai_funding: {
    kind: "nbs", group: "Growth & Output", home: false,
    title: "Fixed-Asset Investment Funding Growth, Year to Date", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Percent change from year ago, cumulative year to date",
    // 固定资产投资 (不含农户) 资金来源: funds in place by source, cumulative for the year.
    cid: "88077f9647ef499bac2e2e3350e3bab1",
    rootId: "fc982599aa684be7969d7b90b1bd0e84",
    ids: [
      { id: "8d8010b8c1ba4dff88b0a9879b05ca27", label: "Funds in place, year to date (YoY %)" },
      { id: "61d05768ca154935aa6727aa94960a2e", label: "State budget, year to date (YoY %)" },
      { id: "13acfad5d58e40448b80bdd04d8ad914", label: "Domestic loans, year to date (YoY %)" },
      { id: "7be5959c551e48deaaf2693e79291ed8", label: "Self-raised, year to date (YoY %)" },
    ],
  },
  industrial_profits: {
    kind: "nbs", group: "Growth & Output",
    title: "Industrial Profits Growth, Year to Date", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Percent change from year ago, cumulative year to date",
    // 工业企业利润总额 of industrial enterprises above designated size, cumulative for the year, from the by-industry table from 2018; published around the 27th, a week after the monthly bundle.
    cid: "643feccdedb64e38a64c65a00c390646",
    rootId: "fc982599aa684be7969d7b90b1bd0e84",
    ids: [
      { id: "9d63a27d727d4beeb32529078442cdd4", label: "Industrial profits, year to date (YoY %)" },
      { id: "9a63bcb58c934cb2928861637d30303b", label: "Manufacturing, year to date (YoY %)" },
      { id: "22d587f435aa479bb6592474253763d5", label: "Mining, year to date (YoY %)" },
      { id: "b30af79333c649e58091bd1c65d55d95", label: "Utilities, year to date (YoY %)" },
    ],
  },
  industrial_profits_value: {
    kind: "nbs", group: "Growth & Output", home: false,
    title: "Industrial Profits, Year to Date", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Hundred million yuan (亿元), cumulative year to date",
    // The levels behind industrial_profits.
    cid: "643feccdedb64e38a64c65a00c390646",
    rootId: "fc982599aa684be7969d7b90b1bd0e84",
    ids: [
      { id: "e965cb01ee2c4115b2bc9fafe227edf3", label: "Industrial profits, year to date" },
      { id: "0aed58c938af45b2830a01fea8ebeb84", label: "Manufacturing, year to date" },
    ],
  },
  capacity_utilisation: {
    kind: "nbs", group: "Growth & Output",
    title: "Industrial Capacity Utilisation", agency: "National Bureau of Statistics",
    frequency: "Quarterly", unit: "Percent",
    // 工业产能利用率, the quarter's rate, for industry and its three divisions.
    cid: "56a7def4ab0749d8800eab2415f90b54",
    rootId: "a94b8b7365a94874968cabbe392cf679",
    ids: [
      { id: "57ae79552303418087eee8f4f35b4368", label: "Industry, quarter (%)" },
      { id: "b26d4afe7263486a8573e2d4f55b2f65", label: "Manufacturing, quarter (%)" },
      { id: "f03e03480beb44999f818a3c4e80b946", label: "Mining, quarter (%)" },
      { id: "8a44b35754164b1e8ce44f2c0135402f", label: "Utilities, quarter (%)" },
    ],
  },
  output_crude_steel: {
    kind: "nbs", group: "Growth & Output",
    title: "Crude Steel Output Growth", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Percent change from year ago",
    // 粗钢产量: the month against a year earlier, and the year to date.
    cid: "c72e324de29447e1a6917acd99c2d5ac",
    rootId: "fc982599aa684be7969d7b90b1bd0e84",
    ids: [
      { id: "1e7dfadac47f4d04b403d8f4f7516c4b", label: "Crude steel, month (YoY %)" },
      { id: "7b9be081b7ca4bfdb4c4518a045d8200", label: "Crude steel, year to date (YoY %)" },
    ],
  },
  output_cement: {
    kind: "nbs", group: "Growth & Output", home: false,
    title: "Cement Output Growth", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Percent change from year ago",
    // 水泥产量.
    cid: "266c750660954ea088db882a78103733",
    rootId: "fc982599aa684be7969d7b90b1bd0e84",
    ids: [
      { id: "924d365b0a614637852fa5ae1369060d", label: "Cement, month (YoY %)" },
      { id: "cff8b434fb7e49eda4b84562e9b9845d", label: "Cement, year to date (YoY %)" },
    ],
  },
  output_autos: {
    kind: "nbs", group: "Growth & Output",
    title: "Automobile Output Growth", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Percent change from year ago",
    // 汽车产量.
    cid: "508bcbda312b4b1d9a6aba48f6c5c7eb",
    rootId: "fc982599aa684be7969d7b90b1bd0e84",
    ids: [
      { id: "7cee2fa00ab44628a8da9118642f8170", label: "Automobiles, month (YoY %)" },
      { id: "7c6b838fcdc044acbe160b0ef7738773", label: "Automobiles, year to date (YoY %)" },
    ],
  },
  output_nev: {
    kind: "nbs", group: "Growth & Output", home: false,
    title: "New Energy Vehicle Output Growth", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Percent change from year ago",
    // 新能源汽车产量.
    cid: "8dedd34d41004a03ae790313a34cb27f",
    rootId: "fc982599aa684be7969d7b90b1bd0e84",
    ids: [
      { id: "bbb7c09f8de148b0a7887aea97ec9a34", label: "New energy vehicles, month (YoY %)" },
      { id: "aa28390d65e34e44b9ed3943c80cf047", label: "New energy vehicles, year to date (YoY %)" },
    ],
  },
  output_ics: {
    kind: "nbs", group: "Growth & Output", home: false,
    title: "Integrated Circuit Output Growth", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Percent change from year ago",
    // 集成电路产量.
    cid: "decec4300f1249e89e409a64ac403ad8",
    rootId: "fc982599aa684be7969d7b90b1bd0e84",
    ids: [
      { id: "b262ee8b3a254edeb9c81487477d9eff", label: "Integrated circuits, month (YoY %)" },
      { id: "97d00fbc4bc34f0896bb6b6285d935f4", label: "Integrated circuits, year to date (YoY %)" },
    ],
  },
  industrial_production: {
    kind: "eastmoney", group: "Growth & Output",
    title: "Industrial Production (Value-Added, Large Firms)", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Percent change from year ago",
    reportName: "RPT_ECONOMY_INDUS_GROW",
    fields: [{ field: "BASE_SAME", januaryFebruaryField: "BASE_ACCUMULATE", label: "Industrial production (YoY %)" }],
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
  cpi_detail: {
    kind: "nbs", group: "Prices",
    title: "Consumer Price Index by Category", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Percent change from year ago",
    // NBS's 居民消费价格分类指数, each index on the same month a year earlier = 100, served as the change: core (excluding food and energy), food, tobacco and dining out, non-food, consumer goods, services, housing. The table is a 2026 slice; the 2021-2025 table is stitched behind it as a slice.
    cid: "5c7452825c7c4dcba391db5ca7f335c5",
    rootId: "fc982599aa684be7969d7b90b1bd0e84",
    ids: [
      { id: "71be3d43d2fb44188199840272463ae0", valueOffset: -100, label: "Core CPI, excluding food and energy (YoY %)" },
      { id: "42c2d9b5d1b749c4b68c2cbd2e3d4a42", valueOffset: -100, label: "Food, tobacco and dining out (YoY %)" },
      { id: "f91a869a255949ccba0cd73cfa871340", valueOffset: -100, label: "Non-food (YoY %)" },
      { id: "61a170ad7fa44fa4b2ff60fd708e516e", valueOffset: -100, label: "Consumer goods (YoY %)" },
      { id: "c87191b714554e9eba8c2c062abfabb4", valueOffset: -100, label: "Services (YoY %)" },
      { id: "4fb7ea343fc7403bb412cf48fb2f3f0e", valueOffset: -100, label: "Housing (YoY %)" },
    ],
    slices: [{ cid: "809d2522b0fe4be89142650341b19083", rootId: "fc982599aa684be7969d7b90b1bd0e84", ids: [
      { id: "c2050e97c49a4763a6d0f0f38bf0b4ed", valueOffset: -100, label: "Core CPI, excluding food and energy (YoY %)" },
      { id: "fce9ac527a74442ea0031eb6b37f52ad", valueOffset: -100, label: "Food, tobacco and dining out (YoY %)" },
      { id: "728da4f1859140139194110824b700e1", valueOffset: -100, label: "Non-food (YoY %)" },
      { id: "24371d6f24ce4f11921cb6194bb1e96b", valueOffset: -100, label: "Consumer goods (YoY %)" },
      { id: "e330ad10ab224cfda1f25db93bf04d01", valueOffset: -100, label: "Services (YoY %)" },
      { id: "e492fe37645349f0a1c84d96174bf606", valueOffset: -100, label: "Housing (YoY %)" },
    ] }],
  },
  ppi_detail: {
    kind: "nbs", group: "Prices",
    title: "Producer Price Index by Stage", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Percent change from year ago",
    // Off the Home list: its first line is the headline PPI, which has its own row there.
    home: false,
    // NBS's 工业生产者出厂价格分类指数: the headline beside producer goods (生产资料) and consumer goods (生活资料), each on a year earlier = 100, served as the change.
    cid: "60e8b361f11c4a878c652a6487a25561",
    rootId: "fc982599aa684be7969d7b90b1bd0e84",
    ids: [
      { id: "150633e52b9a470a9a9fd1b296dd6c5b", valueOffset: -100, label: "PPI (YoY %)" },
      { id: "47f8464961184392bc4f6a4b8e5b1cb5", valueOffset: -100, label: "Producer goods (YoY %)" },
      { id: "649b27dbffb14466a3f204e16f3c74ed", valueOffset: -100, label: "Consumer goods (YoY %)" },
    ],
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
    fields: [{ field: "RETAIL_TOTAL_SAME", januaryFebruaryField: "RETAIL_ACCUMULATE_SAME", label: "Retail sales (YoY %)" }],
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
  tsf_flow: {
    kind: "pboc", group: "Money & Credit",
    title: "Aggregate Financing to the Real Economy (Flow)", agency: "People's Bank of China",
    frequency: "Monthly", unit: "Hundred million yuan (亿元)",
    // The bank's 社会融资规模增量 table, the month's new financing by instrument.
    table: "flow",
    instruments: FLOW_COLUMNS.filter((column) => !/Asset-backed|written off/.test(column.label)),
    releaseDay: 15, // the bank's monthly financial statistics, the 10th to the 15th
  },
  tsf_stock: {
    kind: "pboc", group: "Money & Credit", home: false,
    title: "Aggregate Financing to the Real Economy (Stock)", agency: "People's Bank of China",
    frequency: "Monthly", unit: "Trillion yuan (万亿元)",
    table: "stock",
    instruments: STOCK_ROWS.filter((row) => /^(Total|RMB loans|Government bonds|Corporate bonds)$/.test(row.label)),
    releaseDay: 15,
  },
  tsf_stock_growth: {
    kind: "pboc", group: "Money & Credit",
    title: "Aggregate Financing Stock Growth", agency: "People's Bank of China",
    frequency: "Monthly", unit: "Percent change from year ago",
    // The growth the bank prints beside each month's stock, on a year earlier.
    table: "stock_growth",
    instruments: STOCK_ROWS.filter((row) => /^(Total|RMB loans|Government bonds|Corporate bonds)$/.test(row.label)),
    releaseDay: 15,
  },
  money_stock: {
    kind: "pboc", group: "Money & Credit", home: false,
    title: "Money Stock (M0 / M1 / M2)", agency: "People's Bank of China",
    frequency: "Monthly", unit: "Hundred million yuan (亿元)",
    // The bank's 货币供应量 table: month-end levels. M1 is on the definition the
    // bank adopted for January 2025 data.
    table: "money", instruments: MONEY_ROWS,
    releaseDay: 15,
  },
  money_stock_growth: {
    kind: "pboc", group: "Money & Credit", home: false,
    title: "Money Stock Growth (M0 / M1 / M2), computed", agency: "People's Bank of China",
    frequency: "Monthly", unit: "Percent change from year ago, computed from the bank's month-end levels",
    // The bank prints levels only in this table; the rate here is computed from
    // them to one decimal, and the audit holds it against the rate the bank
    // publishes in its release (money_supply, via the mirror).
    table: "money_growth", instruments: MONEY_ROWS,
    releaseDay: 15,
  },
  official_reserves: {
    kind: "pboc", group: "Trade & External", home: false,
    title: "Official Reserve Assets", agency: "People's Bank of China",
    frequency: "Monthly", unit: "Hundred million USD (亿美元)",
    // The bank's 官方储备资产 table: foreign currency reserves, gold, SDRs, the
    // IMF position and the total, month-end, in dollars (the SDR column is not taken).
    table: "reserves", instruments: RESERVE_ROWS,
    releaseDay: 7,
  },
  bank_credit: {
    kind: "pboc", group: "Money & Credit", home: false,
    title: "Deposits and Loans of Financial Institutions (RMB)", agency: "People's Bank of China",
    frequency: "Monthly", unit: "Hundred million yuan (亿元)",
    // 金融机构人民币信贷收支表: month-end stocks of deposits and loans.
    table: "credit", instruments: CREDIT_ROWS,
    releaseDay: 15,
  },
  new_loans: {
    kind: "eastmoney", group: "Money & Credit",
    title: "New Yuan Loans (Monthly Flow)", agency: "People's Bank of China",
    frequency: "Monthly", unit: "Hundred million yuan (亿元)",
    reportName: "RPT_ECONOMY_RMB_LOAN",
    fields: [{ field: "RMB_LOAN", label: "New RMB loans (100M yuan)" }],
  },
  trade: {
    kind: "customs", group: "Trade & External",
    title: "Merchandise Trade (Exports / Imports)", agency: "General Administration of Customs",
    frequency: "Monthly", unit: "Percent change from year ago",
    // Customs' own growth rates from its monthly totals table, out with the
    // preliminary release; the month's first print, in USD terms. NBS carries
    // the same rates two weeks later, revised; the mirror copies the first print.
    table: "totals", measure: "growth",
    regions: [{ text: "Total", value: "total", en: "Total" }],
    releaseDay: 14,
  },
  trade_values: {
    kind: "customs", group: "Trade & External", home: false,
    title: "Merchandise Trade Values (Exports / Imports)", agency: "General Administration of Customs",
    frequency: "Monthly", unit: "Hundred million USD (亿美元)",
    table: "totals", measure: "levels",
    regions: [{ text: "Total", value: "total", en: "Total" }],
    releaseDay: 14,
  },
  trade_mirror: {
    kind: "eastmoney", group: "Trade & External", home: false,
    title: "Merchandise Trade (Exports / Imports), mirror copy", agency: "General Administration of Customs",
    frequency: "Monthly", unit: "Percent change from year ago",
    reportName: "RPT_ECONOMY_CUSTOMS",
    fields: [
      { field: "EXIT_BASE_SAME", label: "Exports (YoY %)" },
      { field: "IMPORT_BASE_SAME", label: "Imports (YoY %)" },
    ],
    releaseDay: 14, // Customs' preliminary release; the mirror follows it the same day
  },
  balance_of_payments: {
    kind: "safe", group: "Trade & External",
    title: "Balance of Payments", agency: "State Administration of Foreign Exchange",
    frequency: "Quarterly", unit: "Hundred million USD (亿美元)",
    // SAFE's BPM6 time series, final figures: the workbook is replaced with
    // each quarter's final release, about three months after the quarter.
    // The quarter before that comes from the preliminary release (two months
    // after the quarter) for the seven items it prints, and is replaced by
    // the final figure when the workbook catches up.
    // BPM6 signs: a financial-account outflow and a rise in reserves are negative.
    // No concordance pair: nothing else on the site measures the balance of
    // payments, and Customs' goods balance is on a different basis.
    items: BOP_ITEMS,
  },
  bank_fx_settlement: {
    kind: "safe", table: "fx_settlement", group: "Trade & External",
    title: "Bank FX Settlement and Sales", agency: "State Administration of Foreign Exchange",
    frequency: "Monthly", unit: "Hundred million yuan (亿元)",
    // SAFE's 银行结售汇 workbook, replaced each month around the 15th: what
    // banks bought from and sold to their customers and on their own account,
    // in yuan. Net settlement (结汇 minus 售汇) is the headline: a positive
    // month is net demand for yuan. The yuan and dollar sheets are the same
    // transactions valued at the month's rates. Concordance: each year's
    // twelve months are summed against the workbook's annual table.
    sheet: "以人民币计价（月度）", items: FX_SETTLEMENT_ITEMS, releaseDay: 18,
  },
  bank_fx_settlement_usd: {
    kind: "safe", table: "fx_settlement", group: "Trade & External",
    title: "Bank FX Settlement and Sales (USD)", agency: "State Administration of Foreign Exchange",
    frequency: "Monthly", unit: "Hundred million USD (亿美元)",
    sheet: "以美元计价（月度）", items: FX_SETTLEMENT_ITEMS, releaseDay: 18, home: false,
  },
  bank_fx_settlement_annual: {
    kind: "safe", table: "fx_settlement", group: "Trade & External",
    title: "Bank FX Settlement and Sales, Annual", agency: "State Administration of Foreign Exchange",
    frequency: "Annual", unit: "Hundred million yuan (亿元)",
    // The workbook's annual table, complete years only: its last column is
    // the current year to date and is left to the monthly series.
    sheet: "以人民币计价（年度）", items: FX_SETTLEMENT_ITEMS, releaseDay: 18, home: false,
  },
  fdi_actual_use: {
    kind: "mofcom", group: "Trade & External",
    title: "Foreign Direct Investment, Actual Use, Year to Date", agency: "Ministry of Commerce",
    frequency: "Monthly", unit: "Hundred million yuan (亿元), cumulative year to date",
    // The ministry's monthly release, in renminbi since it stopped the dollar
    // figure in July 2023: the year-to-date total and its manufacturing,
    // services and high-technology parts.
    measure: "cny",
    releaseDay: 22, // the release came on the 16th to the 22nd through 2026
  },
  fdi_new_enterprises: {
    kind: "mofcom", group: "Trade & External", home: false,
    title: "New Foreign-Invested Enterprises, Year to Date", agency: "Ministry of Commerce",
    frequency: "Monthly", unit: "Enterprises, cumulative year to date",
    // Two paths to one figure: the data centre's table and the monthly release; the audit holds them together.
    measure: "enterprises",
    releaseDay: 22,
  },
  fdi_growth: {
    kind: "mofcom", group: "Trade & External", home: false,
    title: "Foreign Direct Investment Growth, Year to Date", agency: "Ministry of Commerce",
    frequency: "Monthly", unit: "Percent change from year ago, cumulative year to date",
    measure: "growth",
    releaseDay: 22,
  },
  fdi_actual_use_usd: {
    kind: "mofcom", group: "Trade & External", home: false,
    title: "Foreign Direct Investment, Actual Use (USD, ended)", agency: "Ministry of Commerce",
    frequency: "Monthly", unit: "Hundred million USD (亿美元), month",
    ended: "2023-07", endedNote: "The ministry stopped publishing the dollar figure after July 2023; the renminbi series continues.",
    measure: "usd",
  },
  forex_reserves: {
    kind: "eastmoney", group: "Trade & External",
    title: "Official Foreign Exchange Reserves", agency: "People's Bank of China",
    frequency: "Monthly", unit: "Hundred million USD (亿美元)",
    reportName: "RPT_ECONOMY_GOLD_CURRENCY",
    fields: [{ field: "FOREX", label: "FX reserves (100M USD)" }],
  },
  gold_reserves: {
    kind: "eastmoney", group: "Trade & External", home: false,
    title: "Official Gold Reserves", agency: "People's Bank of China",
    frequency: "Monthly", unit: "Hundred million USD (亿美元)",
    // The same PBOC release as FX reserves; its own series rather than a second line there,
    // since gold at a tenth of the FX total flattened the FX line on a shared axis.
    reportName: "RPT_ECONOMY_GOLD_CURRENCY",
    fields: [{ field: "GOLD_RESERVES", label: "Gold reserves (100M USD)" }],
  },
  consumer_confidence: {
    kind: "eastmoney", group: "Sentiment",
    title: "Consumer Confidence Index", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Index (100 = neutral)",
    // NBS's monthly consumer survey: the headline index with its two components.
    // Below 100 since April 2022; the level, not the change, is the story.
    reportName: "RPT_ECONOMY_FAITH_INDEX",
    fields: [
      { field: "CONSUMERS_FAITH_INDEX", label: "Consumer confidence" },
      { field: "CONSUMERS_EXPECT_INDEX", label: "Expectations" },
      { field: "CONSUMERS_ASTIS_INDEX", label: "Satisfaction" },
    ],
  },
  enterprise_boom: {
    kind: "eastmoney", group: "Sentiment", home: false,
    title: "Enterprise Boom Index", agency: "National Bureau of Statistics",
    frequency: "Quarterly", unit: "Index (100 = neutral)",
    // NBS's quarterly survey of enterprise conditions. The entrepreneur confidence
    // column in the same table stopped being filled; only the boom index is served.
    reportName: "RPT_ECONOMY_BOOM_INDEX",
    fields: [{ field: "BOOM_INDEX", label: "Enterprise boom index" }],
  },
  fiscal_revenue: {
    kind: "mof", group: "Public Finance",
    title: "Fiscal Revenue, Year to Date", agency: "Ministry of Finance",
    frequency: "Monthly", unit: "Hundred million yuan (亿元), cumulative year to date",
    // The ministry's monthly 财政收支情况: every figure is January to the
    // month, and the titles say so. The month's own figure is not published.
    measure: "level",
    items: ["revenue", "tax", "nonTax", "fundRevenue"],
    releaseDay: 25, // 财政收支情况 came on the 15th to the 25th through 2026
  },
  fiscal_expenditure: {
    kind: "mof", group: "Public Finance", home: false,
    title: "Fiscal Expenditure, Year to Date", agency: "Ministry of Finance",
    frequency: "Monthly", unit: "Hundred million yuan (亿元), cumulative year to date",
    measure: "level",
    items: ["expenditure", "fundExpenditure"],
    releaseDay: 25,
  },
  land_sale_revenue: {
    kind: "mof", group: "Public Finance",
    title: "Land Sale Revenue, Year to Date", agency: "Ministry of Finance",
    frequency: "Monthly", unit: "Hundred million yuan (亿元), cumulative year to date",
    // 国有土地使用权出让收入, the local governments' land-lease income, inside the government fund budget.
    measure: "level",
    items: ["landSales"],
    releaseDay: 25,
  },
  fiscal_growth: {
    kind: "mof", group: "Public Finance", home: false,
    title: "Fiscal Revenue and Expenditure Growth, Year to Date", agency: "Ministry of Finance",
    frequency: "Monthly", unit: "Percent change from year ago, cumulative year to date",
    measure: "growth",
    items: ["revenue", "tax", "expenditure", "landSales", "fundRevenue"],
    releaseDay: 25,
  },
  tax_revenue: {
    kind: "eastmoney", group: "Public Finance", home: false,
    title: "Tax Revenue, Year to Date", agency: "Ministry of Finance",
    frequency: "Quarterly", unit: "Hundred million yuan (亿元), cumulative year to date",
    // The finance ministry publishes cumulative totals: the Q2 figure is January
    // to June, Q4 the full year. Not a single-quarter series.
    reportName: "RPT_ECONOMY_TAX",
    fields: [{ field: "TAX_INCOME", label: "Tax revenue, year to date" }],
  },
  forex_loans: {
    kind: "eastmoney", group: "Money & Credit", home: false,
    title: "Foreign Currency Loans Outstanding", agency: "People's Bank of China",
    frequency: "Monthly", unit: "Hundred million USD (亿美元)",
    // The balance at month end. The same table's monthly change is small and noisy.
    reportName: "RPT_ECONOMY_FOREX_LOAN",
    fields: [{ field: "BASE_ACCUMULATE", label: "FX loans outstanding" }],
  },
  commodity_prices: {
    kind: "eastmoney", group: "Prices", home: false,
    title: "Commodity Price Index (CCPI)", agency: "Ministry of Commerce",
    frequency: "Monthly", unit: "Index",
    // The commerce ministry's China Commodity Price Index and its energy,
    // mineral and farm components.
    reportName: "RPT_ECONOMY_GOODS_INDEX",
    fields: [
      { field: "BASE", label: "All commodities" },
      { field: "ENERGY_BASE", label: "Energy" },
      { field: "MINERAL_BASE", label: "Minerals" },
      { field: "FARM_BASE", label: "Farm products" },
    ],
  },
  cgb_yields: {
    kind: "cfets", group: "Interest Rates",
    title: "Government Bond Yields", agency: "China Foreign Exchange Trade System",
    frequency: "Monthly", unit: "Percent, month-end close",
    // The closing yield curve for Chinese government bonds, published every
    // trading day; the last close of each month is what the monthly frame
    // carries. The 10-year is the benchmark everyone quotes.
    tenors: [
      { term: "10.0", label: "10-year" },
      { term: "1.0", label: "1-year" },
      { term: "2.0", label: "2-year" },
      { term: "5.0", label: "5-year" },
      { term: "30.0", label: "30-year" },
    ],
  },
  shibor: {
    kind: "cfets", table: "shibor", group: "Interest Rates",
    title: "SHIBOR", agency: "China Foreign Exchange Trade System",
    frequency: "Monthly", unit: "Percent, last fixing of the month",
    // The Shanghai Interbank Offered Rate, fixed each trading day from the
    // panel banks' quotes; the overnight and one-week tenors track the
    // central bank's operations, the three-month tenor prices bank funding.
    // No pair: SHIBOR reaches the site by CFETS's fixing alone, and the
    // averages beside it are the same fixings reduced another way.
    tenors: [
      { term: "ON", label: "Overnight" },
      { term: "1W", label: "1-week" },
      { term: "1M", label: "1-month" },
      { term: "3M", label: "3-month" },
      { term: "1Y", label: "1-year" },
    ],
  },
  shibor_average: {
    kind: "cfets", table: "shibor", measure: "month_average", group: "Interest Rates",
    title: "SHIBOR, Monthly Average", agency: "China Foreign Exchange Trade System",
    frequency: "Monthly", unit: "Percent, average of daily fixings", home: false,
    tenors: [
      { term: "ON", label: "Overnight" },
      { term: "1W", label: "1-week" },
      { term: "3M", label: "3-month" },
    ],
  },
  repo_fixing: {
    kind: "cfets", table: "repo_fixing", group: "Interest Rates",
    title: "Repo Fixing Rates", agency: "China Foreign Exchange Trade System",
    frequency: "Monthly", unit: "Percent, last fixing of the month",
    // The pledged-repo fixing rates CFETS sets each trading day from the
    // morning's trades: FR across all institutions, FDR among depository
    // institutions only. FDR007 is the fixing of the seven-day rate the
    // central bank steers (DR007); the DR weighted averages themselves are
    // not on an endpoint the site can reach, so the fixing is served and
    // named as such.
    tenors: [
      { term: "FDR007", label: "FDR007, 7-day, depository institutions" },
      { term: "FDR001", label: "FDR001, overnight, depository institutions" },
      { term: "FR007", label: "FR007, 7-day, all institutions" },
      { term: "FR001", label: "FR001, overnight, all institutions" },
    ],
  },
  repo_fixing_average: {
    kind: "cfets", table: "repo_fixing", measure: "month_average", group: "Interest Rates",
    title: "Repo Fixing Rates, Monthly Average", agency: "China Foreign Exchange Trade System",
    frequency: "Monthly", unit: "Percent, average of daily fixings", home: false,
    tenors: [
      { term: "FDR007", label: "FDR007, 7-day, depository institutions" },
      { term: "FDR001", label: "FDR001, overnight, depository institutions" },
      { term: "FR007", label: "FR007, 7-day, all institutions" },
    ],
  },
  central_parity: {
    kind: "cfets", table: "central_parity", group: "Exchange Rates",
    title: "Yuan Central Parity", agency: "China Foreign Exchange Trade System",
    frequency: "Monthly", unit: "Yuan per unit of foreign currency, last fixing of the month",
    // The central parity the PBOC authorises CFETS to publish at 9:15 each
    // trading day, around which the onshore spot may trade within 2 percent.
    // The month's last fixing here; the monthly average is paired with the
    // Fed's monthly average of the spot (fx_usdcny) in the audit.
    tenors: [
      { term: "USD/CNY", label: "USD/CNY" },
      { term: "EUR/CNY", label: "EUR/CNY" },
      { term: "100JPY/CNY", label: "100 JPY/CNY" },
      { term: "HKD/CNY", label: "HKD/CNY" },
      { term: "GBP/CNY", label: "GBP/CNY" },
    ],
  },
  central_parity_average: {
    kind: "cfets", table: "central_parity", measure: "month_average", group: "Exchange Rates",
    title: "Yuan Central Parity, Monthly Average", agency: "China Foreign Exchange Trade System",
    frequency: "Monthly", unit: "Yuan per unit of foreign currency, average of daily fixings", home: false,
    tenors: [
      { term: "USD/CNY", label: "USD/CNY" },
      { term: "EUR/CNY", label: "EUR/CNY" },
    ],
  },
  cfets_rmb_index: {
    kind: "cfets", table: "rmb_index", group: "Exchange Rates",
    title: "CFETS RMB Index", agency: "China Foreign Exchange Trade System",
    frequency: "Monthly", unit: "Index, 31 December 2014 = 100, last weekly reading of the month",
    // The yuan against a trade-weighted basket, published weekly on Fridays
    // and on the month's last trading day, with the BIS- and SDR-basket
    // versions; the month's last reading here.
    // No pair: the BIS real effective rate on the site (reer_bis) is a
    // different construction and base.
    tenors: [
      { term: "CFETS", label: "CFETS basket" },
      { term: "BIS", label: "BIS basket" },
      { term: "SDR", label: "SDR basket" },
    ],
  },
  trade_partners: {
    kind: "customs", group: "Trade & External",
    title: "Trade by Partner", agency: "General Administration of Customs",
    frequency: "Monthly", unit: "Million USD",
    // Customs' preliminary release, the table of exports and imports by
    // country and region. One series per partner; the balance is exports less
    // imports as published, in USD, which is the denomination Customs leads with.
    table: "by-country",
    regions: CUSTOMS_PARTNERS,
    homeRegions: ["united-states", "european-union", "asean"],
    // Out with the preliminary release, the 7th to the 14th of the next month
    // on Customs' calendars for 2024 and 2025 (server/customs-calendar.ts).
    releaseDay: 14,
  },
  major_exports: {
    kind: "customs", group: "Trade & External", home: false,
    title: "Major Exports by Commodity", agency: "General Administration of Customs",
    frequency: "Monthly", unit: "Million USD",
    table: "major-exports",
    regions: CUSTOMS_EXPORT_COMMODITIES,
    releaseDay: 14,
  },
  major_imports: {
    kind: "customs", group: "Trade & External", home: false,
    title: "Major Imports by Commodity", agency: "General Administration of Customs",
    frequency: "Monthly", unit: "Million USD",
    table: "major-imports",
    regions: CUSTOMS_IMPORT_COMMODITIES,
    releaseDay: 14,
  },
  // The same three Customs tables in CNY, the denomination the bureau quotes
  // its growth rates in. Their own keys, never mixed with the USD series; no
  // concordance pair, since the two denominations differ by the month's rate.
  trade_partners_cny: {
    kind: "customs", group: "Trade & External", home: false,
    title: "Trade by Partner (CNY)", agency: "General Administration of Customs",
    frequency: "Monthly", unit: "Hundred million CNY (亿元)",
    table: "by-country", currency: "CNY",
    regions: CUSTOMS_PARTNERS,
    releaseDay: 14,
  },
  major_exports_cny: {
    kind: "customs", group: "Trade & External", home: false,
    title: "Major Exports by Commodity (CNY)", agency: "General Administration of Customs",
    frequency: "Monthly", unit: "Hundred million CNY (亿元)",
    table: "major-exports", currency: "CNY",
    regions: CUSTOMS_EXPORT_COMMODITIES,
    releaseDay: 14,
  },
  major_imports_cny: {
    kind: "customs", group: "Trade & External", home: false,
    title: "Major Imports by Commodity (CNY)", agency: "General Administration of Customs",
    frequency: "Monthly", unit: "Hundred million CNY (亿元)",
    table: "major-imports", currency: "CNY",
    regions: CUSTOMS_IMPORT_COMMODITIES,
    releaseDay: 14,
  },
  property_investment: {
    kind: "nbs", group: "Property",
    title: "Real Estate Investment Growth, Year to Date", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Percent change from year ago, cumulative year to date",
    // NBS's monthly real estate release (房地产开发投资情况): cumulative for the year, as the bureau publishes it.
    cid: "9206137ccf03460daa74b7799e0f3c31",
    rootId: "fc982599aa684be7969d7b90b1bd0e84",
    ids: [
      { id: "205e08cba8c2409980db58c98da91b6f", label: "Real estate investment, year to date (YoY %)" },
      { id: "21743217a484413fb02c09259cdf6bc0", label: "Residential investment, year to date (YoY %)" },
    ],
  },
  property_investment_value: {
    kind: "nbs", group: "Property", home: false,
    title: "Real Estate Investment, Year to Date", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Hundred million yuan (亿元), cumulative year to date",
    // The levels behind property_investment.
    cid: "9206137ccf03460daa74b7799e0f3c31",
    rootId: "fc982599aa684be7969d7b90b1bd0e84",
    ids: [
      { id: "bfb626c0dfa04afab67937c452ca9f50", label: "Real estate investment, year to date" },
      { id: "f6c2584119124db1bd7672ae7147b9e8", label: "Residential investment, year to date" },
    ],
  },
  property_sales: {
    kind: "nbs", group: "Property",
    title: "New Home Floor Space Sold Growth, Year to Date", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Percent change from year ago, cumulative year to date",
    // 新建商品房销售面积: floor space sold, cumulative for the year. Sales value is its own table, served as property_sales_value.
    cid: "0ae633cdb85f4a8397650831b2b27e50",
    rootId: "fc982599aa684be7969d7b90b1bd0e84",
    ids: [
      { id: "50a37fbef1d04be68f15d82b711783bf", label: "Floor space sold, year to date (YoY %)" },
    ],
  },
  property_sales_area: {
    kind: "nbs", group: "Property", home: false,
    title: "New Home Floor Space Sold, Year to Date", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Ten thousand square metres (万平方米), cumulative year to date",
    // The level behind property_sales.
    cid: "0ae633cdb85f4a8397650831b2b27e50",
    rootId: "fc982599aa684be7969d7b90b1bd0e84",
    ids: [
      { id: "d353226cf0434c929b6299f8d4987754", label: "Floor space sold, year to date" },
    ],
  },
  property_sales_value: {
    kind: "nbs", group: "Property", home: false,
    title: "New Home Sales Value, Year to Date", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Hundred million yuan (亿元), cumulative year to date",
    // 新建商品房销售额, cumulative for the year; its growth is the catalog's own transform.
    cid: "5530aa75038249fab2e5e10a9997c18b",
    rootId: "fc982599aa684be7969d7b90b1bd0e84",
    ids: [
      { id: "090ed0c087024014a7fe903e409958df", label: "Sales value, year to date" },
    ],
  },
  property_construction: {
    kind: "nbs", group: "Property",
    title: "Housing Starts, Completions and Under Construction, Year to Date", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Percent change from year ago, cumulative year to date",
    // 房地产施工、竣工面积: floor space started, completed and under construction, cumulative for the year.
    cid: "cac0766314e045ea82f69886aabd31b0",
    rootId: "fc982599aa684be7969d7b90b1bd0e84",
    ids: [
      { id: "d0bfd7e4b56a4bb98cea7cfd141475d9", label: "Floor space started, year to date (YoY %)" },
      { id: "526de94de84b4b08a898d94a212d18b8", label: "Floor space completed, year to date (YoY %)" },
      { id: "ef1eeecd33c64b9ab5f6f180b3bb65d9", label: "Floor space under construction, year to date (YoY %)" },
    ],
  },
  property_construction_area: {
    kind: "nbs", group: "Property", home: false,
    title: "Housing Starts, Completions and Under Construction, Year to Date (area)", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Ten thousand square metres (万平方米), cumulative year to date",
    // The levels behind property_construction.
    cid: "cac0766314e045ea82f69886aabd31b0",
    rootId: "fc982599aa684be7969d7b90b1bd0e84",
    ids: [
      { id: "17660a75e3494e389bad3658ff124995", label: "Floor space started, year to date" },
      { id: "a0def4ba92f94107b884c46b70adc08b", label: "Floor space completed, year to date" },
      { id: "9ed8eb38cd5a4dbc8bc340883fb8754d", label: "Floor space under construction, year to date" },
    ],
  },
  property_funds: {
    kind: "nbs", group: "Property",
    title: "Developers' Funds Raised, Year to Date", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Percent change from year ago, cumulative year to date",
    // 房地产开发投资实际到位资金: funds available to developers this year, in total and from domestic loans.
    cid: "4c5a2c305155451f99abf94e42305ba2",
    rootId: "fc982599aa684be7969d7b90b1bd0e84",
    ids: [
      { id: "e3c3d04b40fc41348a82eb8b6fdcb28b", label: "Funds raised, year to date (YoY %)" },
      { id: "4d609e39f8404f01aa1f7203caa32020", label: "Domestic loans, year to date (YoY %)" },
    ],
  },
  property_funds_value: {
    kind: "nbs", group: "Property", home: false,
    title: "Developers' Funds Raised, Year to Date (value)", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Hundred million yuan (亿元), cumulative year to date",
    // The levels behind property_funds.
    cid: "4c5a2c305155451f99abf94e42305ba2",
    rootId: "fc982599aa684be7969d7b90b1bd0e84",
    ids: [
      { id: "d43adb048a744b60bdc1621c967a5331", label: "Funds raised, year to date" },
      { id: "491731775fdc444393c3bc4fbe18f053", label: "Domestic loans, year to date" },
    ],
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
  pmi_manufacturing: {
    kind: "nbs", group: "Sentiment", home: false,
    title: "Manufacturing PMI and Sub-indices", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Diffusion index (50 = neutral)",
    // NBS's 制造业采购经理指数 table: the headline diffusion index and its components, 50 = no change on the month.
    cid: "93ffbb1aa85740d3aa2618371508b606",
    rootId: "fc982599aa684be7969d7b90b1bd0e84",
    ids: [
      { id: "a09aa989bdcf4cffa2021795722eb916", label: "Manufacturing PMI" },
      { id: "6729aa00f9ed46d8b30c5d2312214b89", label: "Production" },
      { id: "4151df33b53f4d02ae9f51fe402f1a50", label: "New orders" },
      { id: "fb245388740743d0974af1b00cfd27bb", label: "New export orders" },
      { id: "d14ffd61d762435b8360896a13787659", label: "Backlog of orders" },
      { id: "48ec2904ba8848cf9488fa99d3731525", label: "Finished goods inventories" },
      { id: "c83954218ae645cf975ed4f66b4a57f2", label: "Purchasing volume" },
      { id: "0cfb958d221a488da4fe4514b96b5cb0", label: "Imports" },
      { id: "f8d4068c475844bb9485f9363935119e", label: "Input prices" },
      { id: "105a73cd48cc47d4a914ebccdedf24ec", label: "Output prices" },
      { id: "c149709d0c48422d83a59d4b94d03bbb", label: "Raw material inventories" },
      { id: "24454731f2fd46f1850da13fe6f39263", label: "Employment" },
      { id: "23a80d4340314e45ab0cc0ce69f3eeec", label: "Supplier delivery times" },
      { id: "b0bf6dec50d3459086e79e0336c92246", label: "Business expectations" },
    ],
  },
  pmi_nonmanufacturing: {
    kind: "nbs", group: "Sentiment", home: false,
    title: "Non-manufacturing PMI and Sub-indices", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Diffusion index (50 = neutral)",
    // NBS's 非制造业采购经理指数 table: business activity for services and construction and the components, 50 = no change on the month.
    cid: "7a64a6e25aec4a8e9dde044ecd9e2cce",
    rootId: "fc982599aa684be7969d7b90b1bd0e84",
    ids: [
      { id: "88a150208f6e4a1db8babe41ae700f66", label: "Non-manufacturing business activity" },
      { id: "6f77d579993b454d9e61776b7113a672", label: "Services business activity" },
      { id: "97a152f401d64409892a7fdbe22b0225", label: "Construction business activity" },
      { id: "e64aa8133ca647da8f75893583a5bb24", label: "New orders" },
      { id: "55ef7f3b8fc44bd791de8c0dd1c0ec56", label: "New export orders" },
      { id: "b5957bb8bb284cfaaeaf06abb84a562c", label: "Backlog of orders" },
      { id: "77e232b90a314d53a63741ca923c90fb", label: "Inventories" },
      { id: "61d7f87361374c7e9f9b811a69e5e5c9", label: "Input prices" },
      { id: "60c688be2e284933986a6f42fd65b366", label: "Sales prices" },
      { id: "bbe0067c5fbb49eda66f8fd8d60811cf", label: "Employment" },
      { id: "fa78c1b7b0424f0598e04fff9fd0e6ef", label: "Supplier delivery times" },
      { id: "7f8ebe0d686142cbaccf5b2ee450c50c", label: "Business expectations" },
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
  house_prices_nbs: {
    kind: "nbs", group: "Property", home: false,
    title: "New and Existing Home Prices, 70 Cities (NBS table)", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Percent change from year ago",
    // NBS's own 70-city table (70个大中城市住宅销售价格指数), one request per
    // city, the index on the same month a year earlier = 100 served as the
    // change. The mirror's copy stays as house_prices for the audit.
    cid: "3eb43764c74741469b745c396cf002d1",
    rootId: "327ecbb2e6b14c669da1e99e39faa24c",
    ids: [
      { id: "fb43046325f64e3896a96b70b071d52b", valueOffset: -100, label: "New homes (YoY %)" },
      { id: "11ad09962ea7497eb2ccdf2be5719a20", valueOffset: -100, label: "Existing homes (YoY %)" },
    ],
    region: { text: "北京", value: "110000000000", en: "Beijing" },
    regions: CITIES_70_NBS,
    geography: "City",
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
  electricity_demand: {
    kind: "nea", group: "Growth & Output",
    title: "Electricity Consumption", agency: "National Energy Administration",
    frequency: "Monthly", unit: "Hundred million kWh (亿千瓦时)",
    // NEA's monthly 全社会用电量 release: the month and the year to date, total
    // and by user group. January and February are published together and sit
    // on the year-to-date line only; the month line has no point for either.
    measure: "level",
    releaseDay: 21, // the note came on the 15th to the 21st through 2026
  },
  electricity_demand_growth: {
    kind: "nea", group: "Growth & Output", home: false,
    title: "Electricity Consumption Growth", agency: "National Energy Administration",
    frequency: "Monthly", unit: "Percent change from year ago",
    measure: "growth",
    releaseDay: 21,
  },
  electricity_output: {
    kind: "nbs", group: "Growth & Output",
    title: "Electricity Generation", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Percent change from year ago",
    cid: "1abb1cfea75847b8bf1a0e395d85966b",
    rootId: "fc982599aa684be7969d7b90b1bd0e84",
    ids: [{ id: "5cc686f383d84ed9bd11f4293ab4170e", januaryFebruaryId: "619254b0b9f24a5aa0c336bdf5998c4e", label: "Electricity output (YoY %)" }],
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

/**
 * The headline series a query names: every term must start a word of the
 * title, group, agency, unit, key or synonyms (Chinese terms match anywhere).
 * An entry whose text holds the whole query as a phrase comes first, so
 * "exports to us" leads with US imports from China, which carries that
 * phrase, and "us exports" leads with US exports to China. Otherwise the
 * catalog order stands.
 */
export function matchCurated(entries: CatalogEntry[], allTerms: string[], queryTerms: string[]): CatalogEntry[] {
  const phrase = allTerms.join(" ");
  const matched = entries.flatMap((entry) => {
    const haystack = `${entry.title} ${entry.group} ${entry.agency} ${entry.unit} ${entry.key} ${(CURATED_SYNONYMS[entry.key] ?? []).join(" | ")}`.toLocaleLowerCase();
    const hit = queryTerms.every((term) => /[\u3400-\u9fff]/.test(term)
      ? haystack.includes(term)
      : new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(haystack));
    if (!hit) return [];
    const wholePhrase = phrase.length > 0 && new RegExp(`(^|[^a-z0-9])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`).test(haystack);
    return [{ entry, wholePhrase }];
  });
  return matched.sort((a, b) => Number(b.wholePhrase) - Number(a.wholePhrase)).map((item) => item.entry);
}

export interface CatalogEntry {
  key: string;
  title: string;
  group: string;
  agency: string;
  frequency: string;
  unit: string;
  ended?: string;
  endedNote?: string;
  /** Set when this deployment cannot refresh the series (AkShare without AKTools); it serves from the store. */
  refreshBlocked?: string;
  /** Where the numbers come from: the page counts its sources honestly rather than by whether a series is on the home page. */
  source: Indicator["kind"];
  /** Day of the month by which the publisher's release is normally out, for publishers off the NBS calendar. */
  releaseDay?: number;
  /** Regions of a multi-region series that get their own home-page rows. */
  homeRegions?: string[];
  home?: boolean;
}

export function catalogList(): CatalogEntry[] {
  return Object.entries(CATALOG).map(([key, c]) => ({
    key, title: c.title, group: c.group, agency: c.agency,
    frequency: c.frequency, unit: c.unit, source: c.kind,
    ...(c.ended ? { ended: c.ended, endedNote: c.endedNote } : {}),
    ...(c.home === false ? { home: false } : {}),
    ...(c.kind === "aktools" && !aktoolsConfigured() ? { refreshBlocked: "AkShare" } : {}),
    ...((c.kind === "customs" || c.kind === "eastmoney" || c.kind === "nea" || c.kind === "pboc" || c.kind === "mof" || c.kind === "mofcom" || c.kind === "safe") && c.releaseDay ? { releaseDay: c.releaseDay } : {}),
    ...(c.kind === "customs" && c.homeRegions ? { homeRegions: c.homeRegions } : {}),
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
  const { json } = await fetchJson(url, { headers: { "User-Agent": UA, Accept: "application/json, text/plain, */*" } });
  const result: unknown = typeof json === "object" && json !== null ? Reflect.get(json, "result") : undefined;
  const data: unknown = typeof result === "object" && result !== null ? Reflect.get(result, "data") : undefined;
  const rows: Record<string, unknown>[] = [];
  if (Array.isArray(data)) for (const row of data) if (typeof row === "object" && row !== null) rows.push(row);

  const series: Series[] = cfg.fields.map((f) => {
    const points: SeriesPoint[] = [];
    for (const row of rows) {
      const rawDate = row[cfg.dateField ?? "REPORT_DATE"];
      if (typeof rawDate !== "string") continue;
      const month = toMonth(rawDate);
      const rawVal = eastmoneyValue(row, f, month);
      const num = typeof rawVal === "number" ? rawVal : Number(rawVal);
      if (rawVal === null || rawVal === undefined || rawVal === "" || Number.isNaN(num)) continue;
      points.push({ date: month, value: offsetValue(num, f.valueOffset) });
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
    // Eastmoney occasionally stalls a page or closes the socket mid-body, and from the
    // deployment's network it did so on the first burst of most days (nine house-price
    // refreshes failed that way in three days, each recovering on the next region's
    // download a minute later). A failed page is retried twice after a pause, not at once.
    const load = async () => (await fetch(url, { headers, signal: AbortSignal.timeout(45_000) })).json();
    let json: { result?: { data?: unknown; pages?: unknown } } | undefined;
    for (const pause of [0, 2_000, 6_000]) {
      if (pause > 0) await new Promise((resolve) => setTimeout(resolve, pause));
      try { json = await load(); break; } catch (error) { if (pause === 6_000) throw error; }
    }
    const data: unknown = json?.result?.data;
    const rows: Record<string, unknown>[] = [];
    if (Array.isArray(data)) for (const row of data) if (typeof row === "object" && row !== null) rows.push(row);
    return { rows, totalPages: typeof json?.result?.pages === "number" ? json.result.pages : wanted };
  };
  const first = await fetchPage(1);
  const last = Math.min(wanted, first.totalPages);
  const rows = [...first.rows];
  // Five pages at a time: nine in flight was the burst the socket drops followed.
  for (let page = 2; page <= last; page += 5) {
    const batch = await Promise.all(Array.from({ length: Math.min(5, last - page + 1) }, (_, offset) => fetchPage(page + offset)));
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
  // Always the full history: a FRED series is at most a few hundred points, the
  // store keeps everything, and a window shorter than the source's lag (the
  // BIS publishes a quarter six months late) would come back empty.
  const params = new URLSearchParams({ series_id: cfg.seriesId, api_key: apiKey, file_type: "json" });
  if (cfg.aggregate) {
    params.set("frequency", cfg.frequency === "Monthly" ? "m" : cfg.frequency === "Quarterly" ? "q" : "a");
    params.set("aggregation_method", cfg.aggregate);
  }
  const { ok, status, json } = await fetchJson(`https://api.stlouisfed.org/fred/series/observations?${params.toString()}`, { headers: { Accept: "application/json" } }, { timeoutMs: 30_000 });
  if (!ok) throw new Error(`FRED ${cfg.seriesId} -> HTTP ${status}`);
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
    frequency: cfg.frequency, unit: cfg.unit, series: [{ label: cfg.label, points: points.slice(-Math.max(limit, 2)) }],
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

/** The main table, then each earlier slice merged behind it by label; the main table's points win where they overlap. */
async function fetchNbsWithSlices(key: string, cfg: NbsIndicator, limit: number): Promise<SeriesResult> {
  const main = await fetchNbs(key, cfg, limit);
  if (!cfg.slices || cfg.slices.length === 0) return main;
  const merged = new Map(main.series.map((line) => [line.label, new Map(line.points.map((point) => [point.date, point.value]))]));
  for (const slice of cfg.slices) {
    let part: SeriesResult;
    try { part = await fetchNbs(key, { ...cfg, cid: slice.cid, rootId: slice.rootId ?? cfg.rootId, ids: slice.ids, slices: undefined }, limit); }
    catch (error) { console.warn(`  ${key}: slice ${slice.cid} failed: ${error instanceof Error ? error.message : String(error)}`); continue; }
    for (const line of part.series) {
      const points = merged.get(line.label) ?? new Map<string, number>();
      for (const point of line.points) if (!points.has(point.date)) points.set(point.date, point.value);
      merged.set(line.label, points);
    }
  }
  return { ...main, series: [...merged.entries()].map(([label, points]) => ({ label, points: [...points.entries()].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date)) })) };
}

async function fetchNbs(key: string, cfg: NbsIndicator, limit: number): Promise<SeriesResult> {
  const region = cfg.region ?? { text: "全国", value: "000000000000" };
  const payload = {
    cid: cfg.cid, indicatorIds: [...new Set(cfg.ids.flatMap((i) => (i.januaryFebruaryId ? [i.id, i.januaryFebruaryId] : [i.id])))], daCatalogId: "",
    das: [region], showType: "1",
    dts: [nbsRange(cfg, limit)], rootId: cfg.rootId,
  };
  const { json } = await fetchJson(
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
  const rawData: unknown = typeof json === "object" && json !== null ? Reflect.get(json, "data") : undefined;
  const periods: { code?: string; name?: string; values?: { _id?: string; da?: string; value?: unknown }[] }[] =
    Array.isArray(rawData) ? rawData : [];

  const series: Series[] = cfg.ids.map((idcfg) => {
    const points: SeriesPoint[] = [];
    for (const period of periods) {
      const code = typeof period.code === "string" ? period.code : "";
      const date = nbsPeriod(code);
      const raw = nbsPeriodValue(period.values ?? [], idcfg, region.value, date);
      const num = typeof raw === "number" ? raw : Number(raw);
      if (raw === null || raw === undefined || raw === "" || Number.isNaN(num)) continue;
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
  if (aktoolsUrl() === "off") {
    throw new Error(`AKTools is not configured on this deployment; ${cfg.fn} serves from the stored copy until it is.`);
  }
  let res: Response;
  try {
    res = await fetch(`${aktoolsUrl()}/api/public/${cfg.fn}`, {
      signal: AbortSignal.timeout(45000),
    });
  } catch (error) {
    // A timeout is AKTools being slow (some AkShare functions scrape for 20s+);
    // anything else is the service not being there at all.
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new Error(timedOut
      ? `AKTools did not answer within 45s for ${cfg.fn}. The upstream AkShare call is slow or blocked; try again later.`
      : `AKTools is not running at ${aktoolsUrl()}. This series comes from AkShare through a local AKTools service: start it with 'python -m aktools' and try again.`);
  }
  if (!res.ok) {
    throw new Error(`AKTools ${cfg.fn} -> HTTP ${res.status} (is 'python -m aktools' running on ${aktoolsUrl()}?)`);
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
  if (cfg.kind === "nbs") data = await fetchNbsWithSlices(key, cfg, limit);
  else if (cfg.kind === "aktools") data = await fetchAktools(key, cfg, limit);
  else if (cfg.kind === "fred") data = await fetchFred(key, cfg, limit);
  else if (cfg.kind === "customs") data = await fetchCustomsRegion(key, cfg, cfg.regions[0] ?? { text: "", value: "" }, limit);
  else if (cfg.kind === "cfets") data = await fetchCfets(key, cfg, limit);
  else if (cfg.kind === "nea") data = await fetchNea(key, cfg, limit);
  else if (cfg.kind === "pboc") data = await fetchPboc(key, cfg, limit);
  else if (cfg.kind === "mof") data = await fetchMof(key, cfg, limit);
  else if (cfg.kind === "safe") data = await fetchSafe(key, cfg, limit);
  else if (cfg.kind === "mofcom") data = await fetchMofcom(key, cfg, limit);
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
/**
 * The series labels a key is configured to serve, in declared order, or null
 * when the kind has no fixed label list. The store is append-only, so a label
 * dropped from the configuration (gold reserves moved off FX reserves) stays
 * stored; reads keep only the configured ones.
 */
export function configuredLabels(key: string): string[] | null {
  const cfg = CATALOG[key];
  if (!cfg) return null;
  if (cfg.kind === "eastmoney" || cfg.kind === "aktools") return cfg.fields.map((field) => field.label);
  if (cfg.kind === "nbs") return cfg.ids.map((id) => id.label);
  if (cfg.kind === "fred") return [cfg.label];
  if (cfg.kind === "cfets") return cfg.tenors.map((tenor) => tenor.label);
  if (cfg.kind === "nea") return neaLabels(cfg);
  if (cfg.kind === "pboc") return cfg.instruments.map((instrument) => instrument.label);
  if (cfg.kind === "mof") return mofLabels(cfg);
  if (cfg.kind === "safe") return cfg.items.map((item) => item.label);
  if (cfg.kind === "mofcom") return mofcomLabels(cfg);
  // Customs labels depend on the row (a commodity's quantity unit), so the store's own labels stand.
  return null;
}

export function seriesRegion(key: string): string {
  const cfg = CATALOG[key];
  if (cfg && cfg.kind === "nbs" && cfg.region) return cfg.regions ? cfg.region.value : cfg.region.text;
  if (cfg && cfg.kind === "eastmoney" && cfg.regions) return (cfg.regionAverage ?? cfg.regions[0])?.value ?? "";
  if (cfg && cfg.kind === "customs") return cfg.regions[0]?.value ?? "";
  return "";
}

/** What kind of place a regional series is split by. */
export type SeriesGeography = "Province" | "City" | "Partner" | "Commodity";
export function seriesGeography(key: string): SeriesGeography {
  const cfg = CATALOG[key];
  // No tile map for these: partners and commodities rank, they are not mapped.
  if (cfg && cfg.kind === "customs") return cfg.table === "by-country" ? "Partner" : "Commodity";
  if (cfg && cfg.kind === "nbs" && cfg.geography) return cfg.geography;
  return cfg && cfg.kind === "eastmoney" && cfg.regions ? "City" : "Province";
}

/** The regions a curated series is published for, or an empty list. */
export function seriesRegions(key: string): NbsRegion[] {
  const cfg = CATALOG[key];
  if (cfg && cfg.kind === "nbs" && cfg.regions) return cfg.regions;
  if (cfg && cfg.kind === "eastmoney" && cfg.regions) return cfg.regionAverage ? [cfg.regionAverage, ...cfg.regions] : cfg.regions;
  if (cfg && cfg.kind === "customs") return cfg.regions;
  return [];
}

/**
 * Fetch one region of a multi-region curated series. The store keys these
 * by the NBS `das` code, the same convention as catalog series.
 */
export async function fetchLiveRegion(key: string, region: NbsRegion, limit = 120, options: { oldestStored?: string | null } = {}): Promise<SeriesResult | null> {
  const cfg = CATALOG[key];
  if (!cfg) return null;
  if (cfg.kind === "nbs") return fetchNbs(key, { ...cfg, region }, limit);
  if (cfg.kind === "eastmoney" && cfg.regions) return fetchEastmoneyRegion(key, cfg, region, limit);
  // Customs walks its archive a slice at a time; the store's oldest month says where the slice starts.
  if (cfg.kind === "customs") return fetchCustomsRegion(key, cfg, region, limit, options);
  return null;
}

/**
 * Fetch straight from the upstream source, skipping the in-memory cache.
 * The ingest job uses this; the server should prefer the stored copy.
 */
/**
 * A fresh read from the publisher. `lastStored` is the newest period the store
 * holds, for adapters that can read forward from it instead of re-reading
 * their whole history each day (CFETS, one request per month).
 */
export async function fetchLive(key: string, limit = 120, options: { lastStored?: string | null } = {}): Promise<SeriesResult | null> {
  const cfg = CATALOG[key];
  if (!cfg) return null;
  if (cfg.kind === "nbs") return fetchNbsWithSlices(key, cfg, limit);
  if (cfg.kind === "aktools") return fetchAktools(key, cfg, limit);
  if (cfg.kind === "fred") return fetchFred(key, cfg, limit);
  if (cfg.kind === "customs") return fetchCustomsRegion(key, cfg, cfg.regions[0] ?? { text: "", value: "" }, limit);
  if (cfg.kind === "cfets") return fetchCfets(key, cfg, limit, undefined, { since: options.lastStored });
  if (cfg.kind === "nea") return fetchNea(key, cfg, limit);
  if (cfg.kind === "pboc") return fetchPboc(key, cfg, limit);
  if (cfg.kind === "mof") return fetchMof(key, cfg, limit);
  if (cfg.kind === "safe") return fetchSafe(key, cfg, limit);
  if (cfg.kind === "mofcom") return fetchMofcom(key, cfg, limit);
  if (cfg.regions) return fetchEastmoneyRegion(key, cfg, cfg.regionAverage ?? cfg.regions[0] ?? { text: "", value: "" }, limit);
  return fetchEastmoney(key, cfg, limit);
}
