/**
 * One-time translation of the catalog's prose: NBS definitions (note),
 * methodology annotations, category names and dataset names. Titles are
 * handled by translate-catalog.ts; this covers everything else a series page
 * shows in Chinese only.
 *
 * Writes catalog/notes-en.json as { chinese: english }. Re-running only
 * translates strings the table does not have yet.
 *
 *   bun run scripts/translate-notes.ts
 *   bun run scripts/translate-notes.ts --limit=50
 */

import Anthropic from "@anthropic-ai/sdk";
import { resolve } from "node:path";
import { readCatalogSnapshot } from "../server/catalog-file.ts";
import { parseTableNotes } from "../shared/catalog-notes";

const NOTES_PATH = resolve(import.meta.dir, "../catalog/notes-en.json");
const BATCH = 40;
const CONCURRENCY = 4;
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.slice("--limit=".length)) : Infinity;

const SYSTEM = `You translate text from the Chinese National Bureau of Statistics data portal into clear English for economists.
The inputs are a mix of: indicator definitions, methodology notes (e.g. changes in coverage thresholds or classification), category names from the NBS index tree, and dataset names.
Rules: keep the sense exact and the register plain; use standard statistical English (规模以上工业企业 → industrial enterprises above designated size; 累计 → year to date; 当期 → current period; 本期累计 → cumulative for the year; 同比 → year on year). Category names should be short noun phrases in sentence case. Do not add commentary or explanations.
Reply with a JSON object only: each input string mapped exactly to its translation.`;

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

function stringAt(value: unknown, key: string): string {
  const found = typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
  return typeof found === "string" ? found.trim() : "";
}

const catalog: unknown = await readCatalogSnapshot();
const entries = typeof catalog === "object" && catalog !== null ? Reflect.get(catalog, "entries") : undefined;
if (!Array.isArray(entries)) throw new Error("catalog snapshot missing");

const strings = new Set<string>();
for (const entry of entries) {
  for (const field of ["note", "annotation", "dataset"]) { const text = stringAt(entry, field); if (text) strings.add(text); }
  for (const note of parseTableNotes(entry?.tableNotes)) { strings.add(note.text); strings.add(note.name); }
  const categories = typeof entry === "object" && entry !== null ? Reflect.get(entry, "categories") : undefined;
  if (Array.isArray(categories)) for (const category of categories) if (typeof category === "string" && category.trim()) strings.add(category.trim());
}

let table: Record<string, string> = {};
try {
  const raw: unknown = await Bun.file(NOTES_PATH).json();
  if (typeof raw === "object" && raw !== null) table = Object.fromEntries(Object.entries(raw).filter(([, value]) => typeof value === "string"));
} catch { /* first run */ }

const todo = [...strings].filter((text) => !table[text]).slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined);
console.log(`${strings.size} strings; ${Object.keys(table).length} already translated; ${todo.length} to do in batches of ${BATCH}`);

const batches: string[][] = [];
for (let index = 0; index < todo.length; index += BATCH) batches.push(todo.slice(index, index + BATCH));
let done = 0;
for (let index = 0; index < batches.length; index += CONCURRENCY) {
  const group = batches.slice(index, index + CONCURRENCY);
  const results = await Promise.all(group.map((batch) => translate(batch).catch((error) => {
    console.log(`  a batch failed: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  })));
  for (const result of results) { Object.assign(table, result); done += Object.keys(result).length; }
  await Bun.write(NOTES_PATH, JSON.stringify(table, null, 1));
  console.log(`  ${done}/${todo.length}`);
}
console.log(`wrote ${NOTES_PATH} with ${Object.keys(table).length} entries`);
