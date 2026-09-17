/**
 * The labour keys point at the NBS tables they claim: each id resolves in the
 * shipped snapshot to the named migrant-worker series in the quarterly
 * dataset's 人民生活 category, from the one table both share.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-labour-")), "test.db");
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

const EXPECTED: Record<string, { name: string; label: string }> = {
  migrant_workers: { name: "农村外出务工劳动力 (万人)", label: "Away from home, quarter end (10,000 persons)" },
  migrant_workers_income: { name: "外出务工农村劳动力月均收入 (元)", label: "Average monthly income (yuan)" },
};

test("each labour key resolves to the named quarterly series from the migrant-worker table", () => {
  for (const [key, expected] of Object.entries(EXPECTED)) {
    const cfg: unknown = CATALOG[key];
    expect(cfg).toBeDefined();
    const ids = Reflect.get(cfg as object, "ids") as { id: string; label: string }[];
    expect(ids.length).toBe(1);
    const entry = byId.get(ids[0]!.id);
    expect(entry?.name).toBe(expected.name);
    expect(ids[0]!.label).toBe(expected.label);
    expect(entry?.datasetCode).toBe(2);
    expect(entry?.cid).toBe(Reflect.get(cfg as object, "cid"));
    expect(entry?.categories?.[0]).toBe("人民生活");
    expect(Reflect.get(cfg as object, "frequency")).toBe("Quarterly");
    expect(Reflect.get(cfg as object, "group")).toBe("Labor");
  }
  // Both lines come from one table, so the catalog serves them by one request each.
  expect(Reflect.get(CATALOG.migrant_workers as object, "cid")).toBe(Reflect.get(CATALOG.migrant_workers_income as object, "cid"));
});
