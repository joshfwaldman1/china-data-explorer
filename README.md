# China Data Explorer

A FRED-style web app for browsing Chinese macroeconomic data. Built entirely on
open-source tooling already in this project — **Bun** (server + bundler),
**React 19** (UI), **Recharts** (charts) — nothing from scratch.

The broader product target and remaining parity work are tracked in
[`FRED_PARITY.md`](./FRED_PARITY.md).

![screenshot](./screenshot.png)

## Run it

From the project root:

```sh
bun run china-explorer/server/app.ts
# then open http://localhost:5173   (set PORT=xxxx to change)
```

## How it works

```
browser ──> Bun.serve ──> local NBS catalog       (tens of thousands of searchable series)
                     ├──> NBS esData portal       (observations and regional dimensions)
                     ├──> Eastmoney datacenter    (featured macro series)
                     └──> AKTools (AkShare)        (Caixin PMI x2, real estate climate; optional, see below)
                     └──> FRED (St. Louis Fed)     (BIS, OECD, IMF, World Bank, US agencies; needs FRED_API_KEY)
```

- **`server.ts`** — Bun.serve serves the page (bundling `client/app.tsx` on the
  fly) and exposes catalog search, dataset facets, regional dimensions,
  releases, revisions, and series observations as JSON routes.
- **`server/nbs-catalog.ts`** — loads the generated NBS catalog, searches it, resolves
  geographic dimensions, retrieves observations, and applies transformations.
- **`server/data.ts`** — the featured macro catalog plus three source fetchers
  (Eastmoney, NBS, AKTools) and a 1-hour in-memory cache. All fetching
  is server-side, which is how FRED works and avoids the browser CORS wall
  (Eastmoney/NBS send no CORS headers).
- **`client/app.tsx`** — responsive FRED-style workspace with global search,
  dataset/frequency/geography filters, comparisons, transformations, region
  selection, charts, tables, metadata, saved series, exports, and releases.

## Build the full NBS catalog

The checked-in snapshot is produced from the official portal's live hierarchy,
not a hand-maintained series list:

```sh
bun run china:catalog
```

The sync walks all ten current dataset families: national monthly, quarterly,
and annual; provincial monthly, quarterly, and annual; major-city monthly and
annual; and Hong Kong/Macao/Taiwan monthly and annual. It publishes an atomic
snapshot after each completed dataset root and keeps in-progress work in a
`.partial` checkpoint. Use
`--codes=1,5`, `--delay=750`, or `--concurrency=3` to tune a refresh.
When refreshing only selected families, pass `--merge=true` to retain the
families already present in the published snapshot.

## FRED-style features

- **Deep links** — every series has its own URL (`#/series/cpi`), so views can
  be bookmarked or shared; comma-separated keys create comparison views.
- **Catalog discovery** — full-text search across titles, categories, dataset
  names, and IDs, with frequency and geography facets.
- **Series tools** — raw levels, changes, percent changes, year-over-year
  changes, index-to-growth conversion, log scale, ranges, tables, and metadata.
- **Regional dimensions** — applicable NBS series expose province or city
  selectors loaded from the official data catalog.
- **Saved series and releases** — favorites persist locally and the Releases
  view uses the current official NBS publication schedule.
- **CSV and JSON export** — downloads the observations behind the current view.
- **PNG export** — renders the chart to a titled, 2x-resolution image with
  agency/frequency/unit and a source line baked in, ready to paste into a doc.

## Local JSON API

- `GET /api/catalog` — the headline indicators (key, title, agency, unit, group).
- `GET /api/catalog/stats` — coverage and dataset/category facets.
- `GET /api/search?q=&frequency=&geography=&dataset=&category=&limit=&offset=`
  — paginated catalog search; results carry their stored date range.
- `GET /api/entry/:key` — one headline or catalog entry by key, for pages that
  hold only keys.
- `GET /api/dimensions/:key` — valid geographic selections for an NBS series.
- `GET /api/series/:key?region=&transform=&limit=` — observations and metadata.
- `GET /api/regional/:key?period=` — every region's value for one period, for
  the Provinces map.
- `GET /api/releases?start=&end=` — the NBS publication calendar, each item
  mapped to the series it updates.
- `GET /api/release-map` — the title-to-series mapping behind that calendar.
- `GET /api/schedule` — upcoming mapped releases and the last release-day
  refresh.
- `GET /api/revisions/:key?label=&period=` — locally stored revision history.
- `GET /api/status` — store size, coverage per series, the last runs and the
  failed fetches of the past week.

## Optional: AKTools (AkShare) for extra breadth

Three indicators — the **Caixin Manufacturing and Services PMI** (ended
September 2025) and the **Real Estate Climate Index** — are pulled from
[AkShare](https://github.com/akfamily/akshare) via its HTTP wrapper
[AKTools](https://github.com/akfamily/aktools). AkShare maintains *hundreds* of
`macro_china_*` series, so this is one way the explorer can grow beyond what
we hand-wire. To refresh them locally, run AKTools alongside the app:

```sh
python -m venv venv && source venv/bin/activate
pip install aktools
python -m aktools            # serves http://127.0.0.1:8080  (override with AKTOOLS_URL)
```

Without AKTools running, every other indicator still works and the AkShare-backed
ones serve from the store. Set `AKTOOLS_URL=off` on a deployment without it so
the ingest skips them instead of logging a failure. Adding more AkShare series
is a one-entry change in `server/data.ts` (function name, date format, and
which fields to plot).

## Notes

- Sources: mostly Eastmoney (mirrors NBS/PBOC/Customs), NBS-direct for
  unemployment, and AkShare for the four extras above. Attribute to the
  originating agency, not the aggregator.
- Chinese conventions are respected: YoY % for most series, PMI as a diffusion
  index (50 = neutral), reserves/new-loans as levels.
- Freshness varies: Eastmoney/NBS/LPR/electricity are current; the Caixin
  "report" series come via a vendor feed that lags ~1–2 months.
- Demo project — not affiliated with any statistical agency.
- **Provincial GDP** is also retained as a curated shortcut. Full-catalog NBS
  regional series expose their available geographic selector dynamically.

## Capture regional NBS IDs

The regional IDs were obtained from the portal's own live request. Re-run the
capture against any province with Chrome installed:

```sh
bun run china-explorer/scripts/capture-area.ts --province=广东省
```

The script writes the complete matching `esData` request and response under
`china-explorer/captures/`. Use `--out=path/to/file.json`, `--headed=true`, or
`--channel=chromium` to override its defaults.

## Deploying

The explorer runs from one process and two SQLite files. `Dockerfile.china`
at the repository root builds it alone:

```sh
docker build -f Dockerfile.china -t econstats-china .
docker run -p 5173:5173 -v china-data:/data econstats-china
```

- `/data/china.db` is the store — observations, revisions, fetch log. Mount a
  persistent volume; it is the only state that matters. Seed it by running
  `bun run china-explorer/server/ingest.ts` inside the container, and schedule
  the same command daily (a Railway cron, a systemd timer, anything).
- `/data/catalog.db` is a cache rebuilt from `china-explorer/catalog/*.json`
  whenever those files change. Losing it costs half a second.
- `GET /health` returns `{ ok: true, observations, lastFetch }` for a platform
  healthcheck (`railway.toml` already points at `/health`).
- `ANTHROPIC_API_KEY` is optional: without it, search still works but English
  queries that miss are not expanded.
- Set `AKTOOLS_URL=off` on a deployment without AKTools so those refreshes are
  skipped with a clear message instead of probing localhost.
- The three AkShare-backed series need AKTools (`python -m aktools` on :8080,
  `AKTOOLS_URL` to point elsewhere). Without it they serve from the store.

### Environment variables

None is required. Every one the server reads, with its default:

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `5173` | Port the web process listens on. |
| `CHINA_DB_PATH` | `china-explorer/china.db` | The store: observations, revisions, fetch log. `/data/china.db` in the container. |
| `CHINA_CATALOG_DB_PATH` | `china-explorer/catalog.db` | The derived catalog cache, rebuilt from `catalog/*.json`. |
| `CHINA_SEED` | on | `off` stops an empty store being seeded from `seed/china.db` (the tests set it). |
| `CHINA_LIVE_FALLBACK` | `1` | `0` answers 503 for a series not yet stored instead of fetching it from the portal on view. |
| `FRED_API_KEY` | unset | Needed for the international series from FRED to refresh. |
| `ANTHROPIC_API_KEY` | unset | Expands English search queries that miss into Chinese terms. Without it search still works. |
| `NBS_QUERY_EXPANSION` | on | `off` disables that expansion (the tests set it). |
| `AKTOOLS_URL` | `http://127.0.0.1:8080` | Where AKTools runs. `off` says the deployment has none, so the ingest skips the AkShare series. |
| `INGEST_EVERY_HOURS` | `24` in production, `0` otherwise | How often the due-check refresh of stored series runs. `0` disables it. |
| `INGEST_LIMIT` | `240` | Points requested per headline series per refresh. |
| `INGEST_PAUSE_MS` | `1500` | Pause between headline requests. |
| `NBS_STORE_TTL_HOURS` | `24` | Age after which a stored catalog series is checked upstream when viewed. |
| `CATALOG_CRAWL` | on | `off` disables the crawl that stores catalog series nobody has opened. |
| `CRAWL_PER_RUN` | `20000` | Indicators per crawl run. |
| `CRAWL_EVERY_HOURS` | `6` | Hours between crawl runs. |
| `CRAWL_PAUSE_MS` | `1200` | Pause between crawl requests. |

### Railway, specifically

Live: https://econstats-china-production.up.railway.app (project
`econstats-china` in the EconStats workspace; redeploy with `railway up --detach`
from the repository root, where the CLI is linked to it).

1. `railway login`, then in this repository `railway init` (new project) or
   `railway link` (existing). Create a service from the GitHub repo, branch
   `china-data-explorer`.
2. In the service settings set **Config file path** to `railway.china.toml`
   (the root `railway.toml` belongs to the agent app). It selects
   `Dockerfile.china` and the `/health` check.
3. Add a **volume** mounted at `/data`. On first boot the store is seeded
   from `china-explorer/seed/china.db` (committed; refresh it with
   `bun run china:seed` after a good ingest), so the site has data before the
   first refresh.
4. Variables: none required. The live service sets `FRED_API_KEY` and
   `AKTOOLS_URL=off`; see the table above for the rest. The refresh runs
   inside the web process because a volume attaches to one service.
5. Deploy. The first ingest runs two minutes after boot and the first catalog
   crawl ten minutes after; both show in the logs.

The NBS portal does answer Railway's IPs: the full catalog crawl completed
from the live service on 2026-09-09.
