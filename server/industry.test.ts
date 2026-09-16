/**
 * The industry keys point at the NBS tables they claim: every id resolves in
 * the shipped snapshot to the named series, from one table each, in the
 * industry category of the monthly or quarterly dataset.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-industry-")), "test.db");
process.env.CHINA_SEED = "off";
const { CATALOG } = await import("./data.ts");
const { readCatalogSnapshot } = await import("./catalog-file.ts");

interface Entry { id: string; name: string; cid: string; datasetCode: number; categories?: string[] }
function isEntry(value: unknown): value is Entry {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "id") === "string" && typeof Reflect.get(value, "name") === "string";
}
const snapshot: unknown = await readCatalogSnapshot();
const list = typeof snapshot === "object" && snapshot !== null ? Reflect.get(snapshot, "entries") : undefined;
const byId = new Map((Array.isArray(list) ? list : []).filter(isEntry).map((entry) => [entry.id, entry]));
function idsOf(key: string): { id: string; label: string }[] {
  const cfg: unknown = CATALOG[key];
  const ids = typeof cfg === "object" && cfg !== null ? Reflect.get(cfg, "ids") : undefined;
  return Array.isArray(ids) ? ids.filter((item): item is { id: string; label: string } => typeof item === "object" && item !== null && typeof Reflect.get(item, "id") === "string") : [];
}

test("every industry key's ids resolve to the named series, from one table each, in the industry category", () => {
  const expected: Record<string, string[]> = {
      "industrial_profits": [
          "工业企业利润总额累计增长 (%)",
          "制造业利润总额累计增长 (%)",
          "采矿业利润总额累计增长 (%)",
          "电力、热力、燃气及水生产和供应业利润总额累计增长 (%)"
      ],
      "industrial_profits_value": [
          "工业企业利润总额累计值 (亿元)",
          "制造业利润总额累计值 (亿元)"
      ],
      "capacity_utilisation": [
          "工业产能利用率当季值 (%)",
          "工业产能利用率制造业当季值 (%)",
          "工业产能利用率采矿业当季值 (%)",
          "工业产能利用率电力、热力、燃气及水生产和供应业当季值 (%)"
      ],
      "output_crude_steel": [
          "粗钢产量同比增长 (%)",
          "粗钢产量累计增长 (%)"
      ],
      "output_cement": [
          "水泥产量同比增长 (%)",
          "水泥产量累计增长 (%)"
      ],
      "output_autos": [
          "汽车产量同比增长 (%)",
          "汽车产量累计增长 (%)"
      ],
      "output_nev": [
          "新能源汽车产量同比增长 (%)",
          "新能源汽车产量累计增长 (%)"
      ],
      "output_ics": [
          "集成电路产量同比增长 (%)",
          "集成电路产量累计增长 (%)"
      ]
  };
  for (const [key, names] of Object.entries(expected)) {
    const ids = idsOf(key);
    expect(ids.map((item) => byId.get(item.id)?.name)).toEqual(names);
    expect(new Set(ids.map((item) => byId.get(item.id)?.cid)).size).toBe(1);
    expect(ids.every((item) => byId.get(item.id)?.categories?.[0] === "工业")).toBe(true);
  }
  expect(idsOf("capacity_utilisation").every((item) => byId.get(item.id)?.datasetCode === 2)).toBe(true);
});
