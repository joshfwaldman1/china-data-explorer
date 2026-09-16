/**
 * PBOC's months-across tables as captured on 16 September 2026: money supply
 * (2025 and 2026), official reserve assets, and the RMB credit funds of
 * financial institutions, with the yearly indexes that link them.
 */

import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { decodePage, fetchPboc, parseMonthsAcross, tableLinkByTitle, yearIndexLinks, MONEY_ROWS, RESERVE_ROWS, CREDIT_ROWS } from "./pboc.ts";

const bytes = (name: string) => Bun.file(resolve(import.meta.dir, `fixtures/pboc/${name}`)).arrayBuffer();
const page = async (name: string) => decodePage(await bytes(name));

test("the statistics section links each section's yearly indexes, and an index links a table by title", async () => {
  const statistics = await page("statistics-index.html");
  expect(yearIndexLinks(statistics, new Date(), "货币统计概览")[0]).toEqual({ year: 2026, url: "https://www.pbc.gov.cn/diaochatongjisi/116219/116319/2026ntjsj/hbtjgl/index.html" });
  expect(yearIndexLinks(statistics, new Date(), "金融机构信贷收支统计")[0]?.url).toContain("/2026ntjsj/jrjgxdsztj/");
  const index = await page("hbtjgl-2026-index.html");
  expect(tableLinkByTitle(index, /^货币供应量/)).toBe("https://www.pbc.gov.cn/diaochatongjisi/attachDir/2026/09/2026091417313352505.htm");
  expect(tableLinkByTitle(index, /^官方储备资产/)).toBe("https://www.pbc.gov.cn/diaochatongjisi/attachDir/2026/09/2026090715595566571.htm");
  expect(tableLinkByTitle(index, /^no such table/)).toBeNull();
});

test("the money supply table gives month-end M2, M1 and M0", async () => {
  const money = parseMonthsAcross(await page("money-2026.htm"), MONEY_ROWS);
  expect([...money.keys()]).toEqual(["M2", "M1", "M0"]);
  expect(money.get("M2")?.map((point) => point.date)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]);
  expect(money.get("M2")?.at(-1)).toEqual({ date: "2026-08", value: 3568083.6 });
  expect(money.get("M0")?.at(-1)).toEqual({ date: "2026-08", value: 148311.98 });
});

test("the reserves table gives the dollar column of each month, not the SDR one", async () => {
  const reserves = parseMonthsAcross(await page("reserves-2026.htm"), RESERVE_ROWS, true);
  expect(reserves.get("Foreign currency reserves")?.at(-1)).toEqual({ date: "2026-08", value: 34383.25 });
  expect(reserves.get("Gold")?.at(-1)).toEqual({ date: "2026-08", value: 3500.8 });
  expect(reserves.get("Total")?.at(-1)).toEqual({ date: "2026-08", value: 38548.85 });
  expect(reserves.get("SDRs")?.[0]).toEqual({ date: "2026-01", value: 562.34 });
});

test("the credit funds table gives deposits and loans outstanding", async () => {
  const credit = parseMonthsAcross(await page("credit-2026.htm"), CREDIT_ROWS);
  expect(credit.get("Total deposits")?.at(-1)).toEqual({ date: "2026-08", value: 3476700.76 });
  expect(credit.get("Total loans")?.at(-1)).toEqual({ date: "2026-08", value: 2823513.09 });
  expect(credit.get("Loans to households")?.at(-1)).toEqual({ date: "2026-08", value: 822435.57 });
  expect(() => parseMonthsAcross("<table><tr><td>nothing</td></tr></table>", CREDIT_ROWS)).toThrow();
});

test("the adapter computes M2 growth from two years of levels to the rate the bank prints", async () => {
  const files: Record<string, string> = {
    "https://www.pbc.gov.cn/diaochatongjisi/116219/116319/index.html": "statistics-index.html",
    "https://www.pbc.gov.cn/diaochatongjisi/116219/116319/2026ntjsj/hbtjgl/index.html": "hbtjgl-2026-index.html",
    "https://www.pbc.gov.cn/diaochatongjisi/116219/116319/5570903/5570886/index.html": "hbtjgl-2025-index.html",
    "https://www.pbc.gov.cn/diaochatongjisi/attachDir/2026/09/2026091417313352505.htm": "money-2026.htm",
    "https://www.pbc.gov.cn/diaochatongjisi/attachDir/2026/01/2026011515582640595.htm": "money-2025.htm",
    "https://www.pbc.gov.cn/diaochatongjisi/attachDir/2026/09/2026090715595566571.htm": "reserves-2026.htm",
  };
  const read = async (url: string) => { const name = files[url]; if (!name) return new TextEncoder().encode("<html></html>").buffer as ArrayBuffer; return bytes(name); };
  const base = { kind: "pboc" as const, group: "Money & Credit", title: "t", agency: "People's Bank of China", frequency: "Monthly", unit: "u" };
  const growth = await fetchPboc("money_stock_growth", { ...base, table: "money_growth", instruments: MONEY_ROWS }, 6, read);
  const m2 = growth.series.find((line) => line.label === "M2");
  expect(m2?.points.find((point) => point.date === "2026-07")?.value).toBe(7.7); // the bank printed 7.7 for July 2026
  expect(m2?.points.at(-1)).toEqual({ date: "2026-08", value: 7.5 });
  const reserves = await fetchPboc("official_reserves", { ...base, table: "reserves", instruments: RESERVE_ROWS }, 6, read);
  expect(reserves.series.find((line) => line.label === "Foreign currency reserves")?.points.at(-1)).toEqual({ date: "2026-08", value: 34383.25 });
});
