/**
 * The PMI keys point at NBS's two purchasing-managers tables: every id
 * resolves in the shipped snapshot to the named index, from one table each.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-pmi-")), "test.db");
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

test("every PMI key's ids resolve to the named indices of one table in the PMI category", () => {
  const expected: Record<string, string[]> = {
      "pmi_manufacturing": [
          "制造业采购经理指数 (%)",
          "生产指数 (%)",
          "新订单指数 (%)",
          "新出口订单指数 (%)",
          "在手订单指数 (%)",
          "产成品库存指数 (%)",
          "采购量指数 (%)",
          "进口指数 (%)",
          "主要原材料购进价格指数 (%)",
          "出厂价格指数 (%)",
          "原材料库存指数 (%)",
          "从业人员指数 (%)",
          "供应商配送时间指数 (%)",
          "生产经营活动预期指数 (%)"
      ],
      "pmi_nonmanufacturing": [
          "非制造业商务活动指数 (%)",
          "服务业商务活动指数 (%)",
          "建筑业商务活动指数 (%)",
          "新订单指数 (%)",
          "新出口订单指数 (%)",
          "在手订单指数 (%)",
          "存货指数 (%)",
          "投入品价格指数 (%)",
          "销售价格指数 (%)",
          "从业人员指数 (%)",
          "供应商配送时间指数 (%)",
          "业务活动预期指数 (%)"
      ]
  };
  for (const [key, names] of Object.entries(expected)) {
    const ids = idsOf(key);
    expect(ids.map((item) => byId.get(item.id)?.name)).toEqual(names);
    expect(new Set(ids.map((item) => byId.get(item.id)?.cid)).size).toBe(1);
    expect(ids.every((item) => byId.get(item.id)?.datasetCode === 1 && byId.get(item.id)?.categories?.[0] === "采购经理指数")).toBe(true);
  }
});
