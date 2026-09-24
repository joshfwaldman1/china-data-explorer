import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { openPortal } from "./portal.ts";

const API = "https://data.stats.gov.cn/dg/website/publicrelease/web/external";
const DEFAULT_OUTPUT = resolve(import.meta.dir, "../catalog/nbs-catalog.json");

interface DatasetDefinition {
  code: number;
  frequency: "Monthly" | "Quarterly" | "Annual";
  geography: "National" | "Province" | "City" | "Hong Kong, Macao & Taiwan" | "International";
}

interface CatalogNode {
  id: string;
  name: string;
  isLeaf: boolean;
  note: string;
}

interface IndicatorMetadata {
  id: string;
  name: string;
  shortName: string;
  unit: string;
  note: string;
  annotation: string;
  precision: number | null;
}

interface CatalogEntry extends IndicatorMetadata {
  key: string;
  rootId: string;
  cid: string;
  datasetCode: number;
  dataset: string;
  frequency: DatasetDefinition["frequency"];
  geography: DatasetDefinition["geography"];
  categories: string[];
}

const DATASETS: DatasetDefinition[] = [
  { code: 1, frequency: "Monthly", geography: "National" },
  { code: 2, frequency: "Quarterly", geography: "National" },
  { code: 3, frequency: "Annual", geography: "National" },
  { code: 4, frequency: "Monthly", geography: "Province" },
  { code: 5, frequency: "Quarterly", geography: "Province" },
  { code: 6, frequency: "Annual", geography: "Province" },
  { code: 7, frequency: "Monthly", geography: "City" },
  { code: 8, frequency: "Annual", geography: "City" },
  // Code 9 answers its root and no indicators: empty on the portal, checked 25 September 2026.
  { code: 9, frequency: "Monthly", geography: "Hong Kong, Macao & Taiwan" },
  { code: 10, frequency: "Annual", geography: "Hong Kong, Macao & Taiwan" },
  // The bureau's international tables: the three major economies (US, EU,
  // Japan) monthly, world commodity prices monthly, major countries annually.
  // Code 11 is empty on the portal. Each table is one indicator over countries,
  // so these are regional in the site's sense and their lists are collected.
  { code: 12, frequency: "Monthly", geography: "International" },
  { code: 13, frequency: "Monthly", geography: "International" },
  { code: 14, frequency: "Annual", geography: "International" },
];

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function objectValue(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function textValue(value: unknown, key: string): string {
  const found = objectValue(value, key);
  return typeof found === "string" ? found.trim() : "";
}

function parseNode(value: unknown): CatalogNode | null {
  const id = textValue(value, "_id");
  const name = textValue(value, "name") || textValue(value, "_name");
  const isLeaf = objectValue(value, "isLeaf");
  if (!id || !name || typeof isLeaf !== "boolean") return null;
  return { id, name, isLeaf, note: textValue(value, "explain") };
}

function parseIndicator(value: unknown): IndicatorMetadata | null {
  const id = textValue(value, "_id");
  const name = textValue(value, "i_showname") || textValue(value, "_name");
  if (!id || !name) return null;
  const precisionText = textValue(value, "num_accuracy_value");
  const precisionNumber = Number(precisionText);
  return {
    id,
    name,
    shortName: textValue(value, "_name") || name,
    unit: textValue(value, "du_name"),
    note: textValue(value, "i_mark"),
    annotation: textValue(value, "i_annotation"),
    precision: precisionText !== "" && Number.isFinite(precisionNumber) ? precisionNumber : null,
  };
}

function parseCatalogEntry(value: unknown): CatalogEntry | null {
  const id = textValue(value, "id");
  const name = textValue(value, "name");
  const key = textValue(value, "key");
  const rootId = textValue(value, "rootId");
  const cid = textValue(value, "cid");
  const dataset = textValue(value, "dataset");
  const datasetCode = objectValue(value, "datasetCode");
  const frequency = objectValue(value, "frequency");
  const geography = objectValue(value, "geography");
  const categoriesRaw = objectValue(value, "categories");
  const validFrequency = frequency === "Monthly" || frequency === "Quarterly" || frequency === "Annual";
  const validGeography = geography === "National" || geography === "Province" || geography === "City" || geography === "Hong Kong, Macao & Taiwan" || geography === "International";
  if (!id || !name || !key || !rootId || !cid || !dataset || typeof datasetCode !== "number" ||
      !validFrequency || !validGeography || !Array.isArray(categoriesRaw)) return null;
  const precision = objectValue(value, "precision");
  return {
    id,
    name,
    shortName: textValue(value, "shortName") || name,
    unit: textValue(value, "unit"),
    note: textValue(value, "note"),
    annotation: textValue(value, "annotation"),
    precision: typeof precision === "number" ? precision : null,
    key,
    rootId,
    cid,
    datasetCode,
    dataset,
    frequency,
    geography,
    categories: categoriesRaw.filter((item): item is string => typeof item === "string"),
  };
}

const delayMs = Math.max(750, Number(option("delay") ?? "1000"));
const concurrency = Math.min(3, Math.max(1, Number(option("concurrency") ?? "1")));
const outputPath = resolve(option("out") ?? DEFAULT_OUTPUT);
const requestedCodes = new Set(
  (option("codes") ?? DATASETS.map((dataset) => dataset.code).join(","))
    .split(",")
    .map(Number)
    .filter(Number.isFinite),
);

// The metadata endpoints answer a plain HTTP client with a JavaScript
// challenge, so every request is made from inside a real browser session on
// the portal (scripts/portal.ts). `--cache=<dir>` keeps the answers: the
// portal throttles a visitor who asks for the whole index, so a crawl that
// has to be restarted replays what it already collected instead of asking
// again.
const portal = await openPortal({
  channel: option("channel"),
  headless: option("headed") !== "true",
  delayMs,
  cacheDir: option("cache") ? resolve(option("cache") ?? "") : undefined,
});
const getJson = portal.getJson;

async function children(pid: string, code: number): Promise<CatalogNode[]> {
  const raw = await getJson(`/new/queryIndexTreeAsync?pid=${encodeURIComponent(pid)}&code=${code}`);
  const data = objectValue(raw, "data");
  if (!Array.isArray(data)) return [];
  return data.map(parseNode).filter((node): node is CatalogNode => node !== null);
}

async function indicators(cid: string): Promise<IndicatorMetadata[]> {
  const raw = await getJson(
    `/new/queryIndicatorsByCid?cid=${encodeURIComponent(cid)}&dt=&name=`,
  );
  const data = objectValue(objectValue(raw, "data"), "list");
  if (!Array.isArray(data)) return [];
  return data.map(parseIndicator).filter((item): item is IndicatorMetadata => item !== null);
}

const preservedEntries: CatalogEntry[] = [];
if (option("merge") === "true" && await Bun.file(outputPath).exists()) {
  const previous: unknown = await Bun.file(outputPath).json();
  const previousEntries = objectValue(previous, "entries");
  if (Array.isArray(previousEntries)) {
    preservedEntries.push(...previousEntries
      .map(parseCatalogEntry)
      .filter((entry): entry is CatalogEntry => entry !== null && !requestedCodes.has(entry.datasetCode)));
  }
}
const entries: CatalogEntry[] = preservedEntries;
const datasets: { code: number; rootId: string; name: string; frequency: string; geography: string }[] = [];
for (const entry of preservedEntries) {
  if (datasets.some((dataset) => dataset.code === entry.datasetCode)) continue;
  datasets.push({
    code: entry.datasetCode,
    rootId: entry.rootId,
    name: entry.dataset,
    frequency: entry.frequency,
    geography: entry.geography,
  });
}
const errors: { datasetCode: number; nodeId: string; message: string }[] = [];
let lastCheckpointSize = 0;

async function writeSnapshot(targetPath = outputPath): Promise<void> {
  entries.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  const snapshot = {
    generatedAt: new Date().toISOString(),
    source: "National Bureau of Statistics of China",
    requestCount: portal.requestCount(),
    datasets,
    entries,
    errors,
  };
  const temporaryPath = `${targetPath}.tmp`;
  await mkdir(dirname(targetPath), { recursive: true });
  await Bun.write(temporaryPath, `${JSON.stringify(snapshot)}\n`);
  await rename(temporaryPath, targetPath);
}

for (const definition of DATASETS.filter((dataset) => requestedCodes.has(dataset.code))) {
  let roots: CatalogNode[];
  try {
    roots = await children("", definition.code);
  } catch (error) {
    // One dataset's index being unreachable is not a reason to throw away the
    // datasets already collected, or the ones after it.
    const message = error instanceof Error ? error.message : String(error);
    errors.push({ datasetCode: definition.code, nodeId: "", message });
    console.warn(`Dataset ${definition.code}: ${message}`);
    continue;
  }
  for (const root of roots) {
    datasets.push({
      code: definition.code,
      rootId: root.id,
      name: root.name,
      frequency: definition.frequency,
      geography: definition.geography,
    });
    const queue: { node: CatalogNode; categories: string[] }[] = [
      { node: root, categories: [] },
    ];
    while (queue.length > 0) {
      const batch = queue.splice(0, concurrency);
      await Promise.all(batch.map(async (current) => {
        const categories = current.node.id === root.id
          ? current.categories
          : [...current.categories, current.node.name];
        try {
          if (!current.node.isLeaf) {
            const next = await children(current.node.id, definition.code);
            for (const node of next) queue.push({ node, categories });
            return;
          }
          const leafIndicators = await indicators(current.node.id);
          for (const indicator of leafIndicators) {
            entries.push({
              ...indicator,
              key: `nbs_${indicator.id}`,
              rootId: root.id,
              cid: current.node.id,
              datasetCode: definition.code,
              dataset: root.name,
              frequency: definition.frequency,
              geography: definition.geography,
              categories,
              annotation: indicator.annotation || current.node.note,
            });
          }
        } catch (error) {
          errors.push({
            datasetCode: definition.code,
            nodeId: current.node.id,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }));
      if (entries.length - lastCheckpointSize >= 1_000) {
        await writeSnapshot(`${outputPath}.partial`);
        lastCheckpointSize = entries.length;
        console.log(`Checkpoint: ${entries.length.toLocaleString()} indicators`);
      }
      if (queue.length > 0) await Bun.sleep(delayMs);
    }
    console.log(`${root.name}: ${entries.length.toLocaleString()} indexed so far`);
    await writeSnapshot();
  }
}

await writeSnapshot();
await rm(`${outputPath}.partial`, { force: true });
await portal.close();
console.log(`Wrote ${entries.length.toLocaleString()} indicators to ${outputPath}`);
if (errors.length > 0) console.warn(`${errors.length} catalog nodes failed; see snapshot.errors`);
