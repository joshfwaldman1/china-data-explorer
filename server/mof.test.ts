/**
 * The Ministry of Finance's monthly 财政收支情况 as captured from the site:
 * the listing pages and five release shapes (a month, the half year, the
 * full year, January-February, and an older month), parsed the way the
 * adapter parses them.
 */

import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { fetchMof, parseFiscalRelease, parseListing, periodOfTitle } from "./mof.ts";

const fixture = (name: string) => Bun.file(resolve(import.meta.dir, `fixtures/mof/${name}`)).text();

test("a release title names its period, cumulative for the year", () => {
  expect(periodOfTitle("2026年1-7月财政收支情况")).toBe("2026-07");
  // September 2026's release writes its range with an em dash; the listing skipped it for a week.
  expect(periodOfTitle("2026年1—8月财政收支情况")).toBe("2026-08");
  expect(periodOfTitle("2026年1–8月财政收支情况")).toBe("2026-08");
  expect(periodOfTitle("2026年上半年财政收支情况")).toBe("2026-06");
  expect(periodOfTitle("2026年一季度财政收支情况")).toBe("2026-03");
  expect(periodOfTitle("2025年前三季度财政收支情况")).toBe("2025-09");
  expect(periodOfTitle("2025年财政收支情况")).toBe("2025-12");
  expect(periodOfTitle("2026年7月中央政府收支及融资数据")).toBeNull();
});

test("the listing pages yield the releases newest first, with absolute URLs and dates", async () => {
  const first = parseListing(await fixture("listing-index.htm"));
  expect(first.length).toBe(8);
  expect(first[0]).toEqual({ title: "2026年1-7月财政收支情况", url: "http://gks.mof.gov.cn/tongjishuju/202608/t20260814_3995497.htm", publishedAt: "2026-08-21", period: "2026-07" });
  expect(first.map((release) => release.period)).toEqual(["2026-07", "2026-06", "2026-05", "2026-04", "2026-03", "2026-02", "2025-12", "2025-11"]);
  const second = parseListing(await fixture("listing-index_1.htm"));
  expect(second[0]?.period).toBe("2025-10");
});

test("a month's release gives the year-to-date levels and their growth", async () => {
  const figures = parseFiscalRelease(await fixture("release-2026-07.html"));
  // The budget aggregates; the same release's tax breakdown is covered in mof-tax.test.ts.
  expect(figures?.level).toMatchObject({ revenue: 143696, tax: 118381, nonTax: 25315, expenditure: 162889, fundRevenue: 18219, landSales: 11731, fundExpenditure: 45410 });
  expect(figures?.growth.revenue).toBe(5.8);
  expect(figures?.growth.landSales).toBe(-30.8);
  expect(figures?.growth.fundRevenue).toBe(-21.2);
});

test("stray spaces inside the half-year release's numbers do not change them", async () => {
  // The page reads "121047 亿元 ，同比增长 4 .7%" and "2 5 880 亿元" in places.
  const figures = parseFiscalRelease(await fixture("release-2026-06-h1.html"));
  expect(figures?.level.revenue).toBe(121047);
  expect(figures?.growth.revenue).toBe(4.7);
  expect(figures?.level.tax).toBe(97865);
  expect(figures?.level.landSales).toBe(9778);
  expect(figures?.growth.landSales).toBe(-31.5);
});

test("the full year says 比上年 rather than 同比, and January-February reads like a month", async () => {
  const year = parseFiscalRelease(await fixture("release-2025-annual.html"));
  expect(year?.level.revenue).toBe(216045);
  expect(year?.growth.revenue).toBe(-1.7);
  expect(year?.level.landSales).toBe(41518);
  expect(year?.growth.landSales).toBe(-14.7);
  const spring = parseFiscalRelease(await fixture("release-2026-02.html"));
  expect(spring?.level.revenue).toBe(44154);
  expect(spring?.growth.fundRevenue).toBe(-16);
  expect(parseFiscalRelease("<html><body>502 Bad Gateway</body></html>")).toBeNull();
});

test("the adapter walks the listing and builds level and growth lines by period", async () => {
  const pages: Record<string, string> = {
    "http://gks.mof.gov.cn/tongjishuju/index.htm": await fixture("listing-index.htm"),
    "http://gks.mof.gov.cn/tongjishuju/index_1.htm": await fixture("listing-index_1.htm"),
    "http://gks.mof.gov.cn/tongjishuju/202608/t20260814_3995497.htm": await fixture("release-2026-07.html"),
    "http://gks.mof.gov.cn/tongjishuju/202607/t20260722_3993943.htm": await fixture("release-2026-06-h1.html"),
    "http://gks.mof.gov.cn/tongjishuju/202603/t20260319_3985695.htm": await fixture("release-2026-02.html"),
    "http://gks.mof.gov.cn/tongjishuju/202601/t20260130_3982923.htm": await fixture("release-2025-annual.html"),
  };
  const read = async (url: string) => pages[url] ?? "<html></html>";
  const base = { kind: "mof" as const, group: "Public Finance", title: "t", agency: "Ministry of Finance", frequency: "Monthly", unit: "u" };
  const level = await fetchMof("fiscal_revenue", { ...base, measure: "level", items: ["revenue", "tax", "landSales"] }, 8, read);
  expect(level.series.map((line) => line.label)).toEqual(["General public budget revenue, year to date", "Tax revenue, year to date", "Land sale revenue, year to date"]);
  expect(level.series[0]?.points).toEqual([{ date: "2025-12", value: 216045 }, { date: "2026-02", value: 44154 }, { date: "2026-06", value: 121047 }, { date: "2026-07", value: 143696 }]);
  const growth = await fetchMof("fiscal_growth", { ...base, measure: "growth", items: ["landSales"] }, 8, read);
  expect(growth.series[0]?.label).toBe("Land sale revenue, year to date (YoY %)");
  expect(growth.series[0]?.points.at(-1)).toEqual({ date: "2026-07", value: -30.8 });
});

test("the September 2026 listing names the January-August release first, and the release gives August's year to date", async () => {
  const releases = parseListing(await Bun.file(resolve(import.meta.dir, "fixtures/mof/listing-index-2026-09.htm")).text());
  expect(releases[0]).toEqual({ title: "2026年1—8月财政收支情况", url: "http://gks.mof.gov.cn/tongjishuju/202609/t20260918_3997709.htm", publishedAt: "2026-09-18", period: "2026-08" });
  expect(releases.map((release) => release.period)).toEqual(["2026-08", "2026-07", "2026-06", "2026-05", "2026-04", "2026-03", "2026-02", "2025-12"]);
  const figures = parseFiscalRelease(await Bun.file(resolve(import.meta.dir, "fixtures/mof/release-2026-08.html")).text());
  expect(figures?.level.landSales).toBe(13753);
  expect(figures?.growth.landSales).toBe(-28.6);
  expect(figures?.level.revenue).toBe(156633);
  expect(figures?.growth.revenue).toBe(5.7);
});
