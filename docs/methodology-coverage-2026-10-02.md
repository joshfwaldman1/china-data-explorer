# Methodology and coverage repairs, 2 October 2026

Aggregate goods trade now reads Customs' USD monthly bulletin (table 1B), which publishes January and February separately. The preliminary release remains the source for partner and commodity tables. Aggregate charts therefore wait for the later bulletin. The three-month chart averages three consecutive published monthly year-over-year rates and leaves an incomplete window blank; it no longer substitutes February's cumulative growth for January and February.

The live adapter check returned 104 consecutive observations on every growth line, January 2018 through August 2026. The January 2026 export/import rates are 10.0/26.9 percent, and February's are 39.6/14.7 percent. These are published rates, not inferred from cumulative figures.

## Revisions and vintages

A dated release is not necessarily the latest estimate of its reference period. Customs explicitly warns that later verification can change earlier figures. The latest available issue for each reference year supplies published growth rates; newer issues' restated levels take precedence. Rates are not recalculated from separately revised levels, so the two need not reproduce each other exactly. December 2025 exports illustrate the revision: USD 357.747 billion in that month's issue, USD 357.238 billion in August 2026's issue. This comparison proves a later restatement, not that the old page was edited.

Customs bulletin pages and parsed MOF, MOFCOM and NEA releases are cached for six hours rather than assumed immutable. Normal refreshes recheck them. The existing append-only store retains previously observed values; its fetch timestamp is when ChinaStats observed the value, not the agency's original publication date. This work does not reconstruct vintages from before the site began collecting them.

## Other repaired gaps

- Fiscal revenue and land sales: recognize legacy single-month titles such as `2024年4月财政收支情况`. The contents remain year to date. The captured April release reports revenue 80,926 and land-sale revenue 10,536, both in 100 million yuan.
- FDI: recognize January and em-dash ranges. Captured official releases restore January 2026's 920.1 and September 2024's 6,406 in 100 million yuan, year to date.
- Local-government bonds: retain valid issuance when an unrelated debt field is unavailable; recognize an abbreviated debt unit only when the explicitly yuan-denominated components corroborate the total. This restores February 2025 issuance 13,057/debt 492,859 and March 2026 issuance 10,843/debt 572,587, in 100 million yuan. Monthly issuance cannot fall through to the cumulative section.
- Electricity demand: an official NEA regional republication supplies May 2026, missing from the central feed: month 8,671 and YTD 42,018 in 100 million kWh. The central release takes precedence if it reappears.

## Remaining limits and rollout

The older MOF budget-department bond archive returned HTTP 403 during this audit. The adapter attempts it after the current department listing and reports access failures while preserving current releases. Pre-2025 history is not verified complete. Private PMI continuity and older bond-yield history remain separate follow-ups.

These are adapter and chart changes, not edits to production or the seed store. After deployment the normal full-history refresh can backfill and record revisions. To refresh the affected keys explicitly on the deployment, use its normal ingestion job with `trade trade_values fiscal_revenue fiscal_expenditure fiscal_growth land_sale_revenue tax_by_type tax_by_type_growth fdi_actual_use fdi_growth fdi_new_enterprises lgb_issuance lgb_debt lgb_rate electricity_demand electricity_demand_growth`. Inspect ingestion failures and stored observations afterward; a parser fixture alone is not evidence of a production backfill.

## Captured official sources

Raw fixtures were captured on 2 October 2026. The monthly index fixtures preserve the publisher's links to table 1B; their titles and units are validated before values are accepted.

| Fixture | Publisher URL |
| --- | --- |
| customs/monthly-index-2026.html | http://english.customs.gov.cn/statics/report/monthly.html |
| customs/monthly-index-2025.html | http://english.customs.gov.cn/statics/report/monthly2025.html |
| customs/monthly-index-2024.html | http://english.customs.gov.cn/statics/report/monthly2024.html |
| customs/monthly-2026-08.html | http://english.customs.gov.cn/Statics/d14f71f5-1ac9-431f-b8d7-b7a7a0b58af7.html |
| customs/monthly-2025-12.html | http://english.customs.gov.cn/Statics/47f852cc-48dd-40c9-ab75-fde038835f2f.html |
| customs/monthly-2024-12.html | http://english.customs.gov.cn/Statics/b0374bf4-d2a1-4eb2-99cf-0e54574ef707.html |
| mof/listing-index-2024.htm | https://gks.mof.gov.cn/tongjishuju/index_3.htm |
| mof/release-2024-04.html | https://gks.mof.gov.cn/tongjishuju/202405/t20240517_3935136.htm |
| mof/bonds-2025-02.html | https://zwgls.mof.gov.cn/tjsj/202511/t20251101_3975520.htm |
| mof/bonds-2026-03.html | https://zwgls.mof.gov.cn/tjsj/202605/t20260508_3989284.htm |
| mofcom/release-2026-01.html | https://www.mofcom.gov.cn/xwfb/rcxwfb/art/2026/art_e3ade82446a440e698ae1e89eeedafb8.html |
| mofcom/release-2024-09.html | https://www.mofcom.gov.cn/xwfb/rcxwfb/art/2024/art_911c061b76804c4f8cdfafb5fd34e367.html |
| nea/release-2026-05-republished.html | https://xbj.nea.gov.cn/dtyw/hyxx/202606/t20260626_303637.html |
