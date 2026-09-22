# Dataset queue

Worked top to bottom by `DATASET_LOOP.md`, one item per round. Each item
carries the test that defines it as done. Prerequisites in brackets. Refilled
on 21 September 2026 (twice: the morning list ran out by the evening, and
the four items below came from probing the shipped catalog snapshot for
what the site does not carry).

## Queue

1. **The central bank's aggregate-financing tables have changed shape.**
    The Data Health page's first live run showed `tsf_flow` failing on
    "PBOC flow table: header not found" and `tsf_stock` and
    `tsf_stock_growth` on "PBOC stock table: AFRE(stock) row not found",
    ten times each in the window. Aggregate financing is a Home row. This
    goes before the mirror item below by the loop's own rule: a source that
    will not parse is this round's item before anything in the queue.
    Capture the bank's current page as a fixture beside the existing ones,
    find what moved, and keep both layouts readable, as the Customs parser
    now does for its 2020 wording.
    *Test:* the current release parses to the headline the bank states in
    its prose, and the fixture from before the change still parses.

2. **Customs' 2018 layouts.** The by-country table for May to December
    2018 and the commodity tables for parts of 2018, November 2019 and
    February 2020 have neither "Unit:" nor "Value Unit:" above them and fail
    with an empty unit line. Since 22 September 2026 that is a logged gap
    rather than a reason to discard the run — the newest-months rule in
    `layoutBroken` — so the current data and five years of history are
    stored; the older months are simply absent. Finding the pages means
    walking Customs' listing back eight years, one paced request a page, so
    do it as a round of its own: capture one page of each table as a
    fixture, read what the unit line became, and hold both to real figures.
    *Test:* the 2018 fixtures parse to known figures, and the empty-unit
    months no longer appear in the fetch log's warnings.

3. **Move the headline rates off the mirror and onto the bureau's own
    tables.** Five of the site's most prominent series — CPI, PPI,
    industrial production, retail sales and the headline PMI — are read
    from Eastmoney's copy of the bureau's release rather than from the
    bureau's own database, and all five sit on the Home page. This is a
    leftover: the earliest rounds were built when NBS was not answering
    requests, the portal became reachable later, and the original handful
    were never moved. Nothing is wrong with the figures (the audit compares
    each against the bureau's own reading nightly and all agree), but the
    provenance is second-hand for no remaining reason. The bureau's monthly
    dataset carries each of them on the same year-earlier basis; the
    identifiers are in the shipped snapshot under 居民消费价格指数,
    工业生产者出厂价格指数, 规模以上工业增加值 and 社会消费品零售总额.
    Do the same for the four where a publisher reading already exists and
    the Home row still points at the mirror: the bureau's own 70-city house
    prices, the central bank's money stock and reserves, and the finance
    ministry's tax lines.
    *Test:* every Home row reads a publisher's own table, and each pair that
    formerly compared mirror against publisher now compares the publisher
    against a second independent reading or carries a written reason. The
    mirror copies stay in the catalog as audit references, labelled as such,
    so the comparison is not lost.

4. **Transport turnover by mode.** Freight and passenger turnover for road,
    rail, water and air, monthly, as levels and growth (dataset 1, e.g.
    `f24996f5360c47409882a5ccf0a36614` for road freight). Port throughput is
    already carried; the rest of the freight picture is not.
    *Test:* the modes' freight turnover sums to the published total for
    August 2026 within rounding.

5. **Average wages by sector.** The annual average wage of employed persons
    in urban non-private and private units, by industry (dataset 3). The
    site carries household income but nothing about pay.
    *Test:* the latest year parses for every industry the bureau lists, and
    the non-private and private figures differ for every one of them.

6. **Agriculture: grain and meat output.** Annual grain output with its
    summer and autumn components, and pork output (dataset 3). Food prices
    are carried in the consumer price detail; the quantities are not.
    *Test:* summer and autumn grain sum to the year's total within rounding.

- **The IMF's data quality assessment pages.** [parked: dsbb.imf.org serves
  the country pages from a client-rendered application — a plain request
  returns navigation only — and no JSON endpoint behind it answered
  (`/api/sdds/...` and `/api/Country/...` give 404, one gives a redirect).
  Reading them would need a headless browser. The methodology page of
  21 September 2026 was built instead from the paths this repository
  implements and from the publishers' own explanatory notes.]

- **Provincial retail sales.** [parked: NBS publishes the monthly provincial
  table only as a slice ending in 2011 (社会消费品零售总额, 分省月度), so
  there is no current figure to serve. Provincial industry and CPI are
  carried instead. Revisit if NBS posts a current table.]

- **MOHRSS urban new jobs (城镇新增就业).** [parked: mohrss.gov.cn answers
  every request with a script challenge that sets a bot cookie; the site
  does not work around such challenges. NBS's quarterly release quotes the
  figure in prose only.]

- **Auto sales (CAAM).** [parked: caam.org.cn publishes each monthly release as
  an image, and its listing stops at May 2026; MIIT's copy is script-rendered.]

- **PBOC quarterly surveys.** [parked: the bank stopped publishing them. The
  survey listing (diaochatongjisi/116219/116227) ends at the fourth quarter
  of 2025, posted 23 January 2026, and each report is a PDF with no HTML or
  table behind it. Revisit if the bank resumes them or posts the indices as
  data.]

- **Auto sales (CPCA).** [parked: cpcaauto.com answers 403 and
  data.cpcaauto.com redirects to a firewall block page for requests from
  outside China. With CAAM parked for publishing images, NBS's motor vehicle
  retail value is what the site carries instead; unit sales would need a
  request from inside China or a paid feed.]

## Done

- 2026-09-21 — Contributions to GDP growth: `gdp_contributions` and
  `_ytd` (final consumption, capital formation, net exports, as shares of
  the quarter's growth and of the year's), with a Home row for consumption.
  A components pair can now check against a constant whole, so the audit
  holds the three shares to one hundred percent every quarter. Live: the
  second quarter of 2026 was 45.2 percent consumption, 34.0 capital
  formation, 20.8 net exports.

- 2026-09-21 — The release as a first-class entity: `server/arrivals.ts`
  stores the publishers' calendar items as they are fetched and resolves
  every stored point to how it got here — with a release the site watched
  for, as a restatement, or in a backfill of the archive, which names no
  publication date because the site does not know one. Windows are per
  frequency. New routes `/api/arrivals/:key` and `/api/release-log`, and a
  line on every series page. Live: August 2026 industrial output first seen
  the day of the bureau's release.

- 2026-09-21 — A methodology page: `server/methodology.ts`, `/api/methodology`
  and `#/methodology`, linked from every curated series and from the nav. A
  section per path the data takes (publisher, what is read, how, revisions,
  caveats), the site's own handling of a figure, and a generated section per
  key whose check is read from the audit rather than restated. Writing the
  test found three series excused from needing a check by a regular
  expression that mistook two domestic publishers for foreign ones; all
  three now carry reasons. The IMF assessment pages were not usable as the
  source: they are client-rendered with no reachable data endpoint.

- 2026-09-21 — Industrial output by sector: `industrial_output_by_sector`
  and `_ytd` (all 41 two-digit industries, the month and the year to date)
  and `industrial_output_by_division` (mining, manufacturing, utilities),
  labelled with the bureau's own English. The acceptance test reads the
  sixteen industries NBS names in the prose of its August release and holds
  the table to every one, including the one reported as 同比持平. Two
  cumulative pairs, motor vehicles and manufacturing. Live: August 2026
  motor vehicles +8.7%, computers and communications equipment +17.2%,
  mining −1.4%.

- 2026-09-21 — Energy production by type: `electricity_by_source` and
  `_growth` (thermal, hydro, nuclear, wind, solar and the total),
  `fuel_output` (raw coal and crude oil, 万吨), `natural_gas_output`
  (亿立方米) and `fuel_output_growth`, from the bureau's monthly tables,
  with Home rows for raw coal output and solar generation. A third kind of
  concordance pair, `components`, holds the five sources to the published
  total every month; the acceptance test runs it on the captured answer and
  again with one source at a tenth of its size. Live: August 2026 generation
  9,437.8 亿千瓦时 (thermal 6,020.3, solar 700.2), raw coal 36,182.3 万吨.

- 2026-09-21 — Provincial monthly indicators: `provincial_industry` (value
  added of large industrial firms, month and year to date) and
  `provincial_cpi` (index on a year earlier, stored as a rate, two older
  tables stitched behind) for all 31 provinces, six of them on Home. The
  audit's first pair that names a region on both sides checks Guangdong's
  month against its year to date, and a ranking link now says what it ranks.
  Live: Guangdong August industrial output +6.9% (year to date +6.1%),
  CPI +1.0%. Provincial retail sales parked: NBS's monthly table stops in
  2011.

- 2026-09-20 — NEA follow-up, as a bug: August's note wrote its range with
  an em dash the parser did not accept, so the year to date was stored as
  the month (71,730 亿千瓦时 where a month is about 10,000). The parser now
  takes every dash and the release's new phrasing, refuses a month equal to
  its year to date, and a levels pair with `periodWithin` catches one bad
  period rather than only a wholly mislabelled series. Live: August 10,332
  亿千瓦时, up 1.7 percent.

- 2026-09-20 — Structured unit metadata: `shared/measure.ts` turns each
  series' unit sentence into fields (kind, suffix, decimals, change,
  cumulative) once, the catalog ships them, and the page formats from them
  instead of matching regular expressions at render time. A coverage test
  holds every curated series to its unit; writing it found three wrong
  derivations. Live: the loan prime rate reads 3.00%, the birth rate 5.63‰
  changing in points.

- 2026-09-20 — Retail sales by commodity: `retail_by_category` and
  `retail_by_category_growth` (twelve categories, each from its own NBS
  table), with the motor vehicle rate lifted onto Home; CPCA parked. Live:
  August 2026 motor vehicles down 18.5 percent, oil products down 7.

- 2026-09-20 — PMI employment on Home: both surveys' employment indexes
  lifted from the PMI tables into the Labor group; a Home row can now name
  one line of a table in another group. Live: August 2026 manufacturing
  48.7, non-manufacturing 45.4.

- 2026-09-20 — Nominal GDP: `gdp_nominal` (quarter, economy and three
  sectors), `gdp_nominal_ytd` and `gdp_by_industry` (twelve industries)
  from NBS's quarterly current-price table; a cumulative pair on levels; a
  Growth row. Live: Q2 2026 GDP 361,511 亿元 in the quarter, real estate
  21,038.

- 2026-09-20 — Port cargo throughput: `port_throughput` (all ports, foreign
  trade, coastal; month) and `port_throughput_growth` from NBS's monthly
  table, with the 2005-2018 table stitched behind; a Growth row; a
  cumulative pair that says February stands alone here. Live: July 2026
  148,541 万吨, down 2.9 percent.

- 2026-09-20 — SAFE cross-border receipts and payments: `cross_border_flows`,
  `_usd`, `_annual` (net, receipts, payments and the net by account) from
  the 银行代客涉外收付款 workbook, which is a legacy .xls; `server/xls.ts`
  reads that format with no dependency. Two annual-sum pairs, a Home row,
  nine tests. Live: August 2026 receipts 52,718 亿元, payments 48,486,
  net 4,232, matching SAFE's release.

- 2026-09-20 — Tax revenue by type: `tax_by_type` and `tax_by_type_growth`
  (twelve taxes, year to date) from the ministry's fiscal release. Live:
  July 2026 domestic VAT +6.1%, personal income tax +14.9%.

- 2026-09-20 — Index of services production: `services_production` (month
  and year to date, YoY %) from NBS's monthly table; a cumulative pair
  between its lines; a Growth row. Live: August 2026 +4.1% (year to date
  +4.7%), pair ok. The queue was refilled the same round.

- 2026-09-19 — Local government bonds: `lgb_issuance` (the month's issuance,
  total, general, special, new, refinancing), `lgb_debt` (debt outstanding
  at month end) and `lgb_rate` from the Ministry of Finance's Debt
  Management Department release; two Home rows; fixtures for two years'
  wording and the listing. Live: July 2026 issuance 7,383 亿元, debt
  outstanding 592,411 亿元 (August not yet released).

- 2026-09-18 — Household income and spending: `household_income_growth`,
  `household_income`, `household_spending_growth`, `household_spending`
  from NBS's quarterly survey (national, urban, rural; year to date); an
  NBS line can name its own table; two Home rows; an id test. Live: H1 2026
  disposable income +4.2% nominal (urban 3.4, rural 5.5), spending +2.7%.

- 2026-09-17 — Rural migrant workers: `migrant_workers` (away from home at
  the quarter's end, 万人) and `migrant_workers_income` (monthly income,
  yuan) from NBS's quarterly survey table; an id test; MOHRSS parked. Live:
  Q2 2026 19,227 万 away from home, income 5,118 yuan.

- 2026-09-17 — Yuan central parity and the CFETS RMB index:
  `central_parity` (five pairs, month's last fixing), `_average`, and
  `cfets_rmb_index` (three baskets); a pair of the parity average against
  the Fed's monthly average (band 0.15). One test. Live: September 2026 so
  far USD/CNY 6.758, CFETS index 101.49.

- 2026-09-17 — CFETS money-market rates: `shibor` (five tenors) and
  `repo_fixing` (FDR007 first; the DR weighted averages are on no endpoint
  the site reaches, so the fixing is served and named) as the month's last
  fixing, with `_average` companions. One test. Live: September 2026 so
  far, overnight SHIBOR 1.46, FDR007 1.43.

- 2026-09-17 — SAFE bank FX settlement and sales: `bank_fx_settlement`
  (yuan), `_usd`, `_annual` from the 银行结售汇 workbook (seven lines each);
  an annual-sum concordance kind and two pairs; a headline reader. Live:
  August 2026 net settlement 3,290 亿元 (settlement 17,090, sales 13,800),
  matching SAFE's release.

- 2026-09-17 — 70-city house prices from NBS's own table: `house_prices_nbs`
  (71 cities, new and existing homes), region-aware concordance, a Beijing
  pair. One test. Live: Beijing July 2026 −2.3% on both paths.

- 2026-09-17 — PMI sub-indices: `pmi_manufacturing` (14 lines) and
  `pmi_nonmanufacturing` (12) from NBS's tables; two pairs; an id test.
  Live: August 2026 manufacturing PMI 49.8, new orders 50.6.

- 2026-09-17 — CPI by category, 2021-2025 slice: NBS keys can stitch earlier
  year slices; `cpi_detail` runs from October 2024. One test. Also: English
  for every top-level category and every title (pinyin where the dictionary
  cannot), the stored catalog re-glossed. MOFCOM weekly prices parked.

- 2026-09-16 — Prices beyond the headlines: `cpi_detail` (core, food, non-food,
  consumer goods, services, housing) and `ppi_detail` (producer and consumer
  goods), two pairs, an id test. Live: August 2026 core CPI 1.0%, producer
  goods PPI 5.0%. MOFCOM weekly prices and the 2021-2025 CPI slice queued.

- 2026-09-16 — Industry: `industrial_profits` (+levels), `capacity_utilisation`,
  and output growth of crude steel, cement, automobiles, NEVs and ICs; four
  pairs; an id test. Live: July 2026 profits +17.6% YTD, Q2 capacity 73.0%.
  Also fixed: a Customs month that will not parse (the January-February
  totals table) no longer empties the trade store.

- 2026-09-16 — Fixed-asset investment: `fai`, `fai_by_industry`,
  `fai_funding` from NBS's monthly tables, year to date and titled so;
  three pairs; an id test. Live: July 2026 −6.7%, manufacturing −1.7%.

- 2026-09-16 — Property activity: nine keys from NBS's monthly tables
  (investment, floor space sold, sales value, starts/completions/under
  construction, developers' funds), year to date and titled so; four pairs;
  an id test. Live: July 2026 investment −19.2%, floor space sold −11.8%.
  Unsold stock is not in the monthly database.

- 2026-09-16 — PBOC's own monetary tables and the reserves template: keys
  `money_stock`, `money_stock_growth` (computed, audited against the
  published rate), `official_reserves` (PBOC's copy of the reserves
  template — the SAFE item is answered by it) and `bank_credit`. Seven
  fixtures, five tests, three pairs. Live: August 2026 FX reserves 34,383.25
  亿美元, M2 growth 7.5.

- 2026-09-16 — SAFE's preliminary quarter: the adapter reads the 初步数
  release for the quarter the workbook lacks; seven items lead by a quarter.
  Three fixtures, two tests. Live confirmation of the Q2 2026 point waits on
  the next headline sweep (checked in the next round).

- 2026-09-16 — Release days for NEA, PBOC, MOF and MOFCOM series (21st, 15th,
  25th, 22nd); the page names the day. One test. Live: 21 keys carry one.
  May 2026 electricity consumption is an image in NEA's fuller release, so
  it stays absent (moved to a follow-up).

- 2026-09-16 — Concordance pairs for the rest of the curated set: four new
  pairs (both PMIs, M1, electricity output) and a `NO_PAIR` list with a
  reason for every other domestic-publisher key, held by a coverage test.
  Live: 17 pairs, 0 findings.

- 2026-09-16 — Trade growth from Customs' own release: the adapter reads the
  monthly totals table; `trade` serves Customs' own rates on release day
  and `trade_values` the levels; the mirror is `trade_mirror` for the audit.
  Two tests. Live: August 2026 exports +25.0, imports +28.2. The pairs sit
  at 0.25, a revision's size, because the mirror carries Customs' later
  revision — not the 0.05 the item asked for, and for a reason recorded in
  the pair.

- 2026-09-16 — NBS international datasets: codes 12, 13, 14 crawled and
  merged (80 indicators; 66,302 browsable series), geography "International"
  end to end, country lists collected with the continent groups unioned,
  English names for 42 countries. Three tests. Live: US CPI July 2026 3.4
  percent year on year, 42 countries on the ranking page.

- 2026-09-16 — Customs in CNY: the adapter takes a denomination; keys
  `trade_partners_cny`, `major_exports_cny`, `major_imports_cny` in 亿元,
  apart from the USD keys. Two fixtures, four tests. Live: US exports August
  2026 2,886.1 亿元 (the USD table says 42,475.3 million; 6.80 implied).

- 2026-09-16 — MOFCOM FDI: `server/mofcom.ts`, keys `fdi_actual_use` (亿元,
  year to date, by sector), `fdi_new_enterprises` (two paths, audited),
  `fdi_growth`, `fdi_actual_use_usd` (ended 2023-07). Four fixtures, five
  tests. Live: July 2026 actual use 4,383.3 亿元 (−6.2%), 37,711 new
  enterprises on both paths.

- 2026-09-16 — SAFE balance of payments: `server/safe.ts` over a new
  dependency-free workbook reader `server/xlsx.ts`; key
  `balance_of_payments`, twelve BPM6 items, 亿美元. The real workbook is the
  fixture; four tests. Live: Q1 2026 current account 1,843.1, goods 2,474.77,
  reserve assets −479.41.

- 2026-09-16 — MOF fiscal data: `server/mof.ts`, keys `fiscal_revenue`,
  `fiscal_expenditure`, `land_sale_revenue`, `fiscal_growth`, all year to
  date and titled so. Seven fixtures, six tests, a concordance pair against
  the mirror's tax series. Live: July 2026 revenue 143,696 亿元 (+5.8%), land
  sales 11,731 (−30.8%).

- 2026-09-16 — PBOC aggregate financing: `server/pboc.ts`, keys `tsf_flow`,
  `tsf_stock`, `tsf_stock_growth`, read from the bank's own yearly tables
  (pbc.gov.cn answered from abroad and from Railway). Four fixtures, five
  tests. Live: August 2026 stock 464.8 trillion yuan, growth 7.2 percent,
  flow 16,577 亿元.

- 2026-09-16 — NEA electricity demand: `server/nea.ts`, keys
  `electricity_demand` (亿千瓦时, month and year to date, by user group) and
  `electricity_demand_growth`; feed and four page fixtures, five tests, a
  concordance pair. Live: July 2026 10,400 亿千瓦时, +1.7%, year to date
  61,399.

- 2026-09-15 — Trade section: US, EU and ASEAN rows on the home page; the
  partner ranking page ranks by exports, imports or balance, names Customs,
  and sets the Total apart. First headless render test in the repo
  (`trade-home.test.ts`, Playwright on the installed Chrome). Live: US
  exports August 2026 42,475.3 million USD on the home page; 30 partners in
  the ranking API. Surfaced: groupings (Belt and Road, RCEP, APEC) rank beside
  countries; a filter could separate them.

- 2026-09-15 — Customs release-day timing: `server/customs-calendar.ts` reads
  the year's calendar from the English site and merges the preliminary
  releases into `/api/releases`, so the release plan refreshes the four
  Customs-sourced keys ten minutes after publication and the page names the
  next one; `due.ts` takes a release day per source and those keys carry the
  14th. The English site has no 2026 calendar yet; when Customs posts it the
  items appear without a change here. Test: fixture parses for 2024 and 2025;
  live: the September 2025 window carries the 8 September item.

- 2026-09-15 — Concordance audit, after the owner found GDP serving the
  half-year rate (4.7) under a quarterly label (4.3 is the quarter). GDP is
  now NBS's own quarterly table, quarter and year to date both served.
  `server/concordance.ts` pairs each curated headline with an independent
  reading and `/api/audit/concordance` runs the pairs; every round starts
  there. Surfaced: the mirror's export growth trails NBS's by 0.1-0.2 pp in
  revised months (item added below).

- 2026-09-15 — Customs backfill: the ingest tells the adapter the oldest month
  stored per partner and each run adds 24 older months, oldest first, until
  the English listing ends; the listing walk stops on a repeated page. Customs
  changed the by-country header twice since 2023 and the parser refused the
  older layouts, so fixtures for 2024 and 2023 were added and the parser reads
  all three. Pacing moved onto real fetches only (a cached page cost 800 ms
  before). Test: two runs on a fresh store took 81 s and 136 s, 30 partners
  stored, the US series back to 2021-09, August 2025 US exports 31,604 stored
  and 31,604 published.

- 2026-09-15 — Government bond yields (CFETS): `server/cfets.ts`, key
  `cgb_yields`, 1y/2y/5y/10y/30y month-end closes. One request per month
  returns every key tenor for every trading day. Fixture from August 2026,
  three tests (tenor coverage, month-end rule, malformed input). Live: 10-year
  1.6879 at end-August 2026, 1.6884 mid-September. Daily closes are not yet
  stored (the store has no daily frame); noted in the adapter.

- 2026-09-15 — Phase A: consumer confidence, enterprise boom index, tax
  revenue YTD, foreign-currency loans, commodity price index (Eastmoney).
  Tested by ingesting each locally; live on production.
- 2026-09-15 — Phase B first version: `server/customs.ts`, three keys,
  fixtures from the August 2026 tables, five parser tests. Live: US exports
  42,475.3 million USD in August 2026.

## Needs the owner

- Whether to make the repository public. A collaborator was added on
  21 September 2026: GitHub user `Evanzvu` holds a pending write invitation.
  The account carries no name or affiliation, so confirm it is the person
  intended before they accept.
- `BACKUP_TOKEN` set on Railway and as a repository secret, to enable the
  nightly store copy.
- Anthropic API credit, for the remaining-glosses item and for search query expansion.
