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

import { CATALOG, catalogList, seriesRegions } from "./data";
import { CONCORDANCE_PAIRS, runConcordance, type ConcordanceResult } from "./concordance";
import { dbHealth, fetchFailures, fetchLogOldest, lastSuccessByKey, latestPeriods, singlePointLines } from "./db";
import { comparablePeriod, expectedPeriod } from "./due";
import { pressReleaseHealth, type PressReleaseHealth } from "./nbs-releases";

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

/**
 * A curated line holding a single period. The parser may have invented it (a
 * number read as a unit label names a line of its own), the publisher may have
 * renamed the line or changed its unit so that it split in two, or the line is
 * new. Any of them is worth a person's look.
 */
export interface SinglePointSeries {
  key: string;
  title: string;
  /** The region's stored value (a slug or an NBS code), for the link. */
  region: string;
  /** What the series page calls the region: "Medical and pharmaceutical products", not its slug. */
  regionName: string;
  /** Set when a person has looked at the line and written down why it is so; it then no longer counts as a fault. */
  reviewed?: string;
  label: string;
  period: string | null;
}

/**
 * Single-point lines a person has looked at, with the reason in one line. A
 * reviewed line is still listed, apart, so it is not lost; it stops counting in
 * the headline so the banner can clear. Remove an entry once its cause is fixed
 * and the line is gone. Keyed by key, region and label.
 */
export const REVIEWED_SINGLE_POINT_LINES: { key: string; region: string; label: string; reason: string }[] = [
  // The proper fix is queued in DATASET_QUEUE.md: fold "Ton" into "10,000 Tons" in the Customs adapter.
  ...["major_exports", "major_exports_cny"].map((key) => ({
    key, region: "medical-and-pharmaceutical-products", label: "Quantity (Ton)",
    reason: "Customs changed this quantity from tons to 10,000 tons in March 2026, so the line split in two.",
  })),
];

/** The reason a single-point line was reviewed, or undefined when nobody has looked at it. */
export function reviewedReason(line: { key: string; region: string; label: string }): string | undefined {
  return REVIEWED_SINGLE_POINT_LINES.find((entry) => entry.key === line.key && entry.region === line.region && entry.label === line.label)?.reason;
}

export interface HealthReport {
  ranAt: string;
  checks: { total: number; ok: number; findings: Finding[]; missing: string[] };
  sources: { failing: FailingSource[]; recovered: FailingSource[]; crawl: CrawlFailures; consideredSince: string };
  behind: { publisher: BehindSeries[]; blocked: BehindSeries[]; ended: BehindSeries[] };
  /** Curated lines with one point, from the per-line count the write path keeps. */
  singlePoint: SinglePointSeries[];
  store: { observations: number; keys: number; lastFetch: string | null };
  /**
   * NBS release pages read in shadow mode (server/nbs-releases.ts). A figure
   * that disagrees with the store is a finding like a cross-check's, and a
   * refused page is a source not reading; neither is served, so they are
   * reported apart from the curated sources.
   */
  pressReleases: PressReleaseHealth;
}

/**
 * The newest period a curated series ought to have by now.
 *
 * By the key's own release day where it states one: the finance ministry
 * publishes on the 25th and the bond release on the 12th, and a rule that
 * expected August from everything on the 20th listed nine ministry series as
 * behind on the 22nd — three of which genuinely were, six of which were three
 * days from being due. A key that states no day is expected only once the
 * following month has ended. That is late for a series published on the 9th
 * and right for one published on the 27th, and on a page whose purpose is to
 * say what is wrong, a false "behind" costs more than a late one.
 */
const WHEN_UNSTATED = 31;

function overdue(frequency: string, lastPeriod: string | null, releaseDay: number | undefined): { expected: string; late: boolean } {
  const expected = expectedPeriod(frequency, new Date(), releaseDay ?? WHEN_UNSTATED);
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
 * page opened with "12187 sources not reading", which is both true and
 * useless. Here they are a volume and a set of reasons.
 */
/** A failure's reason in the reader's words, never the runtime's ("pass verbose: true to fetch()"). */
export function crawlReason(message: string): string {
  const text = (message || "").replace(/nbs_[0-9a-f]{8,}/g, "a series").trim();
  if (!text) return "no reason recorded";
  if (/socket connection was closed|ECONNRESET|socket hang up/i.test(text)) return "the connection dropped mid-request";
  if (/timed out|timeout/i.test(text)) return "the request timed out";
  if (/grid with no values/i.test(text)) return "the bureau's index lists them with no values behind them";
  if (/HTTP (\d{3})/.test(text)) return `the portal answered HTTP ${text.match(/HTTP (\d{3})/)![1]}`;
  return text.replace(/\s*For more information.*$/i, "").replace(/\.$/, "");
}

function crawlFailures(rows: { key: string; failures: number; message: string }[]): CrawlFailures {
  const byReason = new Map<string, number>();
  let attempts = 0;
  for (const row of rows) {
    attempts += row.failures;
    // The message carries the series id in some phrasings; the reason is the shape of it.
    const reason = crawlReason(row.message);
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

  // A source is a curated key. The audit logs its own past mismatches under
  // "concordance", which is not a source and never logs a success, so it could
  // never read as recovered — while the checks section above already says
  // whether anything disagrees now. And a key this deployment cannot refresh
  // is a missing service, listed under "blocked" below, not a parse failure.
  const blockedKeys = new Set(catalogList().filter((entry) => entry.refreshBlocked).map((entry) => entry.key));
  const curatedRows = failures.filter((row) => !isCrawlKey(row.key) && CATALOG[row.key] !== undefined && !blockedKeys.has(row.key));
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
    const { expected, late } = overdue(entry.frequency, lastPeriod, entry.releaseDay);
    if (!late) continue;
    const row: BehindSeries = { key: entry.key, title: entry.title, agency: entry.agency, frequency: entry.frequency, lastPeriod, expected };
    if (entry.ended) ended.push({ ...row, ended: entry.ended });
    else if (entry.refreshBlocked) blocked.push({ ...row, blocked: entry.refreshBlocked });
    else publisher.push(row);
  }
  // Curated keys only, for the same reason as the newest periods above; and
  // read from series.periods, so this never counts observations.
  const singlePoint: SinglePointSeries[] = singlePointLines(entries.map((entry) => entry.key))
    .map((line) => {
      const place = line.region ? seriesRegions(line.key).find((region) => region.value === line.region) : undefined;
      const reviewed = reviewedReason(line);
      return { ...line, title: CATALOG[line.key]?.title ?? line.key, regionName: place ? (place.en ?? place.text) : line.region, ...(reviewed ? { reviewed } : {}) };
    });

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
    singlePoint,
    store: { observations: health.observations, keys: latestByKey.size, lastFetch: health.lastFetch },
    pressReleases: pressReleaseHealth(),
  };
}

/** One line saying whether anything needs attention, for the page's heading. */
export function healthHeadline(report: HealthReport): string {
  const parts: string[] = [];
  if (report.checks.findings.length > 0) parts.push(`${report.checks.findings.length} cross-check${report.checks.findings.length === 1 ? "" : "s"} disagreeing`);
  if (report.sources.failing.length > 0) parts.push(`${report.sources.failing.length} source${report.sources.failing.length === 1 ? "" : "s"} not reading`);
  if (report.behind.publisher.length > 0) parts.push(`${report.behind.publisher.length} series behind`);
  // Counted so the banner agrees with the list below it.
  // Reviewed lines are listed on the page but are not a fault, so the banner can clear.
  const single = (report.singlePoint ?? []).filter((line) => !line.reviewed).length;
  if (single > 0) parts.push(`${single} line${single === 1 ? "" : "s"} with a single point`);
  // Optional so a report built before the shadow reader existed still reads.
  const pressDisagreements = report.pressReleases?.disagreements.length ?? 0;
  const pressRefused = report.pressReleases?.refused.length ?? 0;
  if (pressDisagreements > 0) parts.push(`${pressDisagreements} press-release figure${pressDisagreements === 1 ? "" : "s"} disagreeing with the database`);
  if (pressRefused > 0) parts.push(`${pressRefused} press release${pressRefused === 1 ? "" : "s"} the parser refused`);
  if (parts.length === 0) return `All ${report.checks.total} cross-checks agree, every source read cleanly, nothing overdue.`;
  return `${parts.join("; ")}.`;
}
