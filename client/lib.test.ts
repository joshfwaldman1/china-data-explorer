import { test, expect } from "bun:test";
import { canonicalPeriod, convertTrack, csvOf, deltaText, coarsestFrequency, fmt, fmtTick, isUpcoming, periodPretty, periodTime, rebase, regionalCsv, releaseTime, type Track } from "./lib.ts";

const monthly = (values: number[], year = 2025): Track => ({
  id: "t", name: "t", unit: "%", frequency: "Monthly", color: "", dash: "",
  points: values.map((v, i) => ({ t: Date.UTC(year, i, 1), v, p: `${year}-${String(i + 1).padStart(2, "0")}` })),
});

test("periods parse to timestamps and back to readable labels", () => {
  expect(new Date(periodTime("2026-07")).toISOString()).toBe("2026-07-01T00:00:00.000Z");
  expect(new Date(periodTime("2026-Q2")).toISOString()).toBe("2026-06-01T00:00:00.000Z");
  expect(periodPretty("2026-Q2")).toBe("Q2 2026");
  expect(periodPretty("2026-07")).toBe("Jul 2026");
});

test("numbers format by unit: rates to one decimal, levels with separators", () => {
  expect(fmt(4.5678, "%")).toBe("4.6");
  expect(fmt(351222.7, "亿元")).toBe("351,223");
  expect(fmtTick(385000)).toBe("385K");
});

test("monthly to quarterly averages, dropping an incomplete final quarter", () => {
  const out = convertTrack(monthly([1, 2, 3, 4, 5, 6, 7]), "Quarterly", "avg");
  expect(out.frequency).toBe("Quarterly");
  expect(out.points.map((p) => [p.p, p.v])).toEqual([["2025-Q1", 2], ["2025-Q2", 5]]);
});

test("a year or quarter missing one reading still converts, an open-ended one does not", () => {
  // NBS publishes January and February of industrial output together, so each year has eleven
  // monthly points and each first quarter two. Such a series is marked combinedFebruary, which is
  // what lets a period one reading short still count as whole.
  const noJanuary = (year: number): Track["points"] => Array.from({ length: 11 }, (_, i) => ({ t: Date.UTC(year, i + 1, 1), v: i + 1, p: `${year}-${String(i + 2).padStart(2, "0")}` }));
  const track: Track = { ...monthly([]), combinedFebruary: true, points: [...noJanuary(2024), ...noJanuary(2025), { t: Date.UTC(2026, 1, 1), v: 1, p: "2026-02" }, { t: Date.UTC(2026, 2, 1), v: 3, p: "2026-03" }, { t: Date.UTC(2026, 3, 1), v: 5, p: "2026-04" }] };
  expect(convertTrack(track, "Annual", "avg").points.map((p) => p.p)).toEqual(["2024", "2025"]);
  const quarters = convertTrack(track, "Quarterly", "avg").points.map((p) => p.p);
  expect(quarters.slice(0, 4)).toEqual(["2024-Q1", "2024-Q2", "2024-Q3", "2024-Q4"]);
  expect(quarters.at(-1)).toBe("2026-Q1");
});

test("sum and end-of-period aggregation; coarser input is left alone", () => {
  expect(convertTrack(monthly([1, 2, 3]), "Quarterly", "sum").points[0]?.v).toBe(6);
  expect(convertTrack(monthly([1, 2, 3]), "Quarterly", "last").points[0]?.v).toBe(3);
  const quarterly: Track = { ...monthly([1]), frequency: "Quarterly" };
  expect(convertTrack(quarterly, "Quarterly", "avg")).toBe(quarterly);
});

test("a compare that mixes frequencies targets the coarsest one", () => {
  expect(coarsestFrequency([monthly([1]), { ...monthly([1]), frequency: "Quarterly" }])).toBe("Quarterly");
  expect(coarsestFrequency([monthly([1]), { ...monthly([1]), frequency: "Annual" }])).toBe("Annual");
  expect(coarsestFrequency([monthly([1]), monthly([2])])).toBe("");
});

test("rebasing indexes each series to 100 at the first shown period", () => {
  const [out] = rebase([monthly([50, 75, 100])], Date.UTC(2025, 0, 1));
  expect(out?.points.map((p) => p.v)).toEqual([100, 150, 200]);
  expect(out?.unit).toContain("= 100");
});

test("canonicalPeriod puts a native quarterly month and an aggregated quarter on one key", () => {
  expect(canonicalPeriod("2026-06", "Quarterly")).toBe("2026-Q2");
  expect(canonicalPeriod("2026-Q2", "Quarterly")).toBe("2026-Q2");
  expect(canonicalPeriod("2026-06", "Monthly")).toBe("2026-06");
});

test("fmt never shows a negative zero", () => {
  expect(fmt(-0.03, "%")).toBe("0.0");
  expect(fmt(-0.00001, "Hundred million yuan")).toBe("0");
  // A level below a thousand keeps the decimals the publisher gave it.
  expect(fmt(552, "Hundred million yuan")).toBe("552");
  expect(fmt(484.8, "Hundred million USD")).toBe("484.8");
  expect(fmt(6.7828, "Yuan per US dollar")).toBe("6.7828");
  expect(fmt(0.86154, "Yuan per unit")).toBe("0.8615");
  expect(fmt(-0.06, "%")).toBe("-0.1");
});

test("deltaText says pp for percentages only", () => {
  expect(deltaText({ date: "2026-08", value: 3.0 }, { date: "2026-07", value: 3.0 }, "%", "short")).toBe("0.0 pp");
  // A difference that rounds to nothing is not "-0.0 pp".
  expect(deltaText({ date: "2026-08", value: 3.02 }, { date: "2026-07", value: 3.04 }, "Percent change from year ago", "short")).toBe("0.0 pp");
  expect(deltaText({ date: "2026-08", value: 3.02 }, { date: "2026-07", value: 3.04 }, "Percent change from year ago")).toBe("Unchanged from Jul 2026");
  // A bond yield is quoted to two decimals, so its small moves are not rounded away.
  expect(deltaText({ date: "2026-08", value: 1.6879 }, { date: "2026-07", value: 1.7120 }, "Percent, month-end close", "short")).toBe("-0.02 pp");
  expect(deltaText({ date: "2026-08", value: 34383 }, { date: "2026-07", value: 34383 }, "100M USD", "short")).toBe("0");
  expect(deltaText({ date: "2026-07", value: 0.5 }, { date: "2026-06", value: 1.0 }, "Percent change from year ago")).toBe("Down 0.5 pp from Jun 2026");
  expect(deltaText({ date: "2026-07", value: 99.9 }, { date: "2026-06", value: 99.7 }, "Index, previous month = 100")).toBe("Up 0.2 from Jun 2026");
});

test("a release is upcoming until its China Standard Time instant has passed", () => {
  // 09:30 CST is 01:30 UTC.
  expect(releaseTime("2026-09-09 09:30:00")).toBe(Date.UTC(2026, 8, 9, 1, 30));
  expect(releaseTime("2026-09-09")).toBe(Date.UTC(2026, 8, 9, 1, 30));
  const morning = Date.UTC(2026, 8, 9, 0, 0);   // 08:00 CST, before the release
  const evening = Date.UTC(2026, 8, 9, 11, 45); // 19:45 CST, after it
  expect(isUpcoming("2026-09-09 09:30:00", morning)).toBe(true);
  expect(isUpcoming("2026-09-09 09:30:00", evening)).toBe(false);
  expect(isUpcoming("not a date", morning)).toBe(false);
});

test("the CSV header names the region when a series carries one", () => {
  const track: Track = { id: "a", name: "New homes (YoY %)", unit: "%", frequency: "Monthly", color: "#000", dash: "", points: [{ t: periodTime("2026-06"), v: -3.4, p: "2026-06" }, { t: periodTime("2026-07"), v: -2.3, p: "2026-07" }] };
  const meta = { title: "New Home Prices, 70 Cities", unit: "Percent change from year ago", agency: "National Bureau of Statistics" };
  const beijing = csvOf([{ ...meta, region: "Beijing" }], [track], []);
  expect(beijing.split("\n")[1]).toBe("# Region: Beijing");
  expect(beijing).toContain('"period","New homes (YoY %)"');
  expect(beijing.trim().split("\n").at(-1)).toBe('"2026-07","-2.3"');
  // National series say nothing about a region, and two regions are listed together.
  expect(csvOf([meta], [track], []).split("\n")[1]).toBe("# Unit: Percent change from year ago");
  expect(csvOf([{ ...meta, region: "Beijing" }, { ...meta, region: "Shanghai" }], [track], []).split("\n")[1]).toBe("# Region: Beijing | Shanghai");
});

test("a quarter of two monthly readings counts only when February is the combined figure", () => {
  const monthly = (dates: string[]): Track => ({
    id: "t", name: "t", unit: "万人", frequency: "Monthly", color: "#000", dash: "",
    points: dates.map((date) => ({ t: periodTime(date), v: 10, p: date })),
  });
  const firstQuarter = ["2026-02", "2026-03"];
  // A series whose February is the combined January-February figure: the quarter is whole, and
  // summing the two readings is the quarter's total.
  const combined = { ...monthly(firstQuarter), combinedFebruary: true };
  expect(convertTrack(combined, "Quarterly", "sum").points.map((point) => point.p)).toEqual(["2026-Q1"]);
  expect(convertTrack(combined, "Quarterly", "sum").points[0]?.v).toBe(20);
  // A series that publishes a single February and no January is short a month, so the quarter goes.
  expect(convertTrack(monthly(firstQuarter), "Quarterly", "sum").points).toEqual([]);
  expect(convertTrack(monthly(["2026-01", ...firstQuarter]), "Quarterly", "sum").points.map((point) => point.p)).toEqual(["2026-Q1"]);
});

test("a regional cross-section downloads as a row per place", () => {
  const csv = regionalCsv(
    { title: "Gross regional product", unit: "100 million yuan", period: "2024", agency: "National Bureau of Statistics" },
    [
      { en: "Guangdong", zh: "广东省", code: "440000000000", value: 141489.2 },
      { en: "Tibet", zh: "西藏自治区", code: "540000000000", value: null },
    ],
  );
  const lines = csv.split("\n");
  expect(lines[0]).toBe("# Series: Gross regional product");
  expect(lines).toContain('"place","place_zh","nbs_code","value"');
  expect(lines).toContain('"Guangdong","广东省","440000000000",141489.2');
  // A place with nothing published keeps its row and an empty value.
  expect(lines).toContain('"Tibet","西藏自治区","540000000000",');
});

test("ordinal writes the day of the month as English does", async () => {
  const { ordinal } = await import("./lib.ts");
  expect([1, 2, 3, 4, 11, 12, 13, 14, 21, 22, 23, 31].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "14th", "21st", "22nd", "23rd", "31st"]);
});

test("a level's change is read against a year earlier, as a percentage", async () => {
  const { yearEarlier, yearOnYearText } = await import("./lib.ts");
  expect(yearEarlier("2026-07")).toBe("2025-07");
  expect(yearEarlier("2026-Q2")).toBe("2025-Q2");
  expect(yearEarlier("2026")).toBe("2025");
  expect(yearOnYearText({ date: "2026-07", value: 10400 }, { date: "2025-07", value: 9610 })).toBe("+8.2% y/y");
  expect(yearOnYearText({ date: "2026-07", value: 9000 }, { date: "2025-07", value: 9610 })).toBe("-6.3% y/y");
  expect(yearOnYearText({ date: "2026-07", value: 9610 }, { date: "2025-07", value: 9610 })).toBe("0.0% y/y");
  expect(yearOnYearText({ date: "2026-07", value: 9610 }, undefined)).toBe("");
  // A net figure changes in its own units, and so does anything that crossed zero.
  expect(yearOnYearText({ date: "2026-08", value: 3290.15 }, { date: "2025-08", value: 1044.6 }, { absolute: true })).toBe("+2,246 y/y");
  expect(yearOnYearText({ date: "2026-08", value: 484.8 }, { date: "2025-08", value: -120.2 })).toBe("+605 y/y");
  // Money-market rates keep two decimals.
  expect(fmt(1.46, "Percent, last fixing of the month")).toBe("1.46");
  expect(fmt(1.6879, "Percent, month-end close")).toBe("1.69");
});

test("a per-thousand rate is a rate: two decimals, points for its change", () => {
  expect(fmt(6.77, "Per thousand (‰)")).toBe("6.77");
  expect(deltaText({ date: "2025", value: 6.39 }, { date: "2024", value: 6.77 }, "Per thousand (‰)", "short")).toBe("-0.38 pt");
});
