/**
 * Reproductions of the release-scheduling faults found on 15 September 2026,
 * and the behaviour that replaces them. Each test names the thing that went
 * wrong; none of them touches the network.
 */

import { test, expect } from "bun:test";
import { releaseTargets, outstandingTargets, releaseComplete, pendingSeries } from "./release-plan.ts";

const bundle = { title: "国民经济运行情况(10:00)", keys: ["industrial_production", "retail_sales", "unemployment"], categories: ["工业", "国内贸易"] };
const pmi = { title: "采购经理指数(09:30)", keys: ["pmi"], categories: ["采购经理指数"] };
const gdp = { title: "国内生产总值(10:00)", keys: ["gdp"], categories: ["国民经济核算"] };

test("a monthly release reports the month before the one it appears in", () => {
  const targets = releaseTargets(bundle, new Date("2026-09-15T02:00:00Z"));
  expect(targets).toEqual([{ frequency: "Monthly", period: "2026-08" }]);
});

test("the purchasing managers' index reports the month it is published in", () => {
  // Published on the last day of the month it describes: 30 September is September.
  expect(releaseTargets(pmi, new Date("2026-09-30T01:30:00Z"))).toEqual([{ frequency: "Monthly", period: "2026-09" }]);
  // A holiday pushed February 2026's into March; it still describes February.
  expect(releaseTargets(pmi, new Date("2026-03-04T01:30:00Z"))).toEqual([{ frequency: "Monthly", period: "2026-02" }]);
});

test("the national economy briefing that carries a quarter asks for the month and the quarter", () => {
  const targets = releaseTargets(bundle, new Date("2026-07-15T02:00:00Z"));
  expect(targets).toEqual([
    { frequency: "Monthly", period: "2026-06" },
    { frequency: "Quarterly", period: "2026-06" },
  ]);
  // The GDP release named as such is quarterly only.
  expect(releaseTargets(gdp, new Date("2026-07-15T02:00:00Z"))).toEqual([{ frequency: "Quarterly", period: "2026-06" }]);
});

test("a quarter written 2026-Q2 is not newer than the 2026-06 it is", () => {
  // "2026-Q2" > "2026-06" as strings, which had every quarterly series counting
  // as already up to date whatever it held.
  const targets = releaseTargets(gdp, new Date("2026-10-18T02:00:00Z"));
  expect(targets).toEqual([{ frequency: "Quarterly", period: "2026-09" }]);
  const behind = [{ key: "nbs_a", region: "", frequency: "Quarterly", lastPeriod: "2026-Q2" }];
  expect(outstandingTargets(targets, behind)).toEqual(targets);
  const current = [{ key: "nbs_a", region: "", frequency: "Quarterly", lastPeriod: "2026-Q3" }];
  expect(outstandingTargets(targets, current)).toEqual([]);
});

test("one series arriving does not finish a release the rest of it is behind on", () => {
  const targets = releaseTargets(bundle, new Date("2026-09-15T02:00:00Z"));
  const stored = [
    { key: "industrial_production", region: "", frequency: "Monthly", lastPeriod: "2026-08" },
    { key: "retail_sales", region: "", frequency: "Monthly", lastPeriod: "2026-07" },
  ];
  expect(releaseComplete(targets, stored)).toBe(false);
  expect(pendingSeries(targets, stored).map((series) => series.key)).toEqual(["retail_sales"]);

  const both = stored.map((series) => ({ ...series, lastPeriod: "2026-08" }));
  expect(releaseComplete(targets, both)).toBe(true);
  expect(pendingSeries(targets, both)).toEqual([]);
});

test("a province that has the new month does not stand in for one that has not", () => {
  const targets = releaseTargets(bundle, new Date("2026-09-15T02:00:00Z"));
  const stored = [
    { key: "nbs_x", region: "440000000000", frequency: "Monthly", lastPeriod: "2026-08" },
    { key: "nbs_x", region: "110000000000", frequency: "Monthly", lastPeriod: "2026-07" },
  ];
  expect(releaseComplete(targets, stored)).toBe(false);
  expect(pendingSeries(targets, stored).map((series) => series.region)).toEqual(["110000000000"]);
});

test("a bundle's monthly and quarterly series are each judged against their own target", () => {
  const targets = releaseTargets(bundle, new Date("2026-07-15T02:00:00Z"));
  const stored = [
    { key: "monthly_one", region: "", frequency: "Monthly", lastPeriod: "2026-06" },
    { key: "quarterly_one", region: "", frequency: "Quarterly", lastPeriod: "2026-Q1" },
  ];
  expect(releaseComplete(targets, stored)).toBe(false);
  expect(pendingSeries(targets, stored).map((series) => series.key)).toEqual(["quarterly_one"]);
});

test("a release with nothing stored under it is not complete", () => {
  expect(releaseComplete(releaseTargets(bundle, new Date("2026-09-15T02:00:00Z")), [])).toBe(false);
});
