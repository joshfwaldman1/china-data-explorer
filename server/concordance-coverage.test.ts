/**
 * Every curated series from a domestic publisher is either held against an
 * independent reading by the concordance audit or listed, with a reason, as
 * having none. A new headline that is neither fails here.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-coverage-")), "test.db");
process.env.CHINA_SEED = "off";
const { catalogList } = await import("./data.ts");
const { CONCORDANCE_PAIRS, NO_PAIR } = await import("./concordance.ts");

const FOREIGN = /^(Federal Reserve|Bank for International|International Monetary|OECD|Baker|US |Nasdaq|World Bank|Caixin|China Foreign Exchange)/;

test("every domestic-publisher series is paired or explains why not", () => {
  const paired = new Set<string>();
  for (const pair of CONCORDANCE_PAIRS) {
    if (pair.kind === "value") { paired.add(pair.left.key); paired.add(pair.right.key); }
    else { paired.add(pair.period.key); paired.add(pair.yearToDate.key); }
  }
  const domestic = catalogList().filter((entry) => !FOREIGN.test(entry.agency));
  const uncovered = domestic.filter((entry) => !paired.has(entry.key) && !(entry.key in NO_PAIR)).map((entry) => entry.key);
  expect(uncovered).toEqual([]);
  // A reason must be a sentence, and must name a key that exists.
  const keys = new Set(catalogList().map((entry) => entry.key));
  for (const [key, reason] of Object.entries(NO_PAIR)) {
    expect(keys.has(key)).toBe(true);
    expect(reason.length).toBeGreaterThan(10);
  }
  // A key with a pair does not also carry a reason.
  expect(Object.keys(NO_PAIR).filter((key) => paired.has(key))).toEqual([]);
});

test("every pair names series and labels the catalog serves", async () => {
  const { configuredLabels } = await import("./data.ts");
  const keys = new Set(catalogList().map((entry) => entry.key));
  for (const pair of CONCORDANCE_PAIRS) {
    const sides = pair.kind === "value" ? [pair.left, pair.right] : [pair.period, pair.yearToDate];
    for (const side of sides) {
      if (side.key.startsWith("nbs_")) continue;
      expect(keys.has(side.key)).toBe(true);
      const labels = configuredLabels(side.key);
      if (labels && side.label) expect(labels).toContain(side.label);
    }
  }
});
