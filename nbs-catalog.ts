import { resolve } from "node:path";
import { stat } from "node:fs/promises";
import { NBS_PROVINCES, type SeriesPoint, type SeriesResult } from "./data";
import { logFetch, readSeries, seriesFreshness, writeSeries } from "./db";

const API = "https://data.stats.gov.cn/dg/website/publicrelease/web/external";
const CATALOG_PATH = resolve(import.meta.dir, "catalog/nbs-catalog.json");
const NATIONAL = { text: "全国", value: "000000000000" };
const HMT_REGIONS = [
  { text: "香港特别行政区", value: "810000000000" },
  { text: "澳门特别行政区", value: "820000000000" },
  { text: "台湾省", value: "710000000000" },
];
const SEARCH_ALIASES: Record<string, string[]> = {
  gdp: ["国内生产总值", "地区生产总值"],
  cpi: ["居民消费价格"],
  inflation: ["居民消费价格", "价格指数"],
  ppi: ["工业生产者价格"],
  pmi: ["采购经理指数"],
  fai: ["固定资产投资"],
  unemployment: ["失业"],
  employment: ["就业", "从业人员"],
  population: ["人口"],
  births: ["出生人口", "出生率"],
  exports: ["出口"],
  export: ["出口"],
  imports: ["进口"],
  import: ["进口"],
  trade: ["进出口", "对外贸易"],
  consumption: ["消费"],
  sales: ["销售", "零售"],
  income: ["收入"],
  wages: ["工资"],
  wage: ["工资"],
  savings: ["储蓄"],
  investment: ["投资"],
  output: ["产量", "产值", "增加值"],
  production: ["生产", "产量", "增加值"],
  growth: ["增长", "增速"],
  rate: ["率", "增速"],
  index: ["指数"],
  price: ["价格"],
  prices: ["价格"],
  manufacturing: ["制造业"],
  services: ["服务业", "第三产业"],
  service: ["服务业", "第三产业"],
  construction: ["建筑业"],
  agriculture: ["农业", "农林牧渔业"],
  mining: ["采矿业"],
  electricity: ["电力", "发电量"],
  energy: ["能源"],
  coal: ["煤炭", "原煤"],
  oil: ["石油", "原油"],
  gas: ["天然气", "燃气"],
  steel: ["钢铁", "钢材", "粗钢", "黑色金属"],
  cement: ["水泥"],
  autos: ["汽车"],
  vehicles: ["汽车"],
  freight: ["货运", "货物运输"],
  passenger: ["客运", "旅客运输"],
  postal: ["邮政"],
  telecom: ["电信", "通信"],
  "industrial production": ["工业增加值"],
  "coal production": ["原煤产量", "煤炭产量"],
  "steel production": ["粗钢产量", "钢材产量"],
  "electricity generation": ["发电量"],
  "vehicle production": ["汽车产量"],
  "industrial profits": ["工业企业利润", "工业经济效益"],
  "retail sales": ["社会消费品零售"],
  "fixed asset investment": ["固定资产投资"],
  "private investment": ["民间固定资产投资", "民间投资"],
  "foreign investment": ["外商投资", "外商直接投资"],
  fdi: ["外商直接投资", "外商投资"],
  "real estate": ["房地产"],
  "real estate investment": ["房地产开发投资", "房地产投资"],
  property: ["房地产"],
  housing: ["住宅", "房地产"],
  "house price": ["住宅销售价格", "房价"],
  "house prices": ["住宅销售价格", "房价"],
  "producer prices": ["工业生产者价格"],
  "food prices": ["食品价格"],
  "trade balance": ["进出口差额", "贸易差额"],
  "provincial gdp": ["地区生产总值"],
};
const SEARCH_STOP_WORDS = new Set(["china", "chinese", "national", "data", "series"]);

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

type NbsSeriesResult = SeriesResult & {
  metadata: NbsCatalogEntry;
  region: NbsRegionOption;
  transform: NbsTransform;
  source: "store" | "live" | "stale";
};

let snapshotCache: { modifiedAt: number; snapshot: CatalogSnapshot } | undefined;
let snapshotPromise: Promise<CatalogSnapshot> | undefined;
const dimensionsCache = new Map<string, { at: number; data: NbsRegionOption[] }>();

function objectValue(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function stringValue(value: unknown, key: string): string {
  const found = objectValue(value, key);
  return typeof found === "string" ? found : "";
}

export function isFrequency(value: unknown): value is NbsCatalogEntry["frequency"] {
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
  const modifiedAt = (await stat(CATALOG_PATH)).mtimeMs;
  if (snapshotCache?.modifiedAt === modifiedAt) return snapshotCache.snapshot;
  if (!snapshotPromise) {
    snapshotPromise = (async () => {
      const raw: unknown = await Bun.file(CATALOG_PATH).json();
      const entriesRaw = objectValue(raw, "entries");
      if (!Array.isArray(entriesRaw)) throw new Error("NBS catalog is missing; run the catalog sync script");
      const snapshot = {
        generatedAt: stringValue(raw, "generatedAt"),
        source: stringValue(raw, "source"),
        entries: entriesRaw.map(parseEntry).filter((entry): entry is NbsCatalogEntry => entry !== null),
      };
      snapshotCache = { modifiedAt, snapshot };
      return snapshot;
    })();
  }
  try {
    return await snapshotPromise;
  } finally {
    snapshotPromise = undefined;
  }
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
  const name = entry.name.toLocaleLowerCase();
  const shortName = entry.shortName.toLocaleLowerCase();
  const path = entry.categories.join(" ").toLocaleLowerCase();
  const haystack = `${name} ${shortName} ${path} ${entry.dataset.toLocaleLowerCase()}`;
  const lowerQuery = query.toLocaleLowerCase().replace(/^nbs_/, "");
  // An ID is only a match when enough of it is typed to be one — otherwise
  // any two-character query lights up random hashes.
  if (lowerQuery.length >= 8 && /^[0-9a-f]+$/.test(lowerQuery) && entry.id.startsWith(lowerQuery)) return 500;
  const exactAliases = SEARCH_ALIASES[lowerQuery];
  const variants = exactAliases ?? [lowerQuery];
  let bestScore = 0;
  for (const variant of variants) {
    const terms = variant.split(/\s+/).filter(Boolean);
    if (!terms.every((term) => haystack.includes(term))) continue;
    let score = 10;
    if (name === variant) score += 100;
    if (name.startsWith(variant)) score += 40;
    if (name.includes(variant)) score += 30;
    if (shortName.includes(variant)) score += 20;
    if (path.includes(variant)) score += 5;
    bestScore = Math.max(bestScore, score);
  }
  if (bestScore > 0 || exactAliases) return bestScore;

  const tokenGroups = lowerQuery.split(/\s+/)
    .filter((word) => word && !SEARCH_STOP_WORDS.has(word))
    .map((word) => SEARCH_ALIASES[word] ?? [word]);
  if (tokenGroups.length > 0 && tokenGroups.every((group) => group.some((term) => haystack.includes(term)))) {
    const titleMatches = tokenGroups.filter((group) => group.some((term) => name.includes(term))).length;
    return 10 + titleMatches * 20;
  }
  return bestScore;
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
  const text = await response.text();
  if (!text.trimStart().startsWith("{")) throw new Error("NBS metadata returned its anti-bot page");
  const parsed: unknown = JSON.parse(text);
  return parsed;
}

function fallbackDimensions(entry: NbsCatalogEntry): NbsRegionOption[] {
  if (entry.geography === "Province") return NBS_PROVINCES;
  if (entry.geography === "Hong Kong, Macao & Taiwan") return HMT_REGIONS;
  return [];
}

export async function getNbsDimensions(entry: NbsCatalogEntry): Promise<NbsRegionOption[]> {
  if (entry.geography === "National") return [NATIONAL];
  const cached = dimensionsCache.get(entry.cid);
  if (cached && Date.now() - cached.at < 6 * 60 * 60 * 1000) return cached.data;

  let treeRaw: unknown;
  try {
    treeRaw = await getJson(
      `/new/getDaCatalogTreeByIndicatorCid?indicatorCid=${encodeURIComponent(entry.cid)}`,
    );
  } catch {
    return fallbackDimensions(entry);
  }
  const tree = objectValue(treeRaw, "data");
  if (!Array.isArray(tree) || tree.length === 0) return fallbackDimensions(entry);
  const preferred = tree.find((item) => stringValue(item, "name").includes("全部")) ?? tree[0];
  const daCid = stringValue(preferred, "_id");
  if (!daCid) return fallbackDimensions(entry);

  let regionsRaw: unknown;
  try {
    regionsRaw = await getJson(`/new/getDasByDaCatalogId?daCid=${encodeURIComponent(daCid)}`);
  } catch {
    return fallbackDimensions(entry);
  }
  const regions = objectValue(regionsRaw, "data");
  if (!Array.isArray(regions)) return fallbackDimensions(entry);
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

export function transformPoints(points: SeriesPoint[], transform: NbsTransform, frequency: NbsCatalogEntry["frequency"]): SeriesPoint[] {
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

export function transformLabel(transform: NbsTransform): string {
  if (transform === "change") return "Change";
  if (transform === "percent_change") return "Percent change";
  if (transform === "yoy") return "Percent change from year ago";
  if (transform === "index_growth") return "Percent change from year ago";
  return "Raw value";
}

export function defaultNbsTransform(entry: NbsCatalogEntry): NbsTransform {
  return /上年(?:同期)?\s*=\s*100/.test(`${entry.name} ${entry.shortName}`) ? "index_growth" : "raw";
}

// ── Observations ──────────────────────────────────────────────────────────────
//
// Every catalog series is served from the local store. A first view fetches
// the full available history from NBS, writes it, and serves it; later views
// read the stored copy until it is older than the TTL, when one live fetch
// refreshes it and any revised value lands as a new row. The daily ingest
// refreshes everything that has ever been viewed, so cost scales with use
// rather than with the size of the catalog.
//
// Only raw values are stored. Transforms are applied on the way out, so a
// series has one revision history rather than one per transform.

const STORE_TTL_MS = Number(process.env.NBS_STORE_TTL_HOURS ?? 24) * 60 * 60 * 1000;
// Fetch fifty years, which is effectively "everything" NBS has, so that any
// requested limit is then a slice of the stored copy. It has to be expressed
// per frequency: 600 periods is fifty years of months, but asked of a
// quarterly series it is 1876 onward and esData answers with HTTP 500.
function historyLimit(frequency: NbsCatalogEntry["frequency"]): number {
  if (frequency === "Monthly") return 600;
  if (frequency === "Quarterly") return 200;
  return 80;
}

/**
 * Turn one esData response into raw points for a single indicator and region.
 * NBS returns every value as a string and marks a missing cell with "", so an
 * empty string is skipped rather than parsed — the alternative is a false
 * zero. Values tagged with another region's `da` are ignored, which is what
 * stops a province request from being quietly answered with national figures.
 */
export function parseEsDataPoints(raw: unknown, indicatorId: string, regionValue: string): SeriesPoint[] {
  const periods = objectValue(raw, "data");
  const points: SeriesPoint[] = [];
  if (!Array.isArray(periods)) return points;
  for (const period of periods) {
    const code = stringValue(period, "code");
    const values = objectValue(period, "values");
    if (!code || !Array.isArray(values)) continue;
    const found = values.find((value) =>
      stringValue(value, "_id") === indicatorId &&
      (!stringValue(value, "da") || stringValue(value, "da") === regionValue)
    );
    const rawValue = objectValue(found, "value");
    if (rawValue === "" || rawValue === null || rawValue === undefined) continue;
    const value = typeof rawValue === "number" ? rawValue : Number(rawValue);
    if (!Number.isFinite(value)) continue;
    points.push({ date: periodLabel(code), value });
  }
  points.sort((a, b) => a.date.localeCompare(b.date));
  return points;
}

async function fetchNbsRawPoints(entry: NbsCatalogEntry, region: NbsRegionOption): Promise<SeriesPoint[]> {
  const payload = {
    cid: entry.cid,
    indicatorIds: [entry.id],
    daCatalogId: "",
    das: [region],
    showType: "1",
    dts: [periodRange(entry.frequency, historyLimit(entry.frequency))],
    rootId: entry.rootId,
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
  return parseEsDataPoints(raw, entry.id, region.value);
}

async function resolveNbsRegion(entry: NbsCatalogEntry, regionValue?: string): Promise<NbsRegionOption> {
  const dimensions = await getNbsDimensions(entry);
  return dimensions.find((item) => item.value === regionValue) ?? dimensions[0] ?? NATIONAL;
}

function rawResult(entry: NbsCatalogEntry, region: NbsRegionOption, points: SeriesPoint[]): SeriesResult {
  return {
    key: entry.key,
    title: entry.name,
    agency: "National Bureau of Statistics",
    sourceUrl: "https://data.stats.gov.cn/dg/website/page.html",
    frequency: entry.frequency,
    unit: entry.unit || "Value",
    series: [{ label: region.text, points }],
  };
}

function storedPoints(entry: NbsCatalogEntry, region: NbsRegionOption): SeriesPoint[] {
  const stored = readSeries(entry.key, historyLimit(entry.frequency), region.value);
  return stored?.series[0]?.points ?? [];
}

function isFresh(entry: NbsCatalogEntry, region: NbsRegionOption): boolean {
  const updatedAt = seriesFreshness(entry.key, region.value);
  return updatedAt !== null && Date.now() - Date.parse(updatedAt) < STORE_TTL_MS;
}

/**
 * Fetch a series live and store it, logging the attempt either way. Zero
 * points is a failure, not an empty series: NBS answers an impossible
 * region/indicator pairing with a well-formed grid of blanks, and storing that
 * would look exactly like a successful ingest.
 */
export async function refreshNbsCatalogSeries(entry: NbsCatalogEntry, regionValue?: string): Promise<{
  region: NbsRegionOption;
  points: SeriesPoint[];
  changed: number;
}> {
  const region = await resolveNbsRegion(entry, regionValue);
  const startedAt = new Date().toISOString();
  let points: SeriesPoint[];
  try {
    points = await fetchNbsRawPoints(entry, region);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logFetch({ key: entry.key, region: region.value, startedAt, finishedAt: new Date().toISOString(),
      status: "error", points: 0, changed: 0, message });
    throw error;
  }
  const finishedAt = new Date().toISOString();
  if (points.length === 0) {
    logFetch({ key: entry.key, region: region.value, startedAt, finishedAt, status: "empty",
      points: 0, changed: 0, message: "source returned a grid with no values" });
    throw new Error(`NBS returned no observations for ${entry.key} in ${region.text}`);
  }
  const summary = writeSeries(rawResult(entry, region, points), region.value, finishedAt);
  logFetch({ key: entry.key, region: region.value, startedAt, finishedAt, status: "ok",
    points: summary.points, changed: summary.changed });
  return { region, points, changed: summary.changed };
}

/** The store-first read that every page view goes through. */
export async function getNbsCatalogSeries(options: {
  entry: NbsCatalogEntry;
  region?: string;
  limit?: number;
  transform?: NbsTransform;
}): Promise<NbsSeriesResult> {
  const limit = Math.min(historyLimit(options.entry.frequency), Math.max(2, options.limit ?? 120));
  const transform = options.transform ?? defaultNbsTransform(options.entry);
  const region = await resolveNbsRegion(options.entry, options.region);

  let points = storedPoints(options.entry, region);
  let source: NbsSeriesResult["source"] = "store";

  if (points.length === 0 || !isFresh(options.entry, region)) {
    try {
      const refreshed = await refreshNbsCatalogSeries(options.entry, region.value);
      points = refreshed.points;
      source = "live";
    } catch (error) {
      // A stale copy beats an error page; a missing copy does not.
      if (points.length === 0) throw error;
      source = "stale";
    }
  }

  // Transform over the full history, then slice, so lagged transforms keep
  // their first year instead of losing it to the limit.
  const transformed = transformPoints(points, transform, options.entry.frequency).slice(-limit);
  const unit = transform === "raw" ? options.entry.unit || "Value" : transformLabel(transform);
  return {
    ...rawResult(options.entry, region, transformed),
    unit,
    metadata: options.entry,
    region,
    transform,
    source,
    updatedAt: seriesFreshness(options.entry.key, region.value) ?? new Date().toISOString(),
  };
}
