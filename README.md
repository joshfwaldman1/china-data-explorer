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
bun run china-explorer/server.ts
# then open http://localhost:5173   (set PORT=xxxx to change)
```

## How it works

```
browser ──> Bun.serve ──> local NBS catalog       (tens of thousands of searchable series)
                     ├──> NBS esData portal       (observations and regional dimensions)
                     ├──> Eastmoney datacenter    (featured macro series)
                     └──> AKTools (AkShare)        (LPR, Caixin PMI ×2, electricity — optional; see below)
```

- **`server.ts`** — Bun.serve serves the page (bundling `frontend.tsx` on the
  fly) and exposes catalog search, dataset facets, regional dimensions,
  releases, revisions, and series observations as JSON routes.
- **`nbs-catalog.ts`** — loads the generated NBS catalog, searches it, resolves
  geographic dimensions, retrieves observations, and applies transformations.
- **`data.ts`** — the featured macro catalog plus three source fetchers
  (Eastmoney, NBS, AKTools) and a 1-hour in-memory cache. All fetching
  is server-side, which is how FRED works and avoids the browser CORS wall
  (Eastmoney/NBS send no CORS headers).
- **`frontend.tsx`** — responsive FRED-style workspace with global search,
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

- `GET /api/catalog/stats` — coverage and dataset/category facets.
- `GET /api/search?q=&frequency=&geography=&dataset=&category=&limit=&offset=`
  — paginated catalog search.
- `GET /api/dimensions/:key` — valid geographic selections for an NBS series.
- `GET /api/series/:key?region=&transform=&limit=` — observations and metadata.
- `GET /api/releases?start=&end=` — the NBS publication calendar.
- `GET /api/revisions/:key?label=&period=` — locally stored revision history.

## Optional: AKTools (AkShare) for extra breadth

Four indicators — **LPR** (interest rates), **Caixin Manufacturing/Services PMI**,
and **Electricity Consumption** — are pulled from [AkShare](https://github.com/akfamily/akshare)
via its HTTP wrapper [AKTools](https://github.com/akfamily/aktools). AkShare
maintains *hundreds* of `macro_china_*` series, so this is how the explorer
grows beyond what we hand-wire. To enable them, run AKTools alongside the app:

```sh
python -m venv venv && source venv/bin/activate
pip install aktools
python -m aktools            # serves http://127.0.0.1:8080  (override with AKTOOLS_URL)
```

Without AKTools running, the other 12 indicators still work; the AkShare-backed
ones just error until it's up. Adding more AkShare series is a one-entry change
in `data.ts` (function name, date format, and which fields to plot).

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
