/**
 * Every curated series ends up with a measure that makes sense for it. This
 * is the guard the page used to lack: a new series whose unit sentence the
 * derivation cannot read is caught here rather than printing a per-thousand
 * rate with a percent sign.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-measure-")), "test.db");
process.env.CHINA_SEED = "off";
const { catalogList } = await import("./data.ts");

test("every curated series carries a measure whose fields agree with each other", () => {
  for (const entry of catalogList()) {
    const { kind, suffix, decimals, change, cumulative } = entry.measure;
    const where = `${entry.key} (${entry.unit})`;
    expect(["level", "rate", "index"]).toContain(kind);
    expect(typeof cumulative).toBe("boolean");
    if (kind === "rate") {
      // A rate is a percentage or a per-thousand, and its change is in the matching points.
      expect([["%", "pp"], ["‰", "pt"]], where).toContainEqual([suffix, change]);
      expect(typeof decimals, where).toBe("number");
    }
    if (kind === "index") {
      expect(suffix, where).toBe("");
      expect(change, where).toBe("absolute");
    }
    if (kind === "level") {
      expect(change, where).toBe("absolute");
      // A level's unit is a short noun, never a leftover sentence.
      expect(suffix.length, where).toBeLessThan(12);
      expect(suffix, where).not.toMatch(/cumulative|percent|year to date/i);
    }
  }
});

test("the unit sentence and the measure never disagree about what the series is", () => {
  for (const entry of catalogList()) {
    const where = `${entry.key} (${entry.unit})`;
    // Anything the sentence writes as a percentage is a rate or an index, never a quantity.
    if (/\bpercent\b|%/i.test(entry.unit) && !/index/i.test(entry.unit)) expect(entry.measure.kind, where).toBe("rate");
    if (/‰|per thousand/i.test(entry.unit)) expect(entry.measure.suffix, where).toBe("‰");
    if (/index/i.test(entry.unit)) expect(entry.measure.kind, where).toBe("index");
    // A sentence that says year to date is a cumulative series.
    expect(entry.measure.cumulative, where).toBe(/cumulative|year to date/i.test(entry.unit));
  }
});

test("the series that pay for the override list are the only ones overriding", () => {
  const byKey = new Map(catalogList().map((entry) => [entry.key, entry]));
  // Rates the market quotes to two decimals, whose unit says only "Percent".
  expect(byKey.get("lpr")?.measure.decimals).toBe(2);
  expect(byKey.get("lgb_rate")?.measure.decimals).toBe(2);
  // A count of firms prints no unit.
  expect(byKey.get("fdi_new_enterprises")?.measure.suffix).toBe("");
  // Everything else takes the derivation: a spot check across the kinds.
  expect(byKey.get("gdp")?.measure).toMatchObject({ kind: "rate", suffix: "%", change: "pp" });
  expect(byKey.get("population_rates")?.measure).toMatchObject({ kind: "rate", suffix: "‰", change: "pt" });
  expect(byKey.get("pmi")?.measure).toMatchObject({ kind: "index", suffix: "" });
  expect(byKey.get("gdp_nominal")?.measure).toMatchObject({ kind: "level", suffix: "100M yuan" });
});
