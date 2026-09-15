/**
 * Customs' yearly release calendar, parsed from the English site's page, and
 * the agenda items it yields.
 */

import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { customsReleaseItems, fetchCustomsReleases, findCalendarLink, parseCustomsCalendar } from "./customs-calendar.ts";

const fixture = (name: string) => Bun.file(resolve(import.meta.dir, `fixtures/customs/${name}`)).text();

test("the 2025 calendar parses to twelve months with the preliminary day of each", async () => {
  const calendar = parseCustomsCalendar(await fixture("release-calendar-2025.html"));
  expect(calendar?.year).toBe(2025);
  expect(calendar?.months.length).toBe(12);
  expect(calendar?.months.map((month) => month.preliminary)).toEqual([13, null, 7, 14, 9, 9, 14, 7, 8, 13, 7, 8]);
  expect(calendar?.months.every((month) => month.month === 2 ? month.bulletin === null : month.bulletin === 18 && month.online === 20)).toBe(true);
});

test("the 2024 page, with its own digit spacing, parses the same way", async () => {
  const calendar = parseCustomsCalendar(await fixture("release-calendar-2024.html"));
  expect(calendar?.year).toBe(2024);
  expect(calendar?.months.map((month) => month.preliminary)).toEqual([12, null, 7, 12, 9, 7, 12, 7, 10, 14, 7, 10]);
  expect(parseCustomsCalendar("<html><body>Nothing here</body></html>")).toBeNull();
});

test("the listing links the years it carries, misspelling and all, and not one it does not", async () => {
  const listing = await fixture("listing-column4-page1.html");
  expect(findCalendarLink(listing, 2025)).toBe("http://english.customs.gov.cn/Statics/fc662cee-21c3-474e-a7fb-4768bb1e295a.html");
  expect(findCalendarLink(listing, 2024)).toBe("http://english.customs.gov.cn/Statics/a017721e-39be-4e2d-995f-ab5597d85b86.html");
  expect(findCalendarLink(listing, 2026)).toBeNull(); // not published on the English site as of 15 September 2026
});

test("a month's preliminary release becomes an agenda item reporting the previous month", async () => {
  const calendar = parseCustomsCalendar(await fixture("release-calendar-2025.html"));
  if (!calendar) throw new Error("fixture did not parse");
  const items = customsReleaseItems(calendar, "2025-09-01", "2025-10-31", ["trade_partners"]);
  expect(items.map((item) => item.fb_time)).toEqual(["2025-09-08 10:00:00", "2025-10-13 10:00:00"]);
  expect(items[0]?.en).toBe("Customs trade statistics, preliminary release for August 2025");
  expect(items[0]?.keys).toEqual(["trade_partners"]);
  // March reports January and February together; February has no release.
  const spring = customsReleaseItems(calendar, "2025-02-01", "2025-03-31", []);
  expect(spring.length).toBe(1);
  expect(spring[0]?.en).toContain("January-February 2025");
});

test("a year with no calendar on the site contributes no items and does not fail the agenda", async () => {
  const listing = await fixture("listing-column4-page1.html");
  const page = await fixture("release-calendar-2025.html");
  const read = async (url: string) => (url.includes("ColumnId=4") ? listing : page);
  const items = await fetchCustomsReleases("2025-12-01", "2026-01-31", ["trade_partners"], read);
  expect(items.map((item) => item.fb_time)).toEqual(["2025-12-08 10:00:00"]);
});
