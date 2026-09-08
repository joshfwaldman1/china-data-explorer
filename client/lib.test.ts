import { test, expect } from "bun:test";
import { canonicalPeriod, convertTrack, coarsestFrequency, fmt, fmtTick, periodPretty, periodTime, rebase, type Track } from "./lib.ts";

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
