/**
 * One-time translation of the catalog's base concepts to English.
 *
 * Titles reduce to ~6,500 base concepts × a closed set of measures and units
 * (see gloss.ts). This sends the bases to Claude in batches and writes
 * catalog/gloss-en.json, which gloss.ts then prefers over its token
 * dictionary. Re-running only translates what the table does not have yet.
 *
 *   bun run china-explorer/scripts/translate-catalog.ts            # everything missing
 *   bun run china-explorer/scripts/translate-catalog.ts --limit=200
 */

import Anthropic from "@anthropic-ai/sdk";
import { resolve } from "node:path";
import { readCatalogSnapshot } from "../server/catalog-file.ts";
import { baseConcepts } from "../server/gloss";

const GLOSS_PATH = resolve(import.meta.dir, "../catalog/gloss-en.json");
const BATCH = 120;
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.slice("--limit=".length)) : Infinity;

const SYSTEM = `You translate the names of Chinese official statistical indicators (National Bureau of Statistics) into concise English as an economist would write them.
Rules: keep the sense exact; prefer the standard English term (国内生产总值 → GDP; 粗钢产量 → Crude steel output; 规模以上工业增加值 → Industrial value added, large firms; 城镇调查失业率 → Surveyed urban unemployment rate). Do not add units or growth wording — those are handled separately. Sentence case. No trailing period.
Reply with a JSON object only: each input string mapped exactly to its translation. No commentary.`;

const client = new Anthropic();

async function translate(batch: string[]): Promise<Record<string, string>> {
  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 16000,
    output_config: { effort: "low" },
    system: SYSTEM,
    messages: [{ role: "user", content: JSON.stringify(batch) }],
  });
  const text = response.content.map((block) => (block.type === "text" ? block.text : "")).join("");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("no JSON object in the reply");
  const parsed: unknown = JSON.parse(text.slice(start, end + 1));
  const out: Record<string, string> = {};
  if (typeof parsed === "object" && parsed !== null) {
    for (const [key, value] of Object.entries(parsed)) if (typeof value === "string" && batch.includes(key)) out[key] = value.trim();
  }
  return out;
}

const catalog: unknown = await readCatalogSnapshot();
const entries = typeof catalog === "object" && catalog !== null ? Reflect.get(catalog, "entries") : undefined;
if (!Array.isArray(entries)) throw new Error("catalog snapshot missing");
const names = entries.map((entry) => (typeof entry === "object" && entry !== null && typeof Reflect.get(entry, "name") === "string" ? Reflect.get(entry, "name") : "")).filter(Boolean);

let table: Record<string, string> = {};
try { const raw: unknown = await Bun.file(GLOSS_PATH).json(); if (typeof raw === "object" && raw !== null) table = Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string")); } catch { /* first run */ }

const bases = baseConcepts(names).filter((base) => !table[base]).slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined);
console.log(`${Object.keys(table).length} already translated; ${bases.length} to do in batches of ${BATCH}`);

// A few batches in flight at once; the table is written after each group so
// an interrupted run loses at most one group.
const CONCURRENCY = 4;
let done = 0;
const batches: string[][] = [];
for (let index = 0; index < bases.length; index += BATCH) batches.push(bases.slice(index, index + BATCH));
for (let index = 0; index < batches.length; index += CONCURRENCY) {
  const group = batches.slice(index, index + CONCURRENCY);
  const results = await Promise.all(group.map((batch) => translate(batch).catch((error) => {
    console.log(`  a batch failed: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  })));
  for (const result of results) { Object.assign(table, result); done += Object.keys(result).length; }
  await Bun.write(GLOSS_PATH, JSON.stringify(table, null, 1));
  console.log(`  ${done}/${bases.length}`);
}
console.log(`wrote ${GLOSS_PATH} with ${Object.keys(table).length} entries`);
