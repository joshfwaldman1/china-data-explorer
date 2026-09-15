/**
 * What one release is expected to deliver, and what is still missing.
 *
 * A release on the bureau's calendar is an event; the work it implies is a set
 * of (frequency, period) targets, and a refresh is finished when every one of
 * them is stored, not when any one of them moves. Keeping that in a module of
 * its own is what makes it testable: the scheduler in app.ts had it as a few
 * expressions inside a closure, where a bundle that publishes a month and a
 * quarter at once, or a release whose period is the month it is published in,
 * could not be checked without waiting for the release.
 *
 * Three rules the bureau's calendar actually follows:
 *
 *  - Most monthly releases report the month before the one they appear in.
 *    The purchasing managers' index does not: it is published on the last day
 *    of the month it describes, and when a holiday moves it into the next
 *    month (February 2026's came out on 4 March) it still describes the month
 *    that ended.
 *  - The January, April, July and October "national economy" briefing carries
 *    the quarter as well as the month. One event, two frequencies.
 *  - Periods reach this code in two shapes, "2026-Q2" from the catalog and
 *    "2026-06" from the mirrors, and "2026-Q2" > "2026-06" as strings. Every
 *    comparison here goes through comparablePeriod first.
 */

import { comparablePeriod } from "./due";

export type ReleaseFrequency = "Monthly" | "Quarterly";

export interface ReleaseTarget {
  frequency: ReleaseFrequency;
  /** The period the release reports, as a quarter-end month: "2026-08", "2026-06". */
  period: string;
}

/** A series the release is expected to move, and where it stands. */
export interface StoredSeries {
  key: string;
  region: string;
  frequency?: string;
  lastPeriod: string | null;
}

function monthLabel(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The month before the one `at` falls in. */
function previousMonth(at: Date): string {
  return monthLabel(new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - 1, 1)));
}

/** The quarter-end month of the most recent complete quarter before `at`. */
function previousQuarterEnd(at: Date): string {
  let month = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1) - 1);
  while ((month.getUTCMonth() + 1) % 3 !== 0) month = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1) - 1);
  return monthLabel(month);
}

/**
 * The month a purchasing managers' index release reports: the month it is
 * published in, unless a holiday pushed publication past the month end, in
 * which case it is the month that just ended. Published on the 1st to the 5th
 * is treated as the previous month; anything later is the current one.
 */
function pmiMonth(at: Date): string {
  return at.getUTCDate() <= 5 ? previousMonth(at) : monthLabel(at);
}

export interface ReleaseShape {
  /** The agenda title, for the rules that depend on which release this is. */
  title: string;
  /** Curated keys the release moves. */
  keys: string[];
  /** Catalog categories the release updates. */
  categories: string[];
}

/**
 * Every (frequency, period) a release is expected to deliver. A quarterly
 * bundle carries both its month and its quarter; the rest carry one.
 */
export function releaseTargets(release: ReleaseShape, at: Date): ReleaseTarget[] {
  const title = release.title;
  if (/采购经理指数/.test(title)) return [{ frequency: "Monthly", period: pmiMonth(at) }];

  const quarterlyOnly = /国内生产总值|居民收支|产能利用率|文化及相关产业|季度/.test(title);
  if (quarterlyOnly) return [{ frequency: "Quarterly", period: previousQuarterEnd(at) }];

  const monthly: ReleaseTarget = { frequency: "Monthly", period: previousMonth(at) };
  // The national economy briefing in the first month of a quarter announces the
  // quarter as well: one event, a month and a quarter to account for.
  const quarterMonths = new Set([1, 4, 7, 10]);
  if (/国民经济运行情况/.test(title) && quarterMonths.has(at.getUTCMonth() + 1)) {
    return [monthly, { frequency: "Quarterly", period: previousQuarterEnd(at) }];
  }
  return [monthly];
}

/**
 * The targets a release still owes, given what the store holds.
 *
 * A series counts for a target when its frequency matches and it holds a period
 * at least as recent as the target's. Series are counted per (key, region): a
 * province that has the new month does not stand in for one that has not.
 */
export function outstandingTargets(targets: ReleaseTarget[], stored: StoredSeries[]): ReleaseTarget[] {
  return targets.filter((target) => stored.some((series) => {
    if (series.frequency && frequencyOf(series.frequency) !== target.frequency) return false;
    return comparablePeriod(series.lastPeriod ?? "") < target.period;
  }));
}

function frequencyOf(frequency: string): ReleaseFrequency | "Other" {
  return frequency === "Monthly" ? "Monthly" : frequency === "Quarterly" ? "Quarterly" : "Other";
}

/**
 * Whether a release refresh is finished: every series the release covers holds
 * a period at least as recent as the target for its frequency.
 *
 * The old rule counted any advance as progress and stopped retrying, so one
 * series arriving early ended the retries for everything else in the same
 * release.
 */
export function releaseComplete(targets: ReleaseTarget[], stored: StoredSeries[]): boolean {
  if (stored.length === 0) return false;
  return outstandingTargets(targets, stored).length === 0;
}

/** How many of the covered series still lack their target period. */
export function pendingSeries(targets: ReleaseTarget[], stored: StoredSeries[]): StoredSeries[] {
  return stored.filter((series) => {
    const frequency = frequencyOf(series.frequency ?? "Monthly");
    const target = targets.find((item) => item.frequency === frequency) ?? targets[0];
    if (!target) return false;
    return comparablePeriod(series.lastPeriod ?? "") < target.period;
  });
}
