/**
 * Collect the geographies each regional NBS table is published for.
 *
 * A provincial or city table is one indicator repeated over places, and the
 * bureau keeps that list behind the same challenged metadata endpoints as the
 * index tree — so the site cannot ask for it at request time, and guessing is
 * how you end up charting a province that does not exist in a table. This walks
 * the tables in a catalog snapshot, asks the portal which places each one
 * covers, and writes the answer next to the catalog.
 *
 *   bun run china:regions                       # every regional table in the snapshot
 *   bun run china:regions --codes=6,8           # only these datasets
 *   bun run china:regions --merge=true          # keep what was collected before
 *
 * Output shape: region lists are shared by many tables, so they are stored once
 * under the bureau's own identifier for the list and each table points at one.
 */

import { mkdir, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { readCatalogSnapshot } from "../server/catalog-file.ts";
import { openPortal } from "./portal.ts";

interface RegionOption { text: string; value: string }

interface RegionSnapshot {
  generatedAt: string;
  source: string;
  /** Region list identifier -> the places in it. */
  sets: Record<string, RegionOption[]>;
  /** Table identifier (cid) -> the region list it is published for. */
  tables: Record<string, string>;
}

const DEFAULT_OUTPUT = resolve(import.meta.dir, "../catalog/nbs-regions.json");

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function objectValue(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function textValue(value: unknown, key: string): string {
  const found = objectValue(value, key);
  return typeof found === "string" ? found.trim() : "";
}

const outputPath = resolve(option("out") ?? DEFAULT_OUTPUT);
const codesOption = option("codes");
const wantedCodes = codesOption
  ? new Set(codesOption.split(",").map(Number).filter(Number.isFinite))
  : null;

// Tables in the snapshot that are published per place, one entry each.
const snapshot = await readCatalogSnapshot(option("catalog") ? resolve(option("catalog") ?? "") : undefined);
const entries = objectValue(snapshot, "entries");
if (!Array.isArray(entries)) throw new Error("catalog snapshot has no entries; run the catalog sync first");

const tables = new Map<string, { code: number; dataset: string; geography: string }>();
for (const entry of entries) {
  const geography = textValue(entry, "geography");
  const cid = textValue(entry, "cid");
  const code = objectValue(entry, "datasetCode");
  if (!cid || geography === "National" || typeof code !== "number") continue;
  if (wantedCodes && !wantedCodes.has(code)) continue;
  if (!tables.has(cid)) tables.set(cid, { code, dataset: textValue(entry, "dataset"), geography });
}

const collected: RegionSnapshot = {
  generatedAt: new Date().toISOString(),
  source: "National Bureau of Statistics of China",
  sets: {},
  tables: {},
};

if (option("merge") === "true" && await Bun.file(outputPath).exists()) {
  const previous: unknown = await Bun.file(outputPath).json();
  const sets = objectValue(previous, "sets");
  const previousTables = objectValue(previous, "tables");
  if (sets && typeof sets === "object") Object.assign(collected.sets, sets);
  if (previousTables && typeof previousTables === "object") Object.assign(collected.tables, previousTables);
}

const pending = [...tables].filter(([cid]) => !collected.tables[cid]);
console.log(`${tables.size.toLocaleString()} regional tables in the snapshot, ${pending.length.toLocaleString()} still to ask about`);

const portal = await openPortal({ channel: option("channel"), headless: option("headed") !== "true" });
const failures: { cid: string; message: string }[] = [];

async function writeSnapshot(): Promise<void> {
  collected.generatedAt = new Date().toISOString();
  const temporary = `${outputPath}.tmp`;
  await mkdir(dirname(outputPath), { recursive: true });
  await Bun.write(temporary, `${JSON.stringify(collected)}\n`);
  await rename(temporary, outputPath);
}

try {
  for (const [index, [cid, table]] of pending.entries()) {
    try {
      // Each table names one or more ways of grouping places: all provinces,
      // the four macro-regions, and so on. The full list is the useful one.
      const tree = await portal.getJson(`/getDaCatalogTreeByIndicatorCid?indicatorCid=${encodeURIComponent(cid)}`);
      const nodes = objectValue(tree, "data");
      if (!Array.isArray(nodes) || nodes.length === 0) throw new Error("no region catalog for this table");
      const preferred = nodes.find((node) => textValue(node, "name").includes("全部")) ?? nodes[0];
      const daCid = textValue(preferred, "_id");
      if (!daCid) throw new Error("region catalog has no identifier");

      if (!collected.sets[daCid]) {
        const raw = await portal.getJson(`/getDasByDaCatalogId?daCid=${encodeURIComponent(daCid)}`);
        const places = objectValue(raw, "data");
        if (!Array.isArray(places)) throw new Error("region list came back empty");
        const options = places
          .map((place) => ({ text: textValue(place, "show_name") || textValue(place, "name_text"), value: textValue(place, "name_value") }))
          .filter((place) => place.text && place.value);
        if (options.length === 0) throw new Error("region list came back empty");
        collected.sets[daCid] = options;
        console.log(`  new region list ${daCid}: ${options.length} places (${options.slice(0, 3).map((place) => place.text).join(", ")}...)`);
      }
      collected.tables[cid] = daCid;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ cid, message });
      console.warn(`  ${table.dataset} ${cid}: ${message}`);
    }
    if ((index + 1) % 25 === 0) {
      await writeSnapshot();
      console.log(`  ${index + 1}/${pending.length} tables, ${Object.keys(collected.sets).length} distinct region lists`);
    }
    await Bun.sleep(Number(option("delay") ?? "400"));
  }
} finally {
  await writeSnapshot();
  await portal.close();
}

console.log(`Wrote ${Object.keys(collected.tables).length.toLocaleString()} tables over ${Object.keys(collected.sets).length} region lists to ${outputPath}`);
if (failures.length > 0) console.warn(`${failures.length} tables could not be asked about`);
