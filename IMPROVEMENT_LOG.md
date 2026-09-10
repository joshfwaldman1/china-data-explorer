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
- 2026-09-09 round 26: audited the Releases calendar, Browse and a series
  page's Table view with the Share menu open at 390 px on the live site.
  Browse, the table and the menu lay out cleanly. One defect: the
  calendar's day column was 72 px with 16 px padding each side, so "Sep
  15" broke onto two lines while "Sep 9" fit. The column is 76 px with
  tighter padding and the label never wraps. Verified live.
- 2026-09-09 round 27: audited dark mode on the surfaces round 12 did not
  cover: the Releases calendar, search results, and a series page's Table
  view with the Share menu open. Day column, links, the auto-translated
  badge, category paths, table rows and the menu all read correctly on the
  dark panels. Nothing to fix.
- 2026-09-09 round 28: audited keyboard and screen-reader labels on Browse,
  search results and Provinces with the DOM probe. Static checks clean on
  all three. One defect: each ranking row on Provinces was announced as
  "Tibet6.3", name and value run together, and the list had no group label
  while the tile map did. Rows now carry "Tibet, 6.3%" and the list is a
  labelled group. Verified live.
- 2026-09-09 round 29: audited the README and AGENTS.md against the code
  after this week's changes. Five stale passages: the README still described
  the old SVG "PNG export" rather than the share image, said AkShare covered
  four extras (three), and told deployers to seed and cron the ingest by
  hand (the boot seed, the crawl and the in-process schedulers do it);
  AGENTS.md said the catalog was stored "by use" (the crawl stores it) and
  described families only for a slice on the last category. All rewritten
  to match the code. Docs only, no deploy.
- 2026-09-09 round 30: audited search for ten more researcher queries on
  the live site (trade balance, fixed asset investment, rail freight,
  electricity consumption, housing completions, core inflation, mortgage
  rate, foreign direct investment, 工业增加值, a pinyin phrase). Seven led
  with the right series; FDI is a MOFCOM series NBS stopped in 2019, and
  the pinyin phrase did not match an interior segment, both honest. Two
  vocabulary gaps fixed: "core inflation" and "core cpi" now lead with
  CPI excluding food and energy (they led with PMI price indexes), and
  "mortgage rate" finds the loan prime rate (it found nothing). Verified
  live. Noted, not changed: two NBS tables share the indicator name "Fixed
  asset investment, year-to-date growth" (the overview and the by-registration
  table), so two results carry the same English title.
- 2026-09-09 round 31: audited ten random stored series from ten
  non-industry categories on the live site. Units, English titles, ranges
  and values all sound. One of the ten was served "live" although stored:
  the on-view path re-fetched any stored copy older than 24 hours, even
  with no new period due, costing the viewer an NBS round trip and NBS a
  request for nothing. The view now uses the scheduler's own due rule
  (server/due.ts), and the NBS_STORE_TTL_HOURS variable is gone from code
  and docs. The first commit shipped without the due check's time
  argument, which the typecheck flagged but the chain did not gate on; the
  corrected build replaced it 25 seconds after it went live. Verified live:
  five stored series untouched since 8 September all come from the store.
  Latency note: every endpoint answers in about a second from here, of
  which the server's share is under 0.2 s; the rest is the distance to
  Railway's region.
- 2026-09-09 round 32: audited Home and the hero tiles on the live site.
  Hero values and deltas match the store, and the NBS Categories grid
  counts equal the search totals per category. One defect: the Provincial
  Real GDP Growth row (and its series page with no region chosen) showed
  Beijing's 5.4 under a note that describes Guangdong, because the series
  route fell back to the first province listed rather than the entry's
  configured default. It now serves the configured default. Verified live:
  Guangdong 4.5 by default, Beijing on request, and the 70-city average
  still the default for home prices.
- 2026-09-09 round 33: audited the Provinces page's interactions on the
  live site: selected Guangdong and Shanghai from the tile map, added both
  to the comparison, and switched the period to Q2 2020. Map colours,
  ramp breaks, ranking with its zero anchor (Hubei at -19.5 that quarter),
  the detail panel and its sparkline window, and the comparison chips all
  updated together. Nothing to fix.
- 2026-09-09 round 34: audited the release calendar and `/api/schedule` on
  the live site across months. The schedule holds 24 releases from 15
  September; the calendar returns distinct, fully mapped agendas for
  August, November and December, and empty ones for 2027, which NBS has not
  published. Defect: an unpublished future month read "NBS lists no
  releases for this month", as if none were planned. It now says the
  calendar is not published yet and that the coming year's schedule
  appears each December; a past or current empty month keeps the old
  wording. Verified live for February 2027. (An earlier check in this
  round returned "rate-limited" errors, which were my own malformed date
  parameters, not the server.)
- 2026-09-09 round 35: audited `/api/status` coverage on the live site. All
  43 headline keys are stored with sensible first and last periods (SHIBOR
  ends May 2026, where FRED's OECD series stops). Since 13:00Z the sweep had
  logged three transient failures: two dropped sockets (new loans,
  unemployment) and one FRED 502, none costing data since the stored copies
  were current. Only the 70-city loader retried. Every upstream request
  (Eastmoney, NBS headline and catalog, FRED) now goes through one
  fetchJson helper in server/http.ts that retries once on a dropped socket,
  timeout or 5xx and passes 4xx through; three tests cover it. The first
  attempt inserted the import inside a synonym string, which the typecheck
  gate caught before any commit. Verified live: the boot ingest after the
  deploy ran with every run ok and no failure, and all source kinds serve.
- 2026-09-09 round 36: audited the share image with two live renders not
  yet covered: a one-year window with the Lunar New Year band on, and the
  ended Caixin PMI. The band, month ticks and end label render right.
  Defect: the image of a discontinued series said nothing about it having
  ended, while the page carries an amber notice; anyone seeing the picture
  alone would read September 2025 as current. Share images now carry
  "<series> ended in <period>; the last value shown is the final one
  published" in the notes line. Verified live on the Caixin image.
- 2026-09-09 round 37: audited a catalog series page, the Options panel and
  the Add series popover at 390 px on the live site. The panel and popover
  lay out cleanly. Two overflow defects on the series page, both from text
  with no break points: the Series Details card's Chinese category path
  widened the grid column past the screen, and the citation's URL pushed
  the Copy button off it, so the page scrolled sideways (layout viewport
  524 px). Grid columns now floor at zero and both values wrap. Verified
  live with a DOM measure: the catalog page, CPI and a two-province
  compare all lay out at exactly 390 px with no element past the edge.
- 2026-09-09 round 38: audited dark mode on Browse, the Provinces page with
  a province selected and a comparison started, and the chart tooltip's
  styles. Category cards, the selected tile's ring, the detail panel, chips
  and ranking all read correctly on the dark panels, and the tooltip
  draws only from theme tokens (panel, line, muted, shadow). Nothing to
  fix.
- 2026-09-09 round 39: walked the keyboard path on the live series page.
  Focus rings are visible (2 px solid), and the tab order runs skip link,
  brand, search, nav, theme, then the 43 sidebar links before the page's
  own controls, which is what the skip link is for. Defect: the skip link
  was a plain "#main" anchor, and routes live in the hash, so activating
  it changed the hash to "#main" and the router sent the user to Home
  with focus in the Home search box. It now moves focus to the main
  region without touching the hash. Verified live: on the CPI page the
  hash stays "#/series/cpi", the heading stays, and focus lands on main.
- 2026-09-09 round 40: audited the docs' numbers and scheduling claims
  against the code and the live counts. Every count quoted matches today's
  live numbers (9,569 visible series, 42 curated of which 24 from FRED).
  Defect: AGENTS.md's "Keeping the store current" described two
  schedulers and omitted the two that matter most on release days, the
  agenda-driven release-day refresh with its retry rule and the fixed
  headline sweeps. Both are now documented, with `/api/schedule` named as
  the place to see the plan. Docs only, no deploy.
- 2026-09-09 round 41: audited search for ten fresh researcher queries on
  the live site (steel production, auto exports, consumer confidence,
  wages, renminbi, reserves, solar panels, semiconductor output, online
  retail sales, government spending). Seven led with the right series.
  Three vocabulary gaps fixed: "auto exports" found nothing (now the
  automobile export delivery table), "semiconductor output" led with
  generic value added (now integrated circuit output), and "solar panels"
  led with solar power generation (now solar cell output). Test added.
  Verified live. Noted: "vehicle output" leads with truck output, which
  shares the alias and has the shorter title.
- 2026-09-09 round 42: audited one random stored series from each of ten
  further categories on the live site (external trade, finance, fiscal,
  agriculture, services, PMI, unemployment, fixed-asset investment, price
  indices, industry). Units, ranges, transforms and sources all sound.
  Defect: the PMI sub-indexes carry the same English title in the
  manufacturing and the non-manufacturing tables ("New orders index"
  twice, "Employment index" twice), and the PMI "Producer price index"
  reads as the PPI, so a series page or share image could not say which
  it was. Titles in those two tables now carry the table, "Manufacturing
  PMI: new orders index", the way CPI components read "CPI: pork". Cache
  format bumped, test added. Verified live: all 27 PMI titles distinct.
- 2026-09-09 round 43: audited Home's hero tiles and Upcoming NBS Releases
  card on the live site. Hero links, sparkline windows and search chips
  are right. Defect: a release row linked only to headline series, so the
  real estate release led solely to the Real Estate Climate Index, whose
  mirror stopped in December 2025, and the fixed-asset investment release
  had no link at all. Every row now also links to the NBS category the
  release updates ("Real estate series"), on Home and on the Releases
  page. Verified live: the Sep 15 rows carry category links, including
  fixed-asset investment.
- 2026-09-09 round 44: followed the Provinces page's outbound links on the
  live site. "Open series" for Hainan and "Chart 2 provinces together"
  both open the right pages with the right region, legend and range.
  Defect: a single province's page named the province nowhere in its
  header (only in the stat line and the region picker), while the compare
  page already had "Tibet, compared with Hainan" under the title. A single
  regional series now carries the place under the title, "Hainan 海南省",
  except for the national and 70-city-average views. Verified live on the
  Hainan, Beijing home prices, 70-city default and compare pages.
- 2026-09-09 round 45: audited the release calendar and `/api/schedule`
  after a day of some thirty deploys. The plan rebuilds correctly on every
  boot (24 upcoming, the seven 15 September timers set). Defect: the
  "last release-day refresh" field lived in memory, so every deploy reset
  it to null and the audit surface could never show what the last release
  did. Each refresh is now recorded in the fetch log under the key
  release_refresh (series advanced, attempt number, release name) and read
  back at boot; a store test covers the round trip. Verified live: the new
  build plans 24 releases and reports health. The field will first show a
  value after the 15 September releases.
- 2026-09-09 round 46: audited `/api/status` for the catalog's currency.
  Of 15,034 stored national series, 4,904 monthly ones stand at July 2026
  and 370 quarterly ones at Q2 2026; the rest end at slice boundaries
  (2002, 2011, 2017) as family members, or are discontinued heads: 371 in
  the "by registration type" table whose slice ends in 2023, and 590 old
  accounting terms (cost of principal business and the like) that NBS
  replaced with operating cost and revenue in 2019. Those show as ended,
  which is right. No failed fetch since 14:00Z. Nothing to fix.
- 2026-09-09 round 47: audited the share image with two live renders: a
  single-province GDP page and a PMI sub-index. The PMI image carries its
  new qualified title. Defect: the Hainan image was titled "Provincial
  Real GDP Growth" and named the province nowhere, so the picture alone
  could not say which province it showed. A single province's or city's
  image is now titled "Provincial Real GDP Growth: Hainan", matching the
  compare style; national and 70-city-average views are unchanged.
  Verified live on the Hainan and Beijing home price images.
- 2026-09-09 round 48: measured the layout width at 390 px on eight live
  page types (Home, Browse, a category listing, search results, Provinces,
  Releases, Saved, a four-province compare). None scrolled sideways.
  Defect: in search results and category listings the category path was
  one no-wrap line, up to 620 px wide, so on a phone its most specific
  segment was the part cut off. The path now wraps at phone width.
  Verified live: both pages measure with no element past the screen and
  the paths read in full.
- 2026-09-09 round 49: re-checked dark mode after the week's CSS edits.
  All 27 colour tokens are still defined in the light palette and both
  dark blocks; the literal colours outside the token blocks are the same
  white-on-navy topbar and tile-map ones as before. Live dark renders of
  search results with ended flags and of the empty Saved page read
  correctly. Nothing to fix.
- 2026-09-10 round 50: probed the chart controls by keyboard on the live
  CPI page. The Chart/Table tablist moves focus with the arrow keys, and
  Add series moves focus into its search box on open. Defect: pressing
  Escape closed the popover but dropped focus to the document body, so a
  keyboard user landed back at the top of the page. Closing the popover
  (Escape, the button, or picking a series) now returns focus to the Add
  series button. Verified live: after Escape the button is focused and
  reports collapsed.
- 2026-09-10 round 51: audited the docs against the code. Five mechanisms
  added this week were described nowhere: the shared upstream fetch and
  its retry rule (server/http.ts), the release-refresh record kept in the
  fetch log, the table-qualified PMI titles, the release-time helpers on
  the client, and the loop's rule of gating a commit on the typecheck.
  All five are now in AGENTS.md or LOOP.md, across two commits: the first
  shipped only the AGENTS.md part because the edit script stopped on a
  wording mismatch, and the second carried LOOP.md and this entry. Docs
  only, no deploy. The round-50 push turned out to have landed before it
  stalled; the retry reported the remote up to date.
- 2026-09-10 round 52: audited search for ten Chinese-language and
  abbreviated queries on the live site. Seven were right. Defects: a
  Chinese phrase had to appear whole, so "猪肉价格" found nothing although
  猪肉 and 价格 both sit in the CPI pork titles, and the abbreviations 固投,
  社融 and 规上 were unknown. A phrase that appears nowhere whole now
  matches by its two-character pieces, and the abbreviations expand. The
  first commit scored that fallback above whole-phrase hits and shipped
  with a failing test, because the chain gated only on the typecheck; the
  corrected build replaced it after 45 minutes, most of that a hung push.
  The chain now stops on a failing test too. Verified live: 猪肉价格 leads
  with CPI pork, 固投 with fixed asset investment, and an exact Chinese
  title keeps the top. 社融 still finds nothing, honestly: social
  financing is not in the store. Two search requests stalled for over two
  minutes from here during the nightly ingest while health answered in
  two seconds; not reproduced afterwards.
- 2026-09-10 round 53: audited the PPI and CPI component pages, which
  round 52 had flagged. The gloss table named index components both ways,
  "PPI, food" (155 entries) beside "PPI: clothing" (189), so neighbouring
  results and pages disagreed on the convention. Titles are now normalised
  to the colon form where they are composed, with the cache format bumped
  and a test. Verified live: all 59 PPI-prefixed and 43 CPI-prefixed
  titles use the colon; the three plain CPI titles are the "excluding
  food and energy" lines, which carry no component.
- 2026-09-10 round 54: measured Home's first load on the live site. It
  made 21 API requests in two steps: the catalog, stats and releases, then
  one request per headline series once the catalog had arrived, so the
  tiles filled about half a second after the page could have shown them.
  A new `/api/home` returns every headline series with its last 24 points
  in one payload (26 KB), requested on mount alongside the catalog; the
  per-series requests remain only as a fallback if it fails. The first
  commit sent that request twice, once on mount and again when the
  catalog arrived; the second commit sends it once. Verified live: four
  requests, the headline payload finishing at the same moment as the
  catalog, all tiles and rows filled.
- 2026-09-10 round 55: audited the Provinces page's data on the live site.
  The regional API has all 31 provinces for the latest, 2015 and 2008
  periods with no gaps across 86 quarters, and with the map switched to
  Q4 2008 every tile's value matched the API (Inner Mongolia 16.5 at the
  top, a floor of 8.0), with the ranking and colour legend following.
  Nothing to fix.
- 2026-09-10 round 56: audited the release map's category side against
  the live catalog, the part of the release-day refresh not yet exercised
  before 15 September. Every category named by the 23 mappings is a real
  top-level category with series in it (industry 7,189, price indices
  1,134, down to the services production index with 2), so each release
  will refresh due series in the right tables. Several releases at the
  same hour name the same category, which is harmless: a series refreshed
  by the first is no longer due for the next. Nothing to fix.
- 2026-09-10 round 57: audited `/api/status` for growth and the revision
  trail. The store holds 1,315,187 observations (ten more than a day ago,
  a quiet stretch between releases) at 454 MB; the newest failure is from
  13:19Z yesterday, before the shared retry landed. No series has a
  recorded revision yet, headline or catalog, which is expected after
  three days: NBS restates figures rarely and the append-only store is
  covered by the store tests. The first real revisions should appear with
  the 15 September releases. Nothing to fix.
- 2026-09-10 round 58: audited the share image on frequency-converted
  views and found two defects, one behind the other. First, industrial
  production converted to annual drew an empty chart with the image
  actions disabled: the conversion demanded twelve months per year, and
  NBS publishes January and February of the activity series as one
  reading. A year or quarter now counts as complete once its closing month
  is in and at most one reading is missing; test added. Second, the
  annual view then ran only to 2014: since 2015 the store had no February
  point at all for industrial production or retail sales, because
  Eastmoney leaves the February row's monthly column empty and carries the
  combined January-February growth only in the year-to-date column. Those
  fields now name that column as the February fallback; a test covers it,
  and the series notes say the February point is the combined figure.
  Verified live after the boot ingest: both series carry every February
  from 2015 to 2026 (industrial production 6.3 for Feb 2026, retail sales
  2.8), and both annual and quarterly conversions draw. Electricity output
  from NBS's own portal has the same gap and is a separate path; queued.
- 2026-09-10 round 59: queue item. Electricity output, fetched from NBS's
  own portal, had no February point in twelve of the last fourteen years
  for the same reason: the monthly indicator is empty for February while
  the table's year-to-date growth indicator carries the combined
  January-February figure. The NBS headline fetch now requests that
  indicator alongside and uses its February value when the monthly one is
  empty; a test covers the pick, and the series note says so. Verified
  live after the boot ingest: every February from 2013 to 2026 is present
  (4.1 for February 2026), July 2026 unchanged at -0.1. With rounds 58 and
  59 the three activity series NBS publishes this way are all whole.
- 2026-09-10 round 60: measured the remaining page types at 390 px on the
  live site: a four-series compare (lede, four chips, the quarterly-average
  notice, the "four series is the most" note) and a catalog page down to
  its Related Series cards. Both lay out at exactly 390 px with no element
  past the edge. Nothing to fix.
- 2026-09-10 round 61: re-checked dark mode. The only stylesheet change
  since round 49 (the result path wrap) touched no colour, and the one
  dark surface not yet rendered, a chart with the Lunar New Year bands and
  the amber suspension band, draws every band, label and line from theme
  tokens and reads correctly on the dark panel. Nothing to fix.
- 2026-09-10 round 62: checked what a screen reader is given for the
  numbers, using Chrome's accessibility tree on the live site. Hero tiles
  expose their full text ("Gross Domestic Product 4.7% Real GDP (YoY %),
  Q2 2026, -0.3 pp"). Defect: the series page's stat line carried
  aria-label="Latest observation", and on a paragraph that label replaces
  the content, so the reader heard the label and never the value. It is
  now a visually hidden prefix inside the line, with a hidden ", " between
  the value and its unit so the two are not run together as "0.8Percent".
  Verified live: the line reads "Latest observation: 0.8, Percent change
  from year ago, Aug 2026. Up 0.3 pp from Jul 2026." with no aria-label,
  and looks unchanged on screen.
- 2026-09-10 round 63: audited the docs against the code since round 51.
  Four mechanisms were undocumented: the `/api/home` payload, the
  two-character piece fallback in search, the colon convention for index
  component titles, and the January-February handling on both fetch
  paths with the conversion rule that goes with it. The README's API
  list and AGENTS.md now carry all four, the last as its own section
  since it explains a data convention a reader would otherwise mistake
  for a gap. Docs only, no deploy.
- 2026-09-10 round 64: audited search for ten queries with typos,
  questions, hyphens and plurals on the live site. Two gaps fixed: a
  hyphen inside a phrase blocked the alias ("fixed-asset investment"
  found nothing where "fixed asset investment" found 343), and "yoy" was
  not a word the search knew ("exports yoy" found nothing). Queries are
  now normalised once, a hyphen between letters becoming a space with
  "16-24" and hex ids untouched, and yoy, y/y, year on year and year over
  year all mean 同比. Test added. Verified live: both queries lead with
  the right series and the controls are unchanged. Not changed: a typo
  ("unemployement") and a question ("how much is china's cpi") still
  miss or mis-rank, and "population growth" finds nothing because the
  only population series is annual and outside the monthly catalog.
  Three requests came back empty for a moment right after the deploy,
  the container switch, and answered normally a minute later.
- 2026-09-10 round 65: audited ten current monthly catalog series for the
  January-February gap that rounds 58 and 59 fixed in the headline
  series. Every "current period" level and every monthly growth rate in
  NBS's activity tables (diesel, coal, smartphones, cigarettes, steel bar,
  export deliveries, retail above designated size) lacked all Februaries,
  while the year-to-date series of the same table carries the combined
  figure there; diesel's year-to-date February (3,147) less March (4,799.9
  cumulative) reconciles with March's current period (1,650.5). A served
  monthly series whose name is a current-period level or a monthly growth
  rate now takes its missing February points from that sibling, stored
  points only, and the page says so in its notes; pure helpers under
  test. Verified live: diesel's current period and growth carry February
  2026 (3,147 and 1.6), the year-to-date series is unchanged, coal fills
  too, and the diesel page grew from 192 to 390 points. The typecheck gate
  caught a regex slip in the client type before any commit.
- 2026-09-10 round 66: audited Home after the February fixes. The home
  payload's 24-point sparklines for industrial production, retail sales
  and electricity now include February 2025 and February 2026, so the
  list's sparklines and deltas see the combined readings; CPI, which never
  had the gap, is unchanged. One request for the payload came back empty
  once from here and answered normally on retry, 26 KB in 1.3 s. Nothing
  to fix.
- 2026-09-10 round 67: audited the Provinces page's share path with a
  live render of the four-province compare its "Chart together" link
  builds (Tibet, Hainan, Beijing, Guangdong). The title names all four,
  the legend distinguishes the four line styles, and the four end labels
  (6.3, 5.4, 4.5, 2.0) are spread without collision. Nothing to fix.
- 2026-09-10 round 68: audited what 15 September will do. The daily due
  rule does not call August due for a monthly series until the 21st, but
  the release-day refresh does not use it: it fetches the mapped headline
  keys outright and refreshes every stored catalog series in the release's
  categories whose latest period is below the release's target (August),
  batched by table. So the 10:10 CST refresh will act on the day, with
  fifteen-minute retries if the portal lags, and the daily rule stays the
  backstop from the 21st. Nothing to fix; the first live run is four days
  away.
- 2026-09-10 round 69: audited the cost of `/api/status` itself. Its
  per-series table is 15,177 rows, 2.6 MB uncompressed, and answers in
  about three seconds from here, two of them transfer; the server's share
  is cached for five minutes. A client that accepts gzip, as every browser
  does, receives 418 KB in 2.2 s, and search results come as 9 KB, so
  compression is already on at the edge. The store stands at 1,315,231
  observations with no failure since 13:19Z on the 9th. Nothing to fix.
- 2026-09-10 round 70: audited the share image's time axis, which round
  58 had noticed labelling annual points "Jan 09, Jul 09". The tick rule
  chose years only for spans over six years, whatever the data's
  frequency. It now takes the coarsest visible frequency: annual points
  always get year ticks, quarterly ones beyond three years, monthly ones
  keep the old rule. Test added. Verified live: a six-year annual view of
  industrial production reads 2016 to 2020, and the five-year quarterly
  GDP moved from "Jul 21, Jan 22" to whole years.
- 2026-09-10 round 71: measured the surfaces changed since the last
  mobile audit at 390 px on the live site: the CPI page with its hidden
  stat-line prefix and a catalog page whose notes now carry the February
  sentence. Both lay out at exactly 390 px. One copy nit fixed from the
  same screenshot: the Series Details "Retrieved via" row read "the NBS
  data portal", a lowercase fragment where every other source string
  starts with the source's name; it now reads "NBS's own data portal".
  Verified live.
- 2026-09-10 round 72: dark mode. No stylesheet change since round 61 and
  the one share-image change since then touched tick placement, not
  colour; the 27 colour tokens remain defined in the light palette and
  both dark blocks. Nothing to fix.
- 2026-09-10 round 73: probed the Table view and the Options panel for
  screen readers on the live site. The Options controls are labelled by
  wrapping labels and the table's column headers carry scope, but the
  table had no caption or label, so a reader entering it heard only
  "table, 3 columns, 187 rows". Both the data table and the revisions
  table now carry a visually hidden caption naming the series, unit and
  frequency. Verified live: the caption reads "New Home Prices, 70
  Cities: Percent change from year ago, monthly data, one row per period,
  newest first." and stays invisible.
