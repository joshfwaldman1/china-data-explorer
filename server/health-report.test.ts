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
const { logFetch, writeSeries, db } = await import("./db.ts");
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
  const line = healthHeadline({ ...report, sources: { ...report.sources, failing: [] }, behind: { publisher: [], blocked: [], ended: [] }, singlePoint: [] });
  expect(line).toContain("All 2 cross-checks agree");
  expect(line).toContain("nothing overdue");
});

test("the headline names each kind of wrong, and only the kinds present", () => {
  // Stated with no single-point lines, since the shared test store holds whatever other files wrote.
  const base = { ...healthReport([agreeing]), singlePoint: [] };
  const withFinding = healthHeadline({ ...base, checks: { ...base.checks, findings: [{ name: "x", kind: "value", disagreements: [] }] }, sources: { ...base.sources, failing: [] }, behind: { publisher: [], blocked: [], ended: [] } });
  expect(withFinding).toBe("1 cross-check disagreeing.");
  const withBoth = healthHeadline({
    ...base,
    checks: { ...base.checks, findings: [{ name: "x", kind: "value", disagreements: [] }, { name: "y", kind: "value", disagreements: [] }] },
    sources: { ...base.sources, failing: [{ key: "k", title: "t", agency: "a", failures: 1, since: "", latest: "", message: "" }] },
    behind: { publisher: [{ key: "b", title: "t", agency: "a", frequency: "Monthly", lastPeriod: "2026-01", expected: "2026-08" }], blocked: [], ended: [] },
  });
  expect(withBoth).toBe("2 cross-checks disagreeing; 1 source not reading; 1 series behind.");
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

test("a curated line holding a single point is listed; a line that grows past one leaves the list", () => {
  // The shape of the April 2025 Customs misread, one point beside the real line. Not named "Quantity (<number>)",
  // because the store is shared and the cleanup test counts those.
  // A real commodity, so the list can be held to the name the series page uses rather than the slug.
  const region = "aquatic-products";
  const write = (points: { label: string; dates: string[] }[], at: string) => writeSeries({
    key: "major_exports", title: "Major exports", agency: "General Administration of Customs", unit: "Million USD", frequency: "Monthly", sourceUrl: "",
    series: points.map((line) => ({ label: line.label, points: line.dates.map((date) => ({ date, value: 1 })) })),
  } as never, region, at);
  write([{ label: "Value", dates: ["2025-03", "2025-04", "2025-05"] }, { label: "A stray line", dates: ["2025-04"] }], "2026-09-01T00:00:00.000Z");
  const flagged = healthReport([agreeing]).singlePoint.filter((line) => line.region === region);
  expect(flagged).toEqual([{ key: "major_exports", title: "Major Exports by Commodity", region, regionName: "Aquatic products", label: "A stray line", period: "2025-04" }]);
  // The banner counts what the list shows.
  const report = healthReport([agreeing]);
  expect(healthHeadline({ ...report, singlePoint: flagged })).toContain("1 line with a single point");
  // A second period written later takes it off the list: the count follows the write path.
  write([{ label: "A stray line", dates: ["2025-05"] }], "2026-09-02T00:00:00.000Z");
  expect(healthReport([agreeing]).singlePoint.some((line) => line.region === region)).toBe(false);
  // A store that predates the count is counted on first ask, not left unknown.
  db().query("UPDATE series SET periods = NULL WHERE key = 'major_exports' AND region = $region").run({ $region: region });
  write([{ label: "Another stray line", dates: ["2025-06"] }], "2026-09-03T00:00:00.000Z");
  db().query("UPDATE series SET periods = NULL WHERE key = 'major_exports' AND region = $region").run({ $region: region });
  expect(healthReport([agreeing]).singlePoint.filter((line) => line.region === region).map((line) => line.label)).toEqual(["Another stray line"]);
});

test("a reviewed single-point line is listed with its reason and no longer keeps the banner from clearing", () => {
  // The production case: Customs moved this quantity from tons to 10,000 tons, and the old line kept one point.
  writeSeries({
    key: "major_exports_cny", title: "Major exports", agency: "General Administration of Customs", unit: "Hundred million CNY (亿元)", frequency: "Monthly", sourceUrl: "",
    series: [
      { label: "Value", points: [{ date: "2026-02", value: 10 }, { date: "2026-03", value: 11 }] },
      { label: "Quantity (Ton)", points: [{ date: "2026-02", value: 5 }] },
    ],
  } as never, "medical-and-pharmaceutical-products", "2026-09-04T00:00:00.000Z");
  const report = healthReport([agreeing]);
  const line = report.singlePoint.find((one) => one.key === "major_exports_cny" && one.region === "medical-and-pharmaceutical-products");
  expect(line?.label).toBe("Quantity (Ton)");
  expect(line?.reviewed).toBe("Customs changed this quantity from tons to 10,000 tons in March 2026, so the line split in two.");
  // Only reviewed lines: the banner clears. One unreviewed line beside it: it counts one.
  const clean = { ...report, sources: { ...report.sources, failing: [] }, behind: { publisher: [], blocked: [], ended: [] } };
  expect(healthHeadline({ ...clean, singlePoint: [line!] })).toContain("All 1 cross-check");
  expect(healthHeadline({ ...clean, singlePoint: [line!, { ...line!, label: "A stray line", reviewed: undefined }] })).toBe("1 line with a single point.");
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
  // The budget above is the report's. Writing the 20,000 log rows first is the slow part and is
  // not what this test measures: on GitHub's runners it took up to 12.5 seconds and tripped the
  // default 5-second test timeout on four runs in thirty, with the report itself well inside 2.
}, 60_000);

test("the catalog crawl's failures are counted, not listed beside the curated ones", () => {
  // The crawl walks 66,000 NBS series and a good many are entries the bureau
  // indexes with nothing behind them. Twelve thousand of those, listed one per
  // line, buried the news completely: the first live report of this page
  // opened with "12187 sources failing to parse", which was true and useless.
  for (let index = 0; index < 40; index += 1) {
    const at = daysAgo(2);
    logFetch({ key: `nbs_${index.toString(16).padStart(32, "0")}`, startedAt: at, finishedAt: at, status: "error", points: 0, changed: 0, message: "source returned a grid with no values" });
  }
  const at = daysAgo(2);
  logFetch({ key: "trade_partners", startedAt: at, finishedAt: at, status: "error", points: 0, changed: 0, message: "by-country table: unexpected unit line" });

  const report = healthReport([agreeing]);
  // A curated series is named and listed.
  expect(report.sources.failing.some((source) => source.key === "trade_partners")).toBe(true);
  // A crawl series never is, however many there are.
  expect(report.sources.failing.some((source) => source.key.startsWith("nbs_"))).toBe(false);
  expect(report.sources.crawl.series).toBeGreaterThanOrEqual(40);
  expect(report.sources.crawl.attempts).toBeGreaterThanOrEqual(report.sources.crawl.series);
  expect(report.sources.crawl.reasons[0]?.reason).toBe("the bureau's index lists them with no values behind them");
  // The headline counts the sources a person can act on, not the crawl's tail.
  expect(healthHeadline(report)).not.toContain(`${report.sources.crawl.series}`);
});

test("a source that has fetched cleanly since its last failure is recovered, not failing", () => {
  // The aggregate-financing keys failed ten times in five hours on the morning
  // their adapter was built, fetched cleanly thirty-seven minutes later, and
  // have every day since. The page listed them as "failing to parse" for a
  // fortnight and sent one to the top of the queue as a live bug. It was not.
  const at = daysAgo(6);
  for (let hour = 0; hour < 5; hour += 1) {
    const when = new Date(new Date(at).getTime() + hour * 3_600_000).toISOString();
    logFetch({ key: "tsf_flow", startedAt: when, finishedAt: when, status: "error", points: 0, changed: 0, message: "PBOC flow table: header not found" });
  }
  const recoveredAt = new Date(new Date(at).getTime() + 5 * 3_600_000 + 37 * 60_000).toISOString();
  logFetch({ key: "tsf_flow", startedAt: recoveredAt, finishedAt: recoveredAt, status: "ok", points: 1044, changed: 3, message: "" });
  // And a source that is genuinely still failing: its last event is a failure.
  logFetch({ key: "lgb_rate", startedAt: daysAgo(3), finishedAt: daysAgo(3), status: "ok", points: 10, changed: 0, message: "" });
  logFetch({ key: "lgb_rate", startedAt: daysAgo(1), finishedAt: daysAgo(1), status: "error", points: 0, changed: 0, message: "MOF -> HTTP 502" });

  const report = healthReport([agreeing]);
  const tsf = report.sources.recovered.find((source) => source.key === "tsf_flow");
  expect(tsf).toBeDefined();
  expect(tsf?.failures).toBe(5);
  expect(tsf?.recoveredAt).toBe(recoveredAt);
  // Recovered means not failing: it is in one list and not the other, and not in the headline.
  expect(report.sources.failing.some((source) => source.key === "tsf_flow")).toBe(false);
  expect(healthHeadline({ ...report, sources: { ...report.sources, failing: report.sources.failing.filter((s) => s.key === "tsf_flow") }, behind: { publisher: [], blocked: [], ended: [] }, singlePoint: [] })).toContain("All 1 cross-check");
  // A source whose last event is a failure is still failing, however many successes preceded it.
  const lgb = report.sources.failing.find((source) => source.key === "lgb_rate");
  expect(lgb).toBeDefined();
  expect(lgb?.recoveredAt).toBeUndefined();
  expect(report.sources.recovered.some((source) => source.key === "lgb_rate")).toBe(false);
});

test("the audit's own log row is not a source, and a blocked key is not a parse failure", () => {
  const at = daysAgo(2);
  logFetch({ key: "concordance", startedAt: at, finishedAt: at, status: "error", points: 0, changed: 0, message: "mismatch   Port throughput: month vs year to date" });
  logFetch({ key: "caixin_pmi", startedAt: at, finishedAt: at, status: "error", points: 0, changed: 0, message: "AKTools is not configured on this deployment" });
  logFetch({ key: "real_estate", startedAt: at, finishedAt: at, status: "error", points: 0, changed: 0, message: "AKTools is not configured on this deployment" });
  const before = process.env.AKTOOLS_URL; process.env.AKTOOLS_URL = "off";
  const report = healthReport([agreeing]);
  if (before === undefined) delete process.env.AKTOOLS_URL; else process.env.AKTOOLS_URL = before;
  const listed = [...report.sources.failing, ...report.sources.recovered].map((source) => source.key);
  // Whether anything disagrees is the checks section's job; the audit's log row would say "failing" forever.
  expect(listed).not.toContain("concordance");
  // A missing service is shown under blocked, once, not as a source that will not parse.
  expect(listed).not.toContain("caixin_pmi");
  expect(listed).not.toContain("real_estate");
  expect(report.behind.blocked.some((row) => row.key === "real_estate")).toBe(true);
  // The Caixin surveys are marked ended in the catalog as well as blocked, and
  // "ended" wins: a publisher that stopped is a different fact from a service
  // this deployment lacks, and the more permanent one is the one to state.
  expect(report.behind.ended.some((row) => row.key === "caixin_pmi")).toBe(true);
  expect(report.behind.blocked.some((row) => row.key === "caixin_pmi")).toBe(false);
});

test("a series is behind by its own release day, not by a day picked for everything", async () => {
  const { expectedPeriod } = await import("./due.ts");
  // The 22nd of a month. Nothing published on the 25th is behind yet; something published on the 12th is.
  const the22nd = new Date(Date.UTC(2026, 8, 22));
  expect(expectedPeriod("Monthly", the22nd, 25)).toBe("2026-07");
  expect(expectedPeriod("Monthly", the22nd, 12)).toBe("2026-08");
  // A key that states no day is expected only once the following month has ended.
  expect(expectedPeriod("Monthly", the22nd, 31)).toBe("2026-07");
  expect(expectedPeriod("Monthly", new Date(Date.UTC(2026, 9, 1)), 31)).toBe("2026-08");
  // And the report threads each key's own day through, so a finance-ministry
  // series with the 25th stated is not behind on the 22nd. (Checked through
  // the catalog rather than a fixture: the rule is only right if it uses the
  // day the entry actually states.)
  const { catalogList } = await import("./data.ts");
  const fiscal = catalogList().find((entry) => entry.key === "fiscal_revenue");
  expect(fiscal?.releaseDay).toBe(25);
});
