/**
 * The Home page is an explicit list: every row names a key that exists, in
 * its own group, once; the four hero tiles are not rows; the six provinces
 * on the Regional rows are real NBS province codes; and the catalog marks
 * everything else off Home.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-home-rows-")), "test.db");
process.env.CHINA_SEED = "off";
const { CATALOG, HOME_ROWS, HERO_KEYS, NBS_PROVINCES, catalogList, configuredLabels } = await import("./data.ts");

test("every Home row names an existing key in its own group, once per line, and a row's line exists", () => {
  const seen = new Set<string>();
  for (const group of HOME_ROWS) {
    for (const row of group.rows) {
      const cfg: unknown = CATALOG[row.key];
      expect(cfg).toBeDefined();
      // A row in a group other than its key's own must be lifting one named line
      // (the PMI employment indexes into Labor); otherwise it is a misfiled key.
      if (Reflect.get(cfg as object, "group") !== group.group) expect(row.line).toBeDefined();
      const id = `${row.key}|${row.line ?? ""}`;
      expect(seen.has(id)).toBe(false);
      seen.add(id);
      // A hero tile's table appears in the list only through one of its other lines.
      if (HERO_KEYS.includes(row.key)) expect(row.line).toBeDefined();
      if (row.line) expect(configuredLabels(row.key), `${row.key}: ${row.line}`).toContain(row.line);
    }
  }
  expect(HOME_ROWS.map((group) => group.group)).toEqual([...new Set(HOME_ROWS.map((group) => group.group))]);
});

test("the Regional rows are the six largest provincial economies, by NBS code", () => {
  const cfg: unknown = CATALOG.provincial_gdp;
  const codes = Reflect.get(cfg as object, "homeRegions") as string[];
  const names = codes.map((code) => NBS_PROVINCES.find((province) => province.value === code)?.text);
  expect(names).toEqual(["广东省", "江苏省", "山东省", "浙江省", "四川省", "河南省"]);
});

test("the catalog ranks listed keys in Home order and takes every other domestic key off Home", () => {
  const list = catalogList();
  const byKey = new Map(list.map((entry) => [entry.key, entry]));
  let last = -1;
  for (const group of HOME_ROWS) {
    for (const row of group.rows) {
      const entry = byKey.get(row.key);
      expect(entry?.home).not.toBe(false);
      const served = entry?.homeRows?.find((item) => (item.line ?? "") === (row.line ?? ""));
      expect(served?.rank).toBeGreaterThan(last);
      last = served?.rank ?? last;
      if (row.title) expect(served?.title).toBe(row.title);
      const own = Reflect.get(CATALOG[row.key] as object, "group");
      expect(served?.group ?? own).toBe(group.group);
    }
  }
  const listed = new Set([...HOME_ROWS.flatMap((group) => group.rows.map((row) => row.key)), ...HERO_KEYS]);
  for (const entry of list) if (!listed.has(entry.key)) expect(entry.home).toBe(false);
  expect(byKey.get("provincial_gdp")?.homeRegions?.length).toBe(6);
  expect(byKey.get("gdp")?.home).not.toBe(false);
});
