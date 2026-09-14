/**
 * Where the NBS catalog snapshot lives, and how to read it.
 *
 * The snapshot is a crawl of the bureau's own index tree — every indicator it
 * lists, with the identifiers needed to ask for the numbers. It ships with the
 * repository so a fresh deployment can search the whole catalogue before it has
 * fetched a single observation.
 *
 * Two things this file exists for. The path is overridable, so a crawl can be
 * validated against a running server before it replaces the live snapshot. And
 * the file may be gzipped: the national monthly and quarterly datasets alone
 * are 12 MB of JSON, and adding the annual and regional datasets takes that
 * past 50 MB, which is more than belongs in a git history uncompressed.
 */

import { resolve } from "node:path";

const DEFAULT_PATH = resolve(import.meta.dir, "../catalog/nbs-catalog.json");

/**
 * The snapshot path. `NBS_CATALOG_PATH` overrides it; a path ending `.gz` is
 * decompressed on read. When the override is not set, a gzipped snapshot next
 * to the default path wins over a plain one, so replacing the file with its
 * compressed form needs no configuration.
 */
export function catalogPath(): string {
  const override = process.env.NBS_CATALOG_PATH;
  if (override) return resolve(override);
  return Bun.file(`${DEFAULT_PATH}.gz`).size > 0 ? `${DEFAULT_PATH}.gz` : DEFAULT_PATH;
}

/** Parse the snapshot, decompressing it first when the path ends `.gz`. */
export async function readCatalogSnapshot(path = catalogPath()): Promise<unknown> {
  if (!path.endsWith(".gz")) return await Bun.file(path).json();
  const compressed = await Bun.file(path).arrayBuffer();
  const text = new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(compressed)));
  return JSON.parse(text) as unknown;
}
