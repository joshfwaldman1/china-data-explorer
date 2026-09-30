/**
 * A search that names a trade partner and asks for trade with it opens
 * Customs' partner series at that partner; one that names a country for
 * anything else does not.
 */
import { test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(tmpdir(), `partner-search-${process.pid}.db`);
const { customsPartnerInQuery } = await import("./data.ts");

const partner = (query: string) => customsPartnerInQuery(query.split(" "))?.value ?? null;

test("trade words beside a partner's name find that partner", () => {
  expect(partner("exports to japan")).toBe("japan");
  expect(partner("japan exports")).toBe("japan");
  expect(partner("trade with the united states")).toBe("united-states");
  expect(partner("china us trade balance")).toBe("united-states");
  expect(partner("imports from south africa")).toBe("south-africa");
  expect(partner("exports to hong kong")).toBe("hong-kong-china");
  expect(partner("korea imports")).toBe("r-o-korea");
});

test("a country named for anything but trade, or trade named without a partner, is not a partner query", () => {
  expect(partner("japan gdp")).toBeNull();
  expect(partner("exports")).toBeNull();
  expect(partner("japan")).toBeNull();
  expect(partner("trade with")).toBeNull();
  expect(partner("total exports")).toBeNull();
});

const { houseCityInQuery } = await import("./data.ts");
const city = (query: string) => houseCityInQuery(query.split(" "))?.value ?? null;

test("home-price words beside one of the 70 cities find that city", () => {
  expect(city("shanghai house prices")).toBe("shanghai");
  expect(city("new home prices shanghai")).toBe("shanghai");
  expect(city("house prices in shenzhen")).toBe("shenzhen");
  expect(city("xi an home prices")).toBe("xian");
  expect(city("xian housing")).toBe("xian");
});

test("a city named for anything but home prices is not a house-price query", () => {
  expect(city("shanghai gdp")).toBeNull();
  expect(city("housing starts beijing")).toBeNull();
  expect(city("shanghai")).toBeNull();
  expect(city("house prices")).toBeNull();
});

const { exactTitleIndex } = await import("./nbs-catalog.ts");

test("an NBS title equal to the query leads only when it is national, or the query named a place", () => {
  const provincial = { nameEn: "Consumption of major energy products: Consumption of Electricity (100 million kwh)", glossEn: "Electricity consumption", geography: "Province" as const };
  const national = { nameEn: "Birth Rate(‰)", glossEn: "Birth rate", geography: "National" as const };
  // A provincial table does not jump ahead of the national monthly series on a query that names no place.
  expect(exactTitleIndex([provincial], "electricity consumption", false)).toBe(-1);
  expect(exactTitleIndex([provincial], "electricity consumption", true)).toBe(0);
  expect(exactTitleIndex([provincial, national], "birth rate", false)).toBe(1);
  expect(exactTitleIndex([national], "", false)).toBe(-1);
});
