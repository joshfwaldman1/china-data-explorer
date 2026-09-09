# Improvement loop

A standing loop over the China Data Explorer: each round audits one surface,
fixes what it finds, deploys, verifies on the live site, and records the
result here so the next round (or the next session) starts from the queue,
not from scratch. Rounds are small on purpose.

## How a round runs

1. Pick the top item from the queue (or whatever the last round surfaced).
2. Reproduce it on the live site, not just locally.
3. Fix, typecheck (`bunx tsc --noEmit -p tsconfig.json | grep china-explorer`
   must print nothing), `bun test`, commit, `railway up --detach`, then
   verify the fix on the live URL.
4. Log it below and add anything the round surfaced to the queue.

## Queue (highest value first)

- Backup of the Railway volume: nightly upload of `china.db` to a bucket the
  owner controls. Blocked on a bucket; rebuilding from NBS is thirty minutes,
  revision history is not rebuildable.
- Merchandise Trade split into separate Exports and Imports series (owner's
  call).
- Merge `china-data-explorer` into `main` (owner's call).
- Lone year-range slices under a different parent (seven PPI-by-industry
  tables) stay unstitched; decide whether to merge by name.
- Provinces page: a period selector that also drives the province detail
  sparkline window.

## Log

- 2026-09-09 round 1: search ranked discontinued series ("Crude steel
  sales, year to date", ended 2019) above current ones because the ranker
  had no idea which series still publish. With the full catalog stored, each
  result now carries its stored date range; ranking prefers series with a
  period in the last two years; results show "1998 to 2019 ended" or
  "1989 to Jul 2026".
- 2026-09-09 round 2: NBS series pages had no way to browse the table a
  series came from. A Related Series section now lists up to six siblings
  from the same category (English title, Chinese, frequency, unit) with a
  link to the whole category. One search request, family members excluded.
- 2026-09-09 round 3: audited search for twelve researcher queries on the
  live site (inflation, unemployment, industrial profits, fixed asset
  investment, retail sales, money supply, trade surplus, housing starts,
  coal output, wages, population, electricity). All led with the right
  series. One defect: a year-range family head showed only its own slice's
  range in results ("2024 to Jul 2026" for a table whose stitched history
  runs from 1998), because the range came from the head key alone. Results
  now take the earliest first period across the family's members.
- 2026-09-09 round 4: audited ten random catalog series pages on the live
  site (units, English titles, ranges, stitching, notes). All served from the
  store with sensible ranges; ended sub-series carry the amber notice. One
  inconsistency: index tables based on "same month a year earlier = 100"
  were served raw (99.7) while "same period a year earlier = 100" tables
  defaulted to the percent-change view (-0.3). The default now treats every
  year-on-year base the same; previous-month bases stay an index.
- 2026-09-09 round 5: audited the live home page and hero tiles. All four
  hero values match the store (GDP 4.7, CPI 0.8 for August, unemployment
  5.2, PMI 49.8); this morning's CPI, PPI and home-price releases are on the
  page. One defect: "Ended Sep 2025" wrapped onto two lines in the list's
  period column. Column widened and periods never wrap.
- 2026-09-09 round 6: audited the live Provinces page and
  `/api/regional/provincial_gdp`. All 31 provinces carry Q2 2026, 86 periods
  back to 2005, and the ranking, tile map and detail panel agree. Two
  defects: the tile map card stretched to the ranking column's height,
  leaving a blank half-card under the colour ramp (grid now aligns cards to
  the top), and three UI strings still used em dashes (Provinces note, youth
  unemployment note, first-view loading text), now plain sentences.
  Verified on the live URL after deploy.
- 2026-09-09 round 7: audited the release calendar and `/api/schedule` on
  the live site. Twenty-one upcoming releases through October, all mapped
  to the right series, and this morning's CPI, PPI and home-price refreshes
  ran. One defect: the GDP mapping matched a title NBS never uses, so the
  quarterly GDP announcement (given inside the "national economy" briefing in
  January, April, July and October) would not have triggered a GDP refresh.
  That briefing now carries the `gdp` key and a "quarterly bundle" label in
  those months; a new releases.test.ts covers both cases. Verified on the
  live calendar and schedule for 19 October.
- 2026-09-09 round 8: audited `/api/status` on the live site. Coverage and
  totals are right (1.32M observations, 15,077 keys), but the "last twenty
  runs" list was twenty rows of one regional table's cities, so a failed
  fetch could never be seen there. The status now also returns every error
  from the past seven days (`recentFailures`, newest first, up to 50).
  Verified live: it shows the AkShare "not configured" errors on each boot
  ingest and one transient Eastmoney socket close that succeeded on retry;
  the AkShare noise is queued.
- 2026-09-09 round 9: queue item. Every boot ingest on Railway logged three
  failures for the AkShare-backed series (Caixin PMI x2, Real Estate Climate
  Index) because AKTOOLS_URL=off there, so the new failure list was mostly
  noise. The ingest now skips those series on such a deployment with one
  console line and no fetch_log rows. Verified: the redeployed instance logs
  "Skipping 3 AkShare series" and `/api/status` shows no failures after the
  cutover.
