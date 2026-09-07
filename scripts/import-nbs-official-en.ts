/**
 * Validate a reviewed current-NBS-to-legacy-English crosswalk and publish it.
 *
 * The input uses the same schema as catalog/nbs-official-en.json. Each row must
 * match both a current opaque key and its exact Chinese title. This script does
 * not guess translations or fuzzy-match legacy IDs.
 *
 *   bun run china-explorer/scripts/import-nbs-official-en.ts --in=reviewed.json
 */

import { dirname, resolve } from "node:path";
import { mkdir, rename } from "node:fs/promises";
import { parseOfficialEnglishSnapshot } from "../official-english";

const CATALOG_PATH = resolve(import.meta.dir, "../catalog/nbs-catalog.json");
const DEFAULT_OUTPUT = resolve(import.meta.dir, "../catalog/nbs-official-en.json");

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function objectValue(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function textValue(value: unknown, key: string): string {
  const found = objectValue(value, key);
  return typeof found === "string" ? found.trim() : "";
}

const input = option("in");
if (!input) throw new Error("pass a reviewed snapshot with --in=path/to/file.json");
const output = resolve(option("out") ?? DEFAULT_OUTPUT);

const catalogRaw: unknown = await Bun.file(CATALOG_PATH).json();
const catalogEntries = objectValue(catalogRaw, "entries");
if (!Array.isArray(catalogEntries)) throw new Error("current NBS catalog is missing its entries array");
const currentNames = new Map<string, string>();
for (const entry of catalogEntries) {
  const key = textValue(entry, "key");
  const name = textValue(entry, "name");
  if (key && name) currentNames.set(key, name);
}

const reviewedRaw: unknown = await Bun.file(resolve(input)).json();
const reviewed = parseOfficialEnglishSnapshot(reviewedRaw);
for (const entry of reviewed.entries) {
  const currentName = currentNames.get(entry.currentKey);
  if (!currentName) throw new Error(`${entry.currentKey} is not in the current NBS catalog`);
  if (currentName !== entry.nameZh) {
    throw new Error(`${entry.currentKey} title mismatch: catalog has ${JSON.stringify(currentName)}`);
  }
}

const published = {
  ...reviewed,
  generatedAt: new Date().toISOString(),
};
const temporary = `${output}.tmp`;
await mkdir(dirname(output), { recursive: true });
await Bun.write(temporary, `${JSON.stringify(published, null, 2)}\n`);
await rename(temporary, output);
console.log(`wrote ${output} with ${published.entries.length} audited official English labels`);
