/**
 * The services production key points at NBS's monthly 服务业生产指数 table:
 * both ids resolve in the shipped snapshot to the named series, from one
 * table, in the monthly dataset; and its two lines form a cumulative pair.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-services-")), "test.db");
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

test("both lines resolve to the named series of the monthly services production table", () => {
  const cfg: unknown = CATALOG.services_production;
  const ids = Reflect.get(cfg as object, "ids") as { id: string; label: string }[];
  const names = ids.map((line) => byId.get(line.id)?.name.replace(/\s+/g, " ").trim());
  expect(names).toEqual(["服务业生产指数当月同比增速 (%)", "服务业生产指数累计同比增速 (%)"]);
  for (const line of ids) {
    expect(byId.get(line.id)?.datasetCode).toBe(1);
    expect(byId.get(line.id)?.cid).toBe(Reflect.get(cfg as object, "cid"));
    expect(byId.get(line.id)?.categories?.[0]).toBe("服务业生产指数");
  }
});

test("the two lines are a cumulative pair that agrees at the first period of a year and differs later", () => {
  const pair = CONCORDANCE_PAIRS.find((item) => item.name.startsWith("Services production"));
  expect(pair?.kind).toBe("cumulative");
  // A year as NBS publishes it: February carries the combined January-February figure on both lines.
  const month = [{ date: "2026-02", value: 5.9 }, { date: "2026-03", value: 6.1 }, { date: "2026-04", value: 5.8 }, { date: "2026-05", value: 6.0 }];
  const ytd = [{ date: "2026-02", value: 5.9 }, { date: "2026-03", value: 6.0 }, { date: "2026-04", value: 5.9 }, { date: "2026-05", value: 5.9 }];
  expect(compareCumulative("t", month, ytd, { tolerance: 0.05 }).status).toBe("ok");
  expect(compareCumulative("t", ytd, ytd, { tolerance: 0.05 }).status).toBe("mismatch");
});
