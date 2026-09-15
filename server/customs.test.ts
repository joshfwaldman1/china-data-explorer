/**
 * The Customs tables as captured on 15 September 2026, parsed the way the
 * adapter parses them. A changed layout must fail these before it reaches
 * the store.
 */

import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { monthOfTitle, parseByCountry, parseCommodities, parseListing, slugOf } from "./customs.ts";

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
