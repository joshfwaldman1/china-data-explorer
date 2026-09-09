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
- 2026-09-09 round 10: audited the share image with live renders of CPI, a
  three-province compare and the 70-city house prices. Title, subtitle,
  quarter labels, end labels, legend and footer all as designed. One defect:
  a four-province compare's URL was cut with an ellipsis in the footer, a
  link nobody can type. A URL that does not fit now gives way to the site
  host alone; test added.
- 2026-09-09 (owner report): the home tagline read "series from the National
  Bureau of Statistics ... plus 18 headline indicators from NBS, the
  People's Bank of China, Customs and Caixin", counting NBS twice. It now
  counts only the non-NBS indicators as additional and says the FRED series
  are about China.
- 2026-09-09 round 11: audited Home, a series page, Provinces and search at
  390 px on the live site. Series page, Provinces and results all lay out
  cleanly (two-column hero tiles, period and sparkline columns dropped from
  the list, tile map fits). One defect: Home's topbar kept an empty dark row
  where the search box sits at phone width, since Home hides that box in
  favour of the hero's. The row is now dropped on Home. Verified live.
- 2026-09-09 round 12: audited dark mode on the live site (Home, the 70-city
  house prices page, Provinces) and the tokens in styles.css. Every one of
  the 27 colour tokens in the light palette is redefined in both the
  system-preference and the toggled dark blocks, with no token that exists
  only in a dark block. The only literal colours are white-on-navy in the
  topbar and the tile map's fixed blue ramp with its own text colours, both
  intended to hold in either theme. Nothing to fix.
- 2026-09-09 round 13: audited keyboard and screen-reader labels on the
  live series page, Home, Provinces and Releases with a DOM probe. Every
  control has an accessible name, every input a label, no duplicate ids, one
  h1 per page, tabs use role=tab with aria-selected, range buttons use
  aria-pressed in a labelled group, menus use menuitem and close on Escape,
  a skip link exists. One defect: the toast carried role=status but was
  only inserted into the page when it fired, which screen readers often
  miss. The live region is now always present and only its text changes.
  Verified live: the region is in the page at rest.
- 2026-09-09 round 14: audited README.md and AGENTS.md against the code.
  The README's API list was missing six of the twelve routes (catalog,
  entry, regional, release-map, schedule, status) and its AKTools section
  still named LPR and electricity as AkShare series, when those now come
  from Eastmoney and NBS and only the Caixin PMIs and the Real Estate
  Climate Index remain. Both corrected; the undocumented environment
  variables are queued. Docs only, no deploy.
- 2026-09-09 round 15: queue item. The README now has a table of all
  seventeen environment variables the server reads, each with its default
  and effect, checked against the code. The Deploying section also said
  "five AkShare-backed series" (three) and called it unverified whether NBS
  answers cloud IPs, which the full crawl from Railway settled. Docs only,
  no deploy.
- 2026-09-09 round 16: audited search for ten researcher queries on the
  live site (car sales, youth unemployment, pork price, exports to the
  United States, local government revenue, cement output, birth rate,
  disposable income, GDP deflator, property investment). Eight led with the
  right series; local budget revenue and a deflator are not NBS monthly
  series. One defect: "exports to the united states" found nothing because
  the matcher wanted every word, including "to" and "the", at a word start
  in a title. English function words now drop out of both matchers, the
  country's names alias to "US", and the three US trade series carry the
  synonyms. Verified live for three phrasings. A follow-up commit fixed the
  test file's import, which the first commit had missed.
- 2026-09-09 round 17: audited ten random stored catalog series on the live
  site. All served from the store with the right units; nine of ten were
  industrial-enterprise finance lines, which is what three quarters of the
  catalog is. Defect: those tables are split by year range at the parent
  category ("按行业分工业企业主要经济指标 (2003-2011)"), not on the series
  name, and families were only formed for a slice on the last category.
  So one series appeared up to four times in search and each page showed
  one slice. Families now form on a slice at any depth of the path
  (11,395 entries affected); the catalog cache format was bumped so the
  cache rebuilt. Verified live: the coal-mining total-assets series is one
  result spanning 2001 to present and its page has 253 points from 2001.
  The visible count is now 9,736 distinct series rather than 14,886 slices,
  and the home tagline follows the count.
- 2026-09-09 round 18: audited Home and the hero tiles on the live site.
  The four hero values match the store (GDP 4.7, CPI 0.8, unemployment
  5.2, PMI 49.8) and the tagline follows the new 9,736 count. Defect: the
  Coverage card had the same wording the owner flagged in the tagline, "18
  headline indicators from NBS, PBOC, Customs and Caixin", reading as
  series on top of the NBS count, and its stored-count line still said the
  crawl was filling in. It now says 11 of the 18 are NBS series already
  counted, plus 4 from the People's Bank of China, 1 from Customs and 2
  from Caixin (computed from the catalog), and that the unstored remainder
  came back empty from NBS. Verified live. Queued: today's already-published
  releases still listed as upcoming.
- 2026-09-09 round 19: queue item. Home's Upcoming NBS Releases and the
  series page's Next release compared a UTC date to the release's China
  Standard Time date and ignored the time of day, so the morning's CPI and
  PPI still showed as upcoming in the evening. Both now compare against the
  release's actual instant (lib.ts releaseTime and isUpcoming, tested).
  Verified live: Home's first upcoming item is 15 September. Surfaced and
  queued: the series page loads only the current month's agenda, so CPI's
  Next release row is empty until October's calendar is in scope. The push
  for this round hung for fifteen minutes and had to be killed and retried.
- 2026-09-09 round 20: queue item. The default `/api/releases` window was
  the current month only, so after a series' last release of the month its
  Next release row vanished (CPI after the 9th). The default now runs
  through the end of next month, matching the scheduler's own horizon.
  Verified live: the agenda returns 26 items to 31 October and the CPI page
  shows "Oct 14, 2026, 09:30 CST" as its next release.
- 2026-09-09 round 21: queue item, the lone PPI slices. Round 17 had
  already stitched the main PPI-by-industry tables. What was left was the
  sub-industry table, where NBS dropped the trailing 业 of every industry
  name between the 2014-2017 and 2018-on slices ("褐煤开采洗选业" became
  "褐煤开采洗选"), so 167 pairs stayed apart. The family key now ignores
  that rename; a local check found no case where it merges two entries of
  one slice. Cache format bumped, test added. Verified live: the lignite
  PPI is one result spanning 2014 to present with 151 points. Visible
  series 9,569.
- 2026-09-09 round 22: queue item. On the Provinces page, picking an older
  period changed the map and ranking but the detail panel's sparkline
  still drew the latest two years. The regional API now windows each
  province's sparkline to the eight quarters ending at the chosen period.
  Verified live: Guangdong at 2020-Q2 shows 2018-Q3 to 2020-Q2, the latest
  period is unchanged, and the earliest period shows the two points that
  exist.
- 2026-09-09 round 23: audited the release calendar and `/api/schedule` on
  the live site. Twenty-one mapped releases through October; the scheduler
  is idle until 15 September as expected. Defect: three October items
  showed Chinese only, since the map did not know NBS's quarterly reports
  on value added by industry, industrial capacity utilisation and the
  culture industries. All three now have English names and catalog
  categories, and titles containing 季度 are refreshed as quarterly. The
  first commit shipped with one stale test expectation, fixed in a
  follow-up. Verified live: 26 agenda items, none unmapped.
- 2026-09-09 round 24: audited `/api/status` failures on the live site.
  Since the AkShare skip the only failures were the 70-city average region
  on most boot ingests: Eastmoney closes the socket while a page body is
  being read, and the page retry only covered a failed connection. The
  retry now repeats the whole request, body included. Verified live: the
  boot ingest after the deploy ran the 70-city table with no failure
  logged. The failure list otherwise holds only pre-fix AkShare rows that
  age out within the week.
- 2026-09-09 round 25: audited the share image with live renders of a
  stitched catalog series over its full 2001-2026 history and a two-line
  money supply chart. Layout, ticks, end labels and footer all right. One
  wording defect: unit labels read Chinese first, "亿元 (100 million
  yuan)", against the rule of English first with the Chinese alongside.
  The shared label now reads "100 million yuan (亿元)" in results, the
  series header, Series Details, the chart caption and the share image
  subtitle. Verified live on the page and in a re-rendered image.
