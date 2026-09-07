/**
 * China Data Explorer — a FRED-style browser for Chinese macro data.
 *
 * Open-source stack, nothing from scratch:
 *   - Bun.serve for the server + bundler (bundles the React/TSX frontend)
 *   - React 19 for the UI, Recharts for the charts (both already in the project)
 *   - data.ts proxies Eastmoney / NBS server-side (avoids browser CORS)
 *
 * Run:  bun run china-explorer/server.ts   (from the project root)
 */

import index from "./index.html";
import { catalogList, getSeries } from "./data";
import { readSeries, readRevisions, dbStatus } from "./db";
import {
  fetchNbsCatalogSeries,
  getNbsCatalogEntry,
  getNbsDimensions,
  nbsCatalogStats,
  searchNbsCatalog,
  type NbsTransform,
} from "./nbs-catalog";

// Serve the stored copy when we have one. Falling through to a live fetch
// keeps the app usable before the first ingest run and for any series the
// scheduler has not reached yet, but the normal path never touches an
// upstream portal during a page load.
const SERVE_LIVE_FALLBACK = process.env.CHINA_LIVE_FALLBACK !== "0";

const port = Number(process.env.PORT ?? 5173);

interface RouteRequest extends Request {
  params: Record<string, string>;
}

function isTransform(value: string | null): value is NbsTransform {
  return value === "raw" || value === "change" || value === "percent_change" ||
    value === "yoy" || value === "index_growth";
}

function nbsDate(date: Date, endOfDay = false): string {
  const day = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
  return `${day} ${endOfDay ? "23:59:59" : "00:00:00"}`;
}

const routes = {
    "/": index,
    "/api/catalog": () => Response.json(catalogList()),
    "/api/catalog/stats": async () => Response.json(await nbsCatalogStats()),
    "/api/releases": async (req: RouteRequest) => {
      const params = new URL(req.url).searchParams;
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const startDate = params.get("start") ?? nbsDate(monthStart);
      const endDate = params.get("end") ?? nbsDate(monthEnd, true);
      const query = new URLSearchParams({ startDate, endDate });
      try {
        const response = await fetch(
          `https://data.stats.gov.cn/dg/website/publicrelease/web/external/queryAgendaByDate?${query}`,
          {
            headers: {
              Accept: "application/json",
              Referer: "https://data.stats.gov.cn/dg/website/page.html",
              "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/152 Safari/537.36",
            },
            signal: AbortSignal.timeout(30_000),
          },
        );
        const text = await response.text();
        if (!response.ok) return Response.json({ error: `NBS releases -> HTTP ${response.status}` }, { status: 502 });
        if (!text.trimStart().startsWith("{")) return Response.json({ error: "NBS release calendar is temporarily rate-limited" }, { status: 502 });
        const body: unknown = JSON.parse(text);
        return Response.json(body);
      } catch (error) {
        const message = error instanceof Error ? error.message : "NBS release calendar failed";
        return Response.json({ error: message }, { status: 502 });
      }
    },
    "/api/search": async (req: RouteRequest) => {
      const params = new URL(req.url).searchParams;
      const queryText = (params.get("q") ?? "").trim();
      const datasetText = params.get("dataset");
      const datasetCode = datasetText === null ? undefined : Number(datasetText);
      const limitText = params.get("limit");
      const offsetText = params.get("offset");
      const requestedLimit = Math.min(100, Math.max(1, Number(limitText ?? "50")));
      const requestedOffset = Math.max(0, Number(offsetText ?? "0"));
      const frequency = params.get("frequency") ?? undefined;
      const geography = params.get("geography") ?? undefined;
      const category = params.get("category") ?? undefined;
      const queryTerms = queryText.toLocaleLowerCase().split(/\s+/).filter(Boolean);
      const featured = queryText && datasetCode === undefined && (!geography || geography === "National")
        ? catalogList().filter((entry) => {
          if (frequency && entry.frequency !== frequency) return false;
          if (category && entry.group !== category) return false;
          const haystack = `${entry.title} ${entry.group} ${entry.agency} ${entry.unit} ${entry.key}`.toLocaleLowerCase();
          return queryTerms.every((term) => haystack.includes(term));
        }).map((entry) => ({
          key: entry.key,
          id: entry.key,
          name: entry.title,
          shortName: entry.title,
          unit: entry.unit,
          note: "",
          annotation: "",
          datasetCode: 0,
          dataset: entry.agency,
          frequency: entry.frequency,
          geography: "National",
          categories: [entry.group],
        }))
        : [];
      const featuredResults = featured.slice(requestedOffset, requestedOffset + requestedLimit);
      const nbsOffset = Math.max(0, requestedOffset - featured.length);
      const remainingLimit = requestedLimit - featuredResults.length;
      const nbs = await searchNbsCatalog({
        query: queryText,
        frequency,
        geography,
        datasetCode: datasetCode !== undefined && Number.isFinite(datasetCode) ? datasetCode : undefined,
        category,
        limit: Math.max(1, remainingLimit),
        offset: nbsOffset,
      });
      return Response.json({
        total: featured.length + nbs.total,
        offset: requestedOffset,
        limit: requestedLimit,
        results: [...featuredResults, ...nbs.results.slice(0, remainingLimit)],
      });
    },
    "/api/dimensions/:key": async (req: RouteRequest) => {
      const key = req.params.key;
      if (!key) return Response.json({ error: "Series key is required" }, { status: 400 });
      const entry = await getNbsCatalogEntry(key);
      if (!entry) return Response.json({ error: "Unknown NBS series" }, { status: 404 });
      return Response.json({
        key: entry.key,
        geography: entry.geography,
        regions: await getNbsDimensions(entry),
      });
    },
    // Coverage and recent ingest runs — a stale chart should be diagnosable.
    "/api/status": () => Response.json(dbStatus()),
    // The revision trail for one period: every value we have ever stored for
    // it, oldest first.
    "/api/revisions/:key": (req: RouteRequest) => {
      const key = req.params.key;
      if (!key) return Response.json({ error: "Series key is required" }, { status: 400 });
      const url = new URL(req.url);
      const label = url.searchParams.get("label") ?? "";
      const period = url.searchParams.get("period") ?? "";
      if (!label || !period) {
        return Response.json({ error: "label and period are required" }, { status: 400 });
      }
      return Response.json(readRevisions(key, label, period));
    },
    "/api/series/:key": async (req: RouteRequest) => {
      const key = req.params.key;
      if (!key) return Response.json({ error: "Series key is required" }, { status: 400 });
      const params = new URL(req.url).searchParams;
      const limit = Number(params.get("limit") ?? "120");
      try {
        if (key.startsWith("nbs_")) {
          const entry = await getNbsCatalogEntry(key);
          if (!entry) return Response.json({ error: "Unknown NBS series" }, { status: 404 });
          const transform = params.get("transform");
          return Response.json(await fetchNbsCatalogSeries({
            entry,
            region: params.get("region") ?? undefined,
            limit: Number.isFinite(limit) ? limit : 120,
            transform: isTransform(transform) ? transform : undefined,
          }));
        }
        const stored = readSeries(key, Number.isFinite(limit) ? limit : 120);
        if (stored && stored.series.some((s) => s.points.length > 0)) {
          return Response.json({ ...stored, source: "store" });
        }
        if (!SERVE_LIVE_FALLBACK) {
          return Response.json({ error: "Not yet ingested" }, { status: 503 });
        }
        const data = await getSeries(key, Number.isFinite(limit) ? limit : 120);
        if (!data) return Response.json({ error: "Unknown series" }, { status: 404 });
        return Response.json({ ...data, source: "live" });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Upstream fetch failed";
        return Response.json({ error: message }, { status: 502 });
      }
    },
} as const;

const dev = { hmr: true, console: true } as const;

// AkShare calls (via AKTools) can take 15-25s; Bun's default 10s idle timeout
// would kill those connections mid-fetch. Give slow upstreams room.
const idleTimeout = 60;

let server;
try {
  server = Bun.serve({ port, idleTimeout, routes, development: dev });
} catch (error) {
  // Most commonly the port is already taken (5173 is also Vite's default).
  // Fall back to an OS-assigned free port instead of crashing.
  const code = error && typeof error === "object" && "code" in error ? error.code : "";
  if (code === "EADDRINUSE") {
    console.warn(`Port ${port} is in use — starting on a free port instead. (Set PORT to choose one.)`);
    server = Bun.serve({ port: 0, idleTimeout, routes, development: dev });
  } else {
    throw error;
  }
}

console.log(`\n  China Data Explorer running at ${server.url}\n`);
