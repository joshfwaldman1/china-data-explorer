# Dataset queue

Worked top to bottom by `DATASET_LOOP.md`, one item per round. Each item
carries the test that defines it as done. Prerequisites in brackets.

## Queue

1. **Remaining English glosses.** [needs API credit] `bun run
    china:translate --concurrency=8` for the 14,244 annual base concepts
    still on the token dictionary, then `china:translate-notes`.
    *Test:* `gloss-en.json` entry count rises above 55,000; a sample of ten
    annual titles that read as Chinese fragments now read as English.

2. **NEA follow-ups.** May 2026 consumption is an image in the fuller
   release; watch for a text version or a later revision table. The demand
   note's day is set (the 21st).
   *Test:* May 2026 appears on the month line, from text, not derived.

3. **Property: developer financing and mortgages.** [parked: source not
   found] From PBOC's quarterly 金融机构贷款投向统计报告: real estate loans
   outstanding, mortgages (个人住房贷款) and their growth. On 16 September
   none of the survey-and-statistics department's sections nor the news
   listing carried the report and the listings do not paginate under
   index_N.html; try the bank's site search, the 货币政策执行报告 (quarterly,
   with the same figures in its text), or a headed browser on the listing.
   *Test:* Q2 2026 mortgage balance parses from the release and matches the
   bank's headline.

4. **MOFCOM weekly prices.** [parked: source not found] The weekly
   食用农产品 and 生产资料 market price indices are not on price.mofcom.gov.cn
   (its columns — 监测周报, 粮农土畜, 能源化工, 经贸简讯 — hold international
   commodity monitoring, trade news and daily briefs; the list endpoint is
   `POST /datamofcom/front/price/list` with `cid=yjzx/jczb&pageNumber=N`),
   and the ministry's news list carries no weekly market-price item in 2026.
   Try the 商务预报 site (cif.mofcom.gov.cn) or the weekly item in 每日经贸简讯.
   *Test:* one report parses to the two indices.

5. **High-frequency group.** [blocked: needs AKTools on the deployment] Freight index (`macro_china_freight_index`)
    and Baltic indices in a group labelled "High-frequency (commercial)".
    *Test:* each series labelled with its channel; the home page does not list
    them.

- **MOHRSS urban new jobs (城镇新增就业).** [parked: mohrss.gov.cn answers
  every request with a script challenge that sets a bot cookie; the site
  does not work around such challenges. NBS's quarterly release quotes the
  figure in prose only.]

- **Auto sales (CAAM).** [parked: caam.org.cn publishes each monthly release as
  an image, and its listing stops at May 2026; MIIT's copy is script-rendered.
  CPCA (乘联会) is the remaining candidate; probe before building.]

## Done

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

- A decision on whether to make the repository public or add a Carnegie
  China colleague as a collaborator (handle needed).
- `BACKUP_TOKEN` set on Railway and as a repository secret, to enable the
  nightly store copy.
- Anthropic API credit, for the remaining-glosses item and for search query expansion.
