import { describe, expect, test } from "bun:test";
import { IMAGE, LIGHT, layoutShareImage, logTicks, niceTicks, spreadLabels, subtitleOf, timeTicks, visibleTracks, wrapText, type ShareInput } from "./export";
import type { Track } from "./lib";

/** A width stub: 0.55 em per character, which is close to Plex Sans at these sizes. */
const measure = (text: string, font: string) => { const size = Number(font.match(/(\d+)px/)?.[1] ?? 16); return text.length * size * 0.55; };

function track(id: string, values: number[], options: Partial<Track> = {}): Track {
  const points = values.map((v, index) => { const year = 2015 + Math.floor(index / 12), month = index % 12; return { t: Date.UTC(year, month, 1), v, p: `${year}-${String(month + 1).padStart(2, "0")}` }; });
  return { id, name: id, unit: "%", frequency: "Monthly", color: "var(--chart-1)", dash: "", points, ...options };
}

describe("niceTicks", () => {
  test("brackets the data on a 1-2-5 step", () => {
    const scale = niceTicks(0.3, 7.8);
    expect(scale.lo).toBe(0); expect(scale.hi).toBe(8); expect(scale.ticks).toEqual([0, 2, 4, 6, 8]);
  });
  test("spans zero when the data does", () => {
    const scale = niceTicks(-3.2, 4.1);
    expect(scale.ticks).toContain(0); expect(scale.lo).toBeLessThan(-3.2); expect(scale.hi).toBeGreaterThan(4.1);
  });
  test("pads a flat series instead of collapsing", () => {
    const scale = niceTicks(3, 3);
    expect(scale.hi - scale.lo).toBeGreaterThan(0); expect(scale.ticks.length).toBeGreaterThan(1);
  });
});

describe("logTicks", () => {
  test("uses decades over a wide span", () => {
    const scale = logTicks(3, 4000);
    expect(scale.ticks).toEqual([1, 10, 100, 1000, 10000]);
  });
  test("adds 2x and 5x steps over a short span", () => {
    const scale = logTicks(20, 80);
    expect(scale.ticks).toContain(20); expect(scale.ticks).toContain(50);
  });
  test("a span narrower than a doubling gets evenly spaced labels rather than one or none", () => {
    const scale = logTicks(30000, 34383);
    expect(scale.ticks.length).toBeGreaterThanOrEqual(3);
    expect(scale.lo).toBeGreaterThan(0); expect(scale.lo).toBeLessThanOrEqual(30000); expect(scale.hi).toBeGreaterThanOrEqual(34383);
    expect(scale.ticks.every((value) => value >= scale.lo && value <= scale.hi)).toBe(true);
  });
});

describe("timeTicks", () => {
  test("annual points, dated December, get their year label on the point rather than at the following January", () => {
    const ticks = timeTicks(Date.UTC(2016, 11, 1), Date.UTC(2025, 11, 1), 1600, 90, "Annual");
    expect(ticks.map((tick) => tick.label)).toEqual(["2016", "2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025"]);
    expect(ticks[0]?.t).toBe(Date.UTC(2016, 11, 1));
  });
  test("a one-year quarterly view steps by quarters from the data's own quarter-end months", () => {
    const ticks = timeTicks(Date.UTC(2025, 5, 1), Date.UTC(2026, 5, 1), 1600, 90, "Quarterly");
    expect(ticks.map((tick) => tick.label)).toEqual(["Jun 25", "Sep 25", "Dec 25", "Mar 26", "Jun 26"]);
  });
  test("one label per year on a long span, spaced for the width", () => {
    const ticks = timeTicks(Date.UTC(2010, 0, 1), Date.UTC(2025, 0, 1), 1300);
    expect(ticks[0]?.label).toBe("2010");
    expect(ticks.at(-1)?.label).toBe("2024");
    expect(ticks.length).toBeLessThanOrEqual(15);
    expect(ticks.every((tick) => /^\d{4}$/.test(tick.label))).toBe(true);
  });
  test("annual points get year labels on any span, quarterly ones beyond three years", () => {
    const annual = timeTicks(Date.UTC(2015, 0, 1), Date.UTC(2020, 0, 1), 1300, 90, "Annual");
    expect(annual.map((tick) => tick.label)).toEqual(["2015", "2016", "2017", "2018", "2019", "2020"]);
    const quarterly = timeTicks(Date.UTC(2021, 6, 1), Date.UTC(2026, 6, 1), 1300, 90, "Quarterly");
    expect(quarterly.every((tick) => /^\d{4}$/.test(tick.label))).toBe(true);
    const shortQuarterly = timeTicks(Date.UTC(2024, 0, 1), Date.UTC(2026, 0, 1), 1300, 90, "Quarterly");
    expect(shortQuarterly[0]?.label).toMatch(/^[A-Z][a-z]{2} \d{2}$/);
  });
  test("month labels on a short span, at least 90px apart", () => {
    const width = 1300;
    const ticks = timeTicks(Date.UTC(2024, 0, 1), Date.UTC(2026, 0, 1), width);
    expect(ticks[0]?.label).toMatch(/^[A-Z][a-z]{2} \d{2}$/);
    const px = (t: number) => ((t - Date.UTC(2024, 0, 1)) / (Date.UTC(2026, 0, 1) - Date.UTC(2024, 0, 1))) * width;
    for (let index = 1; index < ticks.length; index += 1) expect(px(ticks[index]?.t ?? 0) - px(ticks[index - 1]?.t ?? 0)).toBeGreaterThanOrEqual(80);
  });
});

describe("spreadLabels", () => {
  test("pushes overlapping labels apart and keeps order", () => {
    expect(spreadLabels([100, 105, 300], 20, 0, 400)).toEqual([100, 120, 300]);
  });
  test("clamps inside the bounds", () => {
    const out = spreadLabels([395, 398], 20, 0, 400);
    expect(out[1]).toBe(400); expect(out[0]).toBe(380);
  });
  test("returns positions in the original order", () => {
    const out = spreadLabels([300, 100], 20, 0, 400);
    expect(out[0]).toBeGreaterThan(out[1] ?? 0);
  });
});

describe("wrapText", () => {
  test("wraps a long title to two lines and ends with an ellipsis", () => {
    const lines = wrapText("word ".repeat(60).trim(), 300, "600 34px x", measure, 2);
    expect(lines.length).toBe(2);
    expect(lines[1]?.endsWith("…")).toBe(true);
  });
  test("character-wraps Chinese text", () => {
    const lines = wrapText("居民消费价格指数月度报告居民消费价格指数月度报告", 200, "400 20px x", measure, 3);
    expect(lines.length).toBeGreaterThan(1);
  });
});

describe("visibleTracks and subtitle", () => {
  test("windows to the last N years", () => {
    const shown = visibleTracks([track("a", Array.from({ length: 60 }, (_, i) => i))], 2);
    expect(shown[0]?.points.length).toBeLessThanOrEqual(25);
  });
  test("subtitle joins unit, frequency and range with commas", () => {
    const text = subtitleOf("Percent per annum", ["Monthly"], [track("a", [1, 2, 3])]);
    expect(text).toBe("Percent per annum, monthly, Jan 2015 to Mar 2015");
    expect(text).not.toContain("·");
  });
});

describe("layoutShareImage", () => {
  const input: ShareInput = {
    title: "Loan Prime Rate (LPR)", unit: "Percent per annum", frequencies: ["Monthly"],
    tracks: [track("LPR 1-Year", [4.3, 4.2, 4.0, 3.9, 3.85]), track("LPR 5-Year", [4.85, 4.8, 4.75, 4.65, 4.65], { color: "var(--chart-2)", dash: "6 3" })],
    gaps: [{ from: "2015-02", to: "2015-04" }], notes: ["A note."], logScale: false, lunar: false,
    source: "People's Bank of China", url: "https://example.org/#/series/lpr", date: "8 Sep 2026",
  };
  const layout = layoutShareImage(input, measure);
  test("the subtitle names the log scale when it is on", () => {
    expect(layout.subtitle.text.endsWith("log scale")).toBe(false);
    expect(layoutShareImage({ ...input, logScale: true }, measure).subtitle.text.endsWith(", log scale")).toBe(true);
  });
  test("plot sits inside the frame", () => {
    expect(layout.width).toBe(IMAGE.width); expect(layout.height).toBe(IMAGE.height);
    expect(layout.plot.x).toBeGreaterThan(0); expect(layout.plot.x + layout.plot.w).toBeLessThan(IMAGE.width);
    expect(layout.plot.y).toBeGreaterThan(80); expect(layout.plot.y + layout.plot.h).toBeLessThan(IMAGE.height - 60);
  });
  test("one polyline per track with every visible point, dashed where the track is dashed", () => {
    expect(layout.lines.length).toBe(2);
    expect(layout.lines[0]?.points.length).toBe(5);
    expect(layout.lines[1]?.dash).toEqual([9, 4.5]);
    expect(layout.lines[1]?.color).toBe(LIGHT.chart[1]);
  });
  test("one end label per track, formatted to the unit, inside the plot height", () => {
    expect(layout.endLabels.map((label) => label.text)).toEqual(["3.9", "4.7"]);
    for (const label of layout.endLabels) { expect(label.y).toBeGreaterThanOrEqual(layout.plot.y); expect(label.y).toBeLessThanOrEqual(layout.plot.y + layout.plot.h); }
  });
  test("legend only when more than one track; gap produces a band; footer carries the URL without the scheme", () => {
    expect(layout.legend.length).toBe(2);
    expect(layoutShareImage({ ...input, tracks: input.tracks.slice(0, 1) }, measure).legend.length).toBe(0);
    expect(layout.bands.length).toBe(1);
    expect(layout.footer.url.text).toContain("example.org/#/series/lpr");
    expect(layout.footer.url.text).not.toContain("https://");
    expect(layout.footer.source.text).toBe("Source: People's Bank of China");
  });
  test("a long note wraps to a second line instead of ending in an ellipsis; notes take at most three lines", () => {
    const long = "NBS suspended the 16-24 unemployment rate after June 2023 and resumed it in December 2023 on a new basis that excludes students. Readings before and after the shaded gap are not comparable, and a change across it should not be read as a change in labor-market conditions.";
    const wrapped = layoutShareImage({ ...input, notes: [long] }, measure);
    expect(wrapped.notes.length).toBe(2);
    expect(wrapped.notes.map((note) => note.text).join(" ")).toBe(long);
    expect(wrapped.plot.h).toBeLessThan(layout.plot.h);
    const three = layoutShareImage({ ...input, notes: [long, long] }, measure);
    expect(three.notes.length).toBe(3);
    expect(three.notes[2]?.text.endsWith("…")).toBe(true);
  });
  test("a page URL too long for the footer gives way to the host alone, never an ellipsis", () => {
    const keys = ["440000000000", "310000000000", "540000000000", "110000000000"].map((code) => `provincial_gdp@${code}`).join(",");
    const long = layoutShareImage({ ...input, url: `https://econstats-china-production.up.railway.app/#/series/${keys}?range=10y` }, measure);
    expect(long.footer.url.text).toBe("econstats-china-production.up.railway.app");
    expect(long.footer.url.text).not.toContain("…");
  });
  test("log scale maps 10 below 100", () => {
    const log = layoutShareImage({ ...input, logScale: true, tracks: [track("a", [10, 100, 1000])] }, measure);
    const [p10, p100] = log.lines[0]?.points ?? [];
    expect((p10?.[1] ?? 0) > (p100?.[1] ?? 0)).toBe(true);
  });
});

test("LIGHT palette matches the light tokens in styles.css", async () => {
  const css = await Bun.file(new URL("./styles.css", import.meta.url)).text();
  const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
  const token = (name: string) => root.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1]?.toLowerCase();
  expect(token("ink")).toBe(LIGHT.ink); expect(token("muted")).toBe(LIGHT.muted); expect(token("line")).toBe(LIGHT.line);
  expect(token("line-strong")).toBe(LIGHT.lineStrong); expect(token("amber")).toBe(LIGHT.amber); expect(token("navy")).toBe(LIGHT.navy);
  LIGHT.chart.forEach((hex, index) => expect(token(`chart-${index + 1}`)).toBe(hex));
});

test("subtitle on a quarterly compare uses quarter labels even for month-dated points", () => {
  const quarterly: Track = { id: "q", name: "q", unit: "%", frequency: "Quarterly", color: "var(--chart-1)", dash: "", points: [{ t: Date.UTC(2016, 5, 1), v: 1, p: "2016-06" }, { t: Date.UTC(2026, 5, 1), v: 2, p: "2026-06" }] };
  expect(subtitleOf("Percent", ["Quarterly"], [quarterly])).toBe("Percent, quarterly, Q2 2016 to Q2 2026");
});

test("shared images reserve adjustment text even when notes are full and label mixed legends", () => {
  const sa=track("PMI",[49,50,51],{seasonalAdjustment:"sa"});
  const nsa=track("Trade",[1,2,3],{seasonalAdjustment:"nsa"});
  const input: ShareInput = {title:"Comparison",unit:"Index",frequencies:["Monthly"],tracks:[sa,nsa],gaps:[],notes:Array(5).fill("A long methodology note repeated to fill the available note space."),logScale:false,lunar:false,source:"Fixture",url:"https://example.org",date:"Oct 3, 2026"};
  const layout=layoutShareImage(input,measure);
  expect(layout.adjustment.text).toBe("Seasonal adjustment varies by series");
  expect(layout.legend.map(item=>item.text)).toEqual(["PMI (SA)","Trade (NSA)"]);
  expect(layout.adjustment.y).toBeGreaterThan(layout.subtitle.y);
  expect(layout.adjustment.y).toBeLessThan(layout.plot.y);
  expect(layoutShareImage({...input,tracks:[sa]},measure).adjustment.text).toBe("Seasonally adjusted");
});
