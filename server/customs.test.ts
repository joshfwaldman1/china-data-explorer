/**
 * The Customs tables as captured on 15 September 2026, parsed the way the
 * adapter parses them. A changed layout must fail these before it reaches
 * the store.
 */

import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { commodityTableIsCumulativeOnly, currencyOfTable, findTable, layoutBroken, monthOfTitle, parseByCountry, parseCommodities, parseListing, partnerTableHasNoMonth, slugOf, tableIsImageOnly, tableOfCurrency } from "./customs.ts";

const fixture = (name: string) => Bun.file(resolve(import.meta.dir, "fixtures/customs", name)).text();

test("listing titles name the month in three spellings, and the table each one is", async () => {
  expect(monthOfTitle("(4) China's Total Export & Import Values by Country/Region, Aug 2026 (in USD)")).toBe("2026-08");
  expect(monthOfTitle("(4) China's Total Export & Import Values by Country/Region, July 2024 (in CNY)")).toBe("2024-07");
  expect(monthOfTitle("(5) China's Major Exports by Quantity and Value, June 2022 (in USD)")).toBe("2022-06");
  expect(monthOfTitle("(3) ... by Trade Mode, January-Aug 2026 (in USD)")).toBe("2026-08");
  expect(monthOfTitle("Release canlendar of 2025")).toBeNull();

  const entries = parseListing(await fixture("listing-column1-page1.html"));
  // Ten dated release tables on the page; the sidebar's other Statics links carry no month.
  expect(entries.filter((entry) => entry.month && entry.table !== null || /Total Export|Trade Mode/.test(entry.title)).length).toBe(10);
  const byCountry = entries.find((entry) => entry.table === "by-country" && entry.usd);
  expect(byCountry?.month).toBe("2026-08");
  expect(byCountry?.href).toMatch(/^http:\/\/english\.customs\.gov\.cn\/Statics\//);
  expect(entries.filter((entry) => entry.table === "major-exports")).toHaveLength(2);
});

test("the by-country table gives each partner's month and year-to-date trade in USD millions", async () => {
  const rows = parseByCountry(await fixture("by-country-2026-08-usd.html"));
  expect(rows.length).toBeGreaterThan(25);
  const us = rows.find((row) => row.name === "United States");
  expect(us).toEqual({ name: "United States", total: 55768.0, ytdTotal: 400839.8, exports: 42475.3, ytdExports: 300329.3, imports: 13292.7, ytdImports: 100510.5 });
  // "of which:" members keep their own name; the bloc stays a row of its own.
  expect(rows.find((row) => row.name === "Germany")?.exports).toBe(11983.3);
  expect(rows.find((row) => row.name === "European Union")?.total).toBe(78089.9);
  expect(rows[0]?.name).toBe("Total");
});

test("the commodity tables give quantity and value with the quantity's unit", async () => {
  const imports = parseCommodities(await fixture("major-imports-2026-08-usd.html"));
  const soy = imports.find((row) => /Soya beans/i.test(row.name));
  expect(soy).toEqual({ name: "Soya beans", quantityUnit: "10,000 Tons", quantity: 1214.1, value: 5848.3, ytdQuantity: 7410.7, ytdValue: 35244.7 });
  const crude = imports.find((row) => /Crude petroleum/i.test(row.name));
  expect(crude?.value).toBe(22723.6);

  const exports = parseCommodities(await fixture("major-exports-2026-08-usd.html"));
  // A category with no quantity keeps its value and an empty unit.
  const plastics = exports.find((row) => /Plastic articles/i.test(row.name));
  expect(plastics?.quantityUnit).toBe("");
  expect(plastics?.quantity).toBeNull();
  expect(plastics?.value).toBe(9904.3);
});

test("a table in another unit or layout is refused rather than misread", async () => {
  const html = (await fixture("by-country-2026-08-usd.html")).replace("Unit: USD1 Million", "Unit: RMB100 Million");
  expect(() => parseByCountry(html)).toThrow(/unexpected unit/);
  expect(() => parseCommodities("<table><tr><td>Nothing</td></tr></table>")).toThrow();
});

test("region codes are stable slugs of the published names", () => {
  expect(slugOf("United States")).toBe("united-states");
  expect(slugOf("Hong Kong, China")).toBe("hong-kong-china");
  expect(slugOf("Crude petroleum oils")).toBe("crude-petroleum-oils");
});

test("the by-country table is read in every header layout Customs has used since 2023", async () => {
  // 2024: the label cells span columns, so the first header row is short.
  const y2024 = parseByCountry(await fixture("by-country-2024-08-usd.html"));
  expect(y2024[0]).toMatchObject({ name: "Total", exports: 308647.3 });
  expect(y2024.find((row) => row.name === "United States")?.exports).toBeGreaterThan(0);
  // 2023: one merged label cell, and a second header row that begins with the month number.
  const y2023 = parseByCountry(await fixture("by-country-2023-09-usd.html"));
  expect(y2023[0]).toMatchObject({ name: "Total", exports: 299129.7 });
  expect(y2023.some((row) => /^\d/.test(row.name))).toBe(false);
  expect(y2023.length).toBeGreaterThan(25);
});

test("the January-February table with no month column gives year-to-date figures and no month", async () => {
  // Through 2025 the two months were published together, as three cumulative
  // columns and three growth rates. Read as the ordinary layout, the two
  // months' imports became February's exports and a growth rate its imports.
  const janFeb = parseByCountry(await fixture("by-country-2025-02-usd.html"));
  expect(janFeb[0]).toMatchObject({ name: "Total", total: null, exports: null, imports: null, ytdTotal: 909366.4, ytdExports: 539940.8, ytdImports: 369425.6 });
  expect(janFeb.find((row) => row.name === "United States")).toMatchObject({ exports: null, imports: null, ytdExports: 75558.4, ytdImports: 26511.3 });
  expect(janFeb.length).toBeGreaterThan(25);
  // From 2026 the same release carries a February column, and reads as any other month.
  const feb2026 = parseByCountry(await fixture("by-country-2026-02-usd.html"));
  expect(feb2026[0]).toMatchObject({ name: "Total", total: 508778.5, ytdTotal: 1099537.2, exports: 299878, imports: 208900.5 });
});

test("the commodity tables kept one layout across years", async () => {
  for (const name of ["major-imports-2024-08-usd.html", "major-imports-2023-09-usd.html", "major-exports-2023-09-usd.html"]) {
    const rows = parseCommodities(await fixture(name));
    expect(rows.length).toBeGreaterThan(25);
    expect(rows[0]?.name).toMatch(/^Agricultur/);
  }
});

test("the 2020 tables, which word the unit line differently, parse to the same shape", async () => {
  // Customs wrote "Value Unit: USD1 Million" through about 2022 and writes
  // "Unit: USD1 Million" now. The parser matched only the newer wording, so
  // every month before the change was refused outright — 22 of the 55 the
  // backfill reaches, failing on every run while the recent months it could
  // read kept the series looking healthy.
  const rows = parseCommodities(await fixture("major-exports-2020-12-usd.html"), "USD");
  expect(rows.length).toBeGreaterThan(25);
  const aquatic = rows.find((row) => row.name.startsWith("Aquatic"));
  expect(aquatic).toMatchObject({ quantityUnit: "10,000 Tons", quantity: 36.8, value: 1949.1, ytdQuantity: 374.8, ytdValue: 18755.3 });
  // The unit row itself is not a commodity, whichever way it is worded.
  expect(rows.some((row) => /unit/i.test(row.name))).toBe(false);
  expect(rows.some((row) => row.name.startsWith("("))).toBe(false);
  // A table whose unit line names the other currency is still refused.
  const usdPage = await fixture("major-exports-2020-12-usd.html");
  expect(() => parseCommodities(usdPage, "CNY")).toThrow(/unexpected unit line/);
});

test("the 2020 imports tables, headed \"Import Commodity\", parse in both currencies", async () => {
  // Customs heads the imports table "Import Commodity" in some years and
  // "Commodity" in others. The header check required the bare word, so every
  // month of the other wording was refused as "header not recognised": 348
  // log lines in one twenty-minute ingest, all of them December 2020 and
  // earlier, none of them a real problem with the data.
  const usd = parseCommodities(await fixture("major-imports-2020-12-usd.html"), "USD");
  const cny = parseCommodities(await fixture("major-imports-2020-12-cny.html"), "CNY");
  expect(usd.length).toBeGreaterThan(25);
  expect(cny.length).toBe(usd.length);
  const meatUsd = usd.find((row) => row.name.startsWith("Meat"));
  const meatCny = cny.find((row) => row.name.startsWith("Meat"));
  expect(meatUsd).toMatchObject({ quantityUnit: "10,000 Tons", quantity: 96.4, value: 3018.1, ytdQuantity: 991.1, ytdValue: 30733.1 });
  // Same quantity, the value in the other currency's unit: 亿元 against USD millions.
  expect(meatCny).toMatchObject({ quantity: 96.4, value: 199.0, ytdQuantity: 991.1, ytdValue: 2131.5 });
  // The header row is a header, not a commodity called "Import Commodity".
  expect(usd.some((row) => /commodity/i.test(row.name))).toBe(false);
});

test("a layout change is when the newest months fail; an old layout is a gap, not a reason to discard", () => {
  const months = ["2026-08", "2026-07", "2026-06", "2026-05", "2021-01", "2020-12", "2020-11", "2018-12"];
  // The backfill's actual shape: old months fail, the current ones parse. Keep them.
  expect(layoutBroken(["2020-12", "2020-11", "2018-12"], months)).toBe(false);
  // Customs changes its layout: the newest month fails. That is broken.
  expect(layoutBroken(["2026-08"], months)).toBe(true);
  expect(layoutBroken(["2026-06", "2018-12"], months)).toBe(true);
  // Nothing parsed at all is broken however it happened.
  expect(layoutBroken([], [])).toBe(true);
  expect(layoutBroken(["2026-08"], ["2026-08"])).toBe(true);
  // The old rule's case — more than a third failing — is no longer fatal on its own
  // when the failures are old: 21 of 54 with the recent months fine is a gap.
  const fiftyFour = Array.from({ length: 54 }, (_, index) => `20${String(26 - Math.floor(index / 12)).padStart(2, "0")}-${String(12 - (index % 12)).padStart(2, "0")}`);
  const oldTwentyOne = fiftyFour.slice(-21);
  expect(layoutBroken(oldTwentyOne, fiftyFour)).toBe(false);
});

test("April 2025's exports table, published without its quantity-unit column, reads each figure from the right cell", async () => {
  // Every other month has a unit cell ("10,000 Autos") between the name and the quantity;
  // this table dropped it, and read the old way motor vehicle exports were 215.8 between
  // months near 10,000 (the year-to-date quantity in the value column).
  const rows = parseCommodities(await fixture("major-exports-2025-04-usd.html"));
  const vehicles = rows.find((row) => /^Motor vehicles/i.test(row.name));
  expect(vehicles?.value).toBe(11164.1);
  expect(vehicles?.quantity).toBe(62);
  expect(vehicles?.ytdValue).toBe(36897.6);
  // The unit is not on the page, so the quantity carries none rather than a number.
  expect(vehicles?.quantityUnit).toBe("");
  const phones = rows.find((row) => /^Mobile phones/i.test(row.name));
  expect(phones?.value).toBe(7579.7);
  const hiTech = rows.find((row) => /^Hi-tech/i.test(row.name));
  expect(hiTech?.value).toBe(74736.3);
  expect(hiTech?.quantity).toBeNull();
  // A month with the column still reads as before.
  const august = parseCommodities(await fixture("major-exports-2026-08-usd.html")).find((row) => /^Motor vehicles/i.test(row.name));
  expect(august?.quantityUnit).toBe("10,000 Autos");
});

test("a month whose USD table is listed as CNY is found through its twin and told apart by its unit line", async () => {
  // June 2025's listing carries two by-country links, both titled "(in CNY)"; one is the USD table.
  const page = parseListing(await fixture("listing-column1-page17.html"));
  expect(page.filter((entry) => entry.table === "by-country" && entry.month === "2025-06").map((entry) => entry.currency)).toEqual(["CNY", "CNY"]);
  const found = await findTable("by-country", "2025-06", { pages: async (n) => (n === 1 ? page : []) });
  expect(found?.currency).toBe("USD");
  expect(found?.alternates).toHaveLength(1);
  const pages: Record<string, string> = {
    [found!.href]: await fixture("by-country-2025-06-cny.html"),
    [found!.alternates![0]!.href]: await fixture("by-country-2025-06-usd-labelled-cny.html"),
  };
  expect(currencyOfTable(pages[found!.href]!)).toBe("CNY");
  const html = await tableOfCurrency(found!, "USD", async (entry) => pages[entry.href] ?? "");
  expect(currencyOfTable(html)).toBe("USD");
  const us = parseByCountry(html).find((row) => slugOf(row.name) === "united-states");
  expect(us?.exports).toBeGreaterThan(30000);
  // A month listed correctly is read as listed, with no second fetch.
  const plain = await findTable("by-country", "2026-08", { pages: async (n) => (n === 1 ? parseListing(await fixture("listing-column1-page1.html")) : []) });
  expect(plain?.alternates).toBeUndefined();
  await expect(tableOfCurrency(found!, "CNY", async (entry) => pages[entry.href] ?? "")).resolves.toBe(pages[found!.href]!);
});

test("the January-February commodity table carries the two months together and no February figure", async () => {
  // Headed "1-2 Total" with no month column; read as the ordinary layout, the two-month
  // total stood as February's for every commodity, twice March's size, 2021 to 2025.
  const html = await fixture("major-exports-2025-02-usd.html");
  expect(commodityTableIsCumulativeOnly(html)).toBe(true);
  const vehicles = parseCommodities(html).find((row) => /^Motor vehicles/i.test(row.name));
  expect(vehicles?.value).toBeNull();
  expect(vehicles?.quantity).toBeNull();
  expect(vehicles?.ytdValue).toBe(16143.6);
  expect(vehicles?.ytdQuantity).toBe(97.1);
  expect(vehicles?.quantityUnit).toBe("10,000 Autos");
  // Ordinary months, and the unit-less April 2025, still carry the month.
  expect(commodityTableIsCumulativeOnly(await fixture("major-exports-2026-08-usd.html"))).toBe(false);
  expect(commodityTableIsCumulativeOnly(await fixture("major-exports-2025-04-usd.html"))).toBe(false);
  // The partner table's January-February release is told the same way.
  expect(partnerTableHasNoMonth(await fixture("by-country-2025-02-usd.html"))).toBe(true);
  expect(partnerTableHasNoMonth(await fixture("by-country-2026-08-usd.html"))).toBe(false);
});

test("January-February 2020 puts the unit cell after six empty cells, and still parses", async () => {
  const html = await fixture("major-exports-2020-02-usd.html");
  const rows = parseCommodities(html);
  expect(rows.length).toBeGreaterThan(20);
  // A two-month release: no single-month figure, only the year to date.
  expect(commodityTableIsCumulativeOnly(html)).toBe(true);
  const grain = rows.find((row) => row.name === "Grain");
  expect(grain?.ytdValue).toBe(225.8);
});

test("mid-2018 tables are screenshots with no HTML table, and are recognised as such", async () => {
  expect(tableIsImageOnly(await fixture("by-country-2018-10-usd-image.html"))).toBe(true);
  expect(tableIsImageOnly(await fixture("by-country-2026-08-usd.html"))).toBe(false);
  expect(tableIsImageOnly(await fixture("major-exports-2020-02-usd.html"))).toBe(false);
});
