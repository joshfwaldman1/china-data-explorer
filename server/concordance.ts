/**
 * The concordance audit: does each curated headline agree with an independent
 * reading of the same statistic?
 *
 * On 15 September 2026 the GDP page said Q2 grew 4.7 percent in one place and
 * 4.3 in another. The curated series came from a mirror whose quarterly row
 * carries the year-to-date rate, and nothing compared it with NBS's own
 * quarterly figure, so the mislabel stood until a reader saw it. This module
 * is the check that was missing. Each pair names a curated series and a
 * reference series that reaches the site by a different path (the NBS catalog
 * crawl, another publisher, or the same publisher's other table), and the two
 * are compared at every recent period both hold. A pair that disagrees is a
 * finding; a finding is either a mislabel to fix or a documented difference
 * to record in the pair's note.
 *
 * A second kind of pair is the one the GDP bug needed: a period-rate series
 * and its year-to-date companion. The two must agree in the first period of
 * each year and must not agree everywhere, because a "quarterly" series that
 * matches the cumulative one in every quarter is the cumulative one.
 *
 * The audit reads the store only. It never fetches, so it can run nightly and
 * on demand without touching a publisher.
 */

import { readSeries } from "./db";
import { comparablePeriod } from "./due";
import type { SeriesPoint } from "./data";

/** The national region of a catalog series, as the crawl stores it. */
const CATALOG_NATION = "000000000000";

export interface SeriesRef {
  key: string;
  /** The region to read for a series published by place; the nation (or the curated default) when omitted. */
  region?: string;
  /** The line to read; for a catalog key the first (only) line is read when omitted. */
  label?: string;
  /** Added to every reference value before comparison: -100 turns an index on "same month a year earlier = 100" into a rate. */
  offset?: number;
}

export interface ValuePair {
  name: string;
  kind: "value";
  left: SeriesRef;
  right: SeriesRef;
  /** The largest absolute difference that still counts as agreement. */
  tolerance: number;
  /** Periods compared, newest first. */
  periods?: number;
  note?: string;
}

export interface CumulativePair {
  name: string;
  kind: "cumulative";
  /** The period rate: the quarter's own growth, the month's own growth. */
  period: SeriesRef;
  /** The year-to-date rate published alongside it. */
  yearToDate: SeriesRef;
  tolerance: number;
  periods?: number;
  note?: string;
}

/**
 * A monthly flow against the publisher's annual table: the twelve months of
 * each complete year must sum to the year's figure.
 */
export interface AnnualPair {
  name: string;
  kind: "annual";
  monthly: SeriesRef;
  annual: SeriesRef;
  tolerance: number;
  /** Complete years compared, newest first. */
  periods?: number;
  note?: string;
}

export type ConcordancePair = ValuePair | CumulativePair | AnnualPair;

export interface Disagreement { period: string; left: number; right: number }

export interface ConcordanceResult {
  name: string;
  kind: ConcordancePair["kind"];
  /** ok: every compared period agrees. mismatch: at least one does not. missing: a side has no stored points. no-overlap: no common period. */
  status: "ok" | "mismatch" | "missing" | "no-overlap";
  compared: number;
  disagreements: Disagreement[];
  /** The latest period compared and its two values, for the report line. */
  latest?: Disagreement;
  /** What each side holds, so a missing or disjoint pair can be read from the report. */
  sides: { left: SideRange; right: SideRange };
  note?: string;
}

export interface SideRange { first: string | null; last: string | null; points: number }

function rangeOf(points: SeriesPoint[]): SideRange {
  const dates = points.map((point) => point.date).sort();
  return { first: dates[0] ?? null, last: dates.at(-1) ?? null, points: points.length };
}

/**
 * The pairs the audit runs. Every curated headline that has an independent
 * reading is here; a new curated series adds its pair in the same change.
 * Reference keys are entries of the monthly national dataset in
 * catalog/nbs-catalog.json.gz, named in the comment.
 */
export const CONCORDANCE_PAIRS: ConcordancePair[] = [
  {
    name: "GDP: quarter vs year to date", kind: "cumulative",
    period: { key: "gdp", label: "Real GDP, quarter (YoY %)" },
    yearToDate: { key: "gdp", label: "Real GDP, year to date (YoY %)" },
    tolerance: 0.05,
    note: "Both lines from NBS's quarterly index table (当季 and 累计).",
  },
  {
    name: "Electricity consumption growth: month vs year to date", kind: "cumulative",
    period: { key: "electricity_demand_growth", label: "All users, month (YoY %)" },
    yearToDate: { key: "electricity_demand_growth", label: "All users, year to date (YoY %)" },
    tolerance: 0.05,
    note: "Both from NEA's monthly release. The month line has no January or February; the combined figure sits on the year-to-date line, so the first common period of a year is March.",
  },
  {
    name: "Tax revenue, year to date (亿元)", kind: "value",
    left: { key: "fiscal_revenue", label: "Tax revenue, year to date" },
    right: { key: "tax_revenue", label: "Tax revenue, year to date" }, // Eastmoney RPT_ECONOMY_TAX, quarterly
    tolerance: 1,
    note: "The ministry's own monthly release against the mirror's quarterly copy; compared at quarter ends.",
  },
  {
    name: "New foreign-invested enterprises, year to date", kind: "value",
    left: { key: "fdi_new_enterprises", label: "New foreign-invested enterprises, year to date" }, // the data centre's table
    right: { key: "fdi_new_enterprises", label: "New foreign-invested enterprises, year to date (ministry release)" },
    tolerance: 0.5,
    note: "The same count by two paths: MOFCOM's data centre and its monthly news release.",
  },
  {
    name: "CPI (YoY %)", kind: "value",
    left: { key: "cpi", label: "CPI (YoY %)" },
    right: { key: "nbs_53180dfb9c14411ba4b762307c85920c", offset: -100 }, // 居民消费价格指数 (上年同月=100)
    tolerance: 0.05,
  },
  {
    name: "PPI (YoY %)", kind: "value",
    left: { key: "ppi", label: "PPI (YoY %)" },
    // The monthly dataset also carries this table in year slices (2007-2013,
    // 2014-2017, 2018-2025, 2026-); the first live run paired a slice and
    // found no common period. This is the unsliced entry.
    right: { key: "nbs_150633e52b9a470a9a9fd1b296dd6c5b", offset: -100 }, // 工业生产者出厂价格指数 (上年同月=100)
    tolerance: 0.05,
  },
  {
    name: "Industrial production (YoY %)", kind: "value",
    left: { key: "industrial_production", label: "Industrial production (YoY %)" },
    right: { key: "nbs_ef1b1765960d45a29b4d7c4ca91be916" }, // 规上工业增加值同比增长 (%)
    tolerance: 0.05,
    note: "January and February are published together; the curated series takes the year-to-date field for those months.",
  },
  {
    name: "Retail sales (YoY %)", kind: "value",
    left: { key: "retail_sales", label: "Retail sales (YoY %)" },
    right: { key: "nbs_aaac57d54d2e465d91bc9f3ea1a8618e" }, // 社会消费品零售总额同比增长 (%)
    tolerance: 0.05,
  },
  {
    name: "M2 (YoY %)", kind: "value",
    left: { key: "money_supply", label: "M2 (YoY %)" },
    right: { key: "nbs_e03f2232631f41cd9d754a7d7feb4a81" }, // 货币和准货币 (M2) 供应量_同比增长 (%)
    tolerance: 0.05,
  },
  {
    name: "Exports (YoY %)", kind: "value",
    left: { key: "trade", label: "Exports (YoY %)" }, // Customs' own monthly totals table
    right: { key: "trade_mirror", label: "Exports (YoY %)" }, // the Eastmoney mirror of the same release
    // Customs' table holds each month's first print; the mirror carries the
    // revision Customs makes a month later (July 2026 imports: 27.5 first,
    // 27.6 revised). A tenth or two is that; more is a different statistic.
    tolerance: 0.25,
    note: "Customs' first print against the mirror, which carries the later revision; revised months differ by 0.1-0.2 pp. Both in USD terms.",
  },
  {
    name: "Imports (YoY %)", kind: "value",
    left: { key: "trade", label: "Imports (YoY %)" },
    right: { key: "trade_mirror", label: "Imports (YoY %)" },
    tolerance: 0.25,
    note: "As the exports pair: first print against the revision.",
  },
  {
    name: "Exports (YoY %): Customs vs NBS", kind: "value",
    left: { key: "trade", label: "Exports (YoY %)" },
    right: { key: "nbs_788f44b0f310403fbd308b77d6f83890" }, // 出口总值同比增长 (%), NBS's revised table
    // Customs revises the previous month with each release; its table holds
    // each month's first print and NBS's table the revision, so revised months
    // differ by a tenth or two (June 2026: 26.9 against 27.0). More is a
    // different statistic.
    tolerance: 0.25,
    note: "Customs' first print against NBS's revised table; revised months differ by 0.1-0.2 pp.",
  },
  {
    name: "Manufacturing PMI", kind: "value",
    left: { key: "pmi", label: "Manufacturing PMI" },
    right: { key: "nbs_a09aa989bdcf4cffa2021795722eb916" }, // 制造业采购经理指数 (%)
    tolerance: 0.05,
    note: "The mirror against NBS's own table.",
  },
  {
    name: "Non-manufacturing PMI", kind: "value",
    left: { key: "pmi", label: "Non-manufacturing PMI" },
    right: { key: "nbs_88a150208f6e4a1db8babe41ae700f66" }, // 非制造业商务活动指数 (%)
    tolerance: 0.05,
  },
  {
    name: "M1 (YoY %)", kind: "value",
    left: { key: "money_supply", label: "M1 (YoY %)" },
    right: { key: "nbs_640401d3351b4b868dea28f89f410a54" }, // 货币 (M1) 供应量_同比增长 (%)
    tolerance: 0.05,
  },
  {
    name: "Electricity output (YoY %)", kind: "value",
    left: { key: "electricity_output", label: "Electricity output (YoY %)" },
    right: { key: "nbs_5cc686f383d84ed9bd11f4293ab4170e" }, // 发电量同比增长 (%)
    tolerance: 0.05,
    note: "The same NBS table by two paths: the curated ingest and the catalog crawl.",
  },
  {
    name: "M2 (YoY %): computed from the bank's levels vs published", kind: "value",
    left: { key: "money_stock_growth", label: "M2" },
    right: { key: "money_supply", label: "M2 (YoY %)" }, // the mirror of the bank's release
    tolerance: 0.15,
    note: "A rate computed from month-end levels against the one the bank prints; rounding to one decimal on both sides.",
  },
  {
    name: "FX reserves (100M USD)", kind: "value",
    left: { key: "official_reserves", label: "Foreign currency reserves" }, // the bank's 官方储备资产 table
    right: { key: "forex_reserves", label: "FX reserves (100M USD)" }, // the mirror of the bank's release
    tolerance: 1,
  },
  {
    name: "Gold reserves (100M USD)", kind: "value",
    left: { key: "official_reserves", label: "Gold" },
    right: { key: "gold_reserves", label: "Gold reserves (100M USD)" },
    tolerance: 1,
  },
  {
    name: "Real estate investment, year to date (YoY %, YTD)", kind: "value",
    left: { key: "property_investment", label: "Real estate investment, year to date (YoY %)" },
    right: { key: "nbs_205e08cba8c2409980db58c98da91b6f" }, // 房地产投资_累计增长 (%)
    tolerance: 0.05,
    note: "The same NBS table by two paths: the curated ingest and the catalog crawl.",
  },
  {
    name: "Floor space sold, year to date (YoY %, YTD)", kind: "value",
    left: { key: "property_sales", label: "Floor space sold, year to date (YoY %)" },
    right: { key: "nbs_50a37fbef1d04be68f15d82b711783bf" }, // 新建商品房销售面积累计增长 (%)
    tolerance: 0.05,
    note: "The same NBS table by two paths: the curated ingest and the catalog crawl.",
  },
  {
    name: "Floor space started, year to date (YoY %, YTD)", kind: "value",
    left: { key: "property_construction", label: "Floor space started, year to date (YoY %)" },
    right: { key: "nbs_d0bfd7e4b56a4bb98cea7cfd141475d9" }, // 房地产新开工施工面积累计增长 (%)
    tolerance: 0.05,
    note: "The same NBS table by two paths: the curated ingest and the catalog crawl.",
  },
  {
    name: "Funds raised, year to date (YoY %, YTD)", kind: "value",
    left: { key: "property_funds", label: "Funds raised, year to date (YoY %)" },
    right: { key: "nbs_e3c3d04b40fc41348a82eb8b6fdcb28b" }, // 房地产投资本年资金来源小计累计增长 (%)
    tolerance: 0.05,
    note: "The same NBS table by two paths: the curated ingest and the catalog crawl.",
  },
  {
    name: "Fixed-asset investment, year to date (YoY %, YTD)", kind: "value",
    left: { key: "fai", label: "Fixed-asset investment, year to date (YoY %)" },
    right: { key: "nbs_7e570cf8071c4734a7d78d9f0a70fbe1" }, // 固定资产投资额累计增长 (%)
    tolerance: 0.05,
    note: "The same NBS table by two paths: the curated ingest and the catalog crawl.",
  },
  {
    name: "Manufacturing, year to date (YoY %, YTD)", kind: "value",
    left: { key: "fai_by_industry", label: "Manufacturing, year to date (YoY %)" },
    right: { key: "nbs_d17718248ba14e2ba7b34d39623001ea" }, // 制造业固定资产投资额累计增长 (%)
    tolerance: 0.05,
    note: "The same NBS table by two paths: the curated ingest and the catalog crawl.",
  },
  {
    name: "Funds in place, year to date (YoY %, YTD)", kind: "value",
    left: { key: "fai_funding", label: "Funds in place, year to date (YoY %)" },
    right: { key: "nbs_8d8010b8c1ba4dff88b0a9879b05ca27" }, // 固定资产投资本年资金来源小计累计增长 (%)
    tolerance: 0.05,
    note: "The same NBS table by two paths: the curated ingest and the catalog crawl.",
  },
  {
    name: "Industrial profits, year to date", kind: "value",
    left: { key: "industrial_profits", label: "Industrial profits, year to date (YoY %)" },
    right: { key: "nbs_9d63a27d727d4beeb32529078442cdd4" }, // 工业企业利润总额累计增长 (%)
    tolerance: 0.05,
    note: "The same NBS table by two paths: the curated ingest and the catalog crawl.",
  },
  {
    name: "Industry, quarter", kind: "value",
    left: { key: "capacity_utilisation", label: "Industry, quarter (%)" },
    right: { key: "nbs_57ae79552303418087eee8f4f35b4368" }, // 工业产能利用率当季值 (%)
    tolerance: 0.05,
    note: "The same NBS table by two paths: the curated ingest and the catalog crawl.",
  },
  {
    name: "Crude steel, month", kind: "value",
    left: { key: "output_crude_steel", label: "Crude steel, month (YoY %)" },
    right: { key: "nbs_1e7dfadac47f4d04b403d8f4f7516c4b" }, // 粗钢产量同比增长 (%)
    tolerance: 0.05,
    note: "The same NBS table by two paths: the curated ingest and the catalog crawl.",
  },
  {
    name: "Automobiles, month", kind: "value",
    left: { key: "output_autos", label: "Automobiles, month (YoY %)" },
    right: { key: "nbs_7cee2fa00ab44628a8da9118642f8170" }, // 汽车产量同比增长 (%)
    tolerance: 0.05,
    note: "The same NBS table by two paths: the curated ingest and the catalog crawl.",
  },
  {
    name: "Core CPI, excluding food and energy (YoY %)", kind: "value",
    left: { key: "cpi_detail", label: "Core CPI, excluding food and energy (YoY %)" },
    right: { key: "nbs_71be3d43d2fb44188199840272463ae0", offset: -100 }, // 不包括食品和能源居民消费价格指数 (上年同月=100)
    tolerance: 0.05,
    note: "The same NBS table by two paths: the curated ingest and the catalog crawl.",
  },
  {
    name: "PPI (YoY %)", kind: "value",
    left: { key: "ppi_detail", label: "PPI (YoY %)" },
    right: { key: "nbs_150633e52b9a470a9a9fd1b296dd6c5b", offset: -100 }, // 工业生产者出厂价格指数 (上年同月=100)
    tolerance: 0.05,
    note: "The same NBS table by two paths: the curated ingest and the catalog crawl.",
  },
  {
    name: "Manufacturing PMI: production", kind: "value",
    left: { key: "pmi_manufacturing", label: "Production" },
    right: { key: "nbs_6729aa00f9ed46d8b30c5d2312214b89" }, // 生产指数 (%)
    tolerance: 0.05,
    note: "The same NBS table by two paths: the curated ingest and the catalog crawl.",
  },
  {
    name: "Non-manufacturing PMI: services activity", kind: "value",
    left: { key: "pmi_nonmanufacturing", label: "Services business activity" },
    right: { key: "nbs_6f77d579993b454d9e61776b7113a672" }, // 服务业商务活动指数 (%)
    tolerance: 0.05,
    note: "The same NBS table by two paths: the curated ingest and the catalog crawl.",
  },
  {
    name: "New home prices, Beijing (YoY %)", kind: "value",
    left: { key: "house_prices_nbs", label: "New homes (YoY %)", region: "110000000000" }, // NBS's own city table
    right: { key: "house_prices", label: "New homes (YoY %)", region: "beijing" }, // the mirror's row
    tolerance: 0.05,
    note: "The bureau's 70-city table against the mirror's copy, for Beijing.",
  },
  {
    name: "Surveyed urban unemployment (%)", kind: "value",
    left: { key: "unemployment", label: "Surveyed urban (%)" },
    right: { key: "nbs_3888eac6062945a79c8a27e5f13d4953" }, // 全国城镇调查失业率 (%)
    tolerance: 0.05,
    note: "The same NBS table by two paths: the curated ingest and the catalog crawl.",
  },
  {
    name: "Yuan per dollar: central parity average vs Fed monthly average", kind: "value",
    left: { key: "central_parity_average", label: "USD/CNY" },
    right: { key: "fx_usdcny", label: "CNY per USD, monthly average" },
    tolerance: 0.15,
    note: "The fixing and the spot's average differ by design: the onshore spot trades within 2 percent of the parity, about 0.14 yuan; the check is that the two stay inside that band.",
  },
  {
    name: "Bank FX net settlement: months vs year (亿元)", kind: "annual",
    monthly: { key: "bank_fx_settlement", label: "Net settlement" },
    annual: { key: "bank_fx_settlement_annual", label: "Net settlement" },
    tolerance: 1,
    note: "SAFE's monthly and annual sheets of the same workbook; the months are kept to two decimals.",
  },
  {
    name: "Bank FX settlement: months vs year (亿元)", kind: "annual",
    monthly: { key: "bank_fx_settlement", label: "Settlement" },
    annual: { key: "bank_fx_settlement_annual", label: "Settlement" },
    tolerance: 1,
  },
];

/**
 * Curated series from a domestic publisher that have no pair, each with the
 * reason: no second reading reaches the site, or the reading that does is a
 * different statistic. The coverage test holds every such key to a line here
 * or to a pair; a new curated headline must land in one or the other.
 */
export const NO_PAIR: Record<string, string> = {
  provincial_gdp: "Provincial bureaus' figures reach the site by one path (NBS's provincial quarterly table); nothing else on the site carries them.",
  tsf_flow: "PBOC's own table is the only source of 社会融资规模; the mirror's copy is not served.",
  tsf_stock: "As tsf_flow.",
  tsf_stock_growth: "As tsf_flow; the growth printed beside the stock is the bank's, not a computed rate.",
  new_loans: "New yuan loans of financial institutions (the mirror of PBOC's release) and TSF's RMB loans to the real economy are different aggregates.",
  trade_values: "Customs' totals table is its only source on the site; trade_partners' Total row is the same table by another path but a different release cut.",
  balance_of_payments: "Nothing else on the site measures the balance of payments; Customs' goods balance is on a different basis.",
  fdi_actual_use: "The renminbi figure is published only in the ministry's release; the enterprise count beside it is paired under fdi_new_enterprises.",
  fdi_growth: "The rates printed in the ministry's release; no second reading.",
  fdi_actual_use_usd: "Ended July 2023.",
  money_stock: "The levels; the pair is on money_stock_growth, computed from them.",
  industrial_profits_value: "The levels; the pair is on industrial_profits.",
  output_cement: "The same table as the paired output keys, by one path; a pair per product would only repeat the check.",
  output_nev: "The same table as the paired output keys, by one path; a pair per product would only repeat the check.",
  output_ics: "The same table as the paired output keys, by one path; a pair per product would only repeat the check.",
  property_investment_value: "The levels; the pair is on property_investment.",
  property_sales_area: "The level; the pair is on property_sales.",
  property_sales_value: "The level of a table whose growth the catalog serves as a transform; no second reading.",
  property_construction_area: "The levels; the pair is on property_construction.",
  property_funds_value: "The levels; the pair is on property_funds.",
  bank_credit: "The bank's table is the only source; new_loans is a monthly flow of a different scope.",
  consumer_confidence: "NBS publishes the index in its release, not in the monthly database the catalog crawls.",
  enterprise_boom: "As consumer_confidence.",
  fiscal_expenditure: "The ministry's release is the only source; tax revenue in the same release is paired.",
  land_sale_revenue: "As fiscal_expenditure.",
  fiscal_growth: "The rates printed in the ministry's release; the levels they describe are paired through tax revenue.",
  forex_loans: "Foreign-currency loans outstanding (the mirror of PBOC's release) and TSF's foreign-currency loan flow are different measures.",
  commodity_prices: "The ministry's domestic commodity price index; NBS's international price indices (dataset 13) measure world prices.",
  trade_partners: "Customs' by-country table is its only source; the Total row agrees with trade_values by construction.",
  major_exports: "Customs' commodity table is its only source.",
  major_imports: "As major_exports.",
  trade_partners_cny: "The CNY denomination of trade_partners; the two differ by the month's rate.",
  major_exports_cny: "As trade_partners_cny.",
  major_imports_cny: "As trade_partners_cny.",
  real_estate: "The real estate climate index (国房景气指数) is not in the monthly database the catalog crawls.",
  electricity_demand: "The levels; the pair is on electricity_demand_growth, whose rates NEA prints beside them.",
  lpr: "PBOC's loan prime rate reaches the site by the mirror only; NBS does not carry it.",
  household_income_growth: "NBS's household survey is the only source; the annual figure is the survey's fourth-quarter reading.",
  household_income: "The levels; the survey is the only source.",
  household_spending_growth: "As household_income_growth: the survey's spending line.",
  household_spending: "The levels; the survey is the only source.",
  working_hours: "The labour force survey's only reading of hours; nothing else on the site measures them.",
  employment: "NBS's annual employment count is the only source; the census years are the same series.",
  population_nbs: "NBS's year-end count; the World Bank population on the site is a UN estimate on another basis.",
  population_rates: "NBS's annual vital rates; the World Bank fertility rate on the site is a different measure.",
  population_age: "NBS's annual age structure; the World Bank share aged 65 and over on the site is a ratio of UN estimates.",
  migrant_workers: "NBS's quarterly migrant-worker survey is the only source; the annual 农民工 figures are a year-end concept from a different sample.",
  migrant_workers_income: "As migrant_workers: the same survey's income line.",
  central_parity: "The month's last fixing; the pair is on central_parity_average against the Fed's monthly average of the spot.",
  cfets_rmb_index: "CFETS's index is the only source; the BIS real effective rate on the site is a different construction and base.",
  shibor: "CFETS's fixing is the only source of SHIBOR on the site; the monthly average beside it is the same fixings reduced another way.",
  shibor_average: "As shibor: the same fixings, averaged over the month.",
  repo_fixing: "CFETS's fixings are the only source; the DR weighted averages they are fixed from are not on an endpoint the site reaches.",
  repo_fixing_average: "As repo_fixing: the same fixings, averaged over the month.",
  bank_fx_settlement_usd: "The dollar valuation of bank_fx_settlement from the same workbook; the yuan series is summed against the annual table.",
};

/** Points keyed by comparable period (a quarter as its last month), newest first. */
function byPeriod(points: SeriesPoint[], offset = 0): Map<string, number> {
  const out = new Map<string, number>();
  for (const point of [...points].sort((a, b) => a.date.localeCompare(b.date))) {
    out.set(comparablePeriod(point.date), point.value + offset);
  }
  return out;
}

/** The periods two sides share, newest first, at most `limit`. */
function commonPeriods(left: Map<string, number>, right: Map<string, number>, limit: number): string[] {
  return [...left.keys()].filter((period) => right.has(period)).sort().reverse().slice(0, limit);
}

/**
 * Compare two sides at their common periods. Pure: the store reads happen in
 * `readSide`, so this is what the tests exercise.
 */
export function compareValues(name: string, left: SeriesPoint[], right: SeriesPoint[], options: { tolerance: number; periods?: number; leftOffset?: number; rightOffset?: number; note?: string }): ConcordanceResult {
  const base = { name, kind: "value" as const, note: options.note, sides: { left: rangeOf(left), right: rangeOf(right) } };
  if (left.length === 0 || right.length === 0) return { ...base, status: "missing", compared: 0, disagreements: [] };
  const a = byPeriod(left, options.leftOffset), b = byPeriod(right, options.rightOffset);
  const periods = commonPeriods(a, b, options.periods ?? 6);
  if (periods.length === 0) return { ...base, status: "no-overlap", compared: 0, disagreements: [] };
  const rows = periods.map((period) => ({ period, left: round(a.get(period) ?? NaN), right: round(b.get(period) ?? NaN) }));
  const disagreements = rows.filter((row) => Math.abs(row.left - row.right) > options.tolerance);
  return { ...base, status: disagreements.length > 0 ? "mismatch" : "ok", compared: rows.length, disagreements, latest: rows[0] };
}

/**
 * A period-rate series against its year-to-date companion. They must agree in
 * the first period of each year (there is nothing to accumulate yet) and must
 * disagree somewhere else: a "period" series equal to the cumulative one at
 * every period is the cumulative one under the wrong label.
 */
export function compareCumulative(name: string, period: SeriesPoint[], yearToDate: SeriesPoint[], options: { tolerance: number; periods?: number; note?: string }): ConcordanceResult {
  const base = { name, kind: "cumulative" as const, note: options.note, sides: { left: rangeOf(period), right: rangeOf(yearToDate) } };
  if (period.length === 0 || yearToDate.length === 0) return { ...base, status: "missing", compared: 0, disagreements: [] };
  const a = byPeriod(period), b = byPeriod(yearToDate);
  const periods = commonPeriods(a, b, options.periods ?? 8);
  if (periods.length === 0) return { ...base, status: "no-overlap", compared: 0, disagreements: [] };
  const rows = periods.map((p) => ({ period: p, left: round(a.get(p) ?? NaN), right: round(b.get(p) ?? NaN) }));
  // The first period of a year is where the two must agree: Q1 for a quarterly
  // pair, January for a monthly one, or February when the pair carries no
  // January (NBS and NEA publish the two months together).
  const quarterly = rows.every((row) => /-(03|06|09|12)$/.test(row.period));
  const firstOfYear = (p: string) => quarterly ? p.endsWith("-03") : p.endsWith("-01") || (p.endsWith("-02") && !rows.some((row) => row.period === `${p.slice(0, 4)}-01`));
  const disagreements = rows.filter((row) => firstOfYear(row.period) && Math.abs(row.left - row.right) > options.tolerance);
  const later = rows.filter((row) => !firstOfYear(row.period));
  const identical = later.length > 0 && later.every((row) => Math.abs(row.left - row.right) <= options.tolerance);
  // Every later period agreeing is the finding itself; report those rows so the reader sees it.
  const status = disagreements.length > 0 || identical ? "mismatch" : "ok";
  return {
    ...base, status, compared: rows.length,
    disagreements: identical ? later : disagreements, latest: rows[0],
    note: identical ? `${options.note ? `${options.note} ` : ""}The period series equals the year-to-date series at every later period: it is the cumulative series under a period label.` : options.note,
  };
}

/**
 * A monthly series summed by year against the annual table. Only years with
 * all twelve months on the monthly side are compared; the annual side's
 * current-year column is year to date and is not served.
 */
export function compareAnnualSum(name: string, monthly: SeriesPoint[], annual: SeriesPoint[], options: { tolerance: number; periods?: number; note?: string }): ConcordanceResult {
  const base = { name, kind: "annual" as const, note: options.note, sides: { left: rangeOf(monthly), right: rangeOf(annual) } };
  if (monthly.length === 0 || annual.length === 0) return { ...base, status: "missing", compared: 0, disagreements: [] };
  const months = new Map<string, number>();
  for (const point of monthly) if (/^\d{4}-\d{2}$/.test(point.date)) months.set(point.date, point.value);
  const sums = new Map<string, number>();
  for (const year of new Set([...months.keys()].map((date) => date.slice(0, 4)))) {
    const values = Array.from({ length: 12 }, (_, index) => months.get(`${year}-${String(index + 1).padStart(2, "0")}`));
    if (values.every((value) => value !== undefined)) sums.set(year, values.reduce((total, value) => total + (value ?? 0), 0));
  }
  const years = new Map<string, number>();
  for (const point of annual) if (/^\d{4}$/.test(point.date)) years.set(point.date, point.value);
  const periods = commonPeriods(sums, years, options.periods ?? 3);
  if (periods.length === 0) return { ...base, status: "no-overlap", compared: 0, disagreements: [] };
  const rows = periods.map((period) => ({ period, left: round(sums.get(period) ?? NaN), right: round(years.get(period) ?? NaN) }));
  const disagreements = rows.filter((row) => Math.abs(row.left - row.right) > options.tolerance);
  return { ...base, status: disagreements.length > 0 ? "mismatch" : "ok", compared: rows.length, disagreements, latest: rows[0] };
}

function round(value: number): number { return Math.round(value * 1000) / 1000; }

/**
 * The stored points of one side, from the store only. A catalog series can
 * hold more than one line when its NBS name changed between crawls (the store
 * keeps the old label's points), so an unlabelled reference reads the line
 * that reaches furthest.
 */
export function readSide(ref: SeriesRef, limit = 24): SeriesPoint[] {
  const catalog = ref.key.startsWith("nbs_");
  const stored = readSeries(ref.key, limit, ref.region ?? (catalog ? CATALOG_NATION : ""));
  if (!stored) return [];
  if (ref.label) return stored.series.find((series) => series.label === ref.label)?.points ?? [];
  const lines = stored.series.filter((series) => series.points.length > 0);
  lines.sort((a, b) => (b.points.at(-1)?.date ?? "").localeCompare(a.points.at(-1)?.date ?? ""));
  return lines[0]?.points ?? [];
}

/** Run every pair against the store. */
export function runConcordance(pairs: ConcordancePair[] = CONCORDANCE_PAIRS): ConcordanceResult[] {
  return pairs.map((pair) => {
    if (pair.kind === "value") return compareValues(pair.name, readSide(pair.left), readSide(pair.right), { tolerance: pair.tolerance, periods: pair.periods, leftOffset: pair.left.offset, rightOffset: pair.right.offset, note: pair.note });
    if (pair.kind === "annual") return compareAnnualSum(pair.name, readSide(pair.monthly, 12 * ((pair.periods ?? 3) + 1)), readSide(pair.annual, 12), { tolerance: pair.tolerance, periods: pair.periods, note: pair.note });
    return compareCumulative(pair.name, readSide(pair.period), readSide(pair.yearToDate), { tolerance: pair.tolerance, periods: pair.periods, note: pair.note });
  });
}

/** One line per result, for the log and the CLI. */
export function formatResult(result: ConcordanceResult): string {
  const latest = result.latest ? ` ${result.latest.period}: ${result.latest.left} vs ${result.latest.right}` : "";
  const bad = result.disagreements.length > 0 ? ` (${result.disagreements.map((row) => `${row.period} ${row.left}≠${row.right}`).join(", ")})` : "";
  const side = (range: SideRange) => range.points === 0 ? "nothing" : `${range.first}..${range.last}`;
  const ranges = result.status === "missing" || result.status === "no-overlap" ? ` [${side(result.sides.left)} vs ${side(result.sides.right)}]` : "";
  return `${result.status.padEnd(10)} ${result.name}${latest}${bad}${ranges}`;
}

if (import.meta.main) {
  const results = runConcordance();
  for (const result of results) console.log(formatResult(result));
  const findings = results.filter((result) => result.status === "mismatch");
  console.log(`${results.length} pairs, ${findings.length} findings`);
  process.exit(findings.length > 0 ? 1 : 0);
}
