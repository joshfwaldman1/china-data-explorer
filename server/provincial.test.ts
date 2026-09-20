/**
 * The provincial monthly keys point at NBS's provincial tables: the ids
 * resolve in the shipped snapshot, the CPI slices are the same series in the
 * bureau's earlier tables, and every province the site offers is one NBS
 * publishes the table for.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-provincial-")), "test.db");
process.env.CHINA_SEED = "off";
const { CATALOG, NBS_PROVINCES } = await import("./data.ts");
const { readCatalogSnapshot } = await import("./catalog-file.ts");
const { CONCORDANCE_PAIRS } = await import("./concordance.ts");

interface Entry { id: string; name: string; cid: string; datasetCode: number; categories?: string[] }
function isEntry(value: unknown): value is Entry {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "id") === "string" && typeof Reflect.get(value, "name") === "string";
}
const snapshot: unknown = await readCatalogSnapshot();
const list = typeof snapshot === "object" && snapshot !== null ? Reflect.get(snapshot, "entries") : undefined;
const byId = new Map((Array.isArray(list) ? list : []).filter(isEntry).map((entry) => [entry.id, entry]));
const field = (key: string, name: string) => Reflect.get(CATALOG[key] as object, name);

test("industrial output serves the month and the year to date from the provincial monthly table", () => {
  const ids = field("provincial_industry", "ids") as { id: string; label: string }[];
  expect(ids.map((line) => byId.get(line.id)?.name.replace(/\s+/g, " ").trim())).toEqual([
    "工业增加值同比增长 (%)", "工业增加值累计增长 (%)",
  ]);
  for (const line of ids) {
    expect(byId.get(line.id)?.datasetCode).toBe(4);
    expect(byId.get(line.id)?.cid).toBe(field("provincial_industry", "cid"));
  }
});

test("the provincial CPI is an index on a year earlier, with the bureau's older tables stitched behind it", () => {
  const ids = field("provincial_cpi", "ids") as { id: string; valueOffset?: number }[];
  expect(ids[0]?.valueOffset).toBe(-100);
  expect(byId.get(ids[0]!.id)?.name.replace(/\s+/g, " ").trim()).toBe("居民消费价格指数 (上年同月=100)");
  const slices = field("provincial_cpi", "slices") as { cid: string; ids: { id: string; label: string; valueOffset?: number }[] }[];
  expect(slices.length).toBe(2);
  for (const slice of slices) {
    const line = slice.ids[0]!;
    // A slice is the same series in an earlier table, under the same label and offset.
    expect(byId.get(line.id)?.name.replace(/\s+/g, " ").trim()).toBe("居民消费价格指数 (上年同月=100)");
    expect(byId.get(line.id)?.cid).toBe(slice.cid);
    expect(line.valueOffset).toBe(-100);
    expect(line.label).toBe(ids[0] && Reflect.get(ids[0], "label"));
  }
});

test("both keys are published for the 31 provinces, and the Home rows name six of them", () => {
  for (const key of ["provincial_industry", "provincial_cpi"]) {
    const regions = field(key, "regions") as { value: string }[];
    expect(regions).toBe(NBS_PROVINCES);
    expect(regions.length).toBe(31);
    expect(field(key, "region")).toMatchObject({ value: "440000000000" });
  }
  const home = field("provincial_industry", "homeRegions") as string[];
  expect(home.length).toBe(6);
  for (const code of home) expect(NBS_PROVINCES.some((province) => province.value === code)).toBe(true);
});

test("Guangdong's two industrial lines are cross-checked against each other", () => {
  const pair = CONCORDANCE_PAIRS.find((item) => item.name.startsWith("Guangdong industrial output"));
  expect(pair?.kind).toBe("cumulative");
  if (pair?.kind !== "cumulative") throw new Error("expected a cumulative pair");
  expect(pair.period.region).toBe("440000000000");
  expect(pair.yearToDate.region).toBe("440000000000");
});
