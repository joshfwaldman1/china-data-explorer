import { describe, expect, test } from "bun:test";
import { comparablePeriod, expectedPeriod, isDue } from "./due";

const on = (iso: string) => new Date(iso);

describe("expectedPeriod", () => {
  test("a month is expected once the 20th of the next month has passed", () => {
    expect(expectedPeriod("Monthly", on("2026-09-08T00:00:00Z"))).toBe("2026-07");
    expect(expectedPeriod("Monthly", on("2026-09-21T00:00:00Z"))).toBe("2026-08");
  });
  test("a quarter is expected once the 20th of the month after it ends has passed", () => {
    expect(expectedPeriod("Quarterly", on("2026-09-08T00:00:00Z"))).toBe("2026-06");
    expect(expectedPeriod("Quarterly", on("2026-10-25T00:00:00Z"))).toBe("2026-09");
    expect(expectedPeriod("Quarterly", on("2026-10-10T00:00:00Z"))).toBe("2026-06");
  });
  test("annual tables are expected the following spring", () => {
    expect(expectedPeriod("Annual", on("2026-09-08T00:00:00Z"))).toBe("2025");
    expect(expectedPeriod("Annual", on("2026-02-01T00:00:00Z"))).toBe("2024");
  });
});

describe("isDue", () => {
  const now = on("2026-09-08T00:00:00Z");
  test("never stored is due", () => { expect(isDue("Monthly", null, null, now)).toBe(true); });
  test("current and recently checked is not due", () => { expect(isDue("Monthly", "2026-07", "2026-09-07T00:00:00Z", now)).toBe(false); });
  test("a month behind the calendar is due until it has been checked after the window closed", () => {
    expect(isDue("Monthly", "2026-06", "2026-08-10T00:00:00Z", now)).toBe(true);
    expect(isDue("Monthly", "2026-06", "2026-09-07T00:00:00Z", now)).toBe(false);
  });
  test("a discontinued series checked yesterday is not due again today", () => {
    expect(isDue("Monthly", "2019-12", "2026-09-07T00:00:00Z", now)).toBe(false);
    expect(isDue("Quarterly", "2023-Q2", "2026-09-07T00:00:00Z", now)).toBe(false);
  });
  test("quarter labels compare as their last month", () => {
    expect(comparablePeriod("2026-Q2")).toBe("2026-06");
    expect(isDue("Quarterly", "2026-Q2", "2026-09-07T00:00:00Z", now)).toBe(false);
    expect(isDue("Quarterly", "2026-Q1", "2026-07-10T00:00:00Z", now)).toBe(true);
    expect(isDue("Quarterly", "2026-Q1", "2026-09-07T00:00:00Z", now)).toBe(false);
  });
  test("a current series unchecked for 45 days is due for a revision check", () => {
    expect(isDue("Monthly", "2026-07", "2026-07-01T00:00:00Z", now)).toBe(true);
  });
});
