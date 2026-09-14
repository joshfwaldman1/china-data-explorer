/**
 * Which places a regional NBS table covers.
 *
 * The bureau publishes a provincial or city table as one indicator repeated
 * over places, and the list of places belongs to the table, not to the
 * country: the provincial tables carry 31 provinces, the city tables carry the
 * cities that table was collected for. That list lives behind a challenged
 * metadata endpoint, so it is collected once by `bun run china:regions` and
 * shipped beside the catalog; see scripts/sync-nbs-regions.ts.
 *
 * Reading order: the collected list for this table, then the live endpoint if
 * it happens to answer, then the standing province and Hong Kong/Macao/Taiwan
 * lists. A table with no list at all returns none, and the caller treats that
 * as a series it cannot fetch rather than quietly asking for the nation.
 */

import { resolve } from "node:path";
import { englishPlace } from "../shared/places.ts";

export interface RegionOption { text: string; value: string }

const REGIONS_PATH = process.env.NBS_REGIONS_PATH ?? resolve(import.meta.dir, "../catalog/nbs-regions.json");

interface RegionSnapshot {
  generatedAt: string;
  sets: Record<string, RegionOption[]>;
  tables: Record<string, string>;
}

let snapshot: RegionSnapshot | null | undefined;
let loading: Promise<RegionSnapshot | null> | undefined;

function isRegionOption(value: unknown): value is RegionOption {
  if (typeof value !== "object" || value === null) return false;
  const text = Reflect.get(value, "text");
  const code = Reflect.get(value, "value");
  return typeof text === "string" && typeof code === "string" && text !== "" && code !== "";
}

function parse(raw: unknown): RegionSnapshot | null {
  if (typeof raw !== "object" || raw === null) return null;
  const sets = Reflect.get(raw, "sets");
  const tables = Reflect.get(raw, "tables");
  if (typeof sets !== "object" || sets === null || typeof tables !== "object" || tables === null) return null;
  const parsedSets: Record<string, RegionOption[]> = {};
  for (const [id, list] of Object.entries(sets)) {
    if (Array.isArray(list)) parsedSets[id] = list.filter(isRegionOption);
  }
  const parsedTables: Record<string, string> = {};
  for (const [cid, id] of Object.entries(tables)) {
    if (typeof id === "string") parsedTables[cid] = id;
  }
  return { generatedAt: String(Reflect.get(raw, "generatedAt") ?? ""), sets: parsedSets, tables: parsedTables };
}

/** The collected lists, read once. An absent file means no collected lists, not an error. */
async function load(): Promise<RegionSnapshot | null> {
  if (snapshot !== undefined) return snapshot;
  loading ??= (async () => {
    try {
      const file = Bun.file(REGIONS_PATH);
      snapshot = file.size > 0 ? parse(JSON.parse(await file.text())) : null;
    } catch {
      snapshot = null;
    }
    return snapshot ?? null;
  })();
  return await loading;
}

/** The places one table is published for, or none if it was never collected. */
export async function collectedRegions(cid: string): Promise<RegionOption[] | null> {
  const data = await load();
  if (!data) return null;
  const set = data.tables[cid];
  if (!set) return null;
  const places = data.sets[set];
  return places ? withEnglishNames(places) : null;
}

/**
 * Attach the English name of each place, where the site knows one. The source
 * label stays as the bureau wrote it — the English is for display only, and a
 * place we have no English name for shows its Chinese name rather than a
 * transliteration we invented.
 */
export function withEnglishNames(places: RegionOption[]): RegionOption[] {
  return places.map((place) => {
    const en = englishPlace(place.value, place.text);
    return en ? { ...place, en } : place;
  });
}

/** When the collected lists were gathered, and how many tables they cover — for the status route. */
export async function regionCoverage(): Promise<{ generatedAt: string | null; tables: number; lists: number }> {
  const data = await load();
  if (!data) return { generatedAt: null, tables: 0, lists: 0 };
  return { generatedAt: data.generatedAt || null, tables: Object.keys(data.tables).length, lists: Object.keys(data.sets).length };
}

/** Test seam: forget the cached file so a new one is read. */
export function resetRegionCache(): void {
  snapshot = undefined;
  loading = undefined;
}
