/**
 * The Ministry of Finance's monthly local government bond release as
 * published for September 2025 (the budget department's page; the Debt
 * Management Department publishes from 2026 in the same words), parsed the
 * way the adapter parses it.
 */

import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { MOF_ITEMS, fetchMof, parseBondListing, parseBondRelease, periodOfTitle } from "./mof.ts";

const fixture = (name: string) => Bun.file(resolve(import.meta.dir, `fixtures/mof/${name}`)).text();

test("a bond release title names its month", () => {
  expect(periodOfTitle("2026年8月地方政府债券发行和债务余额情况")).toBe("2026-08");
  expect(periodOfTitle("2025年12月地方政府债券发行和债务余额情况")).toBe("2025-12");
});

test("the September 2025 release parses to the month's issuance and the month-end debt, matching the ministry's figures", async () => {
  const figures = parseBondRelease(await fixture("bonds-2025-09.html"));
  expect(figures).not.toBeNull();
  // 合计，全国发行地方政府债券8619亿元，其中一般债券2260亿元、专项债券6359亿元 (digits split by markup in the page).
  expect(figures?.level).toEqual({
    bondIssuance: 8619, bondGeneral: 2260, bondSpecial: 6359, bondNew: 4741, bondRefinancing: 3878, bondRate: 2.18,
    debtBalance: 536995, debtGeneral: 173119, debtSpecial: 363876,
  });
  // The month's figure, not the year to date (85457 亿元 for January to September).
  expect(figures?.level.bondIssuance).not.toBe(85457);
});

test("the bond listing parser reads anchors whose text names the month", () => {
  const html = `<ul><li><a href="./202609/t20260915_3999999.htm" target="_blank">2026年8月地方政府债券发行和债务余额情况</a><span>2026-09-15</span></li>
    <li><a href="./202608/t20260812_3998888.htm" title="2026年7月地方政府债券发行和债务余额情况"><span class="x">2026年7月地方政府债券发行和债务余额情况</span></a></li>
    <li><a href="./other.htm">地方债管理</a></li></ul>`;
  const releases = parseBondListing(html, "https://zwgls.mof.gov.cn/tjsj/");
  expect(releases.map((release) => [release.period, release.url, release.publishedAt])).toEqual([
    ["2026-08", "https://zwgls.mof.gov.cn/tjsj/202609/t20260915_3999999.htm", "2026-09-15"],
    ["2026-07", "https://zwgls.mof.gov.cn/tjsj/202608/t20260812_3998888.htm", ""],
  ]);
});

test("the adapter serves issuance and debt lines from the bond listing", async () => {
  const listing = `<a href="./202510/t20251024_3974884.htm">2025年9月地方政府债券发行和债务余额情况</a><span>2025-10-24</span>`;
  const pages: Record<string, string> = { "https://zwgls.mof.gov.cn/tjsj/index.htm": listing, "https://zwgls.mof.gov.cn/tjsj/202510/t20251024_3974884.htm": await fixture("bonds-2025-09.html") };
  const read = async (url: string) => pages[url] ?? "";
  const base = { kind: "mof" as const, table: "bonds" as const, group: "Public Finance", title: "t", agency: "MOF", frequency: "Monthly", unit: "u", measure: "level" as const };
  const issuance = await fetchMof("lgb_issuance", { ...base, items: ["bondIssuance", "bondGeneral", "bondSpecial", "bondNew", "bondRefinancing"] }, 6, read);
  expect(issuance.series.map((line) => [line.label, line.points])).toEqual([
    [MOF_ITEMS.bondIssuance.label, [{ date: "2025-09", value: 8619 }]],
    [MOF_ITEMS.bondGeneral.label, [{ date: "2025-09", value: 2260 }]],
    [MOF_ITEMS.bondSpecial.label, [{ date: "2025-09", value: 6359 }]],
    [MOF_ITEMS.bondNew.label, [{ date: "2025-09", value: 4741 }]],
    [MOF_ITEMS.bondRefinancing.label, [{ date: "2025-09", value: 3878 }]],
  ]);
  const debt = await fetchMof("lgb_debt", { ...base, items: ["debtBalance", "debtGeneral", "debtSpecial"] }, 6, read);
  expect(debt.series.map((line) => line.points[0]?.value)).toEqual([536995, 173119, 363876]);
  expect(debt.sourceUrl).toBe("https://zwgls.mof.gov.cn/tjsj/");
});

test("the July 2026 release, in the Debt Management Department's wording, parses to the ministry's figures", async () => {
  const figures = parseBondRelease(await fixture("bonds-2026-07.html"));
  // 全国发行地方政府债券合计7383亿元，其中一般债券1345亿元、专项债券6038亿元; 债务余额592411亿元 (一般178533, 专项413878).
  expect(figures?.level).toEqual({
    bondIssuance: 7383, bondGeneral: 1345, bondSpecial: 6038, bondNew: 4041, bondRefinancing: 3342, bondRate: 1.97,
    debtBalance: 592411, debtGeneral: 178533, debtSpecial: 413878,
  });
});

test("the department's listing page as published in September 2026 lists the months newest first", async () => {
  const releases = parseBondListing(await fixture("bonds-listing-2026-09.html"));
  expect(releases.length).toBe(10);
  expect(releases[0]).toEqual({ title: "2026年7月地方政府债券发行和债务余额情况", url: "https://zwgls.mof.gov.cn/tjsj/202609/t20260909_3997013.htm", publishedAt: "2026-09-09", period: "2026-07" });
  expect(releases.map((release) => release.period)).toEqual(["2026-07", "2026-06", "2026-05", "2026-04", "2026-03", "2026-02", "2026-01", "2025-12", "2025-11", "2025-10"]);
});
