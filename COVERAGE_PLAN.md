# Coverage plan: what a cohesive picture of the Chinese economy still needs

15 September 2026. What the site holds, what a macro reader would reach for
and not find, where each missing thing is published, and the order to add it.

## Where we are

The catalog is now the bureau's own: 79,756 entries across all ten NBS
dataset families, 66,222 browsable, with 43 curated headline series on top
(NBS, PBOC, Customs and Caixin via the Eastmoney mirror; 24 via FRED). The
NBS side is close to complete for what the bureau publishes through its
portal. The gaps are almost all **other publishers**: Customs, the central
bank, the finance ministry, the energy administration, the FX regulator, the
bond market. Those are where a picture of trade, credit, energy and the
external balance comes from, and each is a small adapter, not a crawl.

What is verified below: the Eastmoney report names (from the AkShare source,
which lists every `RPT_ECONOMY_*` it uses) and the AkShare function list. What
is not yet verified: the exact page or file shape of the GAC, SAFE, NEA, MOF
and ChinaBond releases, which a first adapter would capture.

## Gaps by domain

### 1. Trade — the biggest gap

Have: total exports, imports and balance (monthly, Customs via Eastmoney);
US–China bilateral from the US side (Census, via FRED); NBS annual trade
tables.

Missing: **exports and imports by partner** (US, EU, ASEAN, Japan, Korea,
Russia, Africa, Latin America) and **by commodity** (crude, iron ore,
soybeans, integrated circuits, autos, solar, ships) — the two cuts every trade
story is written from. Also processing vs ordinary trade, and USD vs CNY
denomination (Customs publishes both and the growth rates differ).

Sources:
- **UN Comtrade API** (free key, JSON): monthly China exports/imports by
  partner and HS chapter, one to two months behind Customs. Clean, stable,
  documented. The right backbone for partner × commodity.
- **GAC monthly release tables** (customs.gov.cn, Chinese, HTML/Excel): the
  headline partner and commodity breakdown on release day. This is the
  official-release-table adapter the faster-updates handoff proposes, applied
  to trade first — the same parser pattern serves CPI later.
- Eastmoney `RPT_ECONOMY_CUSTOMS` carries totals only (already used).

### 2. Energy

Have: coal, crude, natural gas, electricity output and thermal, hydro,
nuclear, wind and solar generation (NBS monthly, all in the catalog); crude
oil and gas import volumes (Customs, NBS); annual energy balance tables (NBS
annual, now in the catalog).

Missing: **electricity consumption** (全社会用电量, the demand-side figure
economists watch; National Energy Administration monthly), consumption by
sector, **installed capacity by source** (NEA/CEC monthly — the solar and wind
build-out numbers), refinery throughput is present but not curated, and any
carbon series (there is no official monthly one; the site should say so
rather than proxy).

Sources: NEA monthly press releases (nea.gov.cn, HTML); AkShare
`macro_china_society_electricity`; CEC (cec.org.cn). Daily coal burn at the
six power groups (`macro_china_daily_energy`) is a commercial high-frequency
proxy — label it as such if used.

### 3. Money, credit and the bond market

Have: M1, M2, new loans, LPR, SHIBOR, FX reserves, gold, BIS credit ratios,
IMF government debt.

Missing: **total social financing** (社会融资规模, stock and monthly flow —
the credit aggregate China-watchers use ahead of M2), PBOC balance sheet,
deposits, the RRR history as a series (Eastmoney `RPT_ECONOMY_DEPOSIT_RESERVE`
is an event table), FX loans and deposits (`RPT_ECONOMY_FOREX_LOAN`,
`RPT_ECONOMY_FOREX_DEPOSIT`), and the **10-year government bond yield** and
the yield curve — the single most-cited Chinese financial variable the site
does not have. Also stock market capitalisation and turnover
(`RPT_ECONOMY_STOCK_STATISTICS`).

Sources: PBOC monthly release tables (pbc.gov.cn, HTML) for TSF and the
balance sheet; AkShare `macro_china_shrzgm`, `macro_china_central_bank_balance`
(jin10-sourced, lags); **ChinaBond** (chinabond.com.cn) for yields, AkShare
`bond_china_yield`; Eastmoney for the four report names above.

### 4. Fiscal

Have: nothing curated; NBS annual fiscal tables in the catalog.

Missing: **monthly government revenue and expenditure** (MOF), tax revenue
by type (`RPT_ECONOMY_TAX` exists on Eastmoney), **land sale revenue**
(国有土地使用权出让收入, MOF monthly — the local-government-finance variable),
local government bond issuance (MOF/ChinaBond). No official LGFV series exists;
say so.

Sources: MOF monthly fiscal release (mof.gov.cn, HTML); AkShare
`macro_china_czsr`, `macro_china_national_tax_receipts`; Eastmoney TAX.

### 5. Property

Have: 70-city new and existing prices, real estate investment, and the NBS
monthly property tables (sales area and value, new starts, completions,
inventory, developer funding by source) in the catalog.

Missing: curated headline treatment of sales and starts (they exist but are
not on the home page), land purchases (NBS monthly, in catalog), a
developers'-funding view, and second-hand transaction volumes (no national
official series; cities publish, and the site should not proxy).

This is mostly curation, not new sources.

### 6. External balance

Have: FX reserves, USDCNY, BIS real effective rate, US-side bilateral trade.

Missing: **balance of payments** (SAFE quarterly: current account, goods,
services, income, financial account, reserves), **FDI actual use** (MOFCOM
monthly; Eastmoney `RPT_ECONOMY_FDI`), outward direct investment (MOFCOM),
bank FX settlement and sales (SAFE monthly — the flow measure of pressure on
the currency), CFETS RMB index.

Sources: SAFE (safe.gov.cn, Excel downloads); MOFCOM (data.mofcom.gov.cn,
which AkShare already reads for FDI); CFETS (chinamoney.com.cn).

### 7. Households, sentiment, labour

Have: surveyed unemployment with the youth breakdown, quarterly household
income and expenditure, annual wages by industry (catalog), retail sales.

Missing: **consumer confidence** (NBS index, Eastmoney `RPT_ECONOMY_FAITH_INDEX`),
**enterprise boom and entrepreneur confidence** (`RPT_ECONOMY_BOOM_INDEX`),
migrant worker numbers (NBS quarterly, in catalog, not curated), urban
household income by quintile (annual, catalog).

### 8. High-frequency and alternative

Have: none by design; everything is official and monthly or slower.

Worth adding, labelled as commercial or proxy: Baltic and China containerised
freight indices (`macro_china_freight_index`, `macro_china_bdti_index`), auto
sales weekly (CPCA) and monthly (CAAM; NBS has output), port container
throughput (Ministry of Transport monthly), air passengers (CAAC monthly),
subway ridership (city transit authorities; no national series). Keep these in
a separate "High-frequency" group so the official series stay unmixed.

### 9. International context

Have: 24 FRED series (BIS, OECD, IMF, World Bank, US agencies).

Missing: the bureau's own **international datasets** (国际数据: monthly data
for the three big economies and annual data for major countries) — a crawl of
two more dataset codes with the existing collector; IMF WEO and IFS for China
(IMF DataMapper API, free JSON); World Bank WDI beyond the seven curated.

### 10. Sector

Mostly covered by the NBS catalog (crude steel, integrated circuits, solar
cells, NEVs, cement, autos). Missing: shipbuilding orders (CANSI), the
RatingDog PMI that replaced Caixin's after September 2025 (S&P Global press
releases, HTML), and semiconductor import value by product (Customs).

## Order of work

Value per effort, with the adapter each step needs.

**A. Existing Eastmoney adapter — done 15 September.** Added: consumer
confidence (headline, expectations, satisfaction), enterprise boom index, tax
revenue year to date, foreign-currency loans outstanding, and the commerce
ministry's commodity price index with its energy, mineral and farm components.
Checked and left out: `RPT_ECONOMY_FDI` stops at July 2023 (the ministry
ended the monthly USD release), `RPT_ECONOMY_FOREX_DEPOSIT` carries a balance
column whose unit could not be reconciled with any published figure, and
`RPT_ECONOMY_STOCK_STATISTICS` is now null except for index highs and lows.

**B. Trade by partner and commodity — first version shipped 15 September.**
Measured before building: UN Comtrade's monthly data for China ends at
December 2024, and Customs' Chinese site and statistics portal answer a
foreign address with HTTP 412. Customs' **English** site does not, and carries
the whole preliminary release as HTML tables, paginated monthly back to 2022.
`server/customs.ts` is the site's first official-release-table adapter: three
curated keys, `trade_partners` (30 partners and blocs, exports, imports and
balance, USD millions), `major_exports` (31 commodities) and `major_imports`
(34, including crude, iron ore, soybeans, copper and coal, with quantities).
Parsers are fixture-tested and refuse a changed layout. Still to do: a
backfill to 2022 through the ingest, the Customs release calendar as a due
rule, and the CNY-denominated tables.

**C. Credit and the bond market — source verified 15 September.** The
government bond yield curve comes from CFETS/ChinaMoney, not ChinaBond:
`POST https://www.chinamoney.com.cn/ags/ms/cm-u-bk-currency/ClsYldCurvHis`
(`bondType=CYCC000`, `reference=1`, a date range, `termId` for one tenor,
`pageSize` up to 1000) answers a foreign address with clean JSON — 103 tenors
per trading day from one month to fifty years, back years. The adapter to
build: 1y, 2y, 5y, 10y and 30y, stored as daily closes and served at month
end for the site's monthly frame. Then TSF stock and flow, the PBOC balance
sheet and deposits from PBOC's release tables; RRR as a stepped series.

**D. Energy and fiscal — a week together.** nea.gov.cn answers a foreign
address (the CEC site does not); the monthly electricity release is a press
item ("1-N月份全国电力工业统计数据"), so the adapter needs the news listing
mapped and a fixture-tested parser like the Customs one. MOF revenue,
expenditure and land sales; a curated "Energy" group joining NEA demand with
NBS generation by source and Customs' crude, coal and gas imports (the last
three are in `major_imports` now).

**E. External balance — a few days.** SAFE BoP quarterly and FX settlement
monthly (Excel), MOFCOM FDI and ODI, CFETS index.

**F. Context and high-frequency — as time allows.** NBS international
datasets via the existing crawler; IMF and World Bank APIs; the freight, auto
and port series in a labelled high-frequency group.

## Rules that apply to every addition

- Attribute to the publisher (GAC, PBOC, MOF, NEA, SAFE), never to the mirror;
  record the retrieval channel separately, as the store already does.
- Cumulative year-to-date versus single period stays explicit in the title;
  no January is derived; USD and CNY trade figures are separate series.
- A proxy is labelled a proxy and lives in its own group.
- A source that stops (Caixin) keeps its history and an `ended` flag rather
  than being silently replaced.
- Every new source gets its due rule (release calendar or elapsed-time
  fallback) and its own fetch-log entries, so a source going dark is visible.
