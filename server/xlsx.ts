/**
 * A small reader for .xlsx workbooks: enough to take a statistical table
 * out of a publisher's spreadsheet without a dependency.
 *
 * An .xlsx file is a zip of XML parts. This reads the zip's central
 * directory, inflates the parts it needs (the workbook, its relationships,
 * the shared strings and each worksheet), and returns every cell's value by
 * address. Formulas are read by their cached value; dates come back as the
 * serial number Excel stores. Styles, merges and everything else are ignored.
 */

import { inflateRawSync } from "node:zlib";

export interface Sheet { name: string; cells: Map<string, string | number> }

/** The zip's entries by name: offset and sizes from the central directory. */
function zipEntries(bytes: Uint8Array): Map<string, { offset: number; compressed: number; method: number }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record is within the last 64 KiB, marked 0x06054b50.
  let eocd = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65_557); at -= 1) {
    if (view.getUint32(at, true) === 0x06054b50) { eocd = at; break; }
  }
  if (eocd < 0) throw new Error("xlsx: not a zip file");
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const entries = new Map<string, { offset: number; compressed: number; method: number }>();
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error("xlsx: bad central directory");
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true), extraLength = view.getUint16(at + 30, true), commentLength = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    entries.set(name, { offset, compressed, method });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readPart(bytes: Uint8Array, entries: Map<string, { offset: number; compressed: number; method: number }>, name: string): string | null {
  const entry = entries.get(name);
  if (!entry) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(entry.offset, true) !== 0x04034b50) throw new Error(`xlsx: bad local header for ${name}`);
  const nameLength = view.getUint16(entry.offset + 26, true), extraLength = view.getUint16(entry.offset + 28, true);
  const start = entry.offset + 30 + nameLength + extraLength;
  const data = bytes.subarray(start, start + entry.compressed);
  const raw = entry.method === 0 ? data : entry.method === 8 ? new Uint8Array(inflateRawSync(data)) : null;
  if (!raw) throw new Error(`xlsx: unsupported compression ${entry.method} for ${name}`);
  return new TextDecoder().decode(raw);
}

function unescape(text: string): string {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/&amp;/g, "&");
}

/** Every sheet of the workbook, in workbook order, with its cells by address ("B4"). */
export function readXlsx(input: ArrayBuffer | Uint8Array): Sheet[] {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const entries = zipEntries(bytes);
  const workbook = readPart(bytes, entries, "xl/workbook.xml") ?? "";
  const rels = readPart(bytes, entries, "xl/_rels/workbook.xml.rels") ?? "";
  const targets = new Map<string, string>();
  for (const rel of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = rel[0].match(/\bId="([^"]+)"/)?.[1], target = rel[0].match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) targets.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  }
  const shared: string[] = [];
  for (const item of (readPart(bytes, entries, "xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    shared.push(unescape([...(item[1] ?? "").matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1] ?? "").join("")));
  }
  const sheets: Sheet[] = [];
  for (const sheet of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = unescape(sheet[0].match(/\bname="([^"]*)"/)?.[1] ?? "");
    const id = sheet[0].match(/\br:id="([^"]+)"/)?.[1] ?? "";
    const xml = readPart(bytes, entries, targets.get(id) ?? "");
    if (xml === null) continue;
    const cells = new Map<string, string | number>();
    for (const cell of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const address = cell[1] ?? "", attributes = cell[2] ?? "", body = cell[3] ?? "";
      const type = attributes.match(/\bt="([^"]+)"/)?.[1];
      if (type === "inlineStr") { cells.set(address, unescape([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1] ?? "").join(""))); continue; }
      const value = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      if (value === undefined) continue;
      if (type === "s") cells.set(address, shared[Number(value)] ?? "");
      else if (type === "str" || type === "b" || type === "e") cells.set(address, unescape(value));
      else cells.set(address, Number(value));
    }
    sheets.push({ name, cells });
  }
  return sheets;
}

/** "AB" -> 28: a column letter to its number. */
export function columnNumber(letters: string): number {
  let out = 0;
  for (const char of letters) out = out * 26 + (char.charCodeAt(0) - 64);
  return out;
}

/** 28 -> "AB". */
export function columnLetters(number: number): string {
  let out = "";
  for (let n = number; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
  return out;
}
