/**
 * What a release refresh asks the bureau for, and for where.
 *
 * These are the faults found on 15 September 2026: the refresh keyed its work
 * by indicator and requested the national figure for every one of them, so a
 * provincial table was asked for the nation (which answers with a grid of
 * zeroes), and it compared periods as raw strings, where "2026-Q2" is greater
 * than the "2026-06" that it is, so no quarterly series was ever refreshed
 * after a quarterly release.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-release-")), "test.db");
process.env.CHINA_SEED = "off";

const { writeSeries } = await import("./db.ts");
const { refreshCatalogForRelease } = await import("./ingest.ts");
const { releaseTargets } = await import("./release-plan.ts");

function entry(key: string, frequency: "Monthly" | "Quarterly", geography: "National" | "Province") {
  return {
    key, id: key.replace("nbs_", ""), name: `${key} 名称`, shortName: key, nameEn: key, unit: "%",
    note: "", annotation: "", datasetCode: geography === "National" ? 1 : 4,
    dataset: geography === "National" ? "月度数据" : "分省月度数据",
    frequency, geography, cid: `cid-${frequency}-${geography}`, rootId: "root",
    categories: ["工业"], precision: null,
  };
}

function stored(key: string, region: string, label: string, period: string, value: number) {
  writeSeries({
    key, title: key, agency: "NBS", sourceUrl: "", frequency: "Monthly", unit: "%",
    series: [{ label, points: [{ date: period, value }] }],
  }, region, "2026-09-01T00:00:00.000Z");
}

test("a provincial series is asked for its own province, and one province being current does not cover another", async () => {
  const provincial = entry("nbs_reltest_prov", "Monthly", "Province");
  stored(provincial.key, "440000000000", "广东省", "2026-08", 1); // current
  stored(provincial.key, "110000000000", "北京市", "2026-07", 2); // behind

  const asked: { ids: string[]; region: string }[] = [];
  const result = await refreshCatalogForRelease(["工业"], releaseTargets({ title: "国民经济运行情况", keys: [], categories: ["工业"] }, new Date("2026-09-15T02:00:00Z")), {
    entries: [provincial],
    pauseMs: 0,
    fetchBatch: async (entries, region) => {
      asked.push({ ids: entries.map((item) => item.id), region: region?.value ?? "" });
      return new Map(entries.map((item) => [item.id, [{ date: "2026-08", value: 3 }]]));
    },
  });

  expect(asked).toEqual([{ ids: ["reltest_prov"], region: "110000000000" }]);
  expect(result.checked).toBe(1);
  expect(result.advanced).toBe(1);
  expect(result.pending).toBe(0);
});

test("a quarterly series stored as 2026-Q2 is behind a 2026-09 quarter and is refreshed", async () => {
  const quarterly = entry("nbs_reltest_q", "Quarterly", "National");
  stored(quarterly.key, "000000000000", "全国", "2026-Q2", 4);

  const asked: string[] = [];
  const targets = releaseTargets({ title: "国内生产总值", keys: [], categories: ["工业"] }, new Date("2026-10-18T02:00:00Z"));
  expect(targets).toEqual([{ frequency: "Quarterly", period: "2026-09" }]);
  const result = await refreshCatalogForRelease(["工业"], targets, {
    entries: [quarterly],
    pauseMs: 0,
    fetchBatch: async (entries, region) => {
      asked.push(region?.value ?? "");
      return new Map(entries.map((item) => [item.id, [{ date: "2026-Q3", value: 5 }]]));
    },
  });
  expect(asked).toEqual(["000000000000"]);
  expect(result.advanced).toBe(1);
});

test("a series that already holds the period is not fetched again", async () => {
  const national = entry("nbs_reltest_nat", "Monthly", "National");
  stored(national.key, "000000000000", "全国", "2026-08", 6);
  let calls = 0;
  const result = await refreshCatalogForRelease(["工业"], releaseTargets({ title: "国民经济运行情况", keys: [], categories: ["工业"] }, new Date("2026-09-15T02:00:00Z")), {
    entries: [national],
    pauseMs: 0,
    fetchBatch: async (entries) => { calls += 1; return new Map(entries.map((item) => [item.id, []])); },
  });
  expect(calls).toBe(0);
  expect(result.checked).toBe(0);
});

test("a series the store has never held is left to the crawl, not the release", async () => {
  const unseen = entry("nbs_reltest_unseen", "Monthly", "National");
  let calls = 0;
  const result = await refreshCatalogForRelease(["工业"], releaseTargets({ title: "国民经济运行情况", keys: [], categories: ["工业"] }, new Date("2026-09-15T02:00:00Z")), {
    entries: [unseen],
    pauseMs: 0,
    fetchBatch: async (entries) => { calls += 1; return new Map(entries.map((item) => [item.id, []])); },
  });
  expect(calls).toBe(0);
  expect(result.checked).toBe(0);
});

test("a table that answers without the period is counted as still pending, so the release retries", async () => {
  const national = entry("nbs_reltest_late", "Monthly", "National");
  stored(national.key, "000000000000", "全国", "2026-07", 7);
  const result = await refreshCatalogForRelease(["工业"], releaseTargets({ title: "国民经济运行情况", keys: [], categories: ["工业"] }, new Date("2026-09-15T02:00:00Z")), {
    entries: [national],
    pauseMs: 0,
    // The bureau's database has not caught up: the answer is the old period.
    fetchBatch: async (entries) => new Map(entries.map((item) => [item.id, [{ date: "2026-07", value: 7 }]])),
  });
  expect(result.advanced).toBe(0);
  expect(result.pending).toBe(1);
});

test("one attempt takes a bounded slice and leaves the rest pending", async () => {
  // Thirty places behind on the same table: a release attempt asks for a few
  // and reports the rest, rather than running through all of them at once.
  const provincial = entry("nbs_reltest_many", "Monthly", "Province");
  // Real province codes: a place the table is not published for is not a target.
  const regions = ["110000000000", "120000000000", "130000000000", "140000000000", "150000000000", "210000000000"];
  for (const region of regions) stored(provincial.key, region, region, "2026-07", 1);

  let calls = 0;
  const result = await refreshCatalogForRelease(["工业"], releaseTargets({ title: "国民经济运行情况", keys: [], categories: ["工业"] }, new Date("2026-09-15T02:00:00Z")), {
    entries: [provincial],
    pauseMs: 0,
    maxRequests: 2,
    fetchBatch: async (entries) => { calls += 1; return new Map(entries.map((item) => [item.id, [{ date: "2026-08", value: 2 }]])); },
  });
  expect(calls).toBe(2);
  expect(result.advanced).toBe(2);
  expect(result.pending).toBe(4);
});

test("failed table calls spend the release request budget and leave all missing series pending", async () => {
  const provincial = entry("nbs_reltest_budget_failure", "Monthly", "Province");
  for (const region of ["110000000000", "120000000000", "130000000000"]) {
    stored(provincial.key, region, region, "2026-07", 1);
  }
  let calls = 0;
  const result = await refreshCatalogForRelease(["工业"], [{ frequency: "Monthly", period: "2026-08" }], {
    entries: [provincial], pauseMs: 0, maxRequests: 1,
    fetchBatch: async () => { calls += 1; throw new Error("portal unavailable"); },
  });
  expect(calls).toBe(1);
  expect(result).toEqual({ advanced: 0, checked: 3, requests: 1, pending: 3 });
});

test("release attempts take turns through the tables still behind instead of asking the same ones every time", async () => {
  const tables = ["a", "b", "c"].map((name) => ({ ...entry(`nbs_rotation_${name}`, "Monthly", "National"), cid: `rotation-table-${name}` }));
  for (const table of tables) stored(table.key, "000000000000", "全国", "2026-07", 1);
  const targets = releaseTargets({ title: "国民经济运行情况", keys: [], categories: ["工业"] }, new Date("2026-09-15T02:00:00Z"));
  const asked: string[] = [];
  // Nothing ever advances: the bureau has not loaded the month.
  const fetchBatch = async (entries: { cid: string }[]) => { asked.push(entries[0]?.cid ?? ""); return new Map(); };
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const result = await refreshCatalogForRelease(["工业"], targets, { entries: tables, fetchBatch, pauseMs: 0, maxRequests: 1, attempt });
    expect(result.requests).toBe(1);
    expect(result.pending).toBe(3);
  }
  expect(asked).toEqual(["rotation-table-a", "rotation-table-b", "rotation-table-c", "rotation-table-a"]);
});

test("a place years behind is left to the due-based refresh; one release behind is chased", async () => {
  const table = { ...entry("nbs_cadence_boilers", "Monthly", "Province"), cid: "cadence-table" };
  stored(table.key, "440000000000", "广东省", "2026-07", 1); // one behind: chased
  stored(table.key, "460000000000", "海南省", "2021-02", 1); // stopped in 2021: not this release's
  const targets = releaseTargets({ title: "国民经济运行情况", keys: [], categories: ["工业"] }, new Date("2026-09-15T02:00:00Z"));
  const asked: string[] = [];
  const result = await refreshCatalogForRelease(["工业"], targets, {
    entries: [table], pauseMs: 0,
    fetchBatch: async (_entries, region) => { asked.push(region?.value ?? ""); return new Map(); },
  });
  expect(asked).toEqual(["440000000000"]);
  expect(result.checked).toBe(1);
});

test("the earliest period still on a release's cadence allows January and February published together", async () => {
  const { earliestOnCadence } = await import("./ingest.ts");
  expect(earliestOnCadence({ frequency: "Monthly", period: "2026-08" })).toBe("2026-06");
  expect(earliestOnCadence({ frequency: "Monthly", period: "2026-02" })).toBe("2025-12");
  expect(earliestOnCadence({ frequency: "Quarterly", period: "2026-06" })).toBe("2026-03");
});
