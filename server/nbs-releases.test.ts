/**
 * NBS press releases as captured from www.stats.gov.cn on 29 September 2026:
 * the 最新发布 listing, the August 2026 industrial profits release (28
 * September) and the August national economy bundle (15 September), parsed
 * the way the shadow reader parses them, and compared with a store that
 * holds July but not yet August, as production did that day.
 */

import { test, expect, afterAll, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-press-releases-")), "test.db");
process.env.CHINA_SEED = "off";
const {
  NBS_RELEASE_LISTING_URL, REFUSAL_CURRENT_DAYS, REFUSED_PAGE_RETRY_MS, UNLISTED_REFUSAL_MAX_ATTEMPTS, UNLISTED_REFUSAL_MAX_DAYS,
  UNLISTED_REFUSAL_RETRY_MS, checkPressReleases, compareWithStore,
  describeComparison, forgetUnlistedRetries, parseReleaseListing, parseReleasePage, pressReleaseHealth, recentPressReleases,
  refusedPressReleases, releaseKindOfTitle, resetPressReleaseTablesForTest, roundAsPrinted,
} = await import("./nbs-releases.ts");
const { db } = await import("./db.ts");

// bun test runs every file in one process against one scratch store. Each test
// starts from no reads, no refusals and no press_release log rows, and does its
// own reads, so the tests pass in any order; and the rows are removed at the end
// so the health report's tests do not find a refused press release in theirs.
const clearPressReleaseRows = () => {
  refusedPressReleases(); // creates the reader's tables if this is the first touch
  db().exec("DELETE FROM press_release_reads; DELETE FROM press_release_refusals; DELETE FROM fetch_log WHERE key = 'press_release'");
  forgetUnlistedRetries();
};
beforeEach(clearPressReleaseRows);
afterAll(clearPressReleaseRows);

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
  // The half-year and annual bundles are not titled 国民经济, and must still be read.
  expect(releaseKindOfTitle("上半年经济运行在合理区间 新动能快速成长")).toBe("national_economy");
  expect(releaseKindOfTitle("2025年经济发展向新向优 预期目标圆满实现")).toBe("national_economy");
  // The bureau's composite index shares the words and is not a bundle; it is on this very listing.
  expect(releaseKindOfTitle("2025年经济发展新动能指数增长12.5%")).toBeNull();
  expect(listing.some((item) => item.title === "2025年经济发展新动能指数增长12.5%")).toBe(true);
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

test("the half-year bundle, titled without 国民经济, reads June's month and the first half's year to date, including the month sentences written without 全国 or a level", async () => {
  const release = parseReleasePage(await fixture("national-economy-2026-06-half-year.html"), "https://www.stats.gov.cn/sj/zxfb/202607/t20260715_1964121.html", "national_economy");
  expect(release.title).toBe("上半年经济运行在合理区间 新动能快速成长");
  expect(release.period).toBe("2026-06");
  expect(values(release.figures)).toEqual({
    // "上半年，全国规模以上工业增加值同比增长5.4%" and "6月份，规模以上工业增加值同比增长5.3%".
    "value_added.ytd 2026-06 year_to_date": 5.4,
    "value_added.month 2026-06 month": 5.3,
    "retail.ytd 2026-06 year_to_date": 1.3,
    "retail.month 2026-06 month": 1,
    "fai.ytd.total 2026-06 year_to_date": -5.7,
    "fai.ytd.private 2026-06 year_to_date": -8.5,
    "fai.ytd.primary 2026-06 year_to_date": 0.9,
    "fai.ytd.secondary 2026-06 year_to_date": -1.1,
    "fai.ytd.tertiary 2026-06 year_to_date": -8.4,
    "fai.ytd.manufacturing 2026-06 year_to_date": -1.2,
    "fai.ytd.infrastructure 2026-06 year_to_date": -2.4,
    "fai.ytd.high_tech 2026-06 year_to_date": 4.6,
    "fai.ytd.real_estate 2026-06 year_to_date": -18,
    "unemployment.month.urban 2026-06 month": 5,
    "unemployment.month.local_hukou 2026-06 month": 5,
    "unemployment.month.non_local_hukou 2026-06 month": 4.9,
    "unemployment.month.major_cities 2026-06 month": 5,
    "unemployment.ytd_average.urban 2026-06 year_to_date_average": 5.2,
    "profits.ytd.total 2026-05 year_to_date": 18.8,
  });
});

test("April 2026's retail sales month, written without a level, is read rather than dropped", async () => {
  const release = parseReleasePage(await fixture("national-economy-2026-04.html"), "https://www.stats.gov.cn/sj/zxfb/202605/t20260518_1963732.html");
  // "4月份，社会消费品零售总额同比增长0.2%" beside "1—4月份，社会消费品零售总额164941亿元，同比增长1.9%".
  const figures = values(release.figures);
  expect(figures["retail.month 2026-04 month"]).toBe(0.2);
  expect(figures["retail.ytd 2026-04 year_to_date"]).toBe(1.9);
  expect(figures["value_added.month 2026-04 month"]).toBe(4.1);
  expect(figures["value_added.ytd 2026-04 year_to_date"]).toBe(5.6);
});

test("the 2025 annual releases read as December and the year to date through December", async () => {
  const bundle = parseReleasePage(await fixture("national-economy-2025-annual.html"), "https://www.stats.gov.cn/sj/zxfb/202601/t20260119_1962330.html", "national_economy");
  expect(bundle.title).toBe("2025年经济发展向新向优 预期目标圆满实现");
  expect(bundle.period).toBe("2025-12");
  const figures = values(bundle.figures);
  // "全年全国规模以上工业增加值比上年增长5.9%": no comma after 全年, and 比上年 for 同比.
  expect(figures["value_added.ytd 2025-12 year_to_date"]).toBe(5.9);
  expect(figures["value_added.month 2025-12 month"]).toBe(5.2);
  // "全年社会消费品零售总额501202亿元，比上年增长3.7%" and "12月份，社会消费品零售总额同比增长0.9%".
  expect(figures["retail.ytd 2025-12 year_to_date"]).toBe(3.7);
  expect(figures["retail.month 2025-12 month"]).toBe(0.9);
  expect(figures["fai.ytd.total 2025-12 year_to_date"]).toBe(-3.8);
  expect(figures["fai.ytd.private 2025-12 year_to_date"]).toBe(-6.4);
  expect(figures["fai.ytd.infrastructure 2025-12 year_to_date"]).toBe(-2.2);
  expect(figures["unemployment.month.urban 2025-12 month"]).toBe(5.1);
  expect(figures["unemployment.ytd_average.urban 2025-12 year_to_date_average"]).toBe(5.2);

  const profits = parseReleasePage(await fixture("profits-2025-annual.html"), "https://www.stats.gov.cn/sj/zxfb/202601/t20260127_1962382.html", "industrial_profits");
  expect(profits.title).toBe("2025年全国规模以上工业企业利润增长0.6%");
  expect(profits.period).toBe("2025-12");
  expect(values(profits.figures)).toEqual({
    // "2025年，全国规模以上工业企业实现利润总额73982.0亿元，比上年增长0.6%".
    "profits.ytd.total 2025-12 year_to_date": 0.6,
    "profits.ytd.total_level 2025-12 year_to_date": 73982,
    "profits.ytd.mining 2025-12 year_to_date": -26.2,
    "profits.ytd.manufacturing 2025-12 year_to_date": 5,
    "profits.ytd.manufacturing_level 2025-12 year_to_date": 56915.7,
    "profits.ytd.utilities 2025-12 year_to_date": 9.4,
    // "12月份，规模以上工业企业利润同比增长5.3%", published in January, belongs to 2025.
    "profits.month.total 2025-12 month": 5.3,
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
  // A month sentence for value added or retail sales that is not read refuses the page,
  // rather than the month going missing as March and April 2026 once did.
  const unreadMonth = bundle.replace(/(>月份，全国规模以上工业增加值)同比增长/, "$1比去年同月增长");
  expect(unreadMonth).not.toBe(bundle);
  expect(() => parseReleasePage(unreadMonth, BUNDLE_URL)).toThrow(/month sentence for industrial value added/);
  const unreadRetail = bundle.replace(/(月份，社会消费品零售总额)((?:<[^>]*>|\s)*39824)/, "$1约$2");
  expect(unreadRetail).not.toBe(bundle);
  expect(() => parseReleasePage(unreadRetail, BUNDLE_URL)).toThrow(/month sentence for retail sales/);
  // A single-month January figure is refused outright: NBS publishes January with February.
  expect(() => parseReleasePage(shortPage("1月份国民经济", "1月份，全国规模以上工业增加值同比增长5.0%。"), BUNDLE_URL)).toThrow(/single-month January/);
});

test("agreement follows NBS's rounding: the stored value rounded to the printed decimals must equal the printed figure", () => {
  const printed = { id: "fai.ytd.primary", name: "x", basis: "year_to_date" as const, period: "2026-08", value: -2.3, decimals: 1, unit: "percent change from year ago" as const, storeLine: { key: "fai", label: "Primary industry, year to date (YoY %)" } };
  expect(compareWithStore([printed], () => -2.35)[0]?.status).toBe("disagree");
  expect(compareWithStore([printed], () => -2.34)[0]?.status).toBe("agree");
  expect(compareWithStore([printed], () => -2.3)[0]?.status).toBe("agree");
  expect(roundAsPrinted(2.35, 1)).toBe(2.4);
  expect(roundAsPrinted(-0.05, 1)).toBe(-0.1);
  expect(roundAsPrinted(52719.8, 1)).toBe(52719.8);
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
  expect(first).toEqual({ listed: 15, relevant: 2, read: 2, failed: 0, unreachable: 0, givenUp: 0, waiting: 0, retriedUnlisted: 0 });
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

/** The page NBS might publish in a layout the parser does not know. */
const UNKNOWN_SHAPE = `<meta name="ArticleTitle" content="9月份国民经济运行总体平稳"><meta name="PubDate" content="2026/10/15 10:00"><div class="trs_editor_view"><p>新的版式</p></div>`;
const REFUSED_URL = "https://www.stats.gov.cn/sj/zxfb/202610/t20261015_1.html";
const REFUSED_ITEM = `<li><a href="./202610/t20261015_1.html" title='9月份国民经济运行总体平稳'>x</a><span>2026-10-15</span></li>`;

test("a refused page is logged as an error, recorded, and fetched again at most once a day", async () => {
  const listing = `<ul>${REFUSED_ITEM}</ul>`;
  const requested: string[] = [];
  const read = async (url: string) => {
    requested.push(url);
    return url === NBS_RELEASE_LISTING_URL ? listing : UNKNOWN_SHAPE;
  };
  const refusedAt = Date.UTC(2026, 9, 15, 2, 20);
  const tally = await checkPressReleases(read, production, () => refusedAt);
  expect(tally).toEqual({ listed: 1, relevant: 1, read: 0, failed: 1, unreachable: 0, givenUp: 0, waiting: 0, retriedUnlisted: 0 });
  // An hour later the page is not fetched again: only the listing is.
  const soon = await checkPressReleases(read, production, () => refusedAt + 60 * 60 * 1000);
  expect(soon).toMatchObject({ read: 0, failed: 0, waiting: 1 });
  expect(requested.filter((url) => url !== NBS_RELEASE_LISTING_URL).length).toBe(1);
  // A day later it is tried again, and refused again.
  const nextDay = await checkPressReleases(read, production, () => refusedAt + REFUSED_PAGE_RETRY_MS + 1000);
  expect(nextDay).toMatchObject({ failed: 1, waiting: 0 });
  const errors = db().query<{ message: string }, []>("SELECT message FROM fetch_log WHERE key = 'press_release' AND region = 't20261015_1' AND status = 'error'").all();
  expect(errors.length).toBe(2);
  expect(errors[0]?.message).toContain("not in a shape this parser knows");
  expect(errors[1]?.message).toContain("attempt 2");
});

test("the health summary names the latest read, figures disagreeing with the database, and pages refused", async () => {
  const pages: Record<string, string> = {
    [NBS_RELEASE_LISTING_URL]: (await fixture("listing-2026-09-29.html")).replace("<li>", `${REFUSED_ITEM}<li>`),
    [PROFITS_URL]: await fixture("profits-2026-08.html"),
    [BUNDLE_URL]: await fixture("national-economy-2026-08.html"),
    [REFUSED_URL]: UNKNOWN_SHAPE,
  };
  const at = Date.UTC(2026, 8, 29, 6);
  const tally = await checkPressReleases(async (url) => pages[url] ?? "", production, () => at);
  expect(tally).toMatchObject({ listed: 16, relevant: 3, read: 2, failed: 1 });
  const health = pressReleaseHealth(production, at);
  expect(health.refused.map((page) => [page.title, page.attempts])).toEqual([["9月份国民经济运行总体平稳", 1]]);
  expect(health.noLongerListed).toBe(0);
  expect(health.latest?.url).toBe(PROFITS_URL);
  expect(health.latest?.publishedAt).toBe("2026-09-28 09:30");
  expect(health.disagreements).toEqual([]);
  // Six August profits lines, and the bundle's manufacturing and real estate investment, which that store lacked.
  expect(health.awaitingDatabase).toBe(8);
  const disagreeing = pressReleaseHealth((key, label, period) => (key === "fai" && label === "Private investment, year to date (YoY %)" && period === "2026-08" ? -10.2 : production(key, label, period)), at);
  expect(disagreeing.disagreements).toEqual([{ title: "8月份国民经济运行平稳、发展向新向优", name: "Private investment, year to date (YoY %)", period: "2026-08", parsed: -10.1, stored: -10.2 }]);
});

test("a refusal ages out once its page falls off the listing, and is retried by URL after a deploy and then weekly", async () => {
  const requested: string[] = [];
  let listing = `<ul>${REFUSED_ITEM}</ul>`;
  let page = UNKNOWN_SHAPE;
  const read = async (url: string) => {
    requested.push(url);
    return url === NBS_RELEASE_LISTING_URL ? listing : page;
  };
  const day = 24 * 60 * 60 * 1000;
  const refusedAt = Date.UTC(2026, 9, 15, 2, 20);
  await checkPressReleases(read, production, () => refusedAt);
  expect(pressReleaseHealth(production, refusedAt).refused.length).toBe(1);

  // The page falls off the listing. Still counted as current for five weeks from when it was last listed.
  listing = `<ul><li><a href="./202611/t20261116_2.html" title='2026年10月份能源生产情况'>x</a><span>2026-11-16</span></li></ul>`;
  const withinFiveWeeks = refusedAt + (REFUSAL_CURRENT_DAYS - 1) * day;
  expect(pressReleaseHealth(production, withinFiveWeeks)).toMatchObject({ noLongerListed: 0 });
  expect(pressReleaseHealth(production, withinFiveWeeks).refused.length).toBe(1);
  const afterFiveWeeks = refusedAt + (REFUSAL_CURRENT_DAYS + 1) * day;
  const aged = pressReleaseHealth(production, afterFiveWeeks);
  expect(aged.refused).toEqual([]);
  expect(aged.noLongerListed).toBe(1);

  // The first check in this process (as after a deploy) retries it by its stored URL, once.
  const beforeRetry = requested.length;
  const firstCheck = await checkPressReleases(read, production, () => afterFiveWeeks);
  expect(firstCheck).toMatchObject({ retriedUnlisted: 1, failed: 1 });
  expect(requested.slice(beforeRetry)).toEqual([NBS_RELEASE_LISTING_URL, REFUSED_URL]);
  // Retrying it off the listing does not make it current again.
  expect(pressReleaseHealth(production, afterFiveWeeks + 1000)).toMatchObject({ refused: [], noLongerListed: 1 });
  // Within the week, not again.
  const secondCheck = await checkPressReleases(read, production, () => afterFiveWeeks + day);
  expect(secondCheck.retriedUnlisted).toBe(0);
  // A week on, and with the parser able to read it (here: the page is now one it knows), it is read.
  page = await fixture("national-economy-2026-08.html");
  const weekLater = await checkPressReleases(read, production, () => afterFiveWeeks + UNLISTED_REFUSAL_RETRY_MS + 1000);
  expect(weekLater).toMatchObject({ retriedUnlisted: 1, read: 1, failed: 0 });
  expect(pressReleaseHealth(production, afterFiveWeeks + UNLISTED_REFUSAL_RETRY_MS + 2000)).toMatchObject({ refused: [], noLongerListed: 0 });
});

test("a page that cannot be fetched is not a refusal: it is logged and tried again on the next check; a page fetched and not understood is", async () => {
  const listing = `<ul>${REFUSED_ITEM}</ul>`;
  let answer: "timeout" | "unknown shape" | "bundle" = "timeout";
  const requested: string[] = [];
  const read = async (url: string) => {
    requested.push(url);
    if (url === NBS_RELEASE_LISTING_URL) return listing;
    if (answer === "timeout") throw new Error("NBS release page -> HTTP 504");
    return answer === "unknown shape" ? UNKNOWN_SHAPE : fixture("national-economy-2026-08.html");
  };
  const morning = Date.UTC(2026, 9, 15, 1, 40);
  const timedOut = await checkPressReleases(read, production, () => morning);
  expect(timedOut).toMatchObject({ read: 0, failed: 0, unreachable: 1 });
  expect(refusedPressReleases(morning)).toEqual({ current: [], noLongerListed: [] });
  const logged = db().query<{ status: string; message: string }, []>("SELECT status, message FROM fetch_log WHERE key = 'press_release' AND region = 't20261015_1'").all();
  expect(logged).toEqual([{ status: "error", message: "\"9月份国民经济运行总体平稳\": the page could not be fetched (NBS release page -> HTTP 504); tried again on the next check" }]);
  // Ten minutes later it is fetched again, not held back a day, and this time it parses.
  answer = "bundle";
  const retried = await checkPressReleases(read, production, () => morning + 10 * 60 * 1000);
  expect(retried).toMatchObject({ read: 1, unreachable: 0, waiting: 0 });
  expect(requested.filter((url) => url === REFUSED_URL).length).toBe(2);

  // A page fetched and not understood is the parser's refusal, held for a day.
  clearPressReleaseRows();
  answer = "unknown shape";
  const refused = await checkPressReleases(read, production, () => morning);
  expect(refused).toMatchObject({ failed: 1, unreachable: 0 });
  expect(refusedPressReleases(morning).current.map((page) => page.url)).toEqual([REFUSED_URL]);
  expect((await checkPressReleases(read, production, () => morning + 10 * 60 * 1000)).waiting).toBe(1);
});

test("an unlisted refusal is given up after twenty attempts or 180 days, logged once, and no longer counted", async () => {
  const read = async (url: string) => (url === NBS_RELEASE_LISTING_URL ? `<ul>${REFUSED_ITEM}</ul>` : UNKNOWN_SHAPE);
  const offListing = async (url: string) => {
    if (url === NBS_RELEASE_LISTING_URL) return `<ul><li><a href="./202611/t20261116_2.html" title='2026年10月份能源生产情况'>x</a><span>2026-11-16</span></li></ul>`;
    throw new Error("NBS release page -> HTTP 404"); // taken down
  };
  const day = 24 * 60 * 60 * 1000;
  const first = Date.UTC(2026, 9, 15, 2, 20);
  await checkPressReleases(read, production, () => first);
  // Weekly retries of a page NBS has taken down: each 404 counts as an attempt, so the cap is reached.
  let at = first + 40 * day;
  for (let attempt = 2; attempt <= UNLISTED_REFUSAL_MAX_ATTEMPTS; attempt += 1) {
    forgetUnlistedRetries();
    const tally = await checkPressReleases(offListing, production, () => at);
    expect(tally).toMatchObject({ retriedUnlisted: 1, unreachable: 1, givenUp: 0 });
    at += UNLISTED_REFUSAL_RETRY_MS;
  }
  expect(refusedPressReleases(at).noLongerListed[0]?.attempts).toBe(UNLISTED_REFUSAL_MAX_ATTEMPTS);
  const givenUp = await checkPressReleases(offListing, production, () => at);
  expect(givenUp).toMatchObject({ givenUp: 1, retriedUnlisted: 0 });
  expect(pressReleaseHealth(production, at)).toMatchObject({ refused: [], noLongerListed: 0 });
  // Logged once: later checks, even after a deploy, neither retry it nor log it again.
  forgetUnlistedRetries();
  expect(await checkPressReleases(offListing, production, () => at + 30 * day)).toMatchObject({ givenUp: 0, retriedUnlisted: 0 });
  const notices = db().query<{ message: string }, []>("SELECT message FROM fetch_log WHERE key = 'press_release' AND message LIKE '%given up after%'").all();
  expect(notices.length).toBe(1);
  expect(notices[0]?.message).toContain(`given up after ${UNLISTED_REFUSAL_MAX_ATTEMPTS} attempts since 2026-10-15`);

  // By age: a refusal first made 180 days ago is given up on its next retry, however few its attempts.
  clearPressReleaseRows();
  await checkPressReleases(read, production, () => first);
  const old = await checkPressReleases(offListing, production, () => first + UNLISTED_REFUSAL_MAX_DAYS * day);
  expect(old).toMatchObject({ givenUp: 1, retriedUnlisted: 0 });
});

test("a refusals table from before last_listed_at and given_up_at gains both columns, and its rows read as before", () => {
  db().exec("DROP TABLE IF EXISTS press_release_refusals");
  db().exec(`CREATE TABLE press_release_refusals (url TEXT PRIMARY KEY, title TEXT NOT NULL, first_refused_at TEXT NOT NULL, last_refused_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 1, message TEXT NOT NULL)`);
  db().exec(`INSERT INTO press_release_refusals VALUES ('${REFUSED_URL}', '9月份国民经济运行总体平稳', '2026-10-15T02:20:00.000Z', '2026-10-16T02:20:00.000Z', 2, 'refused')`);
  resetPressReleaseTablesForTest();
  // The first use in a new process runs the migration.
  const refusals = refusedPressReleases(Date.UTC(2026, 9, 20));
  const columns = db().query<{ name: string }, []>("PRAGMA table_info(press_release_refusals)").all().map((column) => column.name);
  expect(columns).toContain("last_listed_at");
  expect(columns).toContain("given_up_at");
  // An empty last_listed_at reads as the last refusal, so the row is current until five weeks after it.
  expect(refusals.current.map((page) => [page.url, page.lastListedAt])).toEqual([[REFUSED_URL, "2026-10-16T02:20:00.000Z"]]);
});
