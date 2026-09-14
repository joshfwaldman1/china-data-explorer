/**
 * Combine catalog snapshots into the one the site ships.
 *
 * The bureau's index is crawled dataset by dataset — national monthly and
 * quarterly, then annual, then the provincial and city tables — and each crawl
 * writes its own file so a long run cannot spoil a good snapshot. This puts
 * them together: entries are keyed by the bureau's own indicator id, so a later
 * input replaces an earlier one for the same series and nothing is duplicated.
 *
 *   bun run china:catalog-merge --out=catalog/nbs-catalog.json.gz \
 *     catalog/nbs-catalog.json catalog/nbs-catalog-regional.json
 *
 * An output path ending .gz is written compressed; the site reads either.
 */

import { mkdir, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { readCatalogSnapshot } from "../server/catalog-file.ts";

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function objectValue(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

const inputs = process.argv.slice(2).filter((argument) => !argument.startsWith("--")).map((path) => resolve(path));
if (inputs.length === 0) throw new Error("give at least one snapshot to merge");
const outputPath = resolve(option("out") ?? inputs[0] ?? "");

const entries = new Map<string, unknown>();
const datasets = new Map<string, unknown>();
let source = "National Bureau of Statistics of China";

for (const input of inputs) {
  const snapshot = await readCatalogSnapshot(input);
  const theirs = objectValue(snapshot, "entries");
  const theirDatasets = objectValue(snapshot, "datasets");
  if (!Array.isArray(theirs)) throw new Error(`${input} has no entries`);
  for (const entry of theirs) {
    const key = typeof objectValue(entry, "key") === "string" ? String(objectValue(entry, "key")) : "";
    if (key) entries.set(key, entry);
  }
  if (Array.isArray(theirDatasets)) {
    for (const dataset of theirDatasets) {
      const code = objectValue(dataset, "code");
      const rootId = objectValue(dataset, "rootId");
      if (typeof code === "number") datasets.set(`${code}|${String(rootId)}`, dataset);
    }
  }
  const theirSource = objectValue(snapshot, "source");
  if (typeof theirSource === "string" && theirSource) source = theirSource;
  const counts = new Map<number, number>();
  for (const entry of theirs) {
    const code = objectValue(entry, "datasetCode");
    if (typeof code === "number") counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  console.log(`${input}: ${theirs.length.toLocaleString()} entries (${[...counts].sort().map(([code, count]) => `code ${code}: ${count.toLocaleString()}`).join(", ")})`);
}

const merged = {
  generatedAt: new Date().toISOString(),
  source,
  datasets: [...datasets.values()],
  entries: [...entries.values()],
};

const text = `${JSON.stringify(merged)}\n`;
const body = outputPath.endsWith(".gz") ? Bun.gzipSync(new TextEncoder().encode(text)) : text;
const temporary = `${outputPath}.tmp`;
await mkdir(dirname(outputPath), { recursive: true });
await Bun.write(temporary, body);
await rename(temporary, outputPath);
console.log(`Wrote ${merged.entries.length.toLocaleString()} entries over ${merged.datasets.length} datasets to ${outputPath} (${(Bun.file(outputPath).size / 1048576).toFixed(1)} MB)`);
