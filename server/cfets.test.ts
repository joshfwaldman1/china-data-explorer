/**
 * The CFETS closing yield curve as captured for August 2026, parsed the way
 * the adapter parses it, and the month-end rule that turns daily closes into
 * the site's monthly frame.
 */

import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { monthEnds, parseYieldRecords } from "./cfets.ts";

const fixture = async () => JSON.parse(await Bun.file(resolve(import.meta.dir, "fixtures/cfets/cycc000-10y-2026-08.json")).text()) as unknown;

test("one month's response carries every key tenor for every trading day", async () => {
  const records = parseYieldRecords(await fixture());
  expect(records.length).toBe(315);
  const terms = [...new Set(records.map((record) => record.term))];
  expect(terms).toEqual(expect.arrayContaining(["1.0", "2.0", "5.0", "10.0", "30.0"]));
  const days = new Set(records.filter((record) => record.term === "10.0").map((record) => record.date));
  expect(days.size).toBe(21); // trading days in August 2026
});

test("the month end is the last trading day's close, per tenor", async () => {
  const records = parseYieldRecords(await fixture());
  expect(monthEnds(records, "10.0")).toEqual([{ date: "2026-08", value: 1.6879 }]);
  expect(monthEnds(records, "1.0")).toEqual([{ date: "2026-08", value: 1.2232 }]);
  expect(monthEnds(records, "30.0")).toEqual([{ date: "2026-08", value: 2.149 }]);
  // The 3 August close is not the month end.
  expect(monthEnds(records, "10.0")[0]?.value).not.toBe(1.7171);
});

test("a tenor the response does not carry gives no point, and a malformed response gives none", async () => {
  const records = parseYieldRecords(await fixture());
  expect(monthEnds(records, "8.5")).toEqual([]);
  expect(parseYieldRecords({ records: "not a list" })).toEqual([]);
  expect(parseYieldRecords({ records: [{ newDateValueCN: "2026-08-31", yearTermStr: "10.0", maturityYieldStr: "---" }] })).toEqual([]);
});
