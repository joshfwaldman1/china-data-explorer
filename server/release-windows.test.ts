/**
 * Publisher windows: open by Beijing day and hour, and asking only for the
 * series one month behind.
 */

import { test, expect } from "bun:test";
import { activeWindows, keysAwaitingRelease, reportedMonth, type PublisherWindow } from "./release-windows";

const WINDOWS: PublisherWindow[] = [
  { agency: "People's Bank of China", days: [7, 18], hours: [9, 21], note: "" },
  { agency: "Ministry of Finance", days: [12, 28], hours: [9, 21], note: "" },
];
/** A moment given in Beijing time. */
const beijing = (iso: string) => new Date(new Date(`${iso}Z`).getTime() - 8 * 60 * 60 * 1000);

test("a window is open by Beijing day and hour, not UTC", () => {
  // 16:30 Beijing on the 14th is 08:30 UTC the same day: PBOC and MOF open.
  expect(activeWindows(beijing("2026-10-14T16:30:00"), WINDOWS).map((w) => w.agency)).toEqual(["People's Bank of China", "Ministry of Finance"]);
  // 07:00 Beijing on the 8th is 23:00 UTC on the 7th: before hours.
  expect(activeWindows(beijing("2026-10-08T07:00:00"), WINDOWS)).toHaveLength(0);
  // 21:59 is inside the last hour (both open on the 18th); 22:00 is not.
  expect(activeWindows(beijing("2026-10-18T21:59:00"), WINDOWS)).toHaveLength(2);
  expect(activeWindows(beijing("2026-10-18T22:00:00"), WINDOWS)).toHaveLength(0);
});

test("the reported month is last month in Beijing, across a year end", () => {
  expect(reportedMonth(beijing("2026-10-14T10:00:00"))).toBe("2026-09");
  expect(reportedMonth(beijing("2027-01-10T10:00:00"))).toBe("2026-12");
  // 00:30 Beijing on 1 November is still 31 October in UTC; Beijing decides.
  expect(reportedMonth(beijing("2026-11-01T00:30:00"))).toBe("2026-10");
});

test("only open publishers' monthly series exactly one month behind are asked for", () => {
  const series = [
    { key: "new_loans", agency: "People's Bank of China", frequency: "Monthly" },
    { key: "bank_credit", agency: "People's Bank of China", frequency: "Monthly" },
    { key: "gold_reserves", agency: "People's Bank of China", frequency: "Monthly" },
    { key: "lpr", agency: "People's Bank of China", frequency: "Monthly" },
    { key: "fdi_actual_use_usd", agency: "People's Bank of China", frequency: "Monthly", ended: "2023-07" },
    { key: "official_reserves_q", agency: "People's Bank of China", frequency: "Quarterly" },
    { key: "fiscal_revenue", agency: "Ministry of Finance", frequency: "Monthly" },
    { key: "trade", agency: "General Administration of Customs", frequency: "Monthly" },
  ];
  const stored = [
    { key: "new_loans", lastPeriod: "2026-08" },          // one behind: ask
    { key: "bank_credit", lastPeriod: "2026-09" },        // arrived: skip
    { key: "gold_reserves", lastPeriod: "2026-06" },      // three behind: leave to the daily ingest
    { key: "lpr", lastPeriod: "2026-10" },                // fixes in the month itself: ahead, skip
    { key: "fdi_actual_use_usd", lastPeriod: "2026-08" }, // ended: skip
    { key: "official_reserves_q", lastPeriod: "2026-08" },
    { key: "fiscal_revenue", lastPeriod: "2026-08" },     // MOF not open on the 9th
    { key: "trade", lastPeriod: "2026-08" },              // Customs has its own calendar
  ];
  expect(keysAwaitingRelease(series, stored, beijing("2026-10-09T16:00:00"), WINDOWS)).toEqual(["new_loans"]);
  expect(keysAwaitingRelease(series, stored, beijing("2026-10-14T16:00:00"), WINDOWS)).toEqual(["new_loans", "fiscal_revenue"]);
  expect(keysAwaitingRelease(series, stored, beijing("2026-10-14T23:00:00"), WINDOWS)).toEqual([]);
});

test("a key stored for several places counts as its latest place", () => {
  const series = [{ key: "cross_border", agency: "People's Bank of China", frequency: "Monthly" }];
  const stored = [{ key: "cross_border", lastPeriod: "2026-08" }, { key: "cross_border", lastPeriod: "2026-09" }];
  expect(keysAwaitingRelease(series, stored, beijing("2026-10-10T12:00:00"), WINDOWS)).toEqual([]);
});
