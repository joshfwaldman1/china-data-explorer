/**
 * SAFE's bank FX settlement workbook as published on 15 September 2026 (the
 * August release), the statistics page that links it, and the release whose
 * headline the workbook must reproduce.
 */

import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { FX_SETTLEMENT_ITEMS, fetchSafe, parseFxHeadline, parseFxWorkbook, workbookLink } from "./safe.ts";
import { compareAnnualSum } from "./concordance.ts";

const fixture = (name: string) => Bun.file(resolve(import.meta.dir, `fixtures/safe/${name}`)).arrayBuffer();
const WORKBOOK = "fx-settlement-time-series-20260915.xlsx";
const PAGE_URL = "https://www.safe.gov.cn/safe/2023/0215/22329.html";
const WORKBOOK_URL = "https://www.safe.gov.cn/safe/file/file/20260915/5c2551f57e2b4e0d94752901ff1abbd5.xlsx";
const config = (sheet: string, frequency = "Monthly") => ({ kind: "safe" as const, table: "fx_settlement" as const, group: "Trade & External", title: "t", agency: "SAFE", frequency, unit: "u", sheet, items: FX_SETTLEMENT_ITEMS });

test("the statistics page links the time-series workbook, not the first regional table", async () => {
  const page = new TextDecoder().decode(await fixture("fx-settlement-page.html"));
  expect(workbookLink(page, /时间序列/)).toBe(WORKBOOK_URL);
  expect(workbookLink(page, /分地区/)).toBe("https://www.safe.gov.cn/safe/file/file/20260915/2f528832ab0646f6bed0bf6141c580b5.xlsx");
});

test("the yuan monthly sheet parses every item from January 2010 to August 2026", async () => {
  const series = parseFxWorkbook(await fixture(WORKBOOK), "以人民币计价（月度）");
  expect([...series.keys()].sort()).toEqual(FX_SETTLEMENT_ITEMS.map((item) => item.label).sort());
  const net = series.get("Net settlement") ?? [];
  expect(net[0]).toEqual({ date: "2010-01", value: 2513.06 });
  expect(net.at(-1)).toEqual({ date: "2026-08", value: 3290.15 });
  expect(net.length).toBe(200);
  // The header serials are dates inside the month, not the first: every month is present once.
  expect(net.map((point) => point.date).slice(3, 8)).toEqual(["2010-04", "2010-05", "2010-06", "2010-07", "2010-08"]);
  expect(series.get("Net settlement, bank customers")?.at(-1)).toEqual({ date: "2026-08", value: 3523.86 });
  expect(series.get("Forward contracts signed, net")?.at(-1)).toEqual({ date: "2026-08", value: 294.6 });
});

test("August 2026 settlement, sales and the net match SAFE's release headline in yuan and in dollars", async () => {
  const headline = parseFxHeadline(new TextDecoder().decode(await fixture("fx-release-2026-08.html")));
  // The release also states the cross-border figures, which safe-flows.test.ts covers.
  expect(headline).toMatchObject({ period: "2026-08", settlement: 17090, sales: 13800, settlementUsd: 2518, salesUsd: 2033 });
  const cny = parseFxWorkbook(await fixture(WORKBOOK), "以人民币计价（月度）");
  const usd = parseFxWorkbook(await fixture(WORKBOOK), "以美元计价（月度）");
  const last = (series: Map<string, { date: string; value: number }[]>, label: string) => series.get(label)?.at(-1);
  expect(last(cny, "Settlement")?.date).toBe(headline?.period);
  expect(Math.round(last(cny, "Settlement")?.value ?? NaN)).toBe(headline!.settlement);
  expect(Math.round(last(cny, "Sales")?.value ?? NaN)).toBe(headline!.sales);
  expect(Math.round(last(cny, "Net settlement")?.value ?? NaN)).toBe(headline!.settlement - headline!.sales);
  expect(Math.round(last(usd, "Settlement")?.value ?? NaN)).toBe(headline!.settlementUsd);
  expect(Math.round(last(usd, "Sales")?.value ?? NaN)).toBe(headline!.salesUsd);
});

test("the annual sheet's months sum to its years, and its current-year column is year to date", async () => {
  const monthly = parseFxWorkbook(await fixture(WORKBOOK), "以人民币计价（月度）").get("Net settlement") ?? [];
  const annual = parseFxWorkbook(await fixture(WORKBOOK), "以人民币计价（年度）").get("Net settlement") ?? [];
  expect(annual.map((point) => point.date).slice(0, 2)).toEqual(["2010", "2011"]);
  const result = compareAnnualSum("t", monthly, annual, { tolerance: 1 });
  expect(result.status).toBe("ok");
  expect(result.compared).toBe(3);
  expect(result.latest?.period).toBe("2025");
  // 2026 is January to August in the annual column: the sum of those months, not a year.
  const ytd = monthly.filter((point) => point.date.startsWith("2026-")).reduce((total, point) => total + point.value, 0);
  expect(Math.round(ytd)).toBe(Math.round(annual.at(-1)?.value ?? NaN));
  expect(annual.at(-1)?.date).toBe("2026");
});

test("the adapter serves the last months from the linked workbook and complete years from the annual sheet", async () => {
  const files: Record<string, string> = { [PAGE_URL]: "fx-settlement-page.html", [WORKBOOK_URL]: WORKBOOK };
  const read = async (url: string) => fixture(files[url] ?? "missing");
  const monthly = await fetchSafe("bank_fx_settlement", config("以人民币计价（月度）"), 3, read);
  expect(monthly.sourceUrl).toBe(PAGE_URL);
  expect(monthly.series[0]?.label).toBe("Net settlement");
  expect(monthly.series[0]?.points.map((point) => point.date)).toEqual(["2026-06", "2026-07", "2026-08"]);
  const usd = await fetchSafe("bank_fx_settlement_usd", config("以美元计价（月度）"), 1, read);
  expect(usd.series[0]?.points).toEqual([{ date: "2026-08", value: 484.8 }]);
  const annual = await fetchSafe("bank_fx_settlement_annual", config("以人民币计价（年度）", "Annual"), 3, read);
  expect(annual.series[0]?.points.map((point) => point.date)).toEqual(["2023", "2024", "2025"]);
});

test("an annual-sum pair reports a mismatch when a month is misaligned", () => {
  const months = Array.from({ length: 24 }, (_, index) => ({ date: `${2024 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`, value: 10 }));
  const years = [{ date: "2024", value: 120 }, { date: "2025", value: 125 }];
  const result = compareAnnualSum("t", months, years, { tolerance: 1 });
  expect(result.status).toBe("mismatch");
  expect(result.disagreements).toEqual([{ period: "2025", left: 120, right: 125 }]);
  expect(compareAnnualSum("t", months.slice(1), years, { tolerance: 1 }).compared).toBe(1);
});
