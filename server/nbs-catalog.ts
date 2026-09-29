import { isDue } from "./due";
import { fetchJson } from "./http";
import { resolve } from "node:path";
import { stat } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { NBS_PROVINCES, type SeriesPoint, type SeriesResult } from "./data";
import { catalogPath, readCatalogSnapshot } from "./catalog-file";
import { collectedRegions, withEnglishNames } from "./regions";
import { findGeographyInQuery, findPlaceInQuery } from "../shared/places.ts";
import { isYearEarlierIndex } from "../shared/measure.ts";
import { catalogDb, db, listStoredSeries, logFetch, readSeries, seriesFreshness, seriesFullHistoryCheck, storedLatest, writeSeries } from "./db";
import { glossTitle, glossTitleDetailed, toPinyin, warmGloss, plainRanges } from "./gloss.ts";
import { resolveEnglishLabel, warmOfficialEnglish, type EnglishLabelSource } from "./official-english";
import { upstreamFetch } from "./upstream";

const API = "https://data.stats.gov.cn/dg/website/publicrelease/web/external";
const NATIONAL = { text: "全国", value: "000000000000" };
const HMT_REGIONS = [
  { text: "香港特别行政区", value: "810000000000" },
  { text: "澳门特别行政区", value: "820000000000" },
  { text: "台湾省", value: "710000000000" },
];
const SEARCH_ALIASES: Record<string, string[]> = {
  gdp: ["国内生产总值", "地区生产总值"],
  cpi: ["居民消费价格"],
  inflation: ["居民消费价格", "价格指数"], "inflation rate": ["居民消费价格指数"],
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
  investment: ["固定资产投资", "投资"],
  output: ["产量", "产值", "增加值"], make: ["产量"], makes: ["产量"], made: ["产量"], produce: ["产量"], produces: ["产量"], produced: ["产量"], manufacture: ["产量"], manufactures: ["产量"],
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
  "house prices": ["住宅销售价格", "商品房销售", "住宅销售", "商品住宅", "房价"],
  "producer prices": ["工业生产者价格"],
  "food prices": ["食品价格"],
  "trade balance": ["进出口差额", "贸易差额"],
  "provincial gdp": ["地区生产总值"],
  // The annual dataset carries the bureau's social statistics, which people ask
  // for in English words its titles do not contain.
  university: ["高等学校", "高校"],
  universities: ["高等学校", "高校"],
  college: ["高等学校", "高校"],
  colleges: ["高等学校", "高校"],
  "university students": ["高等学校在校学生", "高等教育在校学生"],
  tourism: ["国内旅游", "入境旅游", "旅游"],
  tourists: ["旅游人数", "入境游客"],
  hospitals: ["医院"],
  hospital: ["医院"],
  doctors: ["执业医师", "卫生技术人员"],
  patents: ["专利"],
  pensions: ["养老保险", "离退休"],
  "pension fund": ["养老保险基金"],
  // Common English queries a researcher types first; each maps to the NBS wording.
  "home prices": ["住宅销售价格", "商品房销售", "住宅销售", "房价"],
  "youth unemployment": ["16—24岁", "16-24岁", "青年失业"],
  "money supply": ["货币供应量"],
  "m2": ["广义货币", "M2"],
  "m1": ["狭义货币", "M1"],
  "loans": ["贷款"],
  "credit": ["贷款", "社会融资"],
  "social financing": ["社会融资"],
  "profits": ["利润"],
  "cars": ["汽车"],
  "maize": ["玉米"], "soy": ["大豆"],
  "power": ["发电量", "电力"],
  "rail": ["铁路"],
  "ports": ["港口"],
};
Object.assign(SEARCH_ALIASES, {
  youth: ["16—24岁", "16-24岁", "青年"], "youth unemployment": ["16—24岁", "16-24岁"], jobless: ["失业"], population: ["人口"],
  profits: ["利润"], profit: ["利润"], "home prices": ["住宅销售价格", "房价"], "car sales": ["汽车类商品零售", "汽车销售量"], cars: ["汽车", "轿车"],
  m2: ["广义货币", "M2"], m1: ["狭义货币", "M1"], loans: ["贷款"], deposits: ["存款"], fiscal: ["财政"], tax: ["税收"], taxes: ["税收"],
  "crude steel": ["粗钢"], aluminium: ["原铝（电解铝）产量"], aluminum: ["原铝（电解铝）产量"], copper: ["铜"], pork: ["猪肉"], vegetables: ["鲜菜"],
  rail: ["铁路"], railway: ["铁路"], aviation: ["民航"], airlines: ["民航"], tourism: ["旅游"], shipping: ["港口", "水运"], ports: ["港口"],
  ev: ["新能源汽车"], evs: ["新能源汽车"], "electric vehicles": ["新能源汽车"], robots: ["工业机器人"], chips: ["集成电路"], chip: ["集成电路"], semiconductors: ["集成电路"],
  solar: ["太阳能", "光伏"], wind: ["风电"], nuclear: ["核电"], hydro: ["水电"], "power generation": ["发电量"], smartphones: ["手机"], phones: ["手机"],
  income: ["收入"], "disposable income": ["可支配收入"], spending: ["支出", "消费"], "industrial profits": ["工业企业利润"], inventories: ["库存", "产成品"],
  "floor space": ["面积"], "housing starts": ["房地产新开工施工面积"],
  社零: ["社会消费品零售总额"], 销量: ["销售量"], 汽车销量: ["汽车销售量"], ip: ["工业增加值"],
  "aluminium output": ["原铝（电解铝）产量"], "aluminum output": ["原铝（电解铝）产量"], "primary aluminium": ["原铝"], "primary aluminum": ["原铝"],
  "air passengers": ["民航客运量"], "air travel": ["民航客运量"], "airline passengers": ["民航客运量"], airline: ["民航"], completions: ["竣工面积"], "home sales": ["商品房销售"],
  united: ["us", "美国"], states: ["us", "美国"], usa: ["us", "美国"], america: ["us", "美国"], american: ["us", "美国"],
  // Core CPI is published as "CPI excluding food and energy".
  "core inflation": ["不包括食品和能源"], "core cpi": ["不包括食品和能源"], core: ["不包括食品和能源"],
  auto: ["汽车"], autos: ["汽车"], automobile: ["汽车"], automobiles: ["汽车"], vehicle: ["汽车"], vehicles: ["汽车"],
  semiconductor: ["集成电路"], "solar panels": ["太阳能电池"], "solar panel": ["太阳能电池"], "solar cells": ["太阳能电池"], pv: ["光伏"],
  // Common Chinese abbreviations.
  "固投": ["固定资产投资"], "社融": ["社会融资规模"], "规上": ["规模以上"],
  // Year-on-year phrasings.
  yoy: ["同比"], "y/y": ["同比"], "year on year": ["同比"], "year over year": ["同比"],
});
// Words that carry no signal for a series: the country itself and English function words ("exports to the united states").
export const SEARCH_STOP_WORDS = new Set(["china", "chinese", "national", "nbs", "data", "series", "the", "of", "to", "in", "for", "and", "a", "an", "by", "from", "how", "many", "much", "does", "do", "is", "are", "was", "what", "which"]);

export type NbsTransform = "raw" | "change" | "percent_change" | "yoy" | "index_growth";

export interface NbsFamily { head: string; members: string[]; span: string; }

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
  geography: "National" | "Province" | "City" | "Hong Kong, Macao & Taiwan" | "International";
  categories: string[];
  /** English gloss of the title (see gloss.ts); the Chinese stays authoritative. */
  nameEn?: string;
  /** Distinguishes an audited NBS label from our generated fallback. */
  nameEnSource?: EnglishLabelSource;
  /** The generated gloss kept beside an official title, so search still finds the words readers use ("maize", "eggs"). */
  glossEn?: string;
  nameEnSourceUrl?: string;
  nameEnCapturedAt?: string;
  /**
   * NBS publishes some tables in year-range slices ("(-2015)", "(2016-2020)",
   * "(2026-)") that are the same series. Members of such a family carry it
   * here; search shows only the head (the newest slice) and a series request
   * for any member returns the slices stitched together.
   */
  family?: NbsFamily;
  /** Set on a served series whose February points came from the year-to-date sibling of the same table (the combined January-February figure). */
  februaryFrom?: string;
  /** The growth series NBS publishes for the same table, when this series is a level. */
  growthSibling?: { key: string; name: string };
  /** The stored history's first and last periods, attached at search time; absent until the series is stored. */
  firstPeriod?: string;
  lastPeriod?: string;
  /** English for the prose fields, from catalog/notes-en.json (translate-notes.ts). */
  noteEn?: string;
  annotationEn?: string;
  datasetEn?: string;
  categoriesEn?: string[];
  legacyDatabase?: string;
  legacyIndicatorCode?: string;
  /** Toneless pinyin of the short name, for search. */
  pinyin?: string;
}

export interface NbsRegionOption {
  text: string;
  value: string;
  /** English name, where the site knows one for this place. */
  en?: string;
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

let snapshotCache: { version: string; snapshot: CatalogSnapshot } | undefined;
// Key and bureau id to entry, built once per snapshot. A linear scan per lookup
// was tolerable over fifteen thousand entries; the ingest looks one up for
// every stored series on every run, and the catalog is now far larger than that.
let entryIndex: { version: string; byKey: Map<string, NbsCatalogEntry> } | undefined;
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
  return value === "National" || value === "Province" || value === "City" || value === "Hong Kong, Macao & Taiwan" || value === "International";
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

const GLOSS_FILE = resolve(import.meta.dir, "../catalog/gloss-en.json");
const OFFICIAL_FILE = resolve(import.meta.dir, "../catalog/nbs-official-en.json.gz");
const NOTES_FILE = resolve(import.meta.dir, "../catalog/notes-en.json");

/** A version for the stored catalog: the snapshot and the two label files. */
const GLOSS_FORMAT = 31; // 31: "labor force", American spelling. 30 (29): a fixed base year reads "2010 = 100", taken from the Chinese name when the gloss has none, and 23 untranslated international and procuratorate titles are translated in the gloss table. 28: a gloss that had to romanise part of the name is not used as the title; the Chinese name leads and the gloss stays for search. 27: a title is prefixed with its table only when it sits under two tables among family heads, so vintage slices never count as tables. 26: fullwidth brackets and run-on commas in official labels are normalised. 25: an official label with no letter in it fails safe to the gloss and zero-width characters are stripped. 24: official NBS English titles with the generated gloss kept beside them for search (23: the token dictionary grew and pinyin stands in for what it cannot render (22: only same-frequency duplicates are qualified, and an acronym keeps its capitals (21: 21: a qualifier the table already carries is not repeated in the title (20: 20: a shared title leads with its table's English name, and keeps the plain gloss when the table has no English name (19: a title shared by several tables says which table it is from (18: year ranges read "(to 2023)" and "(2024-present)", no en dashes (17: the word after any colon reads lowercase, industry prefixes included (16: an index base inside a gloss moves to the end in the site's words (15: suffix-form index titles fold to "PPI: x" and components read lowercase; (14: a row's title unit wins over the table unit; (13: spelled-out index components fold to "PPI: tea"; (12: by-department PPI titles read "PPI: food industry" (11: 增减 titles read "change from a year ago, %"; 10: index component titles use the colon form, PPI: food)
let versionCache: { at: number; version: string } | undefined;
const VERSION_TTL_MS = 5_000;

/**
 * A file's part of the catalog version: a hash of its bytes, not its
 * modification time.
 *
 * The version is the key to the catalog cache on the volume, and it used to be
 * built from each file's mtime. Every Docker build copies these files into the
 * image with a fresh mtime whenever the layer is rebuilt — which is nearly
 * every code change, since `COPY catalog` sits after `COPY server` — so the
 * key changed on nearly every deploy while the bytes never did. The cache was
 * thrown away and the catalog rebuilt from scratch: 178 and 189 seconds on the
 * deployed instance, against a 180-second healthcheck, which is how three
 * deploys failed in one day. A docs-only commit kept the layer cached, kept
 * the old mtime, and warmed in 51 seconds. The key was Docker cache luck.
 *
 * Hashing the bytes gives the same version to the same file wherever and
 * whenever it was copied. The stat stays as a change detector, so a file
 * replaced at runtime (the sync scripts do this) is still noticed without
 * re-hashing seventeen megabytes on every lookup.
 */
const fingerprints = new Map<string, { stamp: string; hash: string }>();

async function fileFingerprint(path: string): Promise<string> {
  let stamp: string;
  try { const info = await stat(path); stamp = `${info.mtimeMs}:${info.size}`; } catch { return "-"; }
  const known = fingerprints.get(path);
  if (known && known.stamp === stamp) return known.hash;
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(await Bun.file(path).arrayBuffer());
  const hash = hasher.digest("hex").slice(0, 24);
  fingerprints.set(path, { stamp, hash });
  return hash;
}

/** The version of a set of files by content, for the cache key and for the test that pins it. */
export async function contentVersionOf(paths: string[], format: string | number): Promise<string> {
  const parts = await Promise.all(paths.map(fileFingerprint));
  // GLOSS_FORMAT bumps when glossTitle's output shape changes, so stored glosses rebuild.
  return [...parts, `gloss-format:${format}`].join("|");
}

async function catalogVersion(): Promise<string> {
  // Every catalog lookup asks, and an ingest run looks up one entry per stored
  // series; holding the answer for a few seconds keeps "the snapshot file
  // changed" working at the cost of four stats per five seconds.
  const now = Date.now();
  if (versionCache && now - versionCache.at < VERSION_TTL_MS) return versionCache.version;
  const version = await contentVersionOf([catalogPath(), GLOSS_FILE, OFFICIAL_FILE, NOTES_FILE], GLOSS_FORMAT);
  versionCache = { at: now, version };
  return version;
}

function isLabelSource(value: unknown): value is EnglishLabelSource {
  return value === "nbs-official" || value === "generated" || value === "unavailable";
}

/** Rebuild a stored entry: validate the fixed fields, then carry the derived ones. */
function reviveEntry(raw: unknown): NbsCatalogEntry | null {
  const base = parseEntry(raw);
  if (!base) return null;
  const source = objectValue(raw, "nameEnSource");
  return {
    ...base,
    nameEn: stringValue(raw, "nameEn") || undefined,
    nameEnSource: isLabelSource(source) ? source : undefined,
    nameEnSourceUrl: stringValue(raw, "nameEnSourceUrl") || undefined,
    glossEn: stringValue(raw, "glossEn") || undefined,
    family: reviveFamily(objectValue(raw, "family")),
    noteEn: stringValue(raw, "noteEn") || undefined,
    annotationEn: stringValue(raw, "annotationEn") || undefined,
    datasetEn: stringValue(raw, "datasetEn") || undefined,
    categoriesEn: Array.isArray(objectValue(raw, "categoriesEn")) ? listOfStrings(objectValue(raw, "categoriesEn")) : undefined,
    pinyin: stringValue(raw, "pinyin") || undefined,
  };
}

function reviveFamily(raw: unknown): NbsFamily | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const head = stringValue(raw, "head"), span = stringValue(raw, "span");
  const members = listOfStrings(objectValue(raw, "members"));
  return head && members.length > 1 ? { head, members, span } : undefined;
}

/** The year-range suffix NBS puts on a sliced table's category: (2016-2020), (-2015), (2026-), (2021-至今). */
const SLICE_SUFFIX = /\s*[（(]\s*(?:(\d{4})\s*[-–]\s*(\d{4})|[-–]\s*(\d{4})|(\d{4})\s*[-–]\s*(?:至今)?)\s*[)）]\s*$/;

function sliceRange(category: string): { base: string; start: number; end: number } | null {
  const match = category.match(SLICE_SUFFIX);
  if (!match) return null;
  const [, a, b, onlyEnd, onlyStart] = match;
  const start = a ? Number(a) : onlyStart ? Number(onlyStart) : Number.NEGATIVE_INFINITY;
  const end = b ? Number(b) : onlyEnd ? Number(onlyEnd) : Number.POSITIVE_INFINITY;
  return { base: category.replace(SLICE_SUFFIX, "").trim(), start, end };
}

/**
 * The PMI sub-indexes have the same name in the manufacturing and the
 * non-manufacturing table ("New orders index" twice) and one of them,
 * "Producer price index", reads as the PPI. Their English titles carry the
 * table, the way CPI components read "CPI: pork".
 */
const PMI_TABLES: Record<string, string> = { "制造业采购经理指数": "Manufacturing PMI", "非制造业采购经理指数": "Non-manufacturing PMI" };
export function tableQualifiedTitle(entry: Pick<NbsCatalogEntry, "categories" | "nameEn">): string | undefined {
  const title = entry.nameEn;
  if (!title || entry.categories[0] !== "采购经理指数") return title;
  const table = PMI_TABLES[entry.categories[1] ?? ""];
  if (!table || /\bPMI\b/.test(title)) return title;
  return `${table}: ${title.charAt(0).toLocaleLowerCase()}${title.slice(1)}`;
}

/**
 * Tell apart series the bureau gives the same name.
 *
 * The same indicator name appears in several tables — 人口数 (人口抽样调查) is
 * published by household registration status, by age composition, and on its
 * own — and in a catalog of this size a search returns them as three identical
 * rows. Where a title is shared, the table it comes from is added to it, which
 * is the distinction the bureau itself is drawing. A title already unique is
 * left exactly as it was.
 *
 * Entries that share both a title and a table are left alone: those are the
 * same series published for several places, and the place is shown separately.
 */
export function qualifyDuplicateTitles(entries: NbsCatalogEntry[]): NbsCatalogEntry[] {
  // Keyed by title and frequency: the annual dataset publishes a yearly
  // counterpart of most monthly series under the same name, and the frequency
  // is already on every result row, so saying which table those came from adds
  // length without telling anyone anything. Two tables at the same frequency
  // are the case this is for.
  const seen = new Map<string, Set<string>>();
  // The English name of the table only. A Chinese table name inside an English
  // title reads as a mistake, and such a table is usually the title over again,
  // so a table with no gloss is better left off.
  // The year-range a sliced table carries in its name is a vintage marker, not part of the table's name.
  const tableOf = (entry: NbsCatalogEntry) => (entry.categoriesEn?.at(-1) ?? "").replace(SLICE_SUFFIX, "").trim();
  for (const entry of entries) {
    // Year-range slices of one series are one series: their tables, named
    // by vintage, must not count as different tables carrying one title.
    if (entry.family && entry.family.head !== entry.key) continue;
    const key = `${entry.nameEn || entry.name}|${entry.frequency}`;
    const tables = seen.get(key) ?? new Set<string>();
    tables.add(tableOf(entry));
    seen.set(key, tables);
  }
  return entries.map((entry) => {
    const title = entry.nameEn || entry.name;
    const table = tableOf(entry);
    if (!table || (seen.get(`${title}|${entry.frequency}`)?.size ?? 0) < 2) return entry;
    // A table whose name the title already carries adds nothing; a table name
    // that carries the title adds the words that tell the two apart.
    if (title.includes(table)) return entry;
    // The table leads, as it does for the PMI tables. A qualifier the table
    // already carries is dropped from the title rather than said twice:
    // "Population by household registration status (population sample survey):
    // population".
    const parenthetical = title.match(/\s*\(([^()]*)\)\s*$/);
    const short = parenthetical && parenthetical[1] && table.includes(parenthetical[1])
      ? title.slice(0, parenthetical.index).trim()
      : title;
    // "CPI" keeps its capitals; an ordinary word does not start a clause.
    const opens = /^[A-Z]{2,}\b/.test(short) ? short : `${short.charAt(0).toLocaleLowerCase()}${short.slice(1)}`;
    return { ...entry, nameEn: `${table}: ${opens}` };
  });
}

/** Group year-range slices of the same table into families; returns the entries with `family` set on members. */
export function attachFamilies(entries: NbsCatalogEntry[]): NbsCatalogEntry[] {
  const groups = new Map<string, { entry: NbsCatalogEntry; start: number; end: number }[]>();
  for (const entry of entries) {
    // The slice can sit on any level of the path: "CPI (2016-2020)" on the table itself, or
    // "Industrial enterprises by industry (2003-2011) > Net interest expenditure" one level up.
    // The deepest sliced level is the one that splits the table.
    let depth = -1, range: ReturnType<typeof sliceRange> = null;
    for (let index = entry.categories.length - 1; index >= 0 && !range; index -= 1) {
      const candidate = entry.categories[index];
      range = candidate ? sliceRange(candidate) : null;
      if (range) depth = index;
    }
    if (!range) continue;
    // The unit is left out: an older slice sometimes carries "无" where the newer says "%".
    const path = entry.categories.map((category, index) => (index === depth ? range?.base ?? category : category));
    // NBS renamed the sub-industry PPI lines between slices, dropping the trailing 业 of the
    // industry ("焙烤食品制造业" became "焙烤食品制造"); the two spellings are one series.
    const name = entry.name.replace("业工业生产者", "工业生产者");
    const key = JSON.stringify([name, entry.frequency, entry.geography, path]);
    groups.set(key, [...(groups.get(key) ?? []), { entry, start: range.start, end: range.end }]);
  }
  const families = new Map<string, NbsFamily>();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    members.sort((a, b) => a.start - b.start || a.end - b.end);
    const first = members[0], last = members[members.length - 1];
    if (!first || !last) continue;
    // "2016 to present", or "all years to present" when the oldest slice is open at the start.
    const from = Number.isFinite(first.start) ? String(first.start) : "all years";
    const to = Number.isFinite(last.end) ? String(last.end) : "present";
    const family: NbsFamily = { head: last.entry.key, members: members.map((member) => member.entry.key), span: `${from} to ${to}` };
    for (const member of members) families.set(member.entry.key, family);
  }
  return entries.map((entry) => { const family = families.get(entry.key); return family ? { ...entry, family } : entry; });
}

/** Join year-range slices into one history; a later slice wins where two overlap. */
/**
 * NBS fills the months before an indicator existed with "0.0" and no flag: the
 * 2012-2017 table carries operating revenue as 0.0 from April to December 2016
 * and real figures from 2017, and a PPI on a year-earlier base reads 0 for
 * 2014-2015 (an index can never be 0). A leading run of zeros before the first
 * non-zero value is dropped from a level or index series; a rate keeps its
 * zeros, which can be real, and an all-zero series is left as it came.
 */
export function isRateEntry(entry: Pick<NbsCatalogEntry, "unit" | "name">): boolean {
  const unit = entry.unit.trim();
  return unit === "%" || unit === "百分点" || (unit === "无" && !/=\s*100/.test(entry.name));
}

/**
 * A rate can really be 0.0, so a rate series sheds its leading zeros only when the run is
 * this long: every industry operating-revenue growth series in the 2012-2017 table opens
 * with nine (April to December 2016), and six periods of exactly 0.0 growth at the start of
 * a real series does not happen.
 */
export const RATE_PLACEHOLDER_RUN = 6;

export function dropLeadingPlaceholders(points: SeriesPoint[], entry: Pick<NbsCatalogEntry, "unit" | "name">): SeriesPoint[] {
  const firstReal = points.findIndex((point) => point.value !== 0);
  if (firstReal <= 0) return points;
  if (isRateEntry(entry) && firstReal < RATE_PLACEHOLDER_RUN) return points;
  return points.slice(firstReal);
}

/** Whole periods from one label to a later one at the series' frequency: "2016-04" to "2017-02" monthly is 10. */
export function periodsBetween(from: string, to: string, frequency: string): number {
  const parse = (label: string): number => {
    const year = Number(label.slice(0, 4));
    if (frequency === "Quarterly") return year * 4 + (Number(label.match(/Q(\d)/)?.[1] ?? (Math.ceil(Number(label.slice(5, 7)) / 3) || 1)) - 1);
    if (frequency === "Monthly") return year * 12 + (Number(label.slice(5, 7)) || 1) - 1;
    return year;
  };
  return parse(to) - parse(from);
}

export function stitchPoints(slices: SeriesPoint[][]): SeriesPoint[] {
  const byDate = new Map<string, SeriesPoint>();
  for (const slice of slices) for (const point of slice) byDate.set(point.date, point);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function listOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** The prose translation table; absent until translate-notes.ts has run. */
async function readNotesTable(): Promise<Record<string, string>> {
  try {
    const raw: unknown = await Bun.file(NOTES_FILE).json();
    if (typeof raw !== "object" || raw === null) return {};
    return Object.fromEntries(Object.entries(raw).filter((pair): pair is [string, string] => typeof pair[1] === "string"));
  } catch { return {}; }
}

/** Attach English prose to an entry where the table has it. Categories are translated segment by segment. */
function withProseEnglish(entry: NbsCatalogEntry, table: Record<string, string>): NbsCatalogEntry {
  const categoriesEn = entry.categories.map((category) => plainRanges(table[category.trim()] ?? ""));
  return {
    ...entry,
    nameEn: entry.nameEn ? plainRanges(entry.nameEn) : entry.nameEn,
    // An index table's "无" unit becomes its base period everywhere the unit is shown.
    unit: rawUnitOf(entry),
    noteEn: table[entry.note.trim()] || undefined,
    annotationEn: table[entry.annotation.trim()] || undefined,
    datasetEn: table[entry.dataset.trim()] || undefined,
    categoriesEn: categoriesEn.some(Boolean) ? categoriesEn : undefined,
  };
}

function readStoredCatalog(version: string): CatalogSnapshot | null {
  const meta = catalogDb().query<{ version: string; generatedAt: string; source: string }, []>(
    "SELECT version, generated_at AS generatedAt, source FROM catalog_meta WHERE id = 1",
  ).get();
  if (!meta || meta.version !== version) return null;
  const rows = catalogDb().query<{ entry: string }, []>("SELECT entry FROM catalog").all();
  const entries: NbsCatalogEntry[] = [];
  for (const row of rows) {
    try { const entry = reviveEntry(JSON.parse(row.entry)); if (entry) entries.push(entry); } catch { /* skip a corrupt row */ }
  }
  if (entries.length === 0) return null;
  return { generatedAt: meta.generatedAt, source: meta.source, entries };
}

function writeStoredCatalog(snapshot: CatalogSnapshot, version: string): void {
  const database = catalogDb();
  const insertEntry = database.prepare("INSERT INTO catalog (key, entry) VALUES (?, ?)");
  const insertText = database.prepare("INSERT INTO catalog_fts (key, name, name_en, short, path, py) VALUES (?, ?, ?, ?, ?, ?)");
  database.transaction((entries: NbsCatalogEntry[]) => {
    database.exec("DELETE FROM catalog");
    database.exec("DELETE FROM catalog_fts");
    for (const entry of entries) {
      insertEntry.run(entry.key, JSON.stringify(entry));
      insertText.run(entry.key, entry.name, [entry.nameEn ?? "", entry.glossEn ?? ""].filter(Boolean).join(" "), entry.shortName, entry.categories.join(" "), entry.pinyin ?? "");
    }
    database.query("INSERT OR REPLACE INTO catalog_meta (id, version, generated_at, source, loaded_at) VALUES (1, ?, ?, ?, ?)")
      .run(version, snapshot.generatedAt, snapshot.source, new Date().toISOString());
  })(snapshot.entries);
}

async function loadSnapshot(): Promise<CatalogSnapshot> {
  const version = await catalogVersion();
  if (snapshotCache?.version === version) return snapshotCache.snapshot;
  if (!snapshotPromise) {
    snapshotPromise = (async () => {
      // Fast path: the database already holds this version of the catalog.
      const stored = readStoredCatalog(version);
      if (stored) {
        snapshotCache = { version, snapshot: stored };
        return stored;
      }
      // Slow path: parse the snapshot, gloss it, and store the result.
      const raw: unknown = await readCatalogSnapshot();
      const entriesRaw = objectValue(raw, "entries");
      if (!Array.isArray(entriesRaw)) throw new Error("NBS catalog is missing; run the catalog sync script");
      const [, , notesTable] = await Promise.all([warmGloss(), warmOfficialEnglish(), readNotesTable()]);
      const entries = entriesRaw.map(parseEntry).filter((entry): entry is NbsCatalogEntry => entry !== null)
        .map((entry) => {
          const spaced = toPinyin(entry.shortName);
          const { text: gloss, romanised } = glossTitleDetailed(entry.name);
          // A romanised gloss is not offered as the title: with no official
          // English the page leads with the Chinese name instead. It is kept for search.
          const english = resolveEnglishLabel(entry.key, entry.name, romanised ? "" : gloss);
          const labelled = { ...entry, ...english, ...(english.nameEnSource !== "generated" && gloss ? { glossEn: gloss } : {}), pinyin: `${spaced} ${spaced.replaceAll(" ", "")}` };
          return withProseEnglish({ ...labelled, nameEn: tableQualifiedTitle(labelled) }, notesTable);
        });
      const stitched = qualifyDuplicateTitles(attachFamilies(entries));
      const snapshot = {
        generatedAt: stringValue(raw, "generatedAt"),
        source: stringValue(raw, "source"),
        entries: stitched,
      };
      writeStoredCatalog(snapshot, version);
      snapshotCache = { version, snapshot };
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
  // Categories are counted within each dataset as well as across all of them:
  // the bureau's three-economies table has an "unemployment rate" heading of
  // its own, and counted across datasets it stood beside China's as a card
  // of one series.
  const datasets = new Map<number, { code: number; name: string; frequency: string; geography: string; count: number; categories: Map<string, number> }>();
  // Counts describe what a visitor can reach: one series per family, not one per year-range slice.
  const visible = snapshot.entries.filter((entry) => !entry.family || entry.family.head === entry.key);
  for (const entry of visible) {
    for (const category of entry.categories) categories.add(category);
    const topCategory = entry.categories[0];
    if (topCategory) categoryCounts.set(topCategory, (categoryCounts.get(topCategory) ?? 0) + 1);
    const found = datasets.get(entry.datasetCode) ?? { code: entry.datasetCode, name: entry.dataset, frequency: entry.frequency, geography: entry.geography, count: 0, categories: new Map<string, number>() };
    found.count += 1;
    if (topCategory) found.categories.set(topCategory, (found.categories.get(topCategory) ?? 0) + 1);
    datasets.set(entry.datasetCode, found);
  }
  const storedKeys = new Set(listStoredSeries("nbs_").map((row) => row.key));
  return {
    generatedAt: snapshot.generatedAt,
    seriesCount: visible.length,
    storedCount: visible.filter((entry) => storedKeys.has(entry.key)).length,
    // Titles in the bureau's own English (from its portal's English mode), as against generated ones.
    officialEnglishCount: visible.filter((entry) => entry.nameEnSource === "nbs-official").length,
    categoryCount: categories.size,
    categories: [...categoryCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    datasets: [...datasets.values()].sort((a, b) => a.code - b.code).map((dataset) => ({
      ...dataset,
      categories: [...dataset.categories.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    })),
  };
}

// ── Full-text index ───────────────────────────────────────────────────────────
//
// An in-memory FTS5 table over the Chinese title, the English gloss, the
// category path and the pinyin, with a trigram tokenizer so Chinese
// substrings and English words share one index. Trigrams need three
// characters, so two-character Chinese terms fall through to the substring
// scorer below — which is why both exist.

/** Keys matching any of the terms, with a 0–10 relevance from bm25. */
function fullTextCandidates(terms: string[]): Map<string, number> {
  const usable = terms.map((term) => term.trim()).filter((term) => term.length >= 3 && !term.includes('"'));
  const out = new Map<string, number>();
  if (usable.length === 0) return out;
  const match = usable.map((term) => `"${term}"`).join(" OR ");
  try {
    const rows = catalogDb().query<{ key: string; rank: number }, string>("SELECT key, bm25(catalog_fts, 0, 3, 2, 2, 1, 2) AS rank FROM catalog_fts WHERE catalog_fts MATCH ? ORDER BY rank LIMIT 5000").all(match);
    for (const row of rows) out.set(row.key, Math.min(10, Math.max(0, -row.rank)));
  } catch {
    // A malformed MATCH expression is not worth failing a search over.
  }
  return out;
}

// ── Query expansion ───────────────────────────────────────────────────────────
//
// When an English query finds almost nothing, ask Claude which Chinese terms
// would appear in matching NBS titles and search again. Cached in the store
// so each phrasing costs one call, ever.

let anthropic: Anthropic | null = null;
const EXPANSION_SYSTEM = "You map English search queries about Chinese official statistics to the Chinese terms that appear in National Bureau of Statistics indicator titles. Reply with a JSON array of 2 to 6 short Chinese terms (2-8 characters each), most specific first — for example [\"16—24岁\", \"失业率\", \"青年\"] for \"youth jobless rate\". No commentary.";

async function expandQuery(query: string): Promise<string[]> {
  // Tests and offline runs: no model calls, no surprises.
  if (process.env.NBS_QUERY_EXPANSION === "off") return [];
  const store = db();
  store.exec("CREATE TABLE IF NOT EXISTS query_expansions (query TEXT PRIMARY KEY, terms TEXT NOT NULL, created_at TEXT NOT NULL)");
  const cached = store.query<{ terms: string }, string>("SELECT terms FROM query_expansions WHERE query = ?").get(query.toLocaleLowerCase());
  if (cached) {
    try { const parsed: unknown = JSON.parse(cached.terms); if (Array.isArray(parsed)) return parsed.filter((term): term is string => typeof term === "string"); } catch { /* fall through */ }
  }
  try {
    anthropic ??= new Anthropic({ timeout: 8000, maxRetries: 0 });
    const response = await anthropic.messages.create({
      model: "claude-opus-5",
      max_tokens: 300,
      output_config: { effort: "low" },
      system: EXPANSION_SYSTEM,
      messages: [{ role: "user", content: query }],
    });
    const text = response.content.map((block) => (block.type === "text" ? block.text : "")).join("");
    const start = text.indexOf("["), end = text.lastIndexOf("]");
    const parsed: unknown = start >= 0 && end > start ? JSON.parse(text.slice(start, end + 1)) : [];
    const terms = Array.isArray(parsed) ? parsed.filter((term): term is string => typeof term === "string" && term.length >= 2).slice(0, 6) : [];
    store.query("INSERT OR REPLACE INTO query_expansions (query, terms, created_at) VALUES (?, ?, ?)").run(query.toLocaleLowerCase(), JSON.stringify(terms), new Date().toISOString());
    return terms;
  } catch {
    return [];
  }
}

/** Latin terms match on a word boundary — "house" must not hit "household". */
// One compiled expression per term, not one per term per entry. A query is
// matched against every entry in the catalog, so compiling inside that loop was
// most of the cost of a Latin search.
const termExpressions = new Map<string, RegExp>();

function termExpression(term: string): RegExp {
  const cached = termExpressions.get(term);
  if (cached) return cached;
  // A word matches its plural too: "soybean" finds "Market price of soybeans", "egg" finds "Eggs".
  const expression = new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:e?s)?(?![a-z0-9])`, "i");
  // Terms come from queries, so the set is unbounded over a long run; a few
  // thousand is far more than any page of results needs.
  if (termExpressions.size > 5_000) termExpressions.clear();
  termExpressions.set(term, expression);
  return expression;
}

function hasTerm(text: string, term: string): boolean {
  if (!/^[a-z0-9][a-z0-9 .'-]*$/i.test(term)) return text.includes(term);
  return termExpression(term).test(text);
}

/**
 * The lowercased text a search looks through, built once per entry.
 *
 * Scoring used to lowercase five fields and concatenate a haystack for every
 * entry on every query. Over sixty thousand entries that is the whole cost of a
 * search, and it is the same answer every time; the entry objects live as long
 * as the catalog snapshot does, so the work is cached against them.
 */
interface SearchText {
  name: string;
  shortName: string;
  path: string;
  nameEn: string;
  haystack: string;
  pinyinJoined: string;
}

const searchTextCache = new WeakMap<NbsCatalogEntry, SearchText>();

function searchTextOf(entry: NbsCatalogEntry): SearchText {
  const cached = searchTextCache.get(entry);
  if (cached) return cached;
  const name = entry.name.toLocaleLowerCase();
  const shortName = entry.shortName.toLocaleLowerCase();
  const path = entry.categories.join(" ").toLocaleLowerCase();
  // The official title and, beside it, the generated gloss: both are searched, only the title is shown.
  const nameEn = [entry.nameEn ?? "", entry.glossEn ?? ""].filter(Boolean).join(" ").toLocaleLowerCase();
  const pinyin = (entry.pinyin ?? "").toLocaleLowerCase();
  const text: SearchText = {
    name,
    shortName,
    path,
    nameEn,
    haystack: `${name} ${shortName} ${path} ${entry.dataset.toLocaleLowerCase()} ${nameEn} ${pinyin}`,
    pinyinJoined: pinyin.replaceAll(" ", ""),
  };
  searchTextCache.set(entry, text);
  return text;
}

function haystackOf(entry: NbsCatalogEntry): string {
  return searchTextOf(entry).haystack;
}

// ── Candidate index ───────────────────────────────────────────────────────────
//
// Scoring used to run over all 79,836 entries for every query: build the
// haystack, test every term, sort what matched. Most of that work was proving
// that an entry does *not* match. The index below answers "which entries could
// possibly score above zero for this query" from postings built once per
// snapshot, and the scorer then runs over those alone. The scorer is unchanged
// and the index is a superset of everything it can match — a test holds the
// two orderings identical over a spread of queries — so the ranking is the
// same; only the work is smaller.
//
// Three postings, all over the same lowercased haystack the scorer reads:
//   cjk    — every Chinese character and every adjacent pair, since a Chinese
//            term matches as a substring and any substring's pairs are in it;
//   words  — every run of Latin letters and digits, since a Latin term matches
//            on a word boundary (with an optional plural);
//   pinyin — every three letters of the joined pinyin, since a Latin term of
//            three letters or more also matches as a substring of it.
// A term the postings cannot express (punctuation, mixed script) makes the
// query fall back to the full scan, which is the old behaviour exactly.

interface CandidateIndex {
  cjk: Map<string, number[]>;
  words: Map<string, number[]>;
  pinyin: Map<string, number[]>;
  byKey: Map<string, number>;
}

const candidateIndexCache = new WeakMap<CatalogSnapshot, CandidateIndex>();
let candidateIndexEnabled = true;
/** For the test that holds the indexed ranking to the scanned one. */
export function setCandidateIndexEnabled(enabled: boolean): void { candidateIndexEnabled = enabled; }

const CJK_RUN = /[\u3400-\u9fff]+/g;
const WORD_RUN = /[a-z0-9]+/g;
const CJK_TERM = /^[\u3400-\u9fff]+$/;
const WORD_TERM = /^[a-z0-9]+$/;

function post(map: Map<string, number[]>, token: string, index: number): void {
  const list = map.get(token);
  if (list === undefined) map.set(token, [index]);
  else if (list[list.length - 1] !== index) list.push(index);
}

function candidateIndexOf(snapshot: CatalogSnapshot): CandidateIndex {
  const cached = candidateIndexCache.get(snapshot);
  if (cached) return cached;
  const startedAt = Date.now();
  const index: CandidateIndex = { cjk: new Map(), words: new Map(), pinyin: new Map(), byKey: new Map() };
  snapshot.entries.forEach((entry, position) => {
    index.byKey.set(entry.key, position);
    const { haystack, pinyinJoined } = searchTextOf(entry);
    for (const run of haystack.match(CJK_RUN) ?? []) {
      for (let at = 0; at < run.length; at += 1) {
        post(index.cjk, run[at]!, position);
        if (at + 1 < run.length) post(index.cjk, run.slice(at, at + 2), position);
      }
    }
    for (const word of haystack.match(WORD_RUN) ?? []) post(index.words, word, position);
    for (let at = 0; at + 3 <= pinyinJoined.length; at += 1) post(index.pinyin, pinyinJoined.slice(at, at + 3), position);
  });
  candidateIndexCache.set(snapshot, index);
  console.log(`  Search index: ${index.cjk.size} Chinese tokens, ${index.words.size} words, ${index.pinyin.size} pinyin trigrams in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  return index;
}

/** Sorted, deduplicated postings; every list in the index is already sorted by construction. */
function intersectAll(lists: number[][]): number[] {
  if (lists.length === 0) return [];
  let out = lists[0]!;
  for (const list of lists.slice(1)) {
    const next: number[] = [];
    let a = 0, b = 0;
    while (a < out.length && b < list.length) {
      if (out[a] === list[b]) { next.push(out[a]!); a += 1; b += 1; }
      else if (out[a]! < list[b]!) a += 1;
      else b += 1;
    }
    out = next;
    if (out.length === 0) break;
  }
  return out;
}

function unionAll(lists: number[][]): number[] {
  if (lists.length === 1) return lists[0]!;
  const seen = new Set<number>();
  for (const list of lists) for (const item of list) seen.add(item);
  return [...seen].sort((a, b) => a - b);
}

/** Every entry that could match one term, or null when the term is one the postings cannot express. */
function postingsFor(index: CandidateIndex, term: string): number[] | null {
  const trimmed = term.trim();
  if (!trimmed) return [];
  if (CJK_TERM.test(trimmed)) {
    if (trimmed.length === 1) return index.cjk.get(trimmed) ?? [];
    const pairs: number[][] = [];
    for (let at = 0; at + 2 <= trimmed.length; at += 1) pairs.push(index.cjk.get(trimmed.slice(at, at + 2)) ?? []);
    return intersectAll(pairs);
  }
  if (WORD_TERM.test(trimmed)) {
    // The scorer's word rule: the term, or its plural, on a boundary; a plural
    // typed against a singular; and, at three letters or more, a substring of
    // the joined pinyin.
    const bases = [trimmed];
    if (/^[a-z]{4,}s$/.test(trimmed)) bases.push(trimmed.replace(/e?s$/, ""));
    const lists: number[][] = [];
    for (const base of bases) for (const form of [base, `${base}s`, `${base}es`]) lists.push(index.words.get(form) ?? []);
    if (/^[a-z]{3,}$/.test(trimmed)) {
      const grams: number[][] = [];
      for (let at = 0; at + 3 <= trimmed.length; at += 1) grams.push(index.pinyin.get(trimmed.slice(at, at + 3)) ?? []);
      lists.push(intersectAll(grams));
    }
    return unionAll(lists);
  }
  // A phrase from the alias table ("fixed asset investment"): every word of it must be present.
  if (/\s/.test(trimmed)) {
    const parts = trimmed.split(/\s+/).map((part) => postingsFor(index, part));
    if (parts.some((part) => part === null)) return null;
    return intersectAll(parts as number[][]);
  }
  // Mixed script or punctuation ("16—24岁", "2010=100"): the scorer looks for
  // the term as a substring. Its Chinese runs are then sub-runs of the text's,
  // so their pairs are a net over it; a run of letters or digits bounded on
  // both sides by the term's own punctuation is a whole word in the text too.
  // A run at either end may be part of a longer one there and is not used.
  const cjkRuns = trimmed.match(/[\u3400-\u9fff]+/g) ?? [];
  if (cjkRuns.length > 0) {
    const lists = cjkRuns.map((run) => postingsFor(index, run) ?? []);
    for (const match of trimmed.matchAll(/[a-z0-9]+/g)) {
      const start = match.index ?? 0, end = start + match[0].length;
      if (start > 0 && end < trimmed.length) lists.push(index.words.get(match[0]) ?? []);
    }
    return intersectAll(lists);
  }
  // Latin with punctuation ("u.s."): the scorer's boundary rule means every
  // run is a whole word, and the last may carry a plural.
  if (/^[a-z0-9][a-z0-9 .'-]*$/.test(trimmed)) {
    const runs = trimmed.match(/[a-z0-9]+/g) ?? [];
    if (runs.length === 0) return null;
    return intersectAll(runs.map((run, at) => at === runs.length - 1
      ? unionAll([run, `${run}s`, `${run}es`].map((form) => index.words.get(form) ?? []))
      : (index.words.get(run) ?? [])));
  }
  return null;
}

/**
 * Build the postings at boot and run one search through them, so the first
 * visitor pays neither the five seconds of building nor the cold read of the
 * full-text table and the stored ranges from the volume.
 */
export async function warmSearchIndex(): Promise<void> {
  candidateIndexOf(await loadSnapshot());
  await searchNbsCatalog({ query: "gdp", limit: 1 });
}

/**
 * The entries a query could score above zero, as positions in the snapshot,
 * following each rule of `searchScore` in turn; null when any term falls
 * outside the postings and the query must be scanned in full.
 */
function candidatesFor(snapshot: CatalogSnapshot, query: string, extraTerms: string[], fullTextKeys: Iterable<string>): Set<number> | null {
  const index = candidateIndexOf(snapshot);
  const lowerQuery = query.toLocaleLowerCase().replace(/^nbs_/, "");
  const out = new Set<number>();
  const add = (list: number[]) => { for (const item of list) out.add(item); };
  const addTerms = (terms: string[]): boolean => {
    const lists = terms.map((term) => postingsFor(index, term));
    if (lists.some((list) => list === null)) return false;
    add(intersectAll(lists as number[][]));
    return true;
  };
  if (lowerQuery.length >= 8 && /^[0-9a-f]+$/.test(lowerQuery)) {
    snapshot.entries.forEach((entry, position) => { if (entry.id.startsWith(lowerQuery)) out.add(position); });
  }
  // The whole query, or each of its alias phrasings, with every term present.
  for (const variant of SEARCH_ALIASES[lowerQuery] ?? [lowerQuery]) {
    if (!addTerms(variant.split(/\s+/).filter(Boolean))) return null;
  }
  // Word by word, each word or any of its aliases.
  const groups = lowerQuery.split(/\s+/).filter((word) => word && !SEARCH_STOP_WORDS.has(word)).map((word) => SEARCH_ALIASES[word] ?? [word]);
  if (groups.length > 0) {
    const perGroup: number[][] = [];
    for (const group of groups) {
      const lists = group.map((term) => postingsFor(index, term));
      if (lists.some((list) => list === null)) return null;
      perGroup.push(unionAll(lists as number[][]));
    }
    add(intersectAll(perGroup));
  }
  // A Chinese phrase in one- and two-character pieces, each piece or its aliases.
  if (/^[\u3400-\u9fff]{4,}$/.test(lowerQuery)) {
    const perPiece: number[][] = [];
    for (const piece of lowerQuery.match(/[\u3400-\u9fff]{1,2}/g) ?? []) {
      const lists = [piece, ...(SEARCH_ALIASES[piece] ?? [])].map((form) => postingsFor(index, form));
      if (lists.some((list) => list === null)) return null;
      perPiece.push(unionAll(lists as number[][]));
    }
    add(intersectAll(perPiece));
  }
  // The model's expansion terms score on a prefix of two characters or more, so their first pair is the widest net.
  for (const term of extraTerms) {
    const list = postingsFor(index, term.length >= 2 ? term.slice(0, 2) : term);
    if (list === null) return null;
    add(list);
  }
  for (const key of fullTextKeys) {
    const position = index.byKey.get(key);
    if (position !== undefined) out.add(position);
  }
  return out;
}

/**
 * A Latin term hits on a word boundary in the text, or as a substring of the
 * joined pinyin — "shiyelv" sits inside "chengzhendiaochashiyelv" with no
 * boundary to find, and that is the one place a substring is the right rule.
 */
function latinTermHit(haystack: string, pinyinJoined: string, term: string): boolean {
  if (hasTerm(haystack, term)) return true;
  // The plural typed against a singular in the text: "eggs" against "egg". Three letters and under
  // ("us", "gas") keep their s.
  if (/^[a-z]{4,}s$/.test(term) && hasTerm(haystack, term.replace(/e?s$/, ""))) return true;
  return /^[a-z]{3,}$/.test(term) && pinyinJoined.includes(term);
}

/** A trigram index matches substrings; for a Latin query that is only a real hit by the rule above. */
export function indexHitIsReal(entry: NbsCatalogEntry, query: string): boolean {
  if (!/^[a-z0-9 .'-]+$/i.test(query)) return true;
  const haystack = haystackOf(entry);
  const pinyinJoined = (entry.pinyin ?? "").replaceAll(" ", "");
  return queryVariants(query).some((variant) => variant.split(/\s+/).filter(Boolean).every((term) => latinTermHit(haystack, pinyinJoined, term)));
}

/**
 * Monthly before quarterly before annual, among matches that score the same.
 *
 * The annual dataset publishes a yearly counterpart of most monthly series, so
 * without this a search for a subject returns the annual version as often as
 * the one that has a reading for last month. A subject that is only annual —
 * population, education, science — has nothing to be outranked by.
 */
function frequencyRank(entry: NbsCatalogEntry): number {
  return entry.frequency === "Monthly" ? 0 : entry.frequency === "Quarterly" ? 1 : 2;
}

function band(score: number): number { return Math.round(score / 5) * 5; }
/**
 * Tie-break length: the English title when there is one, since units inflate
 * the Chinese one ("(万吨)" vs "(%)"). A table prefix ("National consumer
 * price indices by category: ...") is context, not title, and is not counted:
 * the shorter title is the more general series, and a series does not become
 * less general by needing its table named.
 */
function titleLength(entry: NbsCatalogEntry): number {
  return (entry.nameEn ?? entry.name).replace(/^[^:：]{4,}[:：]\s+/, "").length;
}

/** 1 for an index on a previous-month base, which ranks after the year-earlier base a researcher usually means by "cpi" or "ppi food". */
function monthOnMonthBase(entry: NbsCatalogEntry): number {
  return /[（(]\s*上月\s*=\s*100\s*[)）]/.test(entry.name) ? 1 : 0;
}

export function searchScore(entry: NbsCatalogEntry, query: string): number {
  if (!query) return 1;
  const { name, shortName, path, nameEn, haystack, pinyinJoined } = searchTextOf(entry);
  const lowerQuery = query.toLocaleLowerCase().replace(/^nbs_/, "");
  // An ID is only a match when enough of it is typed to be one — otherwise
  // any two-character query lights up random hashes.
  if (lowerQuery.length >= 8 && /^[0-9a-f]+$/.test(lowerQuery) && entry.id.startsWith(lowerQuery)) return 500;
  const exactAliases = SEARCH_ALIASES[lowerQuery];
  const variants = exactAliases ?? [lowerQuery];
  let bestScore = 0;
  for (const [variantIndex, variant] of variants.entries()) {
    const terms = variant.split(/\s+/).filter(Boolean);
    if (!terms.every((term) => latinTermHit(haystack, pinyinJoined, term))) continue;
    // The first phrasing in a word's alias list is its primary meaning ("investment" is 固定资产投资
    // before it is any 投资), so a hit on it edges out a hit on a later one that the shorter-title
    // tie-break would otherwise favour.
    let score = 10 + (variantIndex === 0 && variants.length > 1 ? 5 : 0);
    if (name === variant || nameEn === variant) score += 100;
    if (name.startsWith(variant) || nameEn.startsWith(variant)) score += 40;
    if (name.includes(variant) || nameEn.includes(variant)) score += 30;
    if (shortName.includes(variant)) score += 20;
    if (path.includes(variant)) score += 5;
    bestScore = Math.max(bestScore, score);
  }

  // Word by word through the dictionary; a title hit per word counts more
  // than a hit anywhere.
  const tokenGroups = lowerQuery.split(/\s+/)
    .filter((word) => word && !SEARCH_STOP_WORDS.has(word))
    .map((word) => SEARCH_ALIASES[word] ?? [word]);
  if (tokenGroups.length > 0 && tokenGroups.every((group) => group.some((term) => latinTermHit(haystack, pinyinJoined, term)))) {
    const titleMatches = tokenGroups.filter((group) => group.some((term) => hasTerm(name, term) || hasTerm(nameEn, term))).length;
    // A title that opens with the query's leading concept ("汽车产量" for "cars make") edges out one
    // that merely contains it ("载货汽车产量", truck output), which the shorter-title tie-break would favour.
    const leading = tokenGroups[0]?.some((term) => name.startsWith(term) || nameEn.startsWith(term)) ? 5 : 0;
    bestScore = Math.max(bestScore, 10 + titleMatches * 20 + leading);
  }
  // A Chinese phrase that appears nowhere whole ("猪肉价格") still matches when each of its
  // two-character pieces does: 猪肉 and 价格 both sit in 猪肉居民消费价格指数. Scored below a
  // whole-phrase hit so the exact titles keep the top.
  if (bestScore === 0 && /^[\u3400-\u9fff]{4,}$/.test(lowerQuery)) {
    const pieces = lowerQuery.match(/[\u3400-\u9fff]{1,2}/g) ?? [];
    // Each piece may also hit through the dictionary: 销量 in "汽车销量" means 销售量, which is how NBS titles sales.
    const forms = (piece: string): string[] => [piece, ...(SEARCH_ALIASES[piece] ?? [])];
    if (pieces.every((piece) => forms(piece).some((term) => haystack.includes(term)))) {
      // Always below 10, the least any whole-phrase hit scores, so a near-variant with every
      // piece in its title never outranks the title that carries the phrase itself.
      const inTitle = pieces.filter((piece) => forms(piece).some((term) => name.includes(term))).length;
      bestScore = 4 + Math.min(0.9, inTitle * 0.1);
    }
  }
  return bestScore;
}

/** 1 for a whole-term hit, 0.7 for a prefix of at least two characters, 0 otherwise. */
function termHit(name: string, term: string): number {
  if (name.includes(term)) return 1;
  for (let length = term.length - 1; length >= 2; length -= 1) if (name.includes(term.slice(0, length))) return 0.7;
  return 0;
}

/**
 * A query as the matchers see it: lower-cased, a hyphen between letters
 * turned into a space ("fixed-asset investment" is the alias "fixed asset
 * investment"; "16-24" and hex ids keep theirs), whitespace collapsed.
 */
/**
 * Scope qualifiers NBS states in a table's annotation rather than in any title: a reader types
 * 规模以上工业增加值, the title is 工业增加值, and every series in those tables is above designated
 * size anyway. Dropped from a query so the concept still matches.
 */
const QUERY_SCOPE_QUALIFIERS = ["规模以上", "限额以上", "全国"];

export function normalizeQuery(query: string): string {
  let out = query.toLocaleLowerCase().replace(/(?<=[a-z])-(?=[a-z])/g, " ").replace(/\s+/g, " ").trim();
  for (const qualifier of QUERY_SCOPE_QUALIFIERS) {
    // Only where something is left to search for: "全国" alone is a real query for the national total.
    if (out.startsWith(qualifier) && out.length > qualifier.length) out = out.slice(qualifier.length).trim();
  }
  return out;
}

/**
 * Every phrasing the dictionary offers for a query, plus the query itself.
 *
 * Phrases are looked up as well as single words, because the useful entries
 * are phrases: "home prices" is 住宅销售价格, while "home" and "prices" apart
 * are 房地产 and 价格 and find the wrong tables. A query the dictionary knows
 * in full still wins; "shenzhen new home prices" reaches the sales price index
 * through its "home prices" phrase.
 */
export function queryVariants(query: string): string[] {
  const lower = query.toLocaleLowerCase();
  const direct = SEARCH_ALIASES[lower] ?? [];
  const words = lower.split(/\s+/).filter((word) => word && !SEARCH_STOP_WORDS.has(word));
  const phrases: string[] = [];
  for (let size = Math.min(4, words.length); size >= 2; size -= 1) {
    for (let at = 0; at + size <= words.length; at += 1) phrases.push(words.slice(at, at + size).join(" "));
  }
  const fromPhrases = phrases.flatMap((phrase) => SEARCH_ALIASES[phrase] ?? []);
  const perWord = words.flatMap((word) => SEARCH_ALIASES[word] ?? []);
  return [...new Set([lower, ...direct, ...fromPhrases, ...perWord])];
}

// The stored range per series, refreshed every ten minutes: search ranks
// current series above discontinued ones and shows each result's span.
let rangeCache: { at: number; ranges: Map<string, { first: string; firstReal: string; last: string }> } | null = null;
function storedRanges(): Map<string, { first: string; firstReal: string; last: string }> {
  if (rangeCache && Date.now() - rangeCache.at < 10 * 60 * 1000) return rangeCache.ranges;
  const ranges = new Map<string, { first: string; firstReal: string; last: string }>();
  // A provincial, city or international series is stored one region at a time; its range is the
  // widest any region holds. Reading the nation alone left every such series looking unpublished.
  for (const row of storedLatest("nbs_")) {
    if (!row.firstPeriod || !row.lastPeriod) continue;
    const held = ranges.get(row.key);
    const own = { first: row.firstPeriod, firstReal: row.firstRealPeriod ?? row.firstPeriod, last: row.lastPeriod };
    if (!held || row.region === "000000000000") { ranges.set(row.key, held && row.region === "000000000000" ? own : held ? { first: own.first < held.first ? own.first : held.first, firstReal: own.firstReal < held.firstReal ? own.firstReal : held.firstReal, last: own.last > held.last ? own.last : held.last } : own); continue; }
    ranges.set(row.key, { first: own.first < held.first ? own.first : held.first, firstReal: own.firstReal < held.firstReal ? own.firstReal : held.firstReal, last: own.last > held.last ? own.last : held.last });
  }
  rangeCache = { at: Date.now(), ranges };
  return ranges;
}

/** A series whose last stored period is within two years of today still publishes. */
export function isCurrent(lastPeriod: string | undefined, now = new Date()): boolean {
  if (!lastPeriod) return false;
  const year = Number(lastPeriod.slice(0, 4));
  return Number.isFinite(year) && now.getUTCFullYear() - year <= 2;
}

export async function searchNbsCatalog(filters: NbsSearchFilters) {
  const snapshot = await loadSnapshot();
  const ranges = storedRanges();
  const withRange = (entry: NbsCatalogEntry): NbsCatalogEntry => {
    const own = ranges.get(entry.key);
    if (!own) return entry;
    // A family head is served stitched with its older slices, so its range starts where the oldest
    // slice starts; for a level or index series that is the first non-zero value, the same rule
    // the page applies when it drops NBS's leading placeholder zeros.
    // A rate keeps its stored start unless the zeros before its first real value run as long as the
    // page's rule for shedding them (the run is counted in periods between the two labels).
    const startOf = (range: { first: string; firstReal: string }) =>
      (isRateEntry(entry) && periodsBetween(range.first, range.firstReal, entry.frequency) < RATE_PLACEHOLDER_RUN ? range.first : range.firstReal);
    let first = startOf(own);
    for (const member of entry.family?.members ?? []) {
      const range = ranges.get(member);
      if (range && startOf(range) < first) first = startOf(range);
    }
    return { ...entry, firstPeriod: first, lastPeriod: own.last };
  };
  const query = normalizeQuery(filters.query ?? "");
  const passes = (entry: NbsCatalogEntry) =>
    (!filters.frequency || entry.frequency === filters.frequency) &&
    (!filters.geography || entry.geography === filters.geography) &&
    (filters.datasetCode === undefined || entry.datasetCode === filters.datasetCode) &&
    (!filters.category || entry.categories.includes(filters.category)) &&
    (!entry.family || entry.family.head === entry.key);

  const rank = (extraTerms: string[]) => {
    const startedAt = performance.now();
    const fullText = query ? fullTextCandidates([...queryVariants(query), ...extraTerms]) : new Map<string, number>();
    // Only the entries that could score are scored; a query the postings cannot express scans all, as before.
    const candidatesAt = performance.now();
    const candidates = query && candidateIndexEnabled ? candidatesFor(snapshot, query, extraTerms, fullText.keys()) : null;
    const considered = candidates ? [...candidates].sort((a, b) => a - b).map((position) => snapshot.entries[position]!) : snapshot.entries;
    if (process.env.CHINA_SEARCH_TRACE) console.log(`  search "${query}": full text ${(candidatesAt - startedAt).toFixed(0)}ms, ${candidates ? `${candidates.size} candidates` : "full scan"} ${(performance.now() - candidatesAt).toFixed(0)}ms`);
    return considered.filter(passes).map((entry) => {
      const base = query ? searchScore(entry, query) : 1;
      const extra = extraTerms.reduce((sum, term, index) => sum + termHit(entry.name, term) * 8 / (index + 1), 0);
      // Full text is a tiebreak, never the ranking: two-character Chinese
      // terms cannot hit a trigram index, so letting bm25 dominate would rank
      // long generic titles above the specific ones the query meant.
      const text = fullText.has(entry.key) && (base > 0 || indexHitIsReal(entry, query)) ? Math.min(2, (fullText.get(entry.key) ?? 0) / 5) : undefined;
      const score = base > 0 ? base + (text ?? 0) : text !== undefined ? 5 + text + extra : extra;
      return { entry, score };
    }).filter((item) => item.score > 0).sort((a, b) =>
      // Keyword score decides in bands of five (the full-text tiebreak is worth at most two points),
      // then a series that still publishes beats one that stopped, then the national figure beats
      // the same indicator published for one province or city (a query that names a place is
      // routed to that place's tables before this), then a year-earlier index base beats a
      // previous-month one, then the shorter English title.
      band(b.score) - band(a.score)
      || Number(isCurrent(ranges.get(b.entry.key)?.last)) - Number(isCurrent(ranges.get(a.entry.key)?.last))
      || Number(a.entry.geography !== "National") - Number(b.entry.geography !== "National")
      || frequencyRank(a.entry) - frequencyRank(b.entry)
      || monthOnMonthBase(a.entry) - monthOnMonthBase(b.entry)
      || titleLength(a.entry) - titleLength(b.entry)
      || b.score - a.score
      || a.entry.name.localeCompare(b.entry.name, "zh-CN"));
  };

  let scored = rank([]);
  // English that found (almost) nothing: let the model suggest Chinese terms.
  if (scored.length < 3 && /[a-z]{3,}/i.test(query) && !/^(nbs_)?[0-9a-f]{6,}$/i.test(query) && (filters.offset ?? 0) === 0) {
    const expanded = (await expandQuery(query)).filter((term) => /[㐀-鿿]/.test(term));
    if (expanded.length > 0) scored = rank(expanded);
  }
  const offset = Math.max(0, filters.offset ?? 0);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 50));
  return {
    total: scored.length,
    offset,
    limit,
    results: scored.slice(offset, offset + limit).map((item) => withRange(item.entry)),
  };
}

/**
 * Search, reading a place name in the query as a place rather than a subject.
 *
 * "guangdong gdp" and "shenzhen new home prices" are the natural way to ask
 * for a regional series, but the catalog has no per-province titles: a
 * provincial series is one indicator published for 31 places. So a named place
 * narrows the search to the datasets published for places of that kind, and
 * each result carries the region it should open at.
 *
 * A place name that leads nowhere — no regional series matches the rest of the
 * query — falls back to the ordinary search of the whole query, because the
 * word may have been part of a subject after all.
 */
/**
 * A regional series opens at its first listed place (Beijing for the
 * provinces, Hong Kong for the SAR table), so a result card names that place
 * the way the page it opens will: the title reads the same in both.
 */
async function withDefaultRegions<T extends { results: (NbsCatalogEntry & { region?: NbsRegionOption })[] }>(response: T): Promise<T> {
  const results = await Promise.all(response.results.map(async (entry) => {
    if (entry.region || entry.geography === "National") return entry;
    try {
      const regions = await getNbsDimensions(entry, { offline: true });
      return regions[0] ? { ...entry, region: regions[0] } : entry;
    } catch { return entry; }
  }));
  return { ...response, results };
}

export async function searchNbsCatalogWithPlaces(filters: NbsSearchFilters): Promise<{
  total: number; offset: number; limit: number;
  results: (NbsCatalogEntry & { region?: NbsRegionOption })[];
  place?: { text: string; en: string; kind: "Province" | "City" };
}> {
  const asked = filters.query && !filters.geography ? findGeographyInQuery(filters.query) : undefined;
  if (asked) {
    // "population by province": the phrase is the filter, the rest is the subject.
    const byGeography = await searchNbsCatalog({ ...filters, query: asked.rest, geography: asked.geography });
    if (byGeography.total > 0) return withDefaultRegions(byGeography);
  }
  const named = filters.query && !filters.geography ? findPlaceInQuery(filters.query) : undefined;
  if (!named) return withDefaultRegions(await searchNbsCatalog(filters));

  const geography = named.kind === "Province" ? "Province" : "City";
  const narrowed = await searchNbsCatalog({ ...filters, query: named.rest, geography });
  if (narrowed.total === 0) return await searchNbsCatalog(filters);

  const results = await Promise.all(narrowed.results.map(async (entry) => {
    const regions = await getNbsDimensions(entry);
    const region = regions.find((option) =>
      option.en === named.place.en ||
      option.text === named.place.zh ||
      option.text.replace(/[市省]$/, "") === named.place.zh);
    return region ? { ...entry, region } : entry;
  }));
  return { ...narrowed, results, place: { text: named.place.zh, en: named.place.en, kind: named.kind } };
}

/** Every catalog entry, in catalog order. The crawl walks this. */
export async function listNbsCatalogEntries(): Promise<NbsCatalogEntry[]> {
  const snapshot = await loadSnapshot();
  return snapshot.entries;
}

export async function getNbsCatalogEntry(key: string): Promise<NbsCatalogEntry | null> {
  const snapshot = await loadSnapshot();
  const version = await catalogVersion();
  if (entryIndex?.version !== version) {
    const byKey = new Map<string, NbsCatalogEntry>();
    for (const entry of snapshot.entries) {
      byKey.set(entry.key, entry);
      if (!byKey.has(entry.id)) byKey.set(entry.id, entry);
    }
    entryIndex = { version, byKey };
  }
  return entryIndex.byKey.get(key) ?? null;
}

async function getJson(path: string): Promise<unknown> {
  const response = await upstreamFetch(`${API}${path}`, {
    headers: { Accept: "application/json", Referer: "https://data.stats.gov.cn/dg/website/page.html" },
    timeoutMs: 30_000,
  });
  if (!response.ok) throw new Error(`NBS metadata -> HTTP ${response.status}`);
  const text = await response.text();
  if (!text.trimStart().startsWith("{")) throw new Error("NBS metadata returned its anti-bot page");
  const parsed: unknown = JSON.parse(text);
  return parsed;
}

function fallbackDimensions(entry: NbsCatalogEntry): NbsRegionOption[] {
  if (entry.geography === "Province") return withEnglishNames(NBS_PROVINCES);
  if (entry.geography === "Hong Kong, Macao & Taiwan") return withEnglishNames(HMT_REGIONS);
  // A city table's cities and an international table's countries are only ever collected, never guessed.
  return [];
}

export async function getNbsDimensions(entry: NbsCatalogEntry, options: { offline?: boolean } = {}): Promise<NbsRegionOption[]> {
  if (entry.geography === "National") return [NATIONAL];
  const cached = dimensionsCache.get(entry.cid);
  if (cached && Date.now() - cached.at < 6 * 60 * 60 * 1000) return cached.data;
  const remember = (regions: NbsRegionOption[]): NbsRegionOption[] => {
    // Every answer is cached, including a fallback and an empty one. A crawl
    // asks once per series, and a table whose region list cannot be had would
    // otherwise spend two timed-out requests on every one of its indicators.
    dimensionsCache.set(entry.cid, { at: Date.now(), data: regions });
    return regions;
  };

  // The list collected for this table, if `bun run regions` has reached
  // it. That is the only source that knows a city table's own cities; the live
  // endpoint below is challenged from a plain client and usually declines.
  const collected = await collectedRegions(entry.cid);
  if (collected && collected.length > 0) return remember(collected);

  // Choosing what to crawl walks the whole catalog, and a table whose list was
  // never collected would otherwise spend two timed-out requests there before
  // the crawl has fetched anything. Selection asks offline; a page view, which
  // is one table at a time, still tries the live endpoint.
  if (options.offline) return remember(fallbackDimensions(entry));

  let treeRaw: unknown;
  try {
    treeRaw = await getJson(`/getDaCatalogTreeByIndicatorCid?indicatorCid=${encodeURIComponent(entry.cid)}`);
  } catch {
    return remember(fallbackDimensions(entry));
  }
  const tree = objectValue(treeRaw, "data");
  if (!Array.isArray(tree) || tree.length === 0) return remember(fallbackDimensions(entry));
  const preferred = tree.find((item) => stringValue(item, "name").includes("全部")) ?? tree[0];
  const daCid = stringValue(preferred, "_id");
  if (!daCid) return remember(fallbackDimensions(entry));

  let regionsRaw: unknown;
  try {
    regionsRaw = await getJson(`/getDasByDaCatalogId?daCid=${encodeURIComponent(daCid)}`);
  } catch {
    return remember(fallbackDimensions(entry));
  }
  const regions = objectValue(regionsRaw, "data");
  if (!Array.isArray(regions)) return remember(fallbackDimensions(entry));
  return remember(withEnglishNames(regions.map((item) => ({
    text: stringValue(item, "show_name") || stringValue(item, "name_text"),
    value: stringValue(item, "name_value"),
  })).filter((item) => item.text && item.value)));
}

/**
 * The `dts` range one esData request asks for, in the bureau's own period
 * codes: 202601MM for a month, 202601SS for a quarter, 2026YY for a year.
 * Exported for the tests that pin those three shapes.
 */
export function periodRange(frequency: NbsCatalogEntry["frequency"], limit: number, now = new Date()): string {
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
  // Annual periods are written 2026YY. A plain year range ("2016-2026") is
  // answered with HTTP 500, which is why annual series never returned anything
  // before the annual and provincial datasets were added.
  return `${now.getFullYear() - Math.max(0, limit - 1)}YY-${now.getFullYear()}YY`;
}

/** One bureau period code as the site writes it: 2026-07, 2026-Q2, 2026. Exported for tests. */
export function periodLabel(code: string): string {
  const quarter = code.match(/^(\d{4})0([1-4])SS$/);
  if (quarter) return `${quarter[1]}-Q${quarter[2]}`;
  const annual = code.match(/^(\d{4})YY$/);
  if (annual) return annual[1] ?? code;
  const month = code.match(/^(\d{4})(\d{2})/);
  if (month) return `${month[1]}-${month[2]}`;
  return code;
}

function periodsPerYear(frequency: NbsCatalogEntry["frequency"]): number {
  if (frequency === "Monthly") return 12;
  if (frequency === "Quarterly") return 4;
  return 1;
}

/**
 * The period label `steps` periods earlier, counted in the series' own frequency: "2026-07" a year
 * back at Monthly is "2025-07", "2026-Q2" at Quarterly is "2025-Q2". Quarterly series reach the
 * site in both shapes, "2026-Q2" from the NBS catalog and "2026-06" from the Eastmoney mirror.
 * Returns "" for a label in none of those shapes.
 */
export function shiftPeriod(period: string, frequency: NbsCatalogEntry["frequency"], steps: number): string {
  const annual = period.match(/^(\d{4})$/);
  if (annual) return String(Number(annual[1]) - steps);
  const quarter = period.match(/^(\d{4})-Q([1-4])$/);
  if (quarter) {
    const index = Number(quarter[1]) * 4 + (Number(quarter[2]) - 1) - steps;
    return `${Math.floor(index / 4)}-Q${(index % 4) + 1}`;
  }
  const month = period.match(/^(\d{4})-(\d{2})$/);
  if (month) {
    const months = frequency === "Quarterly" ? 3 : frequency === "Annual" ? 12 : 1;
    const index = Number(month[1]) * 12 + (Number(month[2]) - 1) - steps * months;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
  }
  return "";
}

/**
 * Transforms match the comparison period by its label, never by counting back through the array:
 * NBS publishes no January for its monthly activity series (January and February come out
 * together as the February point), so a twelfth point back is the wrong month. A period whose
 * comparison period is missing yields no point rather than a wrong one.
 */
export function transformPoints(points: SeriesPoint[], transform: NbsTransform, frequency: NbsCatalogEntry["frequency"]): SeriesPoint[] {
  if (transform === "raw") return points;
  if (transform === "index_growth") {
    return points.map((point) => ({ date: point.date, value: Math.round((point.value - 100) * 1000) / 1000 }));
  }
  const lag = transform === "yoy" ? periodsPerYear(frequency) : 1;
  const byPeriod = new Map(points.map((point) => [point.date, point.value]));
  const output: SeriesPoint[] = [];
  for (const current of points) {
    const previous = byPeriod.get(shiftPeriod(current.date, frequency, lag));
    if (previous === undefined) continue;
    let value = current.value - previous;
    if (transform === "percent_change" || transform === "yoy") {
      if (previous === 0) continue;
      value = (current.value / previous - 1) * 100;
    }
    output.push({ date: current.date, value: Math.round(value * 1000) / 1000 });
  }
  return output;
}

/**
 * The transform a series can honestly take. "Index minus 100" is the change on
 * a year earlier only for an index whose base is a year earlier (上年同月=100).
 * Asked of anything else it subtracted 100 from a level and called the result a
 * percentage: deposits of 3,476,700 亿元 read as a 3,476,600 percent change,
 * "Up 11,997.3 pp". Such a request gets the year-on-year change computed from
 * the levels instead, which is what the label says. `describing` is any text
 * about the series: its unit, title, Chinese name.
 */
export function resolveTransform(transform: NbsTransform, describing: string): NbsTransform {
  return transform === "index_growth" && !isYearEarlierIndex(describing) ? "yoy" : transform;
}

/**
 * The unit a transformed series is shown in. `sourceUnit` is the series' own
 * unit: a year-to-date series stays year to date after the transform (the
 * change on a year earlier of January-to-August is a year-to-date change), and
 * the label must say so rather than read as a single month's growth.
 */
export function transformLabel(transform: NbsTransform, sourceUnit = ""): string {
  const yearToDate = /cumulative,? year to date|累计/i.test(sourceUnit) ? ", cumulative year to date" : "";
  if (transform === "change") return "Change from previous period";
  if (transform === "percent_change") return "Percent change from previous period";
  if (transform === "yoy" || transform === "index_growth") return `Percent change from year ago${yearToDate}`;
  return "Raw value";
}

export function defaultNbsTransform(entry: Pick<NbsCatalogEntry, "name" | "shortName">): NbsTransform {
  // Any year-on-year base (上年=100, 上年同期=100, 上年同月=100, 上年同季=100, 上年价格=100) reads as a %
  // change by default; a previous-month base stays an index. The same test resolveTransform applies.
  return isYearEarlierIndex(`${entry.name} ${entry.shortName}`) ? "index_growth" : "raw";
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
 * How much history one request asks for.
 *
 * "full" is everything the bureau has, which is what a series' first fetch and
 * a revision audit need. "recent" is the last two years, which is what a check
 * for a newly published period needs: on a dense table that is 560 KB and one
 * second against 2.4 MB and four and a half (measured 15 September 2026, three
 * tables, one request each), and the values agreed exactly on every overlapping
 * period. Older observations already stored are untouched either way — the
 * store only ever adds rows.
 */
export type FetchWindow = "full" | "recent";

function windowLimit(frequency: NbsCatalogEntry["frequency"], window: FetchWindow): number {
  if (window === "full") return historyLimit(frequency);
  if (frequency === "Monthly") return 24;
  if (frequency === "Quarterly") return 8;
  return 5;
}

/**
 * Turn one esData response into raw points for a single indicator and region.
 * NBS returns every value as a string and marks a missing cell with "", so an
 * empty string is skipped rather than parsed — the alternative is a false
 * zero. Values tagged with another region's `da` are ignored, which is what
 * stops a province request from being quietly answered with national figures.
 */
/**
 * Whether a response carries a period grid at all.
 *
 * Under load the portal answers HTTP 200 with no periods, which is not the
 * same thing as a series with nothing in it: a discontinued indicator comes
 * back as a full grid of blank cells. Telling the two apart is what stops a
 * throttled minute from marking hundreds of live series as empty and skipping
 * them for a month.
 */
export function hasPeriodGrid(raw: unknown): boolean {
  const periods = objectValue(raw, "data");
  return Array.isArray(periods) && periods.length > 0;
}

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

async function fetchNbsRawPoints(entry: NbsCatalogEntry, region: NbsRegionOption, window: FetchWindow = "full"): Promise<SeriesPoint[]> {
  const payload = {
    cid: entry.cid,
    indicatorIds: [entry.id],
    daCatalogId: "",
    das: [region],
    showType: "1",
    dts: [periodRange(entry.frequency, windowLimit(entry.frequency, window))],
    rootId: entry.rootId,
  };
  const response = await fetchJson(`${API}/stream/esData`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      Origin: "https://data.stats.gov.cn",
      Referer: "https://data.stats.gov.cn/dg/website/page.html",
    },
    body: JSON.stringify(payload),
  }, { timeoutMs: 60_000 });
  if (!response.ok) throw new Error(`NBS esData -> HTTP ${response.status}`);
  if (!hasPeriodGrid(response.json)) throw new Error("NBS esData returned no period grid; the portal was busy rather than the series being empty");
  return parseEsDataPoints(response.json, entry.id, region.value);
}

/**
 * The place a request is for: the one asked for, else the table's first.
 *
 * A table published by place is never answered for the nation. The endpoint
 * accepts the national code on a city table and returns a grid of zeroes, and
 * the site was serving that, labelled 全国, as if it were the city's figures.
 * A table whose places have not been collected (scripts/sync-nbs-regions.ts)
 * therefore fails here rather than returning something untrue.
 */
async function resolveNbsRegion(entry: NbsCatalogEntry, regionValue?: string): Promise<NbsRegionOption> {
  const dimensions = await getNbsDimensions(entry);
  const found = dimensions.find((item) => item.value === regionValue) ?? dimensions[0];
  if (found) return found;
  if (entry.geography !== "National") {
    throw new Error(`the places ${entry.dataset} publishes this table for have not been collected; run bun run regions`);
  }
  return NATIONAL;
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

/**
 * A stored copy is served as is unless the series is due: its next period
 * should be out and it has not been checked since, or 45 days have passed
 * (server/due.ts). The same rule drives the scheduled refresh, so a view
 * costs a trip to NBS only when there is something to gain.
 */
function isFresh(entry: NbsCatalogEntry, region: NbsRegionOption, points: SeriesPoint[]): boolean {
  const updatedAt = seriesFreshness(entry.key, region.value);
  const lastPeriod = points[points.length - 1]?.date ?? null;
  return !isDue(entry.frequency, lastPeriod, updatedAt, new Date(), undefined, seriesFullHistoryCheck(entry.key, region.value));
}

/**
 * Fetch a series live and store it, logging the attempt either way. Zero
 * points is a failure, not an empty series: NBS answers an impossible
 * region/indicator pairing with a well-formed grid of blanks, and storing that
 * would look exactly like a successful ingest.
 */
export async function refreshNbsCatalogSeries(entry: NbsCatalogEntry, regionValue?: string, options: { fetchPoints?: typeof fetchNbsRawPoints } = {}): Promise<{
  region: NbsRegionOption;
  points: SeriesPoint[];
  changed: number;
}> {
  const region = await resolveNbsRegion(entry, regionValue);
  const startedAt = new Date().toISOString();
  let points: SeriesPoint[];
  try {
    points = await (options.fetchPoints ?? fetchNbsRawPoints)(entry, region, "full");
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
  const summary = writeSeries(rawResult(entry, region, points), region.value, finishedAt, { historyWindow: "full" });
  logFetch({ key: entry.key, region: region.value, startedAt, finishedAt, status: "ok",
    points: summary.points, changed: summary.changed });
  return { region, points, changed: summary.changed };
}

/**
 * One esData request for up to `NBS_BATCH_SIZE` indicators of the same table
 * (same cid, rootId and frequency). NBS answers with every indicator's full
 * history in one grid, so the catalog crawl needs a few hundred requests
 * rather than fifteen thousand.
 */
export const NBS_BATCH_SIZE = 40;
export async function fetchNbsTableBatch(entries: NbsCatalogEntry[], region: NbsRegionOption = NATIONAL, window: FetchWindow = "full"): Promise<Map<string, SeriesPoint[]>> {
  const first = entries[0];
  if (!first) return new Map();
  const payload = {
    cid: first.cid,
    indicatorIds: entries.map((entry) => entry.id),
    daCatalogId: "",
    das: [region],
    showType: "1",
    dts: [periodRange(first.frequency, windowLimit(first.frequency, window))],
    rootId: first.rootId,
  };
  const response = await fetchJson(`${API}/stream/esData`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      Origin: "https://data.stats.gov.cn",
      Referer: "https://data.stats.gov.cn/dg/website/page.html",
    },
    body: JSON.stringify(payload),
  }, { timeoutMs: 120_000 });
  if (!response.ok) throw new Error(`NBS esData -> HTTP ${response.status}`);
  const raw = response.json;
  if (!hasPeriodGrid(raw)) throw new Error("NBS esData returned no period grid; the portal was busy rather than the table being empty");
  return new Map(entries.map((entry) => [entry.id, parseEsDataPoints(raw, entry.id, region.value)]));
}

/** Store one indicator's fetched points and log the outcome. */
export function storeNbsPoints(entry: NbsCatalogEntry, region: NbsRegionOption, points: SeriesPoint[], startedAt: string, window: FetchWindow = "full"): "ok" | "empty" {
  const finishedAt = new Date().toISOString();
  if (points.length === 0) {
    logFetch({ key: entry.key, region: region.value, startedAt, finishedAt, status: "empty", points: 0, changed: 0, message: "source returned a grid with no values" });
    return "empty";
  }
  const summary = writeSeries(rawResult(entry, region, points), region.value, finishedAt, { historyWindow: window });
  logFetch({ key: entry.key, region: region.value, startedAt, finishedAt, status: "ok", points: summary.points, changed: summary.changed });
  return "ok";
}

/**
 * NBS publishes January and February of the monthly activity tables as one
 * reading: a "current period" level or a monthly growth rate has no
 * February point, while the year-to-date series of the same table carries
 * the combined figure there. The sibling's name is the primary's with the
 * measure swapped; null when the name is not one of those measures.
 */
export function februarySiblingName(name: string): string | null {
  if (/当期值/.test(name)) return name.replace(/当期值/, "累计值");
  if (/同比增长/.test(name)) return name.replace(/同比增长/, "累计增长");
  return null;
}

/**
 * The names of the series NBS publishes as the growth of a level series.
 *
 * Monthly activity tables carry it as a rate beside the level ("粗钢产量当期值"
 * → "粗钢产量同比增长"). The annual and provincial tables carry it as an index
 * instead ("地区生产总值" → "地区生产总值指数"), often in a table of its own —
 * which matters here because most of a provincial dataset is levels, and
 * arithmetic on a level is not the growth rate NBS publishes.
 *
 * The unit is dropped: the level is in 万吨 or 亿元 and its growth in % or as
 * an index, so only the stem matches. Returns nothing for a series that is
 * already a rate, an index, a share or a ratio.
 */
export function growthSiblingNames(name: string): string[] {
  const stem = name.replace(/\s*[（(][^（()）]*[)）]\s*$/, "");
  if (/当期值$/.test(stem)) return [stem.replace(/当期值$/, "同比增长")];
  if (/累计值$/.test(stem)) return [stem.replace(/累计值$/, "累计增长")];
  if (/(指数|增长|增速|率|比重|占比|比例)$/.test(stem)) return [];
  return [`${stem}指数`];
}

/** A catalog title without its trailing unit, "粗钢产量同比增长 (%)" → "粗钢产量同比增长". */
export function titleStem(name: string): string {
  return name.replace(/\s*[（(][^（()）]*[)）]\s*$/, "");
}

/** The primary's points plus the sibling's February points it lacks, in date order. */
export function fillFebruary(primary: SeriesPoint[], sibling: SeriesPoint[]): { points: SeriesPoint[]; filled: number } {
  const have = new Set(primary.map((point) => point.date));
  // Only a series that never carries a February of its own takes one from the sibling. The
  // sibling's February is the January-February total, so filling it into a series that does
  // publish single Februaries in other years mixes one-month and two-month readings: passenger
  // traffic held 139,505 for February 2026 beside a filled 276,370 for February 2025, and the
  // year-over-year transform read -49.5% where NBS published +0.9%.
  if (primary.some((point) => point.date.endsWith("-02"))) return { points: primary, filled: 0 };
  const extra = sibling.filter((point) => point.date.endsWith("-02") && !have.has(point.date));
  if (extra.length === 0) return { points: primary, filled: 0 };
  return { points: [...primary, ...extra].sort((a, b) => a.date.localeCompare(b.date)), filled: extra.length };
}

/** The store-first read that every page view goes through. */
export async function getNbsCatalogSeries(options: {
  entry: NbsCatalogEntry;
  region?: string;
  limit?: number;
  transform?: NbsTransform;
  /** Read the store only, never the portal; an unstored series is an error rather than a fetch. */
  storeOnly?: boolean;
}): Promise<NbsSeriesResult> {
  const limit = Math.min(historyLimit(options.entry.frequency), Math.max(2, options.limit ?? 120));
  const transform = resolveTransform(options.transform ?? defaultNbsTransform(options.entry), `${options.entry.name} ${options.entry.shortName} ${rawUnitOf(options.entry)}`);
  const region = await resolveNbsRegion(options.entry, options.region);

  // A sliced table is served whole: every member of the family, oldest first,
  // stitched so the newest slice wins where two overlap.
  const memberEntries = options.entry.family
    ? (await Promise.all(options.entry.family.members.map((key) => getNbsCatalogEntry(key)))).filter((member): member is NbsCatalogEntry => member !== null)
    : [options.entry];
  const parts: { points: SeriesPoint[]; source: NbsSeriesResult["source"] }[] = [];
  for (const member of memberEntries) {
    try { parts.push(await pointsFor(member, region, options.storeOnly ?? false)); }
    catch (error) { if (memberEntries.length === 1) throw error; }
  }
  if (parts.every((part) => part.points.length === 0)) throw new Error("NBS returned no observations for this series");
  let points = dropLeadingPlaceholders(stitchPoints(parts.map((part) => part.points)), options.entry);
  const source: NbsSeriesResult["source"] = parts.some((part) => part.source === "stale") ? "stale" : parts.some((part) => part.source === "live") ? "live" : "store";

  // The combined January-February reading lives in the year-to-date sibling; take its stored
  // February points where this series has none. Stored only: a page view never fetches for it.
  let februaryFrom: string | undefined;
  const siblingName = options.entry.frequency === "Monthly" ? februarySiblingName(options.entry.name) : null;
  if (siblingName) {
    const snapshot = await loadSnapshot();
    const sibling = snapshot.entries.find((candidate) => candidate.cid === options.entry.cid && candidate.geography === options.entry.geography && candidate.name === siblingName);
    if (sibling) {
      const siblingEntries = sibling.family
        ? sibling.family.members.map((key) => snapshot.entries.find((candidate) => candidate.key === key)).filter((member): member is NbsCatalogEntry => member !== undefined)
        : [sibling];
      const filled = fillFebruary(points, stitchPoints(siblingEntries.map((member) => storedPoints(member, region))));
      if (filled.filled > 0) { points = filled.points; februaryFrom = sibling.key; }
    }
  }

  // A level series has a published growth rate of its own, computed on a comparable scope where
  // arithmetic on the levels is not; the page links to it so a reader can take NBS's figure.
  let growthSibling: { key: string; name: string } | undefined;
  const growthNames = growthSiblingNames(options.entry.name);
  if (growthNames.length > 0) {
    const snapshot = await loadSnapshot();
    const matches = snapshot.entries.filter((candidate) =>
      candidate.datasetCode === options.entry.datasetCode &&
      candidate.geography === options.entry.geography &&
      growthNames.includes(titleStem(candidate.name)));
    // Prefer the growth series in the same table, then one on a year-earlier
    // base: an index against 1978 or the previous month is not the growth rate.
    const found = matches.find((candidate) => candidate.cid === options.entry.cid)
      ?? matches.find((candidate) => /上年/.test(candidate.name))
      ?? matches[0];
    // The English title ends ", %", which reads badly inside a sentence naming the series.
    if (found) growthSibling = { key: found.key, name: (found.nameEn || found.name).replace(/,\s*%$/, "") };
  }

  // Transform over the full history, then slice, so lagged transforms keep
  // their first year instead of losing it to the limit.
  const transformed = transformPoints(points, transform, options.entry.frequency).slice(-limit);
  const unit = transform === "raw" ? rawUnitOf(options.entry) : transformLabel(transform, `${rawUnitOf(options.entry)} ${options.entry.name}`);
  return {
    ...rawResult(options.entry, region, transformed),
    unit,
    metadata: { ...options.entry, ...(februaryFrom ? { februaryFrom } : {}), ...(growthSibling ? { growthSibling } : {}) },
    region,
    transform,
    source,
    updatedAt: memberEntries.map((member) => seriesFreshness(member.key, region.value)).filter((value): value is string => typeof value === "string").sort().at(-1) ?? new Date().toISOString(),
  };
}

/**
 * NBS labels index tables "无" (none) for a unit and puts the base in the
 * title: 居民消费价格指数 (上月=100). The base is the unit a reader needs.
 */
export function rawUnitOf(entry: Pick<NbsCatalogEntry, "unit" | "name">): string {
  const unit = entry.unit.trim();
  const name = entry.name;
  // The unit field is the table's; a row's own unit sits in its title's parentheses and wins when
  // they differ: "生铁产销率累计值 (%)" is a percentage, not the 万吨 of the pig iron table, and
  // "产销率比上年同期增减 (百分点)" is percentage points, not percent. Base periods ("上月=100") are handled below.
  const titled = name.match(/[（(]\s*([^()（）=]+?)\s*[)）]\s*$/)?.[1]?.trim();
  if (titled && titled !== unit && !/=/.test(titled)) return titled;
  if (unit && unit !== "无") return unit;
  if (/上年同月\s*=\s*100/.test(name)) return "Index, same month a year earlier = 100";
  if (/上年同期\s*=\s*100/.test(name)) return "Index, same period a year earlier = 100";
  if (/上月\s*=\s*100/.test(name)) return "Index, previous month = 100";
  if (/上年\s*=\s*100/.test(name)) return "Index, previous year = 100";
  if (/=\s*100/.test(name)) return "Index, base period = 100";
  return unit || "Value";
}

/**
 * Stored points if fresh, otherwise a refresh; a stale copy beats an error page, a missing copy does not.
 * With `storeOnly`, the stored points whatever their age, and an error when there are none: a page
 * that draws many series at once (a theme) must never turn into a burst of fetches.
 */
async function pointsFor(entry: NbsCatalogEntry, region: NbsRegionOption, storeOnly = false): Promise<{ points: SeriesPoint[]; source: NbsSeriesResult["source"] }> {
  const points = storedPoints(entry, region);
  if (points.length > 0 && isFresh(entry, region, points)) return { points, source: "store" };
  if (storeOnly) {
    if (points.length === 0) throw new Error("not stored");
    return { points, source: "stale" };
  }
  try {
    const refreshed = await refreshNbsCatalogSeries(entry, region.value);
    return { points: refreshed.points, source: "live" };
  } catch (error) {
    if (points.length === 0) throw error;
    return { points, source: "stale" };
  }
}
