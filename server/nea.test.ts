/**
 * NEA's electricity demand releases as captured from the site: the feed of
 * releases and four shapes of page (a month, the old markup, January-February,
 * a year), parsed the way the adapter parses them.
 */

import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { demandReleases, fetchNea, parseNeaRelease } from "./nea.ts";

const fixture = (name: string) => Bun.file(resolve(import.meta.dir, `fixtures/nea/${name}`)).text();

test("a month's release gives the month and the year to date, total and by user group", async () => {
  const figures = parseNeaRelease(await fixture("release-2026-07.html"), "2026-08-21");
  expect(figures?.period).toBe("2026-07");
  expect(figures?.month).toEqual({ total: 10400, totalGrowth: 1.7, primary: 167, primaryGrowth: -2, secondary: 6116, secondaryGrowth: 3, tertiary: 2183, tertiaryGrowth: 4.8, households: 1935, householdsGrowth: -5.1 });
  expect(figures?.yearToDate?.total).toBe(61399);
  expect(figures?.yearToDate?.totalGrowth).toBe(4.7);
  expect(figures?.yearToDate?.households).toBe(9249);
});

test("the older page markup reads the same", async () => {
  const figures = parseNeaRelease(await fixture("release-2024-09.html"), "2024-10-19");
  expect(figures?.period).toBe("2024-09");
  expect(figures?.month?.total).toBe(8475);
  expect(figures?.month?.totalGrowth).toBe(8.5);
  expect(figures?.month?.householdsGrowth).toBe(27.8);
  expect(figures?.yearToDate?.total).toBe(74094);
  expect(figures?.yearToDate?.totalGrowth).toBe(7.9);
});

test("January and February come together and belong to the year to date; a year's release is December's year to date", async () => {
  const spring = parseNeaRelease(await fixture("release-2026-01-02.html"), "2026-03-17");
  expect(spring?.period).toBe("2026-02");
  expect(spring?.month).toBeUndefined();
  expect(spring?.yearToDate?.total).toBe(16546);
  expect(spring?.yearToDate?.totalGrowth).toBe(6.1);
  const year = parseNeaRelease(await fixture("release-2025-annual.html"), "2026-01-21");
  expect(year?.period).toBe("2025-12");
  expect(year?.month).toBeUndefined();
  expect(year?.yearToDate?.total).toBe(103682);
  expect(year?.yearToDate?.totalGrowth).toBe(5);
  expect(parseNeaRelease("<html><body>Nothing</body></html>", "2026-01-01")).toBeNull();
});

test("the feed yields the demand notes, newest first, with absolute URLs, and not the fuller statistics releases", async () => {
  const releases = demandReleases(JSON.parse(await fixture("xwfb-feed.json")));
  expect(releases.length).toBeGreaterThan(50);
  expect(releases[0]?.title).toBe("2026年1-7月份全社会用电量同比增长4.7%");
  expect(releases[0]?.url).toBe("https://www.nea.gov.cn/20260821/f227e3fb9f05422285e354f4c27aec07/c.html");
  expect(releases[0]?.publishedAt).toBe("2026-08-21");
  expect(releases.every((release) => !/电力工业统计数据/.test(release.title))).toBe(true);
  expect(releases.find((release) => release.publishedAt === "2024-10-19")?.url).toBe("http://www.nea.gov.cn/2024-10/19/c_1212405503.htm");
  expect(demandReleases({ datasource: "no" })).toEqual([]);
});

test("the adapter turns releases into level and growth lines, one point per period", async () => {
  const feed = await fixture("xwfb-feed.json");
  const pages: Record<string, string> = {
    "https://www.nea.gov.cn/20260821/f227e3fb9f05422285e354f4c27aec07/c.html": await fixture("release-2026-07.html"),
    "https://www.nea.gov.cn/20260317/9d1ddd561f854bf096f88edc1bbf9a1d/c.html": await fixture("release-2026-01-02.html"),
  };
  const read = async (url: string) => url.endsWith(".json") ? feed : (pages[url] ?? "<html></html>");
  const cfg = { kind: "nea" as const, group: "Energy", title: "Electricity Consumption", agency: "National Energy Administration", frequency: "Monthly", unit: "亿千瓦时", measure: "level" as const };
  const level = await fetchNea("electricity_demand", cfg, 8, read);
  const month = level.series.find((line) => line.label === "All users, month");
  const ytd = level.series.find((line) => line.label === "All users, year to date");
  expect(month?.points).toEqual([{ date: "2026-07", value: 10400 }]);
  expect(ytd?.points).toEqual([{ date: "2026-02", value: 16546 }, { date: "2026-07", value: 61399 }]);
  const growth = await fetchNea("electricity_demand_growth", { ...cfg, measure: "growth" }, 8, read);
  expect(growth.series.find((line) => line.label === "Households, month (YoY %)")?.points).toEqual([{ date: "2026-07", value: -5.1 }]);
  expect(growth.series.find((line) => line.label === "All users, year to date (YoY %)")?.points).toEqual([{ date: "2026-02", value: 6.1 }, { date: "2026-07", value: 4.7 }]);
});

test("the August 2026 release, which writes its range with an em dash, keeps the month off the year-to-date line", async () => {
  const { parseNeaRelease } = await import("./nea.ts");
  const figures = parseNeaRelease(await fixture("release-2026-08.html"), "2026-09-20");
  expect(figures?.period).toBe("2026-08");
  // "2026年8月，全社会用电量再破万亿，达到10332亿千瓦时" and "1—8月，全社会用电量累计71730亿千瓦时".
  expect(figures?.month?.total).toBe(10332);
  expect(figures?.yearToDate?.total).toBe(71730);
  expect(figures?.month?.households).toBe(1883);
  expect(figures?.month?.secondary).toBe(6124);
});

test("a release whose month equals its year to date is refused rather than stored", async () => {
  const { parseNeaRelease } = await import("./nea.ts");
  const doctored = (await fixture("release-2026-08.html")).replace("达到10332亿千瓦时", "达到71730亿千瓦时");
  expect(() => parseNeaRelease(doctored, "2026-09-20")).toThrow(/month and the year to date are both/);
});

test("February 2022's release names the month in a clause before the subject; it gives February alone and the two months together", async () => {
  // "2月份，我国经济持续稳定恢复，全社会用电量持续增长，达到6235亿千瓦时": the month
  // marker is not beside the subject. Read with a short lead, the release gave only
  // its year to date (13,467), and the month line kept 13,467 from an earlier misread.
  const figures = parseNeaRelease(await fixture("release-2022-02.html"), "2022-03-15");
  expect(figures?.period).toBe("2022-02");
  expect(figures?.month?.total).toBe(6235);
  expect(figures?.month?.totalGrowth).toBe(16.9);
  expect(figures?.month?.secondary).toBe(3756);
  expect(figures?.month?.householdsGrowth).toBe(24.8);
  expect(figures?.yearToDate?.total).toBe(13467);
  expect(figures?.yearToDate?.totalGrowth).toBe(5.8);
  expect(figures?.yearToDate?.secondary).toBe(8413);
});

test("an official regional republication fills the central feed's May gap", async () => {
  const feed = await fixture("xwfb-feed.json");
  const html = await fixture("release-2026-05-republished.html");
  expect(parseNeaRelease(html, "2026-06-26")?.month?.total).toBe(8671);
  const read = async (url: string) => url.endsWith(".json") ? feed : url.includes("xbj.nea.gov.cn") ? html : "";
  const result = await fetchNea("electricity_demand", { kind: "nea", group: "Energy", title: "Demand", agency: "NEA", frequency: "Monthly", unit: "亿千瓦时", measure: "level" }, 8, read);
  expect(result.series.find(line => line.label === "All users, month")?.points).toEqual([{ date: "2026-05", value: 8671 }]);
  expect(result.series.find(line => line.label === "All users, year to date")?.points).toEqual([{ date: "2026-05", value: 42018 }]);
});
