/**
 * The port throughput keys point at NBS's monthly tables: every id resolves
 * in the shipped snapshot to the named series in the transport category, the
 * current table from 2019 and the slice behind it from 2005 to 2018.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-ports-")), "test.db");
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

test("the tonnage lines resolve to the named series of the 2019 table", () => {
  const cfg: unknown = CATALOG.port_throughput;
  const ids = Reflect.get(cfg as object, "ids") as { id: string; label: string }[];
  expect(ids.map((line) => byId.get(line.id)?.name.replace(/\s+/g, " ").trim())).toEqual([
    "全国港口货物吞吐量_当期值 (万吨)", "外贸货物吞吐量_当期值 (万吨)", "沿海港口货物吞吐量_当期值 (万吨)",
  ]);
  for (const line of ids) {
    expect(byId.get(line.id)?.datasetCode).toBe(1);
    expect(byId.get(line.id)?.cid).toBe(Reflect.get(cfg as object, "cid"));
    expect(byId.get(line.id)?.categories?.[0]).toBe("交通运输");
  }
});

test("the slice behind it is the 2005-2018 table, under labels the current table also uses", () => {
  const cfg: unknown = CATALOG.port_throughput;
  const slices = Reflect.get(cfg as object, "slices") as { cid: string; ids: { id: string; label: string }[] }[];
  expect(slices.length).toBe(1);
  const labels = new Set((Reflect.get(cfg as object, "ids") as { label: string }[]).map((line) => line.label));
  for (const line of slices[0]!.ids) {
    const entry = byId.get(line.id);
    expect(entry?.cid).toBe(slices[0]!.cid);
    expect(entry?.categories?.[1]).toContain("2005-2018");
    // A slice only extends a line the current table already serves.
    expect(labels.has(line.label)).toBe(true);
  }
});

test("the growth lines are the rates beside the tonnage, and they form a cumulative pair", () => {
  const cfg: unknown = CATALOG.port_throughput_growth;
  const ids = Reflect.get(cfg as object, "ids") as { id: string; label: string }[];
  expect(ids.map((line) => byId.get(line.id)?.name.replace(/\s+/g, " ").trim())).toEqual([
    "全国港口货物吞吐量_同比增长 (%)", "全国港口货物吞吐量_累计增长 (%)", "外贸货物吞吐量_同比增长 (%)",
  ]);
  const pair = CONCORDANCE_PAIRS.find((item) => item.name.startsWith("Port throughput"));
  expect(pair?.kind).toBe("cumulative");
  // February carries the combined January-February figure on both lines, as NBS publishes it.
  const month = [{ date: "2026-02", value: 3.1 }, { date: "2026-03", value: 2.4 }, { date: "2026-04", value: 1.8 }];
  const ytd = [{ date: "2026-02", value: 3.1 }, { date: "2026-03", value: 2.8 }, { date: "2026-04", value: 2.5 }];
  expect(compareCumulative("t", month, ytd, { tolerance: 0.05 }).status).toBe("ok");
});
