/**
 * The health report: what is wrong with the data, assembled from the store
 * and the audit.
 *
 * The bug that motivated this module is the one to keep in mind. Customs
 * changed the wording above its tables, the parser refused every month before
 * the change, and "22 of 55 months failed to parse" repeated on every ingest
 * run for weeks — into a log nobody reads, while the page looked healthy
 * because the months it could still read were the recent ones. The check was
 * running and reporting the whole time. So these tests are mostly about
 * whether a failure that repeats is legible as one failing source rather than
 * forty log lines, and whether the three kinds of wrong stay separated.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-health-")), "test.db");
process.env.CHINA_SEED = "off";
const { logFetch } = await import("./db.ts");
const { healthReport, healthHeadline } = await import("./health-report.ts");
const { compareValues } = await import("./concordance.ts");

const agreeing = compareValues("a check that agrees", [{ date: "2026-08", value: 1 }], [{ date: "2026-08", value: 1 }], { tolerance: 0.1 });
const disagreeing = compareValues("CPI: mirror vs the bureau", [{ date: "2026-08", value: 0.8 }], [{ date: "2026-08", value: 2.4 }], { tolerance: 0.1, note: "Both are meant to be the same figure." });

test("a clean report says so in one line, and names the number of checks", () => {
  const report = healthReport([agreeing, agreeing]);
  expect(report.checks.total).toBe(2);
  expect(report.checks.ok).toBe(2);
  expect(report.checks.findings).toEqual([]);
  // The headline is a pure reading of a report, so it is stated against one
  // rather than against whatever the shared test store happens to hold.
  const line = healthHeadline({ ...report, sources: { ...report.sources, failing: [] }, behind: { publisher: [], blocked: [], ended: [] } });
  expect(line).toContain("All 2 cross-checks agree");
  expect(line).toContain("nothing overdue");
});

test("the headline names each kind of wrong, and only the kinds present", () => {
  const base = healthReport([agreeing]);
  const withFinding = healthHeadline({ ...base, checks: { ...base.checks, findings: [{ name: "x", kind: "value", disagreements: [] }] }, sources: { ...base.sources, failing: [] }, behind: { publisher: [], blocked: [], ended: [] } });
  expect(withFinding).toBe("1 cross-check disagreeing.");
  const withBoth = healthHeadline({
    ...base,
    checks: { ...base.checks, findings: [{ name: "x", kind: "value", disagreements: [] }, { name: "y", kind: "value", disagreements: [] }] },
    sources: { ...base.sources, failing: [{ key: "k", title: "t", agency: "a", failures: 1, since: "", latest: "", message: "" }] },
    behind: { publisher: [{ key: "b", title: "t", agency: "a", frequency: "Monthly", lastPeriod: "2026-01", expected: "2026-08" }], blocked: [], ended: [] },
  });
  expect(withBoth).toBe("2 cross-checks disagreeing; 1 source failing to parse; 1 series behind.");
  // A blocked or discontinued series is not "behind": neither is a fault to chase.
  const blockedOnly = healthHeadline({ ...base, checks: { ...base.checks, findings: [] }, sources: { ...base.sources, failing: [] }, behind: { publisher: [], blocked: [{ key: "c", title: "t", agency: "a", frequency: "Monthly", lastPeriod: "2025-09", expected: "2026-08", blocked: "AkShare" }], ended: [] } });
  expect(blockedOnly).toContain("All 1 cross-check");
});

test("a disagreement is a finding and carries the two values, not just a name", () => {
  const report = healthReport([agreeing, disagreeing]);
  expect(report.checks.ok).toBe(1);
  expect(report.checks.findings.length).toBe(1);
  const finding = report.checks.findings[0]!;
  expect(finding.name).toBe("CPI: mirror vs the bureau");
  expect(finding.latest).toMatchObject({ period: "2026-08", left: 0.8, right: 2.4 });
  expect(finding.note).toContain("same figure");
  expect(healthHeadline(report)).toContain("1 cross-check disagreeing");
});

/** A moment `days` ago, so the fixtures sit inside or outside the window on purpose. */
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

test("a source failing on every run is one failing source, dated from the first", () => {
  // Three runs of the same parse failure, as the ingest actually records them.
  for (const [days, message] of [[10, "22 of 55 months failed to parse"], [5, "22 of 55 months failed to parse"], [1, "23 of 56 months failed to parse"]] as const) {
    logFetch({ key: "major_exports", startedAt: daysAgo(days), finishedAt: daysAgo(days), status: "error", points: 0, changed: 0, message });
  }
  logFetch({ key: "tax_by_type", startedAt: daysAgo(1), finishedAt: daysAgo(1), status: "error", points: 0, changed: 0, message: "MOF -> HTTP 502" });
  // A successful run is not a failure, however many there are.
  logFetch({ key: "cpi", startedAt: daysAgo(1), finishedAt: daysAgo(1), status: "ok", points: 12, changed: 1, message: "" });
  // A fault fixed two months ago is history, not news, and must not be reported.
  logFetch({ key: "fiscal_revenue", startedAt: daysAgo(60), finishedAt: daysAgo(60), status: "error", points: 0, changed: 0, message: "long since fixed" });

  const report = healthReport([agreeing]);
  const customs = report.sources.failing.find((source) => source.key === "major_exports");
  expect(customs).toBeDefined();
  // Three log rows, one source.
  expect(customs?.failures).toBe(3);
  expect(new Date(customs!.since).getTime()).toBeLessThan(new Date(customs!.latest).getTime());
  // The message shown is the newest one, since that is what is true now.
  expect(customs?.message).toContain("23 of 56");
  // It is named for the reader, not by key alone.
  expect(customs?.title).toBe("Major Exports by Commodity");
  expect(customs?.agency).toContain("Customs");
  expect(report.sources.failing.some((source) => source.key === "cpi")).toBe(false);
  // Worst first. The suite shares one store, so this is stated against the two
  // keys this test wrote rather than against the whole list.
  const mine = report.sources.failing.filter((source) => source.key === "major_exports" || source.key === "tax_by_type");
  expect(mine.map((source) => source.key)).toEqual(["major_exports", "tax_by_type"]);
  // The two-month-old fault is outside the window the page states, so it is not news.
  expect(report.sources.failing.some((source) => source.key === "fiscal_revenue")).toBe(false);
  // Widen the window and it comes back, which is what makes the default a choice
  // rather than a silent truncation.
  const wider = healthReport([agreeing], { windowDays: 90 });
  expect(wider.sources.failing.some((source) => source.key === "fiscal_revenue")).toBe(true);
});

test("the three kinds of behind stay apart, because only one of them is ours", () => {
  const report = healthReport([agreeing]);
  const all = [...report.behind.publisher, ...report.behind.blocked, ...report.behind.ended];
  // No series appears in two lists.
  expect(new Set(all.map((row) => row.key)).size).toBe(all.length);
  // A series whose publisher stopped is recorded as ended, never as late.
  for (const row of report.behind.ended) expect(row.ended).toBeTypeOf("string");
  for (const row of report.behind.blocked) expect(row.blocked).toBeTypeOf("string");
  for (const row of report.behind.publisher) {
    expect(row.ended).toBeUndefined();
    expect(row.blocked).toBeUndefined();
  }
  // Comparisons held by other institutions are not this site's timeliness to answer for.
  expect(all.some((row) => row.key === "fx_usdcny")).toBe(false);
  // Every row says what it was measured against.
  for (const row of all) expect(row.expected.length).toBeGreaterThan(3);
});

test("the store line reports what is actually stored", () => {
  const report = healthReport([agreeing]);
  expect(report.store.observations).toBeGreaterThanOrEqual(0);
  expect(report.ranAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  // The report says how far back the failures it considered go, so "no failures"
  // can be read as "none since that date" rather than "none ever".
  expect(report.sources.consideredSince).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

test("the report stays cheap on a log the size production actually keeps", () => {
  // The first version of this endpoint asked SQLite for the newest message per
  // failing key with a correlated subquery, against an unindexed table, and
  // read every stored series to find the curated ones. bun:sqlite is
  // synchronous, so that ran on the thread serving HTTP: polling the page was
  // enough to stop the site answering anything at all, which is exactly what
  // happened on 21 September 2026. This is the check that would have caught it
  // before the deploy rather than after.
  const bulk = 20_000;
  const start = Date.now() - 40 * 86_400_000;
  for (let index = 0; index < bulk; index += 1) {
    // Mostly successful runs, as a real log is, with a recurring failure in it.
    const at = new Date(start + index * 60_000).toISOString();
    logFetch({
      key: index % 50 === 0 ? `noisy_source_${index % 200}` : "cpi",
      startedAt: at, finishedAt: at,
      status: index % 50 === 0 ? "error" : "ok",
      points: 1, changed: 0, message: index % 50 === 0 ? "a failure worth reporting" : "",
    });
  }
  const began = Date.now();
  const report = healthReport([agreeing]);
  const took = Date.now() - began;
  expect(report.sources.failing.length).toBeGreaterThan(0);
  // Generous: the point is that it is milliseconds rather than seconds, and
  // that it does not grow with the log. A regression here means the server
  // blocks, not that the page is slow.
  expect(took).toBeLessThan(2_000);
});
