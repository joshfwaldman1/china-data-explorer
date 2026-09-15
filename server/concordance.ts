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

export type ConcordancePair = ValuePair | CumulativePair;

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
    left: { key: "trade", label: "Exports (YoY %)" },
    right: { key: "nbs_788f44b0f310403fbd308b77d6f83890" }, // 出口总值同比增长 (%)
    // Customs revises the previous month with each release and the two paths
    // pick up the revision at different times: on 15 September 2026 the
    // mirror held 26.9, 19.2 and 14.0 for June, May and April against NBS's
    // 27.0, 19.4 and 14.1, with July equal on both. A tenth or two is that;
    // anything larger is a different statistic.
    tolerance: 0.25,
    note: "Customs quotes the rate in USD terms on its English site and CNY on its Chinese one; NBS's table carries the USD rate. Revised months can differ by 0.1-0.2 pp between the mirror and NBS.",
  },
  {
    name: "Surveyed urban unemployment (%)", kind: "value",
    left: { key: "unemployment", label: "Surveyed urban (%)" },
    right: { key: "nbs_3888eac6062945a79c8a27e5f13d4953" }, // 全国城镇调查失业率 (%)
    tolerance: 0.05,
    note: "The same NBS table by two paths: the curated ingest and the catalog crawl.",
  },
];

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
  const firstOfYear = (p: string) => /-0[1-3]$/.test(p); // January, February or Q1 (as 03)
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

function round(value: number): number { return Math.round(value * 1000) / 1000; }

/**
 * The stored points of one side, from the store only. A catalog series can
 * hold more than one line when its NBS name changed between crawls (the store
 * keeps the old label's points), so an unlabelled reference reads the line
 * that reaches furthest.
 */
export function readSide(ref: SeriesRef, limit = 24): SeriesPoint[] {
  const catalog = ref.key.startsWith("nbs_");
  const stored = readSeries(ref.key, limit, catalog ? CATALOG_NATION : "");
  if (!stored) return [];
  if (ref.label) return stored.series.find((series) => series.label === ref.label)?.points ?? [];
  const lines = stored.series.filter((series) => series.points.length > 0);
  lines.sort((a, b) => (b.points.at(-1)?.date ?? "").localeCompare(a.points.at(-1)?.date ?? ""));
  return lines[0]?.points ?? [];
}

/** Run every pair against the store. */
export function runConcordance(pairs: ConcordancePair[] = CONCORDANCE_PAIRS): ConcordanceResult[] {
  return pairs.map((pair) => pair.kind === "value"
    ? compareValues(pair.name, readSide(pair.left), readSide(pair.right), { tolerance: pair.tolerance, periods: pair.periods, leftOffset: pair.left.offset, rightOffset: pair.right.offset, note: pair.note })
    : compareCumulative(pair.name, readSide(pair.period), readSide(pair.yearToDate), { tolerance: pair.tolerance, periods: pair.periods, note: pair.note }));
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
