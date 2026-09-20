/**
 * The concordance audit catches a curated headline that disagrees with an
 * independent reading, and a period series that is really the cumulative one.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// bun test runs every file in one process and db.ts reads its path once, so
// a module that opens the store is imported only after the path is set to a
// scratch file. Otherwise the tests below would open the working store.
process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-concordance-")), "test.db");
process.env.CHINA_SEED = "off";
const { compareCumulative, compareValues } = await import("./concordance.ts");

const quarter = [{ date: "2025-Q4", value: 4.5 }, { date: "2026-Q1", value: 5 }, { date: "2026-Q2", value: 4.3 }];
const yearToDate = [{ date: "2025-Q4", value: 5 }, { date: "2026-Q1", value: 5 }, { date: "2026-Q2", value: 4.7 }];

test("a period series that equals the year-to-date series everywhere is flagged (the GDP bug)", () => {
  // What the site served until 15 September 2026: the cumulative rate under a quarterly label.
  const result = compareCumulative("GDP", yearToDate, yearToDate, { tolerance: 0.05 });
  expect(result.status).toBe("mismatch");
  expect(result.note).toContain("cumulative series under a period label");
  expect(result.disagreements.map((row) => row.period)).toEqual(["2026-06", "2025-12"]);
});

test("a true quarterly series agrees with year to date in Q1 and differs later", () => {
  const result = compareCumulative("GDP", quarter, yearToDate, { tolerance: 0.05 });
  expect(result.status).toBe("ok");
  expect(result.latest).toEqual({ period: "2026-06", left: 4.3, right: 4.7 });
  // Q1 disagreeing means one side is not what its label says.
  const wrong = compareCumulative("GDP", [{ date: "2026-Q1", value: 4.8 }, { date: "2026-Q2", value: 4.3 }], yearToDate, { tolerance: 0.05 });
  expect(wrong.status).toBe("mismatch");
  expect(wrong.disagreements).toEqual([{ period: "2026-03", left: 4.8, right: 5 }]);
});

test("a curated rate agrees with the catalog index once the index is turned into a rate", () => {
  const curated = [{ date: "2026-06", value: 0.1 }, { date: "2026-07", value: 0.5 }, { date: "2026-08", value: 0.8 }];
  const index = [{ date: "2026-06", value: 100.1 }, { date: "2026-07", value: 100.5 }, { date: "2026-08", value: 100.8 }, { date: "2026-09", value: 100.9 }];
  const result = compareValues("CPI", curated, index, { tolerance: 0.05, rightOffset: -100 });
  expect(result.status).toBe("ok");
  expect(result.compared).toBe(3);
  expect(result.latest).toEqual({ period: "2026-08", left: 0.8, right: 0.8 });
});

test("a disagreement at any compared period is a finding, and quarters align with months", () => {
  const result = compareValues("X", [{ date: "2026-Q2", value: 4.7 }, { date: "2026-Q1", value: 5 }], [{ date: "2026-06", value: 4.3 }, { date: "2026-03", value: 5 }], { tolerance: 0.05 });
  expect(result.status).toBe("mismatch");
  expect(result.disagreements).toEqual([{ period: "2026-06", left: 4.7, right: 4.3 }]);
});

test("an empty side and a disjoint pair are reported, not counted as agreement", () => {
  expect(compareValues("X", [], [{ date: "2026-08", value: 1 }], { tolerance: 0.05 }).status).toBe("missing");
  expect(compareValues("X", [{ date: "2025-01", value: 1 }], [{ date: "2026-08", value: 1 }], { tolerance: 0.05 }).status).toBe("no-overlap");
});

test("an unlabelled reference reads the line that reaches furthest when a catalog name changed between crawls", async () => {
  const { writeSeries } = await import("./db.ts");
  const { readSide } = await import("./concordance.ts");
  const base = { key: "nbs_renamed_t", title: "t", agency: "NBS", sourceUrl: "", frequency: "Monthly", unit: "%" };
  writeSeries({ ...base, series: [{ label: "old name", points: [{ date: "2024-01", value: 1 }, { date: "2024-02", value: 2 }] }] }, "000000000000", "2025-01-01T00:00:00.000Z");
  writeSeries({ ...base, series: [{ label: "new name", points: [{ date: "2026-07", value: 3 }] }] }, "000000000000", "2026-08-01T00:00:00.000Z");
  expect(readSide({ key: "nbs_renamed_t" })).toEqual([{ date: "2026-07", value: 3 }]);
  expect(readSide({ key: "nbs_renamed_t", label: "old name" }).length).toBe(2);
});

test("a disjoint pair reports what each side holds", async () => {
  const { compareValues, formatResult } = await import("./concordance.ts");
  const result = compareValues("PPI", [{ date: "2026-07", value: 3.5 }], [{ date: "2013-11", value: 98.6 }, { date: "2013-12", value: 98.6 }], { tolerance: 0.05 });
  expect(result.sides).toEqual({ left: { first: "2026-07", last: "2026-07", points: 1 }, right: { first: "2013-11", last: "2013-12", points: 2 } });
  expect(formatResult(result)).toBe("no-overlap PPI [2026-07..2026-07 vs 2013-11..2013-12]");
});

test("a monthly pair with no January or February in common is judged on the later months alone", async () => {
  const { compareCumulative } = await import("./concordance.ts");
  const month = [3, 4, 5, 6, 7].map((m) => ({ date: `2026-0${m}`, value: m }));
  const yearToDate = [{ date: "2026-02", value: 6.1 }, ...[3, 4, 5, 6, 7].map((m) => ({ date: `2026-0${m}`, value: m + 0.5 }))];
  expect(compareCumulative("Electricity", month, yearToDate, { tolerance: 0.05 }).status).toBe("ok");
  // The same values on both lines from March on: the month line is the cumulative one.
  const copy = [3, 4, 5, 6, 7].map((m) => ({ date: `2026-0${m}`, value: m + 0.5 }));
  expect(compareCumulative("Electricity", copy, yearToDate, { tolerance: 0.05 }).status).toBe("mismatch");
});

test("on levels, a single period larger than its year to date is a finding", async () => {
  const { compareCumulative } = await import("./concordance.ts");
  // August read off the year-to-date sentence: one month of 71,730 where the year to date is 71,730.
  const month = [{ date: "2026-06", value: 8981 }, { date: "2026-07", value: 10400 }, { date: "2026-08", value: 71730 }];
  const ytd = [{ date: "2026-06", value: 50999 }, { date: "2026-07", value: 61399 }, { date: "2026-08", value: 71730 }];
  const caught = compareCumulative("t", month, ytd, { tolerance: 1, firstPeriodAgrees: false, periodWithin: true });
  expect(caught.status).toBe("mismatch");
  expect(caught.disagreements.map((row) => row.period)).toEqual(["2026-08"]);
  // The same months read correctly pass.
  const fixed = [...month.slice(0, 2), { date: "2026-08", value: 10332 }];
  expect(compareCumulative("t", fixed, ytd, { tolerance: 1, firstPeriodAgrees: false, periodWithin: true }).status).toBe("ok");
  // Rates may exceed their year to date, so a pair of rates does not ask for this.
  const fast = [{ date: "2026-07", value: 6.9 }, { date: "2026-08", value: 8.1 }];
  const slow = [{ date: "2026-07", value: 4.4 }, { date: "2026-08", value: 4.7 }];
  expect(compareCumulative("t", fast, slow, { tolerance: 0.05, firstPeriodAgrees: false }).status).toBe("ok");
});
