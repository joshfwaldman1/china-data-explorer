# Dataset queue

Worked top to bottom by `DATASET_LOOP.md`, one item per round. Each item
carries the test that defines it as done. Prerequisites in brackets.

## Queue

1. **Customs backfill to 2022.** `fetchCustomsRegion` takes the last 36
   months on a first view; the ingest should carry `trade_partners`,
   `major_exports` and `major_imports` back to the first month the English
   listing has (2022, possibly earlier: walk until a page has no dated links).
   Bounded: at most 24 new months per ingest run, oldest first, so a run is
   minutes not hours; every table read is cached per run.
   *Test:* after two ingest runs `/api/status?series=1` shows 30 partners
   for `trade_partners` each with a `firstPeriod` of 2022 or earlier; the
   August 2025 value for the United States equals the August 2025 table.

2. **Customs release-day timing.** Customs publishes around the 7th to the
   13th; the site's due rule assumes the 20th. Give a curated key its own
   release day (`releaseDay` on the indicator) and use it in `expectedPeriod`
   and the release plan; add the Customs calendar
   (`ColumnId=4`, "Release calendar of 2026") as a mapped release so the
   refresh fires ten minutes after publication.
   *Test:* `dueReason("Monthly", "2026-07", checkedOn9th, on12thSeptember)`
   is `new-period` for a Customs key and `null` for an NBS key.

3. **A Trade section on the home page.** `trade_partners` on the home list
   with the US, EU and ASEAN rows named; the Provinces-style ranking page
   reached from it ("All places") ranking partners by exports, imports or
   balance for the chosen month.
   *Test:* headless render of `#/` shows the Trade group; `#/regions?key=trade_partners`
   renders a ranking of 30 rows and its CSV download has 30 data rows.

4. **NEA electricity demand.** Map the news listing on nea.gov.cn to the
   monthly "全国电力工业统计数据" item, parse 全社会用电量 (month and year to
   date, 亿千瓦时) and consumption by the three industries and households;
   curated key `electricity_demand`, agency National Energy Administration.
   *Test:* a fixture of one release parses to the four figures; the latest
   month's total matches the release text; the series page renders.

5. **PBOC total social financing.** Probe pbc.gov.cn's monthly statistics
   release (社会融资规模存量/增量) for a foreign-reachable table; if blocked,
   record it and fall back to the Eastmoney or jin10 report AkShare uses
   (`macro_china_shrzgm`), labelled by channel. Keys `tsf_stock`, `tsf_flow`.
   *Test:* fixture parse; the latest stock matches the PBOC release to one
   decimal (trillion yuan).

6. **MOF fiscal revenue, expenditure and land sales.** mof.gov.cn monthly
   release; keys `fiscal_revenue`, `fiscal_expenditure`, `land_sale_revenue`,
   cumulative year to date and labelled so.
   *Test:* fixture parse; latest cumulative revenue matches the release.

7. **SAFE balance of payments.** Quarterly Excel from safe.gov.cn: current
   account, goods, services, primary income, financial account, reserve
   assets. Key `balance_of_payments` with six labels, USD billion.
   *Test:* fixture (one Excel) parses to six figures for the latest quarter;
   the current account matches SAFE's headline release.

8. **MOFCOM FDI actual use.** Monthly cumulative, CNY, from
   data.mofcom.gov.cn (AkShare reads it). Key `fdi_actual_use`.
   *Test:* fixture parse; latest matches the ministry's release.

9. **Customs in CNY.** The same three Customs tables in CNY (the
    denomination the bureau's growth rates are quoted in), as separate keys
    with `_cny` suffixes; never mixed with the USD series.
    *Test:* August 2026 US exports in CNY equal the CNY table.

10. **NBS international datasets.** Probe `queryIndexTreeAsync?code=11..14`
    through `scripts/portal.ts` for 三大经济体月度数据 and 主要国家年度数据;
    if they exist, add the codes to `sync-nbs-catalog.ts`, crawl, merge.
    *Test:* the merged catalog gains a dataset with geography
    "International" and a series page renders for one of its entries.

11. **Remaining English glosses.** [needs API credit] `bun run
    china:translate --concurrency=8` for the 14,244 annual base concepts
    still on the token dictionary, then `china:translate-notes`.
    *Test:* `gloss-en.json` entry count rises above 55,000; a sample of ten
    annual titles that read as Chinese fragments now read as English.

12. **High-frequency group.** Freight index (`macro_china_freight_index`)
    and Baltic indices in a group labelled "High-frequency (commercial)".
    *Test:* each series labelled with its channel; the home page does not list
    them.

## Done

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
- Anthropic API credit, for item 12 and for search query expansion.
