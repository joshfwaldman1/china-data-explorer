/**
 * When is a stored NBS series worth re-checking?
 *
 * NBS publishes on a fixed rhythm: a month's figures come out between the
 * 9th and the 20th of the following month, a quarter's with the GDP release
 * around the 16th of the month after the quarter ends. So a series is "due"
 * once the calendar has passed the window for the period after the latest
 * one we hold. Checking everything every day would be 15,000 requests a day
 * for a portal that changes a few thousand series a month; checking what is
 * due is a few hundred on a release day and nothing on the others.
 *
 * Full-history revision checks have their own clock. A successful recent
 * fetch must not postpone the next audit of observations outside its window.
 */

export const REVISION_CHECK_DAYS = 45;
export interface FullHistoryCheckState {
  lastFullHistoryCheck: string | null;
  /** A persisted, staggered deadline for a store whose earlier fetch windows are unknown. */
  firstFullHistoryCheckDueAt: string | null;
}

export function isFullHistoryCheckDue(state: FullHistoryCheckState, now: Date): boolean {
  const lastFull = state.lastFullHistoryCheck ? Date.parse(state.lastFullHistoryCheck) : NaN;
  if (Number.isFinite(lastFull)) return now.getTime() >= lastFull + REVISION_CHECK_DAYS * 86400000;
  const firstDue = state.firstFullHistoryCheckDueAt ? Date.parse(state.firstFullHistoryCheckDueAt) : NaN;
  return !Number.isFinite(firstDue) || now.getTime() >= firstDue;
}
/**
 * Day of month by which a month's or quarter's NBS releases are normally all
 * out. Another publisher passes its own: Customs' preliminary release is out
 * by the 14th (server/customs-calendar.ts).
 */
export const RELEASE_DAY = 20;

/** "YYYY-MM" of the month `offset` months before `now` (offset 1 = last month). */
function monthBefore(now: Date, offset: number): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The latest period whose NBS release window has closed, in the store's period form. */
export function expectedPeriod(frequency: string, now: Date, releaseDay = RELEASE_DAY): string {
  const day = now.getUTCDate();
  if (frequency === "Monthly") return monthBefore(now, day >= releaseDay ? 1 : 2);
  if (frequency === "Quarterly") {
    // Walk back to the most recent quarter end whose release day has passed.
    for (let offset = 1; offset <= 4; offset += 1) {
      const candidate = monthBefore(now, offset);
      const month = Number(candidate.slice(5, 7));
      if (month % 3 !== 0) continue;
      const releaseMonth = new Date(Date.UTC(Number(candidate.slice(0, 4)), month, releaseDay)); // month index = quarter-end month + 1
      if (now.getTime() >= releaseMonth.getTime()) return candidate;
    }
    return monthBefore(now, 6);
  }
  // Annual tables arrive in the following spring.
  return String(now.getUTCFullYear() - (now.getUTCMonth() >= 2 ? 1 : 2));
}

/** Normalise "YYYY-Qn" to the quarter's last month so periods compare as strings. */
export function comparablePeriod(period: string): string {
  const quarter = period.match(/^(\d{4})-Q([1-4])$/);
  return quarter ? `${quarter[1]}-${String(Number(quarter[2]) * 3).padStart(2, "0")}` : period;
}

/**
 * True when the store's latest period for a series is older than what NBS
 * should have published by `now`, or when it has not been checked for a while.
 */
/**
 * Why a series is due, or null when it is not.
 *
 * "new-period" means the calendar says another observation should exist, which
 * is answered by asking for the last two years. An overdue "revision" takes
 * precedence even if the newest period is also missing: the full request can
 * answer both, while a recent request cannot find a restatement of 2019.
 */
export function dueReason(frequency: string, lastPeriod: string | null, lastChecked: string | null, now: Date, releaseDay = RELEASE_DAY, fullHistory?: FullHistoryCheckState): "new-period" | "revision" | null {
  if (!lastPeriod || !lastChecked) return "new-period";
  const checked = new Date(lastChecked).getTime();
  if (!Number.isFinite(checked)) return "new-period";
  const revisionDue = fullHistory
    ? isFullHistoryCheckDue(fullHistory, now)
    : now.getTime() - checked > REVISION_CHECK_DAYS * 86400000;
  if (revisionDue) return "revision";
  const expected = expectedPeriod(frequency, now, releaseDay);
  if (comparablePeriod(lastPeriod) >= expected) return null;
  // Behind the calendar. Worth a check once the window for the expected
  // period has closed, but not every day after: thousands of catalog series
  // are discontinued or are year-range slices that will never gain a period,
  // and checking those daily is the whole crawl's cost for nothing. After a
  // check made since the window closed, wait for the revision interval.
  return checked < windowClosedAt(frequency, expected, releaseDay).getTime() ? "new-period" : null;
}

export function isDue(frequency: string, lastPeriod: string | null, lastChecked: string | null, now: Date, releaseDay = RELEASE_DAY, fullHistory?: FullHistoryCheckState): boolean {
  return dueReason(frequency, lastPeriod, lastChecked, now, releaseDay, fullHistory) !== null;
}

/** When the release window for `period` closed: the 20th of the month after its last month (the next spring for a year). */
export function windowClosedAt(frequency: string, period: string, releaseDay = RELEASE_DAY): Date {
  if (frequency === "Annual") return new Date(Date.UTC(Number(period) + 1, 2, releaseDay));
  const last = comparablePeriod(period);
  const year = Number(last.slice(0, 4)), month = Number(last.slice(5, 7));
  return new Date(Date.UTC(year, month, releaseDay)); // month index = last month + 1
}
