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
import { getNbsCatalogEntry, getNbsCatalogSeries } from "./nbs-catalog";

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
  /**
   * A line computed here from two stored series rather than read from one.
   * `share_65` is those aged 65 and over as a share of the year-end total,
   * both from the bureau's annual tables; the card links to `key`.
   */
  derive?: "share_65" | "trade_3m";
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
  ics: "nbs_09008937b0f148b7ac12855a9dbf8913",
} as const;


/** The month-on-a-year-earlier output growth lines, by product. */
const MONTH_GROWTH = { nev: "New energy vehicles, month (YoY %)", autos: "Automobiles, month (YoY %)", ics: "Integrated circuits, month (YoY %)", steel: "Crude steel, month (YoY %)", cement: "Cement, month (YoY %)" } as const;

/**
 * What the stored Customs monthly tables hold around the Lunar New Year. For
 * 2020 to 2025 Customs published January and February only as one combined
 * figure, and the store keeps it differently by table and year, so each note
 * says exactly what its series has. Checked against the live site on 29
 * September 2026.
 */
const CUSTOMS_NOTES = {
  /** Commodity lines from January 2019: hi-tech products, ships, coal. */
  commodityFrom2019: "2019 has separate January and February points. There is no point for either month in 2020. For 2021 to 2023 the February point is January and February combined. There is no January or February point for 2024 or 2025. 2026 has a February point alone and no January.",
  /** A commodity chart whose window opens in 2020 (mobile phones, six years). */
  commodityFrom2021: "For 2021 to 2023 the February point is January and February combined. There is no January or February point for 2024 or 2025. 2026 has a February point alone and no January.",
  /** A commodity chart whose window opens in 2021 (motor vehicles, five years). */
  commodityFrom2022: "For 2022 and 2023 the February point is January and February combined. There is no January or February point for 2024 or 2025. 2026 has a February point alone and no January.",
  /** Trade by partner. */
  partners: "2019 has separate January and February points. There is no January or February point for 2020 to 2025. 2026 has a February point alone and no January.",
  /** Lines the site began storing in 2026, such as integrated circuits. */
  from2026: "The stored history starts in February 2026. Customs published no January 2026 figure on its own.",
  hiTechOverlap: "Hi-tech products overlap other commodity lines.",
  december2019Missing: "December 2019 is missing.",
} as const;

const MANUFACTURING: Theme = {
  title: "Manufacturing",
  lede: "The factory sector as the National Bureau of Statistics reports it each month: output, the purchasing managers' survey, profits, investment and prices, with capacity use each quarter. Industry's electricity use comes from the National Energy Administration. Then the sectors and the products, as growth rates and as monthly output.",
  sections: [
    {
      title: "Output, orders and capacity",
      charts: [
        { title: "Industrial production, growth on a year earlier", key: "industrial_production", years: 10, note: "Value added of industrial firms with annual revenue over 20 million yuan. The February point is January and February combined. There is no January point. The 2021 high is measured against the shutdown of early 2020." },
        { title: "Manufacturing value added, growth on a year earlier", key: "industrial_output_by_division", labels: ["Manufacturing (YoY %)"], years: 6, note: "There is no January or February point: the bureau publishes the two months only as a combined year-to-date figure. The March 2021 high is measured against the shutdown of early 2020." },
        { title: "Manufacturing PMI, with new orders and new export orders, month", key: "pmi_manufacturing", labels: ["Manufacturing PMI", "New orders", "New export orders"], years: 6, note: "Diffusion indices. 50 is no change on the month." },
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
        { title: "Manufacturing PMI: output prices and input prices", key: "pmi_manufacturing", labels: ["Input prices", "Output prices"], years: 6, note: "Diffusion indices. Above 50 is more firms reporting a rise than a fall." },
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
      lede: "Monthly output from the bureau's table. January is never published on its own. A February point, where the table has one, is January and February combined.",
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
  lede: "The National Bureau of Statistics' monthly table on what developers invest, sell, build and borrow. Home prices in seventy cities. Land sale revenue and local government bonds from the Ministry of Finance.",
  sections: [
    {
      title: "Activity",
      lede: "Year to date, growth on a year earlier. January and February are published together. There is no January point.",
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
        { title: "Real estate climate index, month", key: "real_estate", years: 10, note: "Last value December 2025. Not refreshed since." },
      ],
    },
    {
      title: "Money",
      charts: [
        { title: "New building sales value, year to date", key: "property_sales_value", years: 10, note: "The running total restarts each January. The drop from December is the reset, not a fall." },
        { title: "Developers' funds raised, total and domestic loans, year-to-date growth", key: "property_funds", years: 10 },
        { title: "Land sale revenue, year to date", key: "land_sale_revenue", years: 2, note: "The running total restarts each January. The drop from December is the reset, not a fall. The government-fund budget's largest line, and the one local governments lean on." },
        { title: "Land sale revenue, year-to-date growth", key: "fiscal_growth", labels: ["Land sale revenue, year to date (YoY %)"], years: 2, note: "Monthly from 2025. The earlier history is a few points a year." },
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
        { title: "Shanghai stock turnover, monthly total", key: "sse_turnover", years: 15, note: "Value of shares in the Shanghai Composite traded over the month." },
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
      lede: "Both indices count uncertainty terms in two mainland newspapers, the People's Daily and the Guangming Daily. They are not the Baker, Bloom and Davis China index, which reads the South China Morning Post.",
      charts: [
        { title: "China economic policy uncertainty index, monthly", key: "epu", years: 10 },
        { title: "China trade policy uncertainty index, monthly", key: "tpu", years: 10 },
      ],
    },
  ],
};

const ENERGY: Theme = {
  title: "Energy",
  lede: "Electricity generation by source from the National Bureau of Statistics and consumption by user from the National Energy Administration. Coal, crude oil and natural gas output. Energy imports from Customs. Solar cell and new energy vehicle output.",
  sections: [
    {
      title: "Electricity",
      charts: [
        { title: "Electricity generation, growth on a year earlier", key: "electricity_output", years: 10, note: "Above-threshold industrial generators only (规上工业). February is January and February together." },
        { title: "Thermal and hydro generation, month", key: "electricity_by_source", labels: ["Thermal, month (亿千瓦时)", "Hydro, month (亿千瓦时)"], years: 8 },
        { title: "Wind, solar and nuclear generation, month", key: "electricity_by_source", labels: ["Wind, month (亿千瓦时)", "Solar, month (亿千瓦时)", "Nuclear, month (亿千瓦时)"], years: 8, note: "Above-threshold industrial generators only (规上工业). Most distributed solar, rooftop included, is outside it." },
        { title: "Thermal, wind and solar generation, growth on a year earlier", key: "electricity_by_source_growth", labels: ["Thermal (YoY %)", "Wind (YoY %)", "Solar (YoY %)"], years: 8, note: "The bureau's rates, on a comparable set of enterprises. They run below growth worked out from the levels, most for solar (Aug 2026: 10.3% against 30%)." },
        { title: "Electricity consumption, month", key: "electricity_demand", labels: ["All users, month"], years: 5, note: "The administration gives no December figure. Its annual release comes in January. No release was published for May 2026." },
        { title: "Electricity consumption by user, growth on a year earlier", key: "electricity_demand_growth", labels: ["All users, month (YoY %)", "Secondary industry, month (YoY %)", "Households, month (YoY %)"], years: 5, note: "The administration gives no December figure. Its annual release comes in January. No release was published for May 2026." },
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
        { title: "Coal imports, value, month", key: "major_imports", region: "coal-and-lignite", labels: ["Value"], years: 8, note: `${CUSTOMS_NOTES.commodityFrom2019} ${CUSTOMS_NOTES.december2019Missing}` },
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
      lede: "January is never published on its own. A February point, where the table has one, is January and February combined.",
      charts: [
        { title: "Solar cell output, month", key: OUTPUT.solar, years: 10 },
        { title: "New energy vehicle output, month", key: OUTPUT.nev, years: 3 },
      ],
    },
  ],
};

const DEMOGRAPHICS: Theme = {
  title: "Demographics",
  lede: "The National Bureau of Statistics' annual population tables. Fertility, life expectancy and ageing are UN estimates published by the World Bank, since the bureau does not publish them every year.",
  sections: [
    {
      title: "Population",
      charts: [
        { title: "Population, year end", key: "population_nbs", labels: ["Total, year end (10,000 persons)"], years: 30 },
        { title: "Urban and rural population, year end", key: "population_nbs", labels: ["Urban (10,000 persons)", "Rural (10,000 persons)"], years: 30 },
        { title: "Birth, death and natural growth rates, year", key: "population_rates", years: 30, note: "Natural growth is births less deaths. Migration is not in it." },
        { title: "Population by age group, year end", key: "population_age", years: 30, note: "Survey estimates reset to each census. The steps in 2000, 2010 and 2020 are census revisions, not births or deaths. For 2025 the bureau has published only the 65 and over count." },
        { title: "Population share aged 65 and over, year end", key: "population_age", derive: "share_65", years: 30, note: "Worked out here from the bureau's year-end counts: those aged 65 and over over the total. The World Bank's UN-based estimate runs about a point lower." },
        { title: "Total fertility rate, year", key: "fertility", years: 40, note: "UN estimate published by the World Bank. The bureau publishes no annual total fertility rate." },
        { title: "Life expectancy at birth, year", key: "life_expectancy", years: 40, note: "UN estimate published by the World Bank. The National Health Commission puts 2024 at 79.0 years." },
      ],
    },
  ],
};

const LABOR: Theme = {
  title: "Labor market",
  lede: "",
  sections: [
    {
      title: "Unemployment",
      charts: [
        { title: "Surveyed urban unemployment rate, national, monthly", key: "unemployment", labels: ["Surveyed urban (%)"], years: 8 },
        { title: "Unemployment rate, ages 16 to 24, excluding students from December 2023, monthly", key: "unemployment", labels: ["Youth 16-24, ex-students (%)"], years: 8, note: "Students were included until June 2023. The bureau published no figure for July to November 2023 and resumed with December 2023 on a basis that excludes students. The two segments are not comparable." },
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
        { title: "Rural migrant workers away from home, quarter end", key: "migrant_workers", years: 8, note: "No fourth-quarter reading. The annual migrant worker survey covers the year. The count falls each first quarter around the Lunar New Year." },
        { title: "Rural migrant workers away from home, average monthly income, nominal, quarterly", key: "migrant_workers_income", years: 8, note: "No fourth-quarter reading. The annual survey covers the year." },
        { title: "Manufacturing PMI: employment index, monthly", key: "pmi_manufacturing", labels: ["Employment"], years: 8, note: "Diffusion index. Below 50 is more firms shedding than hiring." },
      ],
    },
    {
      title: "Income",
      charts: [
        { title: "Household disposable income per person, real growth on a year earlier, year to date, all residents, urban and rural", key: "household_income_growth", years: 8, note: "Growth after deducting price changes. Each quarter covers January to the quarter's end. Q4 is the full year." },
        { title: "Household disposable income per person, year to date", key: "household_income", years: 8, note: "The running total restarts each January. The drop from Q4 to Q1 is the reset, not a fall." },
        { title: "Gini index of income inequality, World Bank estimate, annual", key: "gini", years: 30, note: "Latest reading 2022. Readings before 2010 are every two or three years." },
      ],
    },
  ],
};

/**
 * Bureau catalog series the consumption and investment pages draw that have
 * no curated key. Each is a national monthly table line; the ids are the
 * bureau's own, held to the catalog by the theme test.
 */
const CATALOG_SERIES = {
  cateringMonth: "nbs_476cfe584e9849c2a2bac63a2fe1dd49",
  servicesRetailYtd: "nbs_b4689b643a27430b9673a192210138d0",
  newProjectsPlannedYtd: "nbs_16e62d9a7bd6429dac1671dee1322e09",
  equipmentPurchasesYtd: "nbs_59b2716c393f4861bfb30e244358005b",
  constructionInstallationYtd: "nbs_e98c774721a04bccb6bb7b22fb5a57b1",
  privateManufacturingYtd: "nbs_370980134e894827bd007f142eaf4740",
} as const;

/** The retail sales category lines, by commodity, month on a year earlier. */
const RETAIL_GROWTH = {
  appliances: "Home appliances, month (YoY %)",
  phones: "Communication equipment, month (YoY %)",
  autos: "Motor vehicles, month (YoY %)",
  oil: "Oil products, month (YoY %)",
  food: "Food and cooking oil, month (YoY %)",
  clothing: "Clothing and textiles, month (YoY %)",
  cosmetics: "Cosmetics, month (YoY %)",
  furniture: "Furniture, month (YoY %)",
  building: "Building and decorating materials, month (YoY %)",
  jewellery: "Gold, silver and jewellery, month (YoY %)",
} as const;

/** Retail's February point is the combined January-February release; the note every monthly retail card needs. */
const RETAIL_FEBRUARY_NOTE = "There is no January point. The February point is January and February combined.";

const CONSUMPTION: Theme = {
  title: "Consumption",
  lede: "",
  sections: [
    {
      title: "Spending",
      charts: [
        { title: "Retail sales of consumer goods, growth on a year earlier, month", key: "retail_sales", years: 10, note: `Nominal. Goods and catering, not most services. ${RETAIL_FEBRUARY_NOTE} The 2021 high is measured against the shutdown of early 2020.` },
        { title: "Household consumption spending per person, real growth on a year earlier, year to date, all residents, urban and rural", key: "household_spending_growth", years: 8, note: "From the household survey, after deducting price changes. Unlike retail sales it includes services. Each quarter covers January to the quarter's end. Q4 is the full year." },
        { title: "Services retail sales, year-to-date growth", key: CATALOG_SERIES.servicesRetailYtd, years: 4, note: "The bureau began publishing this in July 2023. The early readings are measured against the lockdown months of 2022." },
        { title: "Catering revenue, growth on a year earlier, month", key: CATALOG_SERIES.cateringMonth, years: 8, note: `Restaurant and other food service sales, part of retail sales. ${RETAIL_FEBRUARY_NOTE} The swings of 2020 to 2023 are measured against lockdown months.` },
        { title: "Index of services production, growth on a year earlier, month", key: "services_production", labels: ["Services production, month (YoY %)"], years: 8, note: "Output of the whole service sector, business services included, not only what households buy." },
        { title: "Final consumption's share of GDP growth, quarter", key: "gdp_contributions", labels: ["Final consumption expenditure, quarter (% of growth)"], years: 8, note: "Share of the quarter's growth. Consumption, capital formation and net exports sum to 100." },
      ],
    },
    {
      title: "Retail sales by category",
      charts: [
        { title: "Retail sales of home appliances and communication equipment, growth on a year earlier, month", key: "retail_by_category_growth", labels: [RETAIL_GROWTH.appliances, RETAIL_GROWTH.phones], years: 5, note: `Appliances came under the consumer goods trade-in subsidy in 2024 and phones in January 2025. ${RETAIL_FEBRUARY_NOTE}` },
        { title: "Retail sales of motor vehicles and oil products, growth on a year earlier, month", key: "retail_by_category_growth", labels: [RETAIL_GROWTH.autos, RETAIL_GROWTH.oil], years: 5, note: `Oil product sales move with fuel prices as much as with volumes. ${RETAIL_FEBRUARY_NOTE}` },
        { title: "Retail sales of food, clothing and cosmetics, growth on a year earlier, month", key: "retail_by_category_growth", labels: [RETAIL_GROWTH.food, RETAIL_GROWTH.clothing, RETAIL_GROWTH.cosmetics], years: 5, note: RETAIL_FEBRUARY_NOTE },
        { title: "Retail sales of furniture and building materials, growth on a year earlier, month", key: "retail_by_category_growth", labels: [RETAIL_GROWTH.furniture, RETAIL_GROWTH.building], years: 5, note: `Both follow home sales and move-ins. ${RETAIL_FEBRUARY_NOTE}` },
        { title: "Retail sales of gold, silver and jewellery, growth on a year earlier, month", key: "retail_by_category_growth", labels: [RETAIL_GROWTH.jewellery], years: 5, note: `Sales values, so they move with the gold price. ${RETAIL_FEBRUARY_NOTE}` },
      ],
    },
    {
      title: "Income, saving and borrowing",
      charts: [
        { title: "Household disposable income per person, real growth on a year earlier, year to date, all residents, urban and rural", key: "household_income_growth", years: 8, note: "Growth after deducting price changes. Each quarter covers January to the quarter's end. Q4 is the full year." },
        { title: "Household deposits and loans to households outstanding, month-end", key: "bank_credit", labels: ["Deposits of households", "Loans to households"], years: 10, note: "Yuan balances at all financial institutions. Mortgages are the largest part of loans to households." },
      ],
    },
    {
      title: "Confidence and prices",
      charts: [
        { title: "Consumer confidence index, with expectations and satisfaction, month", key: "consumer_confidence", years: 10, note: "100 is neutral. Confidence fell from 113 to 87 in April 2022, during the Shanghai lockdown, and has stayed below 100 since." },
        { title: "Core CPI and services CPI, growth on a year earlier, month", key: "cpi_detail", labels: ["Core CPI, excluding food and energy (YoY %)", "Services (YoY %)"], years: 6 },
      ],
    },
  ],
};

const INVESTMENT: Theme = {
  title: "Investment",
  lede: "",
  sections: [
    {
      title: "Total",
      charts: [
        { title: "Fixed-asset investment, total and private, year-to-date growth", key: "fai", labels: ["Fixed-asset investment, year to date (YoY %)", "Private investment, year to date (YoY %)"], years: 10, note: "Excludes rural households. Each year's first point covers January and February. The 2021 high is measured against the shutdown months of 2020." },
        { title: "Fixed-asset investment by sector, primary, secondary and tertiary industry, year-to-date growth", key: "fai", labels: ["Primary industry, year to date (YoY %)", "Secondary industry, year to date (YoY %)", "Tertiary industry, year to date (YoY %)"], years: 10, note: "Each year's first point covers January and February." },
        { title: "Gross capital formation's share of GDP growth, quarter", key: "gdp_contributions", labels: ["Gross capital formation, quarter (% of growth)"], years: 8, note: "Share of the quarter's growth. Consumption, capital formation and net exports sum to 100." },
      ],
    },
    {
      title: "Manufacturing, infrastructure and real estate",
      charts: [
        { title: "Fixed-asset investment in manufacturing and the real estate industry, year-to-date growth", key: "fai_by_industry", labels: ["Manufacturing, year to date (YoY %)", "Real estate industry, year to date (YoY %)"], years: 8, note: "The real estate industry line is the investment survey's industry total. Developers' investment, on the Property page, is a different series. Each year's first point covers January and February." },
        { title: "Fixed-asset investment in railways, roads, and water, environment and public facilities, year-to-date growth", key: "fai_by_industry", labels: ["Railways, year to date (YoY %)", "Roads, year to date (YoY %)", "Water, environment and public facilities, year to date (YoY %)"], years: 8, note: "The bureau's infrastructure total is published only in its monthly release, not in its data tables, so the industries that make it up are shown here." },
        { title: "Fixed-asset investment in utilities and mining, year-to-date growth", key: "fai_by_industry", labels: ["Utilities, year to date (YoY %)", "Mining, year to date (YoY %)"], years: 8, note: "Utilities is power, heat, gas and water supply, where grid and power plant spending falls." },
        { title: "Private fixed-asset investment in manufacturing, year-to-date growth", key: CATALOG_SERIES.privateManufacturingYtd, years: 8, note: "Each year's first point covers January and February." },
      ],
    },
    {
      title: "Equipment, construction and new projects",
      charts: [
        { title: "Fixed-asset investment in equipment and tool purchases, year-to-date growth", key: CATALOG_SERIES.equipmentPurchasesYtd, years: 8, note: "The large-scale equipment renewal program announced in March 2024 targets this line." },
        { title: "Fixed-asset investment in construction and installation work, year-to-date growth", key: CATALOG_SERIES.constructionInstallationYtd, years: 8 },
        { title: "Planned total investment of projects started this year, year-to-date growth", key: CATALOG_SERIES.newProjectsPlannedYtd, years: 8, note: "What newly started projects are budgeted to spend over their life, so it leads spending." },
      ],
    },
    {
      title: "Funding",
      charts: [
        { title: "Fixed-asset investment funds in place, total and by source, year-to-date growth", key: "fai_funding", years: 10, note: "Sources are the state budget, domestic loans and self-raised funds, the largest of the three. Each year's first point covers January and February." },
        { title: "Local government bonds issued, total and special, month", key: "lgb_issuance", labels: ["Bonds issued in the month, total", "Special bonds issued in the month"], years: 2, note: "Special bonds pay for projects, most of them infrastructure. History here starts December 2024." },
        { title: "Total social financing, net government bond and corporate bond financing, month", key: "tsf_flow", labels: ["Government bonds", "Corporate bonds"], years: 8, note: "Net new financing in the month." },
        { title: "Loans to non-financial enterprises outstanding, month-end", key: "bank_credit", labels: ["Loans to non-financial enterprises"], years: 10, note: "Yuan balances at all financial institutions." },
      ],
    },
  ],
};

/**
 * Bureau catalog series the tech and innovation page draws. All are national
 * tables in datasets 1 to 3, none of them sliced into a family, so each id is
 * the whole series. The annual science and technology tables carry both the
 * domestic and foreign applicant counts; the page keeps invention, utility
 * model and design patents on separate charts because the three are examined
 * differently and are never summed here.
 */
const TECH_SERIES = {
  inventionApplications: "nbs_0657dcd8475e427eb3118d1e75ab6003",
  inventionGrants: "nbs_50f8cbced82e4c6e948ff3843abde5a0",
  inventionApplicationsDomestic: "nbs_98cb0a74cf4d4413874450b17f5a7447",
  inventionApplicationsForeign: "nbs_2bb2441b1123461a905f1ecfd5fc1d5d",
  utilityModelApplications: "nbs_7356847f658c42c48a7bf331dcb83184",
  designApplications: "nbs_37017d3c4dd54628ac79d8d5c9cb0f08",
  rdSpending: "nbs_3a5061e303e546c9be5e1962fe13548d",
  rdBasicResearch: "nbs_ea75287271a5427f8e2fb3724354fa58",
  rdPersonnelFte: "nbs_bfadf37642ca44b0a45d2e26041bd040",
  doctoralGraduates: "nbs_fb87c9bbe7c44203917e49678f838fbd",
  postgraduateGraduates: "nbs_7f07420225924c389d51dd6db5e7cb56",
  itValueAdded: "nbs_b46978955565481eb801c97029bbc779",
  itValueAddedGrowth: "nbs_060c7617bdd846ae917d1b8738ff6a70",
  itInvestmentYtd: "nbs_36a00c88e1924fd38df593bb043bebb1",
  fiveGUsers: "nbs_d704a40c23344e2bbaf680e3c177c0fb",
  technologyMarket: "nbs_fe4358b6030c41bc8414b60354f947d5",
} as const;

const TECH: Theme = {
  title: "Tech and innovation",
  lede: "",
  sections: [
    {
      title: "Patents",
      lede: "Invention patents are examined for novelty and inventiveness. Utility model and design patents get only a preliminary examination and are shown separately.",
      charts: [
        { title: "Invention patent applications, year", key: TECH_SERIES.inventionApplications, years: 30, note: "Applications received from domestic and foreign applicants. The 2024 and 2025 figures are rounded to the thousand." },
        { title: "Invention patent grants, year", key: TECH_SERIES.inventionGrants, years: 30, note: "Patents granted to domestic and foreign applicants. The 2024 and 2025 figures are rounded to the thousand." },
        { title: "Invention patent applications, domestic applicants, year", key: TECH_SERIES.inventionApplicationsDomestic, years: 30, note: "The 2024 and 2025 figures are rounded to the thousand." },
        { title: "Invention patent applications, foreign applicants, year", key: TECH_SERIES.inventionApplicationsForeign, years: 30, note: "The 2024 and 2025 figures are rounded to the thousand." },
        { title: "Utility model patent applications, year", key: TECH_SERIES.utilityModelApplications, years: 30, note: "Latest reading 2024." },
        { title: "Design patent applications, year", key: TECH_SERIES.designApplications, years: 30, note: "Latest reading 2024." },
      ],
    },
    {
      title: "Research and development",
      charts: [
        { title: "R&D spending, total, year", key: TECH_SERIES.rdSpending, years: 30, note: "Spending on research and experimental development (研究与试验发展) by the units the bureau surveys. At current prices." },
        { title: "R&D spending, basic research, year", key: TECH_SERIES.rdBasicResearch, years: 28, note: "Research not aimed at a particular use. In 2025 it was 7% of all R&D spending. At current prices." },
        { title: "R&D personnel, full-time equivalent, year", key: TECH_SERIES.rdPersonnelFte, years: 30, note: "Someone who spends half their time on R&D counts as half." },
        { title: "Technology market contract value, year", key: TECH_SERIES.technologyMarket, years: 30, note: "Contracts for technology development, transfer, consulting and services registered with the technology market. At current prices." },
      ],
    },
    {
      title: "Research workforce",
      charts: [
        { title: "Doctoral graduates, year", key: TECH_SERIES.doctoralGraduates, years: 20, note: "Latest reading 2024." },
        { title: "Postgraduate graduates, doctoral and master's combined, year", key: TECH_SERIES.postgraduateGraduates, years: 30, note: "Master's graduates are about nine in ten." },
      ],
    },
    {
      title: "Tech output",
      lede: "Monthly output from the bureau's table. January is never published on its own. A February point, where the table has one, is January and February combined. The Manufacturing page shows integrated circuit and new energy vehicle output as growth rates.",
      charts: [
        { title: "Integrated circuit output, month", key: OUTPUT.ics, years: 10, note: "Chips of every kind." },
        { title: "Industrial robot output, month", key: OUTPUT.robots, years: 10 },
        { title: "New energy vehicle output, month", key: OUTPUT.nev, years: 3 },
        { title: "Solar cell output, month", key: OUTPUT.solar, years: 10, note: "Measured by the generating capacity of the cells made." },
      ],
    },
    {
      title: "Digital economy",
      charts: [
        { title: "Value added of information transmission, software and IT services, current prices, quarter", key: TECH_SERIES.itValueAdded, years: 10, note: "The third quarter is the smallest each year, so compare a quarter with the same quarter a year earlier." },
        { title: "Value added of information transmission, software and IT services, real growth on a year earlier, quarter", key: TECH_SERIES.itValueAddedGrowth, years: 10, note: "Growth after deducting price changes." },
        { title: "Fixed-asset investment in information transmission, software and IT services, year-to-date growth", key: TECH_SERIES.itInvestmentYtd, years: 8, note: "Each year's first point covers January and February." },
        { title: "5G mobile phone users, month-end", key: TECH_SERIES.fiveGUsers, years: 5, note: "户 here counts subscribers, not households. 100K on the axis is one billion subscribers." },
      ],
    },
    {
      title: "Technology trade",
      lede: "Customs' major exports and imports tables, value in million US dollars.",
      charts: [
        { title: "Hi-tech product exports, value, month", key: "major_exports", region: "hi-tech-products", labels: ["Value"], years: 8, note: `${CUSTOMS_NOTES.commodityFrom2019} ${CUSTOMS_NOTES.hiTechOverlap}` },
        { title: "Hi-tech product imports, value, month", key: "major_imports", region: "hi-tech-products", labels: ["Value"], years: 8, note: `${CUSTOMS_NOTES.commodityFrom2019} ${CUSTOMS_NOTES.december2019Missing} ${CUSTOMS_NOTES.hiTechOverlap}` },
        { title: "Integrated circuit exports, value, month", key: "major_exports", region: "electronic-integrated-circuits", labels: ["Value"], years: 1, note: CUSTOMS_NOTES.from2026 },
        { title: "Integrated circuit imports, value, month", key: "major_imports", region: "electronic-integrated-circuits", labels: ["Value"], years: 1, note: CUSTOMS_NOTES.from2026 },
      ],
    },
  ],
};

export const THEMES: Record<string, Theme> = {
  trade: {
    title: "Trade and capital flows",
    lede: "Exports and imports by partner and major exports by commodity from Customs. The manufacturing behind them from the National Bureau of Statistics. What drove each quarter's growth. Money crossing the border from SAFE, the People's Bank, the Ministry of Commerce, CFETS and the US Treasury.",
    sections: [
      {
        title: "Totals and where growth comes from",
        charts: [
          { title: "Exports and imports, value per month", key: "trade_values", labels: ["Exports", "Imports"], years: 8, note: "Customs published only a combined January and February for 2020 to 2025. Those months are left blank. For 2026 Customs published February on its own and no January." },
          { title: "Exports and imports, growth on a year earlier, month", key: "trade", labels: ["Exports (YoY %)", "Imports (YoY %)"], years: 8, note: "Customs' own rates in USD terms. January and February were published only as a combined figure for 2020 to 2025. February 2026's 39.6% reflects the late Lunar New Year." },
          { title: "Exports and imports, growth on a year earlier, three-month average", key: "trade", derive: "trade_3m", years: 8, note: "Customs' rates in US dollar terms, averaged over the latest three months. January and February both take the combined two-month rate, as Customs publishes it." },
          { title: "Trade balance, month", key: "trade_values", labels: ["Balance"], years: 8, note: "Customs published only a combined January and February for 2020 to 2025. Those months are left blank." },
          { title: "Contributions to quarterly GDP growth, by expenditure", key: "gdp_contributions", years: 8, note: "Shares of the quarter's growth. The three sum to 100." },
        ],
      },
      {
        title: "Trade by partner",
        charts: [
          { title: "Exports to and imports from the United States, month", key: "trade_partners", region: "united-states", labels: ["Exports", "Imports"], years: 8, note: CUSTOMS_NOTES.partners },
          { title: "Exports to and imports from the European Union, month", key: "trade_partners", region: "european-union", labels: ["Exports", "Imports"], years: 8, note: CUSTOMS_NOTES.partners },
          { title: "Exports to and imports from ASEAN, month", key: "trade_partners", region: "asean", labels: ["Exports", "Imports"], years: 8, note: CUSTOMS_NOTES.partners },
          { title: "Exports to and imports from Japan, month", key: "trade_partners", region: "japan", labels: ["Exports", "Imports"], years: 8, note: CUSTOMS_NOTES.partners },
          { title: "Exports to and imports from South Korea, month", key: "trade_partners", region: "r-o-korea", labels: ["Exports", "Imports"], years: 8, note: CUSTOMS_NOTES.partners },
          { title: "Exports to and imports from Russia, month", key: "trade_partners", region: "russian-federation", labels: ["Exports", "Imports"], years: 8, note: CUSTOMS_NOTES.partners },
        ],
      },
      {
        title: "Major exports, by value",
        lede: "From Customs' commodity table.",
        charts: [
          { title: "Hi-tech product exports, value, month", key: "major_exports", region: "hi-tech-products", labels: ["Value"], years: 8, note: `${CUSTOMS_NOTES.commodityFrom2019} ${CUSTOMS_NOTES.hiTechOverlap}` },
          { title: "Mobile phone exports, value, month", key: "major_exports", region: "mobile-phones", labels: ["Value"], years: 6, note: CUSTOMS_NOTES.commodityFrom2021 },
          { title: "Motor vehicle exports, value, month", key: "major_exports", region: "motor-vehicles-including-chassis-fitted-with-engines", labels: ["Value"], years: 5, note: CUSTOMS_NOTES.commodityFrom2022 },
          { title: "Integrated circuit exports, value, month", key: "major_exports", region: "electronic-integrated-circuits", labels: ["Value"], years: 1, note: CUSTOMS_NOTES.from2026 },
          { title: "Ship exports, value, month", key: "major_exports", region: "ships", labels: ["Value"], years: 8, note: CUSTOMS_NOTES.commodityFrom2019 },
        ],
      },
      {
        title: "Manufacturing",
        lede: "There is no January or February point on the monthly charts: the bureau publishes the two months only as a combined year-to-date figure.",
        charts: [
          { title: "Industrial production, growth on a year earlier", key: "industrial_production", years: 10, note: "Value added of industrial firms with annual revenue over 20 million yuan. The February point is January and February combined. There is no January point." },
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
        title: "Capital flows",
        lede: "The balance of payments from SAFE each quarter. Banks' cross-border receipts and payments and FX settlement each month. Foreign direct investment from the Ministry of Commerce. The reserves and the yuan.",
        charts: [
          { title: "Balance of payments: current account and financial account excluding reserves, quarter", key: "balance_of_payments", labels: ["Current account", "Financial account excluding reserves"], years: 10, note: "A financial-account deficit is money leaving. The current account, the financial account, reserve assets and errors and omissions sum to zero. The financial account for the latest quarter comes later than the current account." },
          { title: "Balance of payments: financial account by kind, quarter", key: "balance_of_payments", labels: ["Direct investment", "Portfolio investment", "Other investment"], years: 10 },
          { title: "Cross-border receipts and payments through banks for customers, net, month", key: "cross_border_flows_usd", labels: ["Net receipts", "Net, capital and financial account"], years: 8, note: "Settlement data: what crossed banks' books in the month, before the balance of payments is compiled." },
          { title: "Banks' FX settlement, net, month", key: "bank_fx_settlement_usd", labels: ["Net settlement"], years: 8, note: "Banks' foreign-currency purchases less sales, own account and customers together. Negative means more foreign currency sold than bought." },
          { title: "Foreign direct investment, actual use, year to date", key: "fdi_actual_use", labels: ["Actual use of foreign investment, year to date"], years: 3, note: "The running total restarts each January. The commerce ministry stopped its dollar series in 2023. Some months are missing." },
          { title: "Foreign direct investment, year-to-date growth", key: "fdi_growth", labels: ["Actual use of foreign investment, year to date (YoY %)"], years: 3 },
          { title: "Foreign exchange reserves, month-end", key: "forex_reserves", years: 15 },
          { title: "China's holdings of US Treasuries, month-end", key: "us_treasury_holdings", years: 15, note: "The Treasury's own survey of foreign holders. Custodial holdings in Belgium and elsewhere are not counted as China's." },
          { title: "Yuan per dollar, central parity", key: "central_parity", labels: ["USD/CNY"], years: 10, note: "Up is a weaker yuan." },
          { title: "CFETS yuan index", key: "cfets_rmb_index", labels: ["CFETS basket"], years: 10, note: "The yuan against a trade-weighted basket. Up is stronger." },
        ],
      },
    ],
  },
  manufacturing: MANUFACTURING,
  consumption: CONSUMPTION,
  investment: INVESTMENT,
  property: PROPERTY,
  tech: TECH,
  // Equities is off the site (agreed page list, 29 September 2026). Its definition above is kept; restore it here, in THEME_ORDER and in the client page strip.
  energy: ENERGY,
  demographics: DEMOGRAPHICS,
  labor: LABOR,
};

/** The pages in the order the owner named them; Home and Provinces are not themes but sit in the same strip. */
export const THEME_ORDER = ["manufacturing", "consumption", "investment", "property", "tech", "trade", "energy", "demographics", "labor"] as const;

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

/**
 * A chart's series as the series page would serve it, from the store only.
 *
 * A bureau catalog series goes through the catalog reader, which stitches a
 * sliced table, drops the placeholder zeros and fills the combined February
 * from the year-to-date sibling (`februaryFrom`), all from stored points. Read
 * raw, a theme card drew a different line from the page it links to: the
 * output tables had no February at all here and the combined one there.
 */
/**
 * Those aged 65 and over as a share of the year-end population, from the
 * bureau's own counts. The World Bank's share, a UN estimate, runs about a
 * point below the bureau's counts (14.9% against 15.9% for 2025), and the two
 * sat on one page without a word about the gap; the bureau publishes the
 * counts but no national share series, so the share is worked out here.
 */
function share65(): SeriesResult | null {
  const ages = readSeries("population_age", 80);
  const totals = readSeries("population_nbs", 80);
  const over65 = ages?.series.find((line) => /65 and over/i.test(line.label))?.points ?? [];
  const total = new Map((totals?.series.find((line) => /^Total/i.test(line.label))?.points ?? []).map((point) => [point.date, point.value]));
  const points = over65.flatMap((point) => { const whole = total.get(point.date); return whole ? [{ date: point.date, value: Math.round((point.value / whole) * 10000) / 100 }] : []; });
  if (points.length === 0 || !ages) return null;
  return {
    key: "population_age", title: "Population share aged 65 and over", agency: ages.agency, sourceUrl: ages.sourceUrl,
    frequency: "Annual", unit: "Percent of the year-end population", series: [{ label: "Aged 65 and over, share of population (%)", points }],
  };
}

/**
 * Customs' export and import growth rates averaged over three months, the
 * form these rates are usually read in: one month carries the Lunar New Year
 * and the combined January-February release. January and February both take
 * the combined two-month rate, which Customs publishes as the February year
 * to date; a month with no rate leaves the window short and the point is
 * skipped rather than averaged over fewer months.
 */
function trade3m(): SeriesResult | null {
  const trade = readSeries("trade", 400);
  if (!trade) return null;
  const line = (label: string) => new Map((trade.series.find((item) => item.label === label)?.points ?? []).map((point) => [point.date, point.value]));
  const smooth = (month: Map<string, number>, ytd: Map<string, number>) => {
    const rates = new Map(month);
    for (const [date, value] of ytd) if (date.endsWith("-02")) { rates.set(`${date.slice(0, 4)}-01`, value); rates.set(date, value); }
    const dates = [...rates.keys()].sort();
    const points: { date: string; value: number }[] = [];
    for (const date of dates) {
      const [year, mon] = date.split("-").map(Number);
      if (!year || !mon) continue;
      const window = [0, 1, 2].map((back) => { const m = mon - back; const y = m < 1 ? year - 1 : year; return rates.get(`${y}-${String(m < 1 ? m + 12 : m).padStart(2, "0")}`); });
      const values = window.filter((value): value is number => value !== undefined);
      if (values.length < 3) continue;
      points.push({ date, value: Math.round((values.reduce((sum, value) => sum + value, 0) / 3) * 10) / 10 });
    }
    return points;
  };
  const exports = smooth(line("Exports (YoY %)"), line("Exports, year to date (YoY %)"));
  const imports = smooth(line("Imports (YoY %)"), line("Imports, year to date (YoY %)"));
  if (exports.length === 0 && imports.length === 0) return null;
  return {
    key: "trade", title: "Exports and imports, growth on a year earlier, three-month average", agency: trade.agency, sourceUrl: trade.sourceUrl,
    frequency: "Monthly", unit: "Percent change from year ago, three-month average",
    series: [{ label: "Exports, 3-month average (YoY %)", points: exports }, { label: "Imports, 3-month average (YoY %)", points: imports }],
  };
}

async function chartSeries(chart: ThemeChart, region: string | undefined): Promise<SeriesResult | null> {
  if (chart.derive === "share_65") return share65();
  if (chart.derive === "trade_3m") return trade3m();
  if (chart.key.startsWith("nbs_")) {
    const entry = await getNbsCatalogEntry(chart.key);
    if (!entry) return null;
    try { return await getNbsCatalogSeries({ entry, limit: limitFor(chart.key, chart.years ?? 10), storeOnly: true }); }
    catch { return null; }
  }
  return readSeries(chart.key, limitFor(chart.key, chart.years ?? 10), region);
}

/** The theme's charts, each with its series read from the store. Null for a theme that does not exist. */
export async function themeData(name: string): Promise<ThemeData | null> {
  const theme = THEMES[name];
  if (!theme) return null;
  return {
    name, title: theme.title, lede: theme.lede,
    sections: await Promise.all(theme.sections.map(async (section) => ({
      title: section.title, ...(section.lede ? { lede: section.lede } : {}),
      charts: await Promise.all(section.charts.map(async (chart) => {
        // The region resolves as the series route resolves it: the one named, else the
        // series' default, else its first; a series without regions reads as stored.
        const regions = seriesRegions(chart.key);
        const requested = chart.region ?? seriesRegion(chart.key);
        const place = regions.length > 0 ? (regions.find((item) => item.value === requested) ?? regions[0]) : undefined;
        const stored = await chartSeries(chart, place?.value);
        const configured = configuredLabels(chart.key);
        // A derived line is not among the series' configured lines; it is drawn as computed.
        const wanted = chart.derive ? undefined : (chart.labels ?? configured);
        const result = stored
          ? { ...stored, title: chart.title ?? stored.title, series: wanted ? stored.series.filter((line) => wanted.includes(line.label)) : stored.series }
          : null;
        return { ...chart, result, ...(place ? { place } : {}) };
      })),
    }))),
  };
}

/** Every chart of every theme, for the test that holds them to the catalog. */
export function allThemeCharts(): { theme: string; chart: ThemeChart }[] {
  return Object.entries(THEMES).flatMap(([theme, definition]) => definition.sections.flatMap((section) => section.charts.map((chart) => ({ theme, chart }))));
}
