/**
 * Industrial output by sector, against the bureau's own release.
 *
 * NBS publishes the value added of firms above the designated size for all
 * 41 two-digit industries, and its monthly release names sixteen of them in
 * prose: "汽车制造业增长8.7%". The table and the prose are written by the
 * same bureau from the same figures, so any difference between them is this
 * site's mistake — a line pointed at the wrong industry, a rate read off the
 * year-to-date column, a sign dropped from a fall. The acceptance test of
 * this round reads the sixteen out of the release and holds the table to
 * every one.
 *
 * Both fixtures were captured on 21 September 2026: the release of
 * 15 September 2026 for August, and the bureau's answer for January 2025 to
 * August 2026 from the two tables the keys read.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-industry-")), "test.db");
process.env.CHINA_SEED = "off";
const { CATALOG, nbsPeriodValue } = await import("./data.ts");
const { readCatalogSnapshot } = await import("./catalog-file.ts");
const { CONCORDANCE_PAIRS } = await import("./concordance.ts");

const NATION = "000000000000";
interface Line { id: string; label: string; cid?: string }
interface RawPeriod { code?: string; values?: { _id?: string; da?: string; value?: unknown }[] }

const fixture: Record<string, { data?: RawPeriod[] }> =
  await Bun.file(resolve(import.meta.dir, "fixtures/nbs/industry-by-sector-202608.json")).json();
const release = await Bun.file(resolve(import.meta.dir, "fixtures/nbs/industry-release-2026-08.html")).text();

const lines = (key: string) => Reflect.get(CATALOG[key] as object, "ids") as Line[];
const tableOf = (key: string, line: Line) => line.cid ?? (Reflect.get(CATALOG[key] as object, "cid") as string);

function at(key: string, label: string, date: string): number | undefined {
  const line = lines(key).find((candidate) => candidate.label === label);
  if (!line) throw new Error(`no line ${label} on ${key}`);
  for (const period of fixture[tableOf(key, line)]?.data ?? []) {
    const month = String(period.code ?? "").match(/^(\d{4})(\d{2})/);
    if (!month || `${month[1]}-${month[2]}` !== date) continue;
    const raw = nbsPeriodValue(period.values ?? [], line, NATION, date);
    const value = Number(raw);
    return raw === null || raw === undefined || raw === "" || Number.isNaN(value) ? undefined : value;
  }
  return undefined;
}

/**
 * The sector rates the release states in prose, as a rate per industry. The
 * bureau writes a rise as "增长8.7%", a fall as "下降5.6%" and no change at
 * all as "同比持平", which is zero and must not be read as missing.
 */
function plainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;|\u00a0/g, " ").replace(/\s+/g, "");
}

function ratesInProse(html: string): Map<string, number> {
  const text = plainText(html);
  const section = text.slice(text.indexOf("分行业看"), text.indexOf("分产品看"));
  const rates = new Map<string, number>();
  for (const match of section.matchAll(/([一-龥、（）]+?业)(增长|下降|同比持平)([\d.]*)%?/g)) {
    const [, sector, direction, figure] = match;
    if (!sector || sector.length < 3) continue;
    if (direction === "同比持平") { rates.set(sector, 0); continue; }
    const value = Number(figure);
    if (Number.isNaN(value)) continue;
    rates.set(sector, direction === "下降" ? -value : value);
  }
  return rates;
}

/** The bureau's Chinese sector name for a line, from the shipped snapshot. */
const snapshot: unknown = await readCatalogSnapshot();
const entries = typeof snapshot === "object" && snapshot !== null ? Reflect.get(snapshot, "entries") : undefined;
const nameById = new Map<string, string>(
  (Array.isArray(entries) ? entries : [])
    .filter((entry): entry is { id: string; name: string } => typeof Reflect.get(entry as object, "id") === "string" && typeof Reflect.get(entry as object, "name") === "string")
    .map((entry) => [entry.id, entry.name.replace(/\s+/g, "")]),
);
const sectorOf = (line: Line) => (nameById.get(line.id) ?? "").replace(/增加值(同比|累计)增长\(%\)$/, "");

test("the release names sixteen industries, and the prose reader finds them all", () => {
  const rates = ratesInProse(release);
  expect(rates.get("汽车制造业")).toBe(8.7);
  expect(rates.get("煤炭开采和洗选业")).toBe(-5.6);
  // "同比持平" is a zero the bureau states, not a figure it omits.
  expect(rates.get("化学原料和化学制品制造业")).toBe(0);
  expect(rates.size).toBeGreaterThanOrEqual(16);
});

test("every industry the release states in prose matches the table the site reads", () => {
  const rates = ratesInProse(release);
  const checked: string[] = [];
  for (const line of lines("industrial_output_by_sector")) {
    const stated = rates.get(sectorOf(line));
    if (stated === undefined) continue;
    expect(at("industrial_output_by_sector", line.label, "2026-08"), line.label).toBe(stated);
    checked.push(line.label);
  }
  // The sixteen named in August's release, less the one that is a division.
  expect(checked.length).toBeGreaterThanOrEqual(15);
});

test("all 41 two-digit industries are carried, in the classification's own order", () => {
  const month = lines("industrial_output_by_sector");
  const yearToDate = lines("industrial_output_by_sector_ytd");
  expect(month.length).toBe(41);
  expect(yearToDate.length).toBe(41);
  // The release says how many there are, which is the check that none was dropped.
  expect(plainText(release).includes("41个大类行业")).toBe(true);
  expect(sectorOf(month[0]!)).toBe("煤炭开采和洗选业");
  expect(sectorOf(month.at(-1)!)).toBe("水的生产和供应业");
  // The two halves line up sector for sector, so a pair can name one industry on both sides.
  expect(yearToDate.map(sectorOf)).toEqual(month.map(sectorOf));
  for (const line of month) expect(at("industrial_output_by_sector", line.label, "2026-08")).toBeTypeOf("number");
});

test("the three divisions are the ones the release leads with", () => {
  expect(at("industrial_output_by_division", "Mining (YoY %)", "2026-08")).toBe(-1.4);
  expect(at("industrial_output_by_division", "Manufacturing (YoY %)", "2026-08")).toBe(6.1);
  expect(at("industrial_output_by_division", "Production and Supply of Electricity, Heat Power, Gas and Water (YoY %)", "2026-08")).toBe(4.9);
  expect(at("industrial_output_by_division", "Manufacturing, year to date (YoY %)", "2026-08")).toBeTypeOf("number");
});

test("labels are the bureau's own English, with its boilerplate removed", () => {
  const labels = lines("industrial_output_by_sector").map((line) => line.label);
  expect(labels).toContain("Manufacture of Automobiles (YoY %)");
  expect(labels).toContain("Mining and Washing of Coal (YoY %)");
  for (const label of labels) {
    expect(label.endsWith(" (YoY %)")).toBe(true);
    expect(label).not.toContain("Value-added of");
    expect(label).not.toContain("Growth Rate");
  }
});

test("both pairs check a month against its own year to date", () => {
  for (const name of ["Motor vehicle output: month vs year to date", "Manufacturing output: month vs year to date"]) {
    const pair = CONCORDANCE_PAIRS.find((candidate) => candidate.name === name);
    expect(pair?.kind).toBe("cumulative");
    if (pair?.kind !== "cumulative") throw new Error(`expected a cumulative pair for ${name}`);
    // Rates, so no periodWithin: a month can grow faster than the year has.
    expect(pair.periodWithin).toBeUndefined();
    expect(pair.firstPeriodAgrees).toBe(false);
  }
});
