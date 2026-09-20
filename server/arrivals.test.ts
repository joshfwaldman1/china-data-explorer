/**
 * When a figure arrived, and whether the site may say a release carried it.
 *
 * The store has always held the answer — nothing is overwritten, so the
 * first vintage of a period is the moment the site first saw it — and the
 * point of this module is to read it without overclaiming. A figure seen
 * days after its month closed arrived with the publisher's release. A
 * figure seen years later came out of an archive, and calling that a
 * publication date would attribute to the publisher a date it never set.
 *
 * The test writes a store whose three periods are each of those cases, and
 * one with a calendar entry to match, then holds every stored point to
 * resolving as one or the other.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-arrivals-")), "test.db");
process.env.CHINA_SEED = "off";
const { writeSeries } = await import("./db.ts");
const { arrivalsFor, arrivalSentence, recordReleases, storedReleases, withinReleaseWindow, periodEnd, BEFORE_RELEASES_RECORDED } = await import("./arrivals.ts");

const series = (points: { date: string; value: number }[]) => ({
  key: "test_output", title: "Test Output", agency: "National Bureau of Statistics",
  sourceUrl: "https://data.stats.gov.cn/", frequency: "Monthly", unit: "Percent",
  series: [{ label: "Output (YoY %)", points }],
});

// 2024-01 was backfilled in 2026; 2026-07 and 2026-08 arrived with their releases,
// and 2026-07 was restated a month later.
writeSeries(series([{ date: "2024-01", value: 3.1 }]), "", "2026-09-01T02:00:00.000Z");
writeSeries(series([{ date: "2026-07", value: 5.0 }]), "", "2026-08-15T02:10:00.000Z");
writeSeries(series([{ date: "2026-07", value: 5.2 }]), "", "2026-09-15T02:10:00.000Z");
writeSeries(series([{ date: "2026-08", value: 5.2 }]), "", "2026-09-15T02:10:00.000Z");

recordReleases([{
  id: "nbs-2026-09-15", agency: "National Bureau of Statistics",
  publishedAt: "2026-09-15T02:00:00.000Z",
  title: "2026年8月份规模以上工业增加值增长5.2%", titleEn: "Industrial output, August 2026",
  url: "https://www.stats.gov.cn/sj/zxfb/202609/t20260915_1965308.html",
  keys: ["test_output"],
}]);

const arrivals = arrivalsFor("test_output", { frequency: "Monthly", agency: "National Bureau of Statistics" });
const at = (period: string) => arrivals.find((arrival) => arrival.period === period);

test("every stored point resolves to a release or to a backfill, and nothing is unaccounted for", () => {
  expect(arrivals.length).toBe(3);
  for (const arrival of arrivals) {
    expect(["release", "revision", "backfill"], arrival.period).toContain(arrival.kind);
    expect(arrival.firstSeen, arrival.period).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(arrivalSentence(arrival).length, arrival.period).toBeGreaterThan(20);
  }
  // Newest first, and every period the store holds is present exactly once.
  expect(arrivals.map((arrival) => arrival.period)).toEqual(["2026-08", "2026-07", "2024-01"]);
});

test("a period first seen years after it closed is a backfill, not a publication date", () => {
  const old = at("2024-01");
  expect(old?.kind).toBe("backfill");
  expect(old?.release).toBeUndefined();
  expect(arrivalSentence(old!)).toBe(BEFORE_RELEASES_RECORDED);
  // And the sentence does not claim a date the publisher never set.
  expect(arrivalSentence(old!)).not.toContain("2026-09-01");
});

test("a period seen days after it closed arrived with the release the calendar named", () => {
  const august = at("2026-08");
  expect(august?.kind).toBe("release");
  expect(august?.vintages).toBe(1);
  expect(august?.release?.title).toBe("Industrial output, August 2026");
  expect(august?.release?.url).toContain("stats.gov.cn");
  expect(arrivalSentence(august!)).toContain("Industrial output, August 2026");
});

test("a period stored twice is a revision, and both sightings are kept", () => {
  const july = at("2026-07");
  expect(july?.kind).toBe("revision");
  expect(july?.vintages).toBe(2);
  expect(july?.firstSeen.slice(0, 10)).toBe("2026-08-15");
  expect(july?.lastRevised?.slice(0, 10)).toBe("2026-09-15");
  expect(arrivalSentence(july!)).toContain("restated 1 time");
});

test("the release window is per frequency, and a figure cannot arrive long before its period ends", () => {
  expect(periodEnd("2026-08")?.toISOString().slice(0, 10)).toBe("2026-08-31");
  expect(periodEnd("2026-Q2")?.toISOString().slice(0, 10)).toBe("2026-06-30");
  expect(periodEnd("2025")?.toISOString().slice(0, 10)).toBe("2025-12-31");
  // A month published a fortnight later is a release; two years later is not.
  expect(withinReleaseWindow("2026-08", "2026-09-15T00:00:00Z", "Monthly")).toBe(true);
  expect(withinReleaseWindow("2024-01", "2026-09-01T00:00:00Z", "Monthly")).toBe(false);
  // A quarter takes longer than a month to publish, and the window says so.
  expect(withinReleaseWindow("2026-Q2", "2026-09-15T00:00:00Z", "Monthly")).toBe(false);
  expect(withinReleaseWindow("2026-Q2", "2026-09-15T00:00:00Z", "Quarterly")).toBe(true);
  // The purchasing managers' index is published on the last day of its own month.
  expect(withinReleaseWindow("2026-08", "2026-08-31T01:00:00Z", "Monthly")).toBe(true);
  // Nothing arrives a month before the period it describes has ended.
  expect(withinReleaseWindow("2026-08", "2026-07-31T00:00:00Z", "Monthly")).toBe(false);
});

test("recording the same release twice updates it rather than duplicating it", () => {
  recordReleases([{
    id: "nbs-2026-09-15", agency: "National Bureau of Statistics",
    publishedAt: "2026-09-15T02:00:00.000Z",
    title: "2026年8月份规模以上工业增加值增长5.2%", titleEn: "Industrial output, August 2026 (revised title)",
    url: "https://www.stats.gov.cn/sj/zxfb/202609/t20260915_1965308.html", keys: ["test_output"],
  }]);
  const log = storedReleases();
  expect(log.filter((release) => release.id === "nbs-2026-09-15").length).toBe(1);
  expect(log.find((release) => release.id === "nbs-2026-09-15")?.titleEn).toContain("revised title");
  expect(log.find((release) => release.id === "nbs-2026-09-15")?.keys).toEqual(["test_output"]);
});
