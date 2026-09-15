# Dataset queue

Worked top to bottom by `DATASET_LOOP.md`, one item per round. Each item
carries the test that defines it as done. Prerequisites in brackets.

## Queue

1. **Customs release-day timing.** Customs publishes around the 7th to the
   13th; the site's due rule assumes the 20th. Give a curated key its own
   release day (`releaseDay` on the indicator) and use it in `expectedPeriod`
   and the release plan; add the Customs calendar
   (`ColumnId=4`, "Release calendar of 2026") as a mapped release so the
   refresh fires ten minutes after publication.
   *Test:* `dueReason("Monthly", "2026-07", checkedOn9th, on12thSeptember)`
   is `new-period` for a Customs key and `null` for an NBS key.

2. **A Trade section on the home page.** `trade_partners` on the home list
   with the US, EU and ASEAN rows named; the Provinces-style ranking page
   reached from it ("All places") ranking partners by exports, imports or
   balance for the chosen month.
   *Test:* headless render of `#/` shows the Trade group; `#/regions?key=trade_partners`
   renders a ranking of 30 rows and its CSV download has 30 data rows.

3. **NEA electricity demand.** Map the news listing on nea.gov.cn to the
   monthly "全国电力工业统计数据" item, parse 全社会用电量 (month and year to
   date, 亿千瓦时) and consumption by the three industries and households;
   curated key `electricity_demand`, agency National Energy Administration.
   *Test:* a fixture of one release parses to the four figures; the latest
   month's total matches the release text; the series page renders.

4. **PBOC total social financing.** Probe pbc.gov.cn's monthly statistics
   release (社会融资规模存量/增量) for a foreign-reachable table; if blocked,
   record it and fall back to the Eastmoney or jin10 report AkShare uses
   (`macro_china_shrzgm`), labelled by channel. Keys `tsf_stock`, `tsf_flow`.
   *Test:* fixture parse; the latest stock matches the PBOC release to one
   decimal (trillion yuan).

5. **MOF fiscal revenue, expenditure and land sales.** mof.gov.cn monthly
   release; keys `fiscal_revenue`, `fiscal_expenditure`, `land_sale_revenue`,
   cumulative year to date and labelled so.
   *Test:* fixture parse; latest cumulative revenue matches the release.

6. **SAFE balance of payments.** Quarterly Excel from safe.gov.cn: current
   account, goods, services, primary income, financial account, reserve
   assets. Key `balance_of_payments` with six labels, USD billion.
   *Test:* fixture (one Excel) parses to six figures for the latest quarter;
   the current account matches SAFE's headline release.

7. **MOFCOM FDI actual use.** Monthly cumulative, CNY, from
   data.mofcom.gov.cn (AkShare reads it). Key `fdi_actual_use`.
   *Test:* fixture parse; latest matches the ministry's release.

8. **Customs in CNY.** The same three Customs tables in CNY (the
    denomination the bureau's growth rates are quoted in), as separate keys
    with `_cny` suffixes; never mixed with the USD series.
    *Test:* August 2026 US exports in CNY equal the CNY table.

9. **NBS international datasets.** Probe `queryIndexTreeAsync?code=11..14`
    through `scripts/portal.ts` for 三大经济体月度数据 and 主要国家年度数据;
    if they exist, add the codes to `sync-nbs-catalog.ts`, crawl, merge.
    *Test:* the merged catalog gains a dataset with geography
    "International" and a series page renders for one of its entries.

10. **Remaining English glosses.** [needs API credit] `bun run
    china:translate --concurrency=8` for the 14,244 annual base concepts
    still on the token dictionary, then `china:translate-notes`.
    *Test:* `gloss-en.json` entry count rises above 55,000; a sample of ten
    annual titles that read as Chinese fragments now read as English.

11. **Trade growth from Customs' own release.** The `trade` headline
    (exports and imports, YoY %) comes from the Eastmoney mirror, which holds
    the first print while NBS's table carries Customs' revision (June 2026:
    26.9 against 27.0). Serve it from NBS's monthly table (出口总值同比增长,
    进口总值同比增长) or from the Customs English headline table, and tighten
    the concordance pair back to 0.05.
    *Test:* the exports pair passes at tolerance 0.05 over six months.

12. **Concordance pairs for the rest of the curated set.** PMI, new loans, FX
    reserves, house prices, electricity output and the Phase A series have
    no pair yet; find each one's catalog entry (FX reserves and GDP levels
    are not in the monthly national dataset under the names tried) or its
    publisher's companion and add it.
    *Test:* every curated key with an NBS or PBOC source appears in
    `CONCORDANCE_PAIRS` or carries a comment saying why not.

13. **High-frequency group.** Freight index (`macro_china_freight_index`)
    and Baltic indices in a group labelled "High-frequency (commercial)".
    *Test:* each series labelled with its channel; the home page does not list
    them.

## Done

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
