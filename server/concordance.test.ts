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
