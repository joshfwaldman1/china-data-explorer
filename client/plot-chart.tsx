/**
 * A theme card's chart drawn with Observable Plot, in the editorial style
 * Datawrapper made familiar: each line named at its end instead of in a
 * legend, horizontal gridlines only, the unit above the value axis, a thin
 * line, one tooltip that follows the pointer.
 *
 * It draws the same tracks the Recharts chart does, with the same visible
 * window, long-gap breaks, log axis and natural-unit axis (the caller passes
 * the axis it already computed for the card's footnote), so the two can be
 * compared card for card while the site chooses between them.
 */

import * as Plot from "@observablehq/plot";
import React, { useEffect, useRef, useState } from "react";
import { visibleTracks } from "./export";
import { fmt, fmtTick, isRate, longGapsOf, periodPretty, periodTime, powersOfTen, type AxisScale, type Track } from "./lib";

interface Row { date: Date; value: number; name: string; color: string; period: string }

/** More lines than this are named in a legend below the chart; their end labels would collide. */
export const DIRECT_LABEL_LIMIT = 4;

/** Rough width of a label in pixels at 11px, for the right margin the end labels need. */
function labelWidth(text: string): number {
  return Math.ceil(text.length * 6.2) + 10;
}

/**
 * Pixel positions for the end labels, at least `gap` apart and inside
 * [top, bottom]: sorted by where their lines end, pushed down where two
 * would overlap, then pulled back up if the last one fell off the chart.
 */
export function spreadLabels(positions: number[], gap: number, top: number, bottom: number): number[] {
  const order = positions.map((y, index) => ({ y, index })).sort((a, b) => a.y - b.y);
  for (let at = 1; at < order.length; at += 1) {
    const above = order[at - 1], here = order[at];
    if (above && here && here.y - above.y < gap) here.y = above.y + gap;
  }
  const last = order.at(-1);
  if (last && last.y > bottom) {
    const shift = last.y - bottom;
    for (const item of order) item.y -= shift;
  }
  for (const item of order) item.y = Math.max(top, item.y);
  const out = new Array<number>(positions.length);
  for (const item of order) out[item.index] = item.y;
  return out;
}

export function PlotChart(props: {
  tracks: Track[]; gaps: { from: string; to: string }[]; years: number | null; logScale: boolean;
  unit: string; title: string; height: number; axis: AxisScale | null;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = holder.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect.width ?? 0);
      setWidth((previous) => (Math.abs(previous - next) > 1 ? next : previous));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = holder.current;
    if (!element || width === 0) return;
    const shown = visibleTracks(props.tracks, props.years);
    const direct = shown.length > 1 && shown.length <= DIRECT_LABEL_LIMIT;
    const rowsByTrack = shown.map((track) => {
      const rows: Row[] = track.points.map((point) => ({ date: new Date(point.t), value: point.v, name: track.name, color: track.color, period: point.p }));
      // A monthly or quarterly line is broken across a hole of more than a year, as on the series page.
      if (track.frequency !== "Annual") {
        for (const hole of longGapsOf(track.points.map((point) => point.t))) rows.push({ date: new Date(hole), value: Number.NaN, name: track.name, color: track.color, period: "" });
        rows.sort((a, b) => a.date.getTime() - b.date.getTime());
      }
      return rows;
    });
    const all = rowsByTrack.flat().filter((row) => Number.isFinite(row.value));
    if (all.length === 0) { element.replaceChildren(); return; }

    const values = all.map((row) => row.value);
    const logTicks = props.logScale ? powersOfTen(Math.min(...values), Math.max(...values)) : [];
    const marginRight = direct ? Math.min(150, Math.max(...shown.map((track) => labelWidth(track.name)))) : 12;
    const marginTop = 22, marginBottom = 24;
    const indexBase = /=\s?100/.test(props.unit) ? 100 : null;
    const options = (labels: Plot.Markish[]): Plot.PlotOptions => ({
      width, height: props.height, marginLeft: 44, marginRight, marginTop, marginBottom,
      style: { background: "transparent", color: "var(--muted)", fontSize: "11px", fontFamily: "inherit", overflow: "visible" },
      ariaLabel: props.title,
      ariaDescription: `${props.title}. ${shown.length} ${shown.length === 1 ? "line" : "lines"}, ${props.unit}.`,
      color: { type: "identity" },
      x: { type: "utc", label: null, ticks: Math.max(2, Math.floor(width / 90)) },
      y: props.logScale
        ? { type: "log", grid: true, label: props.axis?.title ?? null, labelAnchor: "top", labelArrow: "none", ticks: logTicks.length > 1 ? logTicks : undefined, domain: logTicks.length > 1 ? [logTicks[0] ?? 1, logTicks.at(-1) ?? 10] : undefined, tickFormat: props.axis?.format ?? fmtTick }
        : { grid: true, nice: true, ticks: 5, label: props.axis?.title ?? null, labelAnchor: "top", labelArrow: "none", tickFormat: props.axis?.format ?? fmtTick },
      marks: [
        isRate(props.unit) && !props.logScale ? Plot.ruleY([0], { stroke: "var(--line-strong)" }) : null,
        indexBase !== null && !props.logScale ? Plot.ruleY([indexBase], { stroke: "var(--line-strong)" }) : null,
        ...props.gaps.map((gap) => Plot.rectX([gap], { x1: () => new Date(periodTime(gap.from)), x2: () => new Date(periodTime(gap.to)), fill: "var(--amber)", fillOpacity: 0.09 })),
        ...rowsByTrack.map((rows, index) => Plot.lineY(rows, { x: "date", y: "value", stroke: shown[index]?.color, strokeWidth: 1.75, strokeDasharray: shown[index]?.dash || undefined })),
        ...labels,
        Plot.ruleX(all, Plot.pointerX({ x: "date", stroke: "var(--line-strong)" })),
        Plot.dot(all, Plot.pointerX({ x: "date", y: "value", fill: "color", r: 3.5, stroke: "var(--panel)" })),
        Plot.tip(all, Plot.pointerX({
          x: "date", y: "value", fill: "var(--panel)", stroke: "var(--line)",
          title: (row: Row) => `${shown.length > 1 ? `${row.name}\n` : ""}${periodPretty(row.period)}: ${fmt(row.value, props.unit)}`,
        })),
      ],
    });

    // End labels need the y scale to be placed apart, so the chart is laid out
    // once without them, and the labels are positioned on its scale.
    let labels: Plot.Markish[] = [];
    if (direct) {
      const draft = Plot.plot(options([]));
      const y = draft.scale("y");
      const ends = rowsByTrack.map((rows) => [...rows].reverse().find((row) => Number.isFinite(row.value)));
      const pixels = ends.map((end) => (end && y?.apply ? Number(y.apply(end.value)) : marginTop));
      const spread = spreadLabels(pixels, 13, marginTop, props.height - marginBottom);
      labels = ends.map((end, index) => {
        if (!end || !y?.invert) return null;
        return Plot.text([end], { x: "date", y: () => y.invert?.(spread[index] ?? 0), text: () => shown[index]?.name ?? "", fill: shown[index]?.color, textAnchor: "start", dx: 6, fontWeight: 600 });
      });
    }
    const figure = Plot.plot(options(labels));
    element.replaceChildren(figure);
    return () => figure.remove();
  }, [width, props.tracks, props.gaps, props.years, props.logScale, props.unit, props.title, props.height, props.axis]);

  return <div ref={holder} className="plot-chart" style={{ width: "100%", minHeight: props.height }} />;
}
