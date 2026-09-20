import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NbsCatalogEntry } from "./nbs-catalog.ts";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-revisions-")), "test.db");
process.env.CHINA_SEED = "off";

const { db, writeSeries, seriesFullHistoryCheck, storedLatest, readRevisions } = await import("./db.ts");
const { dueReason } = await import("./due.ts");
const { refreshCatalogTargets, refreshCatalogForRelease } = await import("./ingest.ts");
const { refreshNbsCatalogSeries, storeNbsPoints } = await import("./nbs-catalog.ts");

const region = "000000000000";
function entry(key: string): NbsCatalogEntry {
  return {
    key, id: key.slice(4), name: key, shortName: key, unit: "%", note: "", annotation: "",
    datasetCode: 1, dataset: "月度数据", frequency: "Monthly", geography: "National",
    cid: "revision-test-table", rootId: "revision-test-root", categories: ["工业"], precision: null,
  };
}

function write(key: string, points: { date: string; value: number }[], at: string, historyWindow: "full" | "recent") {
  return writeSeries({ key, title: key, agency: "NBS", sourceUrl: "", frequency: "Monthly", unit: "%", series: [{ label: "全国", points }] }, region, at, { historyWindow });
}

test("twelve monthly recent updates cannot starve full-history revision audits", () => {
  const key = "nbs_revision_monthly_clock";
  write(key, [{ date: "2025-12", value: 1 }], "2026-01-01T00:00:00.000Z", "full");
  let audits = 0;
  for (let month = 0; month < 12; month += 1) {
    const now = new Date(Date.UTC(2026, month, 25));
    const period = new Date(Date.UTC(2026, month - 1, 1)).toISOString().slice(0, 7);
    const yesterday = new Date(now.getTime() - 86400000).toISOString();
    write(key, [{ date: period, value: 2 }], yesterday, "recent");
    const held = storedLatest(key).find((row) => row.key === key);
    expect(held).toBeDefined();
    if (!held) throw new Error("series was not stored");
    const reason = dueReason("Monthly", held.lastPeriod, held.updatedAt, now, undefined, held);
    if (reason === "revision") {
      audits += 1;
      write(key, [{ date: period, value: 2 }], now.toISOString(), "full");
    }
  }
  expect(audits).toBe(6);
  expect(seriesFullHistoryCheck(key, region).lastFullHistoryCheck).toBe("2026-12-25T00:00:00.000Z");
});

test("full audit failures and empty answers preserve the clock, while success records an old revision", async () => {
  const catalogEntry = entry("nbs_revision_old_value");
  const initial = "2020-01-01T00:00:00.000Z";
  write(catalogEntry.key, [{ date: "2018-01", value: 10 }, { date: "2026-08", value: 20 }], initial, "full");
  const targets: { key: string; region: string; reason: "revision" }[] = [{ key: catalogEntry.key, region, reason: "revision" }];
  const options = { entries: [catalogEntry], pauseMs: 0 };
  const failed = await refreshCatalogTargets(targets, { ...options, fetchBatch: async () => { throw new Error("portal unavailable"); } });
  expect(failed.error).toBe(1);
  expect(seriesFullHistoryCheck(catalogEntry.key, region).lastFullHistoryCheck).toBe(initial);
  const empty = await refreshCatalogTargets(targets, { ...options, fetchBatch: async () => new Map() });
  expect(empty.empty).toBe(1);
  expect(seriesFullHistoryCheck(catalogEntry.key, region).lastFullHistoryCheck).toBe(initial);
  const startedAt = Date.now();
  const successful = await refreshCatalogTargets(targets, {
    ...options,
    fetchBatch: async (_, __, window) => {
      expect(window).toBe("full");
      return new Map([[catalogEntry.id, [{ date: "2018-01", value: 11 }, { date: "2026-08", value: 20 }]]]);
    },
  });
  expect(successful.ok).toBe(1);
  const clock = seriesFullHistoryCheck(catalogEntry.key, region).lastFullHistoryCheck;
  expect(clock && Date.parse(clock)).toBeGreaterThanOrEqual(startedAt);
  expect(readRevisions(catalogEntry.key, "全国", "2018-01", region).map((row) => row.value)).toEqual([10, 11]);
});

test("recent release and catch-up successes leave the last full-history check unchanged", async () => {
  const catalogEntry = entry("nbs_revision_recent_window");
  const initial = "2020-01-01T00:00:00.000Z";
  write(catalogEntry.key, [{ date: "2018-01", value: 10 }, { date: "2026-07", value: 20 }], initial, "full");
  const options = {
    entries: [catalogEntry], pauseMs: 0,
    fetchBatch: async (_: NbsCatalogEntry[], __: unknown, window?: "full" | "recent") => {
      expect(window).toBe("recent");
      return new Map([[catalogEntry.id, [{ date: "2026-08", value: 21 }]]]);
    },
  };
  await refreshCatalogForRelease(["工业"], [{ frequency: "Monthly", period: "2026-08" }], options);
  expect(seriesFullHistoryCheck(catalogEntry.key, region).lastFullHistoryCheck).toBe(initial);
  await refreshCatalogTargets([{ key: catalogEntry.key, region, reason: "new-period" }], options);
  expect(seriesFullHistoryCheck(catalogEntry.key, region).lastFullHistoryCheck).toBe(initial);
  expect(readRevisions(catalogEntry.key, "全国", "2018-01", region).map((row) => row.value)).toEqual([10]);
});

test("unchanged full answers advance only their own region's clock, in the observation transaction", () => {
  const key = "nbs_revision_atomic_clock";
  const points = [{ date: "2026-08", value: 1 }];
  write(key, points, "2026-01-01T00:00:00.000Z", "full");
  const repeated = write(key, points, "2026-02-01T00:00:00.000Z", "full");
  expect(repeated.changed).toBe(0);
  expect(seriesFullHistoryCheck(key, region).lastFullHistoryCheck).toBe("2026-02-01T00:00:00.000Z");
  expect(seriesFullHistoryCheck(key, "440000000000").lastFullHistoryCheck).toBeNull();
  db().exec(`CREATE TEMP TRIGGER reject_revision_clock BEFORE UPDATE ON series_refresh_state
    WHEN NEW.key = 'nbs_revision_atomic_clock' BEGIN SELECT RAISE(ABORT, 'test write failure'); END`);
  try {
    expect(() => write(key, [{ date: "2026-08", value: 2 }], "2026-03-01T00:00:00.000Z", "full")).toThrow("test write failure");
    expect(seriesFullHistoryCheck(key, region).lastFullHistoryCheck).toBe("2026-02-01T00:00:00.000Z");
    expect(readRevisions(key, "全国", "2026-08", region).map((row) => row.value)).toEqual([1]);
  } finally {
    db().exec("DROP TRIGGER reject_revision_clock");
  }
});

test("individual full refreshes and crawl batches record full checks, but empty and failed refreshes do not", async () => {
  const catalogEntry = entry("nbs_revision_individual_full");
  const initial = "2020-01-01T00:00:00.000Z";
  write(catalogEntry.key, [{ date: "2018-01", value: 1 }], initial, "full");
  await expect(refreshNbsCatalogSeries(catalogEntry, region, {
    fetchPoints: async () => { throw new Error("portal unavailable"); },
  })).rejects.toThrow("portal unavailable");
  expect(seriesFullHistoryCheck(catalogEntry.key, region).lastFullHistoryCheck).toBe(initial);
  await expect(refreshNbsCatalogSeries(catalogEntry, region, { fetchPoints: async () => [] })).rejects.toThrow("no observations");
  expect(seriesFullHistoryCheck(catalogEntry.key, region).lastFullHistoryCheck).toBe(initial);

  const startedAt = Date.now();
  const refreshed = await refreshNbsCatalogSeries(catalogEntry, region, {
    fetchPoints: async (_, __, window) => {
      expect(window).toBe("full");
      return [{ date: "2018-01", value: 1 }];
    },
  });
  expect(refreshed.changed).toBe(0);
  const clock = seriesFullHistoryCheck(catalogEntry.key, region).lastFullHistoryCheck;
  expect(clock && Date.parse(clock)).toBeGreaterThanOrEqual(startedAt);

  const crawled = entry("nbs_revision_crawl_full");
  expect(storeNbsPoints(crawled, { text: "全国", value: region }, [{ date: "2018-01", value: 2 }], new Date().toISOString())).toBe("ok");
  expect(seriesFullHistoryCheck(crawled.key, region).lastFullHistoryCheck).not.toBeNull();
});
