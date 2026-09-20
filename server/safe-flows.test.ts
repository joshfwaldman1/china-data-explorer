/**
 * SAFE's bank cross-border receipts and payments (银行代客涉外收付款) as
 * published on 15 September 2026, the page that links the workbook, and the
 * release whose headline the workbook must reproduce.
 */

import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { CROSS_BORDER_ITEMS, fetchSafe, parseFlowsWorkbook, parseFxHeadline, workbookLink } from "./safe.ts";
import { compareAnnualSum } from "./concordance.ts";

const fixture = (name: string) => Bun.file(resolve(import.meta.dir, `fixtures/safe/${name}`)).arrayBuffer();
const text = async (name: string) => new TextDecoder().decode(await fixture(name));
const WORKBOOK = "cross-border-time-series-20260915.xls";
const PAGE_URL = "https://www.safe.gov.cn/safe/2018/0419/8806.html";
const WORKBOOK_URL = "https://www.safe.gov.cn/safe/file/file/20260915/80afd81e7ddd45ba81f56fce342cdb77.xls";
const config = (sheet: string, frequency = "Monthly") => ({
  kind: "safe" as const, table: "cross_border" as const, group: "Trade & External",
  title: "t", agency: "SAFE", frequency, unit: "u", sheet, items: CROSS_BORDER_ITEMS,
});

test("the statistics page links the time-series workbook, not a regional table", async () => {
  const page = await text("cross-border-page.html");
  expect(workbookLink(page, /时间序列/)).toBe(WORKBOOK_URL);
  expect(workbookLink(page, /分地区/)).toContain("2c109ab99cdb4ba1a3e8169e43f83925.xlsx");
});

test("the yuan monthly sheet parses every line from January 2010 to August 2026", async () => {
  const series = parseFlowsWorkbook(await fixture(WORKBOOK), "以人民币计值（月度）");
  expect([...series.keys()].sort()).toEqual(CROSS_BORDER_ITEMS.map((item) => item.label).sort());
  const net = series.get("Net receipts") ?? [];
  expect(net.length).toBe(200);
  expect(net[0]?.date).toBe("2010-01");
  expect(net.at(-1)).toEqual({ date: "2026-08", value: 4231.94 });
  // The net is the difference of the two sides, and the sub-lines come from the 差额 section only.
  const receipts = series.get("Receipts")?.at(-1)?.value ?? NaN;
  const payments = series.get("Payments")?.at(-1)?.value ?? NaN;
  expect(Math.round(receipts - payments)).toBe(Math.round(net.at(-1)?.value ?? NaN));
  expect(series.get("Net, services")?.at(-1)?.value).toBeLessThan(0);
});

test("August 2026 receipts and payments match SAFE's release headline", async () => {
  const headline = parseFxHeadline(await text("fx-release-2026-08.html"));
  // The release states both the settlement figures and the cross-border ones.
  expect(headline?.period).toBe("2026-08");
  expect(headline?.receipts).toBe(52718);
  expect(headline?.payments).toBe(48486);
  const series = parseFlowsWorkbook(await fixture(WORKBOOK), "以人民币计值（月度）");
  expect(Math.round(series.get("Receipts")?.at(-1)?.value ?? NaN)).toBe(headline?.receipts ?? NaN);
  expect(Math.round(series.get("Payments")?.at(-1)?.value ?? NaN)).toBe(headline?.payments ?? NaN);
  expect(series.get("Receipts")?.at(-1)?.date).toBe(headline?.period ?? "");
});

test("the annual sheet's months sum to its years", async () => {
  const monthly = parseFlowsWorkbook(await fixture(WORKBOOK), "以人民币计值（月度）").get("Net receipts") ?? [];
  const annual = parseFlowsWorkbook(await fixture(WORKBOOK), "以人民币计值（年度）").get("Net receipts") ?? [];
  expect(annual[0]?.date).toBe("2010");
  expect(annual.at(-1)?.date).toBe("2025");
  const result = compareAnnualSum("t", monthly, annual, { tolerance: 1 });
  expect(result.status).toBe("ok");
  expect(result.compared).toBe(3);
});

test("the adapter serves the last months from the linked workbook and complete years from the annual sheet", async () => {
  const files: Record<string, string> = { [PAGE_URL]: "cross-border-page.html", [WORKBOOK_URL]: WORKBOOK };
  const read = async (url: string) => fixture(files[url] ?? "missing");
  const monthly = await fetchSafe("cross_border_flows", config("以人民币计值（月度）"), 3, read);
  expect(monthly.sourceUrl).toBe(PAGE_URL);
  expect(monthly.series[0]?.label).toBe("Net receipts");
  expect(monthly.series[0]?.points.map((point) => point.date)).toEqual(["2026-06", "2026-07", "2026-08"]);
  const usd = await fetchSafe("cross_border_flows_usd", config("以美元计值（月度）"), 1, read);
  expect(usd.series[0]?.points).toEqual([{ date: "2026-08", value: 623.57 }]);
  const annual = await fetchSafe("cross_border_flows_annual", config("以人民币计值（年度）", "Annual"), 3, read);
  expect(annual.series[0]?.points.map((point) => point.date)).toEqual(["2023", "2024", "2025"]);
});
