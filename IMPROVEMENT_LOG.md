# Improvement loop

A standing loop over the China Data Explorer: each round audits one surface,
fixes what it finds, deploys, verifies on the live site, and records the
result here so the next round (or the next session) starts from the queue,
not from scratch. Rounds are small on purpose.

## How a round runs

1. Pick the top item from the queue (or whatever the last round surfaced).
2. Reproduce it on the live site, not just locally.
3. Fix, typecheck (`bun run typecheck`
   must print nothing), `bun test`, commit, `railway up --detach`, then
   verify the fix on the live URL.
4. Log it below and add anything the round surfaced to the queue.

## Queue (highest value first)

- Home rows and hero tiles whose title names a level for a growth figure
  ("Gross Domestic Product" 4.3%, "Consumer Price Index" 0.8%, "Producer
  Price Index" 3.8%), and monthly rows that do not say "month on a year
  earlier". Owner's call on the naming pattern; the audit's proposals are in
  the 2026-09-25 log entry.
- Long-term backup retention and recovery drills. The verified nightly workflow
  now targets 90-day GitHub artifacts, with matching service/repository credentials.
  Add independent object storage and measure recovery time; revision history
  cannot be rebuilt from today's publisher data. See OPERATIONS.md.
- Merchandise Trade split into separate Exports and Imports series (owner's
  call).
- Legibility: split `client/app.tsx` (1,603 lines, 57 functions) into one
  file per page plus a shared chart file, and `server/nbs-catalog.ts`
  (1,193 lines) into loading, families, search and glossing; reflow the
  JSX lines over 200 characters. Mechanical, one page per round (owner's
  call, raised 2026-09-11).
- 258 catalog titles are still shared across tables after the year-range
  pass (2026-09-30): those whose tables lack a range, or share one. Titles
  whose table name only partly leads the title ("Total losses of
  loss-making enterprises: Total Losses of Loss-making ...") still read
  the words twice.

## Log

- 2026-09-30 (round: the series Table view): three live tables (CPI, the
  Japan partner, an NBS catalog series) render with no null, NaN or
  undefined cells and no page errors, newest first. One defect, the same
  one the CSV had: a catalog series' single line is labelled with its
  place in Chinese (全国), and that label headed the table's value column.
  The track for a catalog series with one line is now named by the
  series' English title, so the table, the legend and the CSV all read
  "Finished goods of medium-sized industrial enterprises, 2023-present
  (100 million yuan)". Checked on a local build. Verified: typecheck
  clean, 524 tests; CI and the deploy watched after the push.
- 2026-09-30 (owner-directed: tidy the repository before adding a
  collaborator): an audit found no secrets in the tree or the history, no
  personal paths, the stores ignored, CI green. The top level carried
  leftovers: HANDOFF.txt (stale: it still described the datatool split),
  screenshot.png (31 August, the old interface), three unused portal
  captures, AGENTS.md and CLAUDE.md as identical copies, and three
  planning documents beside the code. Removed the first three (captures/
  is now ignored; scripts/capture-area.ts creates it when it runs), moved
  PROJECT_BRIEF.md, COVERAGE_PLAN.md and FRED_PARITY.md to docs/, made
  CLAUDE.md a one-line import of AGENTS.md, and rewrote the README's file
  list. LOOP.md, IMPROVEMENT_LOG.md, DATASET_LOOP.md and DATASET_QUEUE.md
  stay at the root because the loops read them by path. Every reference to
  a moved or removed file was updated. Verified: typecheck clean, 524
  tests; CI watched after the push.
- 2026-09-30 (round: a mixed-frequency comparison): nothing to fix. CPI
  compared with GDP on the live site converts CPI to quarterly averages,
  says so in a notice and in the chart note, leaves out Q3 2026 (only two
  of its months are published), draws GDP's quarter and year-to-date lines
  with their own legend, and throws no page errors.
- 2026-09-30 (round: Browse and a category page): nothing to fix. CI green
  on 7d9669e. Browse at 1280 pixels leads every card with English and the
  Chinese beneath, groups by dataset (national monthly 8,776 series,
  quarterly 793, annual 52,964), and nothing overflows; the Price indices
  category page renders its English and Chinese heading with no overflow.
- 2026-09-30 (round: the release calendar page): the calendar's content is
  right, and today's PMI release now lists both sub-index series. Its
  series links ran together as plain grey text six pixels apart,
  "Consumer Price Index Consumer Price Index by Category Price indices
  series", so a reader could not tell where one link ended; a comma would
  not separate them because titles carry commas ("..., Year to Date").
  Each link now has its own underline in the 3:1 line colour and 14
  pixels between links, on the calendar and in the release lists. Checked
  on a local render at 1280 pixels. Verified: typecheck clean, 524 tests.
- 2026-09-30 (round: the slow catalog test, from the queue): nothing to
  fix. On CI "every entry carries an English gloss and pinyin" takes 1.2
  to 1.5 seconds in each of the last six runs. Its one 39-second local
  failure was the local catalog.db going stale when GLOSS_FORMAT moved to
  33 earlier in the day, so the next local run rebuilt all 79,836 entries
  inside the test; later local runs are quick. CI builds from a fresh
  checkout each time and is unaffected.
- 2026-09-30 (round: the CSV download): downloaded three CSVs from the
  live site (a partner, a two-series comparison, an NBS catalog series).
  The partner and comparison files were right (CPI's blank rows before
  2008 are where its source begins). The catalog series file was not in
  the site's language: its "# Series" line was the bureau's Chinese title,
  its unit 亿元, and its one column was named 全国, because the export took
  the raw title and the line label where the page uses the English title.
  The export now writes the page's English title with the Chinese in
  brackets, the unit as the page shows it ("100 million yuan (亿元)"), and
  names a single-line series' column by that title. Verified: typecheck
  clean, 524 tests; the file from a local build reads in English; the live
  file follows the deploy.
- 2026-09-30 (round: CI and every headline series' latest period): CI is
  green on c4b19b1 and the nightly backup workflow is 5 for 5. Of the 153
  headline series, 20 sit behind their usual period and none is a defect:
  three ended on purpose (Caixin manufacturing and services PMI, MOFCOM's
  USD FDI), the Real Estate Climate Index stops at December 2025 as
  flagged, and the rest are FRED-carried international series on their
  publishers' lags (BIS credit and property prices quarterly to Q4 2025 or
  Q1 2026, US trade and Treasury holdings to July, World Bank annual to
  2024, Gini to 2022). The quarterly Eastmoney keys (enterprise boom, tax
  revenue) are at Q2 2026, dated by month.
- 2026-09-30 (owner-directed: CI red on every push): GitHub's CI had failed
  on every push since 29 September (last green 22 September), and this
  session's loop pushed 24 more without looking at it: each round checked
  the local gates and the Railway deploy, never the Actions run. Two
  causes, both in the tests, neither in the site. (1) province-cards: bun
  runs every test file in one process against one scratch store, and on
  GitHub's file order the province page's test writes Guangdong's figures
  first, so "an empty store" found Guangdong's GRP and Guangdong sorted
  ahead of Jiangsu. Reproduced locally by filling a store with the
  province test and running the card tests on it (old: 2 fail, new: 2
  pass); the tests now leave out the province written elsewhere. (2)
  health-report "stays cheap": its 5-second default timeout was spent
  writing 20,000 log rows (12.5 s on the runners, 4 failures in 30 runs);
  the report's own 2-second budget is unchanged and the test's timeout is
  60 seconds. LOOP.md gains a step: after a push, the CI run must finish
  green before the round counts as shipped.
- 2026-09-30 (round: places named in Chinese, from the queue): 上海房价
  reached the 70-city series but not Shanghai, and 进出口 日本 led with
  NBS's annual country table. The partner and city matchers read English
  words split on spaces. A Chinese path now finds the place inside the
  unspaced query and requires the rest to be made only of the topic's
  Chinese words (trade: 出口, 进口, 进出口, 贸易, 顺差, 逆差 and the joining
  characters; homes: 房价, 住宅, 商品房, 新房, 二手房, 价格 and the like),
  longest place name first so 南非 is not 非洲. The 70 cities already carry
  their Chinese names; Customs names its partners only in English, so the
  partners gain a Chinese name map (29 names). Checked on a local server:
  上海房价 opens Shanghai, 进出口 日本 and 对美国出口 open the partner, 上海GDP
  and 居民消费价格指数 are unchanged. Verified: typecheck clean, 524 tests
  (one new).
- 2026-09-30 (round: search in Chinese): eight queries. 工业增加值 and 出口
  led well. The rest did not: 居民消费价格指数 led with a Beijing annual
  table and the national CPI was not in the top three, 社会融资规模 and
  房地产开发投资 led with annual tables, and 青年失业率 and 上海房价 found
  nothing at all. Two causes. A Chinese term matched a curated entry only
  when the entry's text contained the whole term, and Chinese queries run
  longer than the synonyms (the query 居民消费价格指数 holds the synonym
  居民消费价格, not the other way round). And total social financing,
  fixed-asset investment and property investment and sales had no Chinese
  names at all. A Chinese term now also matches when it contains one of
  the entry's Chinese names, and the longest name found ranks the entry,
  so CPI (居民消费价格) leads retail sales (消费); the five keys gained
  Chinese and English synonyms. Checked on a local server: all six lead
  with the headline series, English queries unchanged. Queued: opening
  those results at a place named in Chinese. Verified: typecheck clean,
  523 tests (one new, against the real catalog).
- 2026-09-30 (round: all 31 province pages): nothing to fix. Every
  province page (`/api/province/<code>`, Guangdong checked in the earlier
  round) carries the same nine rows at the same latest periods: real GDP
  growth Q1 to Q2 2026, industrial output and consumer prices August 2026,
  gross regional product, GRP per person, population and exports 2025,
  disposable income Q1 to Q2 2026, and the registered unemployment rate
  ended 2021 with its note. No province has a missing or lagging row.
- 2026-09-30 (round: every theme card's data): nothing to fix. The nine
  theme payloads carry 318 cards (a card and its detail pair counted
  twice); none is empty. The only cards ending before 2025 are annual and
  current as published: utility-model and design patent applications and
  doctoral graduates end at 2024 because NBS's portal still has 2025 blank
  (checked by esData), the World Bank's fertility and life expectancy end
  at 2024 and its Gini index at 2022, their usual lags. `/api/theme/macro`
  answers an error because Macro is the Home page, not a theme route.
- 2026-09-30 (round: the monthly bundle's detail series, from the
  queue): 25 curated NBS series drawn from the monthly bundle's tables
  refreshed only with the daily ingest: product output (steel, cement,
  cars, NEVs, chips), output by division and sector, electricity by
  source, coal, oil and gas output, fixed-asset investment by industry and
  funding, the property detail keys, retail by commodity, and working
  hours. Each now rides the release whose NBS category holds its table,
  checked key by key against the catalog (industry, energy, investment,
  real estate, domestic trade; working hours sits in the surveyed
  unemployment table, so it goes with the bundle). Port throughput is a
  transport table no release covers and stays with the daily ingest;
  provincial keys stay off because the portal fills provinces days later.
  Cost: about 25 more requests per release attempt, well under the
  400-request cap. Verified: typecheck clean, 522 tests (bundle
  expectations updated, four new checks); the live calendar is read after
  deploy.
- 2026-09-30 (round: the rest of that bug class): the share-image fix
  guarded two readers, but a retracted month was still served as a null
  point to every reader, and the Home rows, theme rows and the series
  page's headline read `latest`, `previous` and the year-earlier point
  straight from the points. The generic `retractUnpublished` in the ingest
  can retract any month, including the latest, which would have put a
  broken figure in a tile. Guarding six client call sites was the wrong
  place: `readSeries` is the one read every route shares, and live fetches
  never carry nulls. It now omits a period whose latest revision is a
  retraction; `readRevisionHistory` still shows the trail. The retraction
  tests now hold that the month is not served (they held that it was
  served as null). The ingest's write-if-changed compares a new figure
  against no value either way, so a real figure for such a month is still
  written. Verified: typecheck clean, 522 tests; the live API is checked
  after deploy for Japan's February 2023.
- 2026-09-30 (round: the share image): downloaded the image from the live
  site for a single series (CPI), a comparison (CPI and PPI) and a partner
  (Japan). Layout, legend, end labels, source and URL were right. The
  partner image was not: exports, imports and balance each dropped to
  exactly zero every February from 2022 to 2025. Those Februaries were
  retracted on 2026-09-24 (misread from a table with no month column),
  and a retraction is served as a null point by design, so the store keeps
  the trail (`retraction.test.ts` holds that contract). The page chart
  treats null as no value; the share image's arithmetic and the Home
  sparkline's `Math.min` read it as 0, so the US, EU and ASEAN partner
  rows on Home dipped to the floor every February too. `buildTracks` and
  `Sparkline` now skip a null point. The page chart now joins across such
  a month, as it already does across any missing month. Verified:
  typecheck clean, 522 tests; the live image is re-downloaded after
  deploy.
- 2026-09-30 (round: release checks wait for the scheduled ingest, from
  the queue): at 08:41Z a release refresh and the press-release check
  (priority 0) had waited 3 and 12 minutes behind the scheduled ingest
  (priority 1), which runs every curated key and never looked at the
  queue. The crawl yields by stopping and resuming later, which works
  because it skips what is stored; the ingest cannot stop without
  dropping the keys it has not reached. The worker gains `runWaiting`: a
  long job that cannot stop calls it between units of work, and every
  queued job more urgent than it runs there, inside the caller's slot, so
  it is still one job at a time against the portals. `runIngest` takes a
  `between` hook, called between keys and between a key's regions, and
  the scheduled ingest passes `runWaiting(catchUp)`. A release check now
  waits at most one key (or one province) of the ingest. Verified:
  typecheck clean, 522 tests (two new: a release queued on the first key
  runs before the second, and lower-priority work stays queued with the
  ingest shown as running again). The live check reads `/api/schedule`'s
  worker state on the next release morning.
- 2026-09-30 (round: ten random monthly and quarterly catalog series):
  nothing to fix. Sampled from current frequencies this time (the morning
  sample was mostly ended annual tables). All ten served from the store
  with units, ranges and English titles that match the bureau's: ferroalloy
  and locomotive output back to 1989 and current to August 2026, grain CPI
  on the previous-month base shown as an index, Beijing's floor space
  completed. The one that looked wrong, waste recycling's total liabilities
  "growth rate" running to 109.1, is genuine: its title is 增减 (%), the
  industry was new in 2003, and the rate settles to 8-24 by 2011. NBS's
  own English spells "Administrative Expensess"; it is shown as published.
- 2026-09-30 (round: "electricity consumption" in search, from the
  queue): the query led with a provincial annual table opened at Beijing,
  above the national monthly series. The rule that lets an NBS result
  titled exactly as asked lead the headline series ("birth rate" is the
  bureau's Birth Rate) matched that table's gloss, and took any geography.
  It now counts a provincial or city table only when the query named a
  place (`exactTitleIndex`), and it gives way when a headline series is
  itself titled exactly as asked. Checked on a local server: "electricity
  consumption" leads with the national monthly series, "birth rate" still
  leads with the bureau's Birth Rate, "cpi" is unchanged. Verified:
  typecheck clean, 520 tests (one new).
- 2026-09-30 (round: house prices by city in search, from the queue): a
  city's home prices were hard to reach. "shanghai house prices" led with
  Shanghai's residential sales totals, "shanghai new home prices" with a
  second-hand index for no city, and even "shenzhen new home prices", the
  case that worked, led with the second-hand table. The place resolver
  reads Shanghai as the province, which the 70-city table does not use,
  and the curated 70-city series carries no city names in its text. The
  partner matcher from the previous round is now one helper,
  `namedRegionInQuery`, used twice: a query naming one of the 70 cities
  with only home-price words leads with New Home Prices, 70 Cities opened
  at that city. "shanghai gdp", "housing starts beijing" and "house
  prices" alone are left as they were. Verified: typecheck clean, 519
  tests (two new); on a local server both Shanghai phrasings lead with
  the Shanghai series and the partner case still works.
- 2026-09-30 (round: search, twelve researcher queries): eight led well
  (m2, local government debt, capacity utilization, the yuan, the 10-year
  yield, birth rate, real estate investment, core inflation). The clearest
  miss: no query naming a trade partner ever reached Customs' monthly
  Trade by Partner series. "exports to japan" led with NBS's annual
  country table, "trade with japan" with national export growth, because
  the partner's name is nowhere in the curated entry's text. A query that
  names a Customs partner (by its name without punctuation, or a common
  short name: us, eu, uk, korea, hong kong, taiwan, russia) and otherwise
  uses only trade words now leads with Trade by Partner opened at that
  partner. "japan gdp", "japan" and "total exports" are left alone. Two
  other misses queued (house prices by city, electricity consumption).
  Verified: typecheck clean, 517 tests (two new); on a local server
  "exports to japan" and "trade with the us" lead with the partner series
  and "cpi" is unchanged; the live check follows the deploy.
- 2026-09-30 (round: the docs against the code): every `bun run` command
  the docs name exists in package.json. The README's figures had drifted:
  149 headline series (153 in `CATALOG`; the four Shanghai Stock Exchange
  series were missing from the list), 54 cross-check pairs (55), 371 tests
  in 67 files (515 in 85). Corrected. AGENTS.md and CLAUDE.md said "287
  tests"; a count there goes stale every round, so they now say only that
  the suite must be green. Committed locally, not pushed on its own: docs
  ride with the next code change.
- 2026-09-30 (round: keyboard and screen-reader labels): scanned Home,
  a series page, Provinces, Releases, Browse, a theme page and search for
  controls without an accessible name, images without alt text, and the
  h1 count. Every visible control is named and each page has one h1. Two
  apparent findings were not defects: the sidebar's category links sit in
  a closed section (named once it opens), and the charts' focusable SVG
  is named by the `<title>` Recharts renders from the `title` prop. One
  convention slip found on the way: the sidebar's category rows led with
  the Chinese name and put the English under it ("工业 / Industry"), the
  reverse of the Browse page and of the rule (English first, Chinese
  alongside). They now lead with the English. Verified: typecheck clean,
  515 tests; the live check reads the sidebar after deploy.
- 2026-09-30 (round: dark mode tokens): one hard-coded colour outside the
  tokens, and it was a defect. The province tile map's ramp is fixed paper
  to red in both themes, but a light tile's label took `var(--ink)`, which
  is near-white in dark mode: at 390 or 1280 pixels in dark mode Shanxi,
  Liaoning, Jilin, Yunnan, Hainan and the other lightest tiles showed
  near-white text (236,235,230) on a near-white tile (244,242,236), their
  names and values invisible. A light tile now keeps the light theme's
  ink. The Home page, the CPI series page and the Guangdong page were
  checked in dark mode and read correctly. Verified: typecheck clean, 515
  tests; the live check reads the tile colours after deploy.
- 2026-09-30 (round: mobile CSS at 390 pixels): no page overflows at 390:
  the series pages for CPI, PMI sub-indices and US trade, the release
  calendar, browse, search, and all nine theme pages (the Home page was
  fixed in the earlier round). Two copy defects the screenshots showed.
  The Trade page's value card said "January 2026 is not stored", which
  reads as a gap in the site. It is not one: Customs' English listing
  runs December 2025 then February 2026, and the February table carries
  February and January-February only, so January exists only as a
  difference, which the owner declined to derive on 2026-09-13. The card
  and the shared integrated-circuit note now say Customs published no
  January 2026 figure on its own. And seven reading notes on series pages
  (CPI, GDP, provincial GDP, trade, PMI, the not-seasonally-adjusted note)
  joined two ideas with a semicolon, against the copy rule; each is now
  two sentences. Verified: typecheck clean, 515 tests; the live check
  follows the deploy.
- 2026-09-30 (round: /api/status for failed fetches): nothing to fix.
  Fifty recent failures, all checked against the series themselves. Forty
  are one burst of NBS "socket closed" errors at 01:02Z on 29 September;
  three sampled series from it now hold August 2026 (one is a table that
  ended in 2017, as NBS lists it). The rest are intermittent Ministry of
  Finance 502s on the local government bond and fiscal keys and one SAFE
  404; every one of those keys holds its latest published period (August
  for MOF, Q2 for the balance of payments) and was refreshed successfully
  on 30 September. The failures list is dominated by a 32-hour-old burst
  that has resolved, which makes it read worse than the store is.
- 2026-09-30 (round: the release calendar and /api/schedule): twenty-one
  releases through October, all at the published times, and this
  morning's PMI refresh completed (13 attempts, the headline advanced to
  September). Two defects. The release-day refresh fetches exactly the
  keys `RELEASE_MAP` names, and about fifty curated NBS series were named
  by none, so they wait for the daily ingest, up to a day. Two releases,
  industrial capacity utilisation and the preliminary value added by
  industry, named no series at all, so their days refreshed nothing
  curated. Each release now names the curated series drawn from its own
  NBS tables, checked against the catalog's category for each table: CPI
  and PPI detail, the NBS 70-city table, the PMI sub-indices, household
  income and spending levels, capacity utilisation, GDP by industry. The
  bundle's detail keys are queued. Also seen: NBS's portal still had
  September blank in the PMI sub-index table at 09:00Z, so the portal,
  not the mapping, is the lag today. Verified: typecheck clean, 515 tests
  (one new); the live calendar shows the new keys after deploy.
- 2026-09-30 (round: the Provinces page and provincial GDP): all 31
  provinces carry first-half 2026 real GDP growth with 86 periods back to
  2005; the tile map, ranking and Guangdong page render at 1280 and 390
  pixels with no overflow. One defect, found on the Guangdong page: its
  consumer-price sparkline started in 2026. The provincial CPI table
  restarts every five years and `provincial_cpi` lists the 2016-2020 and
  2021-2025 tables as slices behind the current one, but the per-province
  read (`fetchLiveRegion`) called the single-table fetch, so every
  province's CPI began in January 2026 and no earlier month was ever
  stored. It now reads through `fetchNbsWithSlices`, as the national read
  does. A new test fakes the portal for all three tables and fails on the
  old path. Verified after the post-deploy ingest: Guangdong and Beijing
  hold 128 months, 2016-01 to 2026-08 with no gap, and Guangdong's
  December 2025 reads 0.4, matching NBS's 100.4 on the 2021-2025 table.
- 2026-09-30 (round: the home page and the four hero tiles): every Home
  series is at its latest published period (August for the monthly NBS,
  PBOC, SAFE, MOF and Customs rows, September for PMI and the CFETS
  rates, Q2 for GDP). One apparent gap is not a defect: the headline PMI
  shows September 50.1 from Eastmoney, while the NBS PMI sub-index
  series stop at August, because NBS's own portal still has September
  blank seven hours after the release (esData 202609 cell empty; the
  release check had made 11 attempts). The press-release reader in shadow
  mode is the path that would close that gap. One defect: at 390 pixels
  the Home page scrolled 23 pixels sideways. A level's change on a year
  earlier carries its unit ("+2,246 100M yuan y/y") and the change
  column did not wrap, so three trade rows ran 52 pixels past a 70-pixel
  column (34 pixels into the period column at desktop width). The cell
  now wraps between words. Verified on the live site after deploy: page
  scroll width 390 at 390, no change cell wider than its column at 390 or
  1280, the trade rows read on two or three lines.
- 2026-09-30 (round: titles two year-range tables still shared): after a
  shared title is prefixed with its table, 3,755 were still identical,
  because the tables carry the same English name under different year
  ranges. Example: selling expenses of large and medium-sized enterprises
  in other mining, under the 2000-2002 table and the 2003-2022 family,
  which NBS keeps apart by renaming the industry in Chinese (其他矿采选业
  then 其他采矿业). Search showed them as identical rows. Where every entry
  sharing a title has a year range and the ranges differ, each now carries
  it, a family head its whole span ("..., Mining of Other Ores, 2000-2002
  (100 million yuan)"). GLOSS_FORMAT 33. Measured on the real catalog:
  shared titles fall from 3,755 to 258. Verified: typecheck clean, 513
  tests (one new); live API returns the 2000-2002 title and the family
  head's page heading reads "..., 2003-2022".
- 2026-09-30 (round: shared titles that said their table twice): a title
  shared by two tables was prefixed with its table, and 7,329 titles read
  the table's words twice or broke the bureau's capitals: "Finished goods
  (2023-present): finished goods of medium-sized industrial enterprises",
  "Inventories: inventory of Private Industrial Enterprises". A title that
  already opens with its table's name now takes only the table's vintage,
  the part that tells the two apart ("Finished goods of medium-sized
  industrial enterprises, 2023-present (100 million yuan)", and its twin
  "..., to 2022"); a title in the bureau's title case keeps its capital
  after the colon. GLOSS_FORMAT 32. Measured on the real catalog before
  and after: 7,329 of 79,836 titles change, and the titles shared across
  tables stay at 3,755, so none became less distinct. Verified: typecheck
  clean, 512 tests (two new); live API and page heading show the new
  title, search for "finished goods medium-sized" leads with the monthly
  finished-goods series.
- 2026-09-30 (round: ten random catalog series): nine of ten were sound
  on the live site (English titles, units, ranges, store-served; one
  discontinued indicator answers 502 as NBS lists it with no data, which is
  known). The tenth, medium-sized industrial enterprises' finished goods,
  read 15,982.87 in both 2023 and 2024. NBS's own portal serves it that
  way: in all seventeen 2024 tables of industrial enterprises by
  registration status, every line but the total carries its 2023 figure to
  the last digit (the total moved from 62,372.91 to 65,657.60). About 400
  series showed a copied year as a flat one. A scan of 40 other random
  annual tables found no other case. `repeatedTablePeriod` now checks, for
  a series whose latest point equals the one before, the table's stored
  lines at that period; with at least five lines and 80 percent repeating a
  nonzero figure, the series page shows an amber notice naming both years
  and the share of lines, and says the values are as NBS published them.
  Stored values are untouched. First deploy judged the table's newest
  period anywhere, and the total's 2025 point hid the repeat; fixed in the
  next commit to judge the series' own period. Verified: typecheck clean,
  510 tests (four new, holding the real table); live API returns
  `repeated: 2024/2023, 24 of 25`, the page renders with the notice, the
  total line and a monthly CPI series carry no flag.
- 2026-09-26 (round: exports and imports as levels): the owner asked for
  exports and imports as levels rather than growth. The site held the
  levels (`trade_values`: exports, imports, total and balance in 100
  million US dollars, from Customs' totals table) and the Trade page's
  first card drew them, but Home showed only "Export Growth". Home now has
  "Exports, Month" and "Imports, Month" rows from the levels series, with
  the change column giving the growth on a year earlier, in place of the
  growth row. The totals table's lines are declared (`customsLabels`), so
  the Home row test can hold a Customs row's line as it holds the bureau's,
  and the series is titled "Merchandise Exports and Imports, Value".
  Verified: typecheck clean, 443 tests, the two rows on a local render;
  the live values follow the deploy.
- 2026-09-26 (round: the three-month average): the owner sent four charts
  of the kind economists circulate (real GDP growth, CPI inflation, the
  yuan, exports and imports) and asked that the site carry the same
  methodologies. Three already match to the decimal: real GDP growth on a
  year earlier by quarter, CPI on a year earlier by month, and the yuan per
  dollar as the Fed's monthly average (`fx_usdcny`; the CFETS fixing is
  beside it). The fourth is Customs' export and import growth as a
  three-month average, which the site did not have; the site's monthly
  rates reproduce it exactly (June 2026: exports 20.2, imports 29.6). Two
  additions. A series page has a "3-month average" option for any monthly
  series (`movingAverage` in client/lib.ts, `ma=3` in the URL): the window
  is by calendar month, so a missing month is left out rather than an
  older one pulled in. And the Trade page has a card, "Exports and imports,
  growth on a year earlier, three-month average" (`derive: "trade_3m"`),
  which follows the convention those charts use: January and February both
  take the combined two-month rate Customs publishes as the February year
  to date, and a month whose window is short is skipped. The Trade page's
  "Output by product" section, five charts repeated verbatim from the
  Manufacturing page, is gone; the page was over the forty-chart cap.
  Verified: typecheck clean, 443 tests (two new: the calendar window and the
  January-February convention). Noted: the backup verifier test, which
  spawns three child processes, sometimes hits its 60-second cap under the
  full suite and passes alone in under half a second.
- 2026-09-25 (round: the chart's keyboard state and its focus ring): the
  owner sent two screenshots of a series chart after a click: a blue
  rounded ring around the active dots, and on a four-line compare the dots
  lit at four different dates under one tooltip. Two causes. Recharts 3
  makes the chart surface focusable for keyboard stepping, and Chrome drew
  its default "auto" ring on it after a click; the surface now shows no
  ring on a click and the site's own ring on keyboard focus. The chart
  gave each line its own data array, and the keyboard state steps by
  index, so on a compare whose lines begin in different months it lit the
  i-th point of each: four dates, one label. The chart now builds one row
  per date with every line as a column of it, the standard shape, so hover
  and keyboard stepping both land every line on the same date; a line
  without a value at a row is joined across it, as its own array drew it
  before. Verified: typecheck clean, 441 tests; on a local render, a click
  shows no ring, three ArrowRight presses step Feb, Mar, Apr 2018 with both
  lines' dots at one x each time and the ring shown only then.
- 2026-09-25 (round: the copy reads as sentences): the owner sent the
  Property page lede, "...land revenue and bonds, from the finance
  ministry.", and called the comma-tacked tail "terrible claude-speak". The
  same tic ran through the copy: six page and section ledes strung with
  semicolons and ending in a ", from the X" attribution, forty semicolon
  chains in theme notes, and thirty-six series descriptions on the client
  with ", from NBS's monthly table" tails. Every lede is now short
  declarative sentences that name the publisher in full inside the sentence
  ("Land sale revenue and local government bonds from the Ministry of
  Finance."); every semicolon in a note or lede is a full stop; every
  description is rewritten by hand the same way. Rule recorded for future
  rounds: no comma-tacked attribution or afterthought, no semicolon chains,
  one idea per sentence. Verified: typecheck clean, 441 tests.
- 2026-09-25 (round: search audit, twelve researcher queries): ten led with
  the right series on the live site (youth unemployment, steel output, home
  prices, money supply, retail sales, fixed asset investment, Guangdong GDP,
  birth rate, Shanghai composite, exports to the US by the test's own rule).
  Two did not. "cpi" and "inflation" led with the provincial CPI table:
  "cpi" is a synonym of the national CPI and a word inside "provincial
  cpi", both scored as a whole-phrase match, and the tie fell to catalog
  order. `matchCurated` now ranks a query that is one of an entry's names
  (its title or a synonym, whole) above one that only contains it, and a
  national series above a provincial one on the same score. "coal imports"
  found no curated series and led with three annual bureau tables, so the
  Customs monthly commodity keys gained commodity synonyms (coal, natural
  gas, energy, copper imports; car, vehicle, ship, phone, chip, hi-tech
  exports). Verified: typecheck clean, 441 tests (one new, holding "cpi",
  "inflation", "provincial cpi", "coal imports" and "car exports" to their
  series against the real catalog).
- 2026-09-25 (round: the share aged 65 and over from the bureau's own
  counts): the Demographics page drew the World Bank's share, a UN
  estimate, beside the bureau's age counts, and the two disagreed by a
  point (14.9% against 15.9% for 2025) with nothing said. The bureau
  publishes the counts but no national share series (the only "65岁及以上
  人口比重" in the catalog is the international dataset's World Bank
  figure, by country). A theme chart can now carry `derive: "share_65"`:
  the share is worked out in `themes.ts` from `population_age` over
  `population_nbs`, year by year, drawn as the bureau's, and the card links
  to the age table. The note names the World Bank gap. Verified: typecheck
  clean, 440 tests (one new, 22,365 over 140,489 reading 15.92).
- 2026-09-25 (round: province cards and profile rows say what they are):
  the cards under the map read "GRP, 2025: 145,847 100M yuan", "Residents,
  end 2025: 128.6m" and "Industrial output growth", and the profile's
  exports row printed the bureau's thousand-dollar figure as
  "843,388,066 k USD". The cards now say "Gross regional product, 2025:
  14.58 trillion yuan", "Resident population, end 2025: 128.6 million" and
  "Industrial value added growth, large firms" (the series is 工业增加值 of
  above-threshold firms, not output). A profile row in 千美元, 万美元 or
  亿美元 is rescaled to billions of dollars, its points with it, so the
  sparkline and the change read the same figure. Verified: typecheck clean,
  439 tests.
- 2026-09-25 (round: a month-end reading for the running month says so):
  the daily fixings and closes aggregated to their month (the 10-year yield,
  the parity rate, SHIBOR, the exchange indices, the Shanghai indices) carry
  a point for the running month from its first trading day, and Home dated
  it "Sep 2026" under a unit that says "month-end close", with the change
  measured against August's close. A new rule, `isOpenMonth`, reads the
  unit ("month-end close", "last fixing of the month", "last weekly reading
  of the month") and the date, and the Home rows, hero tiles and the series
  page's stat line say "Sep 2026 to date" until the month closes. The LPR,
  fixed once a month with no such unit, is unchanged. Verified: typecheck
  clean, 439 tests (one new, holding the rule to those units and to the
  running month only).
- 2026-09-25 (round: the Provinces page names the months a figure covers):
  provincial GDP growth is year to date, and the page dated its first-half
  figure "Q2 2026" in the tile-map and ranking subheads, the period menu,
  the selected-province panel and the province profile rows, while the
  Home rows for the same series said "Q1 to Q2 2026". The page now uses the
  same `periodSpan` rule as Home for a cumulative series: "Q1 to Q2 2026",
  "Q1 to Q4 2025". The selected panel no longer adds "year to date" after
  a period that already says so, and the ranking subhead names the line
  only when the series has more than one. Also in this round: the client's
  methodology text for household income and spending growth said nominal
  where the unit now says real; the three level-output ledes say a
  February point, where the table has one, is January and February
  combined (the fill needs the year-to-date sibling stored, which vehicles
  and robots have and autos, solar cells and ships do not yet). Checked and
  not a defect: FX reserves are credited to the People's Bank because the
  site reads the bank's own 官方储备资产 table (`official_reserves`), which
  the bank publishes alongside SAFE. Verified: typecheck clean, 438 tests,
  the Provinces labels on a local render.
- 2026-09-25 (round: theme cards draw what the series page draws): a theme
  card for a bureau catalog series read the raw store, while the series
  page it links to goes through the catalog reader, which stitches a sliced
  table, drops placeholder zeros and fills the combined February from the
  year-to-date sibling. So the output tables (vehicles, solar cells, robots,
  ships) had no February on the theme page and a combined one on the series
  page. `themeData` is async now and reads `nbs_` keys through
  `getNbsCatalogSeries` with a new `storeOnly` option, which serves stored
  points whatever their age and treats an unstored series as an error
  rather than a fetch, so a page of twenty charts can never become a burst
  of portal requests. The three level-output ledes now say the February
  point is January and February combined. Verified: typecheck clean, 438
  tests; the local store holds none of those series, so the fill is checked
  on the live site after the deploy.
- 2026-09-25 (round: the finance ministry's January-August release): the
  fiscal series ended at July a week after the January-August release was
  out (18 September). The release's title writes its range with an em dash,
  "2026年1—8月财政收支情况", where every earlier one used a hyphen, and the
  title parser's dash set had no em dash, so the listing skipped the newest
  release and the series stood still. The set now takes the em and en
  dashes too. The release parses to the ministry's figures: land sales
  13,753 (-28.6%), revenue 156,633 (+5.7%). Fixtures: the September listing
  page and the release. Verified: typecheck clean, 438 tests; the live
  series fills with the deploy's ingest.
- 2026-09-25 (round: the energy administration's February 2022): the month
  line held 13,467 for February 2022, the two-month total. The release
  itself gives February alone (6,235, +16.9%) and then January-February;
  its sentence reads "2月份，我国经济持续稳定恢复，全社会用电量持续增长，达到
  6235亿千瓦时", with a clause between the month and the subject, and the
  parser looked for the month in the two dozen characters before the
  subject, found none, and kept only the year to date; an earlier parse had
  stored the total as the month, and nothing since could overwrite it. The
  marker is now read from the whole sentence (from the previous full stop),
  the one nearest the subject winning, so "3月15日，…发布…2月份，" names
  February. The next ingest revises the month to 6,235 in place, trail kept.
  May 2026 is not a defect: the administration published no May note (April
  came on 19 May, then January-June on 15 July), so the month is absent at
  the source; the consumption cards say so. Fixture: the 15 March 2022 page.
  Verified: typecheck clean, 437 tests.
- 2026-09-25 (round: the January-February commodity tables): Customs'
  January-February release of the major exports and imports tables (2021 to
  2025) is headed "1-2 Total" with no month column, and the parser read the
  two-month total as February's: mobile phone exports 18,655 for February
  2025 against 9,288 in March, coal imports twice March's every year. The
  partner parser already knew this layout; the commodity parser now reads it
  the same way, with no single-month figure. Because the store is append-only
  and the ingest writes only what it reads, a corrected parse alone could not
  take back the misread Februaries, so the Customs fetch now names the months
  whose table carries no single-month figure (`unpublished` on the result)
  and the ingest retracts any stored value there as a null revision, keeping
  the trail. This is the general form of the one-off partner retraction of
  24 September; it covers the partner series too. The five theme notes that
  called those Februaries "one combined figure, dated February" now say the
  months are blank. Fixture: the January-February 2025 exports table.
  Verified: typecheck clean, 436 tests; the live retraction lands with the
  ingest after the deploy.
- 2026-09-25 (round: Customs April 2025 and June 2025): two of the audit's
  data defects had one cause each on Customs' side. April 2025's major
  exports table was published without its quantity-unit column, so the
  parser read the quantity as the unit and every figure one cell to the
  left: motor vehicle exports 215.8 (the year-to-date quantity) between
  months near 10,000, and a line named "Quantity (62.0)". The parser now
  notices when most rows carry a number where the unit belongs and reads the
  row without that column; the quantity then has no unit and is not
  labelled with one. June 2025's by-country tables are both listed "(in
  CNY)"; the USD one was never found, so every partner lost the month. When
  a listing carries two or more links to one table and month all labelled
  the other currency, `findTable` hands them back as alternates and
  `tableOfCurrency` reads each until the page's own unit line names the
  currency asked for. At boot the store drops the commodity quantity lines
  named for a misread number (they are the parser's, not a published
  figure); the value line's April is revised in place by the next ingest,
  keeping the trail. January 2026 needs no fix: Customs' English site lists
  no January table, and February 2026 is a single month. Fixtures: the April
  2025 exports table, both June 2025 by-country pages and the listing page
  that names them. Verified: typecheck clean, 434 tests; live check after
  the deploy's first ingest.
- 2026-09-25 (theme audit and restyle): eight Opus subagents audited every
  chart on the Headline, Provinces and seven theme pages against the served
  data and the publishers' releases. Every latest value checked matched the
  official figure (NBS August release, Customs, MOF, NEA, SSE, the 2025
  communiqué). The descriptions were another matter: of 137 theme cards, 82
  were off. The commonest defects were a period form missing from the title,
  a window years longer than the data (local government bonds from 2024-12
  under an 8-year window), notes that described a February point the chart
  does not draw, and quirks nothing on the card disclosed (census steps in
  the age-group chart, UN estimates beside bureau counts, the youth-rate gap
  months given as August to November when the data stops after June). Three
  were wrong in the data's description: the household income and spending
  growth series are the bureau's real (price-deflated) rates, which its own
  annotation states, but the unit said nominal (H1 2026 shows 4.2, nominal
  was 5.2); the two policy-uncertainty indices were credited to Baker, Bloom
  and Davis, whose China index reads the South China Morning Post, when
  FRED's notes name Davis, Liu and Sheng and two mainland papers; the Golden
  Dragon "monthly average" ended on a month-to-date average of the running
  month, drawn as a full month's fall. Applied: every title, note, lede and
  window the audits proposed across the seven themes (52 edits in
  `server/themes.ts`), the two unit strings, the two agencies, the running
  month dropped from FRED average series, the Home rows "New Home Floor
  Space Sold" and "Housing Starts" renamed for the all-building series they
  draw (residential is -13.0 and -25.4 against the -12.1 and -24.8 shown),
  and `万载重吨` glossed. The data defects the audits found (Customs April
  2025, missing partner months, NEA February 2022, MOF a release behind,
  theme cards without the February fill, month-to-date Home rows, Provinces
  period labels) are queued above with the evidence. Restyle in the same
  push: theme cards drew the series page's 460-pixel chart, so a page was a
  column of tall panels; they now draw a 250-pixel compact chart (1.5-pixel
  line, 44-pixel value axis, year ticks from a two-and-a-half-year window),
  the page strip is sentence case at 13px rather than tracked capitals, the
  catalog sidebar is off the theme and province pages, Home's hero sits on
  the left edge with the tiles a size up, and headings and ledes are a step
  larger. Verified: typecheck clean, 431 tests, local screenshots at 1440
  and 390 wide and in dark mode; the live check follows the deploy.
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
- 2026-09-10 round 74: audited the docs against the code since round 63.
  Undocumented: the catalog-wide February fill from the year-to-date
  sibling (round 65), the query normaliser (64), the share image's tick
  rule by frequency (70), and the loop's practice of capping git
  operations after the hung pushes. AGENTS.md's January-February section
  and search paragraph, the README's share image bullet and LOOP.md's
  commit step now carry them. Docs only, no deploy.
- 2026-09-10 round 75: ten search queries all came back empty from here
  in the minute the scheduled ingest was finishing, and round 52 had seen
  the same. Polling health and search through a boot ingest (a redeploy
  of the same code) showed the ingest itself does not block requests, but
  its first step did: the due scan over 15,034 stored series ran
  synchronously and held one search for eight seconds. The scan now
  yields every 500 rows. Verified with a second poll: samples across the
  ingest's start stayed at 1.2 to 1.4 seconds. The same poll showed the
  first search after boot taking 13.5 seconds, which points at the
  search's stored-range cache, rebuilt on first use by a scan of the
  observations table and expiring every ten minutes; queued for the next
  round. Two of the three poll jobs were killed by memory pressure on this
  machine and rerun with samples written to a file.
- 2026-09-10 round 76: queue item, tested rather than fixed. The
  suspicion was that the search's stored-range cache, rebuilt on first use
  and expiring every ten minutes, cost a searcher ten seconds each time.
  A search timed just after the ten-minute mark took 1.1 seconds, the same
  as a warm one, and health answered in under a second alongside it. So
  the rebuild is cheap and the 13.5-second sample in round 75 was the
  first search after boot, a one-off warm-up of the catalog and its index
  that a deploy causes and nothing else. Item removed; nothing to fix.
- 2026-09-10 round 77: audited ten monthly catalog series of the measure
  types round 65 did not touch: year-to-date growth and levels, end-of-
  period stocks (subscribers, inventories, total assets) and CPI component
  indices. All carry their own February, none carries a January except the
  price indices, which NBS publishes monthly, and none was given the
  February note, which is right since no fill happened. Units, transforms
  and ranges are sound. Nothing to fix. The round-76 expiry job finished
  meanwhile: its first post-expiry search took 1.4 s, its second reported
  152 s with no response despite a 30-second cap, which a curl cannot do
  unless the process itself was frozen; this machine has been out of
  memory all day, so that sample is not evidence about the server.
- 2026-09-10 round 78: read the live Home page as a reader would, the
  four hero tiles and all fourteen list rows, against the store. Every
  value, delta and period matches. The one figure that looked wrong,
  July's new yuan loans at -5,896 (100 million yuan), follows the same
  July pattern in the source as 2024 (-808) and 2025 (-4,296), so it is
  the published figure. Nothing to fix.
- 2026-09-10 round 79: audited the Provinces page's error state, the one
  part of it not yet exercised. It told a visitor "Run the ingest and try
  again", a developer instruction, where the search and calendar errors
  speak to the reader and offer a retry. It now reads "The provincial
  series did not load. Try again in a moment." with a Try again button
  that refetches. Verified live by blocking the page's own fetch in the
  browser: the new state appeared, and Try again brought back all 31
  tiles for the chosen period.
- 2026-09-10 round 80: audited the release calendar's error state the same
  way, by blocking its fetch in the browser. It reads "Release calendar
  unavailable. NBS didn't respond. The schedule is also published at
  stats.gov.cn." with a working link and a Try again button, which is
  what a reader needs. The empty state for an unpublished month was
  fixed in round 34. Nothing to fix.
- 2026-09-10 round 81: audited `/api/status` after a deploy-heavy day:
  twenty deployments, each with a boot ingest of 139 runs, and no failure
  logged today; the store gained seven observations, as expected between
  releases. One observation for later: each boot ingest adds about 140
  fetch-log rows, so a day like this adds nearly 3,000; at a normal
  cadence that is a few hundred a day, small beside 1.3 million
  observations, so no pruning yet. Nothing to fix.
- 2026-09-10 round 82: audited the share image with a live render of the
  unemployment page, the one series with a suspension gap. Band, dashed
  and solid youth segments, five end labels and legend all render right.
  Defect: the note under the chart was cut to one line with an ellipsis,
  so the image said readings across the gap "are not comparable, and ..."
  and lost the half that tells a reader not to read the jump as a change
  in the labour market. Each note may now take two lines and the notes
  together three, with the plot giving up the height; the note's age
  range uses a hyphen like the legend. Test added. Verified live: the
  unemployment image carries the whole note on two lines.
- 2026-09-10 round 83: measured the unemployment page at 390 px on the
  live site in three states not yet covered: the chart with its five-entry
  legend, the Options panel open, and the Table tab. The first two lay out
  at exactly 390 px with no element past the edge. The table's five series
  run to 438 px and scroll inside the card, which is right, but a reader
  who swipes right lost the Period column and could not tell which month a
  value belonged to. The first column is now sticky on the left, in the
  header row too. The Notes card's "16–24" en dash now matches the
  hyphen used by the legend and table headers. Verified live: with the
  table scrolled to its limit the Period cells stay at the card's edge.
- 2026-09-10 round 84: dark mode. Eight stylesheet commits since round 72,
  seven of them phone-width layout changes with no colour in them; the
  eighth, round 83's sticky period column, paints its cells with the panel
  token so the scrolled columns do not show through. Rendered the
  unemployment table in dark at 390 px scrolled to its limit: the pinned
  cells take the card's own dark panel colour (#161f2b, the same as the
  card) and the header cell the darker header tone, in both the system
  and the explicit dark blocks. Nothing to fix.
- 2026-09-10 round 85: probed accessible names on surfaces the earlier
  rounds had not: the series page's Download and Share menus ("Download",
  "Share", disclosure), the theme button ("Switch theme"), the skip link,
  the Save button with its pressed state, the Home indicator rows (each a
  single link naming the series, measure, value, change and period) and
  the release calendar. One defect: the calendar's date block joined the
  day and weekday with nothing between them, so a screen reader read
  "Sep 15Tue", the run-together defect round 28 fixed on the Provinces
  ranking. A visually hidden comma now separates them. Verified live: the
  blocks read "Sep 9, Wed", "Sep 15, Tue", "Sep 28, Mon". The bare "10:00"
  on each release is fine, since the lede states China Standard Time.
- 2026-09-10 round 86: audited the docs against the code since round 74.
  The README's health paragraph says `/health` returns the observation
  count; live it returned 0 against a store of 1.3 million, because the
  route read the count from the status page's five-minute cache, which is
  empty until someone requests `/api/status`. A platform healthcheck
  after boot never saw a real number. Health now keeps its own
  five-minute count; test added. Verified live: the first ping after the
  deploy reported 1,315,240 (it took seven seconds, the boot ingest
  contention round 75 measured, and the second under a second). Also
  undocumented: the share image's notes line (rounds 36, 58 and 82); the
  README's share image bullet now carries it. The other code changes
  since round 74 (Provinces error copy, the due scan's yield, the sticky
  period column, the calendar comma) need no doc.
- 2026-09-10 round 87: audited search for ten fresh researcher queries on
  the live site (steel output, crude oil imports, fiscal revenue, housing
  starts, birth rate, container throughput, cement production, rail
  freight, deposits, wages). Six led with the right series. Three found
  nothing and rightly so: deposits and commodity imports are People's
  Bank and Customs data, container throughput is Ministry of Transport,
  none of them in NBS monthly or quarterly tables, and the empty state
  says what the catalog holds. One defect: "housing starts" led with a
  quarterly construction-industry series and one that ended in 2014,
  because the alias 新开工面积 sits at the start of those titles while the
  monthly real estate table has 施工 inside the phrase. The alias now
  names the real estate table; test added. Verified live: the query leads
  with real estate floor space newly started, monthly through July 2026.
- 2026-09-10 round 88: audited ten random catalog series pages on the
  live site (detergent output, other-mining liabilities, rail passenger
  traffic, manufacturing value added, nuclear power, other-mining
  inventories, truck output growth, other-mining assets, mining
  receivables, PPI consumer goods). Periods ordered, no duplicates or
  nulls, units and ranges sound; rail passengers lose January from 2024
  because NBS combined it with February then, and the February fill shows
  where it applied. One defect, systemic: NBS's 增减 (%) on the industrial
  enterprise tables (assets, liabilities, inventories, receivables,
  loss-making firms) is the change from the same month a year earlier,
  but 639 glosses read "Other mining: change in total liabilities" with a
  unit of %, which reads as a level change. They now follow the site's
  convention for year-on-year rates, "Other mining: total liabilities,
  change from a year ago, %"; the 194 glosses that already name their base
  period (from same period last year, from start of year) are untouched.
  GLOSS_FORMAT bumped to 11 so stored titles rebuilt on boot; tests added.
  Verified live on the sampled page and on search results.
- 2026-09-10 round 89: audited Home on the live site at desktop width:
  the tagline's counts agree with the Coverage card (7 non-NBS
  indicators, 24 FRED series, 18 headline entries), the four hero tiles
  and fourteen rows match the store, the Upcoming card lists the six
  September 15 releases with their series and category links, and the
  categories grid is intact. One defect: the Loan Prime Rate row, whose
  August value matched July, showed its change as a bare "0.0" beside
  neighbours reading "+0.3 pp", because the short change text dropped the
  unit only in the unchanged case. An unchanged rate now reads "0.0 pp"
  and an unchanged level in the thousands "0"; tests added. Verified
  live: the LPR row reads "0.0 pp" next to the PPI row's "+0.3 pp".
- 2026-09-10 round 90: audited the Provinces page on the live site for
  three quarters the earlier rounds had not: Q2 2022 (Shanghai -5.3,
  Jilin -6.0 at the bottom, Ningxia 5.7 on top), Q1 2011 and Q1 2020
  (Hubei -39.3). All 31 provinces carry a value in each, and the tiles,
  ranking and card headings agree with the API. One gap in the researcher
  workflow rather than a data defect: the Period control kept its choice
  in component state, so a link copied from a view of Q1 2020 opened on
  the latest quarter. The period now travels in the URL as
  #/regions?period=2020-Q1 and the control writes it through the router.
  Verified live: the link opens on Q1 2020 with the control, both card
  headings and the Hubei tile agreeing, and changing the control rewrites
  the hash.
- 2026-09-10 round 91: audited the release calendar and `/api/schedule`
  for October, the first month with a quarterly bundle, on the live site.
  The schedule holds 24 upcoming releases from 15 September with no
  duplicates, the 19 October bundle carries gdp beside industrial output,
  retail sales and unemployment, and every timer is at 09:30 or 10:00
  China Standard Time. The October calendar renders fifteen releases on
  six days, each with a series link or a category link (capacity
  utilisation and industrial profits to Industry, household income to
  Household living standards, the preliminary value-added estimate to
  National accounts, culture to Culture). `lastReleaseRefresh` is still
  null, as expected before the first release day. Nothing to fix.
- 2026-09-10 round 92: audited `/api/status` on the live site. No
  failures since 9 September; the store holds 1,315,243 observations
  across 15,077 keys at 454 MB; the twenty latest runs are the boot
  ingest of the last deploy. The payload is 2.6 MB because it lists all
  15,177 stored (key, region) pairs, and a cold call took 14 s during a
  boot ingest against 3 s warm; noted, not changed, since only audits
  read it. Reading the per-series list turned up one headline series
  frozen for a reason the site misstated: the real estate climate index
  comes through AkShare, which production does not run, so it stops at
  December 2025, yet its page said "the source has published nothing
  newer; the store was last checked Sep 8", false on both counts. The
  catalog now flags AkShare series as not refreshable when
  AKTOOLS_URL=off and the notice says the series is refreshed through
  AkShare, which this deployment does not run. The AKTools URL is read at
  call time so a test can exercise the flag; test added. Verified live:
  the catalog flags the three AkShare series and the page carries the
  new notice.
- 2026-09-10 round 93: audited the share image with three live renders
  not yet covered: the two-line money supply growth chart, foreign
  exchange reserves on a log scale, and a mixed-unit compare (CPI with
  reserves) shown as year-on-year change. The first and third render
  right. Defect: the log-scale image drew two labels, 20,000 and 50,000,
  with the line floating between them, because the log tick rule steps
  by decades and 1-2-5 factors even when the data spans less than a
  doubling, and the subtitle said nothing about the scale. A span
  narrower than a doubling now takes evenly spaced labels on the log
  axis, and the subtitle ends "log scale". Tests added. Verified live:
  the reserves image reads 28,000 to 36,000 in five steps with the
  subtitle "Hundred million USD (亿美元), monthly, Aug 2016 to Aug 2026,
  log scale".
- 2026-09-10 round 94: measured two surfaces at 390 px on the live site
  that no mobile round had covered: the Provinces page on Q2 2022 (period
  control, tile map, colour ramp, ranking) and the Add series popover
  open on the CPI page. Both lay out at exactly 390 px with no element
  past the edge. One copy defect: the popover's search box placeholder
  read "Search in English or Chinese: GDP, 工业增" with the rest cut off
  mid-word. It now reads "Search in English or Chinese"; the examples
  were already given on the Home search. Verified live: the placeholder
  measures 177 px in a 264 px box.
- 2026-09-10 round 95: dark mode. No stylesheet change since round 84.
  Rendered two dark surfaces no dark round had covered: the release
  calendar (day column, times, bilingual titles, series and category
  links) and the Add series popover with results for "ppi" over the
  chart. Panel, text, link and focus tokens all resolve on the dark
  ground in both. Nothing to fix. Surfaced for a search round and queued:
  "ppi" lists the previous-month-base components ahead of the
  year-on-year ones.
- 2026-09-10 round 96: queue item. "ppi" and "cpi" listed the
  previous-month components ("PPI: food, previous month = 100") ahead of
  the year-on-year ones, because the ranking's tie-break preferred the
  shorter English title. A previous-month base now ranks after a
  year-earlier base when keyword scores tie; test added. Verified live:
  "cpi" leads with the same-month-a-year-earlier index, "ppi" and "ppi
  food" with the year-on-year food PPI. Surfaced and queued: two tables
  both read "PPI: food, same month a year earlier = 100" (食品工业 and
  食品类), so the results show apparent twins.
- 2026-09-10 round 97: queue item. "ppi food" showed twins, "PPI: food"
  twice, because the by-department PPI table's 食品工业 and the
  by-category table's 食品类 were glossed alike. The by-department table
  (fifteen industries, the older classification) was inconsistent
  throughout: "Producer price index for the chemical industry", "PPI:
  Building materials", "Producer price index, forestry". All fifteen now
  read "PPI: <industry> industry", and the durable consumer goods category
  takes the same "PPI:" form. GLOSS_FORMAT bumped to 12 so stored titles
  rebuilt on boot; test added. Verified live: "ppi food" lists the food
  category, then the food industry, then food manufacturing, and the
  chemical industry entry reads "PPI: chemical industry".
- 2026-09-10 round 98: probed the Provinces page for keyboard and screen
  readers on the live site, the one page the accessibility rounds had
  touched only for its ranking. The tile map is a labelled group whose
  tiles read "Beijing, 5.4%" with a pressed state, the ranking buttons
  read the same way, the period control is a combobox named Period, the
  detail panel is a polite live region, and the comparison chips' remove
  buttons read "Remove Guangdong". One defect: with one province picked,
  "Pick at least two" was a link marked aria-disabled that a keyboard
  could still focus and follow, landing on a single-province chart. It
  is now a disabled button until two are picked. Verified live: with one
  pick the control is a disabled button that does not take focus; with
  two, "Chart 2 provinces together" links to the two-province compare.
- 2026-09-10 round 99: audited the docs against the code since round 86.
  Undocumented: the ranking tie-breaks (still publishing, then a
  year-earlier index base over a previous-month one, then the shorter
  title; round 96), the Provinces period in the URL (90), the `lny`
  series parameter, the by-department PPI and 增减 gloss rules (97, 88),
  the `refreshBlocked` catalog flag and its page notice (92), and the
  log-scale subtitle on the share image (93). AGENTS.md's ranking, series
  URL and gloss paragraphs and the README's AKTools and share image
  bullets now carry them. The housing starts alias (87), the Home delta
  wording (89), the placeholder (94) and the comparison button (98) need
  no doc. Docs only, no deploy.
- 2026-09-10 round 100: audited search for ten fresh analyst queries on
  the live site (ev production, aluminium output, property investment,
  port cargo, air passengers, coal output, 服务业生产指数, 工业企业利润,
  gold reserves, urban unemployment 31 cities). Seven led with the right
  series; gold reserves is People's Bank data and rightly absent. Two
  vocabulary defects: "aluminium output" led with alumina, because the
  alias covered every 铝 series and the shorter title won, and "air
  passengers" found nothing, although NBS publishes primary (electrolytic)
  aluminium output and civil aviation passenger traffic monthly.
  Aluminium and aluminum now name the primary aluminium table; aliases
  added for primary aluminium, air passengers, air travel, airline
  passengers and airline. The typecheck gate caught the first attempt,
  which duplicated four existing keys. Test added. Verified live:
  "aluminium output" and "aluminum" lead with primary aluminium,
  "aluminium alloy" keeps its table, "air passengers" finds civil
  aviation passenger traffic.
- 2026-09-10 round 101: audited ten random catalog series pages on the
  live site (private enterprise administrative expenses, two PPI
  components, leather industry assets, shareholding enterprise operating
  profit, repair industry revenue growth, non-ferrous current assets and
  fixed-asset investment growth, food inventories, foreign-invested
  enterprise assets). Periods ordered, no duplicates or nulls, units,
  ranges and the 增减 wording from round 88 all sound. One defect,
  systemic: the sampled "Producer price index for weighing instrument
  manufacturing" sat beside the convention "PPI: sanitary materials";
  the gloss table spells out 124 PPI components that way, plus a handful
  of retail and consumer index ones, and the prefix normaliser folded
  only the abbreviated comma form. It now folds the spelled-out forms
  when a component follows and leaves the bare headline titles alone.
  GLOSS_FORMAT bumped to 13 so stored titles rebuilt on boot; tests
  updated. Verified live: the sampled page reads "PPI: weighing
  instrument manufacturing, same month a year earlier = 100", "ppi tea"
  leads with "PPI: tea", and the headline "Consumer price index" is
  unchanged.
- 2026-09-10 round 102: audited the parts of Home the last Home round
  did not, on the live site. The NBS Categories grid shows the twelve
  largest top-level groups with counts that match the catalog stats
  (Industry 7,189 down to Culture 49), each card linking to its category
  listing and reading "工业 Industry 7,189 series" to a screen reader
  with the parts separated. The six common-search chips each lead with
  the series they name (youth unemployment, CPI, PMI, exports, house
  prices, LPR). The hero search's placeholder and form are intact, the
  tagline's counts still agree with the Coverage card, and the Upcoming
  card lists the six 15 September releases. Nothing to fix.
- 2026-09-10 round 103: audited the Provinces page's outbound path on the
  live site: selecting Hubei on Q1 2020 gives a panel reading -39.3%, an
  eight-quarter sparkline ending that quarter, and an Open series link to
  the Hubei view. That page exposed a defect on every series page: the
  browser tab and any bookmark were titled by the route key,
  "provincial_gdp - EconStats China Data" or an NBS hash. The series page
  now sets its title from the expression the share image already used
  ("Provincial Real GDP Growth: Hubei"), the key standing in until the
  series loads, and the other views get their page names ("NBS Release
  Calendar", "Search: steel"). The first deploy placed the new effect
  after the loading-state return, so the hook count changed once a series
  loaded and React unmounted the page: every series page was blank from
  15:58 to 16:02, which the first live check misread as a title still
  unset. The effect now sits above both early returns; LOOP.md carries
  the rule. Verified live: the CPI, Hubei and GDP-with-CPI pages render
  with titles "Consumer Price Index", "Provincial Real GDP Growth: Hubei"
  and "Gross Domestic Product, Consumer Price Index".
- 2026-09-10 round 104: audited the release calendar and `/api/schedule`
  on the live site for November, the month the earlier rounds had not
  read in full, and the next-release rows on the industrial production
  and PMI pages (15 September 10:00 and 30 September 09:30, both right).
  The November calendar renders eleven releases on four days with the
  30 November PMI last. One defect in the API rather than the page:
  `/api/releases` passed start and end to NBS as given, so a bare
  `end=2026-11-30` was read as midnight and that day's PMI fell outside
  the window; the calendar page was unaffected because it sends times.
  A bare date now takes the start or end of its day; test added.
  Verified live: the bare-date query returns all eleven, and the
  November page still renders the same eleven under its heading.
- 2026-09-10 round 105: audited `/api/status` on the live site. No
  failures since 9 September; the store holds 1,315,248 observations;
  the headline series last fetched on 7 or 8 September are the ones
  whose next release is later, as the due rule intends. Defect: the
  first status call, made a few minutes into a boot ingest, returned
  nothing after 75 seconds while health and the page APIs answered in
  about a second; a retry mid-ingest took four seconds. The endpoint was
  computing a group-by over all 1.3 million observations and sending a
  2.6 MB list of fifteen thousand (key, region) rows on every call, the
  weight round 92 noted and left. The summary (size, totals, last runs,
  the week's failures) is now the default at 15 KB, and the coverage
  list is computed and cached separately, only with `?series=1`; the
  ingest's end-of-run tally uses the summary; docs and test updated. The
  typecheck gate caught a union return type on the first attempt.
  Verified live during the next boot ingest: the light call answered in
  eight seconds cold and one second warm, the flagged call in five.
- 2026-09-10 round 106: audited the share image with two live renders not
  yet covered: a catalog series whose February is the combined
  January-February figure (railway passenger traffic) and GDP on a custom
  window (Q1 2019 to Q4 2022). The window image is right: title,
  subtitle range, year ticks. Defect: the page notes the combined
  February point for such series, but the image carried no note, so a
  reader of the picture alone would take the point for a February
  reading. The image now carries "February is the combined
  January-February figure NBS publishes; there is no January point",
  naming the series in a compare. Verified live on the rail image. The
  owner interrupted this round's verification with a 502 on a series
  page and a question about the 9,569 count; the count is the catalog's
  distinct indicators after year-range slices fold into families (14,886
  slices), of which 9,209 are stored and 360 came back empty from NBS.
- 2026-09-10 round 107: owner report. A series page returned "Request
  failed (502)" at 16:27, twenty seconds after the round-106 container
  started. The deploy log shows the process listening and answering
  /health before the catalog, gloss and search index were warm, so
  Railway switched traffic to the new container while it was still busy
  and the edge returned 502 for the first seconds of every deploy.
  Health now reports 503 until the warm-up finishes, capped at 25
  seconds so a slow warm-up cannot fail a deploy, and the warm-up time is
  logged. Verified live by polling a series page and health every two
  seconds through the next deploy: one eight-second no-answer sample at
  the hand-over, then 200s throughout; the new container logged
  "Catalog warm in 11.8s".
- 2026-09-10 round 108: owner report, "we do not in fact have all the
  series". Tested on the live site: 369 of the 15,403 national monthly
  and quarterly catalog entries have no stored copy, 360 of them the
  by-industry enterprise tax indicators (VAT payable, business taxes and
  surcharges) that NBS lists but stopped filling, and nine PPI and CPI
  sub-indices; NBS answers each with no observations, so the page said
  "NBS didn't respond, and this series has no stored copy yet", which
  reads as a passing outage. The page now says NBS lists the table but
  has published no data for it, and search results mark such entries
  "no data published" where the period range would be. Verified live on
  the mining VAT table's page and search results; the CPI page renders.
  The count question: 14,886 NBS table slices fold into 9,569 distinct
  indicators, 9,209 with data stored and 360 empty at NBS.
- 2026-09-10 round 109: measured the three states this session added at
  390 px on the live site: the empty-table error state (round 108), a
  search results page carrying the "no data published" tag on six
  entries, and the Provinces page with two provinces picked (detail
  panel, comparison chips, "Chart 2 provinces together", ranking). All
  three lay out at exactly 390 px with no element past the edge, and the
  new copy wraps cleanly. Nothing to fix.
- 2026-09-10 round 110: dark mode. No stylesheet change since round 84.
  Rendered the two surfaces round 108 added, in dark: the search results
  carrying "no data published" (the amber tag reads at about 7:1 on the
  dark panel) and the empty-table error state (heading, text and buttons
  take the dark ink and link tokens). Nothing to fix.
- 2026-09-10 round 111: probed the search results page for keyboard and
  screen readers on the live site. The Frequency and Dataset controls
  are named comboboxes, each result is one link whose name reads the
  title, gloss, path and meta line in order, and the result count is a
  polite status region. One defect: an empty result was announced as
  "Showing 0 of 0 series" while the explanation and the Chinese-term
  suggestions sat in a block with no role. The count now says nothing
  for zero results and the empty-state block is the status region.
  Verified live: the empty page carries the status role on the block
  with an empty count, and "steel output" still counts 60 of 461.
- 2026-09-10 round 112: audited the docs against the code since round 99.
  Undocumented: the healthcheck waiting for the warm-up (round 107), the
  empty NBS tables and their "no data published" marking (108), the
  spelled-out index prefixes folding to "PPI: tea" (101), bare dates on
  the releases API (104), the February note on the share image (106),
  and tab titles naming the series (103). The README's health, share
  image, deep links and releases bullets and AGENTS.md's warm-up and
  gloss paragraphs now carry them. The status endpoint's `?series=1`
  was documented in its own round. The aluminium and aviation aliases
  (100) and the empty-result status region (111) need no doc. Docs
  only, no deploy.
- 2026-09-10 round 113: audited search for ten plain-language queries on
  the live site (how many cars does china make, population, inflation
  rate, home sales, solar power generation, chip output, tourism, robots,
  pork prices, electric vehicle sales). Six led with the right series;
  electric vehicle sales is honestly absent (NBS publishes output, not
  sales). Three defects: "inflation rate" led with PMI price sub-indices
  because only the single word was known; "chip output" led with
  industrial value added because only the plural was; the cars question
  found nothing because "make" meant nothing and "how many" and "does"
  had to match. The phrase, the singular and make/produce/manufacture
  (产量) are now known and question words are stop words. Fixing the
  question exposed a tie: 汽车产量 and 载货汽车产量 scored alike and the
  shorter English title, "Truck output", won, so a title that opens with
  the query's leading concept now edges out one that merely contains it.
  Test added; the earlier ranking tests still pass. Verified live: the
  three queries lead with CPI, integrated circuit output and automobile
  output, and steel output, housing starts and ppi food are unchanged.
- 2026-09-10 round 114: audited ten random stored quarterly series pages
  on the live site (steel and paper sales, pig iron sales and ratio,
  secondary industry value added, cultural industry revenues, urban
  business income, wholesale building completions, excavator ratio).
  Periods ordered, no duplicates or nulls, quarter labels throughout.
  One defect, systemic: the pig iron output-sales ratio page read "99.80,
  10,000 tonnes" for a percentage, because the catalog's unit field is
  the table's while a row's own unit sits in its title; 248 rows
  disagree that way, 68 ratios labelled with a physical unit and 117
  year-on-year changes in those ratios labelled percent where they are
  percentage points. rawUnitOf now takes the title's unit when the two
  differ, leaving base periods to the existing rule; GLOSS_FORMAT bumped
  to 14 so stored units rebuilt on boot; tests added. Verified live: the
  pig iron ratio reads %, the cloth ratio change reads 百分点, and crude
  steel output still reads 万吨.
- 2026-09-10 round 115: audited Home's hero on the live site: the four
  tiles link to GDP, CPI, unemployment and PMI with values, periods and
  changes matching the store, and the hero search trims its input and
  opens the results page. One defect: the topbar search box was filled
  from the URL only when the app first loaded and cleared on leaving the
  search page, so a hero search or a chip from Home landed on results
  with an empty box while a reload of the same URL showed the query. It
  now follows the query whenever the route changes. Verified live: a
  hero search for "steel output" lands with the box reading it, going
  Home empties it, and the LPR chip fills it with "LPR".
- 2026-09-10 round 116: followed the Provinces page's "Chart together"
  path to a four-province compare on the live site. Tab title, lede
  ("Guangdong, compared with Shanghai, Hubei and Tibet"), four region
  chips with labelled remove buttons, the stat line and the table's four
  columns are all right. One defect: the table's hidden caption named
  only Guangdong, so a screen reader entering it heard one province. The
  caption now uses the view title the tab and share image use. Verified
  live: the compare table is captioned "Provincial Real GDP Growth:
  Guangdong, Shanghai, Hubei, Tibet" and the CPI table reads as before.
- 2026-09-10 round 117: audited the release calendar at its edges on the
  live site. December's agenda holds eleven releases, every one with an
  English name and a series or category link, ending with the 31
  December PMI. Stepping back from September shows August's schedule
  (9, 17 and 27 August) with the month in the URL; stepping to January
  2027 shows the "Calendar not published yet" state with its note that
  the coming year's schedule appears each December. `/api/schedule` is
  unchanged since round 104. Nothing to fix.
- 2026-09-10 round 118: audited `/api/status` on the live site. The light
  summary answers in a second at 15 KB; no failures today; the store
  holds 1,315,258 observations. Rounds 81 and 105 had noted the fetch
  log growing by about 140 rows per boot ingest without a way to measure
  it, and today has had some thirty-five deploys, so the summary now
  reports the log's row count and oldest entry; docs and test updated.
  Verified live: 29,346 rows since 7 September, three days of heavy
  deploying, a few megabytes beside a 454 MB store; no pruning needed.
- 2026-09-10 round 119: audited the share image with two live renders not
  yet covered: the pig iron output-sales ratio, now labelled Percent
  after round 114, and Beijing's new and existing home prices with the
  city named in the title. Both render right. Defect: the pig iron
  series stopped in Q4 2019 and the page says so in its notice, but the
  image carried no note, so a reader of the picture alone would take
  2019 as current; round 36 had covered only headline series with an
  ended flag. The image now notes the last published period for any
  series behind its schedule, and for an AkShare series that this
  deployment cannot refresh it; a follow-up commit capitalised the
  sentence. Verified live: the pig iron image reads "Last published Q4
  2019; nothing newer has been published." and the CPI image carries no
  note.
- 2026-09-10 round 120: measured three pages no mobile round had covered
  at 390 px on the live site: Browse's category cards, the Saved page's
  empty state, and the CPI page with the Options panel open (frequency,
  show-as and Lunar New Year controls). All three lay out at exactly
  390 px with no element past the edge. One copy gap: the Saved page's
  empty state said where saved series live but not how to save one; it
  now opens "Save a series from its page with the Save button." Verified
  live at 390 px.
- 2026-09-10 round 121: dark mode. No stylesheet change since round 84.
  Rendered two dark surfaces no dark round had covered: the Browse
  category cards (panel, line, ink and muted tokens) and the CPI page's
  Options panel (selects on the dark field colour with the dark border,
  the checkbox in the accent, labels in muted ink). Both read right.
  Nothing to fix.
- 2026-09-10 round 122: probed the series page's chart controls for
  keyboard and screen readers on the live site: the range buttons carry
  pressed states inside a group named "Date range", the Download and
  Share menus are named disclosures with plain item names, Save carries
  its pressed state, and the Custom range's month fields are labelled
  "Start month" and "End month". One defect: clicking Custom revealed the
  fields but left focus on the button, where Add series moves focus
  into its box. The Start month field now takes focus when Custom is
  toggled on, and not when a page loads with dates in its URL. Verified
  live: after Custom the active element is "Start month"; a page loaded
  with from and to keeps focus on the main region with the fields
  prefilled. One local note: a health sample from this machine got no
  answer for 76 s while the page APIs answered in a second; with the
  machine out of memory the next three samples were 9.7 s then 1 s, so
  that sample says nothing about the server.
- 2026-09-10 round 123: audited the docs against the code since round
  112. Undocumented: a row's title unit winning over the table's unit
  field (round 114), the leading-concept tie rule with the question stop
  words and the make/produce aliases (113), and the stopped-series note
  on the share image (119). AGENTS.md's gloss and ranking paragraphs and
  the README's share image bullet now carry them. The fetch-log size
  (118) was documented in its own round; the compare caption (116), the
  topbar box (115), the Saved copy (120) and the Custom focus (122) need
  no doc. Docs only, no deploy.
- 2026-09-10 round 124: audited search for ten Chinese queries on the
  live site (社零, 外汇储备, 城镇化率, 水泥, 粗钢, 房价, 进出口, 汽车销量, 用电量,
  财政收入). Six led with the right series; 城镇化率 is annual and 用电量 is
  National Energy Administration data, both honestly absent. Two
  defects: the abbreviation 社零 was unknown, and 汽车销量 found nothing
  because NBS titles sales 销售量 and the two-character piece 销量 matched
  no title. Pieces now match through the alias dictionary as well as
  literally, and 社零, 销量 and 汽车销量 are known; 社零 also joins the
  retail sales headline's synonyms. Test added. Verified live: 社零 leads
  with the retail sales headline then the NBS total, 汽车销量 with
  automobile sales, and 猪肉价格 (round 52) still finds the pork CPI.
- 2026-09-10 round 125: audited ten random stored price-index series
  pages on the live site (CPI components on both bases, PPI industries,
  farmers' market prices and their month-on-month growth). Periods
  ordered, no duplicates or nulls, the year-on-year indices shown as
  growth and the previous-month index raw, as intended. Two title
  defects, both systemic: 82 glosses put the index after the component
  ("Liquor, beverage and refined tea manufacturing: producer price
  index") and 19 capitalised the component ("CPI: Transport and
  communication") against 204 reading "CPI: food". The normaliser now
  folds the suffix form, keeps the urban and rural variants in front
  ("Urban CPI: livestock meat"), and lowercases the component unless it
  is an acronym or a proper adjective; the first attempt missed the
  lowercase index name after "Urban", which the test caught.
  GLOSS_FORMAT bumped to 15; tests added. Verified live on the liquor
  PPI, the transport CPI and the urban livestock CPI, with the headline
  "Consumer Price Index" unchanged.
- 2026-09-10 round 126: audited Home's Coverage card and footer on the
  live site against what the store holds. The counts agree (8,776
  monthly and 793 quarterly NBS series, 18 headline indicators by
  agency, 24 FRED series), but three lines misdescribed the holdings:
  the 360 unstored series were said to be retried or fetched on view,
  where round 108 established they are tables NBS lists but has never
  filled; the FRED agency list omitted the US Treasury and BLS series
  the sidebar shows; and "Annual series" as not included contradicted
  the World Bank annual series. The card now says "the other 360 are
  tables NBS lists but has published no data for, retried monthly",
  names all seven FRED agencies, and says "Annual NBS series"; the
  footer names the international agencies via FRED beside NBS, PBOC,
  Customs and Caixin. Verified live.
- 2026-09-10 round 127: audited the Provinces page's colour ramp and
  tile geography on the live site. The five ramp breaks equal the
  quantiles of the 31 current values recomputed independently (2.7, 4.0,
  4.5, 4.9, 5.4), and Heilongjiang, Xinjiang, Tibet, Shanghai, Beijing
  and Hainan sit where the approximate geography puts them. One
  inconsistency: the legend printed "4" where the tiles and the other
  ticks show one decimal. The ticks now read with one decimal. Verified
  live: "2.7, 4.0, 4.5, 4.9, 5.4".
- 2026-09-10 round 128: audited the next-release rows that the release
  calendar feeds on the live site. GDP reads the 19 October quarterly
  bundle and the 70-city prices read 15 September, both right. Defect:
  every series without a mapped release fell back to "Not scheduled
  this month", which read as a scheduling gap on the People's Bank money
  supply and the BIS credit series, whose publishers are not in the NBS
  calendar at all, and on provincial GDP, which provinces publish after
  the national release. An NBS series now says the calendar has nothing
  for it this month or next; another agency's series says the NBS
  calendar does not cover it and names the publisher. Verified live on
  all four pages.
- 2026-09-10 round 129: audited `/api/status` and `/api/schedule` on the
  live site after a day of some forty deploys. No failures today; the
  store holds 1,315,263 observations at 454 MB; the fetch log stands at
  30,270 rows since 7 September, about 900 more than round 118 for six
  further boot ingests, as expected. The cold summary took 14 s because
  the call landed during the last deploy's boot ingest (round 105
  measured 8 s cold, 1 s warm); the count is cached for five minutes, so
  this costs one audit call a deploy and no visitor. The schedule's next
  release is the 70-city prices on 15 September at 09:30 and the last
  release refresh is still null, as expected before that day. Nothing
  to fix.
- 2026-09-10 round 130: audited the share image with two live renders not
  yet covered: a three-headline compare with mixed units (reserves as
  year-on-year change, M1 and M2 growth, both LPR tenors), whose
  subtitle joins the two units and whose five end labels spread without
  collision, and GDP on a one-year window. Defect on the second: twelve
  month labels under five quarterly points, because the tick rule
  switched to years only beyond three years and otherwise stepped by
  months. Quarterly data now steps by whole quarters from its own
  quarter-end months. Test added. Verified live: the one-year GDP image
  reads Jun 25, Sep 25, Dec 25, Mar 26, Jun 26.
- 2026-09-10 round 131: measured three states no mobile round had covered
  at 390 px on the live site: the whole Home page down to the Coverage
  card (the bundle's ten links wrap inside the Upcoming card), the
  Recent page, and the CPI page with the Download menu open. All three
  lay out at exactly 390 px with no element past the edge. Nothing to
  fix.
- 2026-09-10 round 132: dark mode. No stylesheet change since round 84.
  Rendered two dark surfaces no dark round had covered: the Home hero
  tiles (panel and ink tokens, chart-1 sparkline) and the CPI page's
  Share menu popover (panel, border and ink tokens); the toast is
  styled ink on ground, so it inverts with the theme. Headless Chrome
  left the Copy link clipboard call pending, so no toast could be read
  there; the handler shows "Link copied" or "Could not copy the link".
  Nothing to fix.
- 2026-09-10 round 133: probed the topbar and sidebar for screen readers
  on the live site: the nav is a landmark named Primary, the brand link
  reads "EconStats China Data", the sidebar is a complementary landmark
  named Catalog with disclosure groups, and the current series link
  carries its current state. One gap: the theme button read only
  "Switch theme"; the change is announced by a toast, but the resting
  name gave no state. It now reads "Switch theme, now dark", "now light"
  or "now following your system". Verified live at rest and after a
  press.
- 2026-09-10 round 134: audited the docs against the code since round
  123. Undocumented: search pieces matching through the alias dictionary
  (round 124), the suffix-form and lowercase index title rules (125),
  and quarter ticks on a short quarterly share image (130). AGENTS.md's
  search and gloss paragraphs and the README's share image bullet now
  carry them. The Coverage card and footer copy (126), the ramp ticks
  (127), the next-release fallback (128) and the theme button's name
  (133) are interface copy needing no doc. Docs only, no deploy.
- 2026-09-10 round 135: audited search for ten queries aimed at the
  international series on the live site (household debt, government
  debt, policy uncertainty, treasuries, yuan dollar, real house prices,
  leading indicator, consumer confidence, life expectancy, gdp per
  capita). All ten led with the right series: the BIS household credit
  and real property prices, the IMF government debt, both uncertainty
  indices, the Treasury holdings, the exchange rate, the OECD leading
  indicator and consumer confidence, and the World Bank life expectancy
  and GDP per capita, with the NBS quarterly GDP tables following the
  last. Nothing to fix.
- 2026-09-10 round 136: audited ten random headline and international
  series pages on the live site (CPI, PMI, new loans, reserves, OECD
  leading indicator, US exports to China, US import prices from China,
  and the World Bank fertility, GDP per capita and population aged 65
  series), which the random rounds had never drawn because they sample
  the NBS catalog. Every payload is served from the store with ordered
  periods, no duplicates or nulls, and current last values; the pages
  read their units, ranges and "Not in the NBS calendar; published by"
  rows correctly. One defect: annual series carried "Not seasonally
  adjusted", a statement with no meaning for yearly data, because the
  tag was added to every series not marked adjusted. Annual series now
  omit it. Verified live: the Fertility Rate page's meta line ends with
  World Bank and the CPI page keeps the tag.
- 2026-09-10 round 137: audited the Home list's descriptors, the small
  line under each name giving measure and agency, against each series'
  unit and agency on the live site. All fourteen match (the Caixin rows
  show the agency alone since the name is the measure). One
  inconsistency: agencies are abbreviated, "NBS" and "PBOC", except the
  trade row's "General Administration of Customs", which the tagline
  calls "Customs". The row now reads "Exports (YoY %), Customs".
  Verified live.
- 2026-09-10 round 138: audited the Provinces page against a period the
  store lacks, the one input no Provinces round had tried. The API
  answers such a period with 31 regions and no values, and the page
  drew an empty map and ranking under a "Q1 2030" heading with the
  control showing Q2 2026 and no message, which a stale bookmark or a
  typo in the URL would produce. The page now returns to the latest
  quarter with a toast naming the quarter it could not show. Verified
  live: #/regions?period=2030-Q1 lands on #/regions with all 31 tiles
  and the Q2 2026 heading, and #/regions?period=2020-Q1 stays on Q1
  2020.
- 2026-09-11 round 139: audited the release calendar and `/api/schedule`
  on the first morning after a release day has passed into the window's
  history. The schedule still lists all 24 future releases from 15
  September; the calendar's default window carries the two 9 September
  releases as past items; the client's upcoming rule, a release whose
  China Standard Time instant is still ahead, keeps them off the Home
  card and the next-release rows; the last release refresh is still
  null. The shell classifier was unavailable for part of this round, so
  the API was read through the fetch tool and the page logic by reading
  the code rather than a rendered page. Nothing to fix.
- 2026-09-11 round 140: audited `/api/status` on the live site on the
  first morning with no deploys yet. The store holds 1,315,267
  observations; the fetch log 30,913 rows; the warm summary and health
  answer in a second, the cold summary in eight. One failure since
  yesterday morning: the 70-city average at 21:28, when Eastmoney closed
  the socket mid-fetch during a boot ingest and the single retry did not
  save it; the 22:14 boot ingest fetched it with 374 points, so the
  store never lacked it. The daily due check next runs at 22:14 and the
  headline sweeps at 10:10, 11:10 and 16:10. Nothing to fix.
- 2026-09-11 round 141: audited the share image with two live renders not
  yet covered: reserves shown as percent change from the previous
  period, which renders right, and the annual World Bank population aged
  65 series. Defect on the second: annual points are dated December of
  their year and the year ticks sat at the following January, so every
  value stood at the next year's label and read a year late; the ten-year
  chart started at "2017" with no 2016 label. Annual ticks now sit on
  the points' own month. Test added. Verified live: the image reads 2016
  to 2025 with each label on its point.
- 2026-09-11 round 142: round 141 surfaced the same defect on the page
  chart, which has its own tick rule: year ticks at January the first,
  so an annual series' December-dated points sat at the next year's
  label on views over six years, and under six years were labelled by
  month ("Dec 19"). An annual chart now puts a year label on each point.
  Verified live: the population aged 65 chart's labels 2016 to 2025 sit
  exactly at the line's two ends, and the monthly CPI chart's year ticks
  are unchanged. The mobile surface moves to the next round.
- 2026-09-11 round 143: measured two chart states no mobile round had
  covered at 390 px on the live site: the annual population aged 65
  chart after round 142, whose axis thins to 2016, 2019, 2022 and 2025
  with each label still on its point, and the four-province compare,
  whose four chips, legend and "four series is the most" note wrap
  inside the viewport. Both lay out at exactly 390 px with no element
  past the edge. Nothing to fix.
- 2026-09-11 round 144: dark mode. Rendered two dark surfaces no dark
  round had covered: the four-line provincial compare and the chart
  tooltip on hover. The tooltip takes the panel, ink and border tokens
  and the grid, axis text and zero line their dark tokens. Defect: the
  dark palette's third series colour was #008300, a deep green at about
  4:1 on the panel and far darker than its neighbours, so Hubei's dotted
  line was the least legible on the chart. It is now #22b573, about
  6.5:1, in both dark blocks; the light palette is unchanged. Verified
  live: the four dark strokes read blue, pink, the new green and amber,
  and the light strokes are as before.
- 2026-09-11 round 145: probed the release calendar's month navigation
  and the Browse page for screen readers on the live site. The month
  buttons are named "Previous month" and "Next month", the Browse cards
  read "工业 Industry 7,189 series", and both headings are right. One
  defect: pressing a month button moved the calendar but announced
  nothing, since the month label between the buttons was a plain
  element. It is now a status region. Verified live: the label carries
  the status role and reads "October 2026" after Next month, with the
  month in the URL.
- 2026-09-11 round 146: audited the docs against the code since round
  134. Undocumented: annual points dated December with their year label
  on the point, on both the share image and the page chart (rounds 141
  and 142), and the Provinces page's fallback from a quarter the store
  lacks (138). AGENTS.md's FRED and series URL paragraphs now carry
  them. The seasonal tag on annual series (136), the Customs
  abbreviation (137), the dark chart-3 token (144) and the calendar's
  month status region (145) are interface details needing no doc. Docs
  only, no deploy.
- 2026-09-11 round 147: audited search for ten desk-style queries on the
  live site (TSF, total social financing, FAI, IP, NBS PMI,
  non-manufacturing PMI, M1, CNY, FX reserves, trade surplus). Six led
  with the right series; total social financing is People's Bank data
  the catalog does not hold, so its two spellings are honestly empty.
  Two defects: "IP" matched a fixed-line call-duration series by its
  letters, and "NBS PMI" ranked a catalog sub-index above the headline
  PMI because "nbs" had to match. "ip" now means industrial value added
  on both the headline and the catalog side, and "nbs" is a stop word
  like "national" and "china". Test added. Verified live: "IP" leads
  with the industrial production headline, "NBS PMI" with the headline
  PMI, and "pmi" and "industrial production" are unchanged.
- 2026-09-11 round 148: audited ten random stored series pages from the
  smaller categories the random draws had never reached (transport,
  telecoms, construction, household living standards, national
  accounts, culture) on the live site. Periods ordered, no duplicates
  or nulls; the transport series lose January from 2024 as NBS combines
  it with February. One defect: sixteen national-accounts glosses carried
  their index base inside the English text, "Value added index of
  construction (same period last year=100), quarterly value", where
  every other index reads its base last as ", same period a year
  earlier = 100". The title builder now strips the inner parenthetical
  and derives the base from the title when the unit field has none.
  GLOSS_FORMAT bumped to 16; test added. Verified live on the
  construction and real estate value-added indices and the GDP index,
  with "CPI: food, same month a year earlier = 100" unchanged.
- 2026-09-11 round 149: exercised Home's fallback on the live site, the
  one Home path no round had run: with the single headline payload
  blocked in the browser, the page fell back to one request per
  indicator, eighteen in all, and every hero tile and list row filled
  with the same values the payload gives (GDP 4.7, CPI 0.8,
  unemployment 5.2, PMI 49.8, and the fourteen rows). Nothing to fix.
- 2026-09-11 round 150: read the Provinces page's lede, Notes card and
  detail panel word by word on the live site, the parts no Provinces
  round had read in full. The lede states the measure (year-to-date
  real GDP, % change from the same period a year earlier), how to read
  Q2 and Q4, and the source; the notes explain 本期累计, the historical
  gap between provincial sums and the national total, the low-base
  caution for small western provinces, and the absence of Hong Kong,
  Macao and Taiwan; the Tibet panel reads "6.3%, Q2 2026, year to date"
  with an eight-quarter sparkline matching the API's window. Nothing to
  fix.
- 2026-09-11 round 151: audited the release calendar's failure paths on
  the live site ahead of the first release day. With the calendar
  request blocked in the browser, the page shows "Release calendar
  unavailable. NBS didn't respond. The schedule is also published at
  stats.gov.cn." with a working Try again. On the server, the release
  plan is rebuilt a minute after boot and every six hours, so a failed
  agenda fetch is retried within the day; timers are set for releases
  within eight days and refreshed on each rebuild; and the fixed
  headline sweeps at 10:10, 11:10 and 16:10 China Standard Time would
  catch the 15 September data even if every plan fetch failed. Nothing
  to fix.
- 2026-09-11 round 152: audited `/api/status` on the live site at 09:13.
  The summary answers in a second; no failures today; the store holds
  1,315,270 observations and the fetch log 31,430 rows; the latest runs
  are the 08:55 deploy's boot ingest, all ok. The first headline sweep
  of the day is at 10:10 China Standard Time, still ahead. Nothing to
  fix.
- 2026-09-11 round 153: audited the share image with two live renders not
  yet covered: a compare of quarterly GDP with the annual World Bank
  dollar GDP, which converts the quarterly series to annual averages
  with a note and drops the incomplete first year, and railway
  passenger traffic shown as change from the previous period, carrying
  the February note. Both render right. One wording gap on the second:
  the transformed unit read "Change" on the page, the table and the
  image, where the option that produces the view reads "Change from
  previous period", and the percent view likewise. The labels now name
  the period on both the catalog and the headline side. Verified live:
  the API returns "Change from previous period" and "Percent change from
  previous period", and the page's meta and stat lines carry the former.
- 2026-09-11 round 154: measured three states no mobile round had covered
  at 390 px on the live site: the October calendar with the quarterly
  bundle's ten links, the CPI page with the Custom range open (the two
  month fields stack, focus on From), and the GDP page down to its
  Revisions section. All lay out at exactly 390 px with no element past
  the edge. Nothing to fix.
- 2026-09-11 round 155: dark mode. The only stylesheet change since
  round 84 is the round-144 chart-3 token, so this round computed the
  contrast of every dark token on the dark panel (#161f2b) rather than
  eyeballing a page: the eight chart colours sit between 4.2:1
  (chart-2) and 6.3:1 (the new chart-3), above the 3:1 floor for 2 px
  lines; amber 7.4:1, muted ink 7.5:1, faint 6.5:1, the strong line
  5.6:1 and body ink 13.8:1. Nothing to fix.
- 2026-09-11 round 156: probed the chart itself for screen readers on the
  live site, the one part of the series page no accessibility round had
  read. The SVG is focusable with a title and a description, the arrow
  keys step a tooltip from point to point (Recharts 3's accessibility
  layer), the range buttons sit in a group named Date range, and the
  Chart and Table tabs form a tablist named View. One gap: the
  description pointed only to the Table tab, so a screen reader user had
  no way to learn the keyboard path. It now reads "Arrow keys step
  through the points; the Table tab lists the values." Verified live.
- 2026-09-11 round 157: audited the docs against the code since round
  146. Undocumented: "nbs" as a stop word and "ip" as industrial value
  added (round 147), an index base written inside a gloss moving to the
  end (148), the transform labels naming their period (153), and the
  chart's keyboard path (156). AGENTS.md's search, gloss and transform
  paragraphs now carry the first three, and the README gains a keyboard
  and screen reader bullet for the last. Docs only, no deploy.
- 2026-09-11 round 158: audited search for ten single-word queries on
  the live site (profits, investment, revenue, exports, prices,
  employment, wages, output, sales, debt). Nine led sensibly; "revenue"
  leads with an industry software line where the reader's intent is
  ambiguous, left as is. Defect: "investment" led with the enterprise
  "Investment income" line, because its alias was the broad 投资, which
  both tables contain, and the shorter English title won the tie. The
  alias now names 固定资产投资 first, and a hit on a word's first alias
  carries a small bonus, the size of the leading-concept one, so the
  primary meaning edges out later ones. Test added; the 103 earlier
  tests still pass. Verified live: "investment" leads with fixed-asset
  investment, "investment income" and "real estate investment" keep
  their tables, and "cars" and "inflation" still lead with automobile
  output and CPI. Queued the legibility split raised by the owner's
  question as an owner's call.
- 2026-09-11 round 159: audited ten stitched family series on the live
  site, the path no random round had targeted, fetching each full
  history and checking the joins. Periods ordered, no duplicates; the
  quarterly-looking gaps in 2007 and 2010 sit inside one slice's own
  span, which is how NBS published those enterprise indicators then.
  One defect: two families' notes said the pieces were joined into one
  series "covering 2003 to present" beside a Range row of Feb 2007 to
  Jul 2026, because a piece named from 2003 holds data only from 2007
  and no piece covers 2012 to 2017. The note now calls the span nominal
  and defers to the Range row for what the pieces hold. Verified live
  on the ferrous-metal export delivery series.
- 2026-09-11 round 160: measured what a first visitor to Home waits for,
  on the live site: a 7 KB stylesheet and a 205 KB script (Recharts and
  React, gzipped), then four API calls in parallel, the catalog stats,
  the headline payload, the releases and the catalog list, 9 KB together
  and each answered in under half a second. Nothing on the page waits
  on anything but the script. Nothing to fix.
- 2026-09-11 round 161: checked the provincial GDP data on the live site
  against the national figure, the one plausibility check no Provinces
  round had made. All 31 provinces carry Q2 2026: median 4.5, unweighted
  mean 4.27, Tibet 6.3 at the top and Hainan 2.0 at the bottom, against
  national growth of 4.7, which is consistent for an unweighted spread;
  the regional store was refreshed at 09:51 today. Nothing to fix.
- 2026-09-11 round 162: checked the next-release rows on three headline
  series the 15 September releases will update but whose keys sit
  under different releases: electricity output (energy production),
  the real estate climate index (real estate development and sales)
  and unemployment (the monthly bundle). All three name the right
  release. One overpromise: the real estate climate index comes through
  AkShare, which this deployment does not run, so its row announced a
  release the site will not pick up. The row now adds "not refreshed on
  this deployment, which does not run AkShare", matching the page's
  notice. Verified live on both the real estate and electricity pages.
- 2026-09-11 round 163: audited `/api/status` on the live site at 10:05.
  No failures today; the store holds 1,315,273 observations and the
  fetch log 31,901 rows; the latest runs are the 10:02 deploy's boot
  ingest, mid-way through the provinces, all ok; the cold summary took
  13 s during that ingest as in rounds 105 and 129. The 10:10 headline
  sweep was still ahead. Nothing to fix.
- 2026-09-11 round 164: audited the share image with two live renders not
  yet covered: a series with a long English title (foreign and
  HMT-invested enterprises' current assets, same period last year),
  which fits its line with 190K-style axis labels for hundred-million
  yuan, and the AkShare real estate climate index, whose note reads
  "Last value Dec 2025; refreshed through AkShare, which this deployment
  does not run." Both render right. One render needed a longer download
  wait on this machine, which is a tooling note, not a site one. Nothing
  to fix.
- 2026-09-11 round 165: exercised the mobile catalog toggle at 390 px on
  the live site, the one phone interaction no mobile round had tried.
  Opening it lays the catalog out at 390 px with no element past the
  edge and the toggle reports expanded. One defect: after a link in the
  panel was followed, the panel stayed open on the new page, so the
  reader landed under 560 pixels of catalog. The panel now closes on
  any route change. Verified live: after choosing GDP from the open
  panel, the GDP page shows with the toggle collapsed and the catalog at
  zero height.
- 2026-09-11 round 166: dark mode. No stylesheet change since round 144.
  Rendered two dark states no dark round had covered: the Provinces
  tile map, whose six-step blue ramp is the same in both themes and
  reads on the dark card from bright tiles with dark text to deep blues
  with white text, with the ranking bars and legend in their tokens;
  and the mobile catalog panel open at 390 px, which takes the dark
  panel and ink tokens. Nothing to fix.
- 2026-09-11 round 167: walked the search entry path by keyboard on the
  live site, the one path no accessibility round had walked. The slash
  shortcut focuses the topbar box on a series page and the hero box on
  Home, both named "Search series" and announcing "/" as their
  shortcut; Enter runs the search and focus lands on the results' main
  region; from there the tab order is the Home breadcrumb, the Frequency
  and Dataset filters, then the first result. Nothing to fix.
- 2026-09-11 round 168: audited the docs against the code since round
  157. Undocumented: a word's first alias as its primary meaning (round
  158), the family span being nominal with the Range row stating what
  the pieces hold (159), and the next-release row of an AkShare series
  saying the release is not picked up here (162). AGENTS.md's ranking
  and families paragraphs and the README's AkShare bullet now carry
  them. The mobile catalog closing on navigation (165) is an interface
  detail needing no doc. Docs only, no deploy.
- 2026-09-11 round 169: search quality, fifteen researcher queries on the
  live site. Twelve rank well (youth unemployment, house prices, steel,
  pork, money supply, fiscal revenue, coal, electricity, cement, exports,
  new loans, tourism, the last honestly limited to CPI travel services).
  Broken: "exports to us" and "exports to the united states" returned
  only US Exports to China, the opposite direction, because the curated
  match kept every term and nothing on US Imports from China said
  "exports". The two US trade series now carry the phrases a researcher
  types for each direction (exports to us, imports from us, and their
  united states and america forms), and the curated matcher, lifted out
  of the route as `matchCurated` with its own test file, puts the entry
  whose text holds the whole query phrase first, so "exports to us" leads
  with US imports from China and "us exports" still leads with US
  exports. Synonyms are joined with a separator so phrases cannot form
  across two of them. Verified live in both directions. Also seen and
  left: "population", "birth rate" and "land sales" find no NBS series
  because the snapshot holds only the national monthly and quarterly
  datasets, and "population" pulls in telephone subscribers through the
  model query expansion, not the code; "car sales" is queued.
- 2026-09-11 round 170: "car sales" led with automobile output because
  the phrase alias mapped to 汽车销量, a string no title carries, so every
  汽车 title tied and the shortest, output, won. The alias now names the
  two sales tables, 汽车类商品零售 (retail sales of automobiles, monthly,
  current) and 汽车销售量 (automobile sales in units, quarterly, ended
  2019); the older duplicate alias line was removed. Verified live: the
  four monthly retail sales of automobiles lines lead, the quarterly
  unit sales follow, and "cars" still leads with automobile output.
- 2026-09-11 round 171: audited ten random catalog series pages on the
  live site (fixed asset investment price index for other expenses,
  general-purpose equipment profits, pharmaceutical principal business
  cost, power industry liabilities 2001-2002, other industrial enterprises'
  investment income, ferrous metal revenue, furniture current assets,
  ferrous mining VAT payable, textile employees, leather value added).
  Units, ranges, families and notes all right; the industry tables NBS
  renamed between slices (power, leather) stand alone on purpose. One
  defect: 306 of the 8,844 colon titles capitalised the word after the
  colon ("Leather, fur, feather (down) and related products: Value
  added") where the other 8,200 read lowercase, because the gloss file
  capitalised some industry measures and the lowercase rule covered only
  the CPI, PPI, RPI and PMI prefixes. The rule now covers any prefix,
  keeping "Chinese" and acronyms; four cases added to the gloss test and
  GLOSS_FORMAT 17 rebuilds the stored glosses. Deployed with `railway up`
  (a push alone does not deploy). Verified live: the leather title reads
  "value added", building materials reads lowercase after the purchasing
  price index, "traditional Chinese medicine" and "VAT payable" keep
  their case.
- 2026-09-11 round 172: audited Home and the four hero tiles on the
  live site, rendered headless. Tiles: GDP 4.7% Q2 2026, CPI 0.8% Aug
  2026, unemployment 5.2% Jul 2026, PMI 49.8 Aug 2026, each with its
  series label, period and change, all from the store and refreshed
  today; the indicator list's 14 rows carry the right periods, and the
  export (+25.0%), import and new-loan (-5,896) figures are what Customs
  and PBOC published, consistent month to month. One defect: the
  Provincial Real GDP Growth row showed Guangdong's 4.5% with no
  province in the row, so a reader could not tell whose growth it was.
  The small print of Home rows and hero tiles now starts with the
  region's English name when the payload is one region's series.
  Deployed with `railway up`. Verified live: the row reads "Guangdong,
  Real GDP, cumulative YTD (YoY %), NBS", the national rows unchanged.
- 2026-09-11 round 173: audited the Provinces page and
  `/api/regional/provincial_gdp` on the live site. The payload holds all
  31 provinces on Q2 2026 with eight quarters each; the heading, lede
  (measure, unit, what Q2 and Q4 mean, source), period picker, tile
  labels (province and value for screen readers) and legend are right.
  One defect: the ranking card was capped at 640 px with a scrolling
  overflow, and macOS hides the scrollbar, so the page showed Tibet down
  to Chongqing (18 rows) and gave no sign that the thirteen slowest
  provinces sat below. The cap is removed. Deployed with `railway up`.
  Verified live: the ranking renders 31 rows in 1,101 px with no
  overflow, Hainan 2.0 last. Seen during the deploy: the Railway edge
  answered `/api/releases` and `/api/schedule` with a 502 for a few
  seconds at the container switch, while `/health` answered 200.
- 2026-09-11 round 174: audited the release calendar and `/api/schedule`
  on the live site after the round 173 deploy. `/api/releases` lists 26
  NBS releases for September and October, each with its English name and
  either headline keys or catalog categories (fixed-asset investment,
  industrial profits, capacity utilisation, household income, value added
  by major industry and the culture industries map to categories only,
  as intended). The schedule was empty for the first minute after boot,
  by design (the plan runs 60 s after boot), then held 24 upcoming
  releases with the 15 September house-price and monthly-bundle timers
  set; the last-refresh field is still null because no mapped release
  has occurred since round 45 recorded it, so 15 September is its first
  test. Nothing to fix.
- 2026-09-11 round 175: audited `/api/status` on the live site. No
  failed runs in the latest twenty; the failure list held the expected
  AkShare skips plus one pattern: the 70-city house price refresh had
  failed nine times since 9 September on its first region, the 70-city
  average, with "the socket connection was closed unexpectedly", and
  recovered on the next region's download a minute later. The average
  region is the one that triggers the 27-page table download, nine pages
  in flight at once; the same bursts succeed from a residential IP, so
  the drops belong to the deployment's network. A failed page was
  retried once at once; it is now retried twice after 2 and 6 second
  pauses, and pages load five at a time. A local ingest of all 71
  regions passed through the changed loader. Deployed with `railway up`.
  Verified live: the new container's boot ingest loaded the average
  region first time (374 points) and no fetch has failed since.
- 2026-09-11 round 176: audited the share image with a live render no
  round had covered, a two-province compare (Guangdong and Shanghai,
  10 years). Title names both provinces, subtitle carries the unit,
  frequency and Q2 2016 to Q2 2026 span, dashed second line, end labels
  5.6 and 4.5, source, URL and retrieval date all right. The 44 layout
  and palette tests pass. Nothing to fix.
- 2026-09-11 round 177: mobile at 390 px on the live site, three pages
  no mobile round had rendered: the two-province compare, a 70-city
  house price city page and a search results page. No element crosses
  the right edge and the document is 390 px wide on all three. One
  defect on the provincial GDP page: a Related Series heading with
  nothing under it, because the curated branch rendered the section
  whenever the series was curated, and provincial GDP is alone in its
  group. The section now needs at least one sibling, as the NBS catalog
  pages already required. Deployed with `railway up`. Verified live: the
  provincial GDP page has no Related section, GDP keeps its four tiles.
- 2026-09-11 round 178: dark mode on the live site, two states no dark
  round had rendered: the Table tab of a two-province compare (ink
  230,235,240 on cards 22,31,43, header row 163,176,189 on 27,37,50,
  the active tab white on navy) and the search results page (result
  cards, category paths, the auto-translated badge and the range line
  all in their tokens). Both read right. Nothing to fix. Seen while
  measuring: every request paid about a second and one `/health` call
  took 12.9 s while the new container's boot ingest ran, the condition
  rounds 105, 129 and 163 recorded; timings are being sampled through
  the ingest window for the next round.
- 2026-09-11 round 179: walked the Provinces tile map by keyboard on
  the live site, the one keyboard path no accessibility round had
  walked. The first tile is named "Beijing, 5.4%"; Enter selects it
  (aria-pressed true, the ranking row highlighted, Open series and Add
  to comparison offered) with focus kept on the tile; Tab moves to
  Tianjin, Hebei and Shanxi in map order, each named with its value.
  Nothing to fix.
- 2026-09-11 round 180: audited the docs against the code since round
  168. Undocumented: the word after any colon reading lowercase (round
  171), the region prefix on Home rows and hero tiles (172) and the
  Eastmoney page retries and five-page batches (175). AGENTS.md's gloss
  paragraph and the 70-city house price entry now carry them. The
  ranking without a height cap (173) and the Related section needing a
  sibling (177) are interface details needing no doc. Docs only, no
  deploy.
- 2026-09-11 round 181: search quality, ten researcher queries on the
  live site. Eight rank well (industrial profits, fixed asset
  investment, trade surplus, housing starts, rail freight, urban income,
  foreign direct investment, which honestly leads with the NBS series
  that ended in 2019). Honestly limited: "consumer confidence" finds
  only the OECD series because NBS's index is not in the snapshot, and
  "local government revenue" finds nothing because the monthly tables
  carry only the national figure. Defect: "soybean" and "egg" found no
  NBS series while "soybeans" and "eggs" did, because Latin terms
  matched on word boundaries and the gloss writes the plural. A term
  now matches with an optional s or es, and a typed plural of four
  letters or more also tries its singular; aliases for maize and soy
  added. Test added; 130 pass. Deployed with `railway up`. Verified
  live: soybean, egg, eggs and maize reach their series, and "house"
  still does not match household. Also seen: every request from this
  location pays about a second, of which TCP and TLS are 0.55 s and the
  server's share about 0.15 s, so the floor is geography, not the site;
  one `/health` call took 12.9 s during the boot ingest, as before.
- 2026-09-11 round 182: audited ten random catalog series pages on the
  live site. Units, English titles, families and notes right on nine;
  one request met a 502 at the round 181 deploy's container switch.
  Defect: the textile, apparel and accessories operating revenue series
  opened with nine months of 0.0 (April to December 2016) before real
  figures in 2017. NBS's own esData returns "0.0" with no flag for
  months before an indicator existed in the 2012-2017 table (fetched
  raw to confirm; January to March 2016 come back empty and were already
  skipped). Leading zeros before the first non-zero value are now
  dropped on read from level and index series; rates keep theirs and
  the store keeps what NBS sent. Test added; 131 pass. Deployed with
  `railway up`. Verified live: the revenue series starts at February
  2017 with no zeros; a PPI subindex that read 0 after the growth
  transform was checked raw and is a genuine 100.0 (prices unchanged),
  which the rule correctly leaves alone. Queued: the search results'
  first period, rate-series placeholders, and the cold health count.
- 2026-09-11 round 183: Home and the four hero tiles on the live site,
  rendered headless after today's deploys: the same values, periods and
  changes as round 172, the regional row naming Guangdong. Nothing to
  fix.
- 2026-09-11 round 184: queue item, the cold health count. Sampled
  through two deploys: `/health` took 12.9 to 15.9 s on the first calls
  after each container switch and about a second otherwise, the cost of
  COUNT(*) over 1.3 million rows read from a cold volume (the search and
  status calls beside it were unaffected once the boot ingest ended).
  The health line now reads MAX(rowid), instant on an append-only table,
  and still adopts the status page's exact count when that is fresher.
  Deployed with `railway up`. Verified live: health answers ok with
  1,315,365 against the exact 1,315,277, the 88 rows a hand deletion
  removed on 8 September, in under a second. The first call after a
  switch is Railway's own healthcheck, which the edge hides, so its
  timing cannot be sampled from outside; the count is gone from the path
  either way.
- 2026-09-11 round 185: queue item, the search results' first period.
  After round 182 the textile operating revenue page opened at February
  2017 while its search result still said 2016-04, the stored first
  period. The stored-latest query now also reports the first period
  with a non-zero value, and search uses it for level and index series
  (rates keep the stored first period, pending the rate rule). Store
  test added; 132 pass. Deployed with `railway up`. Verified live: the
  revenue level and its same-period-last-year sibling say 2017-02, the
  growth rate still 2016-04, crude steel unchanged at 1989-02.
- 2026-09-11 round 186: queue item, placeholder zeros on rate series.
  Measured on the live site: every industry operating-revenue growth
  series from the 2012-2017 table (eight of twelve sampled) opens with
  exactly nine 0.0 readings, April to December 2016, before its first
  real figure; the national and 2018-table series open clean. A rate
  now sheds its leading zeros when the run is six periods or longer
  (six periods of exactly 0.0 growth at the start of a real series does
  not happen; shorter runs are kept since a zero rate can be real), and
  search ranges apply the same rule by counting periods between the
  stored first period and the first non-zero one. Tests extended; 132
  pass. Deployed with `railway up`. Verified live: the textile growth
  page opens at February 2017 (6.6%), its search range and the other
  2016-table growth series say 2017-02, the national series stays at
  2019-02.
- 2026-09-11 round 187: docs. AGENTS.md now carries the NBS placeholder
  padding and the read rule (rounds 182, 185, 186) beside the esData
  cap note, and why health reads the highest rowid (184) in the
  deployment section. Docs only, no deploy.
- 2026-09-11 round 188: search quality, ten more researcher queries on
  the live site. Seven rank well (auto production, passenger traffic,
  port throughput, semiconductors, lithium, excavator sales, mortgage,
  the last three honestly ending where NBS's own data ends: the
  lithium-ion battery indicator was fetched raw from NBS and carries
  nothing after December 2024, and excavators end in 2019). Honestly
  limited: "bank deposits" and "shadow banking" find nothing, since the
  monthly NBS tables carry no PBOC deposit data. Defect: "gold
  reserves" led with Official Foreign Exchange Reserves, whose synonyms
  include the phrase, but the series held only the FX line. The PBOC
  release Eastmoney mirrors carries gold reserves in US dollars in the
  same table; it is now the series' second line. Deployed with
  `railway up`. Verified live after the boot ingest: the store serves
  FX reserves 34,383 and gold reserves 3,500.8 hundred million US
  dollars for August 2026, and "gold reserves" leads with the series.
- 2026-09-11 round 189: audited ten random catalog series pages on the
  live site: nine right (units, ranges, families, no leading zeros
  after round 186), one 502 at a container switch. Defect: 876 entries
  sat under translated category labels written "(–2023)" and "(2024–)"
  with an en dash, where the rest of the catalog reads "(to 2018)" and
  "(2018-present)", and three fish-price titles wrote a weight range
  with an en dash. Labels are normalised as they are attached
  (`plainRanges`), GLOSS_FORMAT 18 rebuilds the stored glosses; test
  added, 133 pass. Deployed with `railway up`. Verified live: the
  state-holding enterprises path reads "(to 2023)", the 2024 slice
  "(2024-present)", crucian carp "(0.2-0.5 kg)".
- 2026-09-11 round 190: docs. AGENTS.md now carries the plural rule
  for Latin search terms (round 181), the gold reserves line (188) and
  the year-range normalisation (189). Docs only, no deploy.
- 2026-09-11 round 191: mobile at 390 px, the Provinces page after
  round 173's ranking change: no element crosses the right edge, the
  map's 31 tiles are 40 px squares (44 would need more than the width
  allows at eight columns; the ranking rows below offer the same
  selection full width), and all 31 ranking rows show in 1,100 px.
  Nothing to fix.
- 2026-09-11 round 192: the Releases page on the live site, rendered
  headless: September's eleven releases grouped by day with time,
  English and Chinese names and links to the series and categories
  each updates, month navigation present. No fetch has failed since
  the round 175 deploy across five boot ingests. Nothing to fix.
- 2026-09-11 round 193: the FX reserves page after round 188, rendered
  headless: with gold at a tenth of the FX total on a shared axis the
  FX line flattened to a band near 30,000 and gold hugged the floor.
  Gold reserves are now their own curated series (Official Gold
  Reserves, PBOC, US dollars, same Eastmoney report, off Home) with the
  gold synonyms moved to it and a note that the dollar value moves with
  the gold price as well as with purchases. Deployed with `railway
  up`. Verified live after the boot ingest: the gold series serves from
  the store (3,500.8 for August 2026), "gold reserves" leads with it,
  and it is absent from Home.
- 2026-09-11 round 194: the Browse page and Home's category section
  titled every card with the Chinese name and put the English beneath,
  the reverse of every other surface. The English name now leads where
  one exists. Deployed with `railway up`. Verified live: the first
  cards read "Industry 工业" and "Price indices 价格指数" on both pages.
- 2026-09-11 round 195: the Energy category page showed the frequency
  and dataset menus as "Monthly (8,776)" and "National monthly (8,776)"
  beside 88 results, whole-catalog totals reading as counts within the
  category. Counts now show only on the full list. Verified live: the
  menus read "Monthly", "Quarterly", "National monthly" on the category
  page.
- 2026-09-11 round 196: dark mode on the Browse page after round 194:
  cards, titles and glosses take the dark tokens (22,31,43 cards,
  230,235,240 titles, 163,176,189 glosses). Nothing to fix.
- 2026-09-11 round 197: a result line on the Energy category page read
  "Monthly, NBS, 亿立方米" for gas output while the LPG line beside it
  read "10,000 tonnes (万吨)": the client's unit dictionary lacked
  fifteen of the server's entries. Added. Verified live: the gas line
  reads "100 million m³ (亿立方米)".
- 2026-09-11 round 198: the FX reserves page still drew the gold line
  after round 193, because the store is append-only and the label
  round 188 stored stayed. Store reads for curated keys now keep only
  the configured labels (Eastmoney and AkShare fields, NBS ids, the
  FRED label); the rows stay as the archive. Deployed with `railway up`
  together with rounds 195 and 197. Verified live: FX reserves serves
  one line from the store.
- 2026-09-11 round 199: docs. AGENTS.md carries the gold series (193),
  configured labels on store reads (198) and the client's copy of the
  unit dictionary (197). Docs only, no deploy.
- 2026-09-11 round 200: the CSV download, a surface no round had opened.
  The header carried the series title, unit, source, notes and retrieval
  date but never the region, so a file of Beijing's home prices was
  indistinguishable from any other city's, and the same for a province's
  GDP. A Region line is added when a series carries a non-national
  region. The builder moved from app.tsx into lib.ts, where a test now
  covers it. Deployed with `railway up`. Verified live: the Beijing
  house price CSV reads "# Region: Beijing" above the unit, 193 lines,
  last row 2026-07.
- 2026-09-11 round 201: audited the revision trails of ten headline
  series, the surface the append-only store exists for. Nine hold no
  revisions. Money supply holds two, and they are not revisions: M1 and
  M2 both read 0.0 for July 2026 at 09:02 on 10 September and the real
  4.0 and 7.7 ten minutes later, so the mirror served a bad body and the
  store archived it. The Eastmoney table pads nothing today, and the
  parser already skips null and empty, so this was a transient. The
  ingest now rejects a fetch whose every series reads exactly 0 for its
  newest period where the store holds a non-zero value, logging it as an
  error so the next run retries and a source that really published zeros
  fails visibly rather than quietly rewriting the archive. Rows are
  never deleted, so the two vintages stand, and the Revisions tab
  reports them accurately. Test added. Deployed with `railway up`.
  Verified live: no fetch has failed since, and the trail is unchanged
  at two entries.
- 2026-09-11 round 202: checked the site's own transforms against NBS's
  published growth series, which no round had done. The year-over-year
  transform was wrong for every monthly NBS activity series: it counted
  twelve array positions back, and NBS publishes no January (January and
  February come out together as the February point), so July was
  compared with the previous June. On crude steel output the site read
  +111.05% for February 2026 against NBS's published -3.60%, and all
  fourteen of the last months missed by more than 0.6 points. The
  comparison period is now looked up by its label (`shiftPeriod`,
  handling "2026-Q2" from the catalog and "2026-06" from the mirror),
  and a period whose comparison is missing yields no point, which also
  removes the false February from "change from previous period". Tests
  added; 136 pass. Deployed with `railway up`. Verified live against
  NBS: all twelve shared months now agree, the largest gap 0.18 points
  from the rounding in the published levels.
- 2026-09-11 round 203: widened round 202's check to five more
  level-and-growth pairs. Crude steel now agrees with NBS to 0.18
  points, but passenger traffic was out by 50 points at February 2026.
  Cause: the February fill. NBS publishes a single-month February for
  that series in most years but not in 2024 and 2025, so the fill put
  the year-to-date sibling's January-February total (276,370) beside
  the series' own single February (139,505), mixing one-month and
  two-month readings. Only a series that carries no February at all is
  filled now. Test added. Deployed with `railway up`. Verified live:
  the filled Februaries are gone, the page reports no `februaryFrom`,
  and the false -49.5% year-over-year point is gone with them.
- 2026-09-11 round 204: the gaps that remain between arithmetic
  year-over-year on a level and NBS's published growth (cement 2.5
  points, coal 1.7, electricity 2.1, integrated circuits 12.0) are not
  a bug: the catalog's own annotation says the sample is enterprises
  above designated size, whose membership changes every year, and NBS
  computes growth on a scope held comparable with the year before while
  publishing levels on the current scope. A level series now carries a
  note naming the published growth series for its table, so a reader
  can take NBS's figure instead of working one out. The sibling is
  resolved by title stem, since the level is in tonnes and the rate in
  percent. Tests added; 137 pass. Deployed with `railway up`.
- 2026-09-11 round 205: the round 204 note named the series with its
  unit suffix, "Crude steel output, growth from a year ago, %, computed
  on a scope...". The trailing ", %" is dropped where the name sits in a
  sentence. Queued: the note names the series but does not link to it.
- 2026-09-11 round 206: a consequence of round 203. Frequency
  conversion counted a period whole when one reading was missing, which
  is right for a series whose February holds the combined
  January-February figure (a first quarter of two readings is the whole
  quarter) but wrong for one that publishes a single February and no
  January: with the fill gone, passenger traffic's first quarter would
  have summed February and March and understated the quarter by
  January, about 135,000 of 415,000. The tolerance now follows the
  `februaryFrom` flag, carried to the chart as `Track.combinedFebruary`;
  a series without it must have every reading. Tests added and the
  existing conversion test marked; 138 pass.
- 2026-09-11 round 206 (verified): the live quarterly table for
  passenger traffic no longer carries the short Q1 2026 of 279,989; the
  other quarters are unchanged (Q2 2026 434,009, Q4 2025 420,660).
- 2026-09-11 round 207: regression check over the headline series after
  five data-path changes in a row (placeholder zeros, the zeroed-fetch
  guard, transforms by label, the February fill, frequency conversion).
  GDP 4.7% Q2, CPI 0.8% August, unemployment 5.2% July, PMI 49.8 August,
  industrial production 4.5% July, retail sales 0.6% July, exports 25.0%
  August: all unchanged from this morning, and no fetch has failed.
  Queued the derived January as an owner's call.
- 2026-09-11 round 208: search quality in Chinese, ten queries an
  economist would type (汽车产量, 水泥产量, 居民消费价格, 城镇调查失业率,
  社会消费品零售总额, 进出口, 固定资产投资, 猪肉价格, 新能源汽车). Nine
  lead with the right series. Defect: 规模以上工业增加值 returned nothing,
  because NBS states the above-designated-size scope in a table's
  annotation and never in a title, and annotations are not searched.
  The qualifiers 规模以上 and 限额以上, and a leading 全国, are dropped from
  a query when something is left to search for; 全国 alone still searches
  for the national total. Test added; 139 pass. Deployed with `railway
  up`. Verified live: 规模以上工业增加值 leads with Industrial Production
  (149 hits), 全国粗钢产量 with crude steel output, and 全国 alone and
  汽车产量 are unchanged.
- 2026-09-12 round 209: the comparable-scope note named the published
  growth series but provided no link, reproduced on the live crude-steel
  current-period page (the note contained zero anchors). The growth name
  now links directly to its series, preserving the source page's region.
  The note is rendered as a paragraph alongside the other reading notes.
  All 139 tests pass; the full TypeScript output has no china-explorer
  errors, only existing errors elsewhere. Committed as 729326c, pushed to
  china-data-explorer and deployed with railway up --detach. Railway
  reports success. Verified in a live browser: the level heading renders,
  the note links to nbs_1e7dfadac47f4d04b403d8f4f7516c4b with the national
  region retained, and clicking it renders the published growth heading.
- 2026-09-13 owner decision: do not derive January values from the
  January-February year-to-date total less February. Removed the proposal
  from the queue. Keep missing January readings absent as published and
  retain the existing incomplete-quarter handling. Documentation only.

- 2026-09-15 (regional and annual datasets): the catalog covered the national
  monthly and quarterly datasets only. It now carries all eight families the
  bureau publishes that we can reach: national monthly and quarterly, provincial
  monthly, quarterly and annual, city monthly and annual, and Hong Kong, Macao
  and Taiwan, 19,433 entries in a 1.6 MB gzipped snapshot where the two national
  ones alone were 12.7 MB. 13,258 browsable series, up from 9,569, and 121,000
  (indicator, place) pairs for the crawl to store. Found and fixed on the way:
  annual series had never worked, because the observations endpoint writes an
  annual period as 2026YY and answers a plain year range with HTTP 500; the
  endpoint returns one place per request whatever the request asks for, so the
  crawl and the due sweep now walk (indicator, place) pairs and batch by table
  and place; a busy portal answers 200 with no period grid, which the crawl had
  been storing as "this series is empty" and skipping for a month. The store
  was rebuilt WITHOUT ROWID with the duplicate index dropped (455 MB to 439 MB
  with three times the headroom), and where each series starts and ends is now
  a summary kept by the write path rather than a group-by over every
  observation. Search reads a place name in the query ("guangdong gdp"), the
  geography filter works, the Provinces page takes any regional series, and a
  title several tables share says which table it came from. Verified live:
  provincial GDP for Guangdong reads 145,846.8 亿元 for 2025, the store
  migrated in 18.5s on the volume, and the crawl is storing province by
  province. Annual national (another 43,000 series) is still being crawled; the
  portal throttles hard, so the collector now caches its answers and can be
  restarted without starting over.

- 2026-09-15 (regional audit and the annual dataset): audited the regional
  surface against the live site, twenty-one series across all six regional
  datasets. Everything fetched except the city tables whose place lists could
  not be collected, and those were being answered for the nation: the endpoint
  accepts the national code on a city table and returns a grid of zeroes, which
  the page showed under a 全国 label. A regional entry with no known places now
  fails rather than returning something untrue. Also this round: a provincial
  level series names the index NBS publishes as its growth (Guangdong's GDP
  index reads 3.9 percent for 2025); the Provinces page takes a series picker
  and downloads its cross-section as CSV; "population by province" is read as a
  geography filter rather than a subject; a series whose title is exactly the
  query leads the results ("birth rate" no longer opens with the World Bank
  fertility rate); a shared title leads with its table's English name and 501
  more category names were translated so that works at all; the frequency
  options offer only what a chart can convert to. Performance: search stopped
  lowercasing the whole catalog on every query (91 ms to 56 ms per query at
  19,433 entries) and /api/status stopped counting every observation to answer.
  GET /api/backup streams a consistent copy of the store to whoever holds
  BACKUP_TOKEN, which is half of the queued backup item. The annual national
  dataset crawl finished at 53,000 series, which takes the catalog past 70,000
  entries and about 59,000 browsable.
- 2026-09-15 (dataset loop, round 1): the site had no government bond yield,
  the most-quoted Chinese financial variable. Source: CFETS's closing curve
  history endpoint (chinamoney.com.cn, POST only), which returns every key
  tenor for every trading day of a requested month. `server/cfets.ts` serves
  the month-end close of the 1-, 2-, 5-, 10- and 30-year as `cgb_yields`.
  Tests: fixture of August 2026 (315 records, 21 trading days), month-end
  rule per tenor, malformed input. Live: 10-year 1.6879 at end-August.
- 2026-09-15 (dataset loop, round 2): Customs trade held the last 36 months.
  Each ingest run now adds 24 older months beyond the store's oldest, per
  partner, until the listing ends. Found on the way: three header layouts for
  the by-country table since 2023 (the parser refused two of them, as
  designed — fixtures and tests added), and a listing walk that slept 800 ms
  per cached page, which made a thirty-partner run take an hour; pacing now
  applies to real fetches only. Acceptance: two runs, 81 s and 136 s, US back
  to 2021-09, August 2025 US exports 31,604 stored against 31,604 published.

- 2026-09-15 (concordance): the GDP page said Q2 2026 grew 4.7 percent in
  the stat line and 4.3 in the chart, seen by the owner. The curated series
  came from Eastmoney's RPT_ECONOMY_GDP, whose quarterly row carries the
  year-to-date rate (第1-2季度), so the site served cumulative growth under a
  quarterly label. GDP now comes from NBS's quarterly index table with the
  quarter's rate first and the year-to-date rate as a second line; live,
  2026-Q2 reads 4.3 and 4.7. A sweep of the other curated Eastmoney reports
  found only TAX also cumulative, and it was labelled year to date already.
  The systemic answer is `server/concordance.ts`: eight pairs of curated
  headline against an independent reading (the NBS catalog crawl for CPI, PPI,
  industrial production, retail sales, M2, exports, unemployment; GDP's
  quarterly line against its year-to-date line under the rule that a period
  series equal to the cumulative one everywhere is the cumulative one). Six
  tests. Served at `/api/audit/concordance`, run nightly with findings in
  `fetch_log` under `concordance`, and as `bun run audit`. The first live
  run found two things: PPI read as "no overlap" because the pair named a
  2007-2013 year slice of the table (the monthly dataset carries the same
  table sliced by years and once unsliced; results now report each side's
  range so this reads off the report), and exports differed by 0.1-0.2 pp in
  revised months between the mirror and NBS (tolerance 0.25, reason recorded
  in the pair).
  Live after the fix: eight pairs, zero findings; CPI 0.8 vs 0.8 (2026-08),
  M2 7.7 vs 7.7, retail 0.6 vs 0.6, IP 4.5 vs 4.5 (2026-07). The loop protocol
  now starts every round with the audit and requires a pair for every new
  curated headline.

- 2026-09-15 (dataset loop, round 3: Customs release timing): Customs is not
  on NBS's calendar, so its tables were picked up by the daily sweeps and a
  series page could only say "not in the NBS calendar". Customs' English site
  publishes a calendar per year (preliminary release on the 7th to the 14th
  of the next month, bulletin the 18th, online tables the 20th; January and
  February together in March), and the numbered tables this site reads come
  with the preliminary release. `server/customs-calendar.ts` parses the
  year's page and yields agenda items in NBS's shape, merged into
  `/api/releases`, so the release plan fires a refresh ten minutes after each
  and the page names the next one. The release hour is not published; items
  are placed at 10:00 CST. The English site carries 2019-2025 and not yet
  2026 (2025's appeared on 6 February, 2024's on 12 March), so a missing year
  contributes nothing and the page says "by about the 14th of the following
  month" from the new `releaseDay` on the four Customs-sourced keys; `due.ts`
  takes a release day per source. Tests: 2024 and 2025 fixtures parse to the
  twelve preliminary days each, the listing links 2024 and 2025 and not 2026,
  September 2025 yields one item reporting August, a missing year yields none;
  `dueReason("Monthly", "2026-07", checked 9 Sept, on 14 Sept, 14)` is
  new-period and null for NBS. Live: `/api/releases?start=2025-09-01&end=2025-09-30`
  carries the 8 September item with the four keys beside 11 NBS items; the
  default window is 26 NBS items and no Customs ones; `/api/catalog` shows
  `releaseDay: 14` on trade, trade_partners, major_exports, major_imports.

- 2026-09-15 (menus): the Download and Share menus on a series page could
  both stand open, one over the other; they are details elements and nothing
  closed one when the other opened or when the reader clicked away. Opening a
  menu now closes the others and a pointer-down outside closes it. Verified by
  the deployed bundle carrying the change; no browser test harness existed at
  the time (one arrived with the next round).

- 2026-09-15 (dataset loop, round 4: Trade section): trade by partner was one
  home row for the Total and a ranking page written for provinces ("by City",
  source NBS, the Total ranked against countries, exports only). The home page
  now lists the United States, the European Union and ASEAN as their own rows
  (`homeRegions` on the indicator; `/api/home` keys them key@region); the
  ranking page takes a line to rank by (exports, imports, balance), names
  Customs, sets the month's Total apart in the lede and puts it first in the
  CSV; Customs tables have geography Partner or Commodity. Test: the first
  headless render test in the repo (`trade-home.test.ts`, Playwright on the
  installed Chrome, as scripts/portal.ts does): a server on a scratch store
  seeded from the August 2026 fixture; the three rows on the home page and no
  Total row; 29 ranked partners with the Total in the lede ("All partners,
  Aug 2026: 401,441 Million USD"); re-rank by imports; CSV of 30 rows with
  Total first. Live: `/api/home` carries trade_partners@united-states
  (42,475.3 million USD exports, August 2026), @european-union (55,106.3),
  @asean (74,377.2); `/api/regional/trade_partners?label=Imports` answers
  geography Partner, labels Exports/Imports/Balance, 30 values, Total imports
  282,355.8. Surfaced: Customs' partner table lists groupings (Belt and Road,
  RCEP, APEC, the EU, ASEAN) beside countries and they rank together; a
  grouping filter is a possible refinement.

- 2026-09-16 (dataset loop, round 5: NEA electricity demand): the site had
  generation from NBS and nothing on consumption. NEA's site is a Xinhua CMS
  whose listings render from a JSON datasource beside the page
  (`xwfb/ds_<id>.json`, every 新闻发布 item since 2020); the monthly
  全社会用电量 note is in it, and each release page carries its text in the
  body (two markups since 2024, same wording). `server/nea.ts` serves
  `electricity_demand` (亿千瓦时: month and year to date, total and by primary,
  secondary, tertiary industry and households) and `electricity_demand_growth`
  (the published rates). January-February and the annual release go to the
  year-to-date line only. Tests: four page shapes parse to the published
  figures (July 2026 10,400 and +1.7%; September 2024 8,475 and +8.5%;
  January-February 2026 16,546; 2025 103,682), the feed yields the demand
  notes newest first with absolute URLs and without the fuller statistics
  releases, and the adapter builds level and growth lines. Live:
  `/api/series/electricity_demand` answers July 2026 10,400 with year to date
  61,399 (source live until the next headline sweep stores it); growth 1.7 and
  4.7. A concordance pair holds the growth month line against its year-to-date
  line; the cumulative rule now takes a monthly pair's first period of the
  year as January, or February when the pair carries no January. Surfaced: no
  separate May 2026 demand note is in the feed (the "1-5月份全国电力工业统计数据"
  release may carry it); NEA is on no release calendar this site reads, so
  the series arrives with the daily sweeps.

- 2026-09-16 (dataset loop, round 6: PBOC aggregate financing): the site had
  money supply and new loans from a mirror and nothing on 社会融资规模. The
  bank's statistics section (调查统计 > 统计数据) answered a plain client from
  abroad, from this machine and from Railway, on 16 September; it links one
  index page per year and each carries the year's flow and stock tables as
  GBK htm attachments with English labels beside the Chinese. `server/pboc.ts`
  serves `tsf_flow` (the month's new financing by instrument, 亿元),
  `tsf_stock` (万亿元) and `tsf_stock_growth` (the growth the bank prints
  beside each stock). Tests: the statistics index yields fifteen yearly
  links newest first; a year's index names the flow and stock htm attachments
  and not the provincial table; the flow table parses to August 2026 total
  16,577 with government bonds 10,097 and April's RMB loans −4,006; the stock
  table to August 464.80 trillion and 7.2 percent, RMB loans 278.63 and 5.0;
  the adapter builds the three series from the year's pages. A first version
  read the flow table one column off (its English header carries no cell for
  the month column) and the test caught it. Live:
  `/api/series/tsf_stock` August 2026 464.8, growth 7.2, flow 16,577, all
  read live from the bank until the next sweep stores them. Not on any
  calendar the site reads: PBOC publishes around the 10th to the 15th; a
  `releaseDay` for the kind is queued with NEA's.

- 2026-09-16 (dataset loop, round 7: MOF fiscal data): public finance on the
  site was one quarterly tax figure from a mirror. The ministry's treasury
  department (gks.mof.gov.cn, http only; the CDN answers 502 from abroad now
  and then and 200 on retry) publishes 财政收支情况 monthly as text with every
  figure cumulative for the year. `server/mof.ts` walks the listing pages and
  serves `fiscal_revenue` (general public budget revenue, tax, non-tax,
  government fund revenue), `fiscal_expenditure`, `land_sale_revenue` and
  `fiscal_growth`, all titled year to date. Found on the way: stray spaces
  inside numbers on some pages ("4 .7%", "2 5 880"), so the text is read with
  whitespace removed; the full-year release says 比上年 where the months say
  同比. Tests: six, over two listing pages and five release shapes — July 2026
  revenue 143,696 with growth 5.8, land sales 11,731 and −30.8; the half year
  121,047 and 4.7 through the stray spaces; 2025 216,045 and −1.7. Live:
  `/api/series/fiscal_revenue` July 2026 143,696, tax 118,381,
  `/api/series/land_sale_revenue` 11,731, growth lines as published; read live
  from the ministry from Railway. A concordance pair holds the ministry's tax
  revenue against the mirror's quarterly copy (97,865 for the half year on
  both); it reads "missing" until the sweep stores the new key.

- 2026-09-16 (dataset loop, round 8: SAFE balance of payments): the site had
  no balance of payments. SAFE keeps one workbook of the whole BPM6 time
  series (1998 on) and replaces it with each quarter's final release; the
  English page links the current file. No xlsx library was in the tree and
  the loop adds no dependencies, so `server/xlsx.ts` reads a workbook itself:
  the zip's central directory, inflateRaw from node:zlib, shared strings and
  cells by address. `server/safe.ts` takes the standard items from the
  quarterly(USD) sheet; key `balance_of_payments`, 亿美元, BPM6 signs (a
  financial-account outflow and a rise in reserves are negative). Tests: the
  workbook of 26 June 2026 as the fixture (1.1 MB, the genuine file), the six
  sheets found, 113 quarters through 2026-Q1, current account 1,843.1 against
  SAFE's headline 184.3 billion USD, goods 2,474.77, reserve assets −479.41;
  the page link; a non-workbook refused. Live: `/api/series/balance_of_payments`
  Q1 2026 as above, read live from SAFE from Railway. The preliminary
  quarter (published two months after the quarter as a news release) is not
  in the workbook, so the series runs one quarter behind SAFE's first print;
  queued as a follow-up. No concordance pair: nothing else on the site
  measures it, and Customs' goods balance is on a different basis (said so
  beside the catalog entry).

- 2026-09-16 (dataset loop, round 9: MOFCOM foreign direct investment): the
  site's FDI series was the mirror's dollar figure, ended July 2023 when the
  ministry moved its headline to renminbi. Two paths found: the data centre
  (data.mofcom.gov.cn, a POST to /datamofcom/front/lywz/direct/query answers
  every month since 2008 — new foreign-invested enterprises for the year to
  date with growth, and the dollar amount until 2023-07), and the ministry's
  monthly news release "N年1-M月全国吸收外资X亿元人民币", reachable through the
  site's CMS list API (jpaas-publish-server, twenty items of HTML a page,
  parameters copied from the column page's unit tag; a headless Chrome could
  not load the listing page but the API answers a plain GET). `server/mofcom.ts`
  serves `fdi_actual_use` (亿元, year to date, with manufacturing, services and
  high-technology parts), `fdi_new_enterprises`, `fdi_growth` and
  `fdi_actual_use_usd` (ended 2023-07, flagged). Tests: five, over the data
  centre's answer (214 months, dollar amount 1,118 in 2023-07), a list page,
  two releases (July 2026 4,383.3, −6.2 percent, high-tech 1,823.1, +32.7)
  and the joined adapter. Live: `/api/series/fdi_actual_use` July 2026
  4,383.3; the enterprise count 37,711 on both paths, and a concordance pair
  holds them together. Not on any calendar: the ministry publishes around the
  20th; queued with the other `releaseDay` follow-ups.

- 2026-09-16 (dataset loop, round 10: Customs in CNY): the site read only
  Customs' USD tables, while the bureau quotes its growth rates in yuan. The
  listing now names each table's denomination ("(in USD)" / "(in CNY)"), the
  table lookup takes the one asked for, and the parsers refuse a table in the
  other denomination — the unit line reads "USD 1 Million" or "CNY 100
  Million", so the CNY series are in 亿元. Keys `trade_partners_cny`,
  `major_exports_cny`, `major_imports_cny`, off the home list, never mixed
  with the USD keys; no concordance pair, since the two denominations differ
  by the month's rate (said so beside the entries). Tests: four, over the
  August 2026 CNY tables — the US row 2,886.1 亿元 of exports against
  42,475.3 million USD (an implied 6.80 yuan per dollar), the listing's
  denominations, the lookup by denomination, a USD table refused for CNY and
  the reverse; the backfill test's listing entries gained the new field.
  Live: `/api/series/trade_partners_cny?region=united-states` August 2026
  exports 2,886.1, imports 903, balance 1,983.1; `major_exports_cny`
  agriculture 623.2. The CNY commodity tables carry values only, no
  quantities, so those keys have a Value line alone.

- 2026-09-16 (dataset loop, round 11: NBS international datasets): the
  portal's `queryIndexTreeAsync?code=N` answers three datasets beyond the ten
  the catalog held — 12 三大经济体月度数据 (the US, Japan and the euro area,
  monthly), 13 国际市场月度商品价格 (world commodity price indices, monthly),
  14 主要国家年度数据 (42 countries, annual); 11, 15 and 16 are empty. A
  geography "International" now runs from the sync scripts through the
  catalog types to the page copy ("by country"), and the countries carry
  English names through `shared/places.ts` (COUNTRY_PLACES, matched by name;
  the portal's region codes are "USA", "JPN", "EA"). Found on the way: the
  major-country tables group their countries by continent with no node for
  all of them, so the region sync's first-list-that-answers rule kept 亚洲
  (20) alone; for an international table it now unions the groups (42). One
  table, 国民经济核算, has no region catalog on the portal. 80 indicators
  merged: 79,836 entries over 13 datasets, 66,302 browsable. Tests: three
  over the shipped snapshot and lists. Live: `/api/catalog/stats` lists the
  three datasets; `/api/series/nbs_a4a3876e1dd14ce5be5ac685692dcad6?region=USA`
  (US CPI, year on year) July 2026 3.4; `/api/regional/nbs_992f74cbe36f40b8870ca114bb062004`
  (under-15 population share) lists 42 countries, none stored yet — the crawl
  fills them behind the request.

- 2026-09-16 (dataset loop, round 12: trade growth from Customs' own release):
  the exports and imports headline came from the mirror. The first idea,
  NBS's monthly table, would have made the headline two weeks stale: on 16
  September NBS's table still ended in July while Customs had published
  August on the 8th. Customs' English site carries, with each preliminary
  release, a totals table ("(1) China's Total Export & Import Values") with
  the month's value, the year to date and the bureau's own month-on-month,
  year-on-year and year-to-date rates; the Customs adapter reads it as a
  fourth table, `trade` serves the rates (first print, USD terms, release
  day) and `trade_values` the levels in 亿美元; the mirror stays as
  `trade_mirror` for the audit. Tests: two, over the August 2026 table
  (exports 4,014.4 and +25.0, imports +28.2, balance 1,190.9; the wrong
  denomination and the wrong table refused). Found on the way: the mirror
  carries Customs' later revision (July 2026 imports 27.5 first print, 27.6
  revised), so a first-print-against-revision pair at 0.05 would flag
  revisions rather than mislabels; the two trade pairs and the Customs-vs-NBS
  pair are at 0.25, the size of a revision, with the reason recorded. Live:
  `/api/series/trade` August 2026 exports +25.0, imports +28.2, total +26.3,
  year to date 19.3 and 27.0; `trade_values` exports 4,014.4; the
  Customs-vs-NBS pair ok at July 23.9 on both.

- 2026-09-16 (dataset loop, round 13: concordance pairs for the rest of the
  curated set): fifteen pairs covered eleven keys and thirty domestic-
  publisher keys had neither a pair nor a reason. Four gained pairs where the
  catalog crawl carries a second reading — manufacturing PMI (制造业采购经理
  指数), non-manufacturing PMI (非制造业商务活动指数), M1 growth, electricity
  output — and the rest are listed in `NO_PAIR` with the reason: the
  publisher's release is the only source on the site (PBOC's aggregate
  financing, the fiscal and FDI releases, SAFE's balance of payments,
  Customs' tables), the second reading is a different statistic (new yuan
  loans against TSF's RMB loans; the ministry's commodity index against
  NBS's world prices; FX reserves, which NBS carries annually in ten
  thousand dollars), or the levels are paired through their growth key. A
  coverage test holds every domestic-publisher key to a pair or a reason and
  checks each pair's labels against the catalog; `DATASET_LOOP.md` points at
  it. Live: 17 pairs, 0 findings — manufacturing PMI 49.8 on both for August
  2026, non-manufacturing 49.0, M1 4.0 for July, electricity output −0.1.

- 2026-09-16 (dataset loop, round 14: release days for the new publishers):
  series from NEA, PBOC, MOF and MOFCOM carried no release day, so their
  pages said only that they were not in the NBS calendar. The field now
  belongs to those kinds: electricity consumption by the 21st, aggregate
  financing by the 15th, the fiscal release by the 25th, the FDI release by
  the 22nd (each from the dates the releases carried through 2026); the
  catalog exposes them and the page names the day. Test: every such key
  holds its day and NBS series none. Live: `/api/catalog` shows 21 keys with
  a release day. Looked at for the missing May 2026 consumption: NEA's
  fuller 1-5月 release ("全国电力统计数据") carries capacity and utilisation
  as text but the consumption table as an image, so May stays absent — not
  derived from the year-to-date difference, by the loop's rule.

- 2026-09-16 (dataset loop, round 15: SAFE's preliminary quarter): the
  balance of payments ran a quarter behind SAFE's first print because the
  workbook holds final figures only. The preliminary release, two months
  after the quarter in the 外汇新闻 listing, carries a table with the same
  BPM6 codes in 亿元, 亿美元 and SDR; the adapter walks the listing for
  releases newer than the workbook and takes the seven items the release
  prints outright (the current account and its four parts, the capital
  account, reserve assets). Its financial account includes net errors and
  omissions and is left out; it prints no portfolio or other investment, so
  those lines end at the final quarter. A preliminary point gives way to the
  final when the workbook catches up, the store keeping the earlier value as
  a revision. Tests: two, on the Q1 and Q2 2026 releases and the listing —
  Q2 current account 1,951 leading the final Q1 1,843.1, and Q1's own
  preliminary 1,841 against that final. Deployed; the live page still serves
  the stored copy through Q1 until the 08:10 UTC headline sweep refreshes it
  (a stored quarterly series is not due), so the live Q2 point is confirmed
  in the next round. The machine killed the deploy poll for low memory (8 GB
  in use, none of it the loop's); verification ran by hand.

- 2026-09-16 (dataset loop, round 16: PBOC's own monetary tables): money
  supply and reserves reached the site through the mirror. The bank's
  statistics section carries them in yearly indexes beside 社会融资规模:
  货币供应量 (month-end M0, M1, M2 — levels only), 官方储备资产 (foreign
  currency reserves, gold, SDRs, IMF position, total; dollars and SDRs) and
  金融机构人民币信贷收支表 (deposits and loans outstanding), months across,
  GBK, English beside the Chinese. The adapter reads any table of the section
  by title and parses a months-across table generically; a year whose page
  cannot be read is skipped. Keys `money_stock`, `money_stock_growth`
  (computed from two years of levels to one decimal — 7.7 for July 2026, as
  the bank printed; 7.5 for August), `official_reserves` (which also answers
  the queue's "SAFE reserves template" item, from PBOC's copy of the same
  template) and `bank_credit`. Three pairs: the computed M2 rate against the
  published one, and the bank's FX and gold reserves against the mirror's.
  Tests: five, over the three tables, the 2025 money table and the indexes.
  Live: `/api/series/official_reserves` August 2026 FX 34,383.25, gold
  3,500.8, total 38,548.85; `money_stock_growth` M2 7.5, M1 4.1, M0 11.2;
  `bank_credit` total loans 2,823,513.09; 20 pairs, 0 findings, the three new
  ones "missing" until the next sweep stores the keys.

- 2026-09-16 (dataset loop, round 17: property activity): the Property
  group held prices and a climate index. NBS's monthly real-estate release
  is in the catalog under names the bureau changed (新建商品房销售面积,
  房地产投资_累计增长, 房地产新开工施工面积 — the first search for the old names
  found nothing), all cumulative for the year. Nine curated keys serve it,
  titled year to date: `property_investment` (total and residential growth)
  and `_value`, `property_sales` (floor space sold growth), `_area` and
  `property_sales_value` (a separate table, so a separate key),
  `property_construction` (starts, completions, under construction) and
  `_area`, `property_funds` (total and domestic loans) and `_value`. The
  unsold-stock table (商品房待售面积) is not in the monthly database. Four
  pairs hold the growth keys against the catalog crawl; a test resolves every
  id in the shipped snapshot to its named series from one table. Live:
  July 2026 investment −19.2 percent year to date (residential −19.1), floor
  space sold −11.8, starts −24.0, completions −23.2, funds raised −20.3,
  domestic loans −32.1; 24 pairs, 0 findings, the four new ones "missing"
  until the sweep stores the keys.

- 2026-09-16 (dataset loop, round 18: fixed-asset investment): the round
  began with the queue's next item, developer financing and mortgages from
  PBOC's quarterly 金融机构贷款投向统计报告, and could not find the report: the
  survey-and-statistics department's sections (统计数据, 数据解读, 工作信息,
  统计规章, 统计标准与制度, the questionnaire reports) and the bank's news
  listing carry no item by that name, and the listings do not paginate under
  index_N.html. Parked with that note; the round took investment instead.
  Three keys from the catalog's 固定资产投资 (不含农户) tables, cumulative for
  the year and titled so: `fai` (total, private, three sectors),
  `fai_by_industry` (manufacturing, mining, utilities, railways, roads, water
  and public facilities, real estate — the industries the bureau's
  infrastructure aggregate is built from; the aggregate itself is published
  only in the release) and `fai_funding` (funds in place by source). Three
  pairs against the catalog crawl; a test resolves every id to its named
  series from one table. Live: July 2026 investment −6.7 percent year to
  date, private −9.4, manufacturing −1.7, real estate industry −20.4, funds
  in place −10.6; 27 pairs, 0 findings. The trade headline was still served
  live at 08:10 UTC: the sweep that stores it had begun a minute earlier and
  walks Customs' archive first.

- 2026-09-16 (dataset loop, round 19: industry): industry on the site was
  output growth and PMI. Eight keys from the catalog's 工业 tables:
  `industrial_profits` (total, manufacturing, mining, utilities — cumulative
  for the year and titled so, from the by-industry table from 2018; the
  earlier tables are year slices) and `_value`, `capacity_utilisation` (the
  quarter's rate for industry and its three divisions, quarterly dataset),
  and month and year-to-date output growth of crude steel, cement,
  automobiles, new energy vehicles and integrated circuits — one key per
  product, each being its own table. Four pairs; an id test. Live: July 2026
  profits +17.6 percent year to date (manufacturing +18.8, mining +34.9),
  Q2 capacity utilisation 73.0, crude steel −3.6 on the month, automobiles
  −0.1, integrated circuits +20.7; 31 pairs, 0 findings. Found on the way:
  the trade headline's first store had failed — Customs' January-February
  totals table has no unit line where the other months do, and one month's
  parse error emptied the run. A month that will not parse is now skipped
  and named in the log (more than a third failing still fails the run); 31
  of 33 months stored locally, the combined months absent from the totals
  key. The live store picks it up at the next sweep.

- 2026-09-16 (dataset loop, round 20: prices beyond the headlines):
  `cpi_detail` serves NBS's 居民消费价格分类指数 as the change on a year earlier
  — core (excluding food and energy), food, tobacco and dining out, non-food,
  consumer goods, services, housing — and `ppi_detail` the headline beside
  producer goods and consumer goods; each index is published on the same
  month a year earlier = 100 and served with that offset. The CPI table is
  the bureau's 2026 slice (2021-2025 is a separate table; a follow-up could
  stitch them). Two pairs; an id test that also holds the offset. MOFCOM's
  weekly price indices are text reports on price.mofcom.gov.cn, not a data
  endpoint — a separate adapter, queued. Live, from the store after the
  sweep: August 2026 core CPI 1.0, food −0.7, non-food 1.2, PPI 3.8,
  producer goods 5.0, consumer goods −0.5; 33 pairs, 0 findings; the trade
  headline now stored (5.03 million observations).

- 2026-09-17 (translations): the home page's category tiles carried English
  only for the monthly dataset's headings; every top-level category now has
  one (66, hand-written). The category pages showed 15,031 of 79,836 titles
  with Chinese left in the English and 183 units untranslated, the
  translation credit having run out: 341 tokens for the commonest leftover
  runs, English for 70 units on server and client, and pinyin for whatever
  the dictionary still cannot render, held by a test over the whole shipped
  snapshot — no English title carries a Chinese character. The first deploy
  changed nothing on the live site: the labelled catalog is stored on the
  volume under a version that did not see a dictionary change; the gloss
  format is bumped and the catalog re-glosses at boot. Live: 艾滋病发病人数
  reads "HIV/AIDS cases", 日照港口码头长度 "Rizhao port quay length".

- 2026-09-17 (dataset loop, round 21: CPI 2021-2025 slice; MOFCOM weekly
  parked): MOFCOM's weekly indices are not on price.mofcom.gov.cn — its
  columns hold international commodity monitoring, trade news and daily
  briefs (the list endpoint is a POST of cid and pageNumber, recorded in the
  queue) — and the ministry's news list has no weekly market-price items
  this year; parked. An NBS-kind key can now carry earlier year slices of
  its table under other cids, merged behind the main table by label with
  the main table winning on overlap; `cpi_detail` runs from October 2024
  through the 2021-2025 table (December 2025 core CPI 1.2). A test holds
  the slice's ids to the same categories. Live: the stored copy through
  2026 stays until the next sweep refreshes it, when the slice fills in.

- 2026-09-17 (dataset loop, round 22: PMI sub-indices): the site carried
  the two PMI headlines from a mirror. `pmi_manufacturing` serves NBS's
  制造业采购经理指数 table whole (headline, production, new orders, new export
  orders, backlog, finished-goods and raw-material inventories, purchasing
  volume, imports, input and output prices, employment, supplier delivery
  times, expectations) and `pmi_nonmanufacturing` the 非制造业 table
  (business activity for services and construction and its components).
  Two pairs against the catalog crawl; an id test. Live: August 2026
  manufacturing PMI 49.8, production 50.4, new orders 50.6, input prices
  56.6; non-manufacturing 49.0, services 49.3, construction 46.9; 35
  pairs, 0 findings. The machine killed the deploy poll for low memory
  again (10 GB in use, none of it the loop's); verification ran by hand.

- 2026-09-17 (dataset loop, round 23: 70-city house prices from NBS's own
  table): the 70-city price series came from a mirror. `house_prices_nbs`
  reads NBS's 70个大中城市住宅销售价格指数 table for the cities its own region
  catalog lists — seventy-one, Lhasa beside the mirror's seventy (Lhasa
  gained an English name in the places list) — one request per city, the
  new- and existing-home indices on a year earlier = 100 served as the
  change. A concordance reference can now name a region; the audit holds
  Beijing against the mirror's Beijing row. The mirror stays as
  `house_prices`. Test: ids, city codes against the collected catalog, the
  pair. Live: Beijing July 2026 −2.3 (new) and −4.5 (existing) on both
  paths; the ranking page lists 71 cities; 36 pairs, 0 findings, the
  Beijing pair "missing" until the sweep stores the key. The table lags the
  mirror by a month (NBS posts it mid-month; the mirror already held
  August). The ranking page called the geography "Province"; an NBS key
  can now say its regions are cities.

- 2026-09-17 (dataset loop, round 24: SAFE bank FX settlement and sales):
  the site had no monthly read of foreign-exchange flow pressure.
  `bank_fx_settlement` serves SAFE's 银行结售汇 time-series workbook (replaced
  each month around the 15th): net settlement first, then settlement, sales,
  the customers' net, the current- and capital-account nets and net forward
  contracts signed, in 亿元; `bank_fx_settlement_usd` the dollar sheet;
  `bank_fx_settlement_annual` the annual table for complete years (its
  current-year column is January to the latest month under a plain year
  header, and is dropped). The month headers are Excel date serials that
  fall inside the month, so the parser maps each to its month and refuses a
  header that skips one. The release's headline (settlement and sales in
  yuan and dollars) is read from the text, and the test holds the workbook
  to it for August 2026. Concordance gains an annual-sum kind: each
  complete year's twelve months against the annual table, on net settlement
  and settlement. Live: August 2026 net settlement 3,290.15 亿元
  (settlement 17,090.42, sales 13,800.27; 484.8 亿美元), 2025 net
  13,913 亿元 after two deficit years; 38 pairs, 0 findings, the two FX pairs
  "missing" until the sweep stores the keys.

- 2026-09-17 (dataset loop, round 25: CFETS money-market rates): the
  interest-rate group had the bond curve and the policy rates but nothing
  from the money market. The CFETS adapter now reaches three tables on
  chinamoney.com.cn: SHIBOR (ShiborHis, eight tenors per trading day) and
  the repo fixing rates (FrrHis: FR and FDR at one, seven and fourteen
  days) beside the yield curve, each a POST per month like the curve.
  `shibor` and `repo_fixing` serve the month's last fixing, `shibor_average`
  and `repo_fixing_average` the mean of the month's daily fixings; the unit
  says which. The queue asked for DR007; the weighted averages themselves
  are on no endpoint the site reaches (five candidates 404), so FDR007, the
  fixing set from those trades, is served first and named as a fixing.
  Test: August 2026's responses carry every tenor for all 21 trading days,
  the month end is the 31 August fixing, the average lies inside the
  month's range, FR007 never sits below FDR007; the adapter's endpoint and
  measure dispatch through an injected poster. The gate chain once stopped
  at `grep -c` returning 1 for zero matches, so the deploy ran before the
  commit; the commit followed on the same tree. Live: September 2026 so far
  overnight SHIBOR 1.46, one-week 1.45, three-month 1.43; FDR007 1.43,
  monthly average 1.3958; 120 months back to October 2016 (FDR from 2017);
  38 pairs, 0 findings, the two FX pairs from round 24 now "ok".

- 2026-09-17 (dataset loop, round 26: yuan central parity and the CFETS RMB
  index): the exchange-rate group had the Fed's monthly average and the
  BIS's real effective rate, nothing from the yuan's own publisher. The
  CFETS adapter reaches two more tables: the central parity (CcprHisNew,
  one row per trading day with a value per requested currency pair; the
  endpoint answers only the pairs asked for, so the configured tenors go in
  the request) and the CFETS RMB index (RmbIdxHis, found through the page's
  history fragment after six guessed paths 404'd; weekly on Fridays and on
  the month's last trading day, with the BIS- and SDR-basket versions).
  `central_parity` serves the month's last fixing for USD, EUR, 100 JPY,
  HKD and GBP, `central_parity_average` the month's mean for USD and EUR,
  `cfets_rmb_index` the month's last reading of the three baskets. The
  audit pairs the parity's monthly average with the Fed's monthly average
  of the spot (fx_usdcny) at tolerance 0.15, the note recording that the
  spot trades within 2 percent of the fixing: August 2026's two were 0.05
  apart (parity 6.786, Fed 6.7361), so the queue's "within 0.05" reads as
  the band, not a tighter bound. Test: all five pairs on 21 trading days,
  the 31 August fixing 6.7828, the average inside the band, the index's 15
  readings (twelve Fridays, two month ends, a holiday shift), the request
  body. Live: September 2026 so far USD/CNY 6.758 (average 6.7745), EUR
  7.735, CFETS index 101.49, BIS 108.61, SDR 96.5; 120 months each; the
  first fetch of a parity key takes four minutes (the endpoint answers in
  two seconds a month); 39 pairs, 0 findings, the parity pair "missing"
  until the sweep stores the key.

- 2026-09-17 (dataset loop, round 27: labour): the Labor group held only
  the surveyed unemployment rate. MOHRSS's portal, probed from abroad,
  answers every request with an obfuscated script that sets a bot cookie
  before serving a page; the site does not work around such challenges, so
  urban new jobs (城镇新增就业) is parked with that reason. NBS's own
  quarterly table 外出务工情况 carries the migrant-worker survey, and two keys
  serve it: `migrant_workers` (rural labour away from home at the quarter's
  end, 万人) and `migrant_workers_income` (their average monthly income,
  yuan). The table has no fourth quarter (the annual survey covers the
  year), which the notes say; the reading note warns that the count is a
  stock that dips every first quarter around the Lunar New Year, so the
  comparison is with a year earlier. Reasons in NO_PAIR: the quarterly
  survey is the only source, and the annual 农民工 figures are a different
  sample and a year-end concept. Test: both ids resolve in the shipped
  snapshot to the named series in the quarterly dataset's 人民生活 category,
  one table for both. Live: Q2 2026 19,227 万 away from home (Q1 18,838),
  income 5,118 yuan; 39 pairs, 0 findings. Between rounds today: the Home
  page took units on levels, year-on-year changes for levels, publisher
  copy derived from the catalog, and placed titles ("Guangdong Real GDP
  Growth"); the ingest now takes never-stored keys first and refreshes
  CFETS series forward from the last stored month.

- 2026-09-17 (NBS's own English titles): the site had a slot for the bureau's
  official English labels, an import script and an "NBS English" tag, but
  the crosswalk file was empty because the legacy English portal it was
  written for now answers 403. The current portal's English mode (the
  "English" link in its header, route #/pc/national/en/) uses the same
  metadata endpoints under publicrelease/en/web/external and answers the
  same indicator ids with NBS's English titles. `scripts/sync-nbs-english.ts`
  reads every table that way, one request a second, resumable: 79,609
  titles for 3,396 of 3,401 tables (five tables timed out), each pinned to
  the current key and the exact Chinese title so a rename fails safe to the
  generated gloss. Shipped gzipped (3.6 MB). The generated gloss is kept
  beside an official title and indexed for search, so "maize", "eggs" and
  "household articles" still reach series NBS titles as "Corn", "Eggs" and
  "Articles and Services for Daily Use"; only the official title is shown.
  The exact-title rule ignores the unit NBS appends ("Birth Rate(‰)"); the
  full-text candidate list widened to five thousand. Five search tests
  pinned to the gloss's wording were retargeted to the guarantee each
  protects. Live: the coverage card counts the official titles; result
  cards and pages tag them "NBS English".

- 2026-09-18 (Home: the labour market and the population): the owner asked
  why the Labor group held only the unemployment tile and the migrant-worker
  count when youth unemployment and participation are what a reader looks
  for. What NBS publishes: the monthly labour force survey table (headline,
  16-24 excluding students, 25-29, 30-59, 31 major cities, local and
  non-local hukou, and enterprise employees' average weekly hours); no
  participation rate at any frequency; annual year-end employed persons
  (total, urban, rural); annual wages by unit type. A Home row can now name
  one line of a table, so the survey's youth and 31-city lines are rows
  beside the hero tile; `working_hours` and `employment` are new keys; the
  survey key gains the hukou lines. A Demographics group joins: year-end
  population (`population_nbs`), birth and natural growth rates
  (`population_rates`, per-thousand handled as a rate with points for its
  change), and the population aged 65 and over (`population_age`), all from
  NBS's annual tables; the World Bank series on the site are UN estimates on
  another basis and stay off Home, with the reasons in NO_PAIR. Wages
  (城镇非私营单位就业人员平均工资) were not found as a national total in the
  annual snapshot's wage tables and wait. Tests hold every new id to the
  named series, dataset and category. Live: youth unemployment 18.9% (Aug
  2026, +1.0 pp); the annual rows fill as the boot ingest stores them.

- 2026-09-18 (dataset loop, round 28: household income and spending): the
  Consumption group had retail sales alone. NBS's quarterly household
  survey publishes per-capita disposable income and consumption spending
  as year-to-date levels and nominal growth, in three tables (all
  residents, urban, rural). An NBS line can now name the table it comes
  from, so one key draws the three tables with one request each and the
  fetcher pools the periods; four keys serve growth and levels for income
  and spending, the growth rows on Home under retail sales. Real growth
  (实际增长) is not in the quarterly database and is not derived. Reasons in
  NO_PAIR: the survey is the only source and the annual figure is its
  fourth-quarter reading. Test: twelve lines resolve to the named series
  in the quarterly dataset from the tables they name. Live: H1 2026
  disposable income +4.2% nominal (urban +3.4, rural +5.5), 14,836 yuan
  spent per person (urban 18,071, rural 10,180), spending +2.7%; 39 pairs,
  0 findings.

- 2026-09-19 (dataset loop, round 29: local government bonds; CAAM parked):
  CAAM's auto releases are images and its listing stops at May 2026, so the
  item is parked with CPCA as the remaining candidate. The bond release
  moved: the budget department's page (yss.mof.gov.cn) stops at September
  2025 and the Debt Management Department (zwgls.mof.gov.cn/tjsj/) publishes
  2026, found through a web search after the ministry's own search and most
  of its hosts answered 502 for an hour. The MOF adapter reads that listing
  as a second table: `lgb_issuance` (the month's issuance, total, general
  and special, new and refinancing), `lgb_debt` (debt outstanding at the
  month's end, total, general and special) and `lgb_rate` (the month's
  average issuance rate). The release states the month first and the year
  to date after it in the same words, so the first match of each sentence
  is the month's; the 2026 wording of the total ("合计" trailing) differs
  from 2025's (leading), and both are accepted; digits split by markup are
  joined first. Publication lags about six weeks, so the queue's "August
  2026" test became July 2026, the latest release. Tests: both years'
  releases to the ministry's figures, the listing as published, the adapter
  end to end. Reasons in NO_PAIR: the release is the only aggregate. Live:
  July 2026 issuance 7,383 亿元 (general 1,345, special 6,038; new 4,041,
  refinancing 3,342), debt outstanding 592,411 亿元 (+12.3% on a year
  earlier), 18 months stored; the rate key's first read hit a 502 and waits
  for the daily refresh; 39 pairs, 0 findings.

- 2026-09-20 (dataset loop, round 30: services production; queue refilled):
  the NEA follow-up was not runnable (May 2026 is still an image and the
  August note is due about the 21st), and every other item was parked,
  blocked or waiting on credit, so the queue was refilled from the
  cohesive-picture list: services production, tax revenue by type, SAFE
  cross-border receipts and payments, PBOC's quarterly surveys, port
  throughput, nominal GDP by industry (the quarterly database holds levels
  only; the real growth rates live in the release), a PMI employment row,
  CPCA auto sales, then the watch, credit-gated, parked and blocked items.
  The English-gloss item is retired, titles being NBS's own now. Built the
  top item: `services_production` from NBS's monthly 服务业生产指数 table,
  the month's growth and the year to date, with a cumulative pair between
  them as GDP has, and a Growth row under industrial production. Test: both
  ids resolve to the named series of the one table; the pair holds at a
  year's first period and rejects a year-to-date line under a month label.
  Live: August 2026 +4.1% (year to date +4.7%), 24 months; 40 pairs, 0
  findings, the new pair ok on its first audit.

- 2026-09-20 (dataset loop, round 31: tax revenue by type): the monthly
  财政收支情况 release lists the main taxes under the budget aggregates the
  site already read. Twelve are now MOF items — domestic VAT, corporate and
  personal income tax, consumption tax, import VAT and consumption tax,
  tariffs, export rebates, stamp duty and the securities stamp duty within
  it, land appreciation tax, deed tax, vehicle purchase tax — served by
  `tax_by_type` (亿元, year to date) and `tax_by_type_growth`, both off the
  Home list where total tax revenue already sits. February 2026 writes
  export rebates in full (出口货物退增值税、消费税) and states the securities
  stamp duty's rise as a multiple (1.1倍) rather than a percentage: both
  phrasings are handled and a growth given as a multiple has no point that
  month. Tests parse July 2026, February 2026 and the 2025 annual release
  to the ministry's figures. Live: July 2026 domestic VAT +6.1%, corporate
  income tax +7.2%, personal income tax +14.9%; the levels key's first read
  hit one of the ministry's 502s and waits for the daily refresh.

- 2026-09-20 (repository split): the explorer moved out of
  joshfwaldman1/datatool into joshfwaldman1/china-data-explorer with
  `git subtree split`, so its 532 commits are its history and the paths lose
  their china-explorer/ prefix. The dependency list fell from 21 packages to
  10 (nothing here imported Tailwind, Radix, the MCP SDK, Upstash, zod or
  the markdown stack). New: CI on every push and pull request running the
  type check and the whole suite, which is the change that makes a second
  contributor safe; the render test takes its browser from
  PLAYWRIGHT_CHANNEL so CI uses bundled Chromium. Two things had to be
  fixed for the first deploy from the new repository to succeed: tests were
  leaving a 350 MB catalog cache in the working directory, which made the
  upload fail (they now default their store and cache to a scratch
  directory), and the Railway service had Dockerfile.china baked into its
  build settings, which was patched to Dockerfile through the platform's
  API.

- 2026-09-20 (dataset loop, round 32: cross-border receipts and payments):
  SAFE publishes 银行代客涉外收付款 as an Excel 97 workbook — an OLE2
  compound document, not a zip — so `xlsx.ts` could not open it and the
  English site has no .xlsx equivalent. `server/xls.ts` now reads that
  format with no dependency: the sector table and directory of the
  container, then the BIFF records that carry values (shared strings across
  their CONTINUE records, NUMBER, RK, MULRK, cached formula results,
  LABEL), returning the same shape `xlsx.ts` returns, so one sheet parser
  serves both formats. Three keys on it: `cross_border_flows` (yuan,
  monthly), `_usd` and `_annual`, each with the net, receipts, payments and
  the net split by current account, goods, services and the capital and
  financial account. It is wider than FX settlement, which counts only the
  currency actually exchanged, so both belong on the page; the net is a
  Home row. Two annual-sum pairs. The monthly release states the
  cross-border figures beside the settlement ones, so the headline reader
  takes them too and the test holds the workbook to the release. Live:
  August 2026 receipts 52,718 亿元, payments 48,486, net 4,232, goods
  +7,987 against services −658; 42 pairs, 0 findings.

- 2026-09-20 (dataset loop, round 33: port throughput; PBOC surveys parked):
  the bank's quarterly surveys (城镇储户, 企业家, 银行家问卷调查) stop at the
  fourth quarter of 2025, posted on 23 January 2026, and each report is a
  PDF behind an HTML wrapper with no figures in the page, so the item is
  parked with that reason. The next item asked for port throughput from the
  transport ministry, whose statistics paths answer 404; NBS publishes the
  same figures in its own monthly table, which is the better source anyway.
  `port_throughput` serves the month's tonnage for all ports, the
  foreign-trade cargo inside it and the coastal ports' share, with the
  bureau's 2005-2018 table stitched behind the one it began in 2019;
  `port_throughput_growth` serves the rates printed beside them.
  The audit then produced its first finding in weeks, and it was ours: a
  cumulative pair requires the two lines to agree in the year's first
  published period, which holds for the activity series because February
  carries the combined January-February figure. This table prints February
  alone and no January — 128,166 万吨 for February against 286,789 for the
  two months — so the month grew 3.3 percent where the year to date grew
  7.2, and both are right. A cumulative pair can now say
  `firstPeriodAgrees: false`, with the levels in its note; the half of the
  check that caught the GDP bug still applies and the test holds it to that.
  Live: July 2026 148,541 万吨 across all ports, down 2.9 percent on a year
  earlier while the year to date is up 1.3; 43 pairs, 0 findings.

- 2026-09-20 (dataset loop, round 34: nominal GDP): the site carried GDP
  only as a real growth rate, which is the wrong thing for every ratio a
  reader wants — debt to GDP, a sector's share, output per unit of
  anything. NBS's quarterly 国内生产总值 (现价) table holds the levels, and
  three keys now serve them: `gdp_nominal` (the quarter, for the economy
  and its three sectors), `gdp_nominal_ytd` (the same cumulative) and
  `gdp_by_industry` (the quarter's value added for twelve industries, with
  manufacturing and industry inside the secondary sector and real estate,
  finance, wholesale and retail, construction, information technology,
  transport, agriculture, leasing and business services, accommodation and
  catering and the rest making up the tertiary). The table carries no
  growth rates; the bureau publishes those as a separate index, which the
  existing `gdp` key already serves. A cumulative pair holds the quarter
  against the year to date — on levels rather than rates, which the note
  says, since the arithmetic is the same and the year to date at the first
  quarter is that quarter. Test: every id resolves to the named series of
  that one table, the industry lines are all 当季值, and the pair still
  catches a year-to-date line wearing a quarter's label. Live: Q2 2026 GDP
  361,511 亿元 in the quarter and 695,704 for the half year, real estate
  21,038 (about six percent of output), manufacturing 95,370; 44 pairs, 0
  findings.

- 2026-09-20 (dataset loop, round 35: PMI employment on Home): both
  purchasing managers' surveys carry an employment index, collected in
  round 22 and unread ever since inside tables that sit under Sentiment.
  They belong beside unemployment and hours worked, so a Home row can now
  lift one line of a table into another group: the row carries the group it
  is shown in, the client groups by that rather than by the key's own
  group, and a row in a foreign group without a named line fails the test
  as a misfiled key. Live: August 2026 manufacturing employment 48.7 and
  non-manufacturing 45.4, both below the 50 that separates hiring from
  shedding, under youth unemployment at 18.9 percent; 44 pairs, 0 findings.

- 2026-09-20 (dataset loop, round 36: retail by commodity; CPCA parked):
  the queue asked for auto sales from the passenger car association, whose
  sites answer 403 and redirect to a firewall block page for requests from
  outside China; CAAM was already parked for publishing its releases as
  images. NBS carries the commodity detail of retail sales itself, and
  motor vehicles are the largest category in it, so that is what the site
  carries in place of unit sales. `retail_by_category` serves the month's
  value for twelve categories and `retail_by_category_growth` the rates
  beside them. Each category is a separate table on the portal, so every
  line names its own table through the per-line cid added in round 28; a
  fetch is eleven requests and takes about sixteen seconds. The motor
  vehicle rate is lifted onto Home under retail sales, using round 35's
  mechanism. These are above-scale units, firms over a revenue threshold,
  which the notes say rather than implying the figures are all of retail.
  Live: August 2026 motor vehicles down 18.5 percent on a year earlier (the
  2025 trade-in subsidy is the base), oil products down 7, appliances up
  2.3, food up 4; 44 pairs, 0 findings. The queue also gained an item from
  the week's design discussion: units are free text and the client infers
  meaning from them with regular expressions, which is what printed a
  per-thousand birth rate as a percentage.

- 2026-09-20 (dataset loop, round 37: structured unit metadata): every
  series carried one unit sentence written for a reader, and the page
  decided how to print a value by running regular expressions over it at
  render time. That is how the birth rate came to show a percent sign: the
  rule for "%" caught "‰" too, and nothing recorded what the series was.
  `shared/measure.ts` now derives the fields once — kind (level, rate or
  index), the suffix shown after a value, the decimals it is quoted to, how
  a change reads (percentage points, points, or its own units), and whether
  it accumulates through the year. `catalogList` ships a measure with every
  entry, the Home rows and hero tiles format from it, and `fmt`,
  `deltaText` and `isRate` take either a measure or a unit string so the
  series pages keep working unchanged. A series may declare a field the
  sentence would get wrong; the override list holds three entries (the loan
  prime rate and the bond issuance rate, quoted to two decimals behind a
  unit that says only "Percent", and the count of new foreign-invested
  enterprises, which has no unit worth printing). A growing list would mean
  the derivation is wrong. Writing the coverage test found three
  derivations already wrong and unnoticed: "Trillions of current US
  dollars" and "Births per woman" were printed in full beside a value, and
  "Current US dollars" kept its price basis; they now read "tn USD",
  "births" and "USD". Live: the hero tiles and every row format correctly,
  the loan prime rate reads 3.00%, the birth rate 5.63‰ changing in points;
  305 tests, 44 pairs, 0 findings.

- 2026-09-20 (dataset loop, round 38: a wrong figure on the live site): the
  NEA item was a watch, and the watch paid: the bureau published August's
  note this morning and the site stored 71,730 亿千瓦时 as the month's
  electricity consumption, where a month is about 10,000. Two things in the
  release defeated the parser. It writes its range as "1—8月" with an em
  dash, and the range pattern accepted only a hyphen or a tilde, so the
  year-to-date sentence was read as the month. It also introduces a
  phrasing the total pattern missed, "全社会用电量再破万亿，达到10332亿千瓦时",
  where a clause sits between the subject and its figure, so the month's own
  sentence was skipped rather than overwriting the wrong value. The range now
  takes every dash a publisher uses, the total takes a short clause, and a
  release whose month equals its year to date is refused outright.
  The audit had not caught it, because the electricity pair compares the
  growth rates and those were read from the right sentences. A second pair
  compares the levels — and reported "ok" on first deploy, which showed its
  limit: the cumulative rules fire only when every period matches, the shape
  of a series mislabelled from the start, not of one month read off the
  wrong sentence. A cumulative pair on levels can now say `periodWithin`:
  a period's figure is part of its year to date, so after the year's first
  period it must be strictly smaller, and a period read off the year-to-date
  sentence lands on exactly that figure. Rates cannot use this, since a
  month can grow faster than the year has. Both level pairs (electricity and
  nominal GDP) declare it, and the test runs the figures the site actually
  served. The store is append-only, so the wrong value stays as the vintage
  it was and the correction arrives as a revision on the running refresh.
  308 tests; 45 pairs.

- 2026-09-21 (dataset loop, round 39: the provinces get more than one
  number): the site has carried provincial real GDP since the regional work,
  and a province was otherwise a name on a ranking page. It now also carries
  the monthly ones NBS publishes for all 31: `provincial_industry`, the
  value added of large industrial firms, as the month and the year to date,
  and `provincial_cpi`, the consumer price index on a year earlier. Six
  provinces sit on Home beside Guangdong, chosen for size rather than for
  a story: Jiangsu, Shandong, Zhejiang, Sichuan and Henan.
  Two things in the data shaped the code. The CPI table NBS serves is an
  index on the year before, so it is stored with `valueOffset: -100` and
  reads as a rate; its older years live in two further tables, stitched on
  behind through `slices`, which is the same mechanism the CPI-by-category
  work needed. And the audit now has its first pair that names a region on
  both sides: Guangdong's month against Guangdong's year to date, so a
  province is checked rather than assumed to follow the nation.
  Provincial retail sales were the obvious third series and are not here:
  NBS publishes the monthly table only as a slice that stops in 2011, so
  there is nothing current to serve. It is recorded in the queue rather
  than left to be rediscovered.
  A group can now hold more than one ranked row, so a ranking link says what
  it ranks ("All 31 provinces: Industrial Output Growth") instead of the one
  generic label both rows shared. Live: Guangdong August industrial output
  +6.9% (year to date +6.1%), CPI +1.0%; Jiangsu 5.7, Shandong 7.2,
  Zhejiang 6.2, Sichuan 7.6, Henan 7.2. 312 tests; 46 pairs, 0 findings.
- 2026-09-20 (reliability hardening): failed NBS release batches now spend
  their request budget, and full-history revision checks have a separate
  transactional clock per series and region. Recent-window refreshes cannot
  postpone historical audits. Existing series retain an unknown full-check
  timestamp with first deadlines spread over 1–45 days, preserved on restart.
  Readiness now requires a usable catalog and responding store; failed or
  empty catalog warmup stays unavailable, with `/live` separate from `/ready`
  and `/health`. Backups move SQLite copying and verification to a bounded
  child process, authenticate with constant-time comparison, permit one copy
  or download, and clean up cancelled downloads. The nightly workflow fails
  without credentials and uploads only after checksum, integrity and an
  independent restore pass. The artifact includes its manifest and checksum;
  OPERATIONS.md documents recovery and the remaining queue/provenance work.
  A pre-change production snapshot was independently restored and checked;
  a migration rehearsal preserved all 6,744,485 observations across two
  restarts and initialized 193,419 audit deadlines without rewriting history.
  Typecheck and the full 341-test suite pass, including offline browser and
  authenticated HTTP backup tests.

- 2026-09-21 (dataset loop, round 40: where the power comes from): the site
  carried the energy administration's electricity consumption and one
  generation growth rate, and said nothing about what the power was made
  from or how much fuel the country produced. Five keys from the bureau's
  own monthly tables answer that: generation by source as levels and as
  rates (thermal, hydro, nuclear, wind, solar, and the total), coal and
  crude oil output by weight, natural gas by volume, and the three fuels'
  growth. Two Home rows, raw coal output and solar generation, which is the
  pair that shows the transition without a chart.
  Each generating source is its own NBS table, and that is the failure this
  round had to guard against: a line taken from the wrong table gives a
  plausible series that does not belong to the total, and no pair of two
  series would notice. The audit gains a third kind of pair. `components`
  sums the parts and compares them with the published whole in every month
  both are published, so the five sources are held to 发电量 each month.
  The acceptance test runs it on the bureau's captured answer for January
  2025 to August 2026 — where the five sum to 9,437.7 against a published
  9,437.8, the cost of rounding five figures to a tenth — and then runs it
  again with thermal at a tenth of its size, which must be a finding.
  What the bureau does not publish is recorded as well. There is no January
  figure for a monthly production series and no February month figure; the
  year to date at February covers the two. No line carries a
  January-February fallback, because a two-month total served as February
  would be wrong by a month, and a test holds that. Two coverage tests
  caught mistakes while this was written: a key given both a pair and a
  reason not to have one, and a level whose unit sentence shortened to
  "100M cubic metres", too long to sit beside a value and now declared as
  "100M m³". Live: August 2026 generation 9,437.8 亿千瓦时, thermal 6,020.3,
  solar 700.2 (up 10.3 percent), raw coal 36,182.3 万吨, crude oil 1,843.3,
  natural gas 214.2 亿立方米. 348 tests; 50 pairs, 0 findings.

- 2026-09-21 (dataset loop, round 41: which industries): the site said how
  fast industry grew and nothing about which industries were growing. Three
  keys now carry that: all 41 two-digit industries of the national
  classification as the month's rate and as the year to date, and the three
  divisions the bureau's release leads with (mining, manufacturing, the
  utilities). The labels are the bureau's own English with its boilerplate
  removed — it writes each as "Value-added of X, Growth Rate (The same
  period last year=100)" — and all 41 had an official name already in the
  English crawl, so none needed translating. They run in the
  classification's order, coal mining first and water supply last, rather
  than the order the bureau's index happens to list them in.
  The test is the release itself. NBS names sixteen industries in the prose
  of each monthly release, and the prose and the table are the same bureau's
  figures, so a difference between them is this site's mistake: a line
  pointed at the wrong industry, a rate read off the cumulative column, a
  sign dropped from a fall. The test reads the sixteen out of the release of
  15 September 2026 and holds the table to every one. Two details of the
  bureau's wording had to be read correctly: a fall is written 下降 and must
  come back negative, and an industry that did not move is written 同比持平,
  a zero the bureau stated rather than a figure it omitted. The release also
  states that there are 41 大类行业, which is the check that none was
  dropped from the list.
  Two cumulative pairs join the audit, motor vehicles and manufacturing
  against their own year to date. Neither declares `periodWithin`: these are
  rates, and a month can grow faster than the year has, which is exactly the
  distinction round 38 had to draw. Live: August 2026 mining −1.4%,
  manufacturing +6.1%, utilities +4.9%; motor vehicles +8.7%, computers and
  communications equipment +17.2%, coal mining −5.6%. 354 tests; 52 pairs,
  0 findings.

- 2026-09-21 (dataset loop, round 42: how these figures are made): a reader
  who sees a figure here can ask three things — who counted it, what exactly
  was counted, and what this site did to it on the way. The chart page
  answered the middle one wherever the bureau had written an explanatory
  note. The other two lived in the code and in this log.
  `server/methodology.ts` puts them on a page, at `/api/methodology` and
  `#/methodology`. A section per path the data takes states the publisher,
  what is read, how it is read, what the publisher revises and what a reader
  should know before quoting it: the bureau's own portal, Customs' release,
  the central bank's tables, the finance and commerce ministries' releases,
  the exchange administration's workbooks, the energy administration's
  prose note, the trading system's fixings, the mirror, FRED, and the
  AkShare bridge the deployment does not have. Beside them sits what this
  site does with a figure, which no publisher can state for us: an
  append-only store where a revision is visible as a revision, the
  pair-by-pair audit, attribution to the agency that compiled a number
  rather than the mirror that carried it, and a rule against deriving what
  was not published.
  The per-key half is generated, not written: each series' entry reads its
  agency and unit from the catalog and its check from the audit, so a
  cumulative series says so, a stopped one says when, a mirrored one says it
  was mirrored, and "how it is checked" is the pair's own name or the
  recorded reason there is none. A series added without a path or without a
  check fails the test rather than shipping an empty section.
  Writing that test found three series with neither a pair nor a reason:
  government bond yields and the two Caixin surveys. The coverage test had
  been excusing them, because the regular expression listing foreign
  institutions matched on "Caixin" and "China Foreign Exchange" — both
  domestic publishers. The list is now what it was meant to be and the three
  carry reasons. The Caixin one is the interesting one: it is a different
  panel from the bureau's survey, smaller and more export-oriented, so the
  two are not readings of one statistic and a gap between them is
  information rather than an error.
  The IMF's Data Quality Assessment pages, which the queue named as the
  source, are served by a client-rendered application; the page returns only
  navigation and no data endpoint behind it answered. That is recorded in
  the queue rather than left for the next round to rediscover. 360 tests;
  52 pairs, 0 findings.

- 2026-09-21 (dataset loop, round 43: when each figure arrived): the store
  has known this since the first round and never said it. Nothing is
  overwritten, so the first vintage of a period is the moment the site first
  saw that figure and every later vintage is a restatement it saw
  afterwards. What was missing was a name for it. A reader could not ask
  when August's industrial output appeared, or whether the number on the
  chart is the one first published.
  `server/arrivals.ts` reads it, and the distinction it draws is the whole
  point of the round. A figure seen days after its period closed arrived
  with the publisher's release. A figure seen years later came out of an
  archive during a backfill, and calling that a publication date would
  attribute to the publisher a date it never set. The window between them is
  per frequency — 75 days for a month, 150 for a quarter, 400 for a year —
  and a point outside it is reported as a backfill in plain words rather
  than given a date the site cannot support. Nothing may arrive more than
  three days before its period ends, with the allowance that the purchasing
  managers' index is published on the last day of the month it describes.
  Releases are stored now rather than only proxied. The bureau's calendar is
  already fetched for the release page, so each item is recorded as it
  passes and stays nameable long after the cache has expired and the window
  has moved on; recording the same release twice updates the row rather than
  adding a second. An arrival inside the window that matches a recorded
  release carries its title and link, and one with no match still says when
  the figure appeared and says only that.
  The test writes a store whose three periods are each of the cases — a
  month backfilled two years late, a month that arrived with its release,
  and a month restated a month after it first appeared — and holds every
  stored point to resolving as one or the other, with the backfilled one
  held to naming no date at all. New: `/api/arrivals/:key`,
  `/api/release-log`, and a line on every series page saying how its newest
  period got here. 366 tests; 52 pairs, 0 findings.
  Verifying that deploy found two faults in it, both fixed the same round.
  GDP's second quarter was reported as having arrived "with the release
  'Fixed-asset investment (excluding rural households), monthly'", because
  the matcher accepted any release from the same agency within three days
  when the calendar had named no keys for it — a false statement about
  which publication carried a number, and precisely the error the round
  exists to avoid. A release that names nothing now matches nothing. And a
  table of 41 industries answered "when did August appear" 41 times, once
  per line; without a label the lines now fold into one row per period, the
  earliest sighting across them, so a line added later cannot redate the
  table. 368 tests.

- 2026-09-21 (dataset loop, round 44: what drove the growth): the site said
  the economy grew 5.2 percent and nothing about what grew it. NBS divides
  GDP growth between three expenditure categories — what households and
  government consumed, what was invested, and what was sold abroad net of
  what was bought — and publishes each as a share of the growth, for the
  quarter and cumulatively. Both tables are carried now as
  `gdp_contributions` and `gdp_contributions_ytd`, with a Home row for
  consumption's share.
  Because the three divide the growth between them they are three parts of
  one hundred percent, and that identity is the round's check. It is an
  identity of the national accounts rather than a series the bureau
  publishes, so a components pair can now be given a constant whole instead
  of a published total; the audit holds both tables to it every quarter. It
  is also the only check that would catch what is easiest to get wrong
  here: a line pointed at the wrong table, or the cumulative column read
  under the quarter's label.
  The test runs the identity across six years of the bureau's own answer,
  then swaps capital formation for its cumulative twin and requires a
  finding. The wrong version still sums to a hundred in every first
  quarter, because a year's first quarter is its own year to date, and the
  test says so rather than letting that pass unnoticed: the finding has to
  come from the other three quarters.
  Recorded for the next reader: a contribution is a share of growth, not a
  share of output. Net exports contributed 20.8 percent of the second
  quarter's growth while being a far smaller part of GDP.
  Also recorded, because it cost time: the backup test that fails
  intermittently does so only when two full suites run at once. Five
  consecutive single runs were clean. It is contention, not a defect.
  374 tests; 54 pairs, 0 findings.

- 2026-09-22 (owner-directed, not a loop round: bugs, structure, and two
  outages): a day of fixing things rather than adding series, and the day
  the site went down twice, both times by my hand.
  What shipped. The Home payload carried every line of every table on the
  page — 250 lines to draw 59 sparklines — and yesterday's six-year window
  had tripled it to 538 KB; it now carries only the lines a row names,
  173 KB, smaller than before the window grew. A stale Home row says why
  it is stale: "not refreshed here (needs AkShare)" against a blocked
  series, "nothing newer published" against a publisher that has gone
  quiet. The Customs parser reads the tables Customs wrote before 2023,
  which say "Value Unit:" where the newer ones say "Unit:"; it had refused
  22 of the 55 months the backfill reaches, on every run, for weeks, while
  the page looked fine because the months it could read were recent. And
  the test suite's cleanup never ran — `process.on("exit")` does not fire
  under Bun's test runner, checked directly — so every run since it was
  written leaked 700 MB; it filled the disk twice today. Cleanup is now
  `afterAll`, with a startup sweep for anything a killed run left behind.
  The Customs bug is why there is now a Data Health page (`#/health`). The
  check that would have caught it had been running and reporting the whole
  time, into a fetch log nobody reads. The page puts the three kinds of
  wrong where a reader sees them: cross-checks that disagree, sources that
  will not parse, series that have not advanced — the last split by whether
  the publisher went quiet or this deployment cannot reach them. It reads
  the store and never fetches. On its first live run it surfaced a latent
  bug already fixed that morning (the by-country parser had matched
  "United States" as a unit line, since both start with "Unit") and a real
  one not yet fixed: the central bank's aggregate-financing tables have
  changed shape and `tsf_flow` and `tsf_stock` fail on "header not found".
  That is queued at the top.
  The outages. The first was the health page itself: a correlated subquery
  over an unindexed 370,000-row log plus a three-table join across every
  stored series, both synchronous on the thread that serves HTTP. I polled
  it waiting for the deploy and stopped the site answering anything at all,
  restarted it, and blamed the ingest. It was mine. Fixed with an index, a
  single pass, a query for the 149 curated keys instead of 78,000, and a
  one-minute cache; a test holds it under a second on a 20,000-row log. The
  second was a healthcheck that missed the catalog warm-up by two seconds —
  179.8 s against a 180 s window — after which Railway killed the new
  container and the previous one, sharing the volume, stopped answering
  too. Raising the window in `railway.toml` did nothing, because Railway
  does not read that file for this service; the setting lives on the
  service and was 180 there. Set to 420 through the API, read back, and
  written into both documents so nobody repeats the edit. The real fix is a
  faster warm-up, recorded in OPERATIONS.md.
  Also today: the first version of the health page led with "12187 sources
  failing to parse", which was true and useless — twelve thousand catalog
  series the bureau indexes with nothing behind them. They are counted
  separately now; the list is the 47 curated sources a person can act on,
  and most of those are the Customs failures from before the fix, which
  will roll out of the fourteen-day window on their own.
  Live: 54 pairs, 0 findings; health report in 0.96 s; 393 tests.

- 2026-09-22 (owner-directed: stop the deploy failures): three deploys had
  failed their healthcheck in a day and the owner asked why it kept
  happening. The window had been two seconds shorter than the catalog
  warm-up, and widening it covered the symptom; this found the cause. The
  catalog cache on the volume is keyed by a version string, and the version
  was built from each file's modification time. Every Docker build gives the
  copied catalog files a fresh mtime whenever their layer is rebuilt —
  nearly every code change, since `COPY catalog` follows `COPY server` — so
  the key changed on nearly every deploy while the bytes never did, the
  cache was discarded, and the catalog rebuilt from scratch on boot: 177.9
  and 189.1 seconds. The tell was a docs-only commit, which left the layer
  cached, kept the old mtime, matched the key, and warmed in 50.8 seconds.
  Which path a deploy got was Docker layer-cache luck.
  The version is now a hash of each file's bytes, so the same file gets the
  same key wherever it was copied and the cache is reused across deploys.
  The stat stays as a change detector so a file the sync scripts replace at
  runtime is still noticed. The first code deploy after the fix warmed in
  61.9 seconds and passed its healthcheck with over five minutes to spare.
  `catalog-version.test.ts` pins the key to the bytes: same content with a
  different mtime is the same version; different content is not.
  The fast path itself, a minute to parse and revive 79,836 stored entries,
  is what remains, and is recorded in OPERATIONS.md. Committed locally with
  this entry and not pushed on its own: a docs-only push is a deploy, and a
  deploy is not free here.

- 2026-09-22 (owner-directed: the health page had to stop lying): a
  twenty-minute log export from the live service, read for lessons. It held
  no deploy failure. It held 694 Customs parser errors, and behind them a
  rule that threw away every month that parsed whenever a third failed to —
  right for a layout change, wrong for old months in an earlier layout,
  which is what the backfill hits. Major imports and exports were current
  and held seven months of history while trade by partner held eighty-two.
  The rule is recency now (`layoutBroken`: broken only if the newest months
  fail), the 2020 imports header "Import Commodity" is accepted, and the
  first ingest after the fix stored 54 months for hi-tech products where the
  same run had been discarded the day before. Verified live: 82 months.
  Then the health page, twice. First, it listed the aggregate-financing
  keys as failing to parse and I queued "the central bank's tables have
  changed shape" at the top as a live bug. They had failed ten times in
  five hours on the morning their adapter was built and fetched cleanly
  every day since; the page could not tell a source that failed once from
  one still failing. It can now: a key whose newest failure is older than
  its newest success is recovered, listed apart and out of the count. The
  queue item is withdrawn and the reason recorded under Done. Second, its
  "behind" list expected August from every series on the 20th, and named
  nine finance-ministry series as behind on the 22nd — six of them three
  days from being due on the 25th. A series is behind by its own release
  day now, and one that states no day is expected only once the following
  month has ended, because on a page whose job is to say what is wrong a
  false "behind" costs more than a late one. The audit's own log row and
  the keys this deployment cannot refresh no longer appear as parse
  failures either; the first was never a source and the second is a missing
  service already shown under blocked.
  Net: the headline went from "12187 sources failing" on the page's first
  live run, to 47, to 7, to what is left after this — the finance ministry's
  502s and the bond series they delay. 402 tests; 54 pairs, 0 findings; two
  deploys today for all of it, each watched to success.

- 2026-09-26 (owner-directed: a site-wide copy audit): the owner printed
  the industrial profits page and asked whether the titles said what the
  charts showed, then asked for that kind of audit of the whole site. Six
  auditors read one surface each — Home, the series page, the seven theme
  pages, Provinces, Browse and search, and Health, Methodology and
  Releases — against the site's own rules: measure, geography and period
  in plain words; a unit said once; no middle dots; the publisher named,
  never a mirror; "year to date" where a figure is cumulative. Seventy
  findings, most of one family: figures that did not say what period or
  measure they were. Applied in this round: a cumulative figure on Home
  and the series page names the months it covers ("Jan to Jul 2026"), and
  its change is from the shorter span before it; a change in a level
  carries the level's unit ("+700 100M USD y/y"); a per-thousand rate
  changes in "per 1,000"; theme cards that showed growth but were titled
  as levels say growth, four year-to-date level charts say that the line
  restarts each January (the sawtooth is the reset, not a fall), a levels
  card sits in the money section rather than under a growth lede, notes
  no longer repeat the unit or the agency the card already prints, and
  the two "Headline" sections have names; the series page no longer says
  "Retrieved via NBS's own data portal" on Customs and Shanghai Exchange
  series (a ground rule inverted by a default string), cites the region it
  shows, calls a withdrawn value "Withdrawn" in the Revisions table
  rather than a restated one, and says "No note written for this series
  yet" instead of asserting the publisher has none; the province cards
  carry the period on every field, the profile's industry bars are at the
  sectors' scale, its GDP row says year to date, its trade section is
  named for the exports it holds, and its note is one clause; the health
  page says "sources the site could not read" (a 502 is not a parse
  fault), writes crawl failures in the reader's words rather than the
  runtime's, and formats its periods; the release calendar links the
  investment, profits, property, household and services releases to the
  series the site holds; the footer and the Home lede name the agencies
  behind the FRED series; a search result's dataset slot names the
  dataset, and a table prefix drops the vintage marker; the official
  English titles lose fullwidth brackets and run-on commas.
  Left to the owner as judgment calls: renaming the hero tiles
  ("Real GDP growth, China"), cutting the five theme-page ledes, an
  English-first sidebar, and aligning nav labels with section headings.
  Queued from the audit: axis scales in natural units (trillion yuan,
  billion USD, million people), an index labelled "Percent" where the
  stored unit is %, pinyin survivors in generated titles, provincial
  results labelled with the default province, and the ranking misses on
  "youth unemployment" and "population".
- 2026-09-25 (owner-directed: faster search; and "are we missing NBS
  series?"): a search scored all 79,836 catalog entries for every query —
  building each one's haystack, testing every term, sorting what matched —
  and took 180 to 1,200 ms on the serving thread. Most of that work proved
  that an entry does not match. A candidate index, built once per catalog
  snapshot in five seconds at boot, now answers "which entries could score
  above zero" from three postings over the same lowercased haystack the
  scorer reads: every Chinese character and adjacent pair (a Chinese term
  matches as a substring, and a substring's pairs are in it), every run of
  Latin letters and digits (a Latin term matches on a word boundary, with
  an optional plural), and every three letters of the joined pinyin. A
  term of mixed script or punctuation ("16—24岁") is netted by its Chinese
  runs and its interior number runs; a term the postings cannot express
  falls back to the full scan, which is the old behaviour exactly. The
  scorer and the sort are untouched, and a test holds the indexed ranking
  identical to the scanned one over thirty-two query shapes and holds the
  index to three times faster. Measured locally: "gdp" 185 → 12 ms,
  "居民消费价格" 250 → 60, "youth unemployment" 2,400 → 200, "猪肉价格"
  227 → under 1. What remains per query is the full-text tiebreak, 40 to
  150 ms in SQLite. The three largest JSON routes — search, theme pages,
  province cards — are gzipped when the client accepts it; a page of
  results was 80 KB of repeated field names.
  On missing series: the catalog has every dataset the portal lists but 9
  and 11. A probe crawl of 9 (港澳台月度数据) on 25 September reached its
  root and found no indicators, as the crawl's note already says of 11;
  both are empty on the portal, not missed. Within the datasets the crawl
  walks the bureau's tree to its leaves, and the Browse page now shows the
  same headings the portal does, dataset by dataset, which is the check a
  reader can make.
- 2026-09-24 (owner-directed: the regions page, "clearer, the way the
  mock-up has it"): the mock-up's regional section put a row of province
  cards under the map — growth, industrial output, size, residents, the
  three sectors, the largest industries — where the site had the map and
  a ranking and hid the profile behind selecting a tile. The regions page
  now carries one card per province below the map, largest economy first,
  each opening the profile: the curated growth series, the bureau's annual
  GRP and residents, and the sector shares and top four industries the
  profile computes. `/api/provinces` reads all thirty-one in nine
  milliseconds cold and is cached a minute. A field the store lacks is a
  dash; a card whose growth or GRP is for a different period than the rest
  says which, so a figure never sits under a period it is not for.
- 2026-09-24 (owner-directed: the pages in the nav): the owner listed what
  the site's top row should carry — headline, provinces, manufacturing,
  property, overcapacity and involution, trade and capital flows, equities,
  energy, demographics. Six more themes in `server/themes.ts`, 128 charts
  in all, every key, region and line held to the catalog by the theme test;
  Trade gained a capital-flows section (balance of payments, banks'
  cross-border flows and FX settlement, FDI, reserves, Treasury holdings,
  the yuan). A page strip under the top bar names all nine in the owner's
  order and scrolls sideways on a phone rather than hiding, as the tab nav
  does. Equities is honest about being thin: the Golden Dragon index and
  the two mainland policy-uncertainty indices are what the site holds; the
  exchanges' own indices are queued. Overcapacity is built as four
  questions — prices at the gate and the border, capacity and investment,
  volume out the door, demand at home — with the series that answer each;
  it is a picture, not a verdict, and the lede says so. Every endpoint
  reads in under six milliseconds.
- 2026-09-24 (owner-directed: a Trade page, and a Customs bug it showed):
  the owner asked, from the mock-up, for a Trade page on the real site —
  partners, commodities, "manuf trends and stuff", all charts. The first
  theme page: `server/themes.ts` holds a fixed list of twenty-eight charts,
  each naming a series the store holds, the partner or commodity where it
  has one, and the lines to draw; `/api/theme/trade` reads them with the
  region resolved as the series route resolves it and the page draws each
  with the series chart, legend and a link to the series. A test holds
  every key to the catalog or a national bureau id, every region to the
  series' own list and every line to its configured labels. Twenty-eight
  series read in three milliseconds. The owner then named the pages the
  nav should carry — headline, provinces, manufacturing, property,
  overcapacity, trade and flows, equities, energy, demographics — and the
  theme mechanism is the vehicle for the rest.
  The first look at the live page showed a fault the series page had hidden
  in plain sight: every partner's imports fell to nothing each February
  from 2022 to 2025 while exports doubled. Customs publishes January and
  February together, and through 2025 that table had no month column —
  three cumulative columns and three growth rates — so `parseByCountry`,
  reading the seven-column layout, stored the two months' imports as
  February's exports and a growth rate as its imports, for all thirty
  partners, in both currencies, four years running. The 2026 release
  carries a February column and reads correctly, which is why nothing
  recent looked wrong. The parser now recognises the cumulative-only
  sub-header and returns no month for it (nothing single-month was
  published, so nothing is derived), with the January-February 2025 table
  as the fixture. The store being append-only and the crawl writing only
  what it reads, a corrected parse could not retract the stored figures;
  `retractMisreadFebruaries` writes a null revision for exactly those
  key-region-label-periods once at boot, and the revision trail keeps what
  was shown before. Queued: the January-February totals those tables do
  carry, as year-to-date lines on the partner series.
- 2026-09-23 (owner-directed: a province page): the regions page ranked
  every province on one series at a time; a reader who clicked Guangdong
  got one figure and a link. The owner asked for the other direction —
  everything about one place — with unemployment and the largest industries
  named, and companies only if they could update themselves.
  `#/province?code=` now shows one province across everything the site
  holds for it, read from the store by the province's code and nothing else:
  growth from the curated provincial keys (real GDP, industrial output,
  consumer prices), and from the bureau's own provincial tables in the
  catalog, size (gross regional product, per person, resident population),
  labour and households (the unemployment rate, disposable income), trade
  (exports of operating units), and the makeup of the economy — primary,
  secondary and tertiary value added as shares of GRP, and the seven named
  industries the bureau breaks out, ranked. No adapter: the crawl and the
  ingest keep every series current, which is what the owner asked for.
  Two things the page says rather than hides. The unemployment rate the
  bureau publishes by province is the registered rate, and it stopped after
  2021 — the surveyed rate the site shows nationally is published for the
  nation and 31 cities only, not by province — so the row reads "Ended
  2021" with the reason under it, rather than a four-year-old figure shown
  as current. And shares are computed from the published levels of one
  year, so a share always refers to the year beside it; an industry not yet
  published for the latest year is left out rather than misdated.
  The structure gave the audit a new identity: Guangdong's primary,
  secondary and tertiary value added sum to its gross regional product to
  the decimal (5,891.8 + 54,993.5 + 84,961.5 = 145,846.8 in 2025), and a
  `components` pair now holds that nightly on the same ids the page uses.
  Companies are not here. No bureau table carries them, so nothing would
  update itself, and the owner's condition was exactly that.
  Also in this deploy: the Home page's value column, which at 96 pixels
  wrapped "143,696 100M yuan" onto two lines while the five-digit figure
  beside it fit; it is 150 pixels and never wraps at desktop width, and
  stacks the unit under the figure on every row alike on a narrow screen.
