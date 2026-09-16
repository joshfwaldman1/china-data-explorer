/**
 * The fixed-asset investment keys point at the NBS tables they claim: every
 * id resolves in the shipped snapshot to the named series, in the
 * fixed-asset investment category of the monthly dataset, from one table each.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-fai-")), "test.db");
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

test("every fixed-asset investment key's ids resolve to the named monthly series, from one table each", () => {
  const expected: Record<string, string[]> = {
      "fai": [
          "固定资产投资额累计增长 (%)",
          "民间固定资产投资累计增长 (%)",
          "第一产业固定资产投资额累计增长 (%)",
          "第二产业固定资产投资额累计增长 (%)",
          "第三产业固定资产投资额累计增长 (%)"
      ],
      "fai_by_industry": [
          "制造业固定资产投资额累计增长 (%)",
          "采矿业固定资产投资额累计增长 (%)",
          "电力、热力、燃气及水的生产和供应业固定资产投资额累计增长 (%)",
          "铁路运输业固定资产投资额累计增长 (%)",
          "道路运输业固定资产投资额累计增长 (%)",
          "水利、环境和公共设施管理业固定资产投资额累计增长 (%)",
          "房地产业固定资产投资额累计增长 (%)"
      ],
      "fai_funding": [
          "固定资产投资本年资金来源小计累计增长 (%)",
          "固定资产投资国家预算资金累计增长 (%)",
          "固定资产投资国内贷款累计增长 (%)",
          "固定资产投资自筹资金累计增长 (%)"
      ]
  };
  for (const [key, names] of Object.entries(expected)) {
    const ids = idsOf(key);
    expect(ids.map((item) => byId.get(item.id)?.name)).toEqual(names);
    expect(new Set(ids.map((item) => byId.get(item.id)?.cid)).size).toBe(1);
    expect(ids.every((item) => byId.get(item.id)?.datasetCode === 1 && /^固定资产投资/.test(byId.get(item.id)?.categories?.[0] ?? ""))).toBe(true);
  }
});
