/**
 * MOFCOM's two FDI paths as captured on 16 September 2026: the data centre's
 * monthly table and the ministry's news list with its renminbi releases.
 */

import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { fetchMofcom, listPageUrl, parseDataCentre, parseFdiRelease, parseNewsList, periodOfTitle } from "./mofcom.ts";

const fixture = (name: string) => Bun.file(resolve(import.meta.dir, `fixtures/mofcom/${name}`)).text();

test("the data centre gives every month since 2008, the enterprise count for the year to date, and the dollar amount until July 2023", async () => {
  const rows = parseDataCentre(JSON.parse(await fixture("datacenter-fdi.json")));
  expect(rows.length).toBe(214);
  expect(rows[0]?.period).toBe("2008-01");
  expect(rows.at(-1)).toEqual({ period: "2025-12", enterprises: 70392, enterprisesGrowth: 19.1, usd: null, usdGrowth: null });
  const lastUsd = [...rows].reverse().find((row) => row.usd !== null);
  expect(lastUsd).toEqual({ period: "2023-07", enterprises: 28406, enterprisesGrowth: 34, usd: 1118, usdGrowth: -9.8 });
  expect(parseDataCentre({ not: "a list" })).toEqual([]);
});

test("a release title names its period", () => {
  expect(periodOfTitle("2026年1-7月全国吸收外资4383.3亿元人民币")).toBe("2026-07");
  expect(periodOfTitle("2025年全国吸收外资8262.5亿元人民币")).toBe("2025-12");
  expect(periodOfTitle("2026年亚太经合组织贸易部长会议在苏州举行")).toBeNull();
});

test("a page of the news list yields its FDI releases with absolute URLs", async () => {
  const releases = parseNewsList(await fixture("news-list-page1.json"));
  expect(releases.map((release) => release.period)).toEqual(["2026-07", "2026-06", "2026-05"]);
  expect(releases[0]?.url).toBe("https://www.mofcom.gov.cn/xwfb/rcxwfb/art/2026/art_d22dcc4d9d19455bbfce84ad52727aa4.html");
  expect(listPageUrl(2)).toContain("paramJson=%7B%22pageNo%22%3A2%2C%22pageSize%22%3A20%7D");
});

test("a release gives the year-to-date count and renminbi amounts with their growth", async () => {
  const july = parseFdiRelease(await fixture("release-2026-07.html"));
  expect(july).toEqual({ enterprises: 37711, enterprisesGrowth: 4.4, cny: 4383.3, cnyGrowth: -6.2, manufacturing: 1094.3, services: 3199.5, highTech: 1823.1, highTechGrowth: 32.7 });
  const june = parseFdiRelease(await fixture("release-2026-06.html"));
  expect(june?.cny).toBe(4021.4);
  expect(june?.cnyGrowth).toBe(-5);
  expect(parseFdiRelease("<html><body>nothing</body></html>")).toBeNull();
});

test("the adapter joins the two paths: the enterprise count from both, the renminbi amount from the release", async () => {
  const pages: Record<string, string> = {
    [listPageUrl(1)]: await fixture("news-list-page1.json"),
    "https://www.mofcom.gov.cn/xwfb/rcxwfb/art/2026/art_d22dcc4d9d19455bbfce84ad52727aa4.html": await fixture("release-2026-07.html"),
    "https://www.mofcom.gov.cn/xwfb/rcxwfb/art/2026/art_ea6d68fe5ee74367a2be1ca271765033.html": await fixture("release-2026-06.html"),
  };
  const readers = { dataCentre: async () => fixture("datacenter-fdi.json"), page: async (url: string) => pages[url] ?? "<html></html>" };
  const base = { kind: "mofcom" as const, group: "Trade & External", title: "t", agency: "Ministry of Commerce", frequency: "Monthly", unit: "u" };
  const enterprises = await fetchMofcom("fdi_new_enterprises", { ...base, measure: "enterprises" }, 2, readers);
  expect(enterprises.series[0]?.points.at(-1)).toEqual({ date: "2025-12", value: 70392 });
  expect(enterprises.series[1]?.points).toEqual([{ date: "2026-06", value: 31617 }, { date: "2026-07", value: 37711 }]);
  const cny = await fetchMofcom("fdi_actual_use", { ...base, measure: "cny" }, 2, readers);
  expect(cny.series.map((line) => line.label)).toEqual(["Actual use of foreign investment, year to date", "Manufacturing, year to date", "Services, year to date", "High-technology industries, year to date"]);
  expect(cny.series[0]?.points.at(-1)).toEqual({ date: "2026-07", value: 4383.3 });
  const usd = await fetchMofcom("fdi_actual_use_usd", { ...base, measure: "usd" }, 240, readers);
  expect(usd.series[0]?.points.at(-1)).toEqual({ date: "2023-07", value: 1118 });
});

test("January and an em-dash range identify the FDI releases previously skipped", async () => {
  expect(periodOfTitle("2026年1月全国吸收外资920.1亿元人民币")).toBe("2026-01");
  expect(periodOfTitle("2024年1—9月全国吸收外资6406亿元人民币")).toBe("2024-09");
  expect(periodOfTitle("2024年1—13月全国吸收外资")).toBeNull();
  expect(parseFdiRelease(await fixture("release-2026-01.html"))?.cny).toBe(920.1);
  expect(parseFdiRelease(await fixture("release-2024-09.html"))?.cny).toBe(6406);
});
