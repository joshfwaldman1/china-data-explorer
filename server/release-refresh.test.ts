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
