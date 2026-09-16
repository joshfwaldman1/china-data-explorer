/**
 * PBOC's aggregate-financing tables as captured on 16 September 2026, parsed
 * the way the adapter parses them: the statistics index, one year's index,
 * and the year's flow and stock tables.
 */

import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { decodePage, fetchPboc, parseFlowTable, parseStockTable, tableLinks, yearIndexLinks, FLOW_COLUMNS, STOCK_ROWS } from "./pboc.ts";

const bytes = (name: string) => Bun.file(resolve(import.meta.dir, `fixtures/pboc/${name}`)).arrayBuffer();
const page = async (name: string) => decodePage(await bytes(name));

test("the statistics section links one index per year, newest first", async () => {
  const links = yearIndexLinks(await page("statistics-index.html"));
  expect(links.length).toBe(15);
  expect(links[0]).toEqual({ year: 2026, url: "https://www.pbc.gov.cn/diaochatongjisi/116219/116319/2026ntjsj/shrzgm/index.html" });
  expect(links[1]).toEqual({ year: 2025, url: "https://www.pbc.gov.cn/diaochatongjisi/116219/116319/5570903/5570885/index.html" });
});

test("a year's index names the flow and stock tables' htm attachments and not the provincial one", async () => {
  const links = tableLinks(await page("shrzgm-2026-index.html"));
  expect(links.flow).toBe("https://www.pbc.gov.cn/diaochatongjisi/attachDir/2026/09/2026091417323857622.htm");
  expect(links.stock).toBe("https://www.pbc.gov.cn/diaochatongjisi/attachDir/2026/09/2026091417325051118.htm");
});

test("the flow table gives each month's instruments in 100 million yuan", async () => {
  const rows = parseFlowTable(await page("flow-2026.htm"));
  expect(rows.map((row) => row.period)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]);
  const august = rows.find((row) => row.period === "2026-08");
  expect(august?.values).toEqual({ "Total": 16577, "RMB loans": 552, "Foreign-currency loans": 409, "Entrusted loans": 229, "Trust loans": -233, "Undiscounted bankers' acceptances": 382, "Corporate bonds": 2712, "Government bonds": 10097, "Equity financing": 639, "Asset-backed securities": -176, "Loans written off": 906 });
  expect(rows.find((row) => row.period === "2026-04")?.values["RMB loans"]).toBe(-4006);
  expect(() => parseFlowTable("<table><tr><td>nothing</td></tr></table>")).toThrow();
});

test("the stock table gives each month's stock and growth to one decimal, trillion yuan", async () => {
  const points = parseStockTable(await page("stock-2026.htm"));
  const total = points.filter((point) => point.instrument === "Total");
  expect(total.map((point) => point.period)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]);
  expect(total.at(-1)).toEqual({ period: "2026-08", instrument: "Total", stock: 464.8, growth: 7.2 });
  expect(points.find((point) => point.instrument === "RMB loans" && point.period === "2026-08")).toEqual({ period: "2026-08", instrument: "RMB loans", stock: 278.63, growth: 5 });
  expect(() => parseStockTable("<table><tr><td>nothing</td></tr></table>")).toThrow();
});

test("the adapter builds flow, stock and growth series from the year's pages", async () => {
  const files: Record<string, string> = {
    "https://www.pbc.gov.cn/diaochatongjisi/116219/116319/index.html": "statistics-index.html",
    "https://www.pbc.gov.cn/diaochatongjisi/116219/116319/2026ntjsj/shrzgm/index.html": "shrzgm-2026-index.html",
    "https://www.pbc.gov.cn/diaochatongjisi/attachDir/2026/09/2026091417323857622.htm": "flow-2026.htm",
    "https://www.pbc.gov.cn/diaochatongjisi/attachDir/2026/09/2026091417325051118.htm": "stock-2026.htm",
  };
  const read = async (url: string) => files[url] ? bytes(files[url] ?? "") : new TextEncoder().encode("<html></html>").buffer as ArrayBuffer;
  const base = { kind: "pboc" as const, group: "Money & Credit", title: "t", agency: "People's Bank of China", frequency: "Monthly", unit: "u" };
  const flow = await fetchPboc("tsf_flow", { ...base, table: "flow", instruments: FLOW_COLUMNS.slice(0, 2) }, 6, read);
  expect(flow.series.map((line) => line.label)).toEqual(["Total", "RMB loans"]);
  expect(flow.series[0]?.points.at(-1)).toEqual({ date: "2026-08", value: 16577 });
  const stock = await fetchPboc("tsf_stock", { ...base, table: "stock", instruments: STOCK_ROWS.slice(0, 1) }, 6, read);
  expect(stock.series[0]?.points.at(-1)).toEqual({ date: "2026-08", value: 464.8 });
  const growth = await fetchPboc("tsf_stock_growth", { ...base, table: "stock_growth", instruments: STOCK_ROWS.slice(0, 2) }, 6, read);
  expect(growth.series[1]?.points.at(-1)).toEqual({ date: "2026-08", value: 5 });
});
