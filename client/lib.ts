/**
 * The chart's arithmetic, kept apart from React so it can be tested without
 * a DOM: period labels, number formatting, frequency conversion, rebasing.
 */

export interface SeriesPoint { date: string; value: number; }

export interface Track {
  id: string; name: string; unit: string; frequency: string; color: string; dash: string;
  points: { t: number; v: number; p: string }[];
  /** True when February holds the combined January-February figure, so a first quarter of two readings is whole. */
  combinedFebruary?: boolean;
}

export function isRate(unit: string): boolean { return /%|‰|percent|per thousand|index|=100/i.test(unit); }

/** How many decimals a value carries, to four: 552 has none, 484.8 one, 6.7828 four. */
function ownDecimals(value: number): number {
  const text = String(Math.round(Math.abs(value) * 10_000) / 10_000);
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : text.length - dot - 1;
}

export function fmt(value: number, unit: string): string {
  // A rate to one decimal; a level in the thousands to whole units; a smaller level as the
  // publisher wrote it (a parity of 6.7828, a flow of 552), never padded to "552.00".
  // Money-market and bond rates are quoted to two decimals (SHIBOR 1.46, a yield 1.69); other rates to one.
  const decimals = isRate(unit) ? (/fixing|close|yield|‰|per thousand/i.test(unit) ? 2 : 1) : Math.abs(value) >= 1000 ? 0 : ownDecimals(value);
  const text = value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  // A value that rounds to zero is zero, not "-0.0".
  return /^-0(\.0+)?$/.test(text) ? text.slice(1) : text;
}

export function fmtTick(value: number): string {
  if (Math.abs(value) >= 100000) return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** "14th", "21st", "2nd": the day of the month as English writes it. */
export function ordinal(day: number): string {
  const rest = day % 100;
  const suffix = rest >= 11 && rest <= 13 ? "th" : day % 10 === 1 ? "st" : day % 10 === 2 ? "nd" : day % 10 === 3 ? "rd" : "th";
  return `${day}${suffix}`;
}

export function fmtDate(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

/** A period label to a timestamp: months to the first of the month, quarters to their last month. */
export function periodTime(period: string): number {
  const quarter = period.match(/^(\d{4})-Q([1-4])$/);
  if (quarter) return Date.UTC(Number(quarter[1]), Number(quarter[2]) * 3 - 1, 1);
  const month = period.match(/^(\d{4})-(\d{2})/);
  if (month) return Date.UTC(Number(month[1]), Number(month[2]) - 1, 1);
  const year = period.match(/^(\d{4})$/);
  if (year) return Date.UTC(Number(year[1]), 11, 1);
  return Number.NaN;
}

export function periodPretty(period: string): string {
  const quarter = period.match(/^(\d{4})-Q([1-4])$/);
  if (quarter) return `Q${quarter[2]} ${quarter[1]}`;
  const month = period.match(/^(\d{4})-(\d{2})/);
  if (month) return new Date(Date.UTC(Number(month[1]), Number(month[2]) - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  return period;
}

export type TargetFrequency = "Quarterly" | "Annual";

export type Aggregation = "avg" | "sum" | "last";

export const FREQUENCY_RANK: Record<string, number> = { Monthly: 1, Quarterly: 2, Annual: 3 };

export function isTargetFrequency(value: string): value is TargetFrequency { return value === "Quarterly" || value === "Annual"; }

export function isAggregation(value: string): value is Aggregation { return value === "avg" || value === "sum" || value === "last"; }

/**
 * One key per calendar period for a table or CSV, so a native quarterly point
 * ("2026-06") and a monthly series aggregated to quarters ("2026-Q2") land on
 * the same row. Other frequencies keep the period as published.
 */
export function canonicalPeriod(period: string, frequency: string): string {
  if (frequency !== "Quarterly" || /^\d{4}-Q[1-4]$/.test(period)) return period;
  const t = periodTime(period);
  return Number.isFinite(t) ? periodOf(t, "Quarterly") : period;
}

export function periodOf(t: number, target: TargetFrequency): string {
  const date = new Date(t);
  return target === "Annual" ? String(date.getUTCFullYear()) : `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

/**
 * Aggregate a finer series to a coarser calendar period. Incomplete final
 * periods are dropped rather than shown as if they were whole — a quarter
 * built from one month is not a quarter.
 */
export function convertTrack(track: Track, target: TargetFrequency, agg: Aggregation): Track {
  if ((FREQUENCY_RANK[track.frequency] ?? 0) >= (FREQUENCY_RANK[target] ?? 0)) return track;
  const need = target === "Annual" ? (track.frequency === "Monthly" ? 12 : 4) : 3;
  const groups = new Map<string, number[]>();
  const closed = new Set<string>();
  for (const point of track.points) {
    const key = periodOf(point.t, target);
    groups.set(key, [...(groups.get(key) ?? []), point.v]);
    // The period is complete once its closing month is in: December for a year, the quarter's
    // last month for a quarter (quarterly points are dated by their last month too).
    const month = new Date(point.t).getUTCMonth() + 1;
    if (target === "Annual" ? month === 12 : month % 3 === 0) closed.add(key);
  }
  // Complete means the closing month is present and every reading is in, with one exception:
  // a series whose February holds the combined January-February figure has eleven points in a
  // year and two in a first quarter, and both are whole. A series that publishes a single
  // February and no January (passenger traffic) is genuinely short a month, and summing it
  // would understate the quarter, so those periods are dropped.
  const allowed = need - (track.combinedFebruary ? 1 : 0);
  const points = [...groups.entries()].filter(([key, values]) => closed.has(key) && values.length >= allowed).map(([key, values]) => ({
    p: key, t: periodTime(key),
    v: agg === "sum" ? values.reduce((a, b) => a + b, 0) : agg === "last" ? (values[values.length - 1] ?? 0) : values.reduce((a, b) => a + b, 0) / values.length,
  })).sort((a, b) => a.t - b.t);
  return { ...track, frequency: target, points };
}

export function coarsestFrequency(tracks: Track[]): TargetFrequency | "" {
  const ranks = tracks.map((track) => FREQUENCY_RANK[track.frequency] ?? 0);
  if (ranks.length < 2 || Math.max(...ranks) === Math.min(...ranks)) return "";
  return Math.max(...ranks) === 3 ? "Annual" : "Quarterly";
}

export function rebase(tracks: Track[], start: number): Track[] {
  return tracks.map((track) => {
    const first = track.points.find((point) => point.t >= start && point.v !== 0);
    if (!first) return { ...track, unit: "Index, first shown period = 100" };
    return { ...track, unit: "Index, first shown period = 100", points: track.points.map((point) => ({ ...point, v: (point.v / first.v) * 100 })) };
  });
}

/**
 * The change from the prior observation, in words ("Down 0.3 pp from Mar 2026")
 * or compact ("-0.3 pp"). Rates change in percentage points; levels in their unit.
 */
/** An observation date as the reader expects for the frequency: "Q1 2006" for quarterly, "Mar 2006" for monthly, "2006" for annual. */
export function observationLabel(date: string, frequency: string): string {
  if (!date) return "";
  if (/^\d{4}-Q[1-4]$/.test(date)) return periodPretty(date);
  if (frequency === "Quarterly") { const t = periodTime(date); return Number.isFinite(t) ? periodPretty(periodOf(t, "Quarterly")) : periodPretty(date); }
  if (frequency === "Annual") return date.slice(0, 4);
  return periodPretty(date);
}

export function deltaText(latest: SeriesPoint | undefined, previous: SeriesPoint | undefined, unit: string, style: "long" | "short" = "long", frequency = "Monthly"): string {
  if (!latest || !previous) return "";
  const difference = latest.value - previous.value;
  // Percentage points for a percentage; an index or a level changes in its own units.
  // Percentage points for a percentage, points for a per-thousand rate; an index or a level changes in its own units.
  const points = /‰|per thousand/i.test(unit) ? " pt" : /%|percent/i.test(unit) && !/index/i.test(unit) ? " pp" : "";
  if (Math.abs(difference) < 0.000001) {
    if (style === "long") return `Unchanged from ${observationLabel(previous.date, frequency)}`;
    // The short form sits beside "+0.3 pp" on the Home list, so an unchanged rate says "0.0 pp" too.
    return `${!isRate(unit) && Math.abs(latest.value) >= 1000 ? "0" : "0.0"}${points}`;
  }
  // Levels in the thousands change by whole units; anything finer is noise at that scale.
  const magnitude = !isRate(unit) && Math.abs(latest.value) >= 1000 ? Math.round(Math.abs(difference)).toLocaleString("en-US") : fmt(Math.abs(difference), unit);
  // A difference that rounds away is "0.0 pp", not "-0.0 pp".
  if (/^0(\.0+)?$/.test(magnitude)) return style === "short" ? `${magnitude}${points}` : `Unchanged from ${observationLabel(previous.date, frequency)}`;
  if (style === "short") return `${difference > 0 ? "+" : "-"}${magnitude}${points}`;
  return `${difference > 0 ? "Up" : "Down"} ${magnitude}${points} from ${observationLabel(previous.date, frequency)}`;
}

/**
 * When an NBS release happens, as a Unix time. NBS writes "2026-09-09 09:30:00"
 * in China Standard Time (UTC+8); a date alone means the usual 09:30 slot.
 */
export function releaseTime(text: string): number {
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!match) return Number.NaN;
  const [, year, month, day, hour = "09", minute = "30"] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour) - 8, Number(minute));
}

/** A release still to come: its instant is after now. */
export function isUpcoming(text: string, now = Date.now()): boolean {
  const at = releaseTime(text);
  return Number.isFinite(at) && at > now;
}

/** What the CSV header needs from each charted series; the caller resolves the region's English name. */
export interface CsvSeriesMeta { title: string; unit: string; agency: string; region?: string }

/**
 * The charted series as CSV: a commented header (series, region, unit, source, notes, retrieval
 * date), then one row per period with a column per track. The region line appears only when a
 * series carries one, so a file of Beijing's house prices says Beijing.
 */
export function csvOf(results: CsvSeriesMeta[], tracks: Track[], notes: string[]): string {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const regions = [...new Set(results.map((result) => result.region ?? "").filter(Boolean))];
  const head = [
    `# Series: ${results.map((result) => result.title).join(" | ")}`,
    ...(regions.length > 0 ? [`# Region: ${regions.join(" | ")}`] : []),
    `# Unit: ${[...new Set(results.map((result) => result.unit))].join(" | ")}`,
    `# Source: ${[...new Set(results.map((result) => result.agency))].join(", ")}`,
    ...notes.map((note) => `# Note: ${note}`),
    `# Retrieved: ${new Date().toISOString().slice(0, 10)} via EconStats China Data`,
  ];
  const frequency = new Set(tracks.map((track) => track.frequency)).size === 1 ? (tracks[0]?.frequency ?? "Monthly") : "Mixed";
  const keyed = tracks.map((track) => new Map(track.points.map((point) => [canonicalPeriod(point.p, frequency), point.v])));
  const periods = [...new Set(keyed.flatMap((points) => [...points.keys()]))].sort((a, b) => periodTime(a) - periodTime(b));
  const lines = [["period", ...tracks.map((track) => track.name)].map(quote).join(",")];
  for (const period of periods) {
    lines.push([period, ...keyed.map((points) => { const value = points.get(period); return value === undefined ? "" : String(value); })].map(quote).join(","));
  }
  return [...head, ...lines].join("\n");
}

export interface RegionalCsvRow { en: string; zh: string; code: string; value: number | null }

/**
 * One period of a regional series as CSV: a row per place, in the order shown.
 *
 * The period-by-series shape (csvOf) cannot carry this — thirty-one provinces
 * at one date is a cross-section, not a time series — and a cross-section is
 * what someone reading the map wants to take away.
 */
export function regionalCsv(meta: { title: string; unit: string; period: string; agency: string; notes?: string[] }, rows: RegionalCsvRow[]): string {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const head = [
    `# Series: ${meta.title}`,
    `# Unit: ${meta.unit}`,
    `# Period: ${meta.period}`,
    `# Source: ${meta.agency}`,
    ...(meta.notes ?? []).map((note) => `# Note: ${note}`),
    `# Retrieved: ${new Date().toISOString().slice(0, 10)} via EconStats China Data`,
  ];
  const lines = [["place", "place_zh", "nbs_code", "value"].map(quote).join(",")];
  for (const row of rows) {
    lines.push([quote(row.en), quote(row.zh), quote(row.code), row.value === null ? "" : String(row.value)].join(","));
  }
  return [...head, ...lines].join("\n");
}

/** The same period a year earlier: "2026-07" → "2025-07", "2026-Q2" → "2025-Q2", "2026" → "2025". */
export function yearEarlier(period: string): string {
  return period.replace(/^(\d{4})/, (year) => String(Number(year) - 1));
}

/**
 * A level's change from a year earlier as a percentage ("+8.2%"), which is how a flow or a
 * stock is read; the previous month's difference is seasonality, not news. Empty when the
 * year-earlier point is missing or zero, so the caller can fall back to the period difference.
 */
export function yearOnYearText(latest: SeriesPoint | undefined, yearAgo: SeriesPoint | undefined, options: { absolute?: boolean; unit?: string } = {}): string {
  if (!latest || !yearAgo) return "";
  // A net figure or a balance can cross zero, where a percentage means nothing: its change is in its own units.
  if (options.absolute || yearAgo.value === 0 || Math.sign(latest.value) !== Math.sign(yearAgo.value)) {
    const difference = latest.value - yearAgo.value;
    const text = Math.abs(latest.value) >= 1000 ? Math.round(Math.abs(difference)).toLocaleString("en-US") : fmt(Math.abs(difference), options.unit ?? "");
    if (/^0(\.0+)?$/.test(text)) return "0 y/y";
    return `${difference > 0 ? "+" : "-"}${text} y/y`;
  }
  const change = ((latest.value - yearAgo.value) / Math.abs(yearAgo.value)) * 100;
  const text = fmt(Math.abs(change), "%");
  if (/^0(\.0+)?$/.test(text)) return "0.0% y/y";
  return `${change > 0 ? "+" : "-"}${text}% y/y`;
}
