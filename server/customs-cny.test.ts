/**
 * Customs publishes every table twice, in USD and in CNY. The CNY tables are
 * read as their own keys, never mixed with the USD ones: the listing says
 * which is which, the parser refuses a table in the other denomination, and
 * the August 2026 US row in CNY is the CNY table's own figure.
 */

import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { findTable, parseByCountry, parseCommodities, parseListing, type ListingEntry } from "./customs.ts";

const fixture = (name: string) => Bun.file(resolve(import.meta.dir, `fixtures/customs/${name}`)).text();

test("the listing names each table's denomination", async () => {
  const entries = parseListing(await fixture("listing-column1-page1.html")).filter((entry) => entry.month === "2026-08" && entry.table === "by-country");
  expect(entries.map((entry) => entry.currency).sort()).toEqual(["CNY", "USD"]);
  expect(entries.find((entry) => entry.currency === "CNY")?.href).toBe("http://english.customs.gov.cn/Statics/3caedfcc-1a71-4848-b567-77751d44ebb8.html");
});

test("the table lookup picks the denomination asked for", async () => {
  const page = parseListing(await fixture("listing-column1-page1.html"));
  const pages = async (n: number): Promise<ListingEntry[]> => (n === 1 ? page : []);
  expect((await findTable("by-country", "2026-08", { pages, currency: "CNY" }))?.title).toContain("(in CNY)");
  expect((await findTable("by-country", "2026-08", { pages }))?.title).toContain("(in USD)");
});

test("August 2026 US exports in CNY are the CNY table's figure, and a USD table is refused for CNY", async () => {
  const cny = parseByCountry(await fixture("by-country-2026-08-cny.html"), "CNY");
  const usd = parseByCountry(await fixture("by-country-2026-08-usd.html"));
  const us = cny.find((row) => row.name === "United States");
  expect(us).toEqual({ name: "United States", total: 3789.1, ytdTotal: 27637.1, exports: 2886.1, ytdExports: 20710.2, imports: 903, ytdImports: 6927 });
  // 亿元 against million USD: the implied rate is the month's yuan rate, near 6.8.
  const rate = ((us?.exports ?? 0) * 100) / (usd.find((row) => row.name === "United States")?.exports ?? 1);
  expect(rate).toBeGreaterThan(6.5);
  expect(rate).toBeLessThan(7.5);
  await expect(async () => parseByCountry(await fixture("by-country-2026-08-usd.html"), "CNY")).toThrow(/for CNY/);
  await expect(async () => parseByCountry(await fixture("by-country-2026-08-cny.html"))).toThrow(/for USD/);
});

test("the CNY commodity table carries values in 100 million yuan", async () => {
  const rows = parseCommodities(await fixture("major-exports-2026-08-cny.html"), "CNY");
  expect(rows.length).toBe(31);
  expect(rows.find((row) => /Automatic data processing/i.test(row.name))?.value).toBe(2065.4);
});
