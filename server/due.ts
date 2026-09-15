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
 * Revisions are still caught: every check compares all values, and a series
 * that has not been checked for `REVISION_CHECK_DAYS` is due regardless.
 */

export const REVISION_CHECK_DAYS = 45;
/** Day of month by which a month's or quarter's NBS releases are normally all out. */
const RELEASE_DAY = 20;

/** "YYYY-MM" of the month `offset` months before `now` (offset 1 = last month). */
function monthBefore(now: Date, offset: number): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The latest period whose NBS release window has closed, in the store's period form. */
export function expectedPeriod(frequency: string, now: Date): string {
  const day = now.getUTCDate();
  if (frequency === "Monthly") return monthBefore(now, day >= RELEASE_DAY ? 1 : 2);
  if (frequency === "Quarterly") {
    // Walk back to the most recent quarter end whose release day has passed.
    for (let offset = 1; offset <= 4; offset += 1) {
      const candidate = monthBefore(now, offset);
      const month = Number(candidate.slice(5, 7));
      if (month % 3 !== 0) continue;
      const releaseMonth = new Date(Date.UTC(Number(candidate.slice(0, 4)), month, RELEASE_DAY)); // month index = quarter-end month + 1
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
 * is answered by asking for the last two years. "revision" means the series is
 * current but has not been re-read within the revision interval, which is the
 * one that has to ask for the whole history: a restatement of 2019 is invisible
 * in a recent window.
 */
export function dueReason(frequency: string, lastPeriod: string | null, lastChecked: string | null, now: Date): "new-period" | "revision" | null {
  if (!isDue(frequency, lastPeriod, lastChecked, now)) return null;
  if (!lastPeriod || !lastChecked) return "new-period";
  const checked = new Date(lastChecked).getTime();
  if (!Number.isFinite(checked)) return "new-period";
  if (comparablePeriod(lastPeriod) < expectedPeriod(frequency, now)) return "new-period";
  return "revision";
}

export function isDue(frequency: string, lastPeriod: string | null, lastChecked: string | null, now: Date): boolean {
  if (!lastPeriod || !lastChecked) return true;
  const checked = new Date(lastChecked).getTime();
  if (!Number.isFinite(checked)) return true;
  if (now.getTime() - checked > REVISION_CHECK_DAYS * 86400000) return true;
  const expected = expectedPeriod(frequency, now);
  if (comparablePeriod(lastPeriod) >= expected) return false;
  // Behind the calendar. Worth a check once the window for the expected
  // period has closed, but not every day after: thousands of catalog series
  // are discontinued or are year-range slices that will never gain a period,
  // and checking those daily is the whole crawl's cost for nothing. After a
  // check made since the window closed, wait for the revision interval.
  return checked < windowClosedAt(frequency, expected).getTime();
}

/** When the release window for `period` closed: the 20th of the month after its last month (the next spring for a year). */
export function windowClosedAt(frequency: string, period: string): Date {
  if (frequency === "Annual") return new Date(Date.UTC(Number(period) + 1, 2, RELEASE_DAY));
  const last = comparablePeriod(period);
  const year = Number(last.slice(0, 4)), month = Number(last.slice(5, 7));
  return new Date(Date.UTC(year, month, RELEASE_DAY)); // month index = last month + 1
}
