/**
 * What drove the quarter's growth, and the identity that checks it.
 *
 * The national accounts divide GDP growth between three expenditure
 * categories: what households and government consumed, what was invested,
 * and what was sold abroad net of what was bought. Because they divide it,
 * the three shares are three parts of one hundred percent — an identity the
 * bureau does not publish as a series, and the one thing that would catch a
 * line pointed at the wrong table or read off the cumulative column.
 *
 * The fixture is the bureau's answer for the first quarter of 2020 to the
 * second of 2026, captured on 21 September 2026.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-contrib-")), "test.db");
process.env.CHINA_SEED = "off";
const { CATALOG, nbsPeriodValue } = await import("./data.ts");
const { readCatalogSnapshot } = await import("./catalog-file.ts");
const { CONCORDANCE_PAIRS, compareComponentSum } = await import("./concordance.ts");

const CID = "62cd73e3fcb4492fab8e998ca3a7dc5b";
const NATION = "000000000000";
interface Line { id: string; label: string }
const fixture: Record<string, { data?: { code?: string; values?: { _id?: string; da?: string; value?: unknown }[] }[] }> =
  await Bun.file(resolve(import.meta.dir, "fixtures/nbs/gdp-contributions-2026q2.json")).json();
const lines = (key: string) => Reflect.get(CATALOG[key] as object, "ids") as Line[];

function seriesOf(key: string, label: string): { date: string; value: number }[] {
  const line = lines(key).find((candidate) => candidate.label === label);
  if (!line) throw new Error(`no line ${label} on ${key}`);
  const out: { date: string; value: number }[] = [];
  for (const period of fixture[CID]?.data ?? []) {
    const match = String(period.code ?? "").match(/^(\d{4})0([1-4])SS$/);
    if (!match) continue;
    const date = `${match[1]}-Q${match[2]}`;
    const raw = nbsPeriodValue(period.values ?? [], line, NATION, date);
    const value = Number(raw);
    if (raw === null || raw === undefined || raw === "" || Number.isNaN(value)) continue;
    out.push({ date, value });
  }
  return out.sort((left, right) => left.date.localeCompare(right.date));
}

const QUARTER = ["Final consumption expenditure", "Gross capital formation", "Net exports of goods and services"].map((name) => `${name}, quarter (% of growth)`);
const YTD = ["Final consumption expenditure", "Gross capital formation", "Net exports of goods and services"].map((name) => `${name}, year to date (% of growth)`);
const at = (key: string, label: string, period: string) => seriesOf(key, label).find((point) => point.date === period)?.value;

test("the second quarter of 2026 is the bureau's own division of its growth", () => {
  expect(QUARTER.map((label) => at("gdp_contributions", label, "2026-Q2"))).toEqual([45.2, 34, 20.8]);
  expect(YTD.map((label) => at("gdp_contributions_ytd", label, "2026-Q2"))).toEqual([46, 36.1, 17.9]);
});

test("the three contributions sum to one hundred percent, every quarter published", () => {
  const result = compareComponentSum("quarter", QUARTER.map((label) => seriesOf("gdp_contributions", label)), 100, { tolerance: 0.15, periods: 24 });
  expect(result.status).toBe("ok");
  expect(result.compared).toBeGreaterThanOrEqual(20);
  expect(result.latest?.left).toBe(100);
  const cumulative = compareComponentSum("ytd", YTD.map((label) => seriesOf("gdp_contributions_ytd", label)), 100, { tolerance: 0.15, periods: 24 });
  expect(cumulative.status).toBe("ok");
  expect(cumulative.compared).toBeGreaterThanOrEqual(20);
});

test("a contribution read off the wrong column is a finding", () => {
  // Capital formation replaced by its cumulative twin: right shape, wrong column.
  const wrong = [seriesOf("gdp_contributions", QUARTER[0]!), seriesOf("gdp_contributions_ytd", YTD[1]!), seriesOf("gdp_contributions", QUARTER[2]!)];
  const result = compareComponentSum("quarter", wrong, 100, { tolerance: 0.15, periods: 24 });
  expect(result.status).toBe("mismatch");
  // Not every quarter: the first quarter of a year is its own year to date, so it still sums.
  expect(result.disagreements.length).toBeGreaterThan(0);
  expect(result.disagreements.some((row) => row.period.endsWith("-Q1"))).toBe(false);
});

test("the first quarter of a year equals its own year to date, and later quarters do not", () => {
  for (const [quarter, cumulative] of QUARTER.map((label, index) => [label, YTD[index]!] as const)) {
    expect(at("gdp_contributions", quarter, "2026-Q1"), quarter).toBe(at("gdp_contributions_ytd", cumulative, "2026-Q1"));
  }
  expect(at("gdp_contributions", QUARTER[0]!, "2026-Q2")).not.toBe(at("gdp_contributions_ytd", YTD[0]!, "2026-Q2"));
});

test("the ids resolve in the shipped snapshot, to the quarter and cumulative lines they claim", async () => {
  interface Entry { id: string; name: string; cid: string; datasetCode: number }
  const isEntry = (value: unknown): value is Entry =>
    typeof value === "object" && value !== null && typeof Reflect.get(value, "id") === "string" && typeof Reflect.get(value, "name") === "string";
  const snapshot: unknown = await readCatalogSnapshot();
  const list = typeof snapshot === "object" && snapshot !== null ? Reflect.get(snapshot, "entries") : undefined;
  const byId = new Map((Array.isArray(list) ? list : []).filter(isEntry).map((entry) => [entry.id, entry]));
  expect(lines("gdp_contributions").map((line) => byId.get(line.id)?.name.replace(/\s+/g, " ").trim())).toEqual([
    "最终消费支出对国内生产总值增长贡献率当季值 (%)",
    "资本形成总额对国内生产总值增长贡献率当季值 (%)",
    "货物和服务净出口对国内生产总值增长贡献率当季值 (%)",
  ]);
  expect(lines("gdp_contributions_ytd").map((line) => byId.get(line.id)?.name.replace(/\s+/g, " ").trim())).toEqual([
    "最终消费支出对国内生产总值增长贡献率累计值 (%)",
    "资本形成总额对国内生产总值增长贡献率累计值 (%)",
    "货物和服务净出口对国内生产总值增长贡献率累计值 (%)",
  ]);
  for (const key of ["gdp_contributions", "gdp_contributions_ytd"]) {
    for (const line of lines(key)) { expect(byId.get(line.id)?.cid).toBe(CID); expect(byId.get(line.id)?.datasetCode).toBe(2); }
  }
});

test("the audit holds both tables to the identity, against a constant rather than a published total", () => {
  for (const name of ["GDP growth: the three contributions sum to 100 percent", "GDP growth year to date: the three contributions sum to 100 percent"]) {
    const pair = CONCORDANCE_PAIRS.find((candidate) => candidate.name === name);
    expect(pair?.kind).toBe("components");
    if (pair?.kind !== "components") throw new Error(`expected a components pair for ${name}`);
    expect(pair.parts.length).toBe(3);
    // No published series says "100"; the whole is the identity itself.
    expect(pair.total).toBeUndefined();
    expect(pair.constant).toBe(100);
  }
});
