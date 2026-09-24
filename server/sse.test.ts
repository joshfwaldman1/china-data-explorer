/**
 * The Shanghai exchange's monthly K-line for the Composite, captured on
 * 24 September 2026, parsed the way the adapter parses it, and the rule
 * that keeps the running month out of a month-end series.
 */

import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { LABELS, fetchSse, monthEnds, monthTurnover, parseKline } from "./sse.ts";

const fixture = async () => JSON.parse(await Bun.file(resolve(import.meta.dir, "fixtures/sse/dayk-000001-month-2026-09-24.json")).text()) as unknown;
const captured = new Date("2026-09-24T09:00:00Z");

test("the response is one row per month back to the index's base, seven numbers each", async () => {
  const rows = parseKline(await fixture());
  expect(rows.length).toBe(430);
  expect(rows[0]).toMatchObject({ date: "1990-12-31" });
  expect(rows.at(-1)).toMatchObject({ date: "2026-09-24", close: 3888.373 });
});

test("the running month is not a month end and is left out; the last complete month is August", async () => {
  const points = monthEnds(parseKline(await fixture()), captured);
  expect(points.at(-1)?.date).toBe("2026-08");
  expect(points.some((point) => point.date === "2026-09")).toBe(false);
  expect(points.length).toBe(429);
  // Once September has ended, its close counts.
  expect(monthEnds(parseKline(await fixture()), new Date("2026-10-02T00:00:00Z")).at(-1)?.date).toBe("2026-09");
});

test("turnover is the exchange's yuan figure in 100 million yuan, one decimal", async () => {
  const rows = parseKline(await fixture());
  const august = rows.find((row) => row.date.startsWith("2026-08"))!;
  const point = monthTurnover(rows, captured).find((item) => item.date === "2026-08")!;
  expect(point.value).toBe(Math.round(august.turnover / 1e8 * 10) / 10);
  expect(point.value).toBeGreaterThan(10000);
});

test("a changed shape is refused rather than read as zeros", async () => {
  expect(() => parseKline({ kline: [[20260131, 1, 2, 3, "4", 5, 6]] })).toThrow(/seven numbers/);
  expect(() => parseKline({ kline: [[2026, 1, 2, 3, 4, 5, 6]] })).toThrow(/yyyymmdd/);
  expect(() => parseKline({ data: [] })).toThrow(/kline/);
});

test("the adapter serves two lines, month-end close and turnover, from one request", async () => {
  const body = await fixture();
  let url = "";
  const result = await fetchSse("sse_composite", { kind: "sse", group: "Markets", title: "SSE Composite Index", agency: "Shanghai Stock Exchange", frequency: "Monthly", unit: "Index", code: "000001" }, 24, async (u) => { url = u; return body; });
  expect(url).toContain("/v1/sh1/dayk/000001?");
  expect(url).toContain("period=month");
  expect(result.series.map((line) => line.label)).toEqual([LABELS.close, LABELS.turnover]);
  expect(result.series[0]!.points.length).toBe(24);
  expect(result.agency).toBe("Shanghai Stock Exchange");
});
