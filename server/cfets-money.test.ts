/**
 * CFETS's SHIBOR and repo fixing histories as captured for August 2026,
 * parsed the way the adapter parses them, with the month-end and monthly
 * average rules.
 */

import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { fetchCfets, monthAverages, monthEnds, parseFixingRecords, parseShiborRecords } from "./cfets.ts";

const fixture = async (name: string) => JSON.parse(await Bun.file(resolve(import.meta.dir, `fixtures/cfets/${name}`)).text()) as unknown;

test("one month's SHIBOR response carries every tenor for every trading day", async () => {
  const records = parseShiborRecords(await fixture("shibor-2026-08.json"));
  expect(records.length).toBe(21 * 8);
  const days = [...new Set(records.map((record) => record.date))].sort();
  expect(days.length).toBe(21);
  expect(days[0]).toBe("2026-08-03");
  expect(days.at(-1)).toBe("2026-08-31");
  for (const day of days) expect(records.filter((record) => record.date === day).map((record) => record.term).sort()).toEqual(["1M", "1W", "1Y", "2W", "3M", "6M", "9M", "ON"]);
});

test("the SHIBOR month end is the last fixing and the average is the mean of the month's fixings", async () => {
  const records = parseShiborRecords(await fixture("shibor-2026-08.json"));
  expect(monthEnds(records, "ON")).toEqual([{ date: "2026-08", value: 1.413 }]);
  expect(monthEnds(records, "1W")).toEqual([{ date: "2026-08", value: 1.414 }]);
  expect(monthEnds(records, "3M")).toEqual([{ date: "2026-08", value: 1.43 }]);
  const overnight = records.filter((record) => record.term === "ON").map((record) => record.yield);
  const mean = overnight.reduce((total, value) => total + value, 0) / overnight.length;
  expect(monthAverages(records, "ON")).toEqual([{ date: "2026-08", value: Math.round(mean * 10_000) / 10_000 }]);
  expect(monthAverages(records, "ON")[0]?.value).toBeGreaterThanOrEqual(Math.min(...overnight));
  expect(monthAverages(records, "ON")[0]?.value).toBeLessThanOrEqual(Math.max(...overnight));
});

test("one month's repo fixing response carries the six fixings for every trading day", async () => {
  const records = parseFixingRecords(await fixture("frr-2026-08.json"));
  expect(records.length).toBe(21 * 6);
  const days = [...new Set(records.map((record) => record.date))];
  expect(days.length).toBe(21);
  for (const day of days) expect(records.filter((record) => record.date === day).map((record) => record.term).sort()).toEqual(["FDR001", "FDR007", "FDR014", "FR001", "FR007", "FR014"]);
  expect(monthEnds(records, "FDR007")).toEqual([{ date: "2026-08", value: 1.41 }]);
  expect(monthEnds(records, "FR007")).toEqual([{ date: "2026-08", value: 1.425 }]);
  // The all-institution fixing sits at or above the depository one every day: non-banks pay more.
  for (const day of days) {
    const fr = records.find((record) => record.date === day && record.term === "FR007")?.yield ?? NaN;
    const fdr = records.find((record) => record.date === day && record.term === "FDR007")?.yield ?? NaN;
    expect(fr).toBeGreaterThanOrEqual(fdr);
  }
});

test("the adapter posts to the table's endpoint and reduces by the configured measure", async () => {
  const posted: string[] = [];
  const send = async (endpoint: string, body: URLSearchParams) => {
    posted.push(`${endpoint.split("/").pop()} ${body.get("startDate")}..${body.get("endDate")}`);
    return fixture(endpoint.endsWith("ShiborHis") ? "shibor-2026-08.json" : "frr-2026-08.json");
  };
  const base = { kind: "cfets" as const, group: "Interest Rates", title: "t", agency: "CFETS", frequency: "Monthly", unit: "u" };
  const end = await fetchCfets("shibor", { ...base, table: "shibor", tenors: [{ term: "ON", label: "Overnight" }] }, 1, send);
  expect(end.sourceUrl).toBe("https://www.chinamoney.com.cn/chinese/bkshibor/");
  expect(end.series).toEqual([{ label: "Overnight", points: [{ date: "2026-08", value: 1.413 }] }]);
  const average = await fetchCfets("repo_fixing_average", { ...base, table: "repo_fixing", measure: "month_average", tenors: [{ term: "FDR007", label: "FDR007" }] }, 1, send);
  expect(average.series[0]?.points[0]?.date).toBe("2026-08");
  expect(average.series[0]?.points[0]?.value).not.toBe(1.41);
  expect(posted[0]).toMatch(/^ShiborHis \d{4}-\d{2}-01\.\.\d{4}-\d{2}-\d{2}$/);
  expect(posted[1]).toMatch(/^FrrHis /);
});
