/**
 * The bureau's international datasets in the shipped snapshot: the three
 * major economies monthly, world commodity prices monthly, and the major
 * countries annually, each with its collected list of countries and their
 * English names.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The catalog module opens the store; point it at a scratch file before importing.
process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-intl-")), "test.db");
process.env.CHINA_SEED = "off";
const { readCatalogSnapshot } = await import("./catalog-file.ts");
const { getNbsDimensions } = await import("./nbs-catalog.ts");
const { englishPlace } = await import("../shared/places.ts");

interface Entry { key: string; name: string; cid: string; datasetCode: number; dataset: string; frequency: string; geography: string; categories?: string[] }
function isEntry(value: unknown): value is Entry {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "key") === "string" && typeof Reflect.get(value, "datasetCode") === "number";
}
const snapshot: unknown = await readCatalogSnapshot();
const list = typeof snapshot === "object" && snapshot !== null ? Reflect.get(snapshot, "entries") : undefined;
const entries = (Array.isArray(list) ? list : []).filter(isEntry).filter((entry) => entry.geography === "International");

test("the snapshot carries the three international datasets", () => {
  const byCode = new Map<number, { dataset: string; frequency: string; count: number }>();
  for (const entry of entries) {
    const held = byCode.get(entry.datasetCode) ?? { dataset: entry.dataset, frequency: entry.frequency, count: 0 };
    held.count += 1;
    byCode.set(entry.datasetCode, held);
  }
  expect([...byCode.entries()].sort(([a], [b]) => a - b)).toEqual([
    [12, { dataset: "三大经济体月度数据", frequency: "Monthly", count: 11 }],
    [13, { dataset: "国际市场月度商品价格", frequency: "Monthly", count: 15 }],
    [14, { dataset: "主要国家年度数据", frequency: "Annual", count: 54 }],
  ]);
});

test("a three-economies table lists the US, Japan and the euro area with English names", async () => {
  const cpi = entries.find((entry) => entry.datasetCode === 12 && entry.categories?.includes("消费者价格涨跌幅") && /同比/.test(entry.name));
  expect(cpi?.key).toBe("nbs_a4a3876e1dd14ce5be5ac685692dcad6");
  const places = await getNbsDimensions(cpi as never, { offline: true });
  expect(places.map((place) => `${place.en}=${place.value}`).sort()).toEqual(["Euro area=EA", "Japan=JPN", "United States=USA"]);
});

test("a major-countries table lists every continent's countries, not one continent, all with English names", async () => {
  const population = entries.find((entry) => entry.datasetCode === 14 && entry.categories?.includes("人口"));
  const places = await getNbsDimensions(population as never, { offline: true });
  expect(places.length).toBe(42);
  expect(places.filter((place) => !place.en)).toEqual([]);
  expect(places.map((place) => place.en)).toEqual(expect.arrayContaining(["India", "Germany", "United States", "Brazil", "South Africa", "Australia"]));
  // The commodity price tables are for the world as one place.
  const commodity = entries.find((entry) => entry.datasetCode === 13);
  expect((await getNbsDimensions(commodity as never, { offline: true })).map((place) => place.en)).toEqual(["World"]);
  expect(englishPlace("", "文莱")).toBe("Brunei");
});
