# Seasonal adjustment labels

Checked 3 October 2026. The label describes the publisher's series, not a transformation performed by ChinaStats. Smoothing, aggregation, indexing, year-over-year growth and year-to-date presentation do not establish seasonal adjustment. Unknown metadata must never default to “Not seasonally adjusted.”

## Verified classifications

| Series | Classification | Evidence |
| --- | --- | --- |
| NBS PMI headline and all manufacturing/non-manufacturing sub-indices, including employment and the composite output index | Seasonally adjusted | [NBS January 2026 PMI release, section 5](https://www.stats.gov.cn/english/PressRelease/202602/t20260202_1962478.html) states that all released indices are adjusted. Applies to the curated series and the corresponding three NBS catalog tables. |
| NBS catalogue GDP quarter-on-quarter growth (`nbs_88bcaf76058e49b08a45b14a204b2d3d`) | Seasonally adjusted | The catalogue indicator definition explicitly says its quarter-on-quarter rate is seasonally adjusted and calculated at constant prices. Read from the source `note`, not inferred from “quarter-on-quarter.” |
| Caixin manufacturing PMI | Seasonally adjusted | [S&P Global manufacturing release](https://www.pmi.spglobal.com/Public/Home/PressRelease/81823e7f64204b7ba2ef1c803cacbefb) identifies the headline adjusted index. |
| Caixin services PMI | Seasonally adjusted | [S&P Global services release](https://www.pmi.spglobal.com/Public/Home/PressRelease/7edab8209d2246279f622725025f6d51) identifies the adjusted business activity series and explains adjustment-factor revisions. |
| NBS real estate climate index | Seasonally adjusted | [NBS methodology, section 4](https://www.stats.gov.cn/english/PressRelease/202510/t20251022_1961654.html) removes seasonal effects in constructing this index. This does not apply to the property's investment/sales levels. |
| OECD composite leading indicator | Seasonally adjusted | [FRED CHNLOLITOAASTSAM](https://fred.stlouisfed.org/series/CHNLOLITOAASTSAM), source OECD, explicitly labels the series seasonally adjusted. Amplitude adjustment alone is not used to infer this. |
| OECD consumer confidence | Seasonally adjusted | [FRED CSCICP02CNM460S](https://fred.stlouisfed.org/series/CSCICP02CNM460S), source OECD, explicitly labels the series seasonally adjusted. |
| Curated GDP quarter and YTD year-over-year growth | Not seasonally adjusted | [NBS GDP accounting](https://www.stats.gov.cn/english/PressRelease/202607/t20260717_1964160.html), section 2.4, distinguishes the seasonally adjusted quarter-on-quarter calculation. The curated key uses the original quarter/YTD year-over-year index table; it does not use that quarter-on-quarter series. |
| Customs monthly USD exports/imports levels and growth; trailing three-month mean of those growth rates | Not seasonally adjusted | [Customs monthly bulletin](https://english.customs.gov.cn/statics/report/monthly.html), the source used in the methodology repair. These are the original reported monthly observations; the trailing arithmetic mean does not perform seasonal adjustment. |

## Resolution and display

Explicit per-line adjustment metadata/labels take precedence, followed by explicit series metadata/labels, scoped catalogue assertions, verified series keys, and the named NBS PMI tables. Annual source data are identified as annual/not applicable only in the absence of a more specific source adjustment classification. Unresolved classifications remain `unknown` internally and have no adjustment badge. Absence of a badge does not establish NSA.

Labels appear on topic cards, the series chart and table, Home sparklines, province-profile rows and regional rankings. Mixed comparisons name each track with a confirmed classification; a confirmed track alongside an unknown one never gives the entire chart its status. CSV includes confirmed adjustment metadata, and PNG reserves an adjustment line only when it has text, independent of optional notes; mixed PNG legends use SA/NSA/SAAR only for confirmed tracks. SAAR is distinct from SA when explicitly stated.

## Catalogue evidence

The shipped NBS catalogue (captured 16 September 2026) has indicator definitions (`note`, collected from `i_mark`) and table annotations (`annotation`, from `i_annotation` or the hierarchy explanation), rather than a universal adjustment field. Reviewed examples are captured verbatim in `server/fixtures/nbs-adjustment-metadata.json`.

- GDP quarter-on-quarter growth defines the current indicator as seasonally adjusted. Its short name is only “GDP,” so scope is matched against the full indicator name.
- Non-manufacturing PMI states that all published data are seasonally adjusted. This annotation now directly supplies the classification.
- Manufacturing PMI's shared annotation discusses revisions to the expectations index's adjustment method. That statement alone does not classify other sub-indices; their status comes from the separate NBS methodology covering all PMI indices.
- Surveyed unemployment definitions and annotations do not state seasonal adjustment. No status is inferred from their silence.
- International trade annotations describe US SA and Japanese NSA observations together. They are not scanned for a blanket keyword classification, nor applied to every country. International GDP notes similarly mention US annualized growth alongside other countries.

The resolver therefore recognizes direct assertions about the named indicator or all published data. It does not scan arbitrary methodology prose for the phrase “seasonally adjusted,” and it does not classify all other NBS series as NSA.

Composed topic charts retain each input's classification. Ratios/shares with inconsistent input classifications are unknown, rather than inheriting the first input's status. Frequency conversion, moving averages and rebasing preserve the original adjustment classification.

The registry is deliberately limited to the evidence above. Extending it requires the actual source definition for the exact series, not a guess based on another series from the same agency.
