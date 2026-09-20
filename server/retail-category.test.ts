/**
 * Retail sales by commodity: every line resolves in the shipped snapshot to
 * the named NBS series, each from the category's own table, and the level
 * and growth keys cover the same categories in the same order.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-retail-")), "test.db");
process.env.CHINA_SEED = "off";
const { CATALOG, HOME_ROWS } = await import("./data.ts");
const { readCatalogSnapshot } = await import("./catalog-file.ts");

interface Entry { id: string; name: string; cid: string; datasetCode: number; categories?: string[] }
function isEntry(value: unknown): value is Entry {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "id") === "string" && typeof Reflect.get(value, "name") === "string";
}
const snapshot: unknown = await readCatalogSnapshot();
const list = typeof snapshot === "object" && snapshot !== null ? Reflect.get(snapshot, "entries") : undefined;
const byId = new Map((Array.isArray(list) ? list : []).filter(isEntry).map((entry) => [entry.id, entry]));
const idsOf = (key: string) => Reflect.get(CATALOG[key] as object, "ids") as { id: string; label: string; cid?: string }[];

test("every category line is a monthly retail series from the category's own table", () => {
  for (const [key, measure] of [["retail_by_category", "当期值"], ["retail_by_category_growth", "同比增长"]] as const) {
    const ids = idsOf(key);
    expect(ids.length).toBe(12);
    for (const line of ids) {
      const entry = byId.get(line.id);
      expect(entry?.datasetCode).toBe(1);
      expect(entry?.name).toContain("商品零售类值");
      expect(entry?.name).toContain(measure);
      expect(entry?.categories?.join("/")).toContain("限上单位商品零售类值");
      // Each category is its own table on the portal, so the line names it.
      expect(line.cid).toBe(entry?.cid ?? "");
    }
  }
});

test("the levels and the rates cover the same categories in the same order", () => {
  const strip = (label: string) => label.replace(/, month \(.*\)$/, "");
  expect(idsOf("retail_by_category").map((line) => strip(line.label)))
    .toEqual(idsOf("retail_by_category_growth").map((line) => strip(line.label)));
  expect(idsOf("retail_by_category").map((line) => strip(line.label))[0]).toBe("Motor vehicles");
});

test("motor vehicles are lifted onto the Home page, which is what the site has in place of unit sales", () => {
  const consumption = HOME_ROWS.find((group) => group.group === "Consumption");
  const row = consumption?.rows.find((item) => item.key === "retail_by_category_growth");
  expect(row?.line).toBe("Motor vehicles, month (YoY %)");
  expect(row?.title).toBe("Motor Vehicle Retail Sales Growth");
  // The line it names exists on the key.
  expect(idsOf("retail_by_category_growth").some((line) => line.label === row?.line)).toBe(true);
});
