/**
 * The chart's arithmetic, kept apart from React so it can be tested without
 * a DOM: period labels, number formatting, frequency conversion, rebasing.
 */

export interface SeriesPoint { date: string; value: number; }

export interface Track { id: string; name: string; unit: string; frequency: string; color: string; dash: string; points: { t: number; v: number; p: string }[]; }

export function isRate(unit: string): boolean { return /%|percent|index|=100/i.test(unit); }

export function fmt(value: number, unit: string): string {
  const decimals = isRate(unit) ? 1 : Math.abs(value) >= 1000 ? 0 : 2;
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function fmtTick(value: number): string {
  if (Math.abs(value) >= 100000) return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
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
  for (const point of track.points) { const key = periodOf(point.t, target); groups.set(key, [...(groups.get(key) ?? []), point.v]); }
  const points = [...groups.entries()].filter(([, values]) => values.length >= need).map(([key, values]) => ({
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
