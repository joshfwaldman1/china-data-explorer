/**
 * The tax breakdown of the Ministry of Finance's fiscal release, parsed from
 * the captured releases: the July 2026 figures, the February 2026 wording of
 * export rebates and a growth stated as a multiple, and the annual release's
 * "比上年" growth.
 */

import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { MOF_ITEMS, parseFiscalRelease } from "./mof.ts";

const fixture = (name: string) => Bun.file(resolve(import.meta.dir, `fixtures/mof/${name}`)).text();

test("the July 2026 release parses every main tax to the ministry's figures", async () => {
  const figures = parseFiscalRelease(await fixture("release-2026-07.html"));
  expect(figures?.level).toMatchObject({
    domesticVat: 45149, consumptionTax: 9984, corporateTax: 32769, personalTax: 10662, importVat: 11569, tariffs: 1356,
    exportRebate: 14800, stampDuty: 3530, securitiesStamp: 1864, landVat: 2359, deedTax: 2303, vehicleTax: 1337,
  });
  expect(figures?.growth).toMatchObject({
    domesticVat: 6.1, consumptionTax: -2.2, corporateTax: 7.2, personalTax: 14.9, importVat: 12.3, tariffs: 3.1,
    exportRebate: 5.2, stampDuty: 38, securitiesStamp: 99.2, landVat: -15.3, deedTax: -14.5, vehicleTax: 13,
  });
  // The total the breakdown sits under is still read.
  expect(figures?.level.tax).toBeDefined();
});

test("February 2026 names export rebates in full and states the securities stamp duty as a multiple", async () => {
  const figures = parseFiscalRelease(await fixture("release-2026-02.html"));
  expect(figures?.level.exportRebate).toBe(5569);
  expect(figures?.growth.exportRebate).toBe(9.7);
  expect(figures?.level.securitiesStamp).toBe(499);
  expect(figures?.growth.securitiesStamp).toBeUndefined();
});

test("the annual release's growth on the year before is read", async () => {
  const figures = parseFiscalRelease(await fixture("release-2025-annual.html"));
  expect(figures?.level.domesticVat).toBe(68947);
  expect(figures?.growth.domesticVat).toBe(3.4);
  expect(figures?.growth.vehicleTax).toBe(-18.8);
});

test("every tax item has a label that says year to date", () => {
  for (const item of ["domesticVat", "corporateTax", "personalTax", "consumptionTax", "importVat", "tariffs", "exportRebate", "stampDuty", "securitiesStamp", "landVat", "deedTax", "vehicleTax"] as const) {
    expect(MOF_ITEMS[item].label).toContain("year to date");
  }
});
