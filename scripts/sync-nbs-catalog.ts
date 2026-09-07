import { mkdir, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const API = "https://data.stats.gov.cn/dg/website/publicrelease/web/external";
const DEFAULT_OUTPUT = resolve(import.meta.dir, "../catalog/nbs-catalog.json");

interface DatasetDefinition {
  code: number;
  frequency: "Monthly" | "Quarterly" | "Annual";
  geography: "National" | "Province" | "City" | "Hong Kong, Macao & Taiwan";
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
  { code: 9, frequency: "Monthly", geography: "Hong Kong, Macao & Taiwan" },
  { code: 10, frequency: "Annual", geography: "Hong Kong, Macao & Taiwan" },
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

const delayMs = Math.max(500, Number(option("delay") ?? "750"));
const concurrency = Math.min(4, Math.max(1, Number(option("concurrency") ?? "3")));
const outputPath = resolve(option("out") ?? DEFAULT_OUTPUT);
const requestedCodes = new Set(
  (option("codes") ?? DATASETS.map((dataset) => dataset.code).join(","))
    .split(",")
    .map(Number)
    .filter(Number.isFinite),
);
let requestCount = 0;

async function getJson(path: string): Promise<unknown> {
  requestCount += 1;
  const response = await fetch(`${API}${path}`, {
    headers: { Accept: "application/json", Referer: "https://data.stats.gov.cn/dg/website/page.html" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${path} -> HTTP ${response.status}`);
  return response.json();
}

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

const entries: CatalogEntry[] = [];
const datasets: { code: number; rootId: string; name: string; frequency: string; geography: string }[] = [];
const errors: { datasetCode: number; nodeId: string; message: string }[] = [];

async function writeSnapshot(): Promise<void> {
  entries.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  const snapshot = {
    generatedAt: new Date().toISOString(),
    source: "National Bureau of Statistics of China",
    requestCount,
    datasets,
    entries,
    errors,
  };
  const temporaryPath = `${outputPath}.tmp`;
  await mkdir(dirname(outputPath), { recursive: true });
  await Bun.write(temporaryPath, `${JSON.stringify(snapshot)}\n`);
  await rename(temporaryPath, outputPath);
}

for (const definition of DATASETS.filter((dataset) => requestedCodes.has(dataset.code))) {
  const roots = await children("", definition.code);
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
      if (queue.length > 0) await Bun.sleep(delayMs);
    }
    console.log(`${root.name}: ${entries.length.toLocaleString()} indexed so far`);
    await writeSnapshot();
  }
}

await writeSnapshot();
console.log(`Wrote ${entries.length.toLocaleString()} indicators to ${outputPath}`);
if (errors.length > 0) console.warn(`${errors.length} catalog nodes failed; see snapshot.errors`);
