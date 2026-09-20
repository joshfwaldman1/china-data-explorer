/**
 * How each figure on this site was made, and how it got here.
 *
 * A reader who sees "industrial output grew 5.2 percent" is entitled to ask
 * three things: who counted it, what exactly was counted, and what this site
 * did to the number on the way. The chart page already answers the second
 * where the publisher wrote a note, because NBS's own explanatory notes ship
 * with the catalog. The other two were only in the code and in the log.
 *
 * This module puts them where a reader can reach them. A section per path the
 * data takes — the bureau's portal, Customs' own release, a workbook from the
 * exchange administration, a mirror — states the publisher, what is read,
 * how often, what the publisher revises, and what this site does with a
 * revision. Every curated key resolves to one of those sections, plus the
 * things the site knows about that key in particular: whether it is
 * cumulative, whether its publisher has stopped, and how the figure is
 * cross-checked, which is the pair in `concordance.ts` or the written reason
 * there is none.
 *
 * Nothing here is written from outside knowledge of Chinese statistics. Each
 * section describes a path this repository actually implements, and the
 * per-key facts are read from the catalog and the audit rather than restated
 * by hand, so a series that changes cannot leave a stale description behind.
 */

import { CATALOG, type CatalogEntry } from "./data";
import { CONCORDANCE_PAIRS, NO_PAIR, type SeriesRef } from "./concordance";

/** How the figures of one path reach the site, and what that path implies. */
export interface SourceMethodology {
  /** The path's name, as a reader would say it. */
  title: string;
  /** Who compiles and publishes the figures. */
  publisher: string;
  /** What this site reads, named as the publisher names it. */
  reads: string;
  /** How the site reads it, in one sentence: the mechanics, not the marketing. */
  how: string;
  /** What the publisher revises, and when. */
  revisions: string;
  /** What a reader should know before quoting a figure from this path. */
  caveats: string[];
}

/**
 * One section per adapter, because the adapter is the path. Two paths can
 * carry the same agency's figures (the bureau's own portal and a mirror of
 * it) and they do not deserve the same confidence, so they are not merged.
 */
export const SOURCE_METHODOLOGY: Record<string, SourceMethodology> = {
  nbs: {
    title: "The National Bureau of Statistics' own database",
    publisher: "National Bureau of Statistics of China",
    reads: "The bureau's public database at data.stats.gov.cn: the national monthly and quarterly datasets, the annual dataset, and the provincial monthly and quarterly datasets.",
    how: "One request per table, for the periods the site does not already hold, against the same endpoint the bureau's own site calls. Series are named by the bureau's identifiers, and the shipped catalog snapshot is a crawl of its index tree, so a series can be browsed before a figure has been fetched.",
    revisions: "The bureau revises without notice and without a changelog: a table simply answers differently. Every fetch is stored as its own vintage, so a revision shows up as a new value for a period that already had one, and the earlier reading stays readable.",
    caveats: [
      "Industrial and production series have no January figure. The bureau publishes January and February together, and the site leaves the month blank rather than derive one.",
      "Titles and explanatory notes are the bureau's own English where it publishes one, which is for nearly every series in the monthly and quarterly datasets.",
      "\"Above designated size\" (规模以上) means firms above a revenue threshold, not the whole industry, and the threshold has changed over the years.",
    ],
  },
  customs: {
    title: "Customs' own trade release",
    publisher: "General Administration of Customs of China",
    reads: "The monthly statistics tables on customs.gov.cn: the totals table, and the tables by trading partner and by commodity, in both US dollars and yuan.",
    how: "The release's own HTML tables are parsed. The administration has changed the by-country header layout twice since 2023, so three layouts are recognised and each has a fixture.",
    revisions: "Customs revises the previous months inside each release. The site stores each reading, so a revised month arrives as a new vintage.",
    caveats: [
      "January and February are published as a combined total; the separate months are not derived.",
      "Figures in yuan and in US dollars are different series, not a conversion, because the administration compiles both.",
    ],
  },
  pboc: {
    title: "The central bank's own tables",
    publisher: "People's Bank of China",
    reads: "The bank's statistics pages: aggregate financing to the real economy, the money stock, credit of financial institutions, and its copy of the reserves data template.",
    how: "The bank's yearly HTML tables are parsed for the months the site lacks.",
    revisions: "The bank revises aggregate financing and the money stock when the reporting population changes; it states this in the release rather than in the table.",
    caveats: [
      "Aggregate financing (社会融资规模) is a flow in the month and a stock at month end; both are served and named.",
      "The bank publishes growth beside the stock. That published rate is served, not a rate computed here.",
    ],
  },
  mof: {
    title: "The finance ministry's fiscal release",
    publisher: "Ministry of Finance",
    reads: "The monthly fiscal revenue and expenditure release, the tax lines inside it, and the Debt Management Department's local government bond release.",
    how: "The release's prose and tables are parsed. Two years of wording are kept as fixtures because the ministry rewrites its sentences.",
    revisions: "The ministry restates the year to date rather than the month, so a revision appears as a changed cumulative figure.",
    caveats: [
      "Fiscal figures are cumulative from the start of the year. Every such series says \"year to date\" in its label.",
      "The ministry's servers intermittently answer 502; a series can land a refresh late rather than on release day.",
    ],
  },
  mofcom: {
    title: "The commerce ministry's investment release",
    publisher: "Ministry of Commerce",
    reads: "The monthly foreign direct investment release: actual use of foreign capital, by sector, and the count of newly established enterprises.",
    how: "The release page is parsed for the year-to-date figures it states.",
    revisions: "The ministry restates the year to date; the dollar series it stopped publishing in July 2023 is kept and marked as ended.",
    caveats: [
      "Actual use of foreign capital is cumulative from the start of the year.",
      "The yuan and dollar series are not a conversion of one another and the dollar one has stopped.",
    ],
  },
  safe: {
    title: "The foreign exchange administration's workbooks",
    publisher: "State Administration of Foreign Exchange",
    reads: "The balance of payments workbook, the bank foreign exchange settlement and sales workbook, and the cross-border receipts and payments workbook, plus the release whose headline each workbook must reproduce.",
    how: "The workbooks are read directly. Both Excel formats are parsed in this repository with no dependency: the modern zip format and the legacy compound-document format.",
    revisions: "The administration replaces the workbook in place each month, including revisions to earlier quarters. A preliminary quarter is published as a separate release before the workbook carries it, and the site serves the preliminary figure until the workbook catches up.",
    caveats: [
      "Balance of payments figures follow the sixth edition of the IMF's manual, and a positive reserve asset line is an increase in assets.",
      "The annual sheet's months are checked against its years; a year that does not sum is a finding.",
    ],
  },
  nea: {
    title: "The energy administration's electricity note",
    publisher: "National Energy Administration",
    reads: "The monthly note on electricity consumption for the whole of society, with the month and the year to date, by user group.",
    how: "The note's prose is parsed. It is prose, not a table, and its wording changes: the range has been written with four different dashes and the total with a clause between the subject and its figure.",
    revisions: "The administration does not mark revisions; a later note simply states a different figure.",
    caveats: [
      "January and February are published together, on the year-to-date line only.",
      "A note whose month equals its year to date is refused rather than stored, because that was once a real error on this site.",
    ],
  },
  cfets: {
    title: "The trading system's own fixings",
    publisher: "China Foreign Exchange Trade System",
    reads: "The daily fixings and closes: the yuan central parity, the CFETS currency baskets, the interbank money-market rates, and government bond yields.",
    how: "One request per month returns every trading day; the month's last fixing is stored, with a monthly average beside it.",
    revisions: "A fixing is not revised.",
    caveats: [
      "The site stores the month's last fixing and its average, not the daily series; the store has no daily frame yet.",
      "The DR weighted averages are on no endpoint the site reaches, so the repo fixing is served under its own name rather than in their place.",
    ],
  },
  eastmoney: {
    title: "A mirror, where the publisher's own page is not reachable",
    publisher: "The agency named on each series; the figures reach the site through Eastmoney's copy",
    reads: "Eastmoney's economic data tables, for series whose publisher does not answer a request from outside China or publishes only as an image or a PDF.",
    how: "The mirror's data endpoint is read. Where the publisher's own release is also reachable, the publisher's reading is what the site serves and the mirror's is kept only as an independent reading for the audit.",
    revisions: "A mirror carries the publisher's revision when it re-copies, which can be later than the publisher's own release.",
    caveats: [
      "A figure on this path is attributed to the agency that compiled it, never to the mirror, but it has passed through a third party.",
      "The mirror's copy of Customs' export growth trails the administration's own by a tenth or two in revised months, which is why that pair's tolerance is a revision's size.",
    ],
  },
  fred: {
    title: "Comparisons from FRED",
    publisher: "The original publisher named on each series; the figures are redistributed by the Federal Reserve Bank of St. Louis",
    reads: "Series about China held by other institutions: the World Bank's development indicators, the Bank for International Settlements' credit and exchange rate measures, the OECD's leading indicators, and United States figures that bear on China.",
    how: "FRED's API, one series at a time.",
    revisions: "Each original publisher revises on its own schedule; FRED carries the revision when the publisher issues it.",
    caveats: [
      "These are not Chinese official statistics and are not presented as them; they are comparisons and international estimates.",
      "An annual World Bank series can lag the domestic ones by a year or more.",
    ],
  },
  aktools: {
    title: "Series that need a bridge inside China",
    publisher: "The agency or firm named on each series",
    reads: "High-frequency series available through AkShare: the Caixin surveys and daily commodity and freight measures.",
    how: "Through an AKTools bridge, which the deployment does not currently have. These series are listed and not refreshed.",
    revisions: "Not applicable while the path is unavailable.",
    caveats: [
      "These series do not refresh on the live site today; the catalog says so rather than showing a stale figure as current.",
    ],
  },
};

/** What the site knows about one series, beyond its numbers. */
export interface KeyMethodology {
  key: string;
  title: string;
  agency: string;
  /** The section in SOURCE_METHODOLOGY this key's figures come through. */
  source: string;
  frequency: string;
  unit: string;
  /** How the figure is cross-checked: the audit pair's name, or the recorded reason there is none. */
  check: { kind: "pair"; names: string[] } | { kind: "none"; reason: string } | { kind: "foreign" };
  /** Things true of this series in particular, read from the catalog rather than written by hand. */
  caveats: string[];
}

/** The agencies whose figures are not Chinese official statistics; they are compared, not audited. */
const FOREIGN = /^(Federal Reserve|Bank for International|International Monetary|OECD|Baker|US |Nasdaq|World Bank)/;

function sideKeys(pair: (typeof CONCORDANCE_PAIRS)[number]): SeriesRef[] {
  if (pair.kind === "value") return [pair.left, pair.right];
  if (pair.kind === "annual") return [pair.monthly, pair.annual];
  if (pair.kind === "components") return [...pair.parts, pair.total];
  return [pair.period, pair.yearToDate];
}

/** Every pair that reads a given key, by name. */
function pairsFor(key: string): string[] {
  return CONCORDANCE_PAIRS.filter((pair) => sideKeys(pair).some((side) => side.key === key)).map((pair) => pair.name);
}

/**
 * The methodology of one curated key. The caveats are derived: a cumulative
 * unit says so, an ended series says when and why, a mirror says it is one.
 */
export function methodologyFor(key: string, entry?: CatalogEntry): KeyMethodology | undefined {
  const config = CATALOG[key];
  if (!config) return undefined;
  const source = config.kind;
  const caveats: string[] = [];
  if (/cumulative|year to date/i.test(config.unit)) {
    caveats.push("Cumulative from the start of the year: each figure covers the year so far, not the period alone.");
  }
  if (source === "eastmoney") {
    caveats.push("Reaches the site through a mirror rather than the publisher's own page.");
  }
  const ended = Reflect.get(config, "ended");
  if (typeof ended === "string") {
    const why = Reflect.get(config, "endedNote");
    caveats.push(`The publisher stopped this series after ${ended}${typeof why === "string" && why ? `: ${why}` : "."}`);
  }
  if (source === "nbs" && config.frequency === "Monthly") {
    caveats.push("No January figure: the bureau publishes January and February together.");
  }
  const names = pairsFor(key);
  const check: KeyMethodology["check"] =
    names.length > 0 ? { kind: "pair", names }
    : FOREIGN.test(config.agency) ? { kind: "foreign" }
    : { kind: "none", reason: NO_PAIR[key] ?? "No reason recorded." };
  return {
    key,
    title: entry?.title ?? config.title,
    agency: config.agency,
    source,
    frequency: config.frequency,
    unit: config.unit,
    check,
    caveats,
  };
}

/** How the site itself handles what it stores: the part no publisher can state. */
export const SITE_METHODOLOGY = {
  storage: "The store is append-only. A fetch never overwrites a figure: it adds a reading with the time it was fetched, so every value the site has ever served for a period stays readable and a revision is visible as a revision.",
  audit: "Every curated headline is compared with an independent reading of the same statistic — another table, another publisher, or the publisher's own year-to-date companion — and the comparison runs on the live store rather than on a fixture. A series with no independent reading carries a written reason instead.",
  attribution: "A figure is attributed to the agency that compiled it, never to a mirror that carried it, and the path it took is named in the section above.",
  derivation: "Nothing here is derived from another figure unless the page says so. A missing month stays missing; a cumulative figure stays cumulative and says so in its label.",
} as const;

/** The whole document: the paths, the site's own handling, and a section per curated key. */
export function methodology(entries?: CatalogEntry[]): {
  sources: (SourceMethodology & { id: string; keys: string[] })[];
  site: typeof SITE_METHODOLOGY;
  keys: KeyMethodology[];
} {
  const byEntry = new Map((entries ?? []).map((entry) => [entry.key, entry]));
  const keys = Object.keys(CATALOG)
    .map((key) => methodologyFor(key, byEntry.get(key)))
    .filter((item): item is KeyMethodology => item !== undefined);
  const sources = Object.entries(SOURCE_METHODOLOGY)
    .map(([id, section]) => ({ ...section, id, keys: keys.filter((item) => item.source === id).map((item) => item.key) }))
    .filter((section) => section.keys.length > 0);
  return { sources, site: SITE_METHODOLOGY, keys };
}
