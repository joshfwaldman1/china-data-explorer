/**
 * The NBS 70-city house-price key reads the bureau's own table for the
 * cities its region catalog lists, and the audit holds Beijing against the
 * mirror's Beijing row.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-house-")), "test.db");
process.env.CHINA_SEED = "off";
const { CATALOG, CITIES_70_NBS, CITIES_70 } = await import("./data.ts");
const { CONCORDANCE_PAIRS } = await import("./concordance.ts");
const { readCatalogSnapshot } = await import("./catalog-file.ts");

interface Entry { id: string; name: string; cid: string; datasetCode: number }
function isEntry(value: unknown): value is Entry { return typeof value === "object" && value !== null && typeof Reflect.get(value, "id") === "string"; }
const snapshot: unknown = await readCatalogSnapshot();
const list = typeof snapshot === "object" && snapshot !== null ? Reflect.get(snapshot, "entries") : undefined;
const byId = new Map((Array.isArray(list) ? list : []).filter(isEntry).map((entry) => [entry.id, entry]));

test("the key's ids are the city table's headline indices and its cities are the table's own list", async () => {
  const cfg: unknown = CATALOG["house_prices_nbs"];
  const ids = typeof cfg === "object" && cfg !== null ? Reflect.get(cfg, "ids") : undefined;
  const names = (Array.isArray(ids) ? ids : []).map((item: unknown) => byId.get(typeof item === "object" && item !== null ? String(Reflect.get(item, "id")) : "")?.name);
  expect(names).toEqual(["新建商品住宅销售价格指数 (上年同月=100)", "二手住宅销售价格指数 (上年同月=100)"]);
  expect(new Set(names.map((name, index) => byId.get(String(Reflect.get((Array.isArray(ids) ? ids : [])[index] ?? {}, "id")))?.datasetCode))).toEqual(new Set([7]));
  const regions: unknown = await Bun.file(new URL("../catalog/nbs-regions.json", import.meta.url)).json();
  const tables = typeof regions === "object" && regions !== null ? Reflect.get(regions, "tables") : undefined;
  const sets = typeof regions === "object" && regions !== null ? Reflect.get(regions, "sets") : undefined;
  const set = typeof tables === "object" && tables !== null ? Reflect.get(tables, "3eb43764c74741469b745c396cf002d1") : undefined;
  const places: unknown = typeof sets === "object" && sets !== null && typeof set === "string" ? Reflect.get(sets, set) : undefined;
  const codes = new Set((Array.isArray(places) ? places : []).map((place: unknown) => (typeof place === "object" && place !== null ? String(Reflect.get(place, "value")) : "")));
  // The bureau's catalog lists Lhasa beside the seventy the mirror carries.
  expect(CITIES_70_NBS.length).toBe(71);
  expect(CITIES_70_NBS.every((city) => codes.has(city.value) && (city.en ?? "").length > 0)).toBe(true);
  const nbsNames = new Set(CITIES_70_NBS.map((city) => city.en));
  expect(CITIES_70.every((city) => nbsNames.has(city.en))).toBe(true);
  expect(nbsNames.has("Lhasa")).toBe(true);
});

test("the audit holds Beijing's new-home index against the mirror's Beijing row", () => {
  const pair = CONCORDANCE_PAIRS.find((candidate) => candidate.name.startsWith("New home prices, Beijing"));
  expect(pair?.kind).toBe("value");
  if (pair?.kind !== "value") return;
  expect(pair.left).toEqual({ key: "house_prices_nbs", label: "New homes (YoY %)", region: "110000000000" });
  expect(pair.right).toEqual({ key: "house_prices", label: "New homes (YoY %)", region: "beijing" });
});
