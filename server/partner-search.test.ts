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
