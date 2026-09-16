/**
 * SAFE's balance-of-payments workbook as published on 26 June 2026, read the
 * way the adapter reads it, and the page that links it.
 */

import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { BOP_ITEMS, fetchSafe, parseBopWorkbook, workbookLink } from "./safe.ts";
import { readXlsx } from "./xlsx.ts";

const fixture = (name: string) => Bun.file(resolve(import.meta.dir, `fixtures/safe/${name}`)).arrayBuffer();

test("the workbook reader finds the six sheets and the quarterly header", async () => {
  const sheets = readXlsx(await fixture("bop-time-series-en-20260626.xlsx"));
  expect(sheets.map((sheet) => sheet.name)).toEqual(["annual(RMB)", "quarterly(RMB)", "annual(USD)", "quarterly(USD)", "annual(SDR)", "quarterly(SDR)"]);
  const quarterly = sheets.find((sheet) => sheet.name === "quarterly(USD)");
  expect(quarterly?.cells.get("B4")).toBe("1998Q1");
  expect(quarterly?.cells.get("A6")).toBe("1. Current account");
});

test("the quarterly USD sheet parses to the standard items through the latest final quarter", async () => {
  const series = parseBopWorkbook(await fixture("bop-time-series-en-20260626.xlsx"));
  expect([...series.keys()]).toEqual(BOP_ITEMS.map((item) => item.label));
  const current = series.get("Current account") ?? [];
  expect(current[0]).toEqual({ date: "1998-Q1", value: 104.71 });
  expect(current.at(-1)).toEqual({ date: "2026-Q1", value: 1843.1 });
  expect(current.length).toBe(113);
  // SAFE's own headline for Q1 2026: current account surplus 184.3 billion USD (1,843 in 100 million).
  expect(series.get("Goods")?.at(-1)).toEqual({ date: "2026-Q1", value: 2474.77 });
  expect(series.get("Reserve assets")?.at(-1)).toEqual({ date: "2026-Q1", value: -479.41 });
  expect(series.get("Financial account excluding reserves")?.at(-1)).toEqual({ date: "2026-Q1", value: -1401.29 });
});

test("the English page links the current workbook, and a workbook without the sheet is refused", async () => {
  const page = new TextDecoder().decode(await fixture("time-series-page-en.html"));
  expect(workbookLink(page)).toBe("https://www.safe.gov.cn/en/file/file/20260626/97df982d6e5344bb94162dbb7cede70e.xlsx");
  expect(workbookLink("<html><body>no link</body></html>")).toBeNull();
  expect(() => parseBopWorkbook(new TextEncoder().encode("not a zip"))).toThrow();
});

test("the adapter serves the last quarters of the configured items", async () => {
  const files: Record<string, string> = {
    "https://www.safe.gov.cn/en/2019/0329/1496.html": "time-series-page-en.html",
    "https://www.safe.gov.cn/en/file/file/20260626/97df982d6e5344bb94162dbb7cede70e.xlsx": "bop-time-series-en-20260626.xlsx",
  };
  const read = async (url: string) => fixture(files[url] ?? "missing");
  const result = await fetchSafe("balance_of_payments", { kind: "safe", group: "Trade & External", title: "t", agency: "SAFE", frequency: "Quarterly", unit: "u", items: BOP_ITEMS.slice(0, 3) }, 4, read);
  expect(result.series.map((line) => line.label)).toEqual(["Current account", "Goods", "Services"]);
  expect(result.series[0]?.points.map((point) => point.date)).toEqual(["2025-Q2", "2025-Q3", "2025-Q4", "2026-Q1"]);
  expect(result.series[2]?.points.at(-1)).toEqual({ date: "2026-Q1", value: -595.55 });
});
