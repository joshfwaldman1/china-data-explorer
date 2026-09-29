/**
 * The province profile reads what the site already holds for one place, by
 * its code. These tests hold the profile's series to the catalog, hold its
 * arithmetic to the accounts identity, and hold its honesty about the one
 * series the bureau stopped.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-province-")), "test.db");
process.env.CHINA_SEED = "off";
const { CATALOG, NBS_PROVINCES } = await import("./data.ts");
const { writeSeries } = await import("./db.ts");
const { readCatalogSnapshot } = await import("./catalog-file.ts");
const { CONCORDANCE_PAIRS } = await import("./concordance.ts");
const { PROVINCE_PROFILE, STRUCTURE, STRUCTURE_IDENTITY, profileKeys, provinceProfile, structureOf } = await import("./province.ts");

interface Entry { id: string; name: string; datasetCode: number; geography: string }
const isEntry = (value: unknown): value is Entry =>
  typeof value === "object" && value !== null && typeof Reflect.get(value, "id") === "string" && typeof Reflect.get(value, "name") === "string";
const snapshot: unknown = await readCatalogSnapshot();
const list = typeof snapshot === "object" && snapshot !== null ? Reflect.get(snapshot, "entries") : undefined;
const byId = new Map((Array.isArray(list) ? list : []).filter(isEntry).map((entry) => [entry.id, entry]));
const nameOf = (key: string) => byId.get(key.replace(/^nbs_/, ""))?.name.replace(/\s+/g, " ").trim();

test("every series the profile reads is a curated key or a provincial series in the bureau's catalog", () => {
  for (const key of profileKeys()) {
    if (CATALOG[key]) { expect(Reflect.get(CATALOG[key] as object, "regions"), key).toBe(NBS_PROVINCES); continue; }
    const entry = byId.get(key.replace(/^nbs_/, ""));
    expect(entry, key).toBeDefined();
    // Provincial datasets only: 4 monthly, 5 quarterly, 6 annual. A national series here would show the nation under a province's name.
    expect([4, 5, 6], `${key} is in dataset ${entry?.datasetCode}`).toContain(entry?.datasetCode ?? -1);
    expect(entry?.geography, key).toBe("Province");
  }
});

test("the ids name the series their labels claim", () => {
  expect(nameOf(STRUCTURE_IDENTITY.gdp)).toBe("地区生产总值 (亿元)");
  expect(STRUCTURE_IDENTITY.parts.map(nameOf)).toEqual(["第一产业增加值 (亿元)", "第二产业增加值 (亿元)", "第三产业增加值 (亿元)"]);
  expect(STRUCTURE.industries.map((item) => nameOf(item.key))).toEqual([
    "工业增加值 (亿元)", "建筑业增加值 (亿元)", "批发和零售业增加值 (亿元)", "交通运输、仓储和邮政业增加值 (亿元)",
    "金融业增加值 (亿元)", "房地产业增加值 (亿元)", "住宿和餐饮业增加值 (亿元)",
  ]);
  const labor = PROVINCE_PROFILE.find((section) => section.title.startsWith("Labor"))!;
  expect(nameOf(labor.entries[0]!.key)).toBe("城镇登记失业率 (%)");
});

test("the unemployment rate says it is the registered rate and that the bureau stopped it", () => {
  const labor = PROVINCE_PROFILE.find((section) => section.title.startsWith("Labor"))!;
  const rate = labor.entries[0]!;
  expect(rate.label).toContain("Registered");
  expect(rate.ended).toBe("2021");
  // The surveyed rate the site shows nationally is not published by province; the note must say so.
  expect(rate.endedNote).toContain("surveyed");
  expect(rate.endedNote).toContain("not by province");
});

test("shares come from the levels of one year, sum to the whole, and rank largest first", async () => {
  const code = "440000000000";
  const annual = (key: string, points: { date: string; value: number }[]) => writeSeries({
    key, title: key, agency: "National Bureau of Statistics", sourceUrl: "", frequency: "Annual", unit: "亿元",
    series: [{ label: "广东省", points }],
  }, code, "2026-09-22T00:00:00.000Z");
  // Guangdong's published 2025 figures: the three sectors sum to GRP exactly.
  annual(STRUCTURE_IDENTITY.gdp, [{ date: "2024", value: 141633.8 }, { date: "2025", value: 145846.8 }]);
  annual(STRUCTURE_IDENTITY.parts[0], [{ date: "2024", value: 5700 }, { date: "2025", value: 5891.8 }]);
  annual(STRUCTURE_IDENTITY.parts[1], [{ date: "2024", value: 53000 }, { date: "2025", value: 54993.5 }]);
  annual(STRUCTURE_IDENTITY.parts[2], [{ date: "2024", value: 82933.8 }, { date: "2025", value: 84961.5 }]);
  // Industry is published a year later than GRP; the 2025 share must not borrow 2024's level.
  annual(STRUCTURE.industries[0]!.key, [{ date: "2024", value: 47682.6 }]);
  annual(STRUCTURE.industries[4]!.key, [{ date: "2024", value: 12000 }, { date: "2025", value: 12500 }]);

  const structure = structureOf(code);
  expect(structure?.year).toBe("2025");
  expect(structure?.gdp).toBe(145846.8);
  const total = structure!.sectors.reduce((sum, item) => sum + item.share, 0);
  expect(Math.abs(total - 100)).toBeLessThanOrEqual(0.2);
  expect(structure!.sectors.map((item) => item.label)).toEqual(["Tertiary (services)", "Secondary (industry and construction)", "Primary (agriculture)"]);
  expect(structure!.sectors[0]?.share).toBe(58.3);
  // The named industries are published a year later than GRP. They take the
  // latest year every one of them has — none here, since only two are written —
  // and say which year that is, rather than borrowing GRP's year and coming up empty.
  expect(structure!.industries).toBeNull();
  const alreadyWritten: string[] = [STRUCTURE.industries[0]!.key, STRUCTURE.industries[4]!.key];
  for (const item of STRUCTURE.industries) if (!alreadyWritten.includes(item.key)) annual(item.key, [{ date: "2024", value: 1000 }]);
  const complete = structureOf(code)!;
  expect(complete.year).toBe("2025");
  expect(complete.industries?.year).toBe("2024");
  expect(complete.industries?.gdp).toBe(141633.8);
  // Ranked largest first, against 2024's GRP: industry 47,682.6 of 141,633.8.
  expect(complete.industries?.items[0]?.label).toBe("Industry");
  expect(complete.industries?.items[0]?.share).toBe(33.7);
  expect(complete.industries?.items[1]?.label).toBe("Finance");
});

test("a profile names its province in both languages and refuses a code that is not one", async () => {
  const profile = await provinceProfile("440000000000");
  expect(profile?.region.text).toBe("广东省");
  expect(profile?.region.en).toBe("Guangdong");
  expect(profile?.sections.map((section) => section.title)).toEqual(["Growth", "Size", "Labor and households", "Exports"]);
  expect(await provinceProfile("000000000000")).toBeNull();
  expect(await provinceProfile("not-a-code")).toBeNull();
});

test("the audit holds Guangdong's three sectors to its GRP, on the same ids the page uses", () => {
  const pair = CONCORDANCE_PAIRS.find((candidate) => candidate.name.startsWith("Guangdong: the three sectors"));
  expect(pair?.kind).toBe("components");
  if (pair?.kind !== "components") throw new Error("expected a components pair");
  expect(pair.parts.map((part) => part.key)).toEqual([...STRUCTURE_IDENTITY.parts]);
  expect(pair.total?.key).toBe(STRUCTURE_IDENTITY.gdp);
  for (const side of [...pair.parts, pair.total!]) expect(side.region).toBe("440000000000");
});
