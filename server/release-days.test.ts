/**
 * Publishers off the NBS calendar carry their own release day, so the page
 * can say when the next figure is due and the due rule can use it.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-release-days-")), "test.db");
process.env.CHINA_SEED = "off";
const { catalogList } = await import("./data.ts");

test("every series of a publisher off the NBS calendar names its release day", () => {
  const days = new Map(catalogList().filter((entry) => entry.releaseDay).map((entry) => [entry.key, entry.releaseDay]));
  expect(days.get("electricity_demand")).toBe(21);
  expect(days.get("electricity_demand_growth")).toBe(21);
  expect(days.get("tsf_flow")).toBe(15);
  expect(days.get("tsf_stock_growth")).toBe(15);
  expect(days.get("fiscal_revenue")).toBe(25);
  expect(days.get("land_sale_revenue")).toBe(25);
  expect(days.get("fdi_actual_use")).toBe(22);
  expect(days.get("trade")).toBe(20);
  expect(days.get("trade_values")).toBe(20);
  expect(days.get("trade_partners")).toBe(14);
  // NBS series are on the bureau's calendar and carry none.
  expect(days.has("cpi")).toBe(false);
  expect(days.has("electricity_output")).toBe(false);
});
