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
  lede: "The factory sector from the statistics bureau: output, the purchasing managers' survey, capacity use each quarter, profits, investment and prices, with industry's electricity use from the energy administration; then sectors and products, as growth rates and as monthly output.",
  sections: [
    {
      title: "Output, orders and capacity",
      charts: [
        { title: "Industrial production, growth on a year earlier", key: "industrial_production", years: 10, note: "Value added of industrial firms with annual revenue over 20 million yuan. The February point is January and February combined; there is no January point. The 2021 high is measured against the shutdown of early 2020." },
        { title: "Manufacturing value added, growth on a year earlier", key: "industrial_output_by_division", labels: ["Manufacturing (YoY %)"], years: 6, note: "There is no January or February point: the bureau publishes the two months only as a combined year-to-date figure. The March 2021 high is measured against the shutdown of early 2020." },
        { title: "Manufacturing PMI, with new orders and new export orders, month", key: "pmi_manufacturing", labels: ["Manufacturing PMI", "New orders", "New export orders"], years: 6, note: "Diffusion indices; 50 is no change on the month." },
        { title: "Manufacturing capacity utilisation, quarter", key: "capacity_utilisation", labels: ["Manufacturing, quarter (%)"], years: 6 },
        { title: "Electricity consumption, secondary industry, month on a year earlier", key: "electricity_demand_growth", labels: ["Secondary industry, month (YoY %)"], years: 5, note: "Secondary industry includes construction. The energy administration's month figures are missing for several months, and January and February usually come only as a combined year-to-date figure." },
      ],
    },
    {
      title: "Profits, prices and investment",
      charts: [
        { title: "Manufacturing profits, year-to-date growth", key: "industrial_profits", labels: ["Manufacturing, year to date (YoY %)"], years: 8, note: "The 2021 spike is measured against the shutdown months of 2020." },
        { title: "Manufacturing investment, year-to-date growth", key: "fai_by_industry", labels: ["Manufacturing, year to date (YoY %)"], years: 8, note: "Each year's first point covers January and February. The 2021 high is measured against the shutdown months of 2020." },
        { title: "Producer prices, producer goods and consumer goods, growth on a year earlier", key: "ppi_detail", labels: ["Producer goods (YoY %)", "Consumer goods (YoY %)"], years: 10 },
        { title: "Manufacturing PMI: output prices and input prices", key: "pmi_manufacturing", labels: ["Input prices", "Output prices"], years: 6, note: "Diffusion indices; above 50 is more firms reporting a rise than a fall." },
      ],
    },
    {
      title: "By sector",
      lede: "Industrial value added by sector, the month on a year earlier. There is no January or February point.",
      charts: [
        { title: "Industrial value added, automobiles and electronics, growth on a year earlier", key: "industrial_output_by_sector", labels: ["Manufacture of Automobiles (YoY %)", "Manufacture of Computers, Communication Equipment, and Other Electronic Equipment (YoY %)"], years: 6 },
        { title: "Industrial value added, electrical machinery and ferrous metals, growth on a year earlier", key: "industrial_output_by_sector", labels: ["Manufacture of Electrical Machinery and Equipment (YoY %)", "Smelting and Pressing of Ferrous Metals (YoY %)"], years: 6 },
      ],
    },
    {
      title: "Output by product, growth",
      lede: "The month against the same month a year earlier. There is no January or February point: the bureau publishes the two months only as a combined year-to-date figure.",
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
      lede: "Monthly output from the bureau's table. There is no January or February point: the bureau publishes the two months only as a combined total.",
      charts: [
        { title: "New energy vehicle output, month", key: OUTPUT.nev, years: 3 },
        { title: "Automobile output, month", key: OUTPUT.autos, years: 10 },
        { title: "Solar cell output, month", key: OUTPUT.solar, years: 10 },
        { title: "Industrial robot output, month", key: OUTPUT.robots, years: 10 },
        { title: "Civil ship output, month", key: OUTPUT.ships, years: 10 },
      ],
    },
  ],
};

const PROPERTY: Theme = {
  title: "Property and local government finance",
  lede: "Developers' investment, sales, construction and funding from the bureau's monthly table; home prices across seventy cities; and local governments' land revenue and bonds, from the finance ministry.",
  sections: [
    {
      title: "Activity",
      lede: "Year to date, growth on a year earlier. January and February are published together; there is no January point.",
      charts: [
        { title: "Real estate investment, total and residential, year-to-date growth", key: "property_investment", years: 10 },
        { title: "New building floor space sold, year-to-date growth", key: "property_sales", years: 10 },
        { title: "Floor space started and completed, year-to-date growth", key: "property_construction", labels: ["Floor space started, year to date (YoY %)", "Floor space completed, year to date (YoY %)"], years: 10 },
      ],
    },
    {
      title: "Prices",
      charts: [
        { title: "Home prices, 70-city average, change on a year earlier", key: "house_prices", years: 10, note: "The simple average of the bureau's seventy city indices, new and existing homes, on a year earlier." },
        { title: "Real residential property prices, quarter", key: "house_prices_real_bis", years: 20, note: "Bank for International Settlements series, deflated by consumer prices." },
        { title: "Real estate climate index, month", key: "real_estate", years: 10, note: "Last value December 2025; not refreshed since." },
      ],
    },
    {
      title: "Money",
      charts: [
        { title: "New building sales value, year to date", key: "property_sales_value", years: 10, note: "The running total restarts each January; the drop from December is the reset, not a fall." },
        { title: "Developers' funds raised, total and domestic loans, year-to-date growth", key: "property_funds", years: 10 },
        { title: "Land sale revenue, year to date", key: "land_sale_revenue", years: 2, note: "The running total restarts each January; the drop from December is the reset, not a fall. The government-fund budget's largest line, and the one local governments lean on." },
        { title: "Land sale revenue, year-to-date growth", key: "fiscal_growth", labels: ["Land sale revenue, year to date (YoY %)"], years: 2, note: "Monthly from 2025; the earlier history is a few points a year." },
      ],
    },
    {
      title: "Local government bonds",
      charts: [
        { title: "Local government bonds issued, total and special, month", key: "lgb_issuance", labels: ["Bonds issued in the month, total", "Special bonds issued in the month"], years: 2 },
        { title: "Local government debt outstanding, month-end", key: "lgb_debt", labels: ["Debt outstanding, end of month, total"], years: 2 },
        { title: "Local government bond issuance rate, monthly average", key: "lgb_rate", years: 2 },
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
        { title: "Shanghai Composite, month-end close", key: "sse_composite", years: 15 },
        { title: "Shanghai stock turnover, monthly total", key: "sse_turnover", years: 15, note: "Value of shares in the Shanghai Composite traded over the month; 300,000 is 30 trillion yuan." },
        { title: "Shanghai SSE 50 index, month-end close", key: "sse_50", years: 15 },
        { title: "Shanghai STAR 50 index, month-end close", key: "star_50", years: 7 },
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
      lede: "Both indices count uncertainty terms in two mainland newspapers, the People's Daily and the Guangming Daily; they are not the Baker, Bloom and Davis China index, which reads the South China Morning Post.",
      charts: [
        { title: "China economic policy uncertainty index, monthly", key: "epu", years: 10 },
        { title: "China trade policy uncertainty index, monthly", key: "tpu", years: 10 },
      ],
    },
  ],
};

const ENERGY: Theme = {
  title: "Energy",
  lede: "Electricity generation by source, from the statistics bureau, and consumption by user, from the energy administration; coal, crude oil and natural gas output; energy imports, from Customs; solar cell and new energy vehicle output.",
  sections: [
    {
      title: "Electricity",
      charts: [
        { title: "Electricity generation, growth on a year earlier", key: "electricity_output", years: 10, note: "Above-threshold industrial generators only (规上工业). February is January and February together." },
        { title: "Thermal and hydro generation, month", key: "electricity_by_source", labels: ["Thermal, month (亿千瓦时)", "Hydro, month (亿千瓦时)"], years: 8 },
        { title: "Wind, solar and nuclear generation, month", key: "electricity_by_source", labels: ["Wind, month (亿千瓦时)", "Solar, month (亿千瓦时)", "Nuclear, month (亿千瓦时)"], years: 8, note: "Above-threshold industrial generators only (规上工业); most distributed solar, rooftop included, is outside it." },
        { title: "Thermal, wind and solar generation, growth on a year earlier", key: "electricity_by_source_growth", labels: ["Thermal (YoY %)", "Wind (YoY %)", "Solar (YoY %)"], years: 8, note: "The bureau's rates, on a comparable set of enterprises; they run below growth worked out from the levels, most for solar (Aug 2026: 10.3% against 30%)." },
        { title: "Electricity consumption, month", key: "electricity_demand", labels: ["All users, month"], years: 5, note: "The administration gives no December figure; its annual release comes in January. No release was published for May 2026." },
        { title: "Electricity consumption by user, growth on a year earlier", key: "electricity_demand_growth", labels: ["All users, month (YoY %)", "Secondary industry, month (YoY %)", "Households, month (YoY %)"], years: 5, note: "The administration gives no December figure; its annual release comes in January. No release was published for May 2026." },
      ],
    },
    {
      title: "Coal, crude oil and natural gas output",
      charts: [
        { title: "Raw coal output, month", key: "fuel_output", labels: ["Raw coal, month (10,000 tonnes)"], years: 10 },
        { title: "Crude oil output, month", key: "fuel_output", labels: ["Crude oil, month (10,000 tonnes)"], years: 10 },
        { title: "Natural gas output, month", key: "natural_gas_output", labels: ["Natural gas, month (亿立方米)"], years: 10 },
        { title: "Coal, oil and gas output, growth on a year earlier", key: "fuel_output_growth", years: 10 },
      ],
    },
    {
      title: "Energy imports",
      lede: "Customs' major imports table, value in US dollars.",
      charts: [
        { title: "Crude oil imports, value, month", key: "major_imports", region: "crude-petroleum-oils", labels: ["Value"], years: 1, note: "Customs history on this site starts February 2026." },
        { title: "Natural gas imports, value, month", key: "major_imports", region: "natural-gases", labels: ["Value"], years: 1, note: "Customs history on this site starts February 2026." },
        { title: "Coal imports, value, month", key: "major_imports", region: "coal-and-lignite", labels: ["Value"], years: 8, note: "No January or February figure for 2021 to 2025, when Customs published only the two months combined." },
      ],
    },
    {
      title: "Energy prices",
      charts: [
        { title: "Commodity price index (CCPI), energy, month", key: "commodity_prices", labels: ["Energy"], years: 10, note: "The commerce ministry's domestic commodity price index, energy component." },
      ],
    },
    {
      title: "Solar cell and new energy vehicle output",
      lede: "There is no January or February point: the bureau publishes the two months only as a combined total.",
      charts: [
        { title: "Solar cell output, month", key: OUTPUT.solar, years: 10 },
        { title: "New energy vehicle output, month", key: OUTPUT.nev, years: 3 },
      ],
    },
  ],
};

const DEMOGRAPHICS: Theme = {
  title: "Demographics",
  lede: "The bureau's annual population tables, and UN estimates published by the World Bank for fertility, life expectancy and ageing, which the bureau does not publish every year.",
  sections: [
    {
      title: "Population",
      charts: [
        { title: "Population, year end", key: "population_nbs", labels: ["Total, year end (10,000 persons)"], years: 30 },
        { title: "Urban and rural population, year end", key: "population_nbs", labels: ["Urban (10,000 persons)", "Rural (10,000 persons)"], years: 30 },
        { title: "Birth, death and natural growth rates, year", key: "population_rates", years: 30, note: "Natural growth is births less deaths; migration is not in it." },
        { title: "Population by age group, year end", key: "population_age", years: 30, note: "Survey estimates reset to each census; the steps in 2000, 2010 and 2020 are census revisions, not births or deaths. For 2025 the bureau has published only the 65 and over count." },
        { title: "Population share aged 65 and over, mid-year estimate", key: "population_65", years: 40, note: "UN estimate published by the World Bank; the bureau's year-end counts give 15.9% for 2025." },
        { title: "Total fertility rate, year", key: "fertility", years: 40, note: "UN estimate published by the World Bank; the bureau publishes no annual total fertility rate." },
        { title: "Life expectancy at birth, year", key: "life_expectancy", years: 40, note: "UN estimate published by the World Bank; the National Health Commission puts 2024 at 79.0 years." },
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
        { title: "Surveyed urban unemployment rate, national, monthly", key: "unemployment", labels: ["Surveyed urban (%)"], years: 8 },
        { title: "Unemployment rate, ages 16 to 24, excluding students from December 2023, monthly", key: "unemployment", labels: ["Youth 16-24, ex-students (%)"], years: 8, note: "Students were included until June 2023. The bureau published no figure for July to November 2023 and resumed with December 2023 on a basis that excludes students; the two segments are not comparable." },
        { title: "Unemployment rate by age, 25 to 29 and 30 to 59, excluding students, monthly", key: "unemployment", labels: ["Age 25-29, ex-students (%)", "Age 30-59, ex-students (%)"], years: 8, note: "Published from December 2023." },
        { title: "Surveyed urban unemployment rate, 31 major cities, monthly", key: "unemployment", labels: ["31 major cities (%)"], years: 8 },
        { title: "Unemployment rate by hukou, local and non-local, monthly", key: "unemployment", labels: ["Local hukou (%)", "Non-local hukou (%)"], years: 8 },
      ],
    },
    {
      title: "Work",
      charts: [
        { title: "Average weekly hours worked, enterprise employees, monthly", key: "working_hours", years: 8 },
        { title: "Employed persons, total, urban and rural, year end", key: "employment", years: 30 },
        { title: "Rural migrant workers away from home, quarter end", key: "migrant_workers", years: 8, note: "No fourth-quarter reading; the annual migrant worker survey covers the year. The count falls each first quarter around the Lunar New Year." },
        { title: "Rural migrant workers away from home, average monthly income, nominal, quarterly", key: "migrant_workers_income", years: 8, note: "No fourth-quarter reading; the annual survey covers the year." },
        { title: "Manufacturing PMI: employment index, monthly", key: "pmi_manufacturing", labels: ["Employment"], years: 8, note: "Diffusion index; below 50 is more firms shedding than hiring." },
      ],
    },
    {
      title: "Income",
      charts: [
        { title: "Household disposable income per person, real growth on a year earlier, year to date, all residents, urban and rural", key: "household_income_growth", years: 8, note: "Growth after deducting price changes. Each quarter covers January to the quarter's end; Q4 is the full year." },
        { title: "Household disposable income per person, year to date", key: "household_income", years: 8, note: "The running total restarts each January; the drop from Q4 to Q1 is the reset, not a fall." },
        { title: "Gini index of income inequality, World Bank estimate, annual", key: "gini", years: 30, note: "Latest reading 2022. Readings before 2010 are every two or three years." },
      ],
    },
  ],
};

export const THEMES: Record<string, Theme> = {
  trade: {
    title: "Trade and capital flows",
    lede: "Exports and imports by partner and major exports by commodity, from Customs; the manufacturing behind them, from the statistics bureau; what drove each quarter's growth; and money crossing the border, from the exchange regulator, the central bank, the commerce ministry, CFETS and the US Treasury.",
    sections: [
      {
        title: "Totals and where growth comes from",
        charts: [
          { title: "Exports and imports, value per month", key: "trade_values", labels: ["Exports", "Imports"], years: 8, note: "Customs published only a combined January and February for 2020 to 2025; those months are left blank. February 2026 is a single month; January 2026 is not stored." },
          { title: "Exports and imports, growth on a year earlier, month", key: "trade", labels: ["Exports (YoY %)", "Imports (YoY %)"], years: 8, note: "Customs' own rates in USD terms. January and February were published only as a combined figure for 2020 to 2025. February 2026's 39.6% reflects the late Lunar New Year." },
          { title: "Trade balance, month", key: "trade_values", labels: ["Balance"], years: 8, note: "Customs published only a combined January and February for 2020 to 2025; those months are left blank." },
          { title: "Contributions to quarterly GDP growth, by expenditure", key: "gdp_contributions", years: 8, note: "Shares of the quarter's growth; the three sum to 100." },
        ],
      },
      {
        title: "Trade by partner",
        charts: [
          { title: "Exports to and imports from the United States, month", key: "trade_partners", region: "united-states", labels: ["Exports", "Imports"], years: 8, note: "No January or February figures for 2020 to 2025, when Customs published only the two months combined; June 2025 is missing." },
          { title: "Exports to and imports from the European Union, month", key: "trade_partners", region: "european-union", labels: ["Exports", "Imports"], years: 8, note: "No January or February figures for 2020 to 2025, when Customs published only the two months combined; June 2025 is missing." },
          { title: "Exports to and imports from ASEAN, month", key: "trade_partners", region: "asean", labels: ["Exports", "Imports"], years: 8, note: "No January or February figures for 2020 to 2025, when Customs published only the two months combined; June 2025 is missing." },
          { title: "Exports to and imports from Japan, month", key: "trade_partners", region: "japan", labels: ["Exports", "Imports"], years: 8, note: "No January or February figures for 2020 to 2025, when Customs published only the two months combined; June 2025 is missing." },
          { title: "Exports to and imports from South Korea, month", key: "trade_partners", region: "r-o-korea", labels: ["Exports", "Imports"], years: 8, note: "No January or February figures for 2020 to 2025, when Customs published only the two months combined; June 2025 is missing." },
          { title: "Exports to and imports from Russia, month", key: "trade_partners", region: "russian-federation", labels: ["Exports", "Imports"], years: 8, note: "No January or February figures for 2020 to 2025, when Customs published only the two months combined; June 2025 is missing." },
        ],
      },
      {
        title: "Major exports, by value",
        lede: "From Customs' commodity table.",
        charts: [
          { title: "Hi-tech product exports, value, month", key: "major_exports", region: "hi-tech-products", labels: ["Value"], years: 8, note: "No January or February figure for 2021 to 2025, when Customs published only the two months combined. Hi-tech products overlap other commodity lines." },
          { title: "Mobile phone exports, value, month", key: "major_exports", region: "mobile-phones", labels: ["Value"], years: 6, note: "No January or February figure for 2021 to 2025, when Customs published only the two months combined." },
          { title: "Motor vehicle exports, value, month", key: "major_exports", region: "motor-vehicles-including-chassis-fitted-with-engines", labels: ["Value"], years: 5, note: "No January or February figure for 2021 to 2025, when Customs published only the two months combined." },
          { title: "Integrated circuit exports, value, month", key: "major_exports", region: "electronic-integrated-circuits", labels: ["Value"], years: 1, note: "Customs added this line in 2026; January 2026 is not stored." },
          { title: "Ship exports, value, month", key: "major_exports", region: "ships", labels: ["Value"], years: 8, note: "No January or February figure for 2021 to 2025, when Customs published only the two months combined." },
        ],
      },
      {
        title: "Manufacturing",
        lede: "There is no January or February point on the monthly charts: the bureau publishes the two months only as a combined year-to-date figure.",
        charts: [
          { title: "Industrial production, growth on a year earlier", key: "industrial_production", years: 10, note: "Value added of industrial firms with annual revenue over 20 million yuan. The February point is January and February combined; there is no January point." },
          { title: "Manufacturing value added, growth on a year earlier", key: "industrial_output_by_division", labels: ["Manufacturing (YoY %)"], years: 6 },
          { title: "New energy vehicle output, growth on a year earlier", key: "output_nev", labels: ["New energy vehicles, month (YoY %)"], years: 4 },
          { title: "Automobile output, growth on a year earlier", key: "output_autos", labels: ["Automobiles, month (YoY %)"], years: 10 },
          { title: "Integrated circuit output, growth on a year earlier", key: "output_ics", labels: ["Integrated circuits, month (YoY %)"], years: 10 },
          { title: "Crude steel output, growth on a year earlier", key: "output_crude_steel", labels: ["Crude steel, month (YoY %)"], years: 10 },
          { title: "Producer prices, producer goods and consumer goods, growth on a year earlier", key: "ppi_detail", labels: ["Producer goods (YoY %)", "Consumer goods (YoY %)"], years: 10 },
          { title: "Manufacturing capacity utilisation, quarter", key: "capacity_utilisation", labels: ["Manufacturing, quarter (%)"], years: 6 },
          { title: "Manufacturing profits, year-to-date growth", key: "industrial_profits", labels: ["Manufacturing, year to date (YoY %)"], years: 8, note: "The 2021 spike is measured against the shutdown months of 2020." },
          { title: "Manufacturing investment, year-to-date growth", key: "fai_by_industry", labels: ["Manufacturing, year to date (YoY %)"], years: 8 },
        ],
      },
      {
        title: "Output by product",
        lede: "Monthly output from the bureau's table. There is no January or February point: the bureau publishes the two months only as a combined total.",
        charts: [
          { title: "New energy vehicle output, month", key: OUTPUT.nev, years: 3 },
          { title: "Automobile output, month", key: OUTPUT.autos, years: 10 },
          { title: "Solar cell output, month", key: OUTPUT.solar, years: 10 },
          { title: "Industrial robot output, month", key: OUTPUT.robots, years: 10 },
          { title: "Civil ship output, month", key: OUTPUT.ships, years: 10 },
        ],
      },
      {
        title: "Capital flows",
        lede: "The balance of payments from the exchange regulator, quarterly; banks' cross-border receipts and payments and FX settlement, monthly; foreign direct investment from the commerce ministry; and the reserves and the yuan.",
        charts: [
          { title: "Balance of payments: current account and financial account excluding reserves, quarter", key: "balance_of_payments", labels: ["Current account", "Financial account excluding reserves"], years: 10, note: "A financial-account deficit is money leaving. The current account, the financial account, reserve assets and errors and omissions sum to zero. The financial account for the latest quarter comes later than the current account." },
          { title: "Balance of payments: financial account by kind, quarter", key: "balance_of_payments", labels: ["Direct investment", "Portfolio investment", "Other investment"], years: 10 },
          { title: "Cross-border receipts and payments through banks for customers, net, month", key: "cross_border_flows_usd", labels: ["Net receipts", "Net, capital and financial account"], years: 8, note: "Settlement data: what crossed banks' books in the month, before the balance of payments is compiled." },
          { title: "Banks' FX settlement, net, month", key: "bank_fx_settlement_usd", labels: ["Net settlement"], years: 8, note: "Banks' foreign-currency purchases less sales, own account and customers together. Negative means more foreign currency sold than bought." },
          { title: "Foreign direct investment, actual use, year to date", key: "fdi_actual_use", labels: ["Actual use of foreign investment, year to date"], years: 3, note: "The running total restarts each January. The commerce ministry stopped its dollar series in 2023. Some months are missing." },
          { title: "Foreign direct investment, year-to-date growth", key: "fdi_growth", labels: ["Actual use of foreign investment, year to date (YoY %)"], years: 3 },
          { title: "Foreign exchange reserves, month-end", key: "forex_reserves", years: 15 },
          { title: "China's holdings of US Treasuries, month-end", key: "us_treasury_holdings", years: 15, note: "The Treasury's own survey of foreign holders; custodial holdings in Belgium and elsewhere are not counted as China's." },
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
