/**
 * Energy production: the bureau's own tables, read as the adapter reads them.
 *
 * The acceptance test of this round is the one a wrong table would fail:
 * NBS publishes electricity generation and, separately, a table for each
 * generating source, and the five sources must add up to the total in the
 * month the bureau published them. The fixture is the bureau's answer for
 * January 2025 to August 2026, captured on 21 September 2026, one request per
 * table.
 *
 * It also records what the bureau does not publish. There is no January
 * figure for a monthly production series and no February month figure; the
 * year to date at February covers the two months together. The month lines
 * are simply absent until March, which is why nothing here carries a
 * `januaryFebruaryId`: a two-month total served as February would be wrong
 * by a month.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-energy-")), "test.db");
process.env.CHINA_SEED = "off";
const { CATALOG, nbsPeriodValue } = await import("./data.ts");
const { readCatalogSnapshot } = await import("./catalog-file.ts");
const { CONCORDANCE_PAIRS, compareComponentSum } = await import("./concordance.ts");

const NATION = "000000000000";
interface Line { id: string; label: string; cid?: string }
interface RawValue { _id?: string; da?: string; value?: unknown }
interface RawPeriod { code?: string; values?: RawValue[] }

const fixture: Record<string, { data?: RawPeriod[] }> =
  await Bun.file(resolve(import.meta.dir, "fixtures/nbs/energy-output-202608.json")).json();

const lines = (key: string) => Reflect.get(CATALOG[key] as object, "ids") as Line[];
const tableOf = (key: string, line: Line) => line.cid ?? (Reflect.get(CATALOG[key] as object, "cid") as string);

/** One line of a key, read out of the fixture the way `fetchNbs` reads a live answer. */
function seriesOf(key: string, label: string): { date: string; value: number }[] {
  const line = lines(key).find((candidate) => candidate.label === label);
  if (!line) throw new Error(`no line ${label} on ${key}`);
  const periods = fixture[tableOf(key, line)]?.data ?? [];
  const points: { date: string; value: number }[] = [];
  for (const period of periods) {
    const code = String(period.code ?? "");
    const month = code.match(/^(\d{4})(\d{2})/);
    if (!month) continue;
    const date = `${month[1]}-${month[2]}`;
    const raw = nbsPeriodValue(period.values ?? [], line, NATION, date);
    const value = Number(raw);
    if (raw === null || raw === undefined || raw === "" || Number.isNaN(value)) continue;
    points.push({ date, value });
  }
  return points.sort((left, right) => left.date.localeCompare(right.date));
}

const at = (key: string, label: string, date: string) => seriesOf(key, label).find((point) => point.date === date)?.value;
const SOURCES = ["Thermal", "Hydro", "Nuclear", "Wind", "Solar"].map((name) => `${name}, month (亿千瓦时)`);

test("August 2026 generation by source is the bureau's own figures", () => {
  expect(at("electricity_by_source", "Total, month (亿千瓦时)", "2026-08")).toBe(9437.8);
  expect(SOURCES.map((label) => at("electricity_by_source", label, "2026-08"))).toEqual([6020.3, 1522.1, 466.6, 728.5, 700.2]);
  expect(at("electricity_by_source", "Total, year to date (亿千瓦时)", "2026-08")).toBe(66476.1);
  expect(at("electricity_by_source_growth", "Solar (YoY %)", "2026-08")).toBe(10.3);
});

test("the five generating sources add up to the published total, in every month both are published", () => {
  const result = compareComponentSum(
    "sources vs total",
    SOURCES.map((label) => seriesOf("electricity_by_source", label)),
    seriesOf("electricity_by_source", "Total, month (亿千瓦时)"),
    { tolerance: 1, periods: 12 },
  );
  expect(result.status).toBe("ok");
  expect(result.compared).toBe(12);
  expect(result.latest?.period).toBe("2026-08");
  // The sum of five figures each rounded to 0.1 lands within a tenth of the total.
  expect(Math.abs((result.latest?.left ?? 0) - (result.latest?.right ?? 0))).toBeLessThanOrEqual(0.2);
});

test("a source read from the wrong table is a finding, not a rounding difference", () => {
  const parts = SOURCES.map((label) => seriesOf("electricity_by_source", label));
  // Thermal at a tenth of its size: what reading the table in 万千瓦时 would do.
  const wrong = [parts[0]!.map((point) => ({ ...point, value: point.value / 10 })), ...parts.slice(1)];
  const result = compareComponentSum("sources vs total", wrong, seriesOf("electricity_by_source", "Total, month (亿千瓦时)"), { tolerance: 1, periods: 12 });
  expect(result.status).toBe("mismatch");
  expect(result.disagreements.length).toBe(12);
});

test("no January, and February's figure is the year to date for two months", () => {
  const month = seriesOf("electricity_by_source", "Total, month (亿千瓦时)");
  const yearToDate = seriesOf("electricity_by_source", "Total, year to date (亿千瓦时)");
  expect(month.some((point) => point.date.endsWith("-01") || point.date.endsWith("-02"))).toBe(false);
  expect(yearToDate.some((point) => point.date === "2026-02")).toBe(true);
  // No line carries a January-February fallback: a two-month total is not a month.
  for (const key of ["electricity_by_source", "fuel_output", "natural_gas_output"]) {
    for (const line of lines(key)) expect(Reflect.get(line, "januaryFebruaryId")).toBeUndefined();
  }
});

test("coal, oil and gas are the bureau's own figures, and weights are apart from volumes", () => {
  expect(at("fuel_output", "Raw coal, month (10,000 tonnes)", "2026-08")).toBe(36182.3);
  expect(at("fuel_output", "Crude oil, month (10,000 tonnes)", "2026-08")).toBe(1843.3);
  expect(at("natural_gas_output", "Natural gas, month (亿立方米)", "2026-08")).toBe(214.2);
  expect(at("fuel_output_growth", "Raw coal (YoY %)", "2026-08")).toBe(-7.7);
  expect(Reflect.get(CATALOG.fuel_output as object, "unit")).toBe("Ten thousand tonnes (万吨)");
  expect(Reflect.get(CATALOG.natural_gas_output as object, "unit")).toBe("Hundred million cubic metres (亿立方米)");
});

test("every id resolves in the shipped snapshot, to the series its label claims", async () => {
  interface Entry { id: string; name: string; cid: string; datasetCode: number }
  const isEntry = (value: unknown): value is Entry =>
    typeof value === "object" && value !== null && typeof Reflect.get(value, "id") === "string" && typeof Reflect.get(value, "name") === "string";
  const snapshot: unknown = await readCatalogSnapshot();
  const list = typeof snapshot === "object" && snapshot !== null ? Reflect.get(snapshot, "entries") : undefined;
  const byId = new Map((Array.isArray(list) ? list : []).filter(isEntry).map((entry) => [entry.id, entry]));
  const expected: Record<string, string[]> = {
    electricity_by_source: ["发电量当期值 (亿千瓦时)", "火力发电量当期值 (亿千瓦时)", "水力发电量当期值 (亿千瓦时)", "核能发电量当期值 (亿千瓦时)", "风力发电量当期值 (亿千瓦时)", "太阳能发电量当期值 (亿千瓦时)", "发电量累计值 (亿千瓦时)"],
    electricity_by_source_growth: ["发电量同比增长 (%)", "火力发电量同比增长 (%)", "水力发电量同比增长 (%)", "核能发电量同比增长 (%)", "风力发电量同比增长 (%)", "太阳能发电量同比增长 (%)"],
    fuel_output: ["原煤产量当期值 (万吨)", "原油产量当期值 (万吨)", "原煤产量累计值 (万吨)", "原油产量累计值 (万吨)"],
    natural_gas_output: ["天然气产量当期值 (亿立方米)", "天然气产量累计值 (亿立方米)"],
    fuel_output_growth: ["原煤产量同比增长 (%)", "原油产量同比增长 (%)", "天然气产量同比增长 (%)"],
  };
  for (const [key, names] of Object.entries(expected)) {
    expect(lines(key).map((line) => byId.get(line.id)?.name.replace(/\s+/g, " ").trim())).toEqual(names);
    for (const line of lines(key)) {
      expect(byId.get(line.id)?.datasetCode).toBe(1);
      expect(byId.get(line.id)?.cid).toBe(tableOf(key, line));
    }
  }
});

test("the audit carries the sum check and the three year-to-date checks", () => {
  const sum = CONCORDANCE_PAIRS.find((pair) => pair.name.startsWith("Electricity generation: sources"));
  expect(sum?.kind).toBe("components");
  if (sum?.kind !== "components") throw new Error("expected a components pair");
  expect(sum.parts.map((part) => part.label)).toEqual(SOURCES);
  expect(sum.total?.label).toBe("Total, month (亿千瓦时)");
  for (const name of ["Electricity generation: month vs year to date", "Raw coal output: month vs year to date", "Natural gas output: month vs year to date"]) {
    const pair = CONCORDANCE_PAIRS.find((candidate) => candidate.name.startsWith(name));
    expect(pair?.kind).toBe("cumulative");
    if (pair?.kind !== "cumulative") throw new Error(`expected a cumulative pair for ${name}`);
    // Levels: a month is part of its year to date, and the bureau prints no January.
    expect(pair.periodWithin).toBe(true);
    expect(pair.firstPeriodAgrees).toBe(false);
  }
});
