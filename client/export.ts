/**
 * Share-image layout: a pure function from chart data to canvas geometry.
 *
 * The image is drawn from the Track data, not from the on-screen SVG, so it
 * is the same 1600 x 900 light-palette picture whatever the viewport or theme
 * was. Everything in here is arithmetic on plain objects; `share.ts` does the
 * drawing. Keeping the two apart lets `bun test` cover the layout without a
 * DOM.
 */

import { canonicalPeriod, fmt, fmtTick, isRate, periodPretty, periodTime, type Track } from "./lib";

export const IMAGE = { width: 1600, height: 900 };

export const FONT_SANS = "\"IBM Plex Sans\", -apple-system, BlinkMacSystemFont, \"Segoe UI\", \"PingFang SC\", \"Hiragino Sans GB\", \"Noto Sans SC\", sans-serif";

/** The light theme, mirrored from styles.css. A test guards against drift. */
export const LIGHT = {
  ink: "#1f2933",
  muted: "#5b6b7a",
  line: "#e2e8ee",
  lineStrong: "#7f8d9a",
  amber: "#b5820c",
  panel: "#ffffff",
  navy: "#12395c",
  red: "#c0392b",
  chart: ["#2a78d6", "#eb6834", "#1baf7a", "#4a3aa7", "#eda100", "#e87ba4", "#008300", "#e34948"],
};

/** Resolve a chart colour token such as `var(--chart-2)` to its light hex. */
export function lightColor(token: string): string {
  const match = token.match(/--chart-(\d)/);
  if (!match) return token.startsWith("#") ? token : LIGHT.chart[0] ?? "#2a78d6";
  return LIGHT.chart[Number(match[1]) - 1] ?? LIGHT.chart[0] ?? "#2a78d6";
}

export interface ShareInput {
  title: string;
  unit: string;
  frequencies: string[];
  tracks: Track[];
  gaps: { from: string; to: string }[];
  notes: string[];
  logScale: boolean;
  lunar: boolean;
  source: string;
  url: string;
  date: string;
}

/** Text width in CSS pixels for a given canvas font string. Injected so tests can stub it. */
export type Measure = (text: string, font: string) => number;

interface Text { text: string; x: number; y: number; font: string; color: string; align: "left" | "right" | "center" }

export interface ShareLayout {
  width: number;
  height: number;
  background: string;
  title: { lines: string[]; x: number; y: number; lineHeight: number; font: string; color: string };
  subtitle: Text;
  legend: { x: number; y: number; color: string; dash: number[]; text: string; font: string }[];
  plot: { x: number; y: number; w: number; h: number };
  yTicks: { y: number; label: string }[];
  xTicks: { x: number; label: string }[];
  refLines: { y: number }[];
  bands: { x1: number; x2: number; fill: string; alpha: number; label: string }[];
  lines: { color: string; dash: number[]; width: number; points: [number, number][] }[];
  endLabels: Text[];
  notes: Text[];
  footer: { mark: { x: number; y: number; size: number }; brand: Text; source: Text; url: Text; date: Text };
}

const YEAR = 365.25 * 86400000;

/** The tracks restricted to the window the chart shows. Shared with SeriesChart. */
export function visibleTracks(tracks: Track[], years: number | null, start?: number, end?: number): Track[] {
  const last = Math.max(...tracks.flatMap((track) => track.points.map((point) => point.t)), 0);
  const from = start !== undefined && Number.isFinite(start) ? start : years === null ? -Infinity : last - years * YEAR;
  const to = end !== undefined && Number.isFinite(end) ? end : Infinity;
  return tracks.map((track) => ({ ...track, points: track.points.filter((point) => point.t >= from && point.t <= to) }));
}

/** A 1-2-5 tick sequence that brackets the data. `count` is a target, not a promise. */
export function niceTicks(min: number, max: number, count = 5): { lo: number; hi: number; ticks: number[] } {
  let low = min, high = max;
  if (!Number.isFinite(low) || !Number.isFinite(high)) { low = 0; high = 1; }
  if (high - low < 1e-9) { const pad = Math.abs(low) * 0.1 || 1; low -= pad; high += pad; }
  const raw = (high - low) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalised = raw / magnitude;
  const step = (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10) * magnitude;
  const lo = Math.floor(low / step) * step;
  const hi = Math.ceil(high / step) * step;
  const ticks: number[] = [];
  for (let value = lo; value <= hi + step / 2; value += step) ticks.push(Number(value.toFixed(10)));
  return { lo: Number(lo.toFixed(10)), hi: Number(hi.toFixed(10)), ticks };
}

/** Decade ticks for a log axis, with 2x and 5x steps when the span is short. */
export function logTicks(min: number, max: number): { lo: number; hi: number; ticks: number[] } {
  const low = Math.max(min, Number.MIN_VALUE), high = Math.max(max, low * 1.0001);
  const first = Math.floor(Math.log10(low)), lastExponent = Math.ceil(Math.log10(high));
  const ticks: number[] = [];
  const dense = lastExponent - first < 3;
  for (let exponent = first; exponent <= lastExponent; exponent += 1) {
    const decade = 10 ** exponent;
    for (const factor of dense ? [1, 2, 5] : [1]) {
      const value = decade * factor;
      if (value >= 10 ** first && value <= 10 ** lastExponent) ticks.push(value);
    }
  }
  const inRange = ticks.filter((value) => value >= low && value <= high);
  const lo = inRange[0] !== undefined && inRange[0] <= low ? inRange[0] : (ticks.filter((value) => value <= low).at(-1) ?? 10 ** first);
  const hi = ticks.find((value) => value >= high) ?? 10 ** lastExponent;
  return { lo, hi, ticks: ticks.filter((value) => value >= lo && value <= hi) };
}

/** Time-axis ticks: years when the span is long, months otherwise, thinned to at least `minGap` px apart. */
/**
 * Axis ticks for the span. Years on a long span; months on a short one, except that
 * annual points always get years, and quarterly points get years beyond three of them:
 * "Jan 09, Jul 09" under one point a year misleads.
 */
export function timeTicks(min: number, max: number, plotWidth: number, minGap = 90, coarsest: "Monthly" | "Quarterly" | "Annual" = "Monthly"): { t: number; label: string }[] {
  if (!(max > min) || plotWidth <= 0) return [];
  const span = max - min;
  const px = (t: number) => ((t - min) / span) * plotWidth;
  const startYear = new Date(min).getUTCFullYear(), endYear = new Date(max).getUTCFullYear();
  const yearsOnly = span / YEAR > 6 || coarsest === "Annual" || (coarsest === "Quarterly" && span / YEAR > 3);
  if (yearsOnly) {
    const yearPx = plotWidth / (span / YEAR);
    const step = Math.max(1, Math.ceil(minGap / yearPx));
    const anchor = Math.ceil(startYear / step) * step;
    const out: { t: number; label: string }[] = [];
    for (let year = anchor; year <= endYear; year += step) {
      const t = Date.UTC(year, 0, 1);
      if (t >= min && t <= max) out.push({ t, label: String(year) });
    }
    return out;
  }
  const monthPx = plotWidth / (span / (YEAR / 12));
  const step = [1, 2, 3, 6, 12].find((candidate) => candidate * monthPx >= minGap) ?? 12;
  const out: { t: number; label: string }[] = [];
  const firstMonth = new Date(min).getUTCMonth();
  let year = startYear, month = Math.ceil(firstMonth / step) * step;
  while (true) {
    if (month >= 12) { year += 1; month -= 12; }
    const t = Date.UTC(year, month, 1);
    if (t > max) break;
    if (t >= min) out.push({ t, label: new Date(t).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }) });
    month += step;
  }
  // Guarantee spacing even if month starts fall unevenly.
  return out.filter((tick, index, all) => index === 0 || px(tick.t) - px(all[index - 1]?.t ?? tick.t) >= minGap * 0.9);
}

/** Push overlapping labels apart along one axis, keep their order, stay inside [lo, hi]. */
export function spreadLabels(centers: number[], minGap: number, lo: number, hi: number): number[] {
  const order = centers.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const placed = order.map((item) => item.value);
  for (let i = 1; i < placed.length; i += 1) placed[i] = Math.max(placed[i] ?? 0, (placed[i - 1] ?? 0) + minGap);
  const last = placed.length - 1;
  if (last >= 0 && (placed[last] ?? 0) > hi) {
    placed[last] = hi;
    for (let i = last - 1; i >= 0; i -= 1) placed[i] = Math.min(placed[i] ?? 0, (placed[i + 1] ?? 0) - minGap);
  }
  if ((placed[0] ?? 0) < lo) {
    const shift = lo - (placed[0] ?? 0);
    for (let i = 0; i < placed.length; i += 1) placed[i] = (placed[i] ?? 0) + shift;
  }
  const out = new Array<number>(centers.length).fill(0);
  order.forEach((item, position) => { out[item.index] = placed[position] ?? item.value; });
  return out;
}

/** Word-wrap (character-wrap for text without spaces) to `maxLines`, ellipsis on the last line. */
export function wrapText(text: string, maxWidth: number, font: string, measure: Measure, maxLines: number): string[] {
  const tokens = text.includes(" ") ? text.split(" ") : [...text];
  const joiner = text.includes(" ") ? " " : "";
  const lines: string[] = [];
  let current = "";
  for (const token of tokens) {
    const candidate = current ? `${current}${joiner}${token}` : token;
    if (measure(candidate, font) <= maxWidth || !current) current = candidate;
    else { lines.push(current); current = token; }
  }
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let tail = `${kept[maxLines - 1] ?? ""}…`;
  while (measure(tail, font) > maxWidth && tail.length > 1) tail = `${tail.slice(0, -2)}…`;
  kept[maxLines - 1] = tail;
  return kept;
}

export function subtitleOf(unit: string, frequencies: string[], tracks: Track[]): string {
  // One frequency on the chart means one period vocabulary: a quarterly compare reads "Q2 2016 to Q2 2026"
  // even where a native quarterly point is dated by its last month.
  const frequency = frequencies.length === 1 ? (frequencies[0] ?? "Mixed") : "Mixed";
  const periods = tracks.flatMap((track) => track.points.map((point) => canonicalPeriod(point.p, frequency))).sort((a, b) => periodTime(a) - periodTime(b));
  const first = periods[0], last = periods.at(-1);
  const range = first && last ? (first === last ? periodPretty(first) : `${periodPretty(first)} to ${periodPretty(last)}`) : "";
  return [unit, frequencies.map((item) => item.toLowerCase()).join(" and "), range].filter(Boolean).join(", ");
}

function dashOf(dash: string): number[] {
  return dash ? dash.split(" ").map((part) => Number(part) * 1.5).filter((value) => Number.isFinite(value) && value > 0) : [];
}

function trimUrl(url: string): string { return url.replace(/^https?:\/\//, ""); }

export function layoutShareImage(input: ShareInput, measure: Measure): ShareLayout {
  const { width, height } = IMAGE;
  const margin = 56;
  const titleFont = `600 34px ${FONT_SANS}`;
  const subtitleFont = `400 20px ${FONT_SANS}`;
  const legendFont = `500 18px ${FONT_SANS}`;
  const tickFont = `400 17px ${FONT_SANS}`;
  const labelFont = `600 18px ${FONT_SANS}`;
  const noteFont = `400 16px ${FONT_SANS}`;
  const footerFont = `400 16px ${FONT_SANS}`;
  const brandFont = `600 17px ${FONT_SANS}`;

  const titleLines = wrapText(input.title, width - margin * 2, titleFont, measure, 2);
  const titleTop = 52;
  const titleLineHeight = 42;
  let cursor = titleTop + titleLines.length * titleLineHeight - 8;
  const subtitle: Text = { text: subtitleOf(input.unit, input.frequencies, input.tracks), x: margin, y: cursor + 22, font: subtitleFont, color: LIGHT.muted, align: "left" };
  cursor = subtitle.y + 12;

  const tracks = input.tracks.filter((track) => track.points.length > 0);
  const legend: ShareLayout["legend"] = [];
  if (tracks.length > 1) {
    let x = margin, y = cursor + 26;
    for (const track of tracks) {
      const text = track.name;
      const itemWidth = 34 + measure(text, legendFont) + 32;
      if (x + itemWidth > width - margin && x > margin) { x = margin; y += 26; }
      legend.push({ x, y, color: lightColor(track.color), dash: dashOf(track.dash), text, font: legendFont });
      x += itemWidth;
    }
    cursor = y + 10;
  }

  // Footer and axis space claim the bottom; notes sit between the axis and the footer.
  const footerY = height - 40;
  // Each note may take two lines and the notes together three, so a two-sentence note about a
  // suspended series is read whole rather than cut mid-sentence.
  const noteLines: string[] = [];
  for (const note of input.notes) {
    if (noteLines.length >= 3) break;
    noteLines.push(...wrapText(note, width - margin * 2, noteFont, measure, Math.min(2, 3 - noteLines.length)));
  }
  const noteHeight = noteLines.length * 22;
  const plotTop = cursor + 28;
  const plotBottom = footerY - 66 - noteHeight - 36;

  // Scales.
  const times = tracks.flatMap((track) => track.points.map((point) => point.t));
  const values = tracks.flatMap((track) => track.points.map((point) => point.v));
  const tMin = Math.min(...times), tMax = Math.max(...times);
  const vMin = Math.min(...values), vMax = Math.max(...values);
  const scale = input.logScale ? logTicks(vMin, vMax) : niceTicks(vMin, vMax, 5);
  const yTickLabels = scale.ticks.map((value) => fmtTick(value));
  const axisWidth = Math.max(...yTickLabels.map((label) => measure(label, tickFont)), 0) + 16;

  const endTexts = tracks.map((track) => ({ track, text: fmt(track.points[track.points.length - 1]?.v ?? 0, track.unit || input.unit) }));
  const endWidth = Math.max(...endTexts.map((item) => measure(item.text, labelFont)), 0);
  const plotX = margin + axisWidth;
  const plotW = width - margin - plotX - (endWidth > 0 ? endWidth + 18 : 16);
  const plot = { x: plotX, y: plotTop, w: Math.max(plotW, 200), h: Math.max(plotBottom - plotTop, 120) };

  const xOf = (t: number) => tMax > tMin ? plot.x + ((t - tMin) / (tMax - tMin)) * plot.w : plot.x + plot.w / 2;
  const yOf = (v: number) => {
    const ratio = input.logScale
      ? (Math.log10(v) - Math.log10(scale.lo)) / (Math.log10(scale.hi) - Math.log10(scale.lo) || 1)
      : (v - scale.lo) / (scale.hi - scale.lo || 1);
    return plot.y + plot.h - ratio * plot.h;
  };

  const yTicks = scale.ticks.map((value, index) => ({ y: yOf(value), label: yTickLabels[index] ?? "" }));
  const coarsest: "Monthly" | "Quarterly" | "Annual" = tracks.every((track) => track.frequency === "Annual") ? "Annual"
    : tracks.every((track) => track.frequency === "Quarterly" || track.frequency === "Annual") ? "Quarterly" : "Monthly";
  const xTicks = timeTicks(tMin, tMax, plot.w, 90, coarsest).map((tick) => ({ x: xOf(tick.t), label: tick.label }));
  const refLines: { y: number }[] = [];
  if (isRate(input.unit) && !input.logScale && scale.lo < 0 && scale.hi > 0) refLines.push({ y: yOf(0) });
  const indexBase = /=100|= 100/.test(input.unit) ? 100 : null;
  if (indexBase !== null && !input.logScale && scale.lo < 100 && scale.hi > 100) refLines.push({ y: yOf(100) });

  const bands: ShareLayout["bands"] = [];
  const spanYears = (tMax - tMin) / YEAR;
  if (input.lunar && tracks.some((track) => track.frequency === "Monthly") && spanYears <= 12) {
    for (let year = new Date(tMin).getUTCFullYear(); year <= new Date(tMax).getUTCFullYear(); year += 1) {
      const x1 = Math.max(Date.UTC(year, 0, 1), tMin), x2 = Math.min(Date.UTC(year, 2, 1), tMax);
      if (x2 > x1) bands.push({ x1: xOf(x1), x2: xOf(x2), fill: LIGHT.ink, alpha: 0.035, label: "" });
    }
  }
  for (const gap of input.gaps) {
    const x1 = Math.max(periodTime(gap.from), tMin), x2 = Math.min(periodTime(gap.to), tMax);
    if (x2 > x1) bands.push({ x1: xOf(x1), x2: xOf(x2), fill: LIGHT.amber, alpha: 0.09, label: "series suspended" });
  }

  const lines = tracks.map((track) => ({
    color: lightColor(track.color),
    dash: dashOf(track.dash),
    width: 3,
    points: track.points.map((point): [number, number] => [xOf(point.t), yOf(point.v)]),
  }));

  const centers = endTexts.map((item) => yOf(item.track.points[item.track.points.length - 1]?.v ?? 0));
  const spread = spreadLabels(centers, 24, plot.y + 10, plot.y + plot.h - 10);
  const endLabels: Text[] = endTexts.map((item, index) => ({ text: item.text, x: plot.x + plot.w + 10, y: spread[index] ?? centers[index] ?? plot.y, font: labelFont, color: lightColor(item.track.color), align: "left" }));

  const noteTexts: Text[] = noteLines.map((line, index) => ({
    text: line,
    x: margin, y: plot.y + plot.h + 36 + 22 + index * 22, font: noteFont, color: LIGHT.muted, align: "left",
  }));

  // Two footer lines: brand and source on the first, the page URL and retrieval date on the second.
  const brand: Text = { text: "EconStats China Data", x: margin + 34, y: footerY - 26, font: brandFont, color: LIGHT.navy, align: "left" };
  const dateText: Text = { text: `Retrieved ${input.date}`, x: width - margin, y: footerY, font: footerFont, color: LIGHT.muted, align: "right" };
  const sourceX = brand.x + measure(brand.text, brandFont) + 28;
  const sourceText = wrapText(`Source: ${input.source}`, width - margin - sourceX, footerFont, measure, 1)[0] ?? "";
  const source: Text = { text: sourceText, x: sourceX, y: footerY - 26, font: footerFont, color: LIGHT.muted, align: "left" };
  const urlMax = dateText.x - measure(dateText.text, footerFont) - 24 - margin;
  // A long compare URL cannot be shortened with an ellipsis and still typed, so a URL that
  // does not fit gives way to the site's host alone.
  const fullUrl = trimUrl(input.url);
  const host = fullUrl.split("/")[0] ?? fullUrl;
  const shownUrl = measure(fullUrl, footerFont) <= urlMax ? fullUrl : host;
  const urlText: Text = { text: wrapText(shownUrl, urlMax, footerFont, measure, 1)[0] ?? "", x: margin, y: footerY, font: footerFont, color: LIGHT.muted, align: "left" };

  return {
    width, height, background: LIGHT.panel,
    title: { lines: titleLines, x: margin, y: titleTop + 26, lineHeight: titleLineHeight, font: titleFont, color: LIGHT.ink },
    subtitle, legend, plot, yTicks, xTicks, refLines, bands, lines, endLabels, notes: noteTexts,
    footer: { mark: { x: margin, y: footerY - 44, size: 24 }, brand, source, url: urlText, date: dateText },
  };
}
