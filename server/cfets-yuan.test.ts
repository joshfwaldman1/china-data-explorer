/**
 * CFETS's central parity history for August 2026 and the RMB index for June
 * to August 2026, parsed the way the adapter parses them; and the parity's
 * monthly average against the Federal Reserve's monthly average of the spot.
 */

import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { fetchCfets, monthAverages, monthEnds, parseParityRecords, parseRmbIndexRecords } from "./cfets.ts";

const fixture = async (name: string) => JSON.parse(await Bun.file(resolve(import.meta.dir, `fixtures/cfets/${name}`)).text()) as unknown;
/** FRED EXCHUS for August 2026, the Fed's monthly average of the noon buying rate, as served by fx_usdcny on 17 September 2026. */
const FED_AUGUST_2026 = 6.7361;

test("one month's parity response carries every requested pair for every trading day", async () => {
  const records = parseParityRecords(await fixture("ccpr-2026-08.json"));
  expect(records.length).toBe(21 * 5);
  const days = [...new Set(records.map((record) => record.date))].sort();
  expect(days.length).toBe(21);
  for (const day of days) expect(records.filter((record) => record.date === day).map((record) => record.term)).toEqual(["USD/CNY", "EUR/CNY", "100JPY/CNY", "HKD/CNY", "GBP/CNY"]);
});

test("the August 2026 month-end parity is the 31 August fixing and its average sits within the band of the Fed's average", async () => {
  const records = parseParityRecords(await fixture("ccpr-2026-08.json"));
  expect(monthEnds(records, "USD/CNY")).toEqual([{ date: "2026-08", value: 6.7828 }]);
  expect(monthEnds(records, "EUR/CNY")).toEqual([{ date: "2026-08", value: 7.8344 }]);
  expect(monthEnds(records, "HKD/CNY")).toEqual([{ date: "2026-08", value: 0.8651 }]);
  const average = monthAverages(records, "USD/CNY")[0]?.value ?? NaN;
  expect(average).toBeGreaterThan(6.78);
  expect(average).toBeLessThan(6.79);
  // The spot trades within 2 percent of the parity; the fixing and the market's average were 0.05 apart in August 2026.
  expect(Math.abs(average - FED_AUGUST_2026)).toBeLessThan(0.15);
  expect(Math.abs(average - FED_AUGUST_2026)).toBeGreaterThan(0.01);
});

test("the RMB index is weekly, with a reading on the month's last trading day, and the month end is that reading", async () => {
  const records = parseRmbIndexRecords(await fixture("rmbidx-2026-06-08.json"));
  const dates = [...new Set(records.map((record) => record.date))].sort();
  expect(dates.length).toBe(15);
  // Fridays, the last trading day of each month (31 August 2026 a Monday, 30 June a Tuesday), and a Thursday before the Dragon Boat holiday.
  const fridays = dates.filter((date) => new Date(`${date}T00:00:00Z`).getUTCDay() === 5);
  expect(fridays.length).toBe(12);
  expect(dates.filter((date) => !fridays.includes(date))).toEqual(["2026-06-18", "2026-06-30", "2026-08-31"]);
  expect(records.filter((record) => record.date === "2026-08-31").map((record) => [record.term, record.yield])).toEqual([["CFETS", 101.87], ["BIS", 109.15], ["SDR", 96.67]]);
  expect(monthEnds(records, "CFETS").map((point) => point.date)).toEqual(["2026-06", "2026-07", "2026-08"]);
  expect(monthEnds(records, "CFETS").at(-1)).toEqual({ date: "2026-08", value: 101.87 });
});

test("the adapter asks the parity endpoint for the configured pairs only", async () => {
  const bodies: URLSearchParams[] = [];
  const send = async (endpoint: string, body: URLSearchParams) => { bodies.push(body); return fixture(endpoint.endsWith("CcprHisNew") ? "ccpr-2026-08.json" : "rmbidx-2026-06-08.json"); };
  const base = { kind: "cfets" as const, group: "Exchange Rates", title: "t", agency: "CFETS", frequency: "Monthly", unit: "u" };
  const parity = await fetchCfets("central_parity", { ...base, table: "central_parity", tenors: [{ term: "USD/CNY", label: "USD/CNY" }, { term: "EUR/CNY", label: "EUR/CNY" }] }, 1, send);
  expect(bodies[0]?.get("currency")).toBe("USD/CNY,EUR/CNY");
  expect(parity.series.map((line) => [line.label, line.points.at(-1)?.value])).toEqual([["USD/CNY", 6.7828], ["EUR/CNY", 7.8344]]);
  const index = await fetchCfets("cfets_rmb_index", { ...base, table: "rmb_index", tenors: [{ term: "BIS", label: "BIS basket" }] }, 1, send);
  expect(bodies[1]?.has("currency")).toBe(false);
  expect(index.sourceUrl).toBe("https://www.chinamoney.com.cn/chinese/bkrmbidx/");
  expect(index.series[0]?.points.at(-1)).toEqual({ date: "2026-08", value: 109.15 });
});
