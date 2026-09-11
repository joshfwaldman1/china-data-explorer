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
  { key: "us_imports_from_china", title: "US Imports from China", group: "Trade & External", agency: "US Census Bureau", frequency: "Monthly", unit: "Millions of US dollars" },
  { key: "us_exports_to_china", title: "US Exports to China", group: "Trade & External", agency: "US Census Bureau", frequency: "Monthly", unit: "Millions of US dollars" },
  { key: "unemployment", title: "Surveyed Urban Unemployment Rate", group: "Labor", agency: "National Bureau of Statistics", frequency: "Monthly", unit: "Percent" },
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
