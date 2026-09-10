/**
 * The curated catalog list as the client sees it.
 */
import { test, expect } from "bun:test";

const { catalogList } = await import("./data.ts");

test("a deployment without AKTools marks the AkShare series as not refreshable, and nothing else", () => {
  const before = process.env.AKTOOLS_URL;
  process.env.AKTOOLS_URL = "off";
  const list = catalogList();
  if (before === undefined) delete process.env.AKTOOLS_URL; else process.env.AKTOOLS_URL = before;
  const climate = list.find((entry) => entry.key === "real_estate");
  expect(climate?.refreshBlocked).toBe("AkShare");
  expect(list.find((entry) => entry.key === "cpi")?.refreshBlocked).toBeUndefined();
  expect(list.filter((entry) => entry.refreshBlocked).map((entry) => entry.key).sort()).toEqual(["caixin_pmi", "caixin_services_pmi", "real_estate"]);
});
