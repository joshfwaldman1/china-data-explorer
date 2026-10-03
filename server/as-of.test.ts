/**
 * The store keeps every vintage, so it can say what the site showed on any
 * past date: each period at the latest value fetched by then, periods first
 * seen later absent, and a retraction honoured only from when it was made.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-asof-")), "test.db");
process.env.CHINA_SEED = "off";
const { db, writeSeries, readSeries } = await import("./db.ts");

const result = (points: { date: string; value: number }[]) => ({
  key: "as_of_test", title: "Retail sales", agency: "National Bureau of Statistics",
  sourceUrl: "https://data.stats.gov.cn/", frequency: "Monthly", unit: "Percent",
  series: [{ label: "YoY %", points }],
});
const at = (asOf?: string) => readSeries("as_of_test", 120, "", asOf)?.series[0]?.points ?? [];

writeSeries(result([{ date: "2026-06", value: 4.8 }, { date: "2026-07", value: 3.7 }]), "", "2026-08-15T02:00:00.000Z");
writeSeries(result([{ date: "2026-07", value: 3.9 }, { date: "2026-08", value: 3.4 }]), "", "2026-09-15T02:00:00.000Z");
db().query("INSERT INTO observations (key, region, label, period, value, fetched_at) VALUES ('as_of_test', '', 'YoY %', '2026-06', NULL, '2026-09-20T00:00:00.000Z')").run();

test("today's read is the latest of every period, without the retracted one", () => {
  expect(at()).toEqual([{ date: "2026-07", value: 3.9 }, { date: "2026-08", value: 3.4 }]);
});

test("as of a past date, the values fetched by then, and nothing first seen later", () => {
  expect(at("2026-08-31T23:59:59.999Z")).toEqual([{ date: "2026-06", value: 4.8 }, { date: "2026-07", value: 3.7 }]);
  expect(at("2026-09-16T23:59:59.999Z")).toEqual([{ date: "2026-06", value: 4.8 }, { date: "2026-07", value: 3.9 }, { date: "2026-08", value: 3.4 }]);
  expect(at("2026-08-01T00:00:00.000Z")).toEqual([]);
});
