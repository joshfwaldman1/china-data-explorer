# Seasonal adjustment labels

Checked 3 October 2026. The label describes the publisher's series, not a transformation performed by ChinaStats. Smoothing, aggregation, indexing, year-over-year growth and year-to-date presentation do not establish seasonal adjustment. Unknown metadata must never default to “Not seasonally adjusted.”

## Verified classifications

| Series | Classification | Evidence |
| --- | --- | --- |
| NBS PMI headline and all manufacturing/non-manufacturing sub-indices, including employment and the composite output index | Seasonally adjusted | [NBS January 2026 PMI release, section 5](https://www.stats.gov.cn/english/PressRelease/202602/t20260202_1962478.html) states that all released indices are adjusted. Applies to the curated series and the corresponding three NBS catalog tables. |
| Caixin manufacturing PMI | Seasonally adjusted | [S&P Global manufacturing release](https://www.pmi.spglobal.com/Public/Home/PressRelease/81823e7f64204b7ba2ef1c803cacbefb) identifies the headline adjusted index. |
| Caixin services PMI | Seasonally adjusted | [S&P Global services release](https://www.pmi.spglobal.com/Public/Home/PressRelease/7edab8209d2246279f622725025f6d51) identifies the adjusted business activity series and explains adjustment-factor revisions. |
| NBS real estate climate index | Seasonally adjusted | [NBS methodology, section 4](https://www.stats.gov.cn/english/PressRelease/202510/t20251022_1961654.html) removes seasonal effects in constructing this index. This does not apply to the property's investment/sales levels. |
| OECD composite leading indicator | Seasonally adjusted | [FRED CHNLOLITOAASTSAM](https://fred.stlouisfed.org/series/CHNLOLITOAASTSAM), source OECD, explicitly labels the series seasonally adjusted. Amplitude adjustment alone is not used to infer this. |
| OECD consumer confidence | Seasonally adjusted | [FRED CSCICP02CNM460S](https://fred.stlouisfed.org/series/CSCICP02CNM460S), source OECD, explicitly labels the series seasonally adjusted. |
| Curated GDP quarter and YTD year-over-year growth | Not seasonally adjusted | [NBS GDP accounting](https://www.stats.gov.cn/english/PressRelease/202607/t20260717_1964160.html), section 2.4, distinguishes the seasonally adjusted quarter-on-quarter calculation. The curated key uses the original quarter/YTD year-over-year index table; it does not use that quarter-on-quarter series. |
| Customs monthly USD exports/imports levels and growth; trailing three-month mean of those growth rates | Not seasonally adjusted | [Customs monthly bulletin](https://english.customs.gov.cn/statics/report/monthly.html), the source used in the methodology repair. These are the original reported monthly observations; the trailing arithmetic mean does not perform seasonal adjustment. |

## Resolution and display

Explicit per-line adjustment metadata/labels take precedence, followed by explicit series metadata/labels, verified series keys, and the named NBS PMI tables. Annual source data are identified as annual/not applicable only in the absence of a more specific source adjustment classification. All other observations say “Seasonal adjustment not verified.” This is a limitation of the available metadata, not a claim about the publisher's statistical procedure.

Labels appear on topic cards, the series chart and table, Home sparklines, province-profile rows and regional rankings. Mixed comparisons list each track's classification. CSV includes adjustment metadata, and PNG reserves an adjustment line independent of optional notes; mixed PNG legends use SA/NSA/SAAR. SAAR is distinct from SA when explicitly stated.

Composed topic charts retain each input's classification. Ratios/shares with inconsistent input classifications are unknown, rather than inheriting the first input's status. Frequency conversion, moving averages and rebasing preserve the original adjustment classification.

The registry is deliberately limited to the evidence above. Extending it requires the actual source definition for the exact series, not a guess based on another series from the same agency.
