# Dataset queue

Worked top to bottom by `DATASET_LOOP.md`, one item per round. Each item
carries the test that defines it as done. Prerequisites in brackets.

## Queue

1. **Remaining English glosses.** [needs API credit] `bun run
    china:translate --concurrency=8` for the 14,244 annual base concepts
    still on the token dictionary, then `china:translate-notes`.
    *Test:* `gloss-en.json` entry count rises above 55,000; a sample of ten
    annual titles that read as Chinese fragments now read as English.

2. **PMI sub-indices from NBS's table.** New orders, production, employment,
   supplier deliveries, inventories from the monthly database (采购经理指数
   category), as a key beside `pmi`.
   *Test:* August 2026 new orders parses and the headline PMI pair stays ok.

3. **70-city house prices from NBS's own city table.** The city monthly
   dataset (code 7) carries 新建商品住宅销售价格指数 by city; serve the
   `house_prices` rows from it with the mirror kept for the audit.
   *Test:* Beijing August 2026 new-home index equals the mirror's row.

4. **NEA follow-ups.** May 2026 consumption is an image in the fuller
   release; watch for a text version or a later revision table. The demand
   note's day is set (the 21st).
   *Test:* May 2026 appears on the month line, from text, not derived.

5. **High-frequency group.** Freight index (`macro_china_freight_index`)
    and Baltic indices in a group labelled "High-frequency (commercial)".
    *Test:* each series labelled with its channel; the home page does not list
    them.

## Done

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
