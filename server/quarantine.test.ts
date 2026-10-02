/**
 * The bureau's portal answers some failing requests with a grid of zeros, and
 * observations are append-only, so a zero written once stays in a period's
 * vintages for good. A stored figure that a fetch would overwrite with exactly
 * 0 is held aside instead; a first sighting of 0 is written as before.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-quarantine-")), "test.db");
process.env.CHINA_SEED = "off";
const { db, writeSeries } = await import("./db.ts");

const result = (points: { date: string; value: number }[]) => ({
  key: "nbs_quarantine_test", title: "Money supply", agency: "National Bureau of Statistics",
  sourceUrl: "https://data.stats.gov.cn/", frequency: "Monthly", unit: "Percent",
  series: [{ label: "M2 (YoY %)", points }],
});
const vintages = (period: string) => db()
  .query<{ value: number | null }, { $period: string }>("SELECT value FROM observations WHERE key = 'nbs_quarantine_test' AND period = $period ORDER BY fetched_at")
  .all({ $period: period }).map((row) => row.value);

test("a stored figure is not overwritten by a zero; the zero is held, and the next good answer changes nothing", () => {
  writeSeries(result([{ date: "2026-06", value: 0 }, { date: "2026-07", value: 7.7 }]), "", "2026-09-07T03:37:45.937Z");
  const zeroed = writeSeries(result([{ date: "2026-06", value: 0 }, { date: "2026-07", value: 0 }]), "", "2026-09-10T09:02:34.714Z");
  expect(zeroed.held).toBe(1);
  expect(zeroed.changed).toBe(0);
  const recovered = writeSeries(result([{ date: "2026-06", value: 0 }, { date: "2026-07", value: 7.7 }]), "", "2026-09-10T09:12:21.481Z");
  expect(recovered.changed).toBe(0);
  expect(vintages("2026-07")).toEqual([7.7]);
  // The first-sighting zero (a placeholder month) is stored as it always was.
  expect(vintages("2026-06")).toEqual([0]);
  const quarantined = db().query<{ value: number; previous: number; reason: string }, []>(
    "SELECT value, previous, reason FROM observations_quarantine WHERE key = 'nbs_quarantine_test'",
  ).all();
  expect(quarantined).toEqual([{ value: 0, previous: 7.7, reason: "nonzero overwritten by 0" }]);
});

test("an ordinary revision, including one away from zero, is written as before", () => {
  writeSeries(result([{ date: "2026-08", value: 8.0 }]), "", "2026-09-15T00:00:00.000Z");
  const revised = writeSeries(result([{ date: "2026-08", value: 8.1 }, { date: "2026-06", value: 0.3 }]), "", "2026-09-16T00:00:00.000Z");
  expect(revised.held).toBe(0);
  expect(revised.changed).toBe(2);
  expect(vintages("2026-08")).toEqual([8.0, 8.1]);
  expect(vintages("2026-06")).toEqual([0, 0.3]);
});
