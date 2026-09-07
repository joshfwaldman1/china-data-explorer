import { resolve } from "node:path";
import type { SeriesPoint, SeriesResult } from "./data";

const API = "https://data.stats.gov.cn/dg/website/publicrelease/web/external";
const CATALOG_PATH = resolve(import.meta.dir, "catalog/nbs-catalog.json");
const NATIONAL = { text: "全国", value: "000000000000" };

export type NbsTransform = "raw" | "change" | "percent_change" | "yoy" | "index_growth";

export interface NbsCatalogEntry {
  key: string;
  id: string;
  name: string;
  shortName: string;
  unit: string;
  note: string;
  annotation: string;
  precision: number | null;
  rootId: string;
  cid: string;
  datasetCode: number;
  dataset: string;
  frequency: "Monthly" | "Quarterly" | "Annual";
  geography: "National" | "Province" | "City" | "Hong Kong, Macao & Taiwan";
  categories: string[];
}

export interface NbsRegionOption {
  text: string;
  value: string;
}

export interface NbsSearchFilters {
  query?: string;
  frequency?: string;
  geography?: string;
  datasetCode?: number;
  category?: string;
  limit?: number;
  offset?: number;
}

interface CatalogSnapshot {
  generatedAt: string;
  source: string;
  entries: NbsCatalogEntry[];
}

let snapshotPromise: Promise<CatalogSnapshot> | undefined;
const dimensionsCache = new Map<string, { at: number; data: NbsRegionOption[] }>();

function objectValue(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function stringValue(value: unknown, key: string): string {
  const found = objectValue(value, key);
  return typeof found === "string" ? found : "";
}

function isFrequency(value: unknown): value is NbsCatalogEntry["frequency"] {
  return value === "Monthly" || value === "Quarterly" || value === "Annual";
}

function isGeography(value: unknown): value is NbsCatalogEntry["geography"] {
  return value === "National" || value === "Province" || value === "City" || value === "Hong Kong, Macao & Taiwan";
}

function parseEntry(value: unknown): NbsCatalogEntry | null {
  const key = stringValue(value, "key");
  const id = stringValue(value, "id");
  const name = stringValue(value, "name");
  const rootId = stringValue(value, "rootId");
  const cid = stringValue(value, "cid");
  const frequency = objectValue(value, "frequency");
  const geography = objectValue(value, "geography");
  const datasetCode = objectValue(value, "datasetCode");
  const categoriesRaw = objectValue(value, "categories");
  if (!key || !id || !name || !rootId || !cid || !isFrequency(frequency) ||
      !isGeography(geography) || typeof datasetCode !== "number" || !Array.isArray(categoriesRaw)) {
    return null;
  }
  const categories = categoriesRaw.filter((item): item is string => typeof item === "string");
  const precisionRaw = objectValue(value, "precision");
  return {
    key,
    id,
    name,
    shortName: stringValue(value, "shortName") || name,
    unit: stringValue(value, "unit"),
    note: stringValue(value, "note"),
    annotation: stringValue(value, "annotation"),
    precision: typeof precisionRaw === "number" ? precisionRaw : null,
    rootId,
    cid,
    datasetCode,
    dataset: stringValue(value, "dataset"),
    frequency,
    geography,
    categories,
  };
}

async function loadSnapshot(): Promise<CatalogSnapshot> {
  if (!snapshotPromise) {
    snapshotPromise = (async () => {
      const raw: unknown = await Bun.file(CATALOG_PATH).json();
      const entriesRaw = objectValue(raw, "entries");
      if (!Array.isArray(entriesRaw)) throw new Error("NBS catalog is missing; run the catalog sync script");
      return {
        generatedAt: stringValue(raw, "generatedAt"),
        source: stringValue(raw, "source"),
        entries: entriesRaw.map(parseEntry).filter((entry): entry is NbsCatalogEntry => entry !== null),
      };
    })();
  }
  return snapshotPromise;
}

export async function nbsCatalogStats() {
  const snapshot = await loadSnapshot();
  const categories = new Set<string>();
  const categoryCounts = new Map<string, number>();
  const datasets = new Map<number, { code: number; name: string; frequency: string; geography: string; count: number }>();
  for (const entry of snapshot.entries) {
    for (const category of entry.categories) categories.add(category);
    const topCategory = entry.categories[0];
    if (topCategory) categoryCounts.set(topCategory, (categoryCounts.get(topCategory) ?? 0) + 1);
    const found = datasets.get(entry.datasetCode);
    if (found) found.count += 1;
    else datasets.set(entry.datasetCode, {
      code: entry.datasetCode,
      name: entry.dataset,
      frequency: entry.frequency,
      geography: entry.geography,
      count: 1,
    });
  }
  return {
    generatedAt: snapshot.generatedAt,
    seriesCount: snapshot.entries.length,
    categoryCount: categories.size,
    categories: [...categoryCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    datasets: [...datasets.values()].sort((a, b) => a.code - b.code),
  };
}

function searchScore(entry: NbsCatalogEntry, query: string): number {
  if (!query) return 1;
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const name = entry.name.toLocaleLowerCase();
  const shortName = entry.shortName.toLocaleLowerCase();
  const path = entry.categories.join(" ").toLocaleLowerCase();
  const haystack = `${name} ${shortName} ${path} ${entry.dataset.toLocaleLowerCase()} ${entry.id}`;
  if (!terms.every((term) => haystack.includes(term))) return 0;
  let score = 10;
  if (name === query.toLocaleLowerCase()) score += 100;
  if (name.startsWith(query.toLocaleLowerCase())) score += 40;
  if (shortName.includes(query.toLocaleLowerCase())) score += 20;
  if (path.includes(query.toLocaleLowerCase())) score += 5;
  return score;
}

export async function searchNbsCatalog(filters: NbsSearchFilters) {
  const snapshot = await loadSnapshot();
  const query = (filters.query ?? "").trim();
  const scored = snapshot.entries
    .filter((entry) => !filters.frequency || entry.frequency === filters.frequency)
    .filter((entry) => !filters.geography || entry.geography === filters.geography)
    .filter((entry) => filters.datasetCode === undefined || entry.datasetCode === filters.datasetCode)
    .filter((entry) => !filters.category || entry.categories.includes(filters.category))
    .map((entry) => ({ entry, score: searchScore(entry, query) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name, "zh-CN"));
  const offset = Math.max(0, filters.offset ?? 0);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 50));
  return {
    total: scored.length,
    offset,
    limit,
    results: scored.slice(offset, offset + limit).map((item) => item.entry),
  };
}

export async function getNbsCatalogEntry(key: string): Promise<NbsCatalogEntry | null> {
  const snapshot = await loadSnapshot();
  return snapshot.entries.find((entry) => entry.key === key || entry.id === key) ?? null;
}

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(`${API}${path}`, {
    headers: { Accept: "application/json", Referer: "https://data.stats.gov.cn/dg/website/page.html" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`NBS metadata -> HTTP ${response.status}`);
  return response.json();
}

export async function getNbsDimensions(entry: NbsCatalogEntry): Promise<NbsRegionOption[]> {
  if (entry.geography === "National") return [NATIONAL];
  const cached = dimensionsCache.get(entry.cid);
  if (cached && Date.now() - cached.at < 6 * 60 * 60 * 1000) return cached.data;

  const treeRaw = await getJson(
    `/getDaCatalogTreeByIndicatorCid?indicatorCid=${encodeURIComponent(entry.cid)}`,
  );
  const tree = objectValue(treeRaw, "data");
  if (!Array.isArray(tree) || tree.length === 0) return [];
  const preferred = tree.find((item) => stringValue(item, "name").includes("全部")) ?? tree[0];
  const daCid = stringValue(preferred, "_id");
  if (!daCid) return [];

  const regionsRaw = await getJson(`/getDasByDaCatalogId?daCid=${encodeURIComponent(daCid)}`);
  const regions = objectValue(regionsRaw, "data");
  if (!Array.isArray(regions)) return [];
  const parsed = regions.map((item) => ({
    text: stringValue(item, "show_name") || stringValue(item, "name_text"),
    value: stringValue(item, "name_value"),
  })).filter((item) => item.text && item.value);
  dimensionsCache.set(entry.cid, { at: Date.now(), data: parsed });
  return parsed;
}

function periodRange(frequency: NbsCatalogEntry["frequency"], limit: number): string {
  const now = new Date();
  if (frequency === "Monthly") {
    const endIndex = now.getFullYear() * 12 + now.getMonth();
    const startIndex = endIndex - Math.max(0, limit - 1);
    const label = (index: number) => `${Math.floor(index / 12)}${String(index % 12 + 1).padStart(2, "0")}MM`;
    return `${label(startIndex)}-${label(endIndex)}`;
  }
  if (frequency === "Quarterly") {
    const endIndex = now.getFullYear() * 4 + Math.floor(now.getMonth() / 3);
    const startIndex = endIndex - Math.max(0, limit - 1);
    const label = (index: number) => `${Math.floor(index / 4)}0${index % 4 + 1}SS`;
    return `${label(startIndex)}-${label(endIndex)}`;
  }
  return `${now.getFullYear() - Math.max(0, limit - 1)}-${now.getFullYear()}`;
}

function periodLabel(code: string): string {
  const quarter = code.match(/^(\d{4})0([1-4])SS$/);
  if (quarter) return `${quarter[1]}-Q${quarter[2]}`;
  const month = code.match(/^(\d{4})(\d{2})/);
  if (month) return `${month[1]}-${month[2]}`;
  return code;
}

function periodsPerYear(frequency: NbsCatalogEntry["frequency"]): number {
  if (frequency === "Monthly") return 12;
  if (frequency === "Quarterly") return 4;
  return 1;
}

function transformPoints(points: SeriesPoint[], transform: NbsTransform, frequency: NbsCatalogEntry["frequency"]): SeriesPoint[] {
  if (transform === "raw") return points;
  if (transform === "index_growth") {
    return points.map((point) => ({ date: point.date, value: Math.round((point.value - 100) * 1000) / 1000 }));
  }
  const lag = transform === "yoy" ? periodsPerYear(frequency) : 1;
  const output: SeriesPoint[] = [];
  for (let index = lag; index < points.length; index += 1) {
    const current = points[index];
    const previous = points[index - lag];
    if (!current || !previous) continue;
    let value = current.value - previous.value;
    if (transform === "percent_change" || transform === "yoy") {
      if (previous.value === 0) continue;
      value = (current.value / previous.value - 1) * 100;
    }
    output.push({ date: current.date, value: Math.round(value * 1000) / 1000 });
  }
  return output;
}

function transformLabel(transform: NbsTransform): string {
  if (transform === "change") return "Change";
  if (transform === "percent_change") return "Percent change";
  if (transform === "yoy") return "Percent change from year ago";
  if (transform === "index_growth") return "Percent change from year ago";
  return "Raw value";
}

export function defaultNbsTransform(entry: NbsCatalogEntry): NbsTransform {
  return /上年(?:同期)?\s*=\s*100/.test(`${entry.name} ${entry.shortName}`) ? "index_growth" : "raw";
}

export async function fetchNbsCatalogSeries(options: {
  entry: NbsCatalogEntry;
  region?: string;
  limit?: number;
  transform?: NbsTransform;
}): Promise<SeriesResult & { metadata: NbsCatalogEntry; region: NbsRegionOption; transform: NbsTransform }> {
  const limit = Math.min(600, Math.max(2, options.limit ?? 120));
  const transform = options.transform ?? defaultNbsTransform(options.entry);
  const dimensions = await getNbsDimensions(options.entry);
  const region = dimensions.find((item) => item.value === options.region) ?? dimensions[0] ?? NATIONAL;
  const payload = {
    cid: options.entry.cid,
    indicatorIds: [options.entry.id],
    daCatalogId: "",
    das: [region],
    showType: "1",
    dts: [periodRange(options.entry.frequency, limit)],
    rootId: options.entry.rootId,
  };
  const response = await fetch(`${API}/stream/esData`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      Origin: "https://data.stats.gov.cn",
      Referer: "https://data.stats.gov.cn/dg/website/page.html",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`NBS esData -> HTTP ${response.status}`);
  const raw: unknown = await response.json();
  const periods = objectValue(raw, "data");
  const points: SeriesPoint[] = [];
  if (Array.isArray(periods)) {
    for (const period of periods) {
      const code = stringValue(period, "code");
      const values = objectValue(period, "values");
      if (!Array.isArray(values)) continue;
      const found = values.find((value) =>
        stringValue(value, "_id") === options.entry.id &&
        (!stringValue(value, "da") || stringValue(value, "da") === region.value)
      );
      const rawValue = objectValue(found, "value");
      const value = typeof rawValue === "number" ? rawValue : Number(rawValue);
      if (!code || !Number.isFinite(value)) continue;
      points.push({ date: periodLabel(code), value });
    }
  }
  points.sort((a, b) => a.date.localeCompare(b.date));
  const transformed = transformPoints(points, transform, options.entry.frequency);
  const unit = transform === "raw" ? options.entry.unit || "Value" : transformLabel(transform);
  return {
    key: options.entry.key,
    title: options.entry.name,
    agency: "National Bureau of Statistics",
    sourceUrl: "https://data.stats.gov.cn/dg/website/page.html",
    frequency: options.entry.frequency,
    unit,
    series: [{ label: region.text, points: transformed }],
    metadata: options.entry,
    region,
    transform,
  };
}
