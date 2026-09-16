/**
 * The property keys point at the NBS tables they claim: every id resolves in
 * the shipped snapshot to the named series, in the real-estate category of
 * the monthly dataset, and each key's lines come from one table.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-property-")), "test.db");
process.env.CHINA_SEED = "off";
const { CATALOG } = await import("./data.ts");
const { readCatalogSnapshot } = await import("./catalog-file.ts");

interface Entry { key: string; id: string; name: string; cid: string; datasetCode: number; categories?: string[] }
function isEntry(value: unknown): value is Entry {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "id") === "string" && typeof Reflect.get(value, "name") === "string";
}
const snapshot: unknown = await readCatalogSnapshot();
const list = typeof snapshot === "object" && snapshot !== null ? Reflect.get(snapshot, "entries") : undefined;
const byId = new Map((Array.isArray(list) ? list : []).filter(isEntry).map((entry) => [entry.id, entry]));

/** The ids of an NBS-kind curated key. */
function idsOf(key: string): { id: string; label: string }[] {
  const cfg: unknown = CATALOG[key];
  const ids = typeof cfg === "object" && cfg !== null ? Reflect.get(cfg, "ids") : undefined;
  return Array.isArray(ids) ? ids.filter((item): item is { id: string; label: string } => typeof item === "object" && item !== null && typeof Reflect.get(item, "id") === "string") : [];
}

test("every property key's ids resolve to the named monthly real-estate series, from one table each", () => {
  const expected: Record<string, string[]> = {
    property_investment: ["房地产投资_累计增长 (%)", "房地产住宅投资_累计增长 (%)"],
    property_sales: ["新建商品房销售面积累计增长 (%)"],
    property_sales_value: ["新建商品房销售额累计值 (亿元)"],
    property_construction: ["房地产新开工施工面积累计增长 (%)", "房地产竣工面积累计增长 (%)", "房地产施工面积累计增长 (%)"],
    property_funds: ["房地产投资本年资金来源小计累计增长 (%)", "房地产投资国内贷款累计增长 (%)"],
    property_sales_area: ["新建商品房销售面积累计值 (万平方米)"],
  };
  for (const [key, names] of Object.entries(expected)) {
    const ids = idsOf(key);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.map((item) => byId.get(item.id)?.name)).toEqual(names);
    expect(new Set(ids.map((item) => byId.get(item.id)?.cid)).size).toBe(1);
    expect(ids.every((item) => byId.get(item.id)?.datasetCode === 1 && byId.get(item.id)?.categories?.[0] === "房地产")).toBe(true);
  }
});
