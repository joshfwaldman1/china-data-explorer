/**
 * A small reader for legacy .xls workbooks (BIFF8), the companion to
 * xlsx.ts: enough to take a statistical table out of a publisher's
 * spreadsheet without a dependency.
 *
 * SAFE, among others, still publishes time series in Excel 97 format. Such a
 * file is not a zip but an OLE2 compound document: a little filesystem of
 * 512-byte sectors chained through a file allocation table, holding a stream
 * called "Workbook" of BIFF records. This reads that container, then the
 * records that carry values — shared strings, numbers, RK-encoded numbers and
 * cached formula results — and returns every cell by address, the same shape
 * xlsx.ts returns. Styles, dates as dates, merges and everything else are
 * ignored; a date comes back as the serial number Excel stores, as it does
 * from xlsx.ts.
 */

import type { Sheet } from "./xlsx";

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const END_OF_CHAIN = 0xfffffffe;
const FREE_SECTOR = 0xffffffff;

/** The compound-document container: its sector tables and the streams inside it. */
class Container {
  private readonly view: DataView;
  private readonly sectorSize: number;
  private readonly miniSectorSize: number;
  private readonly miniCutoff: number;
  private readonly fat: number[] = [];
  private readonly miniFat: number[] = [];
  private miniStream: Uint8Array = new Uint8Array(0);
  /** Stream name to its first sector and byte length. */
  readonly streams = new Map<string, { start: number; size: number }>();

  constructor(private readonly bytes: Uint8Array) {
    if (bytes.length < 512 || SIGNATURE.some((byte, index) => bytes[index] !== byte)) throw new Error("xls: not a compound document");
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.sectorSize = 1 << this.view.getUint16(30, true);
    this.miniSectorSize = 1 << this.view.getUint16(32, true);
    this.miniCutoff = this.view.getUint32(56, true);
    this.readFat();
    this.readMiniFat();
    this.readDirectory();
  }

  private sectorOffset(sector: number): number { return (sector + 1) * this.sectorSize; }

  /** The file allocation table, from the 109 entries in the header and any DIFAT sectors after them. */
  private readFat(): void {
    const sectors: number[] = [];
    for (let index = 0; index < 109; index += 1) {
      const sector = this.view.getUint32(76 + index * 4, true);
      if (sector === FREE_SECTOR || sector === END_OF_CHAIN) break;
      sectors.push(sector);
    }
    // Each DIFAT sector holds more FAT sector numbers and, in its last slot, the next DIFAT sector.
    let next = this.view.getUint32(68, true);
    const perSector = this.sectorSize / 4;
    for (let guard = 0; next !== END_OF_CHAIN && next !== FREE_SECTOR && guard < 4096; guard += 1) {
      const base = this.sectorOffset(next);
      for (let index = 0; index < perSector - 1; index += 1) {
        const sector = this.view.getUint32(base + index * 4, true);
        if (sector === FREE_SECTOR || sector === END_OF_CHAIN) continue;
        sectors.push(sector);
      }
      next = this.view.getUint32(base + (perSector - 1) * 4, true);
    }
    for (const sector of sectors) {
      const base = this.sectorOffset(sector);
      for (let index = 0; index < perSector; index += 1) this.fat.push(this.view.getUint32(base + index * 4, true));
    }
  }

  private readMiniFat(): void {
    const perSector = this.sectorSize / 4;
    let sector = this.view.getUint32(60, true);
    for (let guard = 0; sector !== END_OF_CHAIN && sector !== FREE_SECTOR && guard < 4096; guard += 1) {
      const base = this.sectorOffset(sector);
      for (let index = 0; index < perSector; index += 1) this.miniFat.push(this.view.getUint32(base + index * 4, true));
      sector = this.fat[sector] ?? END_OF_CHAIN;
    }
  }

  /** The chain of sectors starting at `start`, as one buffer of at least `size` bytes. */
  private readChain(start: number, size: number, mini: boolean): Uint8Array {
    const unit = mini ? this.miniSectorSize : this.sectorSize;
    const table = mini ? this.miniFat : this.fat;
    const out = new Uint8Array(Math.max(0, size));
    let sector = start, written = 0;
    for (let guard = 0; sector !== END_OF_CHAIN && sector !== FREE_SECTOR && written < out.length && guard < 1_000_000; guard += 1) {
      const offset = mini ? sector * unit : this.sectorOffset(sector);
      const source = mini ? this.miniStream.subarray(offset, offset + unit) : this.bytes.subarray(offset, offset + unit);
      out.set(source.subarray(0, Math.min(unit, out.length - written)), written);
      written += unit;
      sector = table[sector] ?? END_OF_CHAIN;
    }
    return out;
  }

  /** Directory entries name the streams; the root entry also holds the mini stream. */
  private readDirectory(): void {
    const first = this.view.getUint32(48, true);
    const directory = this.readChain(first, this.sectorSize * 1024, false);
    const view = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
    for (let at = 0; at + 128 <= directory.length; at += 128) {
      const nameLength = view.getUint16(at + 64, true);
      const type = view.getUint8(at + 66);
      if (type === 0) continue; // unallocated
      const name = new TextDecoder("utf-16le").decode(directory.subarray(at, at + Math.max(0, nameLength - 2)));
      const start = view.getUint32(at + 116, true);
      const size = view.getUint32(at + 120, true);
      if (type === 5) { // the root entry: its stream is the mini stream every small stream lives in
        this.miniStream = this.readChain(start, size, false);
        continue;
      }
      if (type === 2) this.streams.set(name, { start, size });
    }
  }

  read(name: string): Uint8Array | null {
    const stream = this.streams.get(name);
    if (!stream) return null;
    return this.readChain(stream.start, stream.size, stream.size < this.miniCutoff).subarray(0, stream.size);
  }
}

/** One BIFF record: its type, and the bytes after the four-byte header. */
interface Record { type: number; data: Uint8Array }

function records(stream: Uint8Array): Record[] {
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  const out: Record[] = [];
  for (let at = 0; at + 4 <= stream.length; ) {
    const type = view.getUint16(at, true);
    const length = view.getUint16(at + 2, true);
    if (at + 4 + length > stream.length) break;
    out.push({ type, data: stream.subarray(at + 4, at + 4 + length) });
    at += 4 + length;
  }
  return out;
}

/**
 * The shared string table, which spans an SST record and any CONTINUE
 * records after it. Each string is a length, a flags byte saying whether its
 * characters are one or two bytes wide and whether rich-text or phonetic data
 * follows, and then the characters. A string may be cut across a CONTINUE
 * boundary, where a fresh flags byte says how the rest is stored.
 */
function sharedStrings(sst: Uint8Array, continues: Uint8Array[]): string[] {
  const parts = [sst, ...continues];
  let part = 0, at = 8; // the SST record opens with two counts
  const view = () => new DataView(parts[part]!.buffer, parts[part]!.byteOffset, parts[part]!.byteLength);
  const remaining = () => parts[part]!.length - at;
  /** Move to the next part when the current one is spent; false when there is none. */
  const advance = (): boolean => {
    while (part < parts.length && remaining() <= 0) { part += 1; at = 0; }
    return part < parts.length;
  };
  const total = new DataView(sst.buffer, sst.byteOffset, sst.byteLength).getUint32(4, true);
  const out: string[] = [];
  for (let index = 0; index < total; index += 1) {
    if (!advance()) break;
    if (remaining() < 3) { part += 1; at = 0; if (!advance()) break; }
    const characters = view().getUint16(at, true); at += 2;
    let flags = parts[part]![at] ?? 0; at += 1;
    let wide = (flags & 0x01) !== 0;
    const rich = (flags & 0x08) !== 0, phonetic = (flags & 0x04) !== 0;
    let runs = 0, phoneticSize = 0;
    if (rich) { runs = view().getUint16(at, true); at += 2; }
    if (phonetic) { phoneticSize = view().getUint32(at, true); at += 4; }
    let text = "";
    let left = characters;
    while (left > 0) {
      if (!advance()) break;
      const available = Math.floor(remaining() / (wide ? 2 : 1));
      const take = Math.min(left, available);
      const slice = parts[part]!.subarray(at, at + take * (wide ? 2 : 1));
      text += wide ? new TextDecoder("utf-16le").decode(slice) : latin(slice);
      at += take * (wide ? 2 : 1);
      left -= take;
      if (left > 0) {
        // The rest of the string sits in the next record, behind its own flags byte.
        part += 1; at = 0;
        if (part >= parts.length) break;
        flags = parts[part]![at] ?? 0; at += 1;
        wide = (flags & 0x01) !== 0;
      }
    }
    if (rich) at += runs * 4;
    if (phonetic) at += phoneticSize;
    out.push(text);
  }
  return out;
}

/** BIFF's one-byte-per-character strings are code page 1252 for the characters that matter here. */
function latin(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

/** An RK number: two flag bits say whether it is a truncated double or a 30-bit integer, and whether to divide by 100. */
function rkValue(raw: number): number {
  const hundredth = (raw & 0x01) !== 0;
  const integer = (raw & 0x02) !== 0;
  let value: number;
  if (integer) {
    value = raw >> 2; // arithmetic shift keeps the sign
  } else {
    const buffer = new ArrayBuffer(8);
    new DataView(buffer).setUint32(4, raw & 0xfffffffc, true);
    value = new DataView(buffer).getFloat64(0, true);
  }
  return hundredth ? value / 100 : value;
}

export function columnLetters(number: number): string {
  let letters = "";
  for (let value = number; value > 0; value = Math.floor((value - 1) / 26)) {
    letters = String.fromCharCode(65 + ((value - 1) % 26)) + letters;
  }
  return letters;
}

/** A zero-based row and column as an Excel address ("B4"). */
function address(row: number, column: number): string {
  return `${columnLetters(column + 1)}${row + 1}`;
}

/**
 * Every sheet of a BIFF8 workbook, in workbook order, with its cells by
 * address. A sheet the workbook names but whose records are missing comes
 * back empty rather than throwing.
 */
export function readXls(input: ArrayBuffer | Uint8Array): Sheet[] {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const container = new Container(bytes);
  const stream = container.read("Workbook") ?? container.read("Book");
  if (!stream) throw new Error("xls: no workbook stream");
  const all = records(stream);

  // The global substream names the sheets and holds the shared strings.
  const sheets: { name: string; position: number }[] = [];
  let strings: string[] = [];
  for (let index = 0; index < all.length; index += 1) {
    const record = all[index]!;
    if (record.type === 0x0085) { // BOUNDSHEET
      const view = new DataView(record.data.buffer, record.data.byteOffset, record.data.byteLength);
      const position = view.getUint32(0, true);
      const nameLength = record.data[6] ?? 0;
      const wide = ((record.data[7] ?? 0) & 0x01) !== 0;
      const raw = record.data.subarray(8, 8 + nameLength * (wide ? 2 : 1));
      sheets.push({ name: wide ? new TextDecoder("utf-16le").decode(raw) : latin(raw), position });
    }
    if (record.type === 0x00fc) { // SST, with its CONTINUE records
      const continues: Uint8Array[] = [];
      for (let after = index + 1; after < all.length && all[after]!.type === 0x003c; after += 1) continues.push(all[after]!.data);
      strings = sharedStrings(record.data, continues);
    }
    if (record.type === 0x000a && sheets.length > 0) break; // EOF of the global substream
  }

  // Walk the stream again by byte offset, so each sheet's records are the ones after its BOF.
  const offsets = new Map<number, number>(); // byte offset -> index in `all`
  {
    let at = 0;
    for (let index = 0; index < all.length; index += 1) { offsets.set(at, index); at += 4 + all[index]!.data.length; }
  }
  return sheets.map((sheet) => {
    const cells = new Map<string, string | number>();
    const start = offsets.get(sheet.position);
    if (start === undefined) return { name: sheet.name, cells };
    for (let index = start + 1; index < all.length; index += 1) {
      const record = all[index]!;
      if (record.type === 0x000a) break; // EOF: the end of this sheet's substream
      const data = record.data;
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      if (record.type === 0x00fd && data.length >= 10) { // LABELSST
        const text = strings[view.getUint32(6, true)];
        if (text !== undefined) cells.set(address(view.getUint16(0, true), view.getUint16(2, true)), text);
      } else if (record.type === 0x0203 && data.length >= 14) { // NUMBER
        cells.set(address(view.getUint16(0, true), view.getUint16(2, true)), view.getFloat64(6, true));
      } else if (record.type === 0x027e && data.length >= 10) { // RK
        cells.set(address(view.getUint16(0, true), view.getUint16(2, true)), rkValue(view.getUint32(6, true)));
      } else if (record.type === 0x00bd && data.length >= 6) { // MULRK: a run of RK cells across one row
        const row = view.getUint16(0, true), firstColumn = view.getUint16(2, true);
        const count = Math.floor((data.length - 6) / 6);
        for (let offset = 0; offset < count; offset += 1) {
          cells.set(address(row, firstColumn + offset), rkValue(view.getUint32(4 + offset * 6 + 2, true)));
        }
      } else if (record.type === 0x0006 && data.length >= 14) { // FORMULA: the cached result
        // A result whose last two bytes are 0xFFFF is a string, boolean or error, not a number.
        if (view.getUint16(12, true) !== 0xffff) cells.set(address(view.getUint16(0, true), view.getUint16(2, true)), view.getFloat64(6, true));
        else if (data[6] === 0x00) { // a string result, carried by the STRING record that follows
          const next = all[index + 1];
          if (next && next.type === 0x0207 && next.data.length >= 3) {
            const length = new DataView(next.data.buffer, next.data.byteOffset, next.data.byteLength).getUint16(0, true);
            const wide = ((next.data[2] ?? 0) & 0x01) !== 0;
            const raw = next.data.subarray(3, 3 + length * (wide ? 2 : 1));
            cells.set(address(view.getUint16(0, true), view.getUint16(2, true)), wide ? new TextDecoder("utf-16le").decode(raw) : latin(raw));
          }
        }
      } else if (record.type === 0x0204 && data.length >= 8) { // LABEL: a plain string cell (BIFF5 and some writers)
        const length = view.getUint16(6, true);
        const wide = ((data[8] ?? 0) & 0x01) !== 0;
        const raw = data.subarray(9, 9 + length * (wide ? 2 : 1));
        cells.set(address(view.getUint16(0, true), view.getUint16(2, true)), wide ? new TextDecoder("utf-16le").decode(raw) : latin(raw));
      }
    }
    return { name: sheet.name, cells };
  });
}
