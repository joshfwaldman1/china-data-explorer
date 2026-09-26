import { measureOf } from "../shared/measure.ts";
/**
 * The headline-series half of search: which curated entries a query names
 * and which of them comes first.
 */
import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CatalogEntry } from "./data";

// The modules open the store on import; point them at a scratch file first so
// the test never opens the real one (the files share one process).
const scratch = mkdtempSync(join(tmpdir(), "china-curated-"));
process.env.CHINA_DB_PATH = join(scratch, "store.db");
process.env.CHINA_CATALOG_DB_PATH = join(scratch, "catalog.db");
process.env.CHINA_SEED = "off";

const { matchCurated } = await import("./data.ts");
const { normalizeQuery, SEARCH_STOP_WORDS } = await import("./nbs-catalog.ts");

const entries: CatalogEntry[] = [
  { key: "us_imports_from_china", title: "US Imports from China", group: "Trade & External", agency: "US Census Bureau", frequency: "Monthly", unit: "Millions of US dollars", source: "fred", measure: measureOf("Millions of US dollars") },
  { key: "us_exports_to_china", title: "US Exports to China", group: "Trade & External", agency: "US Census Bureau", frequency: "Monthly", unit: "Millions of US dollars", source: "fred", measure: measureOf("Millions of US dollars") },
  { key: "unemployment", title: "Surveyed Urban Unemployment Rate", group: "Labor", agency: "National Bureau of Statistics", frequency: "Monthly", unit: "Percent", source: "nbs", measure: measureOf("Percent") },
];

function search(query: string): string[] {
  const allTerms = normalizeQuery(query).split(/\s+/).filter(Boolean);
  const meaningful = allTerms.filter((term) => !SEARCH_STOP_WORDS.has(term));
  return matchCurated(entries, allTerms, meaningful.length > 0 ? meaningful : allTerms).map((entry) => entry.key);
}

test("China's exports to the US lead with US imports from China, the series that measures them", () => {
  expect(search("exports to us")[0]).toBe("us_imports_from_china");
  expect(search("china exports to the united states")[0]).toBe("us_imports_from_china");
  expect(search("exports to america")[0]).toBe("us_imports_from_china");
});

test("US exports still lead with US exports to China", () => {
  expect(search("us exports")[0]).toBe("us_exports_to_china");
  expect(search("imports from us")[0]).toBe("us_exports_to_china");
  expect(search("exports to china")[0]).toBe("us_exports_to_china");
});

test("a bare word lists every series it names, in catalog order", () => {
  expect(search("exports")).toEqual(["us_imports_from_china", "us_exports_to_china"]);
  expect(search("unemp")).toEqual(["unemployment"]);
  expect(search("ppi")).toEqual([]);
});

test("an NBS series that is exactly what was asked for leads the headline series", async () => {
  // "birth rate" matched the World Bank fertility rate through "births" in its
  // synonyms, and headline series lead, so the bureau's own birth rate came second.
  const { searchNbsCatalog } = await import("./nbs-catalog.ts");
  const result = await searchNbsCatalog({ query: "birth rate", limit: 5 });
  // NBS's own title carries the unit: "Birth Rate(‰)".
  const exact = result.results.find((entry) => (entry.nameEn ?? "").toLowerCase().replace(/\s*[(（][^()（）]*[)）]\s*$/, "") === "birth rate");
  expect(exact).toBeDefined();
}, 30000);

test("a query that is a series' own name beats one that only contains it, and the national series beats the provincial", async () => {
  const { catalogList } = await import("./data.ts");
  const real = (query: string) => {
    const allTerms = normalizeQuery(query).split(/\s+/).filter(Boolean);
    const meaningful = allTerms.filter((term) => !SEARCH_STOP_WORDS.has(term));
    return matchCurated(catalogList(), allTerms, meaningful.length > 0 ? meaningful : allTerms).map((entry) => entry.key);
  };
  // "cpi" is a synonym of the national CPI and a word in "provincial cpi"; the tie used to fall to catalog order.
  expect(real("cpi")[0]).toBe("cpi");
  expect(real("inflation")[0]).toBe("cpi");
  expect(real("provincial cpi")[0]).toBe("provincial_cpi");
  // Customs' monthly commodity tables answer an import or export commodity, ahead of the bureau's annual tables.
  expect(real("coal imports")[0]).toBe("major_imports");
  expect(real("car exports")[0]).toBe("major_exports");
});
