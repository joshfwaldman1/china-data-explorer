/**
 * The scheduled ingest takes never-stored series first, so a key added in a
 * deploy is on the site within minutes rather than after every older key.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-ingest-order-")), "test.db");
process.env.CHINA_SEED = "off";
const { orderForIngest } = await import("./ingest.ts");

test("never-stored keys lead and the rest keep their order", () => {
  const stored = new Set(["gdp", "cpi", "pmi"]);
  expect(orderForIngest(["gdp", "cpi", "central_parity", "pmi", "cfets_rmb_index"], (key) => stored.has(key))).toEqual(["central_parity", "cfets_rmb_index", "gdp", "cpi", "pmi"]);
  expect(orderForIngest(["gdp", "cpi"], (key) => stored.has(key))).toEqual(["gdp", "cpi"]);
  expect(orderForIngest([], () => true)).toEqual([]);
});
