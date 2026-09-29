import { test, expect } from "bun:test";
import { axisScale, lineUnit, naturalUnit, naturalValue, withoutUnitSuffix,bareLabel, canonicalPeriod, isOpenMonth, convertTrack, csvOf, deltaText, coarsestFrequency, isCumulative, periodSpan, sharedLabelSuffix, withoutSharedSuffix, yearEarlier, fmt, fmtTick, isUpcoming, periodPretty, periodTime, rebase, regionalCsv, releaseTime, type Track } from "./lib.ts";

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
  expect(deltaText({ date: "2025", value: 6.39 }, { date: "2024", value: 6.77 }, "Per thousand (‰)", "short")).toBe("-0.38 per 1,000");
});

test("a cumulative reading names the months it covers, not the month it is dated", () => {
  expect(periodSpan("2026-07", "Monthly")).toBe("January to July 2026");
  expect(periodSpan("2026-01", "Monthly")).toBe("January 2026");
  expect(periodSpan("2026-Q2", "Quarterly")).toBe("Q1 to Q2 2026");
  expect(periodSpan("2026-06", "Quarterly")).toBe("Q1 to Q2 2026");
  expect(periodSpan("2025", "Annual")).toBe("2025");
  expect(isCumulative("Percent change from year ago, cumulative year to date")).toBe(true);
  expect(isCumulative("Percent change from year ago", "Industrial profits, year to date (YoY %)")).toBe(true);
  expect(isCumulative("Percent change from year ago", "CPI (YoY %)", "Consumer Price Index")).toBe(false);
  expect(yearEarlier("2026-07")).toBe("2025-07");
  expect(yearEarlier("2026-Q2")).toBe("2025-Q2");
});

test("the change on a cumulative series is from the shorter span before it", () => {
  const latest = { date: "2026-07", value: 17.6 }, previous = { date: "2026-06", value: 18.7 };
  expect(deltaText(latest, previous, "Percent change from year ago, cumulative year to date", "long", "Monthly", true)).toBe("Down 1.1 pp from January to June 2026");
  expect(deltaText(latest, previous, "Percent change from year ago", "long", "Monthly")).toBe("Down 1.1 pp from Jun 2026");
});

test("a legend names the lines and the measure they share is taken off each", () => {
  const names = ["Industrial profits, year to date (YoY %)", "Manufacturing, year to date (YoY %)", "Mining, year to date (YoY %)", "Utilities, year to date (YoY %)"];
  expect(sharedLabelSuffix(names)).toBe(", year to date (YoY %)");
  expect(withoutSharedSuffix(names.map((name) => ({ ...monthly([1]), id: name, name }))).map((track) => track.name)).toEqual(["Industrial profits", "Manufacturing", "Mining", "Utilities"]);
  // Two lines that share only letters, or one line, keep their names.
  expect(sharedLabelSuffix(["Exports", "Imports"])).toBe("");
  expect(sharedLabelSuffix(["Exports (YoY %)"])).toBe("");
  // A suffix that would swallow a whole name is not shared.
  expect(sharedLabelSuffix(["Total, year to date", ", year to date"])).toBe("");
  expect(bareLabel("Industrial profits, year to date (YoY %)")).toBe("Industrial profits");
  expect(bareLabel("New energy vehicles, month (YoY %)")).toBe("New energy vehicles");
  expect(bareLabel("Surveyed urban (%)")).toBe("Surveyed urban");
});

test("a month-end reading for the running month says so; a rate fixed once a month does not", () => {
  const now = new Date("2026-09-25T12:00:00.000Z");
  expect(isOpenMonth("2026-09", "Percent, month-end close", now)).toBe(true);
  expect(isOpenMonth("2026-09", "Yuan per unit of foreign currency, last fixing of the month", now)).toBe(true);
  expect(isOpenMonth("2026-09", "Index, 31 December 2014 = 100, last weekly reading of the month", now)).toBe(true);
  // August closed; the reading stands as the month's.
  expect(isOpenMonth("2026-08", "Percent, month-end close", now)).toBe(false);
  // The LPR is fixed on the 20th and final when it appears.
  expect(isOpenMonth("2026-09", "Percent per annum", now)).toBe(false);
  // A monthly release for the running month (none exists, but the rule must not fire on it).
  expect(isOpenMonth("2026-09", "Percent change from year ago", now)).toBe(false);
});

test("a three-month average runs over calendar months, so a missing month is left out rather than an older one pulled in", async () => {
  const { movingAverage } = await import("./lib");
  const track: Track = { id: "t", name: "Exports", unit: "%", frequency: "Monthly", color: "", dash: "", points: [
    { t: Date.UTC(2025, 11, 1), v: 6.6, p: "2025-12" }, { t: Date.UTC(2026, 1, 1), v: 39.6, p: "2026-02" }, { t: Date.UTC(2026, 2, 1), v: 2.5, p: "2026-03" }, { t: Date.UTC(2026, 3, 1), v: 14.1, p: "2026-04" },
  ] };
  const smoothed = movingAverage(track, 3);
  expect(smoothed.name).toBe("Exports, 3-month average");
  // February's window is December to February; January is absent, so it averages the two it has.
  expect(smoothed.points.map((point) => point.v)).toEqual([6.6, 23.1, 21.05, 18.73]);
  // A quarterly track is not smoothed.
  const quarterly: Track = { ...track, frequency: "Quarterly" };
  expect(movingAverage(quarterly, 3)).toBe(quarterly);
});

// ── Natural units ──

test("3,476,700 亿元 reads as 347.7 trillion yuan, in every spelling of the unit", () => {
  // 1 亿 is 100 million, so 3,476,700 亿 is 347,670,000,000,000.
  expect(naturalValue(3_476_700, "亿元")).toBe("347.7 trillion yuan");
  expect(naturalValue(3_476_700, "(亿元)")).toBe("347.7 trillion yuan");
  expect(naturalValue(3_476_700, "Hundred million yuan (亿元), cumulative year to date")).toBe("347.7 trillion yuan");
  expect(naturalValue(3_476_700, "Hundred million CNY (亿元)")).toBe("347.7 trillion yuan");
  expect(naturalValue(3_476_700, "100 million yuan (亿元)")).toBe("347.7 trillion yuan");
  expect(naturalValue(3_476_700, "100M yuan")).toBe("347.7 trillion yuan");
  // Below a trillion it steps down a word rather than printing "0.9 trillion".
  expect(naturalValue(9_000, "亿元")).toBe("900 billion yuan");
});

test("each unit family converts by its own multiple", () => {
  // 万元: 10,000 yuan.
  expect(naturalValue(52_000, "万元")).toBe("520 million yuan");
  // Million USD in each spelling: 1,400,000 million is 1.4 trillion.
  expect(naturalValue(1_400_000, "Million USD")).toBe("1.4 trillion US dollars");
  expect(naturalValue(1_400_000, "Millions of US dollars")).toBe("1.4 trillion US dollars");
  expect(naturalValue(1_400_000, "USD millions")).toBe("1.4 trillion US dollars");
  expect(naturalValue(1_400_000, "百万美元")).toBe("1.4 trillion US dollars");
  // 亿美元: 100 million USD; 33,000 of them is 3.3 trillion.
  expect(naturalValue(33_000, "Hundred million USD (亿美元)")).toBe("3.3 trillion US dollars");
  expect(naturalValue(33_000, "亿美元")).toBe("3.3 trillion US dollars");
  // 万人: 10,000 persons; 145,000 of them is 1.45 billion.
  expect(naturalValue(145_000, "Ten thousand persons (万人)")).toBe("1.45 billion people");
  expect(naturalValue(145_000, "万人")).toBe("1.45 billion people");
  expect(naturalValue(145_000, "10,000 persons")).toBe("1.45 billion people");
  expect(naturalValue(62, "万人")).toBe("620 thousand people");
  // 万吨: 10,000 tonnes.
  expect(naturalValue(15_600, "Ten thousand tonnes (万吨), month")).toBe("156 million tonnes");
  expect(naturalValue(15_600, "10,000 tonnes")).toBe("156 million tonnes");
  // Already in a large multiple, and in the thing itself.
  expect(naturalValue(30.2, "Trillion yuan (万亿元)")).toBe("30.2 trillion yuan");
  expect(naturalValue(18.74, "Trillions of current US dollars")).toBe("18.74 trillion US dollars");
  expect(naturalValue(8_000, "Hundred million kWh (亿千瓦时)")).toBe("800 billion kWh");
  // A negative flow keeps its sign.
  expect(naturalValue(-2_345, "Hundred million yuan (亿元)")).toBe("-234.5 billion yuan");
});

test("percent, index, rate and ratio units are left untouched", () => {
  for (const unit of ["%", "Percent", "Percent change from year ago", "Percent of GDP", "Percent per annum", "Index", "Index, 2020 = 100",
    "Diffusion index (50 = neutral)", "上年同月=100", "Per thousand (‰)", "Yuan per person, cumulative year to date", "Yuan per US dollar",
    "元/人", "Hours per week", "Enterprises, cumulative year to date", "Years", "万人次", "万吨标准煤", "Change from previous period",
    // Two series' units on one raw axis: neither scale is the axis's.
    "Hundred million yuan (亿元); Million USD", ""]) {
    expect(naturalUnit(unit)).toBeNull();
    expect(naturalValue(123_456, unit)).toBeNull();
    expect(axisScale(unit, [0, 50_000, 100_000])).toBeNull();
  }
});

test("an axis over 100 million yuan picks trillion when the range passes 10,000", () => {
  const trillions = axisScale("Hundred million yuan (亿元)", [0, 100_000, 200_000, 300_000]);
  expect(trillions?.title).toBe("Trillions of yuan");
  // The old axis read "300K" here.
  expect([0, 100_000, 200_000, 300_000].map((tick) => trillions?.format(tick))).toEqual(["0", "10", "20", "30"]);
  // One tick below 10,000 亿 and the axis stays in billions.
  const billions = axisScale("亿元", [0, 2_000, 4_000, 6_000, 8_000]);
  expect(billions?.title).toBe("Billions of yuan");
  expect(billions?.format(8_000)).toBe("800");
  // Ticks closer than a whole trillion keep the decimals that tell them apart, and no more.
  const close = axisScale("亿元", [28_000, 28_500, 29_000, 29_500]);
  expect([28_000, 28_500, 29_000, 29_500].map((tick) => close?.format(tick))).toEqual(["2.80", "2.85", "2.90", "2.95"]);
});

test("the axis examples the copy audit named read in natural units", () => {
  // "1.4M" over million USD.
  const dollars = axisScale("Million USD", [0, 500_000, 1_000_000, 1_500_000]);
  expect(dollars?.title).toBe("Trillions of US dollars");
  expect(dollars?.format(1_500_000)).toBe("1.5");
  expect(dollars?.format(1_000_000)).toBe("1.0");
  // "145K" over 10,000 persons.
  const people = axisScale("Ten thousand persons (万人)", [140_000, 142_500, 145_000]);
  expect(people?.title).toBe("Billions of people");
  expect(people?.format(145_000)).toBe("1.450");
  const tonnes = axisScale("万吨", [0, 5_000, 10_000, 15_000]);
  expect(tonnes?.title).toBe("Millions of tonnes");
  expect(tonnes?.format(15_000)).toBe("150");
});

test("a quantity line is never given a money scale", () => {
  // Customs stores value and quantity under one series unit; the quantity's own unit is in its label.
  expect(lineUnit("Quantity (10,000 Sets)", "Million USD")).toBe("10,000 Sets");
  expect(lineUnit("Quantity (Ton)", "Hundred million CNY (亿元)")).toBe("Ton");
  expect(lineUnit("Quantity", "Million USD")).toBe("");
  expect(lineUnit("Value", "Million USD")).toBe("Million USD");
  for (const label of ["Quantity (10,000 Sets)", "Quantity (10,000 Autos)", "Quantity (Ship)", "Quantity (Ton)", "Quantity"]) {
    expect(naturalValue(4_043_000, lineUnit(label, "Million USD"))).toBeNull();
    expect(axisScale(lineUnit(label, "Million USD"), [0, 2_000_000, 4_000_000])).toBeNull();
  }
});

test("close ticks never repeat: the axis drops to the next word down when three decimals are not enough", () => {
  // Year-end population, 140,828 to 140,967 万人: "1.408 | 1.409 | 1.409" in billions.
  const ticks = [140_800, 140_825, 140_850, 140_875, 140_900, 140_925, 140_950, 140_975];
  const people = axisScale("Ten thousand persons (万人)", ticks, 140_967);
  expect(people?.title).toBe("Millions of people");
  const labels = ticks.map((tick) => people?.format(tick));
  expect(new Set(labels).size).toBe(ticks.length);
  expect(labels[1]).toBe("1,408.25");
  // FX reserves, 34,380 to 34,395 亿美元: "3.438 | 3.439 | 3.439" in trillions.
  const reserveTicks = [34_380, 34_385, 34_390, 34_395];
  const reserves = axisScale("Hundred million USD (亿美元)", reserveTicks, 34_395);
  expect(reserves?.title).toBe("Billions of US dollars");
  expect(reserveTicks.map((tick) => reserves?.format(tick))).toEqual(["3,438.0", "3,438.5", "3,439.0", "3,439.5"]);
});

test("a tick that needs a fifth decimal is seen, so the axis drops a word rather than printing 1 twice", () => {
  // 10,000 and 10,000.4 亿元 are 1 and 1.00004 trillion: rounded to four places both read "1".
  const ticks = [10_000, 10_000.4];
  const axis = axisScale("亿元", ticks, 10_000.4);
  expect(axis?.title).toBe("Billions of yuan");
  expect(ticks.map((tick) => axis?.format(tick))).toEqual(["1,000.00", "1,000.04"]);
});

test("an axis of nothing but zeros is left as stored rather than scaled around zero", () => {
  expect(axisScale("亿元", [-1, 0, 1], 0)).toBeNull();
  expect(axisScale("Million USD", [0])).toBeNull();
});

test("the axis word comes from the largest figure shown, not a rounded-up top tick", () => {
  // Electricity peaking at 9,400 亿千瓦时 on an axis whose top tick is 10,000 reads in billions, not "0.2 trillion" steps.
  const power = axisScale("Hundred million kWh (亿千瓦时)", [0, 2_000, 4_000, 6_000, 8_000, 10_000], 9_400);
  expect(power?.title).toBe("Billions of kWh");
  expect(power?.format(10_000)).toBe("1,000");
});

test("a value is rounded before its scale word is chosen, so it never reads 1,000 of a word", () => {
  expect(naturalValue(999.96, "Million USD")).toBe("1 billion US dollars");
  expect(naturalValue(999.4, "Million USD")).toBe("999.4 million US dollars");
});

test("a unit already in the thing itself is not rescaled", () => {
  // 13,860 US dollars per head reads better as it is than as "13.86 thousand".
  for (const unit of ["Current US dollars", "US dollars", "Yuan", "Persons", "Tons", "元", "人", "吨"]) {
    expect(naturalUnit(unit)).toBeNull();
    expect(naturalValue(13_860, unit)).toBeNull();
  }
});

test("a value that is not a finite number gives no natural reading rather than a crash or an infinity", () => {
  expect(naturalValue(Number.NaN, "亿元")).toBeNull();
  expect(naturalValue(Number.POSITIVE_INFINITY, "亿元")).toBeNull();
  expect(naturalValue(Number.NEGATIVE_INFINITY, "Million USD")).toBeNull();
});

test("a line name drops a trailing unit only when that bracket is a count's unit", () => {
  expect(withoutUnitSuffix("FX reserves (100M USD)")).toBe("FX reserves");
  expect(withoutUnitSuffix("Deposits (亿元)")).toBe("Deposits");
  expect(withoutUnitSuffix("Exports (goods)")).toBe("Exports (goods)");
  expect(withoutUnitSuffix("CPI (YoY %)")).toBe("CPI (YoY %)");
  expect(withoutUnitSuffix("Total deposits")).toBe("Total deposits");
});

test("the series page's change reads in the same natural unit as its value; the Home list's short change does not", () => {
  expect(deltaText({ date: "2026-08", value: 3_476_700 }, { date: "2026-07", value: 3_464_300 }, "Hundred million yuan (亿元)")).toBe("Up 1.24 trillion yuan from Jul 2026");
  expect(deltaText({ date: "2026-08", value: 34_383 }, { date: "2026-07", value: 34_000 }, "100M USD", "short")).toBe("+383");
});
