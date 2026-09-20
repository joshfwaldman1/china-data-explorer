/**
 * The legacy .xls reader, against SAFE's cross-border workbook as published
 * on 15 September 2026: a real BIFF8 file written by Excel, 425 KB, four
 * sheets and about twenty thousand cells. What is checked is what a
 * statistical table needs — the sheet names, the header of date serials, the
 * labels down the first column, and numbers in each of the encodings Excel
 * chooses between (RK, MULRK and full doubles).
 */

import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { columnLetters, readXls } from "./xls.ts";

const fixture = () => Bun.file(resolve(import.meta.dir, "fixtures/safe/cross-border-time-series-20260915.xls")).arrayBuffer();

test("a compound document opens and its four sheets carry their cells", async () => {
  const sheets = readXls(await fixture());
  expect(sheets.map((sheet) => sheet.name)).toEqual([
    "以人民币计值（年度）", "以人民币计值（月度）", "以美元计值（年度）", "以美元计值（月度）",
  ]);
  for (const sheet of sheets) expect(sheet.cells.size).toBeGreaterThan(800);
});

test("shared strings come back as text and the row labels read in order", async () => {
  const sheet = readXls(await fixture()).find((candidate) => candidate.name === "以人民币计值（月度）");
  expect(sheet?.cells.get("A2")).toBe("银行代客涉外收付款数据（以人民币计值）");
  expect(sheet?.cells.get("A3")).toBe("单位：亿元人民币");
  expect(sheet?.cells.get("A5")).toBe("一、收入");
  expect(sheet?.cells.get("A23")).toBe("二、支出");
  expect(sheet?.cells.get("A41")).toBe("三、收支差额");
  // Indented sub-rows keep their leading spaces, as the workbook writes them.
  expect(String(sheet?.cells.get("A7"))).toContain("1.经常账户");
});

test("numbers come back whatever encoding the writer chose, and the header is a run of date serials", async () => {
  const sheet = readXls(await fixture()).find((candidate) => candidate.name === "以人民币计值（月度）");
  // January 2010 through August 2026: 200 monthly columns, each a date inside its month.
  const header: number[] = [];
  for (let column = 2; column <= 400; column += 1) {
    const value = sheet?.cells.get(`${columnLetters(column)}4`);
    if (typeof value !== "number") break;
    header.push(value);
  }
  expect(header.length).toBe(200);
  const asDate = (serial: number) => new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10);
  expect(asDate(header[0]!)).toBe("2010-01-01");
  expect(asDate(header.at(-1)!)).toBe("2026-08-01");
  // The August 2026 column: receipts, payments and their difference, to two decimals.
  const last = columnLetters(201);
  const receipts = Number(sheet?.cells.get(`${last}5`)), payments = Number(sheet?.cells.get(`${last}23`)), net = Number(sheet?.cells.get(`${last}41`));
  expect(Math.round(receipts)).toBe(52718);
  expect(Math.round(payments)).toBe(48486);
  expect(Math.round(net)).toBe(Math.round(receipts - payments));
});

test("a file that is not a compound document is refused rather than misread", () => {
  expect(() => readXls(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]))).toThrow(/not a compound document/);
});
