/**
 * What is wrong with the data right now, on one page.
 *
 * The site does a lot of checking and showed none of it. Every night it
 * compares 54 pairs of series that ought to agree; every ingest run records
 * what it fetched and what it could not. Both lived behind API paths that a
 * person had to know about and curl. Nothing on the site said "this source
 * has been failing since the 7th".
 *
 * That is not a cosmetic gap. Customs changed the wording of the unit line
 * above its tables in about 2022, the parser refused every older month, and
 * "22 of 55 months failed to parse" repeated on every run for as long as the
 * fetch log goes back — while the page looked healthy, because the months it
 * could read were the recent ones. The check that would have caught it had
 * been running and reporting the whole time, into a log nobody reads.
 *
 * So this assembles the three things that can be wrong, in the order a reader
 * should care about them:
 *
 *  - A **finding**: two readings of the same statistic disagree. Something on
 *    the site may be wrong, and that is the worst case.
 *  - A **failing source**: a publisher's page is there and the site cannot
 *    read it. Nothing shown is wrong; something is missing, and silently.
 *  - A **series behind**: the newest figure is older than its release cadence
 *    implies, separated into publishers that have gone quiet and series this
 *    deployment cannot refresh, because those are different problems and only
 *    one of them is ours.
 *
 * Everything here is read from the store and the audit. Nothing fetches, so
 * the page costs a publisher nothing however often it is opened.
 */

import { CATALOG, catalogList } from "./data";
import { CONCORDANCE_PAIRS, runConcordance, type ConcordanceResult } from "./concordance";
import { dbHealth, fetchFailures, fetchLogOldest, lastSuccessByKey, latestPeriods } from "./db";
import { comparablePeriod, expectedPeriod } from "./due";

/** A pair of readings that disagree, with enough to act on it. */
export interface Finding {
  name: string;
  kind: string;
  /** The newest period compared and the two values. */
  latest?: { period: string; left: number; right: number };
  /** Every period that disagrees, newest first. */
  disagreements: { period: string; left: number; right: number }[];
  note?: string;
}

/** A source the ingest could not read, and how long it has been that way. */
export interface FailingSource {
  key: string;
  title: string;
  agency: string;
  /** How many of the recorded failures are this key's. */
  failures: number;
  /** The oldest and newest recorded failure for it. */
  since: string;
  latest: string;
  message: string;
  /** Set when a successful fetch has happened since the last failure: the source has recovered. */
  recoveredAt?: string;
}

/** A curated series whose newest figure is older than it should be. */
export interface BehindSeries {
  key: string;
  title: string;
  agency: string;
  frequency: string;
  lastPeriod: string | null;
  expected: string;
  /** Set when the site, not the publisher, is the reason it cannot advance. */
  blocked?: string;
  /** Set when the publisher has stopped the series for good. */
  ended?: string;
}

/** The crawl's own failures, which are a volume to watch rather than a list to read. */
export interface CrawlFailures {
  /** Distinct catalog series that failed at least once in the window. */
  series: number;
  /** Attempts, since one series failing daily is not the same as many failing once. */
  attempts: number;
  /** The reasons, commonest first, with how many series each accounts for. */
  reasons: { reason: string; series: number }[];
}

export interface HealthReport {
  ranAt: string;
  checks: { total: number; ok: number; findings: Finding[]; missing: string[] };
  sources: { failing: FailingSource[]; recovered: FailingSource[]; crawl: CrawlFailures; consideredSince: string };
  behind: { publisher: BehindSeries[]; blocked: BehindSeries[]; ended: BehindSeries[] };
  store: { observations: number; keys: number; lastFetch: string | null };
}

/** The newest period a curated series ought to have by now. */
function overdue(frequency: string, lastPeriod: string | null): { expected: string; late: boolean } {
  const expected = expectedPeriod(frequency, new Date());
  if (!lastPeriod) return { expected, late: true };
  return { expected, late: comparablePeriod(lastPeriod) < comparablePeriod(expected) };
}

/**
 * Group the recorded failures by series. The fetch log holds one row per
 * attempt, so a source that fails every run appears many times; what a reader
 * needs is that it is one source, failing since a date, for one reason.
 */
function failingSources(rows: { key: string; failures: number; since: string; latest: string; message: string }[]): FailingSource[] {
  return rows.map((row) => {
    const config = CATALOG[row.key];
    return {
      key: row.key,
      title: config?.title ?? row.key,
      agency: config?.agency ?? "",
      failures: row.failures,
      since: row.since,
      latest: row.latest,
      message: row.message ?? "",
    };
  });
}

/**
 * The catalog crawl's failures, counted rather than listed.
 *
 * The crawl walks 66,000 NBS series, and a good many of them are entries the
 * bureau lists with nothing behind them — it answers with a grid and no
 * values. That is a fact about the bureau's index, not a fault to chase, and
 * there are twelve thousand of them. Listed one per line beside the curated
 * sources they buried the real news completely: the first version of this
 * page opened with "12187 sources failing to parse", which is both true and
 * useless. Here they are a volume and a set of reasons.
 */
function crawlFailures(rows: { key: string; failures: number; message: string }[]): CrawlFailures {
  const byReason = new Map<string, number>();
  let attempts = 0;
  for (const row of rows) {
    attempts += row.failures;
    // The message carries the series id in some phrasings; the reason is the shape of it.
    const reason = (row.message || "no reason recorded").replace(/nbs_[0-9a-f]{8,}/g, "a series").trim();
    byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
  }
  return {
    series: rows.length,
    attempts,
    reasons: [...byReason.entries()].map(([reason, series]) => ({ reason, series })).sort((left, right) => right.series - left.series).slice(0, 6),
  };
}

/** A catalog series, as the crawl stores it, rather than one of the curated keys. */
const isCrawlKey = (key: string) => key.startsWith("nbs_") && !CATALOG[key];

/**
 * The whole report. `results` is injectable so a test can state what the audit
 * found rather than depending on whatever the store happens to hold.
 */
export function healthReport(results: ConcordanceResult[] = runConcordance(CONCORDANCE_PAIRS), options: { windowDays?: number } = {}): HealthReport {
  // A fortnight by default: long enough that a weekly source failing once is
  // still visible, short enough that a fault fixed last month is not.
  const since = new Date(Date.now() - (options.windowDays ?? 14) * 86_400_000).toISOString();
  const failures = fetchFailures(since);
  const health = dbHealth();

  const curatedRows = failures.filter((row) => !isCrawlKey(row.key));
  const successes = lastSuccessByKey(curatedRows.map((row) => row.key));
  const curatedFailures = failingSources(curatedRows).map((source) => {
    const ok = successes.get(source.key);
    return ok && ok > source.latest ? { ...source, recoveredAt: ok } : source;
  });

  const findings: Finding[] = results
    .filter((result) => result.status === "mismatch")
    .map((result) => ({ name: result.name, kind: result.kind, latest: result.latest, disagreements: result.disagreements, note: result.note }));

  // Newest stored period, asked for the curated keys only. Asking for all of
  // them joins three tables across every series the catalog crawl ever stored,
  // to answer a question about the hundred and fifty that are curated.
  const entries = catalogList();
  const latestByKey = latestPeriods(entries.map((entry) => entry.key));

  const publisher: BehindSeries[] = [], blocked: BehindSeries[] = [], ended: BehindSeries[] = [];
  for (const entry of entries) {
    // Series held by other institutions about China are on their own schedules
    // and are comparisons, not this site's obligation to be timely about.
    if (entry.source === "fred") continue;
    const lastPeriod = latestByKey.get(entry.key) ?? null;
    const { expected, late } = overdue(entry.frequency, lastPeriod);
    if (!late) continue;
    const row: BehindSeries = { key: entry.key, title: entry.title, agency: entry.agency, frequency: entry.frequency, lastPeriod, expected };
    if (entry.ended) ended.push({ ...row, ended: entry.ended });
    else if (entry.refreshBlocked) blocked.push({ ...row, blocked: entry.refreshBlocked });
    else publisher.push(row);
  }
  const byAge = (left: BehindSeries, right: BehindSeries) => (left.lastPeriod ?? "").localeCompare(right.lastPeriod ?? "");

  return {
    ranAt: new Date().toISOString(),
    checks: {
      total: results.length,
      ok: results.filter((result) => result.status === "ok").length,
      findings,
      missing: results.filter((result) => result.status === "missing" || result.status === "no-overlap").map((result) => result.name),
    },
    sources: {
      // A failure is news only while it is the latest thing that happened to
      // the source. One whose newest failure is older than its newest success
      // has recovered, and is listed apart so it neither alarms nor is lost.
      failing: curatedFailures.filter((source) => !source.recoveredAt),
      recovered: curatedFailures.filter((source) => source.recoveredAt),
      crawl: crawlFailures(failures.filter((row) => isCrawlKey(row.key))),
      // The window the failures were counted over, floored at the oldest row
      // the log still holds, so "nothing failing" reads as "none since this".
      consideredSince: [since, fetchLogOldest() ?? since].sort().at(-1) ?? since,
    },
    behind: { publisher: publisher.sort(byAge), blocked: blocked.sort(byAge), ended: ended.sort(byAge) },
    store: { observations: health.observations, keys: latestByKey.size, lastFetch: health.lastFetch },
  };
}

/** One line saying whether anything needs attention, for the page's heading. */
export function healthHeadline(report: HealthReport): string {
  const parts: string[] = [];
  if (report.checks.findings.length > 0) parts.push(`${report.checks.findings.length} cross-check${report.checks.findings.length === 1 ? "" : "s"} disagreeing`);
  if (report.sources.failing.length > 0) parts.push(`${report.sources.failing.length} source${report.sources.failing.length === 1 ? "" : "s"} failing to parse`);
  if (report.behind.publisher.length > 0) parts.push(`${report.behind.publisher.length} series behind`);
  if (parts.length === 0) return `All ${report.checks.total} cross-checks agree, every source read cleanly, nothing overdue.`;
  return `${parts.join("; ")}.`;
}
