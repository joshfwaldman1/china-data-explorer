# Coverage plan: closing the gap to CEIC from official sources

27 September 2026. Replaces the 15 September plan, whose steps A to E have
shipped (summary at the end). The benchmark is CEIC's China Premium
database. This plan says what the site holds, where CEIC is ahead, what can
be matched from official publishers, what cannot, and the order to do it in.

`DATASET_QUEUE.md` holds the next few rounds. This file is where its items
come from.

## Where we are

**The NBS portal is done.** All twelve dataset families are crawled.
64,509 of 66,302 national series are stored (97%); the remainder came back
empty from NBS itself, mostly discontinued indicators. A sample of 60
provincial and city series found every place filled in 47 and none empty.
Counting each province and city series separately, as CEIC does, the site
holds roughly 180,000 series.

**Other publishers are started.** 153 curated series from 20 publishers:
NBS (69), People's Bank of China (13), Ministry of Finance (10), Customs (9),
CFETS (8), SAFE (7), Ministry of Commerce (5), National Energy
Administration (2), the Shanghai Stock Exchange (4), and FRED-hosted series
from the BIS, IMF, OECD, World Bank and US agencies.

**What CEIC has.** Library guides put China Premium at 345,000 to 415,000
series. CEIC's own pages give no current total. The difference from us is
almost all outside the NBS portal: the full central bank, finance ministry
and FX regulator tables, Customs by HS code, provincial debt, city and
county data from yearbooks, industry associations, daily market and
high-frequency data, constructed series (seasonally adjusted, single-month
from year to date), and history back to 1949.

## What we will not mirror

Some of CEIC's China coverage is licensed, not published. It needs a
contract, not an adapter, and the site does not proxy it.

- Private property data: China Index Academy and CREIS 100-city prices,
  CRIC developer sales rankings.
- Wind and other terminal-sourced market data.
- Association data sold to members only (detailed CPCA and CISA tables).
- CEIC's own composite indicators.

An official-sources mirror can plausibly match most of CEIC's macro and
sector coverage. It will stay behind on property and high-frequency depth,
and the site should say so rather than fill the gap with a proxy.

## Steps, in order

Ordered by value for the effort. Each step names its sources, what is known
about access from a US address, and what "done" means.

### 1. Depth from publishers we already read

The cheapest step: the access paths and parsers exist.

- **People's Bank of China statistics tables** (pbc.gov.cn, 统计数据, monthly
  Excel and HTML, annual archives from 1999). Have: headline loans, total
  social financing, money supply, the credit balance by four sectors. Add:
  the sources and uses of credit funds by sector and term (household short
  and medium/long-term loans, enterprise loans by term), deposits by sector,
  the central bank balance sheet, and the depository institutions survey.
  This fills the Consumption and Investment pages' credit gaps.
  *Access: unverified. First job is one captured table as a fixture.*
- **Ministry of Finance monthly fiscal release**, full tables. Have: revenue,
  expenditure, tax by type, land sales, local bond issuance and debt. Add:
  expenditure by function (education, social security, infrastructure-heavy
  urban and rural community affairs), the government fund budget in full,
  and the social insurance fund.
- **SAFE full tables** (Excel). Have: balance of payments headline and
  financial account by kind, FX settlement, cross-border flows. Add: the
  international investment position, gross external debt, balance of
  payments detail (goods, services, primary income), and settlement by item.
- **Commerce ministry.** Add outward direct investment, monthly.

*Done when:* each table has a fixture-tested parser that refuses a changed
layout, a due rule, and its series on the page it belongs to.

### 2. Provincial debt and finance

Damian Ma's "Provinces — Debt" category, and the largest provincial gap.

- **China Local Government Debt Information Disclosure Platform**
  (celma.org.cn, run for the finance ministry). Bond issuance, debt
  outstanding, limits and bond rates by province, monthly and annual. One
  site for all 31 provinces.
  *Access: unverified.*
- **Provincial finance departments' budget and final accounts reports.**
  Annual, one site per province, inconsistent layouts. After celma.
- There is no official LGFV debt series. The page says so rather than
  showing a proxy.

*Done when:* a Provinces debt page shows debt outstanding and issuance for
all 31 provinces, as a map and as series, with the national figure matching
the finance ministry's total.

### 3. NBS press releases

Figures NBS publishes in its monthly releases but not in its portal tables:
infrastructure investment (基础设施投资), high-tech industry investment
(高技术产业投资), and some program figures. The Investment page needs the
first to compare manufacturing, infrastructure and real estate on one chart.

The release-page HTML adapter is already on the not-done list from the
faster-updates work (15 September). Build it in shadow mode first: parse
each release and compare the figures it shares with the portal before
trusting the ones it alone carries.

*Done when:* infrastructure and high-tech investment, year to date, are
stored from each release, and the shadow comparison has matched the portal
for three months running.

### 4. A China-side fetch path

Several sources answer a US address with a block: Customs' Chinese site and
statistics portal (HTTP 412), the NBS query API (UrlACL 403), and possibly
some provincial sites. The earlier agent repo had a `relay/`; this repo does
not. Steps 5 and 7 depend on it.

Requirements: one request at a time with the adapters' existing pauses,
never raised concurrency; the relay only fetches, and parsing stays here;
every fetch logged with the channel it went through.

*Done when:* one Customs query-platform table is fetched through the relay
and parsed to figures that match the English site's release.

### 5. Customs by HS code

The largest single gain in series count. Have: 30 partners and blocs and
about 65 commodity lines from Customs' English release, back to 2022. The
statistics query platform (stats.customs.gov.cn) serves trade by HS code
(to 8 digits), by partner, by province of origin and by trade mode.

Start narrow: HS 2-digit by month, then the 4-digit lines the pages use
(integrated circuits, vehicles, solar cells, batteries, crude, iron ore,
soybeans), then partner by HS 2-digit. Full 8-digit coverage only if
someone asks for it.

*Prerequisite: step 4.*
*Done when:* HS 2-digit exports and imports, monthly, are stored back to
2017 and sum to Customs' published totals.

### 6. Other ministries and agencies

Each needs a small adapter. Official, so no proxy label.

- Ministry of Transport: port throughput by port, road and waterway freight.
- Civil Aviation Administration: passengers and cargo.
- Ministry of Industry and Information Technology: telecoms, software
  revenue, industrial robots and other sector figures.
- National Financial Regulatory Administration: bank assets, NPL ratios,
  capital adequacy.
- Securities regulator and the exchanges: already queued in
  `DATASET_QUEUE.md` item 4.
- Ministry of Natural Resources: land supply by use.
- Ministry of Ecology and Environment: city air quality.

### 7. Industry associations and high-frequency data

Official-adjacent, so each is labelled with its publisher and kept in its
own group, as the rules below require.

- CAAM monthly vehicle sales and CPCA passenger car sales (free press
  releases). The Consumption page needs car sales, not output.
- China Construction Machinery Association excavator sales (Investment).
- CISA crude steel output, ten-day.
- CANSI shipbuilding orders.
- Freight indices (SCFI, CCFI).

### 8. Statistical yearbooks

The national yearbook and the 31 provincial yearbooks carry city and county
data and history from before the portal. This is how CEIC reaches back to
1949 and down to counties. It is the biggest parsing job on this list, with
a layout that changes year to year, so it comes last and starts with one
province's yearbook as a trial.

*Prerequisite: step 4 for provincial sites that block.*

### 9. Constructed series

No new sources, and a large part of what analysts pay CEIC for.

- **Single-month from year to date**, where NBS publishes only the
  cumulative figure: month = this month's year-to-date level less last
  month's. January is never derived; the January-February figure stays
  combined. Labelled as derived, linked to its source series.
- **Seasonal adjustment** with a Lunar New Year correction, using the
  Census Bureau's X-13ARIMA-SEATS program. Shown as an option, never
  replacing the published figure.
- **Real values** deflated by the matching price index, and chained
  indices across NBS base changes.

### 10. Infrastructure that every step needs

- Finish the English translations: 41,349 of about 55,600 base concepts are
  glossed (`bun run china:translate --concurrency=8` resumes).
- Durable jobs across restarts and a per-host rate limit across processes,
  both on the not-done list from 15 September.
- A health-report line per source, so a publisher going dark shows up the
  day it happens.

## Suggested first round

Steps 1 and 2, then 3. Together they fill the credit gaps on the
Consumption and Investment pages, give Damian's list a provincial debt
page, and put infrastructure investment on the Investment page. Step 5 adds
the most series but waits on step 4.

## Shipped under the 15 September plan

- **A. Eastmoney adapter:** consumer confidence, enterprise boom index, tax
  revenue, foreign-currency loans, commerce ministry commodity prices.
- **B. Trade:** Customs' English site, partners and major exports and
  imports in USD and CNY (`server/customs.ts`).
- **C. Credit and bonds:** CFETS yield curve (`cgb_yields`), SHIBOR, repo
  fixings, central parity, CFETS index; total social financing flow and
  stock; the credit balance by sector.
- **D. Energy and fiscal:** NEA electricity consumption; finance ministry
  revenue, expenditure, tax by type, land sales, local government bonds.
- **E. External balance:** SAFE balance of payments, FX settlement,
  cross-border flows; commerce ministry FDI.
- **F. Context:** partly done through FRED (BIS, OECD, IMF, World Bank, US
  agencies). The NBS international datasets are crawled.

## Rules that apply to every addition

- Attribute to the publisher (GAC, PBOC, MOF, NEA, SAFE), never to the mirror;
  record the retrieval channel separately, as the store already does.
- Cumulative year-to-date versus single period stays explicit in the title;
  no January is derived; USD and CNY trade figures are separate series.
- A proxy is labelled a proxy and lives in its own group.
- A source that stops (Caixin) keeps its history and an `ended` flag rather
  than being silently replaced.
- Every new source gets its due rule (release calendar or elapsed-time
  fallback) and its own fetch-log entries, so a source going dark is visible.
- Licensed data is not scraped or proxied. Where CEIC has it and we do not,
  the page says the figure is not published officially.
