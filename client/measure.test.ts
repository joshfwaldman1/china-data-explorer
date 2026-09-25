/**
 * What a series is, derived from its unit: the rules the page used to run as
 * regular expressions at render time, now pinned as a table of cases. Each
 * line here is a unit string that appears in the catalog.
 */

import { test, expect } from "bun:test";
import { measureOf } from "../shared/measure.ts";
import { deltaText, fmt } from "./lib.ts";

test("a per-thousand rate is a rate with its own mark and its change in points", () => {
  const birth = measureOf("Per thousand (‰)");
  expect(birth).toEqual({ kind: "rate", suffix: "‰", decimals: 2, change: "pt", cumulative: false });
  expect(fmt(6.77, birth)).toBe("6.77");
  expect(deltaText({ date: "2025", value: 6.39 }, { date: "2024", value: 6.77 }, birth, "short")).toBe("-0.38 per 1,000");
});

test("a percentage is a rate in percentage points, and a market rate keeps two decimals", () => {
  expect(measureOf("Percent change from year ago")).toMatchObject({ kind: "rate", suffix: "%", decimals: 1, change: "pp" });
  expect(measureOf("Percent, last fixing of the month")).toMatchObject({ kind: "rate", decimals: 2 });
  expect(measureOf("Percent, month-end close")).toMatchObject({ kind: "rate", decimals: 2 });
  expect(measureOf("Percent per annum")).toMatchObject({ kind: "rate", decimals: 2 });
  expect(fmt(1.6879, measureOf("Percent, month-end close"))).toBe("1.69");
});

test("an index prints no unit and moves in its own points", () => {
  for (const unit of ["Diffusion index (50 = neutral)", "Index (100 = neutral)", "Index, 2020 = 100", "Index, long-term average = 100"]) {
    expect(measureOf(unit)).toMatchObject({ kind: "index", suffix: "", change: "absolute" });
  }
  // An index is not a percentage, so its change carries no "pp".
  expect(deltaText({ date: "2026-08", value: 49.8 }, { date: "2026-07", value: 49.2 }, measureOf("Diffusion index (50 = neutral)"), "short")).toBe("+0.6");
});

test("a level says what it counts, at the scale the publisher uses", () => {
  expect(measureOf("Hundred million yuan (亿元)")).toMatchObject({ kind: "level", suffix: "100M yuan", decimals: "source" });
  expect(measureOf("Hundred million USD (亿美元), month").suffix).toBe("100M USD");
  expect(measureOf("Ten thousand persons (万人)").suffix).toBe("10k persons");
  expect(measureOf("Ten thousand square metres (万平方米), cumulative year to date").suffix).toBe("10k m²");
  expect(measureOf("Trillion yuan (万亿元)").suffix).toBe("tn yuan");
  expect(measureOf("Millions of US dollars").suffix).toBe("M USD");
  expect(measureOf("Yuan per US dollar, month-end close").suffix).toBe("yuan");
  expect(measureOf("Hours per week").suffix).toBe("hours");
  // A level keeps the decimals the publisher wrote rather than a fixed number.
  expect(fmt(552, measureOf("Hundred million yuan (亿元)"))).toBe("552");
  expect(fmt(6.7828, measureOf("Yuan per US dollar, month-end close"))).toBe("6.7828");
});

test("a cumulative unit is flagged, whatever kind of number it is", () => {
  expect(measureOf("Percent change from year ago, cumulative year to date").cumulative).toBe(true);
  expect(measureOf("Hundred million yuan (亿元), cumulative year to date").cumulative).toBe(true);
  expect(measureOf("Hundred million yuan (亿元), month").cumulative).toBe(false);
});

test("a series may declare what its unit sentence would get wrong", () => {
  // "Percent" alone would read as one decimal; the loan prime rate is quoted to two.
  expect(measureOf("Percent", { decimals: 2 })).toMatchObject({ kind: "rate", decimals: 2, suffix: "%" });
  // A count of firms has no unit worth printing.
  expect(measureOf("Enterprises, cumulative year to date", { suffix: "" })).toMatchObject({ kind: "level", suffix: "", cumulative: true });
});
