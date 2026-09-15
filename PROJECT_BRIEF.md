# EconStats China: what exists, and what more would take

15 September 2026. Live at https://econstats-china-production.up.railway.app

## Summary

A working FRED for Chinese official statistics. Nine and a half thousand
browsable series, searchable in English or Chinese, charted, downloadable, and
archived with every revision the source has made since the store opened. It
runs unattended, refreshes itself on the statistics bureau's own release
calendar, and costs a few dollars a month.

Two things make it more than a scraper. It keeps a record of what the National
Bureau of Statistics published and when, which nobody else does for this data.
And it handles the conventions that make naive copies of Chinese data wrong.

## What is in it

| | |
|---|---|
| Browsable series | 13,258, from a 19,433-entry catalog |
| Observations stored | 1.32 million and climbing as the regional tables are fetched |
| Headline series, curated by hand | 43 |
| Provinces, quarterly real GDP | 31 |
| Cities, new and existing home prices | 70 |
| Provincial and city tables, every indicator by place | 121,000 series being stored |
| Store size | 439 MB on a mounted volume, a third smaller than before the rebuild |
| Tests | 153 |
| Logged improvement rounds | 212 |

Sources: the statistics bureau's own portal for the catalog and for
unemployment; the Eastmoney data centre, which republishes the bureau, the
central bank and customs verbatim, for headline monthlies; the St. Louis Fed
for the 24 series on China that come from the BIS, OECD, IMF, World Bank and US
agencies; and the AkShare community library for three series nobody else
mirrors.

## What was hard

**Getting the data at all.** The bureau's legacy query API is blocked outside
China. Its replacement is not, which took careful probing to establish, and is
now the path for the catalog and for the unemployment series. The catalog crawl
needs a real browser session because the challenge page is served with a
success code. The relay built for a China-side proxy has not been needed.

**Keeping the history.** The store is append-only: a row is written only when a
value differs from the last one recorded, so revisions accumulate rather than
overwrite. This matters more here than for US data. The bureau suspended its
youth unemployment series in 2023 and resumed it on a different basis, and
restatements arrive without announcement. The site can show what a figure was
before it changed. That record cannot be rebuilt after the fact, which makes it
the one irreplaceable asset in the project.

**Reading Chinese statistics correctly.** Three examples of what a careless
copy gets wrong, all found and fixed by checking the site against figures the
bureau publishes itself:

- The bureau publishes no January for its monthly activity series. January and
  February are released together as the February point. Counting twelve months
  back through the data therefore lands on the wrong month. Crude steel output
  read plus 111 percent for February where the bureau published minus 3.6.
- Some series publish a single-month February and some publish the combined
  figure. Mixing the two gave passenger traffic minus 49.5 percent where the
  bureau published plus 0.9.
- Growth rates the bureau publishes are computed on an enterprise sample held
  comparable with the previous year, while the levels it publishes are not.
  Working out growth from the levels is wrong by 0.2 points for crude steel and
  12 points for integrated circuits. The site now says so on every level series.

**Making it readable in English.** Every title carries a generated English
gloss, built from a dictionary of units and measures plus 6,573 concepts
translated once. Search takes English, Chinese or pinyin, knows that "cars"
means 汽车, and drops the scope qualifiers the bureau keeps in its annotations
rather than its titles.

## What it is not yet

- The bureau's annual national dataset, another forty thousand series, is being
  crawled. The provincial and city tables are in the catalog and are being
  stored place by place; until a place is stored its page fetches it live.
- Nothing is seasonally adjusted, and nothing corrects for the Lunar New Year,
  which moves between January and February and distorts every first quarter.
- The store has no backup. Rebuilding the levels takes about thirty minutes.
  Rebuilding the revision history is impossible.
- There is no public API, no bulk download, and no way to pull a series into
  Excel, R or Python other than one CSV at a time.
- One person maintains it, on one container, with no uptime commitment.

## What resources would buy

**Decisions, no money.** Three things are waiting on a choice rather than on
work: a bucket to back the volume up to, whether to split merchandise trade
into separate export and import series, and whether to merge the branch so the
scheduled backup job can run at all. Each is hours, not days.

**About a hundred dollars a month, plus a week.** Durable backups, uptime
monitoring, error tracking, a custom domain and a status page. This is the
difference between something that works and something you can tell people
about without checking it first.

**One engineer for a quarter.** Crawl the annual and regional tables, which
roughly triples coverage and adds the provincial and city depth the bureau has
but nobody surfaces in English. Ship an API with keys, bulk download, and
clients for Excel, R and Python. Expose the revision archive properly, so a
user can ask what a series looked like on a given date. Replace the generated
English with the bureau's own official translations where they exist.

**A funded team.** The gap between this and a product a bank would pay for is
analytical, not technical. Seasonal adjustment and a Lunar New Year correction
done properly. Nowcasts of the indicators that matter before they are released.
Alerts and a release-morning briefing. High-frequency and alternative series to
sit beside the official ones. A mirror inside China for reliability. At that
point the audience is the business economist who pays for Haver or Bloomberg
today, and the pitch is honest coverage of Chinese data with a memory, which is
the part the incumbents do worst.

## Risks worth stating

The mirror that supplies the headline monthlies could change or disappear;
everything it provides also exists at the bureau, but through a slower path.
Access from outside China has been stable but is not guaranteed. Terms of use
for redistribution have not been reviewed by anyone qualified. And the project
currently has one maintainer, which is the largest single risk to the archive.
