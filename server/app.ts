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

import index from "../client/index.html";
import { catalogList, fetchLiveRegion, getSeries, seriesGeography, seriesRegions, CURATED_SYNONYMS, type SeriesResult } from "./data";
import { readSeries, readRevisions, readRevisionHistory, dbStatus } from "./db";
import {
  getNbsCatalogSeries,
  getNbsCatalogEntry,
  getNbsDimensions,
  isFrequency,
  nbsCatalogStats,
  searchNbsCatalog,
  transformLabel,
  transformPoints,
  type NbsTransform,
} from "./nbs-catalog";
import { RELEASE_MAP, describeRelease } from "./releases";
import { runCatalogCrawl, runIngest } from "./ingest";

// Serve the stored copy when we have one. Falling through to a live fetch
// keeps the app usable before the first ingest run and for any series the
// scheduler has not reached yet, but the normal path never touches an
// upstream portal during a page load.
const SERVE_LIVE_FALLBACK = process.env.CHINA_LIVE_FALLBACK !== "0";

const port = Number(process.env.PORT ?? 5173);

const RELEASE_TTL_MS = 6 * 60 * 60 * 1000;
const releaseCache = new Map<string, { at: number; body: unknown }>();

interface RouteRequest extends Request {
  params: Record<string, string>;
}

function isTransform(value: string | null): value is NbsTransform {
  return value === "raw" || value === "change" || value === "percent_change" ||
    value === "yoy" || value === "index_growth";
}

/**
 * Curated series are stored raw; the same transforms the catalog series get
 * apply here on the way out, so the "Show as" control works for every series.
 */
function applyTransform(result: SeriesResult, transform: NbsTransform | null): SeriesResult {
  if (!transform || transform === "raw") return result;
  const frequency = isFrequency(result.frequency) ? result.frequency : "Monthly";
  return {
    ...result,
    unit: transformLabel(transform),
    series: result.series.map((one) => ({ ...one, points: transformPoints(one.points, transform, frequency) })),
  };
}

function nbsDate(date: Date, endOfDay = false): string {
  const day = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
  return `${day} ${endOfDay ? "23:59:59" : "00:00:00"}`;
}

const routes = {
    "/": index,
    // The default link-preview image (a real chart) for X, Slack and the like.
    "/og.png": () => new Response(Bun.file(new URL("../client/og.png", import.meta.url)), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" } }),
    // Liveness for a platform healthcheck: the store opens and answers.
    "/health": () => {
      try { const totals = dbStatus().totals; return Response.json({ ok: true, observations: totals.observations, lastFetch: totals.lastFetch }); }
      catch (error) { return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 503 }); }
    },
    "/api/catalog": () => Response.json(catalogList()),
    "/api/catalog/stats": async () => Response.json(await nbsCatalogStats()),
    "/api/releases": async (req: RouteRequest) => {
      const params = new URL(req.url).searchParams;
      // The agenda changes monthly; the home page asks for it on every load.
      // One NBS call per six hours per month window, not one per visit.
      const cacheKey = `${params.get("start") ?? ""}|${params.get("end") ?? ""}`;
      const hit = releaseCache.get(cacheKey);
      if (hit && Date.now() - hit.at < RELEASE_TTL_MS) return Response.json(hit.body);
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
        // Attach the English name and linked series to each release so the
        // calendar can point at what it updates.
        const data = typeof body === "object" && body !== null ? Reflect.get(body, "data") : undefined;
        if (Array.isArray(data)) {
          const enriched = data.map((item) => {
            const content = typeof item === "object" && item !== null && typeof Reflect.get(item, "content") === "string"
              ? Reflect.get(item, "content") : "";
            const described = describeRelease(content);
            return { ...(typeof item === "object" && item !== null ? item : {}), en: described?.en ?? "", keys: described?.keys ?? [] };
          });
          const payload = { ...(typeof body === "object" && body !== null ? body : {}), data: enriched };
          releaseCache.set(cacheKey, { at: Date.now(), body: payload });
          return Response.json(payload);
        }
        return Response.json(body);
      } catch (error) {
        const message = error instanceof Error ? error.message : "NBS release calendar failed";
        return Response.json({ error: message }, { status: 502 });
      }
    },
    "/api/release-map": () => Response.json(RELEASE_MAP),
    // Every region of a multi-region series at once, for the map: the latest
    // value per region plus the periods available, all from the store.
    "/api/regional/:key": (req: RouteRequest) => {
      const key = req.params.key;
      const regions = key ? seriesRegions(key) : [];
      if (!key || regions.length === 0) return Response.json({ error: "Not a regional series" }, { status: 404 });
      const period = new URL(req.url).searchParams.get("period") ?? "";
      const periods = new Set<string>();
      const values = regions.map((region) => {
        const stored = readSeries(key, 120, region.value);
        const points = stored?.series[0]?.points ?? [];
        for (const point of points) periods.add(point.date);
        const chosen = period ? points.find((point) => point.date === period) : points[points.length - 1];
        return { region, value: chosen?.value ?? null, period: chosen?.date ?? null, points: points.slice(-8) };
      });
      const meta = readSeries(key, 1, regions[0]?.value);
      return Response.json({ key, title: meta?.title ?? key, unit: meta?.unit ?? "", frequency: meta?.frequency ?? "", agency: meta?.agency ?? "",
        updatedAt: meta?.updatedAt ?? null, periods: [...periods].sort().reverse(), values });
    },
    // One entry by key — curated or catalog — for pages that hold only keys
    // (saved, recent) and need titles.
    "/api/entry/:key": async (req: RouteRequest) => {
      const key = req.params.key;
      if (!key) return Response.json({ error: "Series key is required" }, { status: 400 });
      if (key.startsWith("nbs_")) {
        const entry = await getNbsCatalogEntry(key);
        return entry ? Response.json(entry) : Response.json({ error: "Unknown NBS series" }, { status: 404 });
      }
      const curated = catalogList().find((entry) => entry.key === key);
      return curated ? Response.json(curated) : Response.json({ error: "Unknown series" }, { status: 404 });
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
          const haystack = `${entry.title} ${entry.group} ${entry.agency} ${entry.unit} ${entry.key} ${(CURATED_SYNONYMS[entry.key] ?? []).join(" ")}`.toLocaleLowerCase();
          // Latin terms match at a word start ("unemp" finds unemployment, "ppi" no longer finds shopping); Chinese anywhere.
          return queryTerms.every((term) => /[\u3400-\u9fff]/.test(term)
            ? haystack.includes(term)
            : new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(haystack));
        }).map((entry) => ({
          key: entry.key,
          id: entry.key,
          name: entry.title,
          nameEn: entry.title,
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
      const curatedRegions = seriesRegions(key);
      if (curatedRegions.length > 0) return Response.json({ key, geography: seriesGeography(key), regions: curatedRegions });
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
      const region = url.searchParams.get("region") ?? undefined;
      // Without a label and period, the whole revision history: every period
      // that has been restated, with its vintages.
      if (!label || !period) {
        return Response.json({ key, region: region ?? "", revised: readRevisionHistory(key, region) });
      }
      return Response.json(readRevisions(key, label, period, region));
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
          return Response.json(await getNbsCatalogSeries({
            entry,
            region: params.get("region") ?? undefined,
            limit: Number.isFinite(limit) ? limit : 120,
            transform: isTransform(transform) ? transform : undefined,
          }));
        }
        const transformParam = params.get("transform");
        const transform = isTransform(transformParam) ? transformParam : null;
        const regions = seriesRegions(key);
        const region = regions.length > 0 ? (regions.find((item) => item.value === params.get("region")) ?? regions[0]) : undefined;
        const stored = readSeries(key, Number.isFinite(limit) ? limit : 120, region?.value);
        if (stored && stored.series.some((s) => s.points.length > 0)) {
          return Response.json({ ...applyTransform(stored, transform), region, source: "store", transform: transform ?? "raw" });
        }
        if (!SERVE_LIVE_FALLBACK) {
          return Response.json({ error: "Not yet ingested" }, { status: 503 });
        }
        const data = region ? await fetchLiveRegion(key, region, Number.isFinite(limit) ? limit : 120) : await getSeries(key, Number.isFinite(limit) ? limit : 120);
        if (!data) return Response.json({ error: "Unknown series" }, { status: 404 });
        return Response.json({ ...applyTransform(data, transform), region, source: "live", transform: transform ?? "raw" });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Upstream fetch failed";
        return Response.json({ error: message }, { status: 502 });
      }
    },
} as const;

// Production serves the minified bundle; development keeps HMR. Without this
// the deploy ships a 2.5 MB dev bundle where 241 KB gzipped would do.
const dev = process.env.NODE_ENV === "production" ? false : { hmr: true, console: true };

// AkShare calls (via AKTools) can take 15-25s; Bun's default 10s idle timeout
// would kill those connections mid-fetch. Give slow upstreams room.
const idleTimeout = 120;

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
// Warm the catalog, gloss and search index now rather than on the first visitor.
nbsCatalogStats().catch(() => undefined);

// On a single-service deployment the daily refresh runs in this process: a
// separate cron cannot share the volume the store lives on. Off in
// development unless asked for; every 24 hours in production by default.
const ingestEveryHours = Number(process.env.INGEST_EVERY_HOURS ?? (process.env.NODE_ENV === "production" ? 24 : 0));
if (ingestEveryHours > 0) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    const started = Date.now();
    try {
      const tally = await runIngest();
      console.log(`  Scheduled ingest: ${tally.ok} ok, ${tally.error} failed, ${tally.empty} empty in ${Math.round((Date.now() - started) / 1000)}s`);
    } catch (error) {
      console.error("  Scheduled ingest failed:", error instanceof Error ? error.message : String(error));
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 2 * 60 * 1000);
  setInterval(tick, ingestEveryHours * 60 * 60 * 1000);
  console.log(`  Ingest scheduled every ${ingestEveryHours}h (first run in 2 minutes)`);

  // The catalog crawl fills in series nobody has opened: a budget of series
  // every few hours until the whole catalog is stored, then a no-op. It
  // shares the running flag with the ingest so the two never overlap.
  // Batched by table, a whole-catalog run is a few hundred requests spread over a couple of hours.
  const crawlBudget = Number(process.env.CRAWL_PER_RUN ?? 20000);
  const crawlEveryHours = Number(process.env.CRAWL_EVERY_HOURS ?? 6);
  if (process.env.CATALOG_CRAWL !== "off" && crawlBudget > 0) {
    const crawl = async () => {
      // The boot-time ingest may still be running at the ten-minute mark; try again shortly rather than in six hours.
      if (running) { setTimeout(crawl, 5 * 60 * 1000); return; }
      running = true;
      const started = Date.now();
      try {
        const tally = await runCatalogCrawl(crawlBudget);
        if (tally.ok + tally.error + tally.empty > 0) console.log(`  Catalog crawl: ${tally.ok} ok, ${tally.error} failed, ${tally.empty} empty, ${tally.remaining} remaining, ${Math.round((Date.now() - started) / 1000)}s`);
      } catch (error) {
        console.error("  Catalog crawl failed:", error instanceof Error ? error.message : String(error));
      } finally {
        running = false;
      }
    };
    setTimeout(crawl, 10 * 60 * 1000);
    setInterval(crawl, crawlEveryHours * 60 * 60 * 1000);
    console.log(`  Catalog crawl scheduled: ${crawlBudget} series every ${crawlEveryHours}h (first run in 10 minutes)`);
  }
}
