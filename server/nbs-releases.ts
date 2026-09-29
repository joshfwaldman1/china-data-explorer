/**
 * NBS press releases, read in shadow mode.
 *
 * The National Bureau of Statistics posts each release as an HTML page on
 * www.stats.gov.cn at the release time (09:30 or 10:00 CST). Its database,
 * which the site reads through server/nbs-catalog.ts, can lag that page by
 * days: August 2026 industrial profits were on the release page on 28
 * September while the database still answered July two days later. The
 * headline figures are in the release text, so reading the page is how the
 * site will one day serve them the same morning.
 *
 * Not yet. This module only reads: it parses the headline figures from two
 * kinds of release, records what it parsed, and compares each figure with
 * the store's value for the same series, line and period. Nothing here
 * writes an observation. The comparison has to agree for a few months
 * running before any of these figures is trusted as a series
 * (COVERAGE_PLAN.md step 3).
 *
 * The two kinds, as NBS titles them on its 最新发布 listing (sj/zxfb):
 *
 * - Industrial profits, around the 27th: "2026年1—8月份全国规模以上工业企业
 *   利润增长15.7%". Year to date for industry and its three divisions, the
 *   levels behind them, and one sentence on the single month's growth.
 * - The national economy bundle, mid-month: "8月份国民经济运行平稳、发展向新
 *   向优". One page carries industrial value added, retail sales, fixed-asset
 *   investment and the surveyed unemployment rate (NBS also posts separate
 *   pages for several of these the same morning; the bundle holds every
 *   figure read here, so it is the one page fetched).
 *
 * The parser works on the article text, paragraph by paragraph, and reads a
 * figure only from the sentence NBS writes it in: a period marker ("8月份",
 * "1—8月份"), the subject, then the growth. A page without the sentences it
 * expects is refused with an error, never guessed at: a changed layout
 * should be a visible failure in the fetch log, not a wrong number.
 *
 * Every figure names its period and whether it is the single month or the
 * year to date. January is never derived: NBS publishes January and
 * February together for these indicators, and "1—2月份" is read as the year
 * to date through February, nothing more.
 */

import { db, logFetch, storedValue } from "./db";
import { upstreamFetch } from "./upstream";

export const NBS_RELEASE_AGENCY = "National Bureau of Statistics";
/** The 最新发布 (latest releases) listing; its first page covers about a month of releases. */
export const NBS_RELEASE_LISTING_URL = "https://www.stats.gov.cn/sj/zxfb/";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/** The kinds of release this reader understands. Every other listing item is ignored. */
export type NbsReleaseKind = "industrial_profits" | "national_economy";

/** One item of the listing page. */
export interface NbsListedRelease {
  title: string;
  url: string;
  /** "YYYY-MM-DD", as the listing prints it. */
  publishedOn: string;
}

/** Whether a figure is the single period's value or cumulative from January. */
export type FigureBasis = "month" | "year_to_date" | "year_to_date_average";

/** The curated series and line a parsed figure should equal, when the store carries one. */
export interface StoreLine { key: string; label: string }

export interface ReleaseFigure {
  /** Stable identifier within a kind, e.g. "profits.ytd.total". */
  id: string;
  /** Plain English name: the measure, then the split, then the period form. */
  name: string;
  basis: FigureBasis;
  /** "YYYY-MM": the month reported, or the last month of the year to date. */
  period: string;
  value: number;
  /** Decimal places as printed, so the comparison rounds the stored value the way NBS rounded this one. */
  decimals: number;
  unit: "percent change from year ago" | "percent" | "hundred million yuan";
  /** The store line holding the same statistic for the same period, or null when no curated series carries it. */
  storeLine: StoreLine | null;
}

export interface ParsedNbsRelease {
  kind: NbsReleaseKind;
  agency: typeof NBS_RELEASE_AGENCY;
  title: string;
  url: string;
  /** "YYYY-MM-DD HH:MM" in China Standard Time, from the page's PubDate. */
  publishedAt: string;
  /** "YYYY-MM": the latest month the release reports. */
  period: string;
  figures: ReleaseFigure[];
}

export type ComparisonStatus = "agree" | "disagree" | "not_in_database" | "no_comparable_series";

export interface FigureComparison {
  id: string;
  name: string;
  period: string;
  basis: FigureBasis;
  parsed: number;
  stored: number | null;
  storeLine: StoreLine | null;
  status: ComparisonStatus;
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

/**
 * The releases on the listing page, newest first as NBS orders them. Each
 * item is printed three times (wide, medium and narrow layouts), so items
 * are kept once per URL. A page with no items is not a listing this parser
 * knows, and says so.
 */
export function parseReleaseListing(html: string, listingUrl = NBS_RELEASE_LISTING_URL): NbsListedRelease[] {
  const releases: NbsListedRelease[] = [];
  const seen = new Set<string>();
  for (const chunk of html.split(/<li[\s>]/).slice(1)) {
    const link = chunk.match(/<a\b[^>]*\bhref="([^"]*t\d{8}_\d+\.html)"[^>]*\btitle=(?:'([^']*)'|"([^"]*)")/);
    const date = chunk.match(/<span>\s*(\d{4}-\d{2}-\d{2})\s*<\/span>/);
    if (!link?.[1] || !date?.[1]) continue;
    const url = new URL(link[1], listingUrl).toString();
    if (seen.has(url)) continue;
    seen.add(url);
    releases.push({ title: (link[2] ?? link[3] ?? "").trim(), url, publishedOn: date[1] });
  }
  if (releases.length === 0) throw new Error("NBS release listing: no release items found; the page layout has changed");
  return releases;
}

/** Which kind of release a listing title names, or null for one this reader does not read. */
export function releaseKindOfTitle(title: string): NbsReleaseKind | null {
  // Commentary ("解读"), the annual communiqué (统计公报) and the bureau's
  // composite indices ("2025年经济发展新动能指数增长12.5%") share words with the
  // bundle's titles but are not the release.
  if (/解读|统计公报|指数/.test(title)) return null;
  if (/规模以上工业企业利润/.test(title)) return "industrial_profits";
  // The bundle is not always titled 国民经济: the half-year and annual ones read
  // "上半年经济运行在合理区间 新动能快速成长" and "2025年经济发展向新向优 预期目标圆满实现".
  if (/国民经济|经济运行|经济发展/.test(title)) return "national_economy";
  return null;
}

// ---------------------------------------------------------------------------
// Page text
// ---------------------------------------------------------------------------

/**
 * The article's paragraphs, with all whitespace removed. The page renders
 * the article twice (desktop and mobile), each in a "trs_editor_view" block;
 * the first is read. NBS sets figures apart with spaces ("15.7 %"), and
 * Chinese text has no meaningful spaces, so removing them all leaves the
 * sentences as they read.
 */
function articleParagraphs(html: string): string[] {
  const start = html.indexOf("trs_editor_view");
  if (start < 0) throw new Error("NBS release page: no article body (trs_editor_view) found; the page layout has changed");
  // From the end of the opening tag that names the block, so its attributes are not read as text.
  const opened = html.indexOf(">", start) + 1;
  const second = html.indexOf("trs_editor_view", opened);
  const body = html.slice(opened, second > 0 ? html.lastIndexOf("<", second) : undefined);
  return body
    .replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<\/(p|div|tr|h\d)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&emsp;|&ensp;/g, " ")
    .split("\n")
    .map((paragraph) => paragraph.replace(/[\s　]+/g, ""))
    .filter((paragraph) => paragraph.length > 0);
}

function metaContent(html: string, name: string): string | null {
  const match = html.match(new RegExp(`<meta\\s+name="${name}"\\s+content="([^"]*)"`, "i"));
  return match?.[1]?.trim() || null;
}

// ---------------------------------------------------------------------------
// Sentences
// ---------------------------------------------------------------------------

/** The dashes a month range is written with: em dash (NBS's usual), en dash, hyphen, tildes, full-width hyphen. */
const DASH = "[—–\\-~～－]";
/**
 * A period marker as NBS opens a sentence with it: "8月份", "1—8月份",
 * "2026年1—8月份", "全年", "2025年" (an annual profits release), and the
 * quarter names some releases use for the year to date.
 */
const PERIOD_MARKER = `(?:\\d{4}年)?(?:\\d{1,2}${DASH}\\d{1,2}月份?|\\d{1,2}月份?)|全年|上半年|前三季度|一季度|\\d{4}年`;
/**
 * Growth as the text states it: "同比增长15.7%", "下降12.0%", "增长5.2%", 持平
 * (unchanged), and in an annual release "比上年增长0.6%".
 */
const GROWTH = "(?:同比|比上年)?((?:增长|下降|减少)\\d+(?:\\.\\d+)?%|持平)";
const NUMBER = "(\\d+(?:\\.\\d+)?)";

interface ReadPeriod { period: string; basis: "month" | "year_to_date" }

/**
 * A period marker to its period and basis. The year is the marker's own
 * when it carries one; otherwise the release's: a month after the
 * publication month belongs to the year before ("12月份" published in
 * January).
 */
function readPeriodMarker(marker: string, publishedOn: string): ReadPeriod {
  const publishYear = Number(publishedOn.slice(0, 4));
  const publishMonth = Number(publishedOn.slice(5, 7));
  const explicitYear = marker.match(/^(\d{4})年/)?.[1];
  const yearFor = (month: number) => (explicitYear ? Number(explicitYear) : month > publishMonth ? publishYear - 1 : publishYear);
  const at = (month: number) => `${yearFor(month)}-${String(month).padStart(2, "0")}`;
  const range = marker.match(new RegExp(`(\\d{1,2})${DASH}(\\d{1,2})月`));
  if (range) {
    const first = Number(range[1]), last = Number(range[2]);
    // A cumulative figure always runs from January; anything else is not a sentence this parser knows.
    if (first !== 1 || last < 2 || last > 12) throw new Error(`NBS release: unexpected month range "${marker}"`);
    return { period: at(last), basis: "year_to_date" };
  }
  const single = marker.match(/(\d{1,2})月/);
  if (single) {
    const month = Number(single[1]);
    if (month < 1 || month > 12) throw new Error(`NBS release: unexpected month "${marker}"`);
    // NBS publishes January and February together for every indicator read
    // here. A single-month January figure is something the bureau does not
    // publish, so a sentence claiming one is a misread and the page is refused.
    if (month === 1) throw new Error(`NBS release: a single-month January figure ("${marker}"), which NBS does not publish for these indicators`);
    return { period: at(month), basis: "month" };
  }
  if (marker === "一季度") return { period: at(3), basis: "year_to_date" };
  if (marker === "上半年") return { period: at(6), basis: "year_to_date" };
  if (marker === "前三季度") return { period: at(9), basis: "year_to_date" };
  // "全年" and a bare "2025年" are the whole year: the year to date through December.
  if (marker === "全年") return { period: `${publishMonth <= 3 ? publishYear - 1 : publishYear}-12`, basis: "year_to_date" };
  if (explicitYear) return { period: `${explicitYear}-12`, basis: "year_to_date" };
  throw new Error(`NBS release: unreadable period "${marker}"`);
}

function readGrowth(text: string): number {
  if (text === "持平") return 0;
  const match = text.match(/^(增长|下降|减少)(\d+(?:\.\d+)?)%$/);
  if (!match) throw new Error(`NBS release: unreadable growth "${text}"`);
  const value = Number(match[2]);
  return match[1] === "增长" ? value : -value;
}

function decimalsOf(text: string): number {
  return text.match(/\.(\d+)/)?.[1]?.length ?? 0;
}

/** One sentence that opens with a period marker: where it was found, what it said, and the text it governs. */
interface Statement {
  period: ReadPeriod;
  /** The captured groups after the marker, in pattern order. */
  groups: string[];
  /**
   * The rest of the paragraph after this sentence, up to the next sentence
   * that opens with another period marker: the text whose unmarked figures
   * ("民间投资同比下降10.1%") report the same period.
   */
  scope: string;
}

/**
 * Every sentence in the article of the form "<period>，<subject>…". `body`
 * is the regex source for what follows the comma, with its own groups.
 */
function statements(paragraphs: string[], body: string, publishedOn: string): Statement[] {
  const found: Statement[] = [];
  // The annual bundle writes "全年全国规模以上工业增加值比上年增长5.9%" with no
  // comma after 全年; every other marker is followed by one.
  const opener = new RegExp(`(?:^|[。；])(${PERIOD_MARKER})(?:，|(?<=全年))${body}`, "g");
  const nextMarker = new RegExp(`[。；](?:${PERIOD_MARKER})，`, "g");
  for (const paragraph of paragraphs) {
    for (const match of paragraph.matchAll(opener)) {
      const end = (match.index ?? 0) + match[0].length;
      nextMarker.lastIndex = end;
      const next = nextMarker.exec(paragraph);
      found.push({
        period: readPeriodMarker(match[1] ?? "", publishedOn),
        groups: match.slice(2).map((group) => group ?? ""),
        scope: paragraph.slice(end, next ? next.index : undefined),
      });
    }
  }
  return found;
}

/** The first figure of the form "<subject><growth>" in a statement's scope, where the subject opens a clause. */
function growthInScope(scope: string, subject: string): string | null {
  const match = scope.match(new RegExp(`(?:^|[，。；：])(?:[^，。；：]{0,6}看，)?${subject}${GROWTH}`));
  return match?.[1] ?? null;
}

/** "为5.3%" after a subject that opens a clause: a rate, not a growth. */
function rateInScope(scope: string, subject: string): string | null {
  const match = scope.match(new RegExp(`(?:^|[，。；：])${subject}为${NUMBER}%`));
  return match?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// The two kinds of page
// ---------------------------------------------------------------------------

/** A figure builder that fixes the unit and store line, reading the value from its printed text. */
function figure(id: string, name: string, statement: { period: string; basis: FigureBasis }, printed: string, unit: ReleaseFigure["unit"], storeLine: StoreLine | null, value?: number): ReleaseFigure {
  return {
    id, name, basis: statement.basis, period: statement.period,
    value: value ?? Number(printed), decimals: decimalsOf(printed), unit, storeLine,
  };
}

/** The growth figure's printed number without its sign word, for counting decimals. */
function printedNumber(growth: string): string {
  return growth.match(/\d+(?:\.\d+)?/)?.[0] ?? "0";
}

function parseProfitsRelease(paragraphs: string[], publishedOn: string): ReleaseFigure[] {
  const figures: ReleaseFigure[] = [];
  // "1—8月份，全国规模以上工业企业实现利润总额52719.8亿元，同比增长15.7%"
  const headline = statements(paragraphs, `全国规模以上工业企业实现利润总额${NUMBER}亿元，${GROWTH}`, publishedOn)
    .find((statement) => statement.period.basis === "year_to_date");
  if (!headline) throw new Error("NBS profits release: no year-to-date headline (\"1—N月份，全国规模以上工业企业实现利润总额…亿元，同比增长…%\")");
  const [level = "", growth = ""] = headline.groups;
  figures.push(figure("profits.ytd.total", "Industrial profits, year to date (YoY %)", headline.period, printedNumber(growth), "percent change from year ago",
    { key: "industrial_profits", label: "Industrial profits, year to date (YoY %)" }, readGrowth(growth)));
  figures.push(figure("profits.ytd.total_level", "Industrial profits, year to date (100 million yuan)", headline.period, level, "hundred million yuan",
    { key: "industrial_profits_value", label: "Industrial profits, year to date" }));

  // "1—8月份，采矿业实现利润总额7661.5亿元，同比增长35.1%；制造业…；电力、热力、燃气及水生产和供应业…"
  const divisions = statements(paragraphs, `采矿业实现利润总额`, publishedOn)
    .find((statement) => statement.period.period === headline.period.period && statement.period.basis === "year_to_date");
  if (divisions) {
    // The scope starts after "采矿业实现利润总额", so mining's level opens it.
    const scope = `采矿业实现利润总额${divisions.scope}`;
    const division = (subject: string) => scope.match(new RegExp(`(?:^|[，。；])${subject}实现利润总额${NUMBER}亿元，${GROWTH}`));
    const mining = division("采矿业"), manufacturing = division("制造业"), utilities = division("电力、热力、燃气及水生产和供应业");
    if (mining?.[2]) figures.push(figure("profits.ytd.mining", "Industrial profits: mining, year to date (YoY %)", headline.period, printedNumber(mining[2]), "percent change from year ago",
      { key: "industrial_profits", label: "Mining, year to date (YoY %)" }, readGrowth(mining[2])));
    if (manufacturing?.[2]) {
      figures.push(figure("profits.ytd.manufacturing", "Industrial profits: manufacturing, year to date (YoY %)", headline.period, printedNumber(manufacturing[2]), "percent change from year ago",
        { key: "industrial_profits", label: "Manufacturing, year to date (YoY %)" }, readGrowth(manufacturing[2])));
      figures.push(figure("profits.ytd.manufacturing_level", "Industrial profits: manufacturing, year to date (100 million yuan)", headline.period, manufacturing[1] ?? "", "hundred million yuan",
        { key: "industrial_profits_value", label: "Manufacturing, year to date" }));
    }
    if (utilities?.[2]) figures.push(figure("profits.ytd.utilities", "Industrial profits: utilities, year to date (YoY %)", headline.period, printedNumber(utilities[2]), "percent change from year ago",
      { key: "industrial_profits", label: "Utilities, year to date (YoY %)" }, readGrowth(utilities[2])));
  }

  // "8月份，规模以上工业企业利润同比增长4.2%": the single month, which the bureau's
  // table does not carry and the site has no line for.
  const month = statements(paragraphs, `规模以上工业企业利润${GROWTH}`, publishedOn)
    .find((statement) => statement.period.basis === "month" && statement.period.period === headline.period.period);
  if (month?.groups[0]) figures.push(figure("profits.month.total", "Industrial profits, month (YoY %)", month.period, printedNumber(month.groups[0]), "percent change from year ago", null, readGrowth(month.groups[0])));
  return figures;
}

function parseNationalEconomyRelease(paragraphs: string[], publishedOn: string): ReleaseFigure[] {
  const figures: ReleaseFigure[] = [];
  const growthPercent = "percent change from year ago" as const;

  // Industrial value added: "8月份，全国规模以上工业增加值同比增长5.2%" and "1—8月份，…5.3%".
  // Quarterly and annual bundles drop 全国 from the month's sentence ("3月份，规模以上工业增加值同比增长5.7%").
  const valueAdded = statements(paragraphs, `(?:全国)?规模以上工业增加值${GROWTH}`, publishedOn);
  for (const statement of valueAdded) {
    const growth = statement.groups[0] ?? "";
    if (statement.period.basis === "month") {
      figures.push(figure("value_added.month", "Industrial value added, month (YoY %)", statement.period, printedNumber(growth), growthPercent,
        { key: "industrial_production", label: "Industrial production (YoY %)" }, readGrowth(growth)));
    } else {
      // The site's line holds single months and, for February, the combined
      // January-February figure NBS publishes in their place (the mirror's
      // januaryFebruaryField). So a "1—2月份" figure has a line to meet; later
      // years to date do not.
      const januaryFebruary = statement.period.period.endsWith("-02");
      figures.push(figure("value_added.ytd", "Industrial value added, year to date (YoY %)", statement.period, printedNumber(growth), growthPercent,
        januaryFebruary ? { key: "industrial_production", label: "Industrial production (YoY %)" } : null, readGrowth(growth)));
    }
  }

  // Retail sales: "8月份，社会消费品零售总额39824亿元，同比增长0.4%" and "1—8月份，社会消费品零售总额327569亿元，同比增长1.1%".
  // Not the newer 社会消费商品和服务零售总额 (goods and services), a different aggregate.
  // Some months give no level: "4月份，社会消费品零售总额同比增长0.2%". The level is optional.
  const retail = statements(paragraphs, `社会消费品零售总额(?:${NUMBER}亿元，)?${GROWTH}`, publishedOn);
  for (const statement of retail) {
    const growth = statement.groups[1] ?? "";
    if (statement.period.basis === "month") {
      figures.push(figure("retail.month", "Retail sales of consumer goods, month (YoY %)", statement.period, printedNumber(growth), growthPercent,
        { key: "retail_sales", label: "Retail sales (YoY %)" }, readGrowth(growth)));
    } else {
      const januaryFebruary = statement.period.period.endsWith("-02");
      figures.push(figure("retail.ytd", "Retail sales of consumer goods, year to date (YoY %)", statement.period, printedNumber(growth), growthPercent,
        januaryFebruary ? { key: "retail_sales", label: "Retail sales (YoY %)" } : null, readGrowth(growth)));
    }
  }

  // Fixed-asset investment, cumulative only: "1—8月份，全国固定资产投资（不含农户）293092亿元，同比下降7.2%", then the
  // splits in the same paragraph, which report the same year to date.
  const investment = statements(paragraphs, `全国固定资产投资（不含农户）${NUMBER}亿元，${GROWTH}`, publishedOn)
    .find((statement) => statement.period.basis === "year_to_date");
  if (investment) {
    const growth = investment.groups[1] ?? "";
    figures.push(figure("fai.ytd.total", "Fixed-asset investment, year to date (YoY %)", investment.period, printedNumber(growth), growthPercent,
      { key: "fai", label: "Fixed-asset investment, year to date (YoY %)" }, readGrowth(growth)));
    const splits: { id: string; name: string; subject: string; storeLine: StoreLine | null }[] = [
      { id: "fai.ytd.private", name: "Private investment, year to date (YoY %)", subject: "民间投资", storeLine: { key: "fai", label: "Private investment, year to date (YoY %)" } },
      { id: "fai.ytd.primary", name: "Fixed-asset investment: primary industry, year to date (YoY %)", subject: "第一产业投资", storeLine: { key: "fai", label: "Primary industry, year to date (YoY %)" } },
      { id: "fai.ytd.secondary", name: "Fixed-asset investment: secondary industry, year to date (YoY %)", subject: "第二产业投资", storeLine: { key: "fai", label: "Secondary industry, year to date (YoY %)" } },
      { id: "fai.ytd.tertiary", name: "Fixed-asset investment: tertiary industry, year to date (YoY %)", subject: "第三产业投资", storeLine: { key: "fai", label: "Tertiary industry, year to date (YoY %)" } },
      { id: "fai.ytd.manufacturing", name: "Fixed-asset investment: manufacturing, year to date (YoY %)", subject: "制造业投资", storeLine: { key: "fai_by_industry", label: "Manufacturing, year to date (YoY %)" } },
      // Infrastructure and high-tech investment are published in the release only; the
      // portal has no table for either, which is why this reader exists (COVERAGE_PLAN step 3).
      { id: "fai.ytd.infrastructure", name: "Fixed-asset investment: infrastructure, year to date (YoY %)", subject: "基础设施投资", storeLine: null },
      { id: "fai.ytd.high_tech", name: "Fixed-asset investment: high-tech industries, year to date (YoY %)", subject: "高技术产业投资", storeLine: null },
      { id: "fai.ytd.real_estate", name: "Real estate development investment, year to date (YoY %)", subject: "房地产开发投资", storeLine: { key: "property_investment", label: "Real estate investment, year to date (YoY %)" } },
    ];
    for (const split of splits) {
      const growthText = growthInScope(investment.scope, split.subject);
      if (growthText) figures.push(figure(split.id, split.name, investment.period, printedNumber(growthText), growthPercent, split.storeLine, readGrowth(growthText)));
    }
  }

  // Surveyed urban unemployment: "8月份，全国城镇调查失业率为5.3%", then the hukou and
  // 31-city rates; and "1—8月份，全国城镇调查失业率平均值为5.2%", an average, not a rate for a month.
  const unemployment = statements(paragraphs, `全国城镇调查失业率为${NUMBER}%`, publishedOn)
    .find((statement) => statement.period.basis === "month");
  if (unemployment) {
    const rate = unemployment.groups[0] ?? "";
    figures.push(figure("unemployment.month.urban", "Surveyed urban unemployment rate, month (%)", unemployment.period, rate, "percent",
      { key: "unemployment", label: "Surveyed urban (%)" }));
    const splits: { id: string; name: string; subject: string; label: string }[] = [
      { id: "unemployment.month.local_hukou", name: "Surveyed unemployment rate: local hukou, month (%)", subject: "本地户籍劳动力调查失业率", label: "Local hukou (%)" },
      { id: "unemployment.month.non_local_hukou", name: "Surveyed unemployment rate: non-local hukou, month (%)", subject: "外来户籍劳动力调查失业率", label: "Non-local hukou (%)" },
      { id: "unemployment.month.major_cities", name: "Surveyed urban unemployment rate: 31 major cities, month (%)", subject: "31个大城市城镇调查失业率", label: "31 major cities (%)" },
    ];
    for (const split of splits) {
      const value = rateInScope(unemployment.scope, split.subject);
      if (value) figures.push(figure(split.id, split.name, unemployment.period, value, "percent", { key: "unemployment", label: split.label }));
    }
  }
  const average = statements(paragraphs, `全国城镇调查失业率平均值为${NUMBER}%`, publishedOn)
    .find((statement) => statement.period.basis === "year_to_date");
  if (average?.groups[0]) {
    figures.push(figure("unemployment.ytd_average.urban", "Surveyed urban unemployment rate, year-to-date average (%)",
      { period: average.period.period, basis: "year_to_date_average" }, average.groups[0], "percent", null));
  }

  // The bundle repeats the previous month's industrial profits
  // ("1—7月份，全国规模以上工业企业实现利润总额45821亿元，同比增长17.6%"). The
  // database has usually caught up with it by then, so it is a free check.
  const profits = statements(paragraphs, `全国规模以上工业企业实现利润总额${NUMBER}亿元，${GROWTH}`, publishedOn)
    .find((statement) => statement.period.basis === "year_to_date");
  if (profits?.groups[1]) {
    figures.push(figure("profits.ytd.total", "Industrial profits, year to date (YoY %)", profits.period, printedNumber(profits.groups[1]), growthPercent,
      { key: "industrial_profits", label: "Industrial profits, year to date (YoY %)" }, readGrowth(profits.groups[1])));
  }

  // Refuse a bundle missing any of its four headline statements: that is a page
  // this parser does not know, not a month without an unemployment rate.
  const missing = [
    figures.some((item) => item.id.startsWith("value_added.")) ? null : "industrial value added",
    figures.some((item) => item.id.startsWith("retail.")) ? null : "retail sales",
    figures.some((item) => item.id === "fai.ytd.total") ? null : "fixed-asset investment",
    figures.some((item) => item.id === "unemployment.month.urban") ? null : "surveyed unemployment rate",
  ].filter((name): name is string => name !== null);
  if (missing.length > 0) throw new Error(`NBS national economy release: no headline sentence for ${missing.join(", ")}; the page is not in a shape this parser knows`);
  // A page that opens a sentence with a month and value added or retail sales
  // has a month figure for it. If that figure was not read, the sentence is in
  // a form this parser does not know, and dropping it silently is how the
  // March and April 2026 months went missing in the first version.
  const opensMonthSentence = (subject: string) => paragraphs.some((paragraph) => new RegExp(`(?:^|[。；])\\d{1,2}月份?，${subject}`).test(paragraph));
  if (opensMonthSentence("(?:全国)?规模以上工业增加值") && !figures.some((item) => item.id === "value_added.month")) {
    throw new Error("NBS national economy release: a month sentence for industrial value added that the parser could not read");
  }
  if (opensMonthSentence("社会消费品零售总额") && !figures.some((item) => item.id === "retail.month")) {
    throw new Error("NBS national economy release: a month sentence for retail sales that the parser could not read");
  }
  return figures;
}

/**
 * Parse one release page. `kind` is what the listing title said; the page's
 * own title must say the same, and the figures must be where that kind puts
 * them, or the page is refused with an error.
 */
export function parseReleasePage(html: string, url: string, expectedKind?: NbsReleaseKind): ParsedNbsRelease {
  const title = metaContent(html, "ArticleTitle");
  const published = metaContent(html, "PubDate")?.match(/^(\d{4})\/(\d{2})\/(\d{2})(?:\s+(\d{2}:\d{2}))?/);
  if (!title || !published) throw new Error(`NBS release page ${url}: no ArticleTitle or PubDate; the page layout has changed`);
  const kind = releaseKindOfTitle(title);
  if (!kind) throw new Error(`NBS release page ${url}: "${title}" is not a release this parser reads`);
  if (expectedKind && kind !== expectedKind) throw new Error(`NBS release page ${url}: listed as ${expectedKind} but titled "${title}"`);
  const publishedOn = `${published[1]}-${published[2]}-${published[3]}`;
  const paragraphs = articleParagraphs(html);
  const figures = kind === "industrial_profits" ? parseProfitsRelease(paragraphs, publishedOn) : parseNationalEconomyRelease(paragraphs, publishedOn);
  // The release's period is the latest month it reports on its own subjects;
  // the bundle's repeat of last month's profits does not set it.
  const own = figures.filter((item) => kind === "industrial_profits" || !item.id.startsWith("profits."));
  const period = own.map((item) => item.period).sort().at(-1) ?? "";
  // Every figure a release reports on its own subjects is for that one month
  // (the month itself or the year through it). A figure for another month
  // means a sentence was misread.
  const stray = own.filter((item) => item.period !== period);
  if (stray.length > 0) throw new Error(`NBS release page ${url}: figures for ${stray.map((item) => `${item.id} ${item.period}`).join(", ")} in a release for ${period}`);
  return { kind, agency: NBS_RELEASE_AGENCY, title, url, publishedAt: `${publishedOn} ${published[4] ?? "00:00"}`, period, figures };
}

// ---------------------------------------------------------------------------
// Shadow comparison
// ---------------------------------------------------------------------------

/** The store's value for one line and period; injected so the comparison can be tested without a store. */
export type StoredValueLookup = (key: string, label: string, period: string) => number | null;

const storeLookup: StoredValueLookup = (key, label, period) => storedValue(key, "", label, period);

/**
 * A value rounded to `decimals` places, halves away from zero as NBS rounds.
 * The small nudge keeps a binary value like 2.35 (stored as 2.34999...) on the
 * side of the half its decimal digits say it is on.
 */
export function roundAsPrinted(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  const rounded = Math.floor(Math.abs(value) * scale + 0.5 + 1e-9) / scale;
  return value < 0 ? -rounded : rounded;
}

/**
 * Each figure against the store. Agreement allows for rounding only, and
 * NBS's rounding at that: the stored value, rounded to the decimals the page
 * printed, must equal the printed figure. A stored -2.35 against a printed
 * -2.3 is a disagreement (NBS would have printed -2.4), where a test of
 * "within half a unit" would have let it pass.
 */
export function compareWithStore(figures: ReleaseFigure[], lookup: StoredValueLookup = storeLookup): FigureComparison[] {
  return figures.map((item) => {
    const base = { id: item.id, name: item.name, period: item.period, basis: item.basis, parsed: item.value, storeLine: item.storeLine };
    if (!item.storeLine) return { ...base, stored: null, status: "no_comparable_series" as const };
    const stored = lookup(item.storeLine.key, item.storeLine.label, item.period);
    if (stored === null) return { ...base, stored: null, status: "not_in_database" as const };
    return { ...base, stored, status: roundAsPrinted(stored, item.decimals) === item.value ? "agree" as const : "disagree" as const };
  });
}

const STATUS_WORDS: Record<ComparisonStatus, string> = {
  agree: "agree",
  disagree: "disagree",
  not_in_database: "not yet in database",
  no_comparable_series: "no comparable series",
};

/** The fetch-log message for one release read: what was parsed, and how each figure stands against the store. */
export function describeComparison(release: ParsedNbsRelease, comparisons: FigureComparison[]): string {
  const count = (status: ComparisonStatus) => comparisons.filter((item) => item.status === status).length;
  const tally = (Object.keys(STATUS_WORDS) as ComparisonStatus[]).map((status) => `${STATUS_WORDS[status]} ${count(status)}`).join(", ");
  const detail = comparisons.map((item) => {
    const against = item.stored === null ? "" : ` (database ${item.stored})`;
    return `${item.name} ${item.period} ${item.parsed}: ${STATUS_WORDS[item.status]}${against}`;
  }).join("; ");
  return `${NBS_RELEASE_AGENCY} release "${release.title}" (${release.kind}, ${release.period}), shadow mode: ${comparisons.length} figures parsed; ${tally}. ${detail}`;
}

// ---------------------------------------------------------------------------
// The record of releases read
// ---------------------------------------------------------------------------

let tableReady = false;

/**
 * A small table of its own, created on first use as server/jobs.ts does: the
 * store is append-friendly and existing tables do not gain columns. One row
 * per release page read, keyed by URL, so a page is fetched once.
 */
function releasesDb() {
  const database = db();
  if (!tableReady) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS press_release_reads (
        url           TEXT PRIMARY KEY,
        kind          TEXT NOT NULL,
        title         TEXT NOT NULL,
        published_at  TEXT NOT NULL,
        period        TEXT NOT NULL,
        read_at       TEXT NOT NULL,
        figures       TEXT NOT NULL,
        comparison    TEXT NOT NULL
      )
    `);
    // A page the parser refused: kept so it is retried at most once a day
    // rather than fetched and error-logged on every check for the month it
    // stays on the listing's first page. last_listed_at is when the page was
    // last seen on that listing: a refusal counts as current only while the
    // page is listed, since once it falls off, only a weekly or post-deploy
    // retry reaches it and it should stop reading as a live fault.
    database.exec(`
      CREATE TABLE IF NOT EXISTS press_release_refusals (
        url               TEXT PRIMARY KEY,
        title             TEXT NOT NULL,
        first_refused_at  TEXT NOT NULL,
        last_refused_at   TEXT NOT NULL,
        last_listed_at    TEXT NOT NULL DEFAULT '',
        attempts          INTEGER NOT NULL DEFAULT 1,
        message           TEXT NOT NULL,
        given_up_at       TEXT NOT NULL DEFAULT ''
      )
    `);
    // A store whose refusals table was created before these columns existed
    // gains them here. An empty last_listed_at reads as the last refusal.
    const columns = new Set(database.query<{ name: string }, []>("PRAGMA table_info(press_release_refusals)").all().map((column) => column.name));
    if (!columns.has("last_listed_at")) database.exec("ALTER TABLE press_release_refusals ADD COLUMN last_listed_at TEXT NOT NULL DEFAULT ''");
    if (!columns.has("given_up_at")) database.exec("ALTER TABLE press_release_refusals ADD COLUMN given_up_at TEXT NOT NULL DEFAULT ''");
    tableReady = true;
  }
  return database;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long a refused page still on the listing waits before it is fetched again. */
export const REFUSED_PAGE_RETRY_MS = DAY_MS;
/** How long a refused page no longer on the listing waits, unless a deploy has happened since. */
export const UNLISTED_REFUSAL_RETRY_MS = 7 * DAY_MS;
/**
 * A refusal is current while its page was on the listing within this many
 * days. The listing's first page spans about a month, so a page last seen
 * over five weeks ago has fallen off it.
 */
export const REFUSAL_CURRENT_DAYS = 35;
/**
 * An unlisted refusal is given up after this many attempts or this many days
 * since it was first refused, whichever comes first: a page NBS has taken
 * down would otherwise be fetched weekly and after every deploy for ever.
 */
export const UNLISTED_REFUSAL_MAX_ATTEMPTS = 20;
export const UNLISTED_REFUSAL_MAX_DAYS = 180;

export interface PressReleaseRefusal { url: string; title: string; firstRefusedAt: string; lastRefusedAt: string; lastListedAt: string; attempts: number; message: string }

// A row migrated from before last_listed_at existed has it empty; its last refusal stands in.
const REFUSAL_COLUMNS = "r.url, r.title, r.first_refused_at AS firstRefusedAt, r.last_refused_at AS lastRefusedAt, CASE WHEN r.last_listed_at = '' THEN r.last_refused_at ELSE r.last_listed_at END AS lastListedAt, r.attempts, r.message";

function lastRefusal(url: string): PressReleaseRefusal | null {
  return releasesDb().query<PressReleaseRefusal, { $url: string }>(`SELECT ${REFUSAL_COLUMNS} FROM press_release_refusals r WHERE r.url = $url`).get({ $url: url });
}

/** Record a refusal. `listedAt` is now when the page was on the listing, and null when it was retried from the record alone. */
function recordRefusal(url: string, title: string, message: string, at: string, listedAt: string | null): void {
  releasesDb().query(`
    INSERT INTO press_release_refusals (url, title, first_refused_at, last_refused_at, last_listed_at, attempts, message)
    VALUES ($url, $title, $at, $at, COALESCE($listedAt, $at), 1, $message)
    ON CONFLICT(url) DO UPDATE SET last_refused_at = excluded.last_refused_at, attempts = attempts + 1, message = excluded.message,
      last_listed_at = COALESCE($listedAt, last_listed_at),
      given_up_at = CASE WHEN $listedAt IS NULL THEN given_up_at ELSE '' END
  `).run({ $url: url, $title: title, $at: at, $listedAt: listedAt, $message: message });
}

/**
 * An unlisted page that could not be fetched on its retry: the attempt counts
 * towards giving up (a taken-down page answers 404 for ever), but the reason
 * it was refused stays the parser's.
 */
function recordUnlistedFetchFailure(url: string, at: string): void {
  releasesDb().query("UPDATE press_release_refusals SET attempts = attempts + 1, last_refused_at = $at WHERE url = $url").run({ $url: url, $at: at });
}

function giveUpRefusal(url: string, at: string): void {
  releasesDb().query("UPDATE press_release_refusals SET given_up_at = $at WHERE url = $url").run({ $url: url, $at: at });
}

/** A refused page seen on the listing again, though not fetched this time (its day has not passed). */
function markStillListed(url: string, at: string): void {
  releasesDb().query("UPDATE press_release_refusals SET last_listed_at = $at WHERE url = $url").run({ $url: url, $at: at });
}

function unreadRefusals(): PressReleaseRefusal[] {
  return releasesDb().query<PressReleaseRefusal, []>(`
    SELECT ${REFUSAL_COLUMNS}
    FROM press_release_refusals r
    WHERE NOT EXISTS (SELECT 1 FROM press_release_reads p WHERE p.url = r.url) AND r.given_up_at = ''
    ORDER BY r.last_refused_at DESC
  `).all();
}

/**
 * Pages refused and still unread, split by whether the refusal is current.
 * Current: the page was on the listing within REFUSAL_CURRENT_DAYS, so it is
 * retried daily and a person should look at it. No longer listed: it fell off
 * the listing while refused; it is retried weekly and after each deploy, so a
 * parser fix can still clear it, but it is not a live fault.
 */
export function refusedPressReleases(now = Date.now()): { current: PressReleaseRefusal[]; noLongerListed: PressReleaseRefusal[] } {
  const cutoff = now - REFUSAL_CURRENT_DAYS * DAY_MS;
  const all = unreadRefusals();
  return {
    current: all.filter((row) => Date.parse(row.lastListedAt) >= cutoff),
    noLongerListed: all.filter((row) => Date.parse(row.lastListedAt) < cutoff),
  };
}

export function hasReadRelease(url: string): boolean {
  return releasesDb().query<{ url: string }, { $url: string }>("SELECT url FROM press_release_reads WHERE url = $url").get({ $url: url }) !== null;
}

export function recordReleaseRead(release: ParsedNbsRelease, comparisons: FigureComparison[], readAt = new Date().toISOString()): void {
  releasesDb().query(`
    INSERT INTO press_release_reads (url, kind, title, published_at, period, read_at, figures, comparison)
    VALUES ($url, $kind, $title, $publishedAt, $period, $readAt, $figures, $comparison)
    ON CONFLICT(url) DO NOTHING
  `).run({
    $url: release.url, $kind: release.kind, $title: release.title, $publishedAt: release.publishedAt, $period: release.period,
    $readAt: readAt, $figures: JSON.stringify(release.figures), $comparison: JSON.stringify(comparisons),
  });
}

export interface PressReleaseView {
  url: string;
  kind: NbsReleaseKind;
  agency: typeof NBS_RELEASE_AGENCY;
  title: string;
  publishedAt: string;
  period: string;
  readAt: string;
  /** How each figure stood against the store when the page was read. */
  comparisonAtRead: FigureComparison[];
  /** How each figure stands against the store now: a "not yet in database" at read time turns into agree or disagree once the database catches up. */
  comparisonNow: FigureComparison[];
}

/** The most recent releases read, newest first, with their comparison then and now. */
export function recentPressReleases(limit = 24, lookup: StoredValueLookup = storeLookup): PressReleaseView[] {
  const rows = releasesDb().query<{ url: string; kind: string; title: string; published_at: string; period: string; read_at: string; figures: string; comparison: string }, { $limit: number }>(
    "SELECT * FROM press_release_reads ORDER BY published_at DESC, url DESC LIMIT $limit",
  ).all({ $limit: limit });
  return rows.map((row) => {
    const figures = JSON.parse(row.figures) as ReleaseFigure[];
    return {
      url: row.url, kind: row.kind === "industrial_profits" ? "industrial_profits" : "national_economy", agency: NBS_RELEASE_AGENCY,
      title: row.title, publishedAt: row.published_at, period: row.period, readAt: row.read_at,
      comparisonAtRead: JSON.parse(row.comparison) as FigureComparison[],
      comparisonNow: compareWithStore(figures, lookup),
    };
  });
}

// ---------------------------------------------------------------------------
// The check the scheduler runs
// ---------------------------------------------------------------------------

async function get(url: string): Promise<string> {
  const response = await upstreamFetch(url, { headers: { "User-Agent": USER_AGENT }, timeoutMs: 30_000, redirect: "follow" });
  if (!response.ok) throw new Error(`NBS release page -> HTTP ${response.status}`);
  return response.text();
}

export interface PressReleaseCheck {
  listed: number;
  /** Listing items of a kind this reader parses. */
  relevant: number;
  /** Pages fetched and parsed this run. */
  read: number;
  /** Pages fetched and refused by the parser this run; each has an error row in fetch_log and a refusal record. */
  failed: number;
  /** Pages that could not be fetched this run (HTTP error, timeout): logged, not refusals, tried again on the next check. */
  unreachable: number;
  /** Unlisted refusals given up this run after too many attempts or too long. */
  givenUp: number;
  /** Refused pages not fetched this run because their last refusal was less than a day ago. */
  waiting: number;
  /** Refused pages no longer on the listing, fetched again by their stored URL this run. */
  retriedUnlisted: number;
}

/**
 * Refused pages retried by URL in this process. The first check after a
 * deploy retries every unlisted refusal once, since a deploy is when a parser
 * fix arrives; after that, once a week.
 */
const retriedUnlistedThisProcess = new Set<string>();

/** The fetch-log region for a release: the page's own id ("t20260928_1965425"), stable and short. */
function pageId(url: string): string {
  return url.match(/(t\d{8}_\d+)\.html$/)?.[1] ?? url;
}

/**
 * Read the listing, and every release page of a known kind not read before.
 * One request at a time: each await finishes before the next is sent, and
 * every request goes through the per-host gate in server/upstream.ts. A page
 * is recorded as read only once it parses. A refused page is recorded with
 * its attempts and tried again once a day while it is listed, each attempt an
 * error row in the fetch log: visible, without an error row for every release
 * refresh. Once it has fallen off the listing it is retried by its stored URL
 * after a deploy and then weekly.
 */
export async function checkPressReleases(read: (url: string) => Promise<string> = get, lookup: StoredValueLookup = storeLookup, now: () => number = Date.now): Promise<PressReleaseCheck> {
  const startedAt = new Date().toISOString();
  let listing: NbsListedRelease[];
  try {
    listing = parseReleaseListing(await read(NBS_RELEASE_LISTING_URL));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logFetch({ key: "press_release", region: "listing", startedAt, finishedAt: new Date().toISOString(), status: "error", points: 0, changed: 0, message });
    throw error;
  }
  const relevant = listing.flatMap((item) => {
    const kind = releaseKindOfTitle(item.title);
    return kind ? [{ ...item, kind }] : [];
  });
  const tally: PressReleaseCheck = { listed: listing.length, relevant: relevant.length, read: 0, failed: 0, unreachable: 0, givenUp: 0, waiting: 0, retriedUnlisted: 0 };
  const nowIso = () => new Date(now()).toISOString();

  /**
   * Fetch, parse, compare and record one page. A fetch that fails (an HTTP
   * error, a timeout) is not the parser's refusal: it is logged and the page
   * is tried again on the next check, so a timeout at 09:40 on release
   * morning does not hold the page back a day. Only a page fetched and then
   * not understood is recorded as refused. Nothing is thrown.
   */
  const readPage = async (url: string, title: string, kind: NbsReleaseKind, listed: boolean, previousAttempts: number) => {
    const pageStartedAt = new Date().toISOString();
    let html: string;
    try {
      html = await read(url);
    } catch (error) {
      tally.unreachable += 1;
      if (!listed) recordUnlistedFetchFailure(url, nowIso());
      logFetch({
        key: "press_release", region: pageId(url), startedAt: pageStartedAt, finishedAt: new Date().toISOString(), status: "error", points: 0, changed: 0,
        message: `"${title}": the page could not be fetched (${error instanceof Error ? error.message : String(error)}); tried again on the next check`,
      });
      return;
    }
    try {
      const release = parseReleasePage(html, url, kind);
      const comparisons = compareWithStore(release.figures, lookup);
      recordReleaseRead(release, comparisons);
      logFetch({
        key: "press_release", region: pageId(url), startedAt: pageStartedAt, finishedAt: new Date().toISOString(), status: "ok",
        points: release.figures.length, changed: comparisons.filter((comparison) => comparison.status === "disagree").length,
        message: describeComparison(release, comparisons),
      });
      tally.read += 1;
    } catch (error) {
      tally.failed += 1;
      const message = `"${title}": ${error instanceof Error ? error.message : String(error)}`;
      recordRefusal(url, title, message, nowIso(), listed ? nowIso() : null);
      logFetch({
        key: "press_release", region: pageId(url), startedAt: pageStartedAt, finishedAt: new Date().toISOString(), status: "error", points: 0, changed: 0,
        message: `${message} (attempt ${previousAttempts + 1}; ${listed ? "next try in a day" : "no longer listed; next try in a week or after a deploy"})`,
      });
    }
  };

  for (const item of relevant) {
    if (hasReadRelease(item.url)) continue;
    const refused = lastRefusal(item.url);
    if (refused && now() - Date.parse(refused.lastRefusedAt) < REFUSED_PAGE_RETRY_MS) {
      markStillListed(item.url, nowIso());
      tally.waiting += 1;
      continue;
    }
    await readPage(item.url, item.title, item.kind, true, refused?.attempts ?? 0);
  }

  // Refused pages that have fallen off the listing, retried by their stored URL.
  const listedUrls = new Set(listing.map((item) => item.url));
  for (const refusal of unreadRefusals()) {
    if (listedUrls.has(refusal.url)) continue;
    const kind = releaseKindOfTitle(refusal.title);
    if (!kind) continue;
    const tooMany = refusal.attempts >= UNLISTED_REFUSAL_MAX_ATTEMPTS;
    const tooOld = now() - Date.parse(refusal.firstRefusedAt) >= UNLISTED_REFUSAL_MAX_DAYS * DAY_MS;
    if (tooMany || tooOld) {
      // Given up once, logged once: a given-up row leaves unreadRefusals, so it is neither retried nor counted again.
      giveUpRefusal(refusal.url, nowIso());
      tally.givenUp += 1;
      logFetch({
        key: "press_release", region: pageId(refusal.url), startedAt: nowIso(), finishedAt: nowIso(), status: "error", points: 0, changed: 0,
        message: `"${refusal.title}": given up after ${refusal.attempts} attempts since ${refusal.firstRefusedAt.slice(0, 10)}; no longer listed and no longer retried. Last reason: ${refusal.message}`,
      });
      continue;
    }
    const firstSinceDeploy = !retriedUnlistedThisProcess.has(refusal.url);
    if (!firstSinceDeploy && now() - Date.parse(refusal.lastRefusedAt) < UNLISTED_REFUSAL_RETRY_MS) continue;
    retriedUnlistedThisProcess.add(refusal.url);
    tally.retriedUnlisted += 1;
    await readPage(refusal.url, refusal.title, kind, false, refusal.attempts);
  }
  return tally;
}

/** For tests: forget which unlisted refusals this process has retried, as a deploy would. */
/** For tests: check the reader's tables and columns again on next use, as a new process would, so the migration runs. */
export function resetPressReleaseTablesForTest(): void {
  tableReady = false;
}

export function forgetUnlistedRetries(): void {
  retriedUnlistedThisProcess.clear();
}

// ---------------------------------------------------------------------------
// For the health report
// ---------------------------------------------------------------------------

/** How many of the newest reads the health report judges: two months of both kinds. */
const HEALTH_READS = 4;

export interface PressReleaseHealth {
  /** The newest release read, or null before the first. */
  latest: { title: string; url: string; kind: NbsReleaseKind; period: string; publishedAt: string; readAt: string } | null;
  /** Figures that disagree with the store now, across the newest reads. */
  disagreements: { title: string; name: string; period: string; parsed: number; stored: number | null }[];
  /** Figures across the newest reads that the store does not hold yet. */
  awaitingDatabase: number;
  /** Pages refused, still unread, and on the listing within the last five weeks: a live fault. */
  refused: PressReleaseRefusal[];
  /** Pages refused and still unread that have fallen off the listing. Counted, not a live fault. */
  noLongerListed: number;
}

/**
 * The shadow reader's state in a few lines, so a disagreement shows on the
 * Data Health page and not only at /api/press-releases. Cheap by
 * construction: two small tables and, per figure of the newest few reads, one
 * point lookup on the observations' primary key. It never scans observations.
 */
export function pressReleaseHealth(lookup: StoredValueLookup = storeLookup, now = Date.now()): PressReleaseHealth {
  const recent = recentPressReleases(HEALTH_READS, lookup);
  const refusals = refusedPressReleases(now);
  const newest = recent[0];
  return {
    latest: newest ? { title: newest.title, url: newest.url, kind: newest.kind, period: newest.period, publishedAt: newest.publishedAt, readAt: newest.readAt } : null,
    disagreements: recent.flatMap((view) => view.comparisonNow.filter((item) => item.status === "disagree")
      .map((item) => ({ title: view.title, name: item.name, period: item.period, parsed: item.parsed, stored: item.stored }))),
    awaitingDatabase: recent.reduce((sum, view) => sum + view.comparisonNow.filter((item) => item.status === "not_in_database").length, 0),
    refused: refusals.current,
    noLongerListed: refusals.noLongerListed.length,
  };
}
