/**
 * Official English labels from the NBS portal.
 *
 * The current portal has an English mode whose API (the same endpoints under
 * publicrelease/en/) answers the same indicator ids with the bureau's own
 * English titles; scripts/sync-nbs-english.ts collects them. A label is used
 * only when it is pinned to both the current opaque key and the exact current
 * Chinese title, so a catalog rename fails safe to the generated gloss
 * instead of silently mislabelling a series.
 */

import { resolve } from "node:path";

const OFFICIAL_PATH = resolve(import.meta.dir, "../catalog/nbs-official-en.json");
/** The shipped form: the same snapshot gzipped, as the catalog snapshot is. */
const OFFICIAL_GZ_PATH = `${OFFICIAL_PATH}.gz`;

export type EnglishLabelSource = "nbs-official" | "generated" | "unavailable";

export interface OfficialEnglishEntry {
  currentKey: string;
  nameZh: string;
  nameEn: string;
  sourceUrl: string;
  capturedAt: string;
  legacyDatabase: string;
  legacyIndicatorCode: string;
}

export interface EnglishLabel {
  nameEn: string;
  nameEnSource: EnglishLabelSource;
  nameEnSourceUrl?: string;
  nameEnCapturedAt?: string;
  legacyDatabase?: string;
  legacyIndicatorCode?: string;
}

export interface OfficialEnglishSnapshot {
  schemaVersion: number;
  generatedAt: string;
  source: string;
  entries: OfficialEnglishEntry[];
}

function objectValue(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function textValue(value: unknown, key: string): string {
  const found = objectValue(value, key);
  return typeof found === "string" ? found.trim() : "";
}

function officialNbsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    // The legacy English portal (/english/) or the English mode of the current portal (/dg/website/...en/...).
    return url.protocol === "https:" && url.hostname === "data.stats.gov.cn" && (url.pathname.startsWith("/english/") || url.pathname.startsWith("/dg/website/"));
  } catch {
    return false;
  }
}

function parseEntry(value: unknown): OfficialEnglishEntry | null {
  const currentKey = textValue(value, "currentKey");
  const nameZh = textValue(value, "nameZh");
  const nameEn = textValue(value, "nameEn");
  const sourceUrl = textValue(value, "sourceUrl");
  const capturedAt = textValue(value, "capturedAt");
  const legacyDatabase = textValue(value, "legacyDatabase");
  const legacyIndicatorCode = textValue(value, "legacyIndicatorCode");
  if (!/^nbs_[0-9a-f]{32}$/.test(currentKey) || !nameZh || !nameEn ||
      !officialNbsUrl(sourceUrl) || !capturedAt || !legacyDatabase || !legacyIndicatorCode) return null;
  return { currentKey, nameZh, nameEn, sourceUrl, capturedAt, legacyDatabase, legacyIndicatorCode };
}

export function parseOfficialEnglishSnapshot(value: unknown): OfficialEnglishSnapshot {
  const schemaVersion = objectValue(value, "schemaVersion");
  const entriesRaw = objectValue(value, "entries");
  if (schemaVersion !== 1 || !Array.isArray(entriesRaw)) {
    throw new Error("official English snapshot must use schemaVersion 1 and contain an entries array");
  }
  const entries = entriesRaw.map(parseEntry).filter((entry): entry is OfficialEnglishEntry => entry !== null);
  if (entries.length !== entriesRaw.length) throw new Error("official English snapshot contains an invalid entry");
  const seen = new Map<string, OfficialEnglishEntry>();
  for (const entry of entries) {
    const previous = seen.get(entry.currentKey);
    if (previous && (previous.nameZh !== entry.nameZh || previous.nameEn !== entry.nameEn)) {
      throw new Error(`conflicting official English entries for ${entry.currentKey}`);
    }
    seen.set(entry.currentKey, entry);
  }
  return {
    schemaVersion,
    generatedAt: textValue(value, "generatedAt"),
    source: textValue(value, "source") || "National Bureau of Statistics of China",
    entries: [...seen.values()],
  };
}

export function indexOfficialEnglish(snapshot: OfficialEnglishSnapshot): Map<string, OfficialEnglishEntry> {
  return new Map(snapshot.entries.map((entry) => [entry.currentKey, entry]));
}

export function resolveEnglishLabelFrom(
  entries: ReadonlyMap<string, OfficialEnglishEntry>,
  currentKey: string,
  nameZh: string,
  generated = "",
): EnglishLabel {
  const official = entries.get(currentKey);
  if (official && official.nameZh === nameZh) {
    return {
      nameEn: official.nameEn,
      nameEnSource: "nbs-official",
      nameEnSourceUrl: official.sourceUrl,
      nameEnCapturedAt: official.capturedAt,
      legacyDatabase: official.legacyDatabase,
      legacyIndicatorCode: official.legacyIndicatorCode,
    };
  }
  return generated
    ? { nameEn: generated, nameEnSource: "generated" }
    : { nameEn: "", nameEnSource: "unavailable" };
}

let officialEntries = new Map<string, OfficialEnglishEntry>();
const gzExists = () => Bun.file(OFFICIAL_GZ_PATH).exists();
let loadPromise: Promise<number> | undefined;

export async function warmOfficialEnglish(): Promise<number> {
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const gz = Bun.file(OFFICIAL_GZ_PATH);
        const raw: unknown = await gz.exists()
          ? JSON.parse(new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(await gz.arrayBuffer()))))
          : await Bun.file(OFFICIAL_PATH).json();
        officialEntries = indexOfficialEnglish(parseOfficialEnglishSnapshot(raw));
      } catch (error) {
        if (await gzExists() || await Bun.file(OFFICIAL_PATH).exists()) throw error;
        officialEntries = new Map();
      }
      return officialEntries.size;
    })();
  }
  return loadPromise;
}

/** Synchronous after warmOfficialEnglish(), like glossTitle() after warmGloss(). */
export function resolveEnglishLabel(currentKey: string, nameZh: string, generated = ""): EnglishLabel {
  return resolveEnglishLabelFrom(officialEntries, currentKey, nameZh, generated);
}
