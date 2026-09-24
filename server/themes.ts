/**
 * Theme pages: one story told with the series the site already holds.
 *
 * The series page shows one series; the Home page shows the latest figure
 * of many. Neither answers "show me trade": the partners side by side, the
 * commodities, the factories behind the exports, and where growth is coming
 * from, all as charts on one page. A theme is that: a fixed list of charts,
 * each naming a series the site holds, a region of it where it has one, and
 * the lines of it to draw. The page reads them from the store and draws each
 * with the same chart the series page uses, so nothing here fetches and
 * nothing is drawn differently from the rest of the site.
 *
 * A theme is definition, not data. Every key, region and line it names is
 * held to the catalog by a test, so a chart that names a line the table does
 * not have fails the build rather than drawing an empty panel.
 */

import { CATALOG, configuredLabels, seriesRegion, seriesRegions, type NbsRegion, type SeriesResult } from "./data";
import { readSeries } from "./db";

export interface ThemeChart {
  /** The panel's heading; the series title when omitted. */
  title?: string;
  key: string;
  /** A place or partner of a regional series; the national figure of a catalog series when omitted. */
  region?: string;
  /** The lines to draw; every line of the series when omitted. */
  labels?: string[];
  /** How many years the panel opens on. */
  years?: number;
  /** A sentence under the chart: what the reader should know before quoting it. */
  note?: string;
}

export interface ThemeSection { title: string; lede?: string; charts: ThemeChart[] }
export interface Theme { title: string; lede: string; sections: ThemeSection[] }

/** Output levels from the bureau's monthly table, by catalog id; the growth rates are curated keys. */
const OUTPUT = {
  nev: "nbs_69dea360563d42f39881a070de56dbee",
  autos: "nbs_043652ba8bf34fd59c1092facd0c60d4",
  solar: "nbs_97951619231f4be6bee905d904d30bc2",
  robots: "nbs_b8b61050c1ea400189696189b74cfc82",
  ships: "nbs_ac26aa2ef2ea4c659cc59ebbdbeaa187",
} as const;

export const THEMES: Record<string, Theme> = {
  trade: {
    title: "Trade",
    lede: "Exports and imports by partner and by commodity, from Customs' own tables; the manufacturing behind them, from the bureau's; and where the quarter's growth came from. Every chart reads the store and opens on the series it draws.",
    sections: [
      {
        title: "Headline",
        charts: [
          { title: "Exports and imports, growth on a year earlier", key: "trade", labels: ["Exports (YoY %)", "Imports (YoY %)"], years: 10, note: "Customs' own rates from its monthly totals table. January and February are published together." },
          { title: "Where growth comes from", key: "gdp_contributions", years: 8, note: "Shares of the quarter's GDP growth. The three sum to 100 percent by identity, which the audit holds." },
        ],
      },
      {
        title: "By partner",
        lede: "Exports and imports with each partner, USD million per month.",
        charts: [
          { title: "United States", key: "trade_partners", region: "united-states", labels: ["Exports", "Imports"], years: 8 },
          { title: "European Union", key: "trade_partners", region: "european-union", labels: ["Exports", "Imports"], years: 8 },
          { title: "ASEAN", key: "trade_partners", region: "asean", labels: ["Exports", "Imports"], years: 8 },
          { title: "Japan", key: "trade_partners", region: "japan", labels: ["Exports", "Imports"], years: 8 },
          { title: "South Korea", key: "trade_partners", region: "r-o-korea", labels: ["Exports", "Imports"], years: 8 },
          { title: "Russia", key: "trade_partners", region: "russian-federation", labels: ["Exports", "Imports"], years: 8 },
        ],
      },
      {
        title: "Major exports, by value",
        lede: "USD million per month, from Customs' commodity table.",
        charts: [
          { title: "Hi-tech products", key: "major_exports", region: "hi-tech-products", labels: ["Value"], years: 8 },
          { title: "Mobile phones", key: "major_exports", region: "mobile-phones", labels: ["Value"], years: 8 },
          { title: "Motor vehicles", key: "major_exports", region: "motor-vehicles-including-chassis-fitted-with-engines", labels: ["Value"], years: 8 },
          { title: "Integrated circuits", key: "major_exports", region: "electronic-integrated-circuits", labels: ["Value"], years: 8, note: "Customs added this line recently; the history is short." },
          { title: "Ships", key: "major_exports", region: "ships", labels: ["Value"], years: 8 },
        ],
      },
      {
        title: "Manufacturing",
        lede: "Growth on a year earlier unless the line says otherwise.",
        charts: [
          { title: "Industrial production", key: "industrial_production", years: 10 },
          { title: "Manufacturing output", key: "industrial_output_by_division", labels: ["Manufacturing (YoY %)"], years: 6 },
          { title: "New energy vehicles and automobiles, output", key: "output_nev", labels: ["New energy vehicles, month (YoY %)"], years: 4 },
          { title: "Automobile output", key: "output_autos", labels: ["Automobiles, month (YoY %)"], years: 10 },
          { title: "Integrated circuit output", key: "output_ics", labels: ["Integrated circuits, month (YoY %)"], years: 10 },
          { title: "Crude steel output", key: "output_crude_steel", labels: ["Crude steel, month (YoY %)"], years: 10 },
          { title: "Producer prices", key: "ppi_detail", labels: ["Producer goods (YoY %)", "Consumer goods (YoY %)"], years: 10, note: "Producer goods rising while consumer goods fall is the pattern of a sector selling volume, not price." },
          { title: "Manufacturing capacity utilisation", key: "capacity_utilisation", labels: ["Manufacturing, quarter (%)"], years: 6 },
          { title: "Manufacturing profits, year to date", key: "industrial_profits", labels: ["Manufacturing, year to date (YoY %)"], years: 8 },
          { title: "Manufacturing investment, year to date", key: "fai_by_industry", labels: ["Manufacturing, year to date (YoY %)"], years: 8 },
        ],
      },
      {
        title: "Output by product",
        lede: "Monthly levels from the bureau's output table. No January is published; January and February come together.",
        charts: [
          { title: "New energy vehicles made (10,000)", key: OUTPUT.nev, years: 4 },
          { title: "Automobiles made (10,000)", key: OUTPUT.autos, years: 10 },
          { title: "Solar cells made (10,000 kW)", key: OUTPUT.solar, years: 10 },
          { title: "Industrial robots made (sets)", key: OUTPUT.robots, years: 10 },
          { title: "Civil ships made (10,000 DWT)", key: OUTPUT.ships, years: 10 },
        ],
      },
    ],
  },
};

export interface ThemeChartData extends ThemeChart {
  result: SeriesResult | null;
  /** The place or partner drawn, named for the page. */
  place?: NbsRegion;
}

export interface ThemeData { name: string; title: string; lede: string; sections: { title: string; lede?: string; charts: ThemeChartData[] }[] }

/** A monthly series needs twelve points a year; a quarterly one four. Read a little past the window so the first point is on it. */
function limitFor(key: string, years: number): number {
  const frequency = CATALOG[key]?.frequency ?? "Monthly";
  const perYear = frequency === "Quarterly" ? 4 : frequency === "Annual" ? 1 : 12;
  return perYear * (years + 1);
}

/** The theme's charts, each with its series read from the store. Null for a theme that does not exist. */
export function themeData(name: string): ThemeData | null {
  const theme = THEMES[name];
  if (!theme) return null;
  return {
    name, title: theme.title, lede: theme.lede,
    sections: theme.sections.map((section) => ({
      title: section.title, ...(section.lede ? { lede: section.lede } : {}),
      charts: section.charts.map((chart) => {
        // The region resolves as the series route resolves it: the one named, else the
        // series' default, else its first; a series without regions reads as stored.
        const regions = seriesRegions(chart.key);
        const requested = chart.region ?? seriesRegion(chart.key);
        const place = regions.length > 0 ? (regions.find((item) => item.value === requested) ?? regions[0]) : undefined;
        const stored = readSeries(chart.key, limitFor(chart.key, chart.years ?? 10), place?.value);
        const configured = configuredLabels(chart.key);
        const wanted = chart.labels ?? configured;
        const result = stored
          ? { ...stored, title: chart.title ?? stored.title, series: wanted ? stored.series.filter((line) => wanted.includes(line.label)) : stored.series }
          : null;
        return { ...chart, result, ...(place ? { place } : {}) };
      }),
    })),
  };
}

/** Every chart of every theme, for the test that holds them to the catalog. */
export function allThemeCharts(): { theme: string; chart: ThemeChart }[] {
  return Object.entries(THEMES).flatMap(([theme, definition]) => definition.sections.flatMap((section) => section.charts.map((chart) => ({ theme, chart }))));
}
