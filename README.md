# China Data Explorer

A FRED-style web app for Chinese official statistics: the National Bureau of
Statistics database, searchable in English and Chinese, beside headline
indicators read from the publishers themselves (PBOC, Customs, SAFE, the
Ministries of Finance and Commerce, the National Energy Administration, CFETS)
and cross-checked against one another every night.

Live: https://www.chinastats.org

Independent project, not affiliated with any statistical agency. Attribute
figures to the publishing agency, never to this site.

## What is in it (21 September 2026)

| | |
| --- | --- |
| NBS catalog | 66,302 browsable series across 12 datasets (79,836 rows in the crawl, since the bureau splits a long series into year-range slices that are grouped back into one): national monthly, quarterly and annual; provincial (31 provinces); city; Hong Kong, Macao and Taiwan; three international tables. 64,509 are stored; the rest are fetched on first view. |
| Headline series | 153, curated by hand in `server/data.ts`: 60 from NBS's own tables, 17 from the Eastmoney mirror of NBS/PBOC releases, 9 MOF, 8 Customs, 8 CFETS, 7 PBOC, 7 SAFE, 4 MOFCOM, 4 Shanghai Stock Exchange, 2 NEA, 3 AkShare (not refreshable on this deployment), 24 international series via FRED. |
| Store | 6.8 million observations in one SQLite file, append-only, so revisions are kept from the day a series was first stored. Every period also records how it arrived: with a release, as a restatement, or in a backfill. |
| Cross-checks | 55 pairs of series that should agree, compared nightly (`bun run audit`), including identities: generating sources sum to total electricity, the three expenditure contributions to GDP growth sum to 100 percent. Every domestic headline is paired or carries a written reason why it cannot be. |
| English | NBS's own English titles where its portal's English mode has them (`scripts/sync-nbs-english.ts`); generated translations elsewhere, marked as such. |
| Tests | 515 in 85 files: parser fixtures for every publisher, the store, the audit, a headless-Chrome render of the Home and ranking pages. |

## Quick start

Bun 1.3 or later:

```sh
bun install
bun run dev            # dev server with hot reload
# open http://localhost:5173   (PORT=... to change)
```

On first boot an empty store is seeded from `seed/china.db`, so the site has
data before its first refresh. No API key is required. `FRED_API_KEY` lets
the 24 international series refresh; `ANTHROPIC_API_KEY` expands English
search queries that miss. See the environment table at the end.

Other commands:

| Command | What it does |
| --- | --- |
| `bun test` | The whole suite (run from `` to run only the explorer's). |
| `bun run typecheck` | Type check; must report nothing. |
| `bun run audit` | The concordance audit against the local store. |
| `bun run ingest [keys]` | Refresh headline series into the local store. |
| `bun run catalog` | Re-crawl the NBS catalog (hours; see below). |
| `bun run regions` | Collect the place lists of regional tables. |
| `bun run english` | Collect NBS's English titles from the portal's English mode. |
| `bun run translate` | Model-translate remaining titles (needs `ANTHROPIC_API_KEY` and credit). |
| `bun run seed` | Rebuild `seed/china.db` from a good local store. Never on production data. |

## Repository map

```
server/
  app.ts            Bun.serve: routes, schedules (ingest, release refresh, sweeps, audit, crawl)
  data.ts           the curated headline catalog: every key, its source and lines; HOME_ROWS
  db.ts             the SQLite store: observations, series, fetch_log, catalog cache
  ingest.ts         refresh logic; never-stored keys first
  due.ts            when a series is due, by frequency and release day
  concordance.ts    the nightly cross-checks (CONCORDANCE_PAIRS, NO_PAIR)
  nbs-catalog.ts    the NBS catalog: search, English labels, regions, esData fetches
  gloss.ts          generated English for Chinese titles (token dictionary, pinyin fallback)
  official-english.ts  NBS's own English titles, pinned to id and Chinese name
  customs.ts pboc.ts mof.ts mofcom.ts safe.ts nea.ts cfets.ts   one adapter per publisher
  releases.ts release-plan.ts   the NBS release calendar and release-day refreshes
  fixtures/         captured publisher pages and workbooks the tests parse
  *.test.ts         tests beside the code they cover
client/
  app.tsx           the whole UI (React 19, Recharts); lib.ts holds the chart arithmetic
  styles.css
shared/places.ts    provinces, cities and countries with English names
catalog/            shipped data: nbs-catalog.json.gz, nbs-regions.json, gloss-en.json,
                    notes-en.json, nbs-official-en.json.gz
scripts/            catalog crawls and translation runs (run from your machine, not the server)
seed/china.db       the small store a fresh deployment starts from
Dockerfile          the image Railway builds; railway.toml points at it
.github/workflows/  ci.yml (tests and type check on every push), backup.yml (nightly store copy)
AGENTS.md           conventions and gates for anyone changing the code (CLAUDE.md points here)
CONTRIBUTING.md     the short version for a collaborator; OPERATIONS.md for running the service
LOOP.md             one round of the improvement loop; IMPROVEMENT_LOG.md its queue and log
DATASET_LOOP.md     one round of dataset work; DATASET_QUEUE.md what is next
docs/               PROJECT_BRIEF.md (the summary), COVERAGE_PLAN.md, FRED_PARITY.md
```

## How it works

```
browser ──> Bun.serve ──> SQLite store (observations, revisions, fetch log)   ← everything reads here first
                     ├──> NBS portal (data.stats.gov.cn)      catalog series, regions, official English
                     ├──> Eastmoney datacenter                 17 mirrored headline series
                     ├──> Customs, PBOC, MOF, MOFCOM, SAFE, NEA, CFETS   their own pages, tables and workbooks
                     ├──> FRED                                 international series on China
                     └──> AKTools (AkShare)                    three series; optional
```

- **Store first.** A page reads the store; a series nobody has stored yet is
  fetched from its source on first view and stored by the next scheduled
  refresh. The store is append-only: a revised value is written beside the
  earlier one with its fetch time, and the series page shows the vintages.
- **Schedules run inside the web process** (a Railway volume attaches to one
  service): a daily refresh of every headline series (never-stored keys
  first), a refresh ten minutes after each NBS release aimed at the series
  it updates and retried until the new period appears, sweeps of the other
  publishers at their usual hours, a crawl that stores catalog series nobody
  has opened, and the nightly concordance audit. Everything is paced: one
  request at a time per portal, with pauses. Do not raise the concurrency.
- **Concordance.** `server/concordance.ts` names pairs of series that must
  agree (the same statistic by two routes: NBS's table against the mirror,
  Customs against NBS, a monthly flow summed against the annual table, a
  period rate against its year-to-date companion). A difference beyond the
  pair's tolerance is a finding. `concordance-coverage.test.ts` fails if a
  domestic headline is neither paired nor explained in `NO_PAIR`.
- **English.** Every NBS title gets an English reading: the bureau's own where
  `catalog/nbs-official-en.json.gz` pins one to the exact current Chinese
  title, a stored model translation where one has been run, otherwise the
  token dictionary in `gloss.ts`. The source is shown on every card and page.
  Category names are curated in the client (`CATEGORY_EN`).

## Adding a headline series

1. Add an entry to `CATALOG` in `server/data.ts`: its `kind` (an existing
   adapter or a new one), group, title, agency, frequency, unit, and the
   lines it serves. Year-to-date series say so in the unit and the label.
   Never derive a January figure NBS did not publish.
2. Capture the source page, table or workbook into `server/fixtures/<publisher>/`
   and write a test that parses it to known figures and holds the latest
   period to the publisher's own headline.
3. Add a concordance pair against an independent reading, or a `NO_PAIR`
   reason that says why none exists. The coverage test enforces this.
4. If it belongs on the Home page, add it to `HOME_ROWS` with a row title
   that says exactly what its first line is.
5. Gates: `bun test`, the type check, and no test rows leaked into the local
   `china.db` (tests must set `CHINA_DB_PATH` before importing the store).
6. Deploy with `railway up --detach` from the repository root, verify the
   series live, log the round in `IMPROVEMENT_LOG.md`.

The dataset loop (`DATASET_LOOP.md`) is this procedure written out for an
agent; `DATASET_QUEUE.md` is the ordered list of what to add next, with each
parked item's reason.

## Building the catalog files

The shipped snapshot comes from the portal's live hierarchy, not a hand list:

```sh
bun run catalog                 # all dataset families; hours; checkpoints to .partial
bun run catalog --codes=3 --out=catalog/nbs-catalog-annual.json
bun run catalog:merge --out=catalog/nbs-catalog.json.gz \
  catalog/nbs-catalog.json catalog/nbs-catalog-annual.json
bun run regions                 # the places each regional table covers
bun run english                       # NBS's English titles, one request per table
```

The metadata endpoints challenge a plain HTTP client, so the catalog crawl
runs from a real browser session (`scripts/portal.ts`); the English crawl
uses plain requests, paced a second apart. The site reads
`nbs-catalog.json.gz` in preference to the plain file; `NBS_CATALOG_PATH`
points it at another snapshot for a trial run. The glossed catalog is
rebuilt automatically when any file under `catalog/` changes.

## Continuous integration

Every push and pull request runs `.github/workflows/ci.yml`: the type check
and the whole suite, the same gates a change has to pass locally. A nightly
job (`backup.yml`) asks the running site for a consistent copy of the store
and keeps it as a workflow artifact for 90 days; it needs `BACKUP_TOKEN` as
a repository secret and the same variable on the deployment. A green backup
run requires matching checksums, integrity checks and an independent restore;
missing credentials fail the run. See [OPERATIONS.md](OPERATIONS.md) for
recovery steps, readiness semantics and the remaining scaling work.

## Conventions

- Work on `main`. Never force-push.
- Never commit `china.db`, `catalog.db` or anything under `catalog/*.partial`.
  `seed/china.db` is committed on purpose and refreshed only deliberately.
- No new dependencies without a reason written in the commit. The parsers
  are dependency-free (`xlsx.ts` reads workbooks itself).
- Don't touch `Dockerfile`, `railway.toml` or `.github/workflows` in a
  dataset round.
- Attribute to the publisher, not the mirror. Say "year to date" when a
  series is cumulative. Keep the Home row titles literal.
- Commit messages explain the why; `IMPROVEMENT_LOG.md` carries the round.

## Local JSON API

- `GET /api/catalog` — the headline indicators (key, title, agency, unit, group, Home rank).
- `GET /api/home` — every Home series with its last 24 points in one payload.
- `GET /api/catalog/stats` — coverage, dataset and category facets, official-English count.
- `GET /api/search?q=&frequency=&geography=&dataset=&category=&limit=&offset=`
  — paginated catalog search; results carry their stored date range and the
  region they open at.
- `GET /api/entry/:key` — one headline or catalog entry by key.
- `GET /api/dimensions/:key` — valid geographic selections for an NBS series.
- `GET /api/series/:key?region=&transform=&limit=` — observations and metadata.
  `&asOf=YYYY-MM-DD` (curated series) serves the series as the site held it at
  the end of that day (UTC), from the stored vintages.
- `GET /api/regional/:key?period=&label=` — every region's value for one period.
- `GET /api/releases?start=&end=` — the publication calendar mapped to series.
- `GET /api/release-map` — the title-to-series mapping behind it.
- `GET /api/audit/concordance` — the latest concordance results.
- `GET /api/press-releases?limit=` — NBS release pages read in shadow mode: the
  headline figures parsed from each, and whether each agrees with the store,
  when read and now. Not served as series.
- `GET /api/revisions/:key?label=&period=` — stored revision history.
- `GET /api/status` — store size, totals, the fetch log, last runs and failures;
  `?series=1` for coverage per (key, region).
- `GET /api/backup` — a consistent copy of the store, for whoever holds
  `BACKUP_TOKEN` (`Authorization: Bearer …`). The route does not exist unless
  the variable is set. The store is the one thing here that cannot be rebuilt
  from the sources; a mounted volume is not a backup.
- `GET /ready` — `{ ok, observations, lastFetch }`; 503 until the catalog and
  search index warm successfully and the store answers. A failed warmup stays
  unavailable and is logged; elapsed startup time never makes it ready.
- `GET /health` — the same readiness response, retained for existing monitors.
- `GET /live` — process liveness only; does not assert that data is ready.

## Optional: AKTools (AkShare)

Three indicators (the Caixin PMIs and the real estate climate index) come
through [AKTools](https://github.com/akfamily/aktools). Without it they serve
from the store and the catalog marks them `refreshBlocked`. Run it locally
with `pip install aktools && python -m aktools` (port 8080, `AKTOOLS_URL` to
point elsewhere); set `AKTOOLS_URL=off` on a deployment without it.

## Deploying

One process, two SQLite files. `Dockerfile` at the repository root:

```sh
docker build -f Dockerfile -t econstats-china .
docker run -p 5173:5173 -v china-data:/data econstats-china
```

- `/data/china.db` is the store; mount a persistent volume. `/data/catalog.db`
  is a cache rebuilt from `catalog/*` when those files change.
- Railway: project `econstats-china`; `railway.toml` selects the Dockerfile
  and the `/ready` check, with up to 180 seconds for a cold start; a volume at `/data`; variables `FRED_API_KEY` and
  `AKTOOLS_URL=off`. Redeploy with `railway up --detach` from the repository
  root. The first refresh runs two
  minutes after boot, the first catalog crawl ten minutes after.

### Environment variables

None is required. Every one the server reads, with its default:

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `5173` | Port the web process listens on. |
| `CHINA_DB_PATH` | `./china.db` | The store. `/data/china.db` in the container. |
| `CHINA_CATALOG_DB_PATH` | `./catalog.db` | The derived catalog cache. |
| `CHINA_SEED` | on | `off` stops an empty store being seeded from `seed/china.db` (the tests set it). |
| `CHINA_LIVE_FALLBACK` | `1` | `0` answers 503 for a series not yet stored instead of fetching it on view. |
| `FRED_API_KEY` | unset | Needed for the international series to refresh. |
| `ANTHROPIC_API_KEY` | unset | Expands English search queries that miss into Chinese terms. |
| `NBS_QUERY_EXPANSION` | on | `off` disables that expansion (the tests set it). |
| `BACKUP_TOKEN` | unset | Enables `GET /api/backup`. |
| `AKTOOLS_URL` | `http://127.0.0.1:8080` | Where AKTools runs; `off` skips the AkShare series. |
| `INGEST_EVERY_HOURS` | `24` in production, `0` otherwise | How often the refresh of stored headline series runs. |
| `INGEST_LIMIT` | `240` | Points requested per headline series on a full read. |
| `INGEST_PAUSE_MS` | `1500` | Pause between headline requests. |
| `CATALOG_CRAWL` | on | `off` disables the crawl of catalog series nobody has opened. |
| `CRAWL_PER_RUN` | `20000` | Indicators per crawl run. |
| `CRAWL_EVERY_HOURS` | `6` | Hours between crawl runs. |
| `CRAWL_PAUSE_MS` | `1200` | Pause between crawl requests. |
