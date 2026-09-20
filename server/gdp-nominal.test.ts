/**
 * The nominal GDP keys point at NBS's quarterly current-price table: every
 * id resolves in the shipped snapshot to the named series, all from that one
 * table, and the quarter and year-to-date lines form a cumulative pair that
 * must coincide in the first quarter.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-gdp-nominal-")), "test.db");
process.env.CHINA_SEED = "off";
const { CATALOG } = await import("./data.ts");
const { readCatalogSnapshot } = await import("./catalog-file.ts");
const { CONCORDANCE_PAIRS, compareCumulative } = await import("./concordance.ts");

interface Entry { id: string; name: string; cid: string; datasetCode: number; categories?: string[] }
function isEntry(value: unknown): value is Entry {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "id") === "string" && typeof Reflect.get(value, "name") === "string";
}
const snapshot: unknown = await readCatalogSnapshot();
const list = typeof snapshot === "object" && snapshot !== null ? Reflect.get(snapshot, "entries") : undefined;
const byId = new Map((Array.isArray(list) ? list : []).filter(isEntry).map((entry) => [entry.id, entry]));
const idsOf = (key: string) => Reflect.get(CATALOG[key] as object, "ids") as { id: string; label: string }[];

test("the headline lines are GDP and its three sectors, each from the current-price table", () => {
  expect(idsOf("gdp_nominal").map((line) => byId.get(line.id)?.name.replace(/\s+/g, " ").trim())).toEqual([
    "国内生产总值当季值 (亿元)", "第三产业增加值当季值 (亿元)", "第二产业增加值当季值 (亿元)", "第一产业增加值当季值 (亿元)",
  ]);
  expect(idsOf("gdp_nominal_ytd").map((line) => byId.get(line.id)?.name.replace(/\s+/g, " ").trim())).toEqual([
    "国内生产总值累计值 (亿元)", "第三产业增加值累计值 (亿元)", "第二产业增加值累计值 (亿元)", "第一产业增加值累计值 (亿元)",
  ]);
  for (const key of ["gdp_nominal", "gdp_nominal_ytd", "gdp_by_industry"]) {
    for (const line of idsOf(key)) {
      const entry = byId.get(line.id);
      expect(entry?.cid).toBe("28d936104e304aa191e338eb82b6dc09");
      expect(entry?.datasetCode).toBe(2);
      expect(entry?.categories?.[0]).toBe("国民经济核算");
    }
  }
});

test("every industry line is a quarter's value added, and the ones nested inside others are labelled plainly", () => {
  const industry = idsOf("gdp_by_industry");
  expect(industry.length).toBe(12);
  for (const line of industry) {
    expect(byId.get(line.id)?.name).toContain("当季值");
    expect(line.label).toContain("quarter");
  }
  // Manufacturing sits inside industry, which sits inside the secondary sector: all three are served.
  const names = industry.map((line) => byId.get(line.id)?.name.replace(/\s+/g, " ").trim());
  expect(names).toContain("制造业增加值当季值 (亿元)");
  expect(names).toContain("工业增加值当季值 (亿元)");
  expect(names).toContain("房地产业增加值当季值 (亿元)");
});

test("the quarter and the year to date are a cumulative pair on levels, agreeing in the first quarter", () => {
  const pair = CONCORDANCE_PAIRS.find((item) => item.name.startsWith("Nominal GDP"));
  expect(pair?.kind).toBe("cumulative");
  expect(pair?.note).toContain("Levels, not rates");
  // A year as NBS publishes it: the year to date at Q1 is Q1, and grows away from it after.
  const quarter = [{ date: "2026-Q1", value: 334193 }, { date: "2026-Q2", value: 361511 }];
  const ytd = [{ date: "2026-Q1", value: 334193 }, { date: "2026-Q2", value: 695704 }];
  expect(compareCumulative("t", quarter, ytd, { tolerance: 1 }).status).toBe("ok");
  // The year to date under a quarter's label is still caught.
  expect(compareCumulative("t", ytd, ytd, { tolerance: 1 }).status).toBe("mismatch");
});
