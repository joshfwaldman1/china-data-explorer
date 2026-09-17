/**
 * Collect the bureau's own English titles for every indicator in the shipped
 * catalog snapshot.
 *
 * The current NBS portal has an English mode: the same metadata endpoints
 * under publicrelease/en/web/external answer the same indicator ids with
 * English names (i_showname). One request per table (cid) lists its
 * indicators, so the whole catalog is about 3,400 requests, paced a second
 * apart. Output is catalog/nbs-official-en.json in the schema
 * server/official-english.ts validates: each entry pins the English title to
 * the current key and the exact Chinese title from the snapshot.
 *
 *   bun run china-explorer/scripts/sync-nbs-english.ts [--delay=1000] [--out=path]
 *
 * A partial file is written every 100 tables and picked up on restart.
 */

import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { readCatalogSnapshot } from "../server/catalog-file.ts";

const API = "https://data.stats.gov.cn/dg/website/publicrelease/en/web/external";
const DEFAULT_OUTPUT = resolve(import.meta.dir, "../catalog/nbs-official-en.json");

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}
const delayMs = Math.max(600, Number(option("delay") ?? "1000"));
const outputPath = resolve(option("out") ?? DEFAULT_OUTPUT);
const partialPath = `${outputPath}.partial`;

interface Entry { currentKey: string; nameZh: string; nameEn: string; sourceUrl: string; capturedAt: string; legacyDatabase: string; legacyIndicatorCode: string }

const snapshot: unknown = await readCatalogSnapshot();
const list = typeof snapshot === "object" && snapshot !== null ? Reflect.get(snapshot, "entries") : undefined;
if (!Array.isArray(list)) throw new Error("no catalog snapshot");
const byId = new Map<string, { name: string; cid: string; datasetCode: number }>();
for (const raw of list) {
  if (typeof raw !== "object" || raw === null) continue;
  const id = Reflect.get(raw, "id"), name = Reflect.get(raw, "name"), cid = Reflect.get(raw, "cid"), datasetCode = Reflect.get(raw, "datasetCode");
  if (typeof id === "string" && typeof name === "string" && typeof cid === "string" && typeof datasetCode === "number") byId.set(id, { name: name.trim(), cid, datasetCode });
}
const cids = [...new Set([...byId.values()].map((entry) => entry.cid))];

// Resume: keep entries already collected and skip their tables.
const entries: Entry[] = [];
const doneCids = new Set<string>();
const previous = Bun.file(partialPath);
if (await previous.exists()) {
  const raw: unknown = await previous.json();
  const held = typeof raw === "object" && raw !== null ? Reflect.get(raw, "entries") : undefined;
  const done = typeof raw === "object" && raw !== null ? Reflect.get(raw, "doneCids") : undefined;
  if (Array.isArray(held)) for (const entry of held) entries.push(entry as Entry);
  if (Array.isArray(done)) for (const cid of done) if (typeof cid === "string") doneCids.add(cid);
  console.log(`Resuming: ${entries.length} titles from ${doneCids.size} tables`);
}

async function getJson(path: string, attempt = 1): Promise<unknown> {
  const response = await fetch(`${API}${path}`, {
    headers: { Accept: "application/json", Referer: "https://data.stats.gov.cn/dg/website/page.html" },
    signal: AbortSignal.timeout(30_000),
  }).catch((error: unknown) => { throw new Error(error instanceof Error ? error.message : String(error)); });
  const text = await response.text();
  if (response.ok && text.trimStart().startsWith("{")) return JSON.parse(text);
  if (attempt >= 5) throw new Error(`HTTP ${response.status}: ${text.slice(0, 80)}`);
  // The portal throttles a busy visitor; back off and try again.
  await Bun.sleep(delayMs * 5 * attempt);
  return getJson(path, attempt + 1);
}

async function write(path: string, final: boolean): Promise<void> {
  const body = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: "National Bureau of Statistics of China, English mode of the National Data portal",
    entries,
    ...(final ? {} : { doneCids: [...doneCids] }),
  };
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(`${path}.tmp`, `${JSON.stringify(body)}\n`);
  await rename(`${path}.tmp`, path);
}

const errors: { cid: string; message: string }[] = [];
let sinceCheckpoint = 0;
const todo = cids.filter((cid) => !doneCids.has(cid));
console.log(`${todo.length} tables to read (${cids.length} in the catalog)`);
for (const [index, cid] of todo.entries()) {
  try {
    const raw = await getJson(`/new/queryIndicatorsByCid?cid=${encodeURIComponent(cid)}&dt=&name=`);
    const data = typeof raw === "object" && raw !== null ? Reflect.get(raw, "data") : undefined;
    const rows = typeof data === "object" && data !== null ? Reflect.get(data, "list") : undefined;
    const capturedAt = new Date().toISOString();
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (typeof row !== "object" || row === null) continue;
        const id = Reflect.get(row, "_id"), nameEn = Reflect.get(row, "i_showname");
        if (typeof id !== "string" || typeof nameEn !== "string") continue;
        const known = byId.get(id);
        const title = nameEn.replace(/\s+/g, " ").trim();
        // Only a title the bureau actually translated: one that still reads as Chinese is the untranslated fallback.
        if (!known || !title || /[㐀-鿿]/.test(title)) continue;
        entries.push({ currentKey: `nbs_${id}`, nameZh: known.name, nameEn: title, sourceUrl: `${API}/new/queryIndicatorsByCid?cid=${cid}`, capturedAt, legacyDatabase: "portal-en", legacyIndicatorCode: id });
      }
    }
    doneCids.add(cid);
  } catch (error) {
    errors.push({ cid, message: error instanceof Error ? error.message : String(error) });
    console.warn(`  ${cid}: ${errors.at(-1)?.message}`);
  }
  sinceCheckpoint += 1;
  if (sinceCheckpoint >= 100) { await write(partialPath, false); sinceCheckpoint = 0; console.log(`${index + 1}/${todo.length} tables, ${entries.length} titles`); }
  if (index < todo.length - 1) await Bun.sleep(delayMs);
}
await write(outputPath, true);
await rm(partialPath, { force: true });
console.log(`Wrote ${entries.length} official English titles for ${doneCids.size} tables to ${outputPath}; ${errors.length} tables failed`);
