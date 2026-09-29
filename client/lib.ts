/**
 * The chart's arithmetic, kept apart from React so it can be tested without
 * a DOM: period labels, number formatting, frequency conversion, rebasing.
 */

import { isRateMeasure, measureOf, type Measure } from "../shared/measure";

export interface SeriesPoint { date: string; value: number; }

export interface Track {
  id: string; name: string; unit: string; frequency: string; color: string; dash: string;
  points: { t: number; v: number; p: string }[];
  /** True when February holds the combined January-February figure, so a first quarter of two readings is whole. */
  combinedFebruary?: boolean;
}

/** A unit, or the structured measure a series carries. Every formatter takes either. */
export type UnitLike = string | Measure;
const measure = (unit: UnitLike): Measure => (typeof unit === "string" ? measureOf(unit) : unit);

export function isRate(unit: UnitLike): boolean { return isRateMeasure(measure(unit)); }

/** How many decimals a value carries, to four: 552 has none, 484.8 one, 6.7828 four. */
function ownDecimals(value: number): number {
  const text = String(Math.round(Math.abs(value) * 10_000) / 10_000);
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : text.length - dot - 1;
}

export function fmt(value: number, unit: UnitLike): string {
  // The series says how many decimals it is quoted to. A level says "source", which means a
  // figure in the thousands rounds to whole units and a smaller one keeps what the publisher
  // wrote (a parity of 6.7828, a flow of 552), never padded to "552.00".
  const quoted = measure(unit).decimals;
  const decimals = quoted === "source" ? (Math.abs(value) >= 1000 ? 0 : ownDecimals(value)) : quoted;
  const text = value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  // A value that rounds to zero is zero, not "-0.0".
  return /^-0(\.0+)?$/.test(text) ? text.slice(1) : text;
}

export function fmtTick(value: number): string {
  if (Math.abs(value) >= 100000) return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

// ── Natural units ─────────────────────────────────────────────────────────────
//
// Publishers store a count of money, people or goods in a multiple of it:
// 亿元 is yuan in hundreds of millions, 万人 people in tens of thousands. An
// axis that prints the stored number with a K or M after it ("300K" over
// 亿元) leaves the arithmetic to the reader: 300 thousand hundred-millions is
// 30 trillion. So the chart shows the figure in the thing itself, scaled to a
// word a reader already has (thousand, million, billion, trillion). Only the
// display changes; stored values, CSV downloads and the table keep the
// publisher's own figures and unit.

/** A unit whose figures are a count of `thing`, each stored figure worth `multiplier` of it. */
export interface NaturalUnit { multiplier: number; thing: string }

/** The Chinese multiples, longest first so 万亿 is not read as 万 of something. */
const CHINESE_MULTIPLIER: [string, number][] = [["万亿", 1e12], ["亿", 1e8], ["百万", 1e6], ["万", 1e4], ["千", 1e3], ["", 1]];
/** The things counted, as the bureau writes them. A compound (万人次, 万吨标准煤) is not in the list and is left alone. */
const CHINESE_THING: Record<string, string> = {
  "元": "yuan", "美元": "US dollars", "人": "people", "吨": "tonnes",
  "千瓦时": "kWh", "千瓦小时": "kWh", "立方米": "cubic metres", "平方米": "square metres",
};
/** The English multiples as the catalog and the curated entries spell them. */
const ENGLISH_MULTIPLIER: [RegExp, number][] = [
  [/^(hundred millions?|100 million|100m)$/i, 1e8],
  [/^(ten thousands?|10,000|10k)$/i, 1e4],
  [/^trillions?$/i, 1e12],
  [/^billions?$/i, 1e9],
  [/^millions?$/i, 1e6],
  [/^thousands?$/i, 1e3],
];
const ENGLISH_THING: [RegExp, string][] = [
  [/^(yuan|cny|rmb)$/i, "yuan"],
  [/^(usd|us dollars?|dollars?)$/i, "US dollars"],
  [/^(persons|people)$/i, "people"],
  [/^(tonnes|tons)$/i, "tonnes"],
  [/^kwh$/i, "kWh"],
  [/^(cubic metres|m³)$/i, "cubic metres"],
  [/^(square metres|m²)$/i, "square metres"],
];
const HAS_CJK = /[㐀-鿿]/;

function chineseNaturalUnit(token: string): NaturalUnit | null {
  const text = token.trim();
  for (const [prefix, multiplier] of CHINESE_MULTIPLIER) {
    if (!text.startsWith(prefix)) continue;
    const thing = CHINESE_THING[text.slice(prefix.length)];
    if (thing) return { multiplier, thing };
  }
  return null;
}

function englishNaturalUnit(head: string): NaturalUnit | null {
  const text = head.trim().replace(/\s+/g, " ").replace(/\b(current|constant) /i, "");
  const thingOf = (words: string) => ENGLISH_THING.find(([pattern]) => pattern.test(words.trim()))?.[1];
  const multiplierOf = (words: string) => ENGLISH_MULTIPLIER.find(([pattern]) => pattern.test(words.trim()))?.[1];
  // "Hundred million yuan", "Millions of US dollars", "10,000 persons", "100M USD".
  const leading = text.match(/^(hundred millions?|ten thousands?|trillions?|billions?|millions?|thousands?|100 million|100m|10,000|10k)\s+(?:of\s+)?(.+)$/i);
  if (leading) {
    const multiplier = multiplierOf(leading[1] ?? ""), thing = thingOf(leading[2] ?? "");
    return multiplier && thing ? { multiplier, thing } : null;
  }
  // "USD millions".
  const trailing = text.match(/^(.+?)\s+(trillions|billions|millions|thousands)$/i);
  if (trailing) {
    const multiplier = multiplierOf(trailing[2] ?? ""), thing = thingOf(trailing[1] ?? "");
    return multiplier && thing ? { multiplier, thing } : null;
  }
  const thing = thingOf(text);
  return thing ? { multiplier: 1, thing } : null;
}

/**
 * What a unit counts and in what multiple, or null when there is nothing to
 * rescale: a rate, an index, a ratio ("Yuan per person"), a thing this does
 * not know, or a unit already in the thing itself ("Current US dollars",
 * "Persons"), where 13,860 reads better than "13.86 thousand". Reads the
 * Chinese unit where the string carries one, since that is the publisher's
 * own ("Hundred million CNY (亿元)" and a bare "亿元" alike), and the English
 * head otherwise ("Million USD", "Millions of US dollars").
 */
export function naturalUnit(unit: string): NaturalUnit | null {
  if (!unit || isRate(unit)) return null;
  // A ratio is not a count; and "亿元; Million USD" is two series' units sharing a raw axis, not one unit.
  if (/ per |\/|;/i.test(unit)) return null;
  const bracketed = unit.match(/[(（]([^)）]*)[)）]/)?.[1] ?? "";
  // The head ends at a bracket or a clause (", month"), not at the comma inside "10,000".
  const head = (unit.split(/[(（]|,\s/)[0] ?? "").trim();
  const natural = HAS_CJK.test(bracketed) ? chineseNaturalUnit(bracketed) : HAS_CJK.test(head) ? chineseNaturalUnit(head) : englishNaturalUnit(head);
  return natural && natural.multiplier > 1 ? natural : null;
}

/**
 * The unit one line of a series is in. Customs stores a commodity's value and
 * its quantity under one series unit ("Million USD"), and the quantity line
 * says its own unit in its label: "Quantity (10,000 Sets)" is sets, never
 * dollars. A line named for a quantity takes the unit in its label, or none;
 * any other line takes the series' unit.
 */
export function lineUnit(label: string, seriesUnit: string): string {
  // A series shown as a rate (a year-on-year change of every line) is a rate on every line.
  if (!/^quantity\b/i.test(label.trim()) || isRate(seriesUnit)) return seriesUnit;
  return label.match(/\(([^()]*)\)\s*$/)?.[1]?.trim() ?? "";
}

/**
 * A line's name without a trailing unit in brackets, for a chart that already
 * says the unit in natural terms: "FX reserves (100M USD)" beside "3.4 trillion
 * US dollars" is "FX reserves". Only a bracket that is itself a count's unit
 * is dropped; "Exports (goods)" is left as it is. Display only.
 */
export function withoutUnitSuffix(name: string): string {
  const match = name.match(/^(.*\S)\s*\(([^()]*)\)\s*$/);
  if (!match || naturalUnit(match[2] ?? "") === null) return name;
  return match[1] ?? name;
}

/** The scale words, largest first: the size, the word after a number, the word heading an axis. */
const SCALE_WORDS: [number, string, string][] = [[1e12, "trillion", "Trillions"], [1e9, "billion", "Billions"], [1e6, "million", "Millions"], [1e3, "thousand", "Thousands"]];

/** The position of the largest scale word not above a magnitude; SCALE_WORDS.length means none (below a thousand). */
function scaleIndex(magnitude: number): number {
  const index = SCALE_WORDS.findIndex(([size]) => magnitude >= size);
  return index < 0 ? SCALE_WORDS.length : index;
}

/** Decimals for four significant figures at most: 347.67 takes one, 1.4 three, 620 none. */
function significantDecimals(magnitude: number): number {
  return magnitude === 0 ? 0 : Math.max(0, Math.min(3, 3 - Math.floor(Math.log10(magnitude))));
}

/** A number to a fixed count of decimals at most, trailing zeros dropped, never "-0". */
function plain(value: number, decimals: number, fixed = false): string {
  const text = value.toLocaleString("en-US", { minimumFractionDigits: fixed ? decimals : 0, maximumFractionDigits: decimals });
  return /^-0(\.0+)?$/.test(text) ? text.slice(1) : text;
}

/**
 * One stored figure in its natural unit, for a tooltip or the stat line:
 * 3,476,700 in 亿元 is "347.7 trillion yuan". Null when the unit has nothing
 * to rescale or the value is not a finite number, so the caller falls back to
 * the stored figure.
 */
export function naturalValue(value: number, unit: string): string | null {
  const natural = naturalUnit(unit);
  if (!natural || !Number.isFinite(value)) return null;
  const amount = value * natural.multiplier;
  let index = scaleIndex(Math.abs(amount));
  // Rounded first, so 999.96 million is "1 billion" rather than "1,000 million".
  const roundedAt = (at: number) => {
    const scaled = amount / (SCALE_WORDS[at]?.[0] ?? 1);
    const decimals = significantDecimals(Math.abs(scaled));
    return { scaled, decimals, rounded: Math.round(scaled * 10 ** decimals) / 10 ** decimals };
  };
  let reading = roundedAt(index);
  if (index > 0 && Math.abs(reading.rounded) >= 1000) { index -= 1; reading = roundedAt(index); }
  const word = SCALE_WORDS[index];
  const number = plain(reading.scaled, reading.decimals);
  return word ? `${number} ${word[1]} ${natural.thing}` : `${number} ${natural.thing}`;
}

/**
 * The decimals a tick needs to be written exactly, counted to nine places so
 * a fifth decimal is seen (1.00004 needs five; ownDecimals, at four, would say
 * none and two ticks would both read "1"), while float noise past the ninth
 * (2.8500000000000001) is not.
 */
function tickDecimals(value: number): number {
  const text = Math.abs(value).toFixed(9).replace(/0+$/, "");
  const dot = text.indexOf(".");
  return dot < 0 || dot === text.length - 1 ? 0 : text.length - dot - 1;
}

/** How a value axis over a count reads: the divisor applied to stored figures, a title naming the unit, and the tick format. */
export interface AxisScale {
  /** Stored figures are divided by this for display: 10,000 for 亿元 on a trillions axis. */
  divisor: number;
  /** Names what the ticks count: "Trillions of yuan", or the thing alone below a thousand. */
  title: string;
  format: (value: number) => string;
}

/**
 * The scale for a value axis, one word for the whole axis, chosen from the
 * largest figure shown (`largest`, in stored units; the largest tick when not
 * given) rather than a rounded-up top tick: over 亿元, an axis passes into
 * trillions once the data reach 10,000 (one trillion yuan). Every tick must
 * read exactly in at most three decimals; when the ticks sit closer than that
 * (1.40825 billion people) the axis drops to the next word down (1,408.25
 * million), so no two labels repeat. Null for a unit with nothing to
 * rescale; the axis then prints the stored figures as before.
 */
export function axisScale(unit: string, ticks: number[], largest?: number): AxisScale | null {
  const natural = naturalUnit(unit);
  if (!natural) return null;
  const finite = ticks.filter(Number.isFinite);
  const top = Number.isFinite(largest) ? Math.abs(largest ?? 0) : Math.max(0, ...finite.map(Math.abs));
  // Nothing but zeros has no magnitude to name; a scale chosen for it would print the
  // padding around zero ("Yuan", ±100,000,000), so the axis stays as stored.
  if (top === 0) return null;
  let index = scaleIndex(top * natural.multiplier);
  let decimals: number | null = null;
  if (finite.length > 1) {
    const needed = (at: number) => Math.max(...finite.map((tick) => tickDecimals(tick * natural.multiplier / (SCALE_WORDS[at]?.[0] ?? 1))));
    while (index < SCALE_WORDS.length && needed(index) > 3) index += 1;
    decimals = Math.min(3, needed(index));
  }
  const word = SCALE_WORDS[index];
  const divisor = (word ? word[0] : 1) / natural.multiplier;
  const title = word ? `${word[2]} of ${natural.thing}` : `${natural.thing.charAt(0).toUpperCase()}${natural.thing.slice(1)}`;
  const format = (value: number) => {
    const shown = value / divisor;
    return decimals === null ? plain(shown, significantDecimals(Math.abs(shown))) : plain(shown, decimals, true);
  };
  return { divisor, title, format };
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
  // A date-only string ("2026-09-28") parses as UTC midnight, and formatted in
  // local time it read a day early west of UTC. It names a calendar day, so it
  // is formatted in UTC; a full timestamp keeps the reader's local time.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", ...(dateOnly ? { timeZone: "UTC" } : {}) });
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

/**
 * A monthly track averaged over a calendar window of `months` months ending at
 * each point: the three-month average of a year-on-year rate that trade and
 * activity charts are usually drawn with, since one month of Chinese data
 * carries the Lunar New Year and the combined January-February release. The
 * window is by calendar month, not by index, so a missing month is left out
 * rather than pulling an older one in; a point averages what the window holds.
 * A track that is not monthly is returned as it is.
 */
export function movingAverage(track: Track, months = 3): Track {
  if (track.frequency !== "Monthly" || months < 2) return track;
  const index = (t: number) => { const d = new Date(t); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
  const byMonth = new Map(track.points.map((point) => [index(point.t), point.v]));
  const points = track.points.map((point) => {
    const at = index(point.t);
    const values: number[] = [];
    for (let back = 0; back < months; back += 1) { const v = byMonth.get(at - back); if (v !== undefined && v !== null) values.push(v); }
    return { ...point, v: Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 100) / 100 };
  });
  return { ...track, name: `${track.name}, ${months}-month average`, points };
}

/**
 * Whether a month-end reading is being shown for a month that has not ended.
 *
 * A daily fixing or close aggregated to its month (the 10-year yield, the
 * parity rate, SHIBOR, the exchange indices) carries a point for the running
 * month from its first trading day: a month-to-date reading under a unit that
 * says "month-end close". It reads "Sep 2026 to date" until the month closes.
 * A rate fixed once a month (the LPR) has no such unit and is final when it
 * appears.
 */
export function isOpenMonth(date: string, unit: string, now = new Date()): boolean {
  if (!/month-end|month end|last fixing of the month|last weekly reading of the month|last trading day/i.test(unit)) return false;
  return date.slice(0, 7) === `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** A series that accumulates from the start of the year: its unit, label or title says so. */
export function isCumulative(...texts: (string | undefined)[]): boolean {
  return texts.some((text) => !!text && /cumulative|year to date|year-to-date|\bytd\b|累计/i.test(text));
}

const MONTH_NAMES = Array.from({ length: 12 }, (_, index) => new Date(Date.UTC(2000, index, 1)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" }));

/**
 * The months a cumulative reading covers: "January to July 2026" for one
 * dated July, "Q1 to Q2 2026" for a quarterly one, the year for an annual.
 * A reading dated "July 2026" on a year-to-date series is not July's.
 */
export function periodSpan(date: string, frequency: string, style: "long" | "short" = "long"): string {
  const quarter = date.match(/^(\d{4})-Q([1-4])$/);
  if (quarter) return quarter[2] === "1" ? `Q1 ${quarter[1]}` : `Q1 to Q${quarter[2]} ${quarter[1]}`;
  const month = date.match(/^(\d{4})-(\d{2})/);
  if (!month || frequency === "Annual") return date.slice(0, 4);
  const number = Number(month[2]);
  if (frequency === "Quarterly") { const q = Math.ceil(number / 3); return q === 1 ? `Q1 ${month[1]}` : `Q1 to Q${q} ${month[1]}`; }
  const name = (index: number) => style === "short" ? MONTH_NAMES[index]!.slice(0, 3) : MONTH_NAMES[index]!;
  return number === 1 ? `${name(0)} ${month[1]}` : `${name(0)} to ${name(number - 1)} ${month[1]}`;
}

/** A line's name without the measure the bureau appends to it: "Industrial profits, year to date (YoY %)" reads "Industrial profits". */
export function bareLabel(label: string): string {
  return label.replace(/\s*[(（][^()（）]*[)）]\s*$/, "").replace(/,\s*(?:year to date|cumulative(?: year to date)?|month|quarter|quarter end|year end)\s*$/i, "").trim();
}

/**
 * The measure every line of a chart shares, so it is written once under the
 * chart and not four times in the legend: ", year to date (YoY %)" on every
 * line of the profits chart. The suffix must begin at a comma or a bracket
 * and leave every name something in front of it; otherwise it is nothing.
 */
export function sharedLabelSuffix(names: string[]): string {
  if (names.length < 2) return "";
  let suffix = names[0] ?? "";
  for (const name of names.slice(1)) {
    let count = 0;
    while (count < suffix.length && count < name.length && suffix[suffix.length - 1 - count] === name[name.length - 1 - count]) count += 1;
    suffix = suffix.slice(suffix.length - count);
  }
  const at = suffix.search(/,\s|\s\(/);
  if (at < 0) return "";
  suffix = suffix.slice(at);
  return names.every((name) => name.length - suffix.length >= 2) ? suffix : "";
}

/** The tracks with the shared measure taken off their names, for a legend that names the lines and nothing else. */
export function withoutSharedSuffix(tracks: Track[]): Track[] {
  const suffix = sharedLabelSuffix(tracks.map((track) => track.name));
  return suffix ? tracks.map((track) => ({ ...track, name: track.name.slice(0, -suffix.length) })) : tracks;
}

export function deltaText(latest: SeriesPoint | undefined, previous: SeriesPoint | undefined, unit: UnitLike, style: "long" | "short" = "long", frequency = "Monthly", cumulative = false): string {
  if (!latest || !previous) return "";
  // A cumulative reading is compared with the shorter span before it, not with a month.
  const before = cumulative ? periodSpan(previous.date, frequency) : observationLabel(previous.date, frequency);
  const difference = latest.value - previous.value;
  // The series says how its change reads: percentage points, points, or its own units.
  const change = measure(unit).change;
  // A per-thousand rate moves in per-thousand points, which "pt" does not say.
  const points = change === "pt" ? (measure(unit).suffix === "‰" ? " per 1,000" : " pt") : change === "pp" ? " pp" : "";
  if (Math.abs(difference) < 0.000001) {
    if (style === "long") return `Unchanged from ${before}`;
    // The short form sits beside "+0.3 pp" on the Home list, so an unchanged rate says "0.0 pp" too.
    return `${!isRate(unit) && Math.abs(latest.value) >= 1000 ? "0" : "0.0"}${points}`;
  }
  // On the series page a count reads in its natural unit, the same as the stat
  // value beside it: "Up 1.2 trillion yuan", not "Up 12,345" of hundred millions.
  const natural = style === "long" && change === "absolute" && typeof unit === "string" ? naturalValue(Math.abs(difference), unit) : null;
  if (natural !== null && !/^0 /.test(natural)) return `${difference > 0 ? "Up" : "Down"} ${natural} from ${before}`;
  // Levels in the thousands change by whole units; anything finer is noise at that scale.
  const magnitude = !isRate(unit) && Math.abs(latest.value) >= 1000 ? Math.round(Math.abs(difference)).toLocaleString("en-US") : fmt(Math.abs(difference), unit);
  // A difference that rounds away is "0.0 pp", not "-0.0 pp".
  if (/^0(\.0+)?$/.test(magnitude)) return style === "short" ? `${magnitude}${points}` : `Unchanged from ${before}`;
  if (style === "short") return `${difference > 0 ? "+" : "-"}${magnitude}${points}`;
  return `${difference > 0 ? "Up" : "Down"} ${magnitude}${points} from ${before}`;
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
export function yearOnYearText(latest: SeriesPoint | undefined, yearAgo: SeriesPoint | undefined, options: { absolute?: boolean; unit?: UnitLike } = {}): string {
  if (!latest || !yearAgo) return "";
  // A net figure or a balance can cross zero, where a percentage means nothing: its change is in its own units.
  if (options.absolute || yearAgo.value === 0 || Math.sign(latest.value) !== Math.sign(yearAgo.value)) {
    const difference = latest.value - yearAgo.value;
    const text = Math.abs(latest.value) >= 1000 ? Math.round(Math.abs(difference)).toLocaleString("en-US") : fmt(Math.abs(difference), options.unit ?? "");
    // A change in a level carries the level's unit; "+700" alone is attributable to nothing.
    const suffix = options.unit ? measure(options.unit).suffix : "";
    if (/^0(\.0+)?$/.test(text)) return `0${suffix ? ` ${suffix}` : ""} y/y`;
    return `${difference > 0 ? "+" : "-"}${text}${suffix ? ` ${suffix}` : ""} y/y`;
  }
  const change = ((latest.value - yearAgo.value) / Math.abs(yearAgo.value)) * 100;
  const text = fmt(Math.abs(change), "%");
  if (/^0(\.0+)?$/.test(text)) return "0.0% y/y";
  return `${change > 0 ? "+" : "-"}${text}% y/y`;
}
