/**
 * NBS press releases as captured from www.stats.gov.cn on 29 September 2026:
 * the 最新发布 listing, the August 2026 industrial profits release (28
 * September) and the August national economy bundle (15 September), parsed
 * the way the shadow reader parses them, and compared with a store that
 * holds July but not yet August, as production did that day.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-press-releases-")), "test.db");
process.env.CHINA_SEED = "off";
const {
  NBS_RELEASE_LISTING_URL, checkPressReleases, compareWithStore, describeComparison, parseReleaseListing,
  parseReleasePage, recentPressReleases, releaseKindOfTitle,
} = await import("./nbs-releases.ts");
const { db } = await import("./db.ts");

const fixture = (name: string) => Bun.file(resolve(import.meta.dir, `fixtures/nbs-releases/${name}`)).text();
const PROFITS_URL = "https://www.stats.gov.cn/sj/zxfb/202609/t20260928_1965425.html";
const BUNDLE_URL = "https://www.stats.gov.cn/sj/zxfb/202609/t20260915_1965307.html";

/** What production's store held on 29 September 2026: July for every line, August for the mid-month releases, and no August profits. */
const PRODUCTION_ON_29_SEPTEMBER: Record<string, number> = {
  "industrial_profits|Industrial profits, year to date (YoY %)|2026-07": 17.6,
  "industrial_profits|Manufacturing, year to date (YoY %)|2026-07": 18.8,
  "industrial_profits|Mining, year to date (YoY %)|2026-07": 34.9,
  "industrial_profits|Utilities, year to date (YoY %)|2026-07": -5.8,
  "industrial_production|Industrial production (YoY %)|2026-08": 5.2,
  "retail_sales|Retail sales (YoY %)|2026-08": 0.4,
  "fai|Fixed-asset investment, year to date (YoY %)|2026-08": -7.2,
  "fai|Private investment, year to date (YoY %)|2026-08": -10.1,
  "fai|Primary industry, year to date (YoY %)|2026-08": -2.4,
  "fai|Secondary industry, year to date (YoY %)|2026-08": -2.9,
  "fai|Tertiary industry, year to date (YoY %)|2026-08": -9.9,
  "unemployment|Surveyed urban (%)|2026-08": 5.3,
  "unemployment|31 major cities (%)|2026-08": 5.3,
  "unemployment|Local hukou (%)|2026-08": 5.3,
  "unemployment|Non-local hukou (%)|2026-08": 5.2,
};
const production = (key: string, label: string, period: string) => PRODUCTION_ON_29_SEPTEMBER[`${key}|${label}|${period}`] ?? null;

const values = (figures: { id: string; period: string; basis: string; value: number }[]) =>
  Object.fromEntries(figures.map((item) => [`${item.id} ${item.period} ${item.basis}`, item.value]));

test("the listing names each release once, with its date, and only profits and the national economy bundle are read", async () => {
  const listing = parseReleaseListing(await fixture("listing-2026-09-29.html"));
  expect(listing.length).toBe(15);
  expect(listing[0]).toEqual({ title: "2026年1—8月份全国规模以上工业企业利润增长15.7%", url: PROFITS_URL, publishedOn: "2026-09-28" });
  const read = listing.filter((item) => releaseKindOfTitle(item.title) !== null);
  expect(read.map((item) => [releaseKindOfTitle(item.title), item.url])).toEqual([
    ["industrial_profits", PROFITS_URL],
    ["national_economy", BUNDLE_URL],
  ]);
  // The separate pages NBS posts beside the bundle carry nothing the bundle does not.
  expect(releaseKindOfTitle("2026年8月份规模以上工业增加值增长5.2%")).toBeNull();
  expect(releaseKindOfTitle("中华人民共和国2025年国民经济和社会发展统计公报")).toBeNull();
  expect(() => parseReleaseListing("<html><body><ul></ul></body></html>")).toThrow(/no release items/);
});

test("the August 2026 profits release parses to +15.7% year to date, with the three divisions and the single month", async () => {
  const release = parseReleasePage(await fixture("profits-2026-08.html"), PROFITS_URL, "industrial_profits");
  expect(release.kind).toBe("industrial_profits");
  expect(release.agency).toBe("National Bureau of Statistics");
  expect(release.title).toBe("2026年1—8月份全国规模以上工业企业利润增长15.7%");
  expect(release.publishedAt).toBe("2026-09-28 09:30");
  expect(release.period).toBe("2026-08");
  expect(values(release.figures)).toEqual({
    "profits.ytd.total 2026-08 year_to_date": 15.7,
    "profits.ytd.total_level 2026-08 year_to_date": 52719.8,
    "profits.ytd.mining 2026-08 year_to_date": 35.1,
    "profits.ytd.manufacturing 2026-08 year_to_date": 17.4,
    "profits.ytd.manufacturing_level 2026-08 year_to_date": 39695.3,
    // "电力、热力、燃气及水生产和供应业实现利润总额5363.0亿元，下降12.0%"
    "profits.ytd.utilities 2026-08 year_to_date": -12,
    // "8月份，规模以上工业企业利润同比增长4.2%": a single month, which no stored line carries.
    "profits.month.total 2026-08 month": 4.2,
  });
  expect(release.figures.find((item) => item.id === "profits.month.total")?.storeLine).toBeNull();
});

test("the August 2026 national economy bundle parses to value added +5.2%, retail sales +0.4%, investment -7.2% year to date and unemployment 5.3%", async () => {
  const release = parseReleasePage(await fixture("national-economy-2026-08.html"), BUNDLE_URL, "national_economy");
  expect(release.title).toBe("8月份国民经济运行平稳、发展向新向优");
  expect(release.publishedAt).toBe("2026-09-15 10:00");
  expect(release.period).toBe("2026-08");
  expect(values(release.figures)).toEqual({
    "value_added.month 2026-08 month": 5.2,
    "value_added.ytd 2026-08 year_to_date": 5.3,
    "retail.month 2026-08 month": 0.4,
    "retail.ytd 2026-08 year_to_date": 1.1,
    "fai.ytd.total 2026-08 year_to_date": -7.2,
    "fai.ytd.private 2026-08 year_to_date": -10.1,
    "fai.ytd.primary 2026-08 year_to_date": -2.4,
    "fai.ytd.secondary 2026-08 year_to_date": -2.9,
    "fai.ytd.tertiary 2026-08 year_to_date": -9.9,
    "fai.ytd.manufacturing 2026-08 year_to_date": -2.3,
    "fai.ytd.infrastructure 2026-08 year_to_date": -4,
    "fai.ytd.high_tech 2026-08 year_to_date": 5.2,
    "fai.ytd.real_estate 2026-08 year_to_date": -19.9,
    "unemployment.month.urban 2026-08 month": 5.3,
    "unemployment.month.local_hukou 2026-08 month": 5.3,
    "unemployment.month.non_local_hukou 2026-08 month": 5.2,
    "unemployment.month.major_cities 2026-08 month": 5.3,
    // "1—8月份，全国城镇调查失业率平均值为5.2%": an average of the months, kept apart from the month's rate.
    "unemployment.ytd_average.urban 2026-08 year_to_date_average": 5.2,
    // The bundle repeats July's profits, which the database already holds.
    "profits.ytd.total 2026-07 year_to_date": 17.6,
  });
});

test("a page whose shape the parser does not recognise is refused, not guessed at", async () => {
  const bundle = await fixture("national-economy-2026-08.html");
  // Without the value-added sentences the bundle is a page this parser does not know.
  const withoutValueAdded = bundle.replaceAll("全国规模以上工业增加值", "全国工业产出");
  expect(() => parseReleasePage(withoutValueAdded, BUNDLE_URL)).toThrow(/no headline sentence for industrial value added/);
  // Without the article body.
  expect(() => parseReleasePage(bundle.replaceAll("trs_editor_view", "article"), BUNDLE_URL)).toThrow(/no article body/);
  // Without its title or date.
  expect(() => parseReleasePage("<html><body><p>1—8月份，全国规模以上工业企业实现利润总额1亿元，同比增长1.0%</p></body></html>", PROFITS_URL)).toThrow(/no ArticleTitle or PubDate/);
  const profits = await fixture("profits-2026-08.html");
  // Listed as one kind and titled as another.
  expect(() => parseReleasePage(profits, PROFITS_URL, "national_economy")).toThrow(/listed as national_economy/);
  // A profits page whose headline no longer reads "实现利润总额…亿元，同比增长…%".
  expect(() => parseReleasePage(profits.replaceAll("实现利润总额", "利润合计"), PROFITS_URL)).toThrow(/no year-to-date headline/);
  // A month range that does not start in January is not a year to date.
  const shortPage = (title: string, paragraph: string) =>
    `<meta name="ArticleTitle" content="${title}"><meta name="PubDate" content="2026/09/28 09:30"><div class="trs_editor_view"><p>${paragraph}</p></div>`;
  expect(() => parseReleasePage(shortPage("2026年3—8月份全国规模以上工业企业利润", "3—8月份，全国规模以上工业企业实现利润总额1.0亿元，同比增长1.0%。"), PROFITS_URL)).toThrow(/unexpected month range/);
  // A sentence for another month inside the release is a misread, not a figure. (The page
  // sets each figure in its own span, so the month is replaced where the markup has it.)
  const julyUnemployment = bundle.replace(/>8(<\/span><span[^>]*>月份，全国城镇调查失业率为)/, ">7$1");
  expect(julyUnemployment).not.toBe(bundle);
  expect(() => parseReleasePage(julyUnemployment, BUNDLE_URL)).toThrow(/in a release for 2026-08/);
});

test("against the store of 29 September, August profits are not yet in the database, and the mid-month figures agree", async () => {
  const profits = parseReleasePage(await fixture("profits-2026-08.html"), PROFITS_URL);
  const comparisons = compareWithStore(profits.figures, production);
  expect(comparisons.map((item) => [item.id, item.status])).toEqual([
    ["profits.ytd.total", "not_in_database"],
    ["profits.ytd.total_level", "not_in_database"],
    ["profits.ytd.mining", "not_in_database"],
    ["profits.ytd.manufacturing", "not_in_database"],
    ["profits.ytd.manufacturing_level", "not_in_database"],
    ["profits.ytd.utilities", "not_in_database"],
    ["profits.month.total", "no_comparable_series"],
  ]);
  expect(describeComparison(profits, comparisons)).toContain("Industrial profits, year to date (YoY %) 2026-08 15.7: not yet in database");

  const bundle = parseReleasePage(await fixture("national-economy-2026-08.html"), BUNDLE_URL);
  const bundleComparisons = compareWithStore(bundle.figures, production);
  const byStatus = (status: string) => bundleComparisons.filter((item) => item.status === status).map((item) => `${item.id} ${item.period}`);
  expect(byStatus("disagree")).toEqual([]);
  expect(byStatus("agree")).toEqual([
    "value_added.month 2026-08", "retail.month 2026-08",
    "fai.ytd.total 2026-08", "fai.ytd.private 2026-08", "fai.ytd.primary 2026-08", "fai.ytd.secondary 2026-08", "fai.ytd.tertiary 2026-08",
    "unemployment.month.urban 2026-08", "unemployment.month.local_hukou 2026-08", "unemployment.month.non_local_hukou 2026-08", "unemployment.month.major_cities 2026-08",
    "profits.ytd.total 2026-07",
  ]);
  expect(byStatus("no_comparable_series")).toEqual([
    "value_added.ytd 2026-08", "retail.ytd 2026-08", "fai.ytd.infrastructure 2026-08", "fai.ytd.high_tech 2026-08", "unemployment.ytd_average.urban 2026-08",
  ]);
  // A stored value that differs beyond the page's rounding is a disagreement; one within it is not.
  const off = compareWithStore(bundle.figures.filter((item) => item.id === "value_added.month"), () => 5.3);
  expect(off[0]?.status).toBe("disagree");
  const rounded = compareWithStore(bundle.figures.filter((item) => item.id === "value_added.month"), () => 5.24);
  expect(rounded[0]?.status).toBe("agree");
});

test("a check reads the listing and each new release page once, one request at a time, and logs the comparison under press_release", async () => {
  const pages: Record<string, string> = {
    [NBS_RELEASE_LISTING_URL]: await fixture("listing-2026-09-29.html"),
    [PROFITS_URL]: await fixture("profits-2026-08.html"),
    [BUNDLE_URL]: await fixture("national-economy-2026-08.html"),
  };
  const requested: string[] = [];
  let inFlight = 0, mostInFlight = 0;
  const read = async (url: string) => {
    inFlight += 1; mostInFlight = Math.max(mostInFlight, inFlight);
    requested.push(url);
    await Bun.sleep(1);
    inFlight -= 1;
    const page = pages[url];
    if (page === undefined) throw new Error(`unexpected request ${url}`);
    return page;
  };
  const first = await checkPressReleases(read, production);
  expect(first).toEqual({ listed: 15, relevant: 2, read: 2, failed: 0 });
  expect(requested).toEqual([NBS_RELEASE_LISTING_URL, PROFITS_URL, BUNDLE_URL]);
  expect(mostInFlight).toBe(1);

  // A second check fetches the listing only: both pages are already read.
  const second = await checkPressReleases(read, production);
  expect(second.read).toBe(0);
  expect(requested.slice(3)).toEqual([NBS_RELEASE_LISTING_URL]);

  const logged = db().query<{ region: string; status: string; point_count: number; changed_count: number; message: string }, []>(
    "SELECT region, status, point_count, changed_count, message FROM fetch_log WHERE key = 'press_release' ORDER BY id",
  ).all();
  expect(logged.map((row) => [row.region, row.status, row.point_count, row.changed_count])).toEqual([
    ["t20260928_1965425", "ok", 7, 0],
    ["t20260915_1965307", "ok", 19, 0],
  ]);
  expect(logged[0]?.message).toContain("not yet in database 6");
  expect(logged[1]?.message).toContain("agree 12");

  // Once the database has August, the view's comparison now says so while the record of the read keeps what it saw.
  const caughtUp = (key: string, label: string, period: string) =>
    key === "industrial_profits" && label === "Industrial profits, year to date (YoY %)" && period === "2026-08" ? 15.7 : production(key, label, period);
  const views = recentPressReleases(10, caughtUp);
  expect(views.map((view) => view.url)).toEqual([PROFITS_URL, BUNDLE_URL]);
  const headlineAtRead = views[0]?.comparisonAtRead.find((item) => item.id === "profits.ytd.total");
  const headlineNow = views[0]?.comparisonNow.find((item) => item.id === "profits.ytd.total");
  expect(headlineAtRead?.status).toBe("not_in_database");
  expect(headlineNow).toMatchObject({ status: "agree", parsed: 15.7, stored: 15.7 });
});

test("a refused page is logged as an error and tried again on the next check", async () => {
  const listing = `<ul><li><a href="./202610/t20261015_1.html" title='9月份国民经济运行总体平稳'>x</a><span>2026-10-15</span></li></ul>`;
  const read = async (url: string) => (url === NBS_RELEASE_LISTING_URL ? listing : `<meta name="ArticleTitle" content="9月份国民经济运行总体平稳"><meta name="PubDate" content="2026/10/15 10:00"><div class="trs_editor_view"><p>新的版式</p></div>`);
  const tally = await checkPressReleases(read, production);
  expect(tally).toEqual({ listed: 1, relevant: 1, read: 0, failed: 1 });
  const again = await checkPressReleases(read, production);
  expect(again.failed).toBe(1);
  const errors = db().query<{ message: string }, []>("SELECT message FROM fetch_log WHERE key = 'press_release' AND region = 't20261015_1' AND status = 'error'").all();
  expect(errors.length).toBe(2);
  expect(errors[0]?.message).toContain("not in a shape this parser knows");
});
