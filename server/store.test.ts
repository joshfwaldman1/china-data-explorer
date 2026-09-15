/**
 * Network-free tests for the store and the esData parser — the two places
 * where the data traps live. The database path is set before the module is
 * imported so each run gets a fresh file.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH = join(mkdtempSync(join(tmpdir(), "china-store-")), "test.db");
process.env.CHINA_SEED = "off"; // start from an empty store, not the seed

const { writeSeries, readSeries, readRevisions, listStoredSeries, seriesFreshness, logFetch, lastReleaseRefresh, dbHealth, dbStatus, dbStatusWithSeries, storedLatest } = await import("./db.ts");
const { parseEsDataPoints } = await import("./nbs-catalog.ts");

const NATIONAL = "000000000000";
const GUANGDONG = "440000000000";

function result(key: string, label: string, points: { date: string; value: number }[]) {
  return {
    key, title: "Test series", agency: "National Bureau of Statistics", sourceUrl: "",
    frequency: "Monthly", unit: "%", series: [{ label, points }],
  };
}

test("storedLatest reports the first period and the first non-zero period", () => {
  writeSeries(result("zeros_t", "全国", [
    { date: "2016-04", value: 0 }, { date: "2016-05", value: 0 }, { date: "2017-02", value: 3395.6 },
  ]), NATIONAL, "2026-01-01T00:00:00.000Z");
  const row = storedLatest("zeros_t").find((item) => item.key === "zeros_t");
  expect(row?.firstPeriod).toBe("2016-04");
  expect(row?.firstRealPeriod).toBe("2017-02");
  expect(row?.lastPeriod).toBe("2017-02");
});

test("regions of one key are stored and read back separately", () => {
  const first = writeSeries(result("nbs_t", "全国", [
    { date: "2024-01", value: 1 }, { date: "2024-02", value: 2 },
  ]), NATIONAL, "2026-01-01T00:00:00.000Z");
  const second = writeSeries(result("nbs_t", "广东省", [{ date: "2024-01", value: 10 }]),
    GUANGDONG, "2026-01-01T00:00:00.000Z");
  expect(first.changed).toBe(2);
  expect(second.changed).toBe(1);

  const guangdong = readSeries("nbs_t", 600, GUANGDONG);
  expect(guangdong?.series).toHaveLength(1);
  expect(guangdong?.series[0]?.label).toBe("广东省");
  expect(guangdong?.series[0]?.points).toEqual([{ date: "2024-01", value: 10 }]);

  // No region filter still returns every region, which is what the curated
  // path relies on.
  expect(readSeries("nbs_t", 600)?.series).toHaveLength(2);
  // Scoped to this key: other tests in this suite write nbs_ keys of their own
  // into the same store, and what this is checking is that one key's regions
  // are listed separately.
  expect(listStoredSeries("nbs_").filter((row) => row.key === "nbs_t")).toEqual([
    { key: "nbs_t", region: NATIONAL }, { key: "nbs_t", region: GUANGDONG },
  ]);
  expect(seriesFreshness("nbs_t", GUANGDONG)).toBe("2026-01-01T00:00:00.000Z");
});

test("a revised value becomes a second row and an unchanged one writes nothing", () => {
  const revised = writeSeries(result("nbs_t", "全国", [
    { date: "2024-01", value: 1 }, { date: "2024-02", value: 2.5 },
  ]), NATIONAL, "2026-02-01T00:00:00.000Z");
  expect(revised.points).toBe(2);
  expect(revised.changed).toBe(1);

  const trail = readRevisions("nbs_t", "全国", "2024-02", NATIONAL);
  expect(trail.map((row) => row.value)).toEqual([2, 2.5]);
  expect(readSeries("nbs_t", 600, NATIONAL)?.series[0]?.points).toEqual([
    { date: "2024-01", value: 1 }, { date: "2024-02", value: 2.5 },
  ]);

  const repeat = writeSeries(result("nbs_t", "全国", [
    { date: "2024-01", value: 1 }, { date: "2024-02", value: 2.5 },
  ]), NATIONAL, "2026-03-01T00:00:00.000Z");
  expect(repeat.changed).toBe(0);
});

test("esData parser skips blank cells and other regions, and labels quarters", () => {
  const raw = {
    data: [
      { code: "202601MM", values: [{ _id: "X", da: NATIONAL, value: "5.2" }] },
      { code: "202602MM", values: [{ _id: "X", da: NATIONAL, value: "" }] },
      { code: "202603MM", values: [{ _id: "X", da: GUANGDONG, value: "9.9" }] },
      { code: "202604MM", values: [{ _id: "Y", da: NATIONAL, value: "7.7" }] },
      { code: "202602SS", values: [{ _id: "X", da: NATIONAL, value: "104.5" }] },
    ],
  };
  expect(parseEsDataPoints(raw, "X", NATIONAL)).toEqual([
    { date: "2026-01", value: 5.2 },
    { date: "2026-Q2", value: 104.5 },
  ]);
  // A province asked of a national section comes back as a grid of blanks:
  // that must parse to nothing, so the caller can treat it as a failure.
  expect(parseEsDataPoints(raw, "X", "310000000000")).toEqual([]);
});

test("the healthcheck counts observations without the status page having been opened", () => {
  const before = dbHealth();
  expect(before.ok).toBe(true);
  expect(before.observations).toBeGreaterThan(0);
});

test("the status summary leaves out the per-series coverage list unless asked", () => {
  const summary = dbStatus();
  expect(summary.totals.observations).toBeGreaterThan(0);
  expect("perSeries" in summary).toBe(false);
  expect(summary.fetchLog.rows).toBeGreaterThanOrEqual(0);
  const full = dbStatusWithSeries();
  expect(full.perSeries.length).toBeGreaterThan(0);
  expect(full.perSeries[0]).toHaveProperty("lastPeriod");
});

test("the last release-day refresh is read back from the fetch log", () => {
  expect(lastReleaseRefresh()).toBeNull();
  logFetch({ key: "release_refresh", region: "", startedAt: "2026-09-15T01:40:00.000Z", finishedAt: "2026-09-15T01:41:00.000Z", status: "ok", points: 3, changed: 1, message: "70-city new home prices, monthly" });
  logFetch({ key: "release_refresh", region: "", startedAt: "2026-09-15T02:10:00.000Z", finishedAt: "2026-09-15T02:12:00.000Z", status: "ok", points: 0, changed: 2, message: "National economy monthly bundle" });
  expect(lastReleaseRefresh()).toEqual({ en: "National economy monthly bundle", at: "2026-09-15T02:12:00.000Z", attempts: 2, advanced: 0 });
});

test("an empty February takes the combined January-February figure from the year-to-date column", async () => {
  const { eastmoneyValue } = await import("./data.ts");
  const field = { field: "BASE_SAME", januaryFebruaryField: "BASE_ACCUMULATE", label: "x" };
  expect(eastmoneyValue({ BASE_SAME: null, BASE_ACCUMULATE: 6.3 }, field, "2026-02")).toBe(6.3);
  expect(eastmoneyValue({ BASE_SAME: 5.7, BASE_ACCUMULATE: 6.1 }, field, "2026-03")).toBe(5.7);
  expect(eastmoneyValue({ BASE_SAME: null, BASE_ACCUMULATE: 6.1 }, field, "2026-03")).toBeNull();
  expect(eastmoneyValue({ BASE_SAME: null, BASE_ACCUMULATE: 6.3 }, { field: "BASE_SAME", label: "x" }, "2026-02")).toBeNull();
});

test("an NBS indicator's empty February takes the year-to-date growth of the same table", async () => {
  const { nbsPeriodValue } = await import("./data.ts");
  const idcfg = { id: "monthly", januaryFebruaryId: "ytd", label: "x" };
  const values = [{ _id: "monthly", da: "000000000000", value: null }, { _id: "ytd", da: "000000000000", value: 4.1 }];
  expect(nbsPeriodValue(values, idcfg, "000000000000", "2026-02")).toBe(4.1);
  expect(nbsPeriodValue(values, idcfg, "000000000000", "2026-03")).toBeNull();
  expect(nbsPeriodValue([{ _id: "monthly", value: 3 }, { _id: "ytd", value: 4 }], idcfg, "000000000000", "2026-02")).toBe(3);
  expect(nbsPeriodValue(values, { id: "monthly", label: "x" }, "000000000000", "2026-02")).toBeNull();
});

test("a fetch whose every series reads 0 over stored values is rejected as a mirror glitch", async () => {
  const { isZeroedFetch } = await import("./ingest.ts");
  const zeroed = result("money_t", "M1", [{ date: "2026-06", value: 4.2 }, { date: "2026-07", value: 0 }]);
  zeroed.series.push({ label: "M2", points: [{ date: "2026-06", value: 7.9 }, { date: "2026-07", value: 0 }] });
  const stored = (_key: string, _region: string, label: string, period: string) =>
    (period === "2026-07" ? (label === "M1" ? 4 : 7.7) : null);
  expect(isZeroedFetch(zeroed, "", stored)).toBe(true);
  // A genuine zero the store has never held a value for is written as usual.
  expect(isZeroedFetch(zeroed, "", () => null)).toBe(false);
  // A zero the store already holds is a real reading, not a glitch.
  expect(isZeroedFetch(zeroed, "", () => 0)).toBe(false);
  // One series still carrying a value means the response is not blank.
  const partial = result("money_t", "M1", [{ date: "2026-07", value: 0 }]);
  partial.series.push({ label: "M2", points: [{ date: "2026-07", value: 7.7 }] });
  expect(isZeroedFetch(partial, "", stored)).toBe(false);
});

test("period ranges use the bureau's own code for each frequency", async () => {
  const { periodRange, periodLabel } = await import("./nbs-catalog.ts");
  const now = new Date("2026-09-15T00:00:00.000Z");
  expect(periodRange("Monthly", 3, now)).toBe("202607MM-202609MM");
  expect(periodRange("Quarterly", 3, now)).toBe("202601SS-202603SS");
  // An annual range written as plain years ("2024-2026") is answered with HTTP 500.
  expect(periodRange("Annual", 3, now)).toBe("2024YY-2026YY");
  expect(periodLabel("2026YY")).toBe("2026");
  expect(periodLabel("202602SS")).toBe("2026-Q2");
  expect(periodLabel("202607MM")).toBe("2026-07");
});

test("a series' range summary follows what is written, including a later period and a revision", () => {
  writeSeries(result("range_t", "全国", [
    { date: "2024-01", value: 0 }, { date: "2024-02", value: 3 },
  ]), NATIONAL, "2026-01-01T00:00:00.000Z");
  const first = storedLatest("range_t").find((row) => row.key === "range_t");
  expect(first?.firstPeriod).toBe("2024-01");
  expect(first?.firstRealPeriod).toBe("2024-02");
  expect(first?.lastPeriod).toBe("2024-02");

  // A later period extends the range; a revision of an existing one does not move it.
  writeSeries(result("range_t", "全国", [
    { date: "2024-02", value: 4 }, { date: "2024-03", value: 5 },
  ]), NATIONAL, "2026-02-01T00:00:00.000Z");
  const second = storedLatest("range_t").find((row) => row.key === "range_t");
  expect(second?.firstPeriod).toBe("2024-01");
  expect(second?.lastPeriod).toBe("2024-03");
});

test("an answer with no period grid is a busy portal, not an empty series", async () => {
  const { hasPeriodGrid, parseEsDataPoints } = await import("./nbs-catalog.ts");
  // What the portal sends when it is throttling: 200, and nothing in it.
  expect(hasPeriodGrid({ data: [] })).toBe(false);
  expect(hasPeriodGrid({})).toBe(false);
  // What a discontinued indicator looks like: the grid is there, the cells are blank.
  const discontinued = { data: [{ code: "2025YY", values: [{ _id: "x", value: "", da: "000000000000" }] }] };
  expect(hasPeriodGrid(discontinued)).toBe(true);
  expect(parseEsDataPoints(discontinued, "x", "000000000000")).toEqual([]);
});

test("a backup copy holds the same observations and can be opened on its own", async () => {
  const { backupStore } = await import("./db.ts");
  const { Database } = await import("bun:sqlite");
  writeSeries(result("backup_t", "全国", [
    { date: "2026-01", value: 1 }, { date: "2026-02", value: 2 },
  ]), NATIONAL, "2026-03-01T00:00:00.000Z");
  const path = join(mkdtempSync(join(tmpdir(), "china-backup-")), "copy.db");
  const bytes = backupStore(path);
  expect(bytes).toBeGreaterThan(0);
  const copy = new Database(path, { readonly: true });
  const rows = copy.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM observations WHERE key = 'backup_t'").get();
  expect(rows?.n).toBe(2);
  copy.close();
});
