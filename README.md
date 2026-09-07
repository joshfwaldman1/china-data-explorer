# China Data Explorer

A FRED-style web app for browsing Chinese macroeconomic data. Built entirely on
open-source tooling already in this project — **Bun** (server + bundler),
**React 19** (UI), **Recharts** (charts) — nothing from scratch.

![screenshot](./screenshot.png)

## Run it

From the project root:

```sh
bun run china-explorer/server.ts
# then open http://localhost:5173   (set PORT=xxxx to change)
```

## How it works

```
browser ──> Bun.serve ──> Eastmoney datacenter   (GDP, CPI, PPI, PMI, money, retail, trade, IP, loans, reserves)
                     ├──> NBS esData portal       (unemployment, Guangdong GDP)
                     └──> AKTools (AkShare)        (LPR, Caixin PMI ×2, electricity — optional; see below)
```

- **`server.ts`** — Bun.serve serves the page (bundling `frontend.tsx` on the
  fly) and exposes two JSON routes: `/api/catalog` and `/api/series/:key`.
  `idleTimeout` is raised to 60s because AkShare calls can take 15–25s.
- **`data.ts`** — the catalog (16 indicators, grouped) plus three source
  fetchers (Eastmoney, NBS, AKTools) and a 1-hour in-memory cache. All fetching
  is server-side, which is how FRED works and avoids the browser CORS wall
  (Eastmoney/NBS send no CORS headers).
- **`frontend.tsx`** — React app: searchable grouped sidebar, an interactive
  Recharts time-series with range controls (3Y/5Y/10Y/Max), a latest-value
  readout, multi-series overlays (M1/M2, exports/imports, the unemployment
  family), a zero baseline for YoY series, auto-fitted y-axis, and source
  attribution.

## FRED-style features

- **Deep links** — every series has its own URL (`#/series/cpi`), so views can
  be bookmarked or shared; browser back/forward works. **Copy link** button too.
- **CSV export** — downloads the full history, all columns (`china_cpi.csv`).
- **PNG export** — renders the chart to a titled, 2x-resolution image with
  agency/frequency/unit and a source line baked in, ready to paste into a doc.

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
- **Provincial GDP** currently charts Guangdong real GDP growth from the NBS
  quarterly regional dataset. `data.ts` includes the full 31-province GB/T 2260
  mapping for extending the same series to a province selector later.

## Capture regional NBS IDs

The regional IDs were obtained from the portal's own live request. Re-run the
capture against any province with Chrome installed:

```sh
bun run china-explorer/scripts/capture-area.ts --province=广东省
```

The script writes the complete matching `esData` request and response under
`china-explorer/captures/`. Use `--out=path/to/file.json`, `--headed=true`, or
`--channel=chromium` to override its defaults.
