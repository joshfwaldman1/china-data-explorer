/**
 * Release-day checks for publishers that announce no calendar.
 *
 * NBS publishes an agenda to the minute and Customs a calendar to the day;
 * both feed the release refresh in app.ts, which checks ten minutes after
 * the release. The central bank, the finance ministry, SAFE, the commerce
 * ministry and the energy administration announce nothing ahead, so their
 * figures waited for the next fixed sweep: a PBOC release after 16:10
 * Beijing time sat until 10:10 the next morning.
 *
 * Each of them does publish in a recognisable stretch of the month. Inside
 * that stretch, during Beijing working hours, the scheduler checks once an
 * hour for the series still one month behind (last month's figure not yet
 * stored) and fetches only those. A series stops being checked the moment its
 * figure arrives, and a series further behind than one month (discontinued,
 * or published on a longer lag) is left to the daily ingest rather than
 * polled all window long.
 *
 * The windows are wide on purpose. They come from when these releases have
 * arrived, not from any published rule; a release outside its window is
 * still caught by the sweeps and the daily ingest, only later.
 */

export interface PublisherWindow {
  agency: string;
  /** First and last day of the month, inclusive, in Beijing time. */
  days: [number, number];
  /** First and last hour checked, inclusive, in Beijing time. */
  hours: [number, number];
  /** What the window is for, for the status route. */
  note: string;
}

export const PUBLISHER_WINDOWS: PublisherWindow[] = [
  { agency: "People's Bank of China", days: [7, 18], hours: [9, 21], note: "Reserves around the 7th; money, loans and total social financing around the 10th to 17th, often late afternoon" },
  { agency: "Ministry of Finance", days: [12, 28], hours: [9, 21], note: "Fiscal revenue and spending mid-month; local government bonds later in the month" },
  { agency: "State Administration of Foreign Exchange", days: [14, 28], hours: [9, 21], note: "FX settlement and cross-border flows in the second half of the month" },
  { agency: "Ministry of Commerce", days: [12, 25], hours: [9, 21], note: "Foreign direct investment in the second half of the month" },
  { agency: "National Energy Administration", days: [14, 25], hours: [9, 21], note: "Electricity consumption in the second half of the month" },
];

export interface WindowSeries { key: string; agency: string; frequency: string; ended?: string }
export interface StoredPeriod { key: string; lastPeriod: string | null }

/** Beijing time is UTC+8 with no daylight saving. */
function beijing(now: Date): { year: number; month: number; day: number; hour: number } {
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate(), hour: shifted.getUTCHours() };
}

function monthLabel(year: number, month: number): string {
  const whole = year * 12 + (month - 1);
  return `${Math.floor(whole / 12)}-${String((whole % 12) + 1).padStart(2, "0")}`;
}

/** The windows open at this moment. */
export function activeWindows(now: Date, windows: PublisherWindow[] = PUBLISHER_WINDOWS): PublisherWindow[] {
  const { day, hour } = beijing(now);
  return windows.filter((window) => day >= window.days[0] && day <= window.days[1] && hour >= window.hours[0] && hour <= window.hours[1]);
}

/** The month a release this month reports: last month, in Beijing time. */
export function reportedMonth(now: Date): string {
  const { year, month } = beijing(now);
  return monthLabel(year, month - 1);
}

/**
 * The monthly series of the open windows' publishers that are exactly one
 * month behind: they hold the month before the reported one and not the
 * reported one. Several stored places of one key count as the latest of them.
 */
export function keysAwaitingRelease(series: WindowSeries[], stored: StoredPeriod[], now: Date, windows: PublisherWindow[] = PUBLISHER_WINDOWS): string[] {
  const open = new Set(activeWindows(now, windows).map((window) => window.agency));
  if (open.size === 0) return [];
  const target = reportedMonth(now);
  const { year, month } = beijing(now);
  const oneBehind = monthLabel(year, month - 2);
  const latest = new Map<string, string>();
  for (const row of stored) {
    if (!row.lastPeriod) continue;
    const previous = latest.get(row.key);
    if (!previous || row.lastPeriod > previous) latest.set(row.key, row.lastPeriod);
  }
  return series
    .filter((entry) => open.has(entry.agency) && entry.frequency === "Monthly" && !entry.ended)
    .filter((entry) => latest.get(entry.key) === oneBehind && latest.get(entry.key) !== target)
    .map((entry) => entry.key);
}
