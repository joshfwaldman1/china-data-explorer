import { describe, expect, test } from "bun:test";
import { comparablePeriod, expectedPeriod, isDue, dueReason } from "./due";

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

test("why a series is due decides how much history to ask for", () => {
  const now = new Date("2026-09-25T00:00:00Z");
  // Behind the calendar and last looked at before that period's window closed:
  // a new observation should exist, which a recent window answers.
  expect(dueReason("Monthly", "2026-07", "2026-09-15T00:00:00Z", now)).toBe("new-period");
  // Current, but not looked at within the revision interval: the whole history
  // has to be asked for, because a restatement of an old year is not in a
  // recent window.
  expect(dueReason("Monthly", "2026-08", "2026-07-01T00:00:00Z", now)).toBe("revision");
  // Current and checked recently: not due at all.
  expect(dueReason("Monthly", "2026-08", "2026-09-24T00:00:00Z", now)).toBeNull();
  // Never stored: due, and everything is new.
  expect(dueReason("Monthly", null, null, now)).toBe("new-period");
});

test("a series checked after its window closed waits for the revision interval, even if it is still behind", () => {
  // The known coarseness of the calendar fallback, pinned so a change to it is
  // deliberate: thousands of catalog entries are discontinued or are year-range
  // slices, and checking every one of them daily is the whole crawl's cost for
  // nothing. A table that publishes late is checked again at the next window or
  // at the 45-day revision check, whichever comes first. Release-day work does
  // not depend on this: a release schedules its own targets.
  const now = new Date("2026-09-25T00:00:00Z");
  expect(dueReason("Monthly", "2026-07", "2026-09-24T00:00:00Z", now)).toBeNull();
});

describe("a publisher's own release day", () => {
  // Customs' preliminary release is out by the 14th; NBS's month closes on the 20th.
  const on14September = on("2026-09-14T06:00:00Z");
  const checkedOn9th = "2026-09-09T03:00:00Z";
  test("Customs' August tables are due on the 14th; NBS's August figures are not", () => {
    expect(dueReason("Monthly", "2026-07", checkedOn9th, on14September, 14)).toBe("new-period");
    expect(dueReason("Monthly", "2026-07", checkedOn9th, on14September)).toBeNull();
    expect(expectedPeriod("Monthly", on14September, 14)).toBe("2026-08");
    expect(expectedPeriod("Monthly", on14September)).toBe("2026-07");
  });
});
