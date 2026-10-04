/**
 * End labels sit beside the ends of their lines, never on top of each other,
 * and never off the chart.
 */

import { test, expect } from "bun:test";
import { spreadLabels } from "./plot-chart";

test("labels far apart stay where their lines end", () => {
  expect(spreadLabels([40, 120, 200], 13, 20, 226)).toEqual([40, 120, 200]);
});

test("labels that would overlap are pushed apart in the order their lines end", () => {
  expect(spreadLabels([100, 95, 104], 13, 20, 226)).toEqual([108, 95, 121]);
});

test("a pile at the bottom is lifted back inside the chart, and nothing rises above the top", () => {
  const spread = spreadLabels([220, 222, 224], 13, 20, 226);
  expect(Math.max(...spread)).toBe(226);
  expect([...spread].sort((a, b) => a - b)).toEqual([200, 213, 226]);
  expect(Math.min(...spreadLabels([0, 1], 13, 20, 226))).toBeGreaterThanOrEqual(20);
});
