/**
 * The price-detail keys point at the NBS tables they claim: every id resolves
 * in the shipped snapshot to the named index (a year earlier = 100), from one
 * table each, in the price category of the monthly dataset.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-prices-")), "test.db");
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
function idsOf(key: string): { id: string; label: string; valueOffset?: number }[] {
  const cfg: unknown = CATALOG[key];
  const ids = typeof cfg === "object" && cfg !== null ? Reflect.get(cfg, "ids") : undefined;
  return Array.isArray(ids) ? ids.filter((item): item is { id: string; label: string; valueOffset?: number } => typeof item === "object" && item !== null && typeof Reflect.get(item, "id") === "string") : [];
}

test("every price-detail key's ids resolve to the named indices and are served as the change on a year earlier", () => {
  const expected: Record<string, string[]> = {
      "cpi_detail": [
          "不包括食品和能源居民消费价格指数 (上年同月=100)",
          "食品烟酒及在外餐饮类居民消费价格指数(上年同月=100)",
          "非食品居民消费价格指数 (上年同月=100)",
          "消费品居民消费价格指数 (上年同月=100)",
          "服务居民消费价格指数 (上年同月=100)",
          "居住类居民消费价格指数 (上年同月=100)"
      ],
      "ppi_detail": [
          "工业生产者出厂价格指数 (上年同月=100)",
          "生产资料工业生产者出厂价格指数 (上年同月=100)",
          "生活资料工业生产者出厂价格指数 (上年同月=100)"
      ]
  };
  for (const [key, names] of Object.entries(expected)) {
    const ids = idsOf(key);
    expect(ids.map((item) => byId.get(item.id)?.name)).toEqual(names);
    expect(new Set(ids.map((item) => byId.get(item.id)?.cid)).size).toBe(1);
    expect(ids.every((item) => item.valueOffset === -100 && byId.get(item.id)?.datasetCode === 1 && byId.get(item.id)?.categories?.[0] === "价格指数")).toBe(true);
  }
});

test("cpi_detail's 2021-2025 slice names the same categories in the earlier table", () => {
  const cfg: unknown = CATALOG["cpi_detail"];
  const slices = typeof cfg === "object" && cfg !== null ? Reflect.get(cfg, "slices") : undefined;
  expect(Array.isArray(slices) ? slices.length : 0).toBe(1);
  const slice: unknown = Array.isArray(slices) ? slices[0] : undefined;
  const sliceIds = typeof slice === "object" && slice !== null ? Reflect.get(slice, "ids") : undefined;
  const main = idsOf("cpi_detail");
  const strip = (name: string | undefined) => (name ?? "").replace(/\s*\(.*\)\s*$/, "").replace(/及在外餐饮类/, "类");
  expect(Array.isArray(sliceIds) ? sliceIds.length : 0).toBe(main.length);
  if (!Array.isArray(sliceIds)) return;
  for (const [index, item] of sliceIds.entries()) {
    const id = typeof item === "object" && item !== null ? Reflect.get(item, "id") : undefined;
    const old = typeof id === "string" ? byId.get(id) : undefined;
    expect(old?.categories?.[2]).toContain("2021-2025");
    expect(strip(old?.name)).toBe(strip(byId.get(main[index]?.id ?? "")?.name));
  }
});
