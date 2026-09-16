/**
 * Customs' monthly totals table — "(1) China's Total Export & Import Values"
 * — as published for August 2026, parsed the way the adapter parses it, and
 * the listing naming it.
 */

import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { parseListing, parseTotals } from "./customs.ts";

const fixture = (name: string) => Bun.file(resolve(import.meta.dir, `fixtures/customs/${name}`)).text();

test("the listing names the totals table in both denominations", async () => {
  const entries = parseListing(await fixture("listing-column1-page1.html")).filter((entry) => entry.table === "totals" && entry.month === "2026-08");
  expect(entries.map((entry) => entry.currency).sort()).toEqual(["CNY", "USD"]);
});

test("the totals table gives Customs' own month values and growth rates", async () => {
  const rows = parseTotals(await fixture("totals-2026-08-usd.html"));
  expect(rows.find((row) => row.item === "exports")).toEqual({ item: "exports", month: 4014.4, yearToDate: 29238.4, monthOnMonth: 0.9, yearOnYear: 25, yearToDateYearOnYear: 19.3 });
  expect(rows.find((row) => row.item === "imports")?.yearOnYear).toBe(28.2);
  expect(rows.find((row) => row.item === "total")?.month).toBe(6838);
  expect(rows.find((row) => row.item === "balance")).toEqual({ item: "balance", month: 1190.9, yearToDate: 8055.1, monthOnMonth: null, yearOnYear: null, yearToDateYearOnYear: null });
  await expect(async () => parseTotals(await fixture("totals-2026-08-usd.html"), "CNY")).toThrow(/for CNY/);
  await expect(async () => parseTotals(await fixture("by-country-2026-08-usd.html"))).toThrow();
});
