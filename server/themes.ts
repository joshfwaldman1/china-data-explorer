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
/** A theme's lede may be empty: a page that needs no introduction gets none. */
export interface Theme { title: string; lede: string; sections: ThemeSection[] }

/** Output levels from the bureau's monthly table, by catalog id; the growth rates are curated keys. */
const OUTPUT = {
  nev: "nbs_69dea360563d42f39881a070de56dbee",
  autos: "nbs_043652ba8bf34fd59c1092facd0c60d4",
  solar: "nbs_97951619231f4be6bee905d904d30bc2",
  robots: "nbs_b8b61050c1ea400189696189b74cfc82",
  ships: "nbs_ac26aa2ef2ea4c659cc59ebbdbeaa187",
} as const;


/** The month-on-a-year-earlier output growth lines, by product. */
const MONTH_GROWTH = { nev: "New energy vehicles, month (YoY %)", autos: "Automobiles, month (YoY %)", ics: "Integrated circuits, month (YoY %)", steel: "Crude steel, month (YoY %)", cement: "Cement, month (YoY %)" } as const;

const MANUFACTURING: Theme = {
  title: "Manufacturing",
  lede: "The bureau's monthly reading of the factory sector: output, the purchasing managers' survey, capacity in use, profits and investment; then the sectors and the products, as growth rates and as counts of what was made.",
  sections: [
    {
      title: "Output, orders and capacity",
      charts: [
        { title: "Industrial production, growth on a year earlier", key: "industrial_production", years: 10, note: "Value added of industrial enterprises above the size threshold, growth on a year earlier." },
        { title: "Manufacturing value added, growth on a year earlier", key: "industrial_output_by_division", labels: ["Manufacturing (YoY %)"], years: 6 },
        { title: "Manufacturing PMI: headline, new orders and new export orders", key: "pmi_manufacturing", labels: ["Manufacturing PMI", "New orders", "New export orders"], years: 6, note: "Diffusion indices; 50 is no change on the month." },
        { title: "Manufacturing capacity utilisation", key: "capacity_utilisation", labels: ["Manufacturing, quarter (%)"], years: 8 },
      ],
    },
    {
      title: "Profits, prices and investment",
      charts: [
        { title: "Manufacturing profits, year-to-date growth", key: "industrial_profits", labels: ["Manufacturing, year to date (YoY %)"], years: 8, note: "The 2021 spike is measured against the shutdown months of 2020." },
        { title: "Manufacturing investment, year-to-date growth", key: "fai_by_industry", labels: ["Manufacturing, year to date (YoY %)"], years: 8 },
        { title: "Producer prices, growth on a year earlier: producer goods and consumer goods", key: "ppi_detail", labels: ["Producer goods (YoY %)", "Consumer goods (YoY %)"], years: 10 },
        { title: "Manufacturing PMI: output prices and input prices", key: "pmi_manufacturing", labels: ["Input prices", "Output prices"], years: 6, note: "Diffusion indices; above 50 is more firms reporting a rise than a fall." },
      ],
    },
    {
      title: "By sector",
      lede: "Value added by sector, growth on a year earlier.",
      charts: [
        { title: "Value added, growth on a year earlier: automobiles and electronics", key: "industrial_output_by_sector", labels: ["Manufacture of Automobiles (YoY %)", "Manufacture of Computers, Communication Equipment, and Other Electronic Equipment (YoY %)"], years: 6 },
        { title: "Value added, growth on a year earlier: electrical machinery and ferrous metals", key: "industrial_output_by_sector", labels: ["Manufacture of Electrical Machinery and Equipment (YoY %)", "Smelting and Pressing of Ferrous Metals (YoY %)"], years: 6 },
        { title: "Electricity used by industry, growth on a year earlier", key: "electricity_demand_growth", labels: ["Secondary industry, month (YoY %)"], years: 8, note: "Electricity consumed by the secondary sector, from the energy administration." },
      ],
    },
    {
      title: "Output by product, growth",
      lede: "The month against the same month a year earlier. No January is published; January and February come together.",
      charts: [
        { title: "New energy vehicle output, growth on a year earlier", key: "output_nev", labels: [MONTH_GROWTH.nev], years: 4 },
        { title: "Automobile output, growth on a year earlier", key: "output_autos", labels: [MONTH_GROWTH.autos], years: 10 },
        { title: "Integrated circuit output, growth on a year earlier", key: "output_ics", labels: [MONTH_GROWTH.ics], years: 10 },
        { title: "Crude steel output, growth on a year earlier", key: "output_crude_steel", labels: [MONTH_GROWTH.steel], years: 10 },
        { title: "Cement output, growth on a year earlier", key: "output_cement", labels: [MONTH_GROWTH.cement], years: 10 },
      ],
    },
    {
      title: "Output by product, levels",
      lede: "Monthly counts from the bureau's output table.",
      charts: [
        { title: "New energy vehicles made (10,000)", key: OUTPUT.nev, years: 4 },
        { title: "Automobiles made (10,000)", key: OUTPUT.autos, years: 10 },
        { title: "Solar cells made (10,000 kW)", key: OUTPUT.solar, years: 10 },
        { title: "Industrial robots made (sets)", key: OUTPUT.robots, years: 10 },
        { title: "Civil ships made (10,000 DWT)", key: OUTPUT.ships, years: 10 },
      ],
    },
  ],
};

const PROPERTY: Theme = {
  title: "Property and local government finance",
  lede: "The developers' side from the bureau's monthly table: investment, sales, starts and completions, the money they raise; prices across seventy cities; and the public side that depends on land, from the finance ministry.",
  sections: [
    {
      title: "Activity",
      lede: "Year to date, growth on a year earlier.",
      charts: [
        { title: "Real estate investment, year-to-date growth", key: "property_investment", years: 10 },
        { title: "Floor space sold, year-to-date growth", key: "property_sales", years: 10 },
        { title: "Housing starts and completions, year-to-date growth", key: "property_construction", labels: ["Floor space started, year to date (YoY %)", "Floor space completed, year to date (YoY %)"], years: 10 },
      ],
    },
    {
      title: "Prices",
      charts: [
        { title: "Home prices, 70-city average, change on a year earlier", key: "house_prices", years: 10, note: "The simple average of the bureau's seventy city indices, new and existing homes, on a year earlier." },
        { title: "Real residential prices", key: "house_prices_real_bis", years: 20, note: "Inflation-adjusted." },
        { title: "Real estate climate index", key: "real_estate", years: 10 },
      ],
    },
    {
      title: "Money",
      charts: [
        { title: "New home sales value, year to date", key: "property_sales_value", years: 10, note: "The running total restarts each January; the drop from December is the reset, not a fall." },
        { title: "Developers' funds raised, year-to-date growth", key: "property_funds", years: 10 },
        { title: "Land sale revenue, year to date", key: "land_sale_revenue", years: 10, note: "The running total restarts each January; the drop from December is the reset, not a fall. The government-fund budget's largest line, and the one local governments lean on." },
        { title: "Land sale revenue, year-to-date growth", key: "fiscal_growth", labels: ["Land sale revenue, year to date (YoY %)"], years: 10 },
      ],
    },
    {
      title: "Local government bonds",
      charts: [
        { title: "Local government bonds issued in the month", key: "lgb_issuance", labels: ["Bonds issued in the month, total", "Special bonds issued in the month"], years: 8 },
        { title: "Local government debt outstanding", key: "lgb_debt", labels: ["Debt outstanding, end of month, total"], years: 8 },
        { title: "Local government bond issuance rate, monthly average", key: "lgb_rate", years: 8 },
      ],
    },
  ],
};

const EQUITIES: Theme = {
  title: "Equities",
  lede: "",
  sections: [
    {
      title: "Shanghai",
      charts: [
        { title: "SSE Composite, month-end close", key: "sse_composite", years: 15 },
        { title: "Shanghai Stock Exchange turnover, month", key: "sse_turnover", years: 15, note: "Value of every share traded in Shanghai over the month, 100 million yuan; 300,000 is 30 trillion." },
        { title: "SSE 50, month-end close", key: "sse_50", years: 15 },
        { title: "STAR 50, month-end close", key: "star_50", years: 6 },
      ],
    },
    {
      title: "Offshore",
      charts: [
        { title: "NASDAQ Golden Dragon China, monthly average", key: "golden_dragon", years: 10, note: "US-listed Chinese companies." },
      ],
    },
    {
      title: "Policy uncertainty",
      lede: "Both indices count articles in mainland Chinese newspapers; they are China's own, not the US index.",
      charts: [
        { title: "Economic policy uncertainty index", key: "epu", years: 10 },
        { title: "Trade policy uncertainty index", key: "tpu", years: 10 },
      ],
    },
  ],
};

const ENERGY: Theme = {
  title: "Energy",
  lede: "Generation and what it comes from, consumption and who uses it, from the bureau and the energy administration; coal, oil and gas at home; and the fuel bought abroad, from Customs.",
  sections: [
    {
      title: "Electricity",
      charts: [
        { title: "Electricity generation, growth on a year earlier", key: "electricity_output", years: 10 },
        { title: "Thermal and hydro generation, month", key: "electricity_by_source", labels: ["Thermal, month (亿千瓦时)", "Hydro, month (亿千瓦时)"], years: 8 },
        { title: "Wind, solar and nuclear generation, month", key: "electricity_by_source", labels: ["Wind, month (亿千瓦时)", "Solar, month (亿千瓦时)", "Nuclear, month (亿千瓦时)"], years: 8, note: "Rooftop solar is not in the bureau's generation table." },
        { title: "Electricity generation by source, growth on a year earlier", key: "electricity_by_source_growth", labels: ["Thermal (YoY %)", "Wind (YoY %)", "Solar (YoY %)"], years: 8 },
        { title: "Electricity consumption, month", key: "electricity_demand", labels: ["All users, month"], years: 8 },
        { title: "Electricity consumption by user, growth on a year earlier", key: "electricity_demand_growth", labels: ["All users, month (YoY %)", "Secondary industry, month (YoY %)", "Households, month (YoY %)"], years: 8 },
      ],
    },
    {
      title: "Coal, oil and gas at home",
      charts: [
        { title: "Raw coal output, month", key: "fuel_output", labels: ["Raw coal, month (10,000 tonnes)"], years: 10 },
        { title: "Crude oil output, month", key: "fuel_output", labels: ["Crude oil, month (10,000 tonnes)"], years: 10 },
        { title: "Natural gas output, month", key: "natural_gas_output", labels: ["Natural gas, month (亿立方米)"], years: 10 },
        { title: "Coal, oil and gas output, growth on a year earlier", key: "fuel_output_growth", years: 10 },
      ],
    },
    {
      title: "Fuel bought abroad",
      lede: "USD million per month, from Customs' commodity table; the price index is the commerce ministry's.",
      charts: [
        { title: "Crude oil imports, monthly value", key: "major_imports", region: "crude-petroleum-oils", labels: ["Value"], years: 8 },
        { title: "Natural gas imports, monthly value", key: "major_imports", region: "natural-gases", labels: ["Value"], years: 8 },
        { title: "Coal imports, monthly value", key: "major_imports", region: "coal-and-lignite", labels: ["Value"], years: 8 },
        { title: "Energy commodity price index", key: "commodity_prices", labels: ["Energy"], years: 10 },
      ],
    },
    {
      title: "Solar cells and electric vehicles made",
      charts: [
        { title: "Solar cells made (10,000 kW)", key: OUTPUT.solar, years: 10 },
        { title: "New energy vehicles made (10,000)", key: OUTPUT.nev, years: 4 },
      ],
    },
  ],
};

const DEMOGRAPHICS: Theme = {
  title: "Demographics",
  lede: "The bureau's annual population tables, the World Bank's long series where the bureau's are short, and the labour market the population feeds.",
  sections: [
    {
      title: "Population",
      lede: "Annual, year end.",
      charts: [
        { title: "Population, year end", key: "population_nbs", labels: ["Total, year end (10,000 persons)"], years: 30 },
        { title: "Urban and rural population, year end", key: "population_nbs", labels: ["Urban (10,000 persons)", "Rural (10,000 persons)"], years: 30 },
        { title: "Birth, death and natural growth rates", key: "population_rates", years: 30, note: "Natural growth is births less deaths; migration is not in it." },
        { title: "Population by age group, year end", key: "population_age", years: 30 },
        { title: "Population share aged 65 and over", key: "population_65", years: 40 },
        { title: "Fertility rate", key: "fertility", years: 40 },
        { title: "Life expectancy", key: "life_expectancy", years: 40 },
      ],
    },
  ],
};

const LABOUR: Theme = {
  title: "Labour market",
  lede: "",
  sections: [
    {
      title: "Unemployment",
      charts: [
        { title: "Surveyed urban unemployment rate", key: "unemployment", labels: ["Surveyed urban (%)"], years: 8 },
        { title: "Unemployment rate, ages 16 to 24", key: "unemployment", labels: ["Youth 16-24, ex-students (%)"], years: 8, note: "Redefined in December 2023 to exclude students; the bureau published no figure from August to November 2023." },
        { title: "Unemployment rate, ages 25 to 29 and 30 to 59", key: "unemployment", labels: ["Age 25-29, ex-students (%)", "Age 30-59, ex-students (%)"], years: 8 },
        { title: "Unemployment rate, 31 major cities", key: "unemployment", labels: ["31 major cities (%)"], years: 8 },
        { title: "Unemployment rate by hukou, local and non-local", key: "unemployment", labels: ["Local hukou (%)", "Non-local hukou (%)"], years: 8 },
      ],
    },
    {
      title: "Work",
      charts: [
        { title: "Average weekly hours worked", key: "working_hours", years: 8 },
        { title: "Employed persons, year end", key: "employment", years: 30 },
        { title: "Rural migrant workers away from home", key: "migrant_workers", years: 8, note: "Quarter end, 10,000 persons." },
        { title: "Migrant workers' monthly income", key: "migrant_workers_income", years: 8 },
        { title: "Manufacturing PMI: employment index", key: "pmi_manufacturing", labels: ["Employment"], years: 8, note: "Diffusion index; below 50 is more firms shedding than hiring." },
      ],
    },
    {
      title: "Income",
      charts: [
        { title: "Household disposable income, year-to-date growth", key: "household_income_growth", years: 8 },
        { title: "Household disposable income per person, year to date", key: "household_income", years: 8, note: "The running total restarts each January; the drop from Q4 to Q1 is the reset, not a fall." },
        { title: "Gini index", key: "gini", years: 30 },
      ],
    },
  ],
};

export const THEMES: Record<string, Theme> = {
  trade: {
    title: "Trade and capital flows",
    lede: "Exports and imports by partner and by commodity, from Customs' own tables; the manufacturing behind them, from the bureau's; where the quarter's growth came from; and the money that crosses the border, from the exchange regulator, the central bank and the US Treasury. Every chart reads the store and opens on the series it draws.",
    sections: [
      {
        title: "Totals and where growth comes from",
        charts: [
          { title: "Exports and imports, month", key: "trade_values", labels: ["Exports", "Imports"], years: 10, note: "January and February are published together." },
          { title: "Exports and imports, growth on a year earlier", key: "trade", labels: ["Exports (YoY %)", "Imports (YoY %)"], years: 10, note: "Customs' own rates from its monthly totals table." },
          { title: "Trade balance, month", key: "trade_values", labels: ["Balance"], years: 10 },
          { title: "Contributions to quarterly GDP growth, by expenditure", key: "gdp_contributions", years: 8, note: "Shares of the quarter's growth; the three sum to 100." },
        ],
      },
      {
        title: "By partner",
        lede: "Exports and imports with each partner, USD million per month.",
        charts: [
          { title: "Exports to and imports from the United States", key: "trade_partners", region: "united-states", labels: ["Exports", "Imports"], years: 8 },
          { title: "Exports to and imports from the European Union", key: "trade_partners", region: "european-union", labels: ["Exports", "Imports"], years: 8 },
          { title: "Exports to and imports from ASEAN", key: "trade_partners", region: "asean", labels: ["Exports", "Imports"], years: 8 },
          { title: "Exports to and imports from Japan", key: "trade_partners", region: "japan", labels: ["Exports", "Imports"], years: 8 },
          { title: "Exports to and imports from South Korea", key: "trade_partners", region: "r-o-korea", labels: ["Exports", "Imports"], years: 8 },
          { title: "Exports to and imports from Russia", key: "trade_partners", region: "russian-federation", labels: ["Exports", "Imports"], years: 8 },
        ],
      },
      {
        title: "Major exports, by value",
        lede: "USD million per month, from Customs' commodity table.",
        charts: [
          { title: "Hi-tech product exports, monthly value", key: "major_exports", region: "hi-tech-products", labels: ["Value"], years: 8 },
          { title: "Mobile phone exports, monthly value", key: "major_exports", region: "mobile-phones", labels: ["Value"], years: 8 },
          { title: "Motor vehicle exports, monthly value", key: "major_exports", region: "motor-vehicles-including-chassis-fitted-with-engines", labels: ["Value"], years: 8 },
          { title: "Integrated circuit exports, monthly value", key: "major_exports", region: "electronic-integrated-circuits", labels: ["Value"], years: 8, note: "Customs added this line recently; the history is short." },
          { title: "Ship exports, monthly value", key: "major_exports", region: "ships", labels: ["Value"], years: 8 },
        ],
      },
      {
        title: "Manufacturing",
        lede: "Growth on a year earlier unless the line says otherwise.",
        charts: [
          { title: "Industrial production, growth on a year earlier", key: "industrial_production", years: 10 },
          { title: "Manufacturing value added, growth on a year earlier", key: "industrial_output_by_division", labels: ["Manufacturing (YoY %)"], years: 6 },
          { title: "New energy vehicle output, growth on a year earlier", key: "output_nev", labels: ["New energy vehicles, month (YoY %)"], years: 4 },
          { title: "Automobile output, growth on a year earlier", key: "output_autos", labels: ["Automobiles, month (YoY %)"], years: 10 },
          { title: "Integrated circuit output, growth on a year earlier", key: "output_ics", labels: ["Integrated circuits, month (YoY %)"], years: 10 },
          { title: "Crude steel output, growth on a year earlier", key: "output_crude_steel", labels: ["Crude steel, month (YoY %)"], years: 10 },
          { title: "Producer prices, growth on a year earlier: producer goods and consumer goods", key: "ppi_detail", labels: ["Producer goods (YoY %)", "Consumer goods (YoY %)"], years: 10, note: "Producer goods rising while consumer goods fall is the pattern of a sector selling volume, not price." },
          { title: "Manufacturing capacity utilisation", key: "capacity_utilisation", labels: ["Manufacturing, quarter (%)"], years: 6 },
          { title: "Manufacturing profits, year-to-date growth", key: "industrial_profits", labels: ["Manufacturing, year to date (YoY %)"], years: 8, note: "The 2021 spike is measured against the shutdown months of 2020." },
          { title: "Manufacturing investment, year-to-date growth", key: "fai_by_industry", labels: ["Manufacturing, year to date (YoY %)"], years: 8 },
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
      {
        title: "Capital flows",
        lede: "The balance of payments from the exchange regulator, quarterly; banks' cross-border receipts and payments and FX settlement, monthly; foreign direct investment from the commerce ministry; and the reserves and the yuan.",
        charts: [
          { title: "Balance of payments: current account and financial account", key: "balance_of_payments", labels: ["Current account", "Financial account excluding reserves"], years: 10, note: "A financial-account deficit is money leaving; the two offset in principle, with errors and omissions between them." },
          { title: "Balance of payments: financial account by kind", key: "balance_of_payments", labels: ["Direct investment", "Portfolio investment", "Other investment"], years: 10 },
          { title: "Banks' cross-border receipts and payments, net", key: "cross_border_flows_usd", labels: ["Net receipts", "Net, capital and financial account"], years: 8, note: "Settlement data: what crossed banks' books in the month, before the balance of payments is compiled." },
          { title: "Banks' FX settlement, net", key: "bank_fx_settlement_usd", labels: ["Net settlement"], years: 8, note: "Net sales of foreign currency to banks by their customers. Negative is customers buying dollars." },
          { title: "Foreign direct investment, actual use, year to date", key: "fdi_actual_use", labels: ["Actual use of foreign investment, year to date"], years: 8, note: "The running total restarts each January. The commerce ministry stopped its dollar series in 2023." },
          { title: "Foreign direct investment, year-to-date growth", key: "fdi_growth", labels: ["Actual use of foreign investment, year to date (YoY %)"], years: 8 },
          { title: "Foreign exchange reserves", key: "forex_reserves", years: 15 },
          { title: "Holdings of US Treasuries", key: "us_treasury_holdings", years: 15, note: "The Treasury's own survey of foreign holders; custodial holdings in Belgium and elsewhere are not counted as China's." },
          { title: "Yuan per dollar, central parity", key: "central_parity", labels: ["USD/CNY"], years: 10, note: "Up is a weaker yuan." },
          { title: "CFETS yuan index", key: "cfets_rmb_index", labels: ["CFETS basket"], years: 10, note: "The yuan against a trade-weighted basket; up is stronger." },
        ],
      },
    ],
  },
  manufacturing: MANUFACTURING,
  property: PROPERTY,
  equities: EQUITIES,
  energy: ENERGY,
  demographics: DEMOGRAPHICS,
  labour: LABOUR,
};

/** The pages in the order the owner named them; Home and Provinces are not themes but sit in the same strip. */
export const THEME_ORDER = ["manufacturing", "property", "trade", "equities", "energy", "demographics", "labour"] as const;

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
