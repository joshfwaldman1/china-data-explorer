/**
 * China Data Explorer — a FRED-style browser for Chinese macro data.
 *
 * Open-source stack, nothing from scratch:
 *   - Bun.serve for the server + bundler (bundles the React/TSX frontend)
 *   - React 19 for the UI, Recharts for the charts (both already in the project)
 *   - data.ts proxies Eastmoney / NBS server-side (avoids browser CORS)
 *
 * Run:  bun run dev   (from the project root)
 */

import index from "../client/index.html";
import { timingSafeEqual } from "node:crypto";
import { regionCoverage } from "./regions";
import { CATALOG, HERO_KEYS, catalogList, fetchLiveRegion, getSeries, seriesGeography, seriesRegions, matchCurated, type CatalogEntry, type Series, type SeriesResult, seriesRegion, configuredLabels } from "./data";

/** A stored result with only the labels the key is configured to serve (a dropped label stays in the append-only store). */

/**
 * A JSON response gzipped when the client accepts it and the body is worth it.
 * Bun does not compress on its own, and a page of search results is 80 KB of
 * repeated field names that packs to a tenth of that; on a phone the transfer
 * was most of the wait.
 */
function jsonFor(req: Request, body: unknown, init: ResponseInit = {}): Response {
  const text = JSON.stringify(body);
  const accepts = /\bgzip\b/.test(req.headers.get("accept-encoding") ?? "");
  if (!accepts || text.length < 4096) return new Response(text, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
  return new Response(Bun.gzipSync(Buffer.from(text)), { ...init, headers: { "content-type": "application/json", "content-encoding": "gzip", vary: "accept-encoding", ...(init.headers ?? {}) } });
}
function onlyConfigured(key: string, stored: SeriesResult | null): SeriesResult | null {
  const labels = configuredLabels(key);
  if (!stored || !labels) return stored;
  const kept = stored.series.filter((series) => labels.includes(series.label));
  return kept.length > 0 ? { ...stored, series: kept } : stored;
}
import { readSeries, readRevisions, readRevisionHistory, dbHealth, dbStatus, storedLatest, lastReleaseRefresh, logFetch, dbStatusWithSeries, recentReleaseChecks } from "./db";
import { PUBLISHER_WINDOWS, activeWindows, keysAwaitingRelease } from "./release-windows";
import {
  getNbsCatalogSeries,
  getNbsCatalogEntry,
  getNbsDimensions,
  isFrequency,
  nbsCatalogStats,
  searchNbsCatalogWithPlaces,
  resolveTransform,
  transformLabel,
  transformPoints,
  type NbsTransform, SEARCH_STOP_WORDS, normalizeQuery, warmSearchIndex } from "./nbs-catalog";
import { RELEASE_MAP, describeRelease, agendaBound } from "./releases";
import { fillRegionalSeries, refreshCatalogForRelease, runCatalogCrawl, runIngest } from "./ingest";
import { pendingSeries, releaseTargets, type ReleaseTarget } from "./release-plan";
import { PRIORITY, createWorker } from "./worker";
import { formatResult, runConcordance } from "./concordance";
import { fetchCustomsReleases } from "./customs-calendar";
import { createReadinessProbe } from "./readiness";
import { methodology } from "./methodology";
import { healthHeadline, healthReport } from "./health-report";
import { provinceProfile, provinceCards } from "./province";
import { themeData } from "./themes";
import { BEFORE_RELEASES_RECORDED, arrivalSentence, arrivalsFor, recordReleases, storedReleases } from "./arrivals";
import { createBackupManager } from "./backup";
import { upstreamFetch, upstreamStats } from "./upstream";
import { delayUntilDue, lastRun, pendingJobs, pruneSettledJobs, recordRun, scheduleJob, settleJob } from "./jobs";
import { checkPressReleases, recentPressReleases } from "./nbs-releases";

// Serve the stored copy when we have one. Falling through to a live fetch
// keeps the app usable before the first ingest run and for any series the
// scheduler has not reached yet, but the normal path never touches an
// upstream portal during a page load.
const SERVE_LIVE_FALLBACK = process.env.CHINA_LIVE_FALLBACK !== "0";

const port = Number(process.env.PORT ?? 5173);
const backups = createBackupManager({ sourcePath: process.env.CHINA_DB_PATH ?? `${import.meta.dir}/../china.db` });

const RELEASE_TTL_MS = 6 * 60 * 60 * 1000;
const releaseCache = new Map<string, { at: number; body: { data: AgendaItem[] } }>();

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
function applyTransform(result: SeriesResult, requested: NbsTransform | null): SeriesResult & { transform: NbsTransform } {
  if (!requested || requested === "raw") return { ...result, transform: "raw" };
  // "Index minus 100" only for an index on a year-earlier base; a level gets its real year-on-year change.
  const transform = resolveTransform(requested, `${result.unit} ${result.title}`);
  const frequency = isFrequency(result.frequency) ? result.frequency : "Monthly";
  return {
    ...result,
    transform,
    unit: transformLabel(transform, result.unit),
    series: result.series.map((one) => ({ ...one, points: transformPoints(one.points, transform, frequency) })),
  };
}

interface AgendaItem { _id: string; fb_time: string; content: string; en: string; keys: string[]; categories: string[]; }

/**
 * The NBS publication agenda for a date window, each item carrying its
 * English name and the series it updates. One NBS call per six hours per
 * window; the home page asks on every load and the scheduler every few hours.
 */
async function fetchAgenda(startDate: string, endDate: string): Promise<{ data: AgendaItem[] }> {
  const cacheKey = `${startDate}|${endDate}`;
  const hit = releaseCache.get(cacheKey);
  if (hit && Date.now() - hit.at < RELEASE_TTL_MS) return hit.body;
  const query = new URLSearchParams({ startDate, endDate });
  const response = await upstreamFetch(
    `https://data.stats.gov.cn/dg/website/publicrelease/web/external/queryAgendaByDate?${query}`,
    {
      headers: {
        Accept: "application/json",
        Referer: "https://data.stats.gov.cn/dg/website/page.html",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/152 Safari/537.36",
      },
      timeoutMs: 30_000,
    },
  );
  const text = await response.text();
  if (!response.ok) throw new Error(`NBS releases -> HTTP ${response.status}`);
  if (!text.trimStart().startsWith("{")) throw new Error("NBS release calendar is temporarily rate-limited");
  const body: unknown = JSON.parse(text);
  const data = typeof body === "object" && body !== null ? Reflect.get(body, "data") : undefined;
  const items: AgendaItem[] = [];
  if (Array.isArray(data)) {
    for (const item of data) {
      if (typeof item !== "object" || item === null) continue;
      const content = Reflect.get(item, "content"), when = Reflect.get(item, "fb_time"), id = Reflect.get(item, "_id");
      if (typeof content !== "string" || typeof when !== "string") continue;
      const described = describeRelease(content, when);
      items.push({ _id: typeof id === "string" ? id : `${when} ${content}`, fb_time: when, content, en: described?.en ?? "", keys: described?.keys ?? [], categories: described?.categories ?? [] });
    }
  }
  // Customs is not on NBS's calendar. Its own calendar, when the English
  // site has the year's, adds the preliminary releases (the trade tables) as
  // items of the same shape; a Customs outage must not take NBS's agenda down.
  try {
    items.push(...await fetchCustomsReleases(startDate.slice(0, 10), endDate.slice(0, 10), CUSTOMS_KEYS));
    items.sort((a, b) => a.fb_time.localeCompare(b.fb_time));
  } catch (error) {
    console.warn(`  Customs calendar unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  const payload = { data: items };
  releaseCache.set(cacheKey, { at: Date.now(), body: payload });
  // A release the calendar named is a fact worth keeping: the cache expires
  // and the window moves on, but a figure fetched today will still want to
  // name the release that carried it a year from now.
  try {
    recordReleases(items.map((item) => ({
      id: item._id,
      agency: CUSTOMS_KEYS.includes(item.keys[0] ?? "") ? "General Administration of Customs" : "National Bureau of Statistics",
      publishedAt: (cstToDate(item.fb_time) ?? new Date(item.fb_time)).toISOString(),
      title: item.content, titleEn: item.en, url: "", keys: item.keys,
    })));
  } catch (error) {
    console.warn(`  Recording releases failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return payload;
}

/** The curated series Customs' preliminary release moves: its own tables and the mirror of its headline rates. */
const CUSTOMS_KEYS = Object.entries(CATALOG).filter(([, entry]) => entry.agency === "General Administration of Customs").map(([key]) => key);

/** "2026-09-09 09:30:00" in China Standard Time to a Date. */
function cstToDate(text: string): Date | null {
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?/);
  if (!match) return null;
  const [, y, mo, d, h = "9", mi = "30"] = match;
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h) - 8, Number(mi)));
}

/** The period a release publishes: the previous month, or the quarter that ended before it. */
/**
 * How long to wait before checking a release again, by attempt number, or null
 * when the window has been given up on. Every ten minutes for the first hour,
 * every half hour to the end of the day, then hourly, then every six hours out
 * to four days — the bureau allows itself about three working days for its
 * database to carry everything a release announced.
 */
export function releaseRetryDelayMs(attempt: number): number | null {
  if (attempt < 6) return 10 * 60 * 1000;
  if (attempt < 30) return 30 * 60 * 1000;
  if (attempt < 54) return 60 * 60 * 1000;
  if (attempt < 66) return 6 * 60 * 60 * 1000;
  return null;
}

/** The frequency of a curated key, for judging it against a release's targets. */
function frequencyOfKey(key: string): string {
  return CATALOG[key]?.frequency ?? "Monthly";
}

function nbsDate(date: Date, endOfDay = false): string {
  const day = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
  return `${day} ${endOfDay ? "23:59:59" : "00:00:00"}`;
}

/**
 * What the background crawl is doing, for /api/schedule. A run that has not
 * started and a run that started and found nothing looked identical from
 * outside, which is a bad way to operate something that takes days.
 */
let workerState: () => { running: { label: string; priority: number; startedAt: string } | null; queued: { label: string; priority: number; waitingMs: number }[] } = () => ({ running: null, queued: [] });

const crawlState: { scheduled: boolean; startedAt: string | null; finishedAt: string | null; running: boolean; lastTally: { ok: number; error: number; empty: number; remaining: number } | null; lastError: string | null } = {
  scheduled: false, startedAt: null, finishedAt: null, running: false, lastTally: null, lastError: null,
};

let scheduleStatus: () => { nextReleases: { en: string; at: string; keys: string[] }[]; lastReleaseRefresh: null | { en: string; at: string; attempts: number; advanced: number } } = () => ({ nextReleases: [], lastReleaseRefresh: null });

/**
 * The lines of a table the Home page actually draws, and no others.
 *
 * A Home row shows one line: the one its `line` names, or the table's first.
 * The payload used to carry every line of every table on the page — 250 lines
 * where 59 are drawn, because the manufacturing PMI's fourteen sub-indices and
 * the twelve retail categories travel whether or not a row names them. At six
 * years a line, that was half a megabyte of JSON on every visit to answer with
 * a few dozen sparklines.
 *
 * The first line is kept whenever a row does not name one (and for the hero
 * tiles, which always read it), so the client's `series[0]` still means what
 * it meant. A named line missing from the store is missing here too, which is
 * the same empty row it was before.
 */
function homeLines(entry: CatalogEntry, series: Series[]): Series[] {
  const rows = entry.homeRows ?? [];
  const named = new Set(rows.map((row) => row.line).filter((line): line is string => typeof line === "string"));
  const needsFirst = rows.length === 0 || rows.some((row) => !row.line) || HERO_KEYS.includes(entry.key);
  return series.filter((line, index) => (needsFirst && index === 0) || named.has(line.label));
}

/**
 * How many points of a series the Home page needs to show about six years:
 * seventy-two months, twenty-four quarters, or six years. Daily series are
 * capped at a readable number of trading days rather than 1,500.
 */
function homeWindow(frequency: string): number {
  if (frequency === "Annual") return 12;
  if (frequency === "Quarterly") return 24;
  if (frequency === "Daily") return 180;
  return 72;
}

/**
 * The health report, at most once a minute.
 *
 * It reads the whole audit and a window of the fetch log, and `bun:sqlite` is
 * synchronous: the work happens on the thread that serves every other request.
 * One reader refreshing the page, or one script polling it, should not be able
 * to decide how much of the server's time goes to answering it. A minute is
 * well inside how often anything here changes — the ingest runs daily and the
 * audit nightly — and it turns any amount of polling into one computation.
 */
// The province cards read a few hundred series for one page; they change
// once a day at most, so a request never pays for them more than once a minute.
let provinceCardsCache: { at: number; body: unknown } | null = null;
function cachedProvinceCards(): unknown {
  const now = Date.now();
  if (provinceCardsCache && now - provinceCardsCache.at < HEALTH_TTL_MS) return provinceCardsCache.body;
  const body = provinceCards();
  provinceCardsCache = { at: now, body };
  return body;
}

let healthCache: { at: number; body: unknown } | null = null;
const HEALTH_TTL_MS = 60_000;

function cachedHealthReport(): unknown {
  const now = Date.now();
  if (healthCache && now - healthCache.at < HEALTH_TTL_MS) return healthCache.body;
  const report = healthReport();
  const body = { ...report, headline: healthHeadline(report) };
  healthCache = { at: now, body };
  return body;
}

const bootAt = Date.now();
const readiness = createReadinessProbe(dbHealth);

const routes = {
    "/": index,
    // The default link-preview image (a real chart) for X, Slack and the like.
    "/og.png": () => new Response(Bun.file(new URL("../client/og.png", import.meta.url)), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" } }),
    // Keep /health compatible with existing monitors; both readiness routes require
    // a usable catalog and store. /live only says that the process answers HTTP.
    "/health": () => readiness.check(),
    "/ready": () => readiness.check(),
    "/live": () => Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } }),
    "/api/catalog": () => Response.json(catalogList()),
    // How each figure was made and how it reached the site: a section per path
    // the data takes, the site's own handling, and a section per curated key.
    "/api/methodology": () => Response.json(methodology(catalogList())),
    // What is wrong with the data right now: cross-checks that disagree,
    // sources that will not parse, series behind their cadence. All from the
    // store and the audit, so opening it costs a publisher nothing.
    "/api/health-report": () => Response.json(cachedHealthReport()),
    // A theme page: one story's charts, each read from the store by key,
    // region and line. Nothing here fetches.
    "/api/theme/:name": async (req: RouteRequest) => {
      const data = await themeData(req.params.name ?? "");
      if (!data) return Response.json({ error: "Unknown theme" }, { status: 404 });
      return jsonFor(req, data);
    },
    // One province across every series the site holds for it, read from the
    // store by the province's code; nothing here fetches.
    "/api/provinces": (req: RouteRequest) => jsonFor(req, cachedProvinceCards()),
    "/api/province/:code": async (req: RouteRequest) => {
      const code = req.params.code ?? "";
      const profile = await provinceProfile(code);
      if (!profile) return Response.json({ error: "Unknown province code" }, { status: 404 });
      return Response.json(profile);
    },
    // Every headline series at once for the Home page, in one round trip
    // instead of one request per indicator after the catalog.
    //
    // The window is a span of time, not a count of points. A fixed 24 points
    // meant a quarterly sparkline covered six years and a monthly one covered
    // two, drawn the same width on the same page, so their shapes could not be
    // read against each other and neither said what it covered. Each frequency
    // now reaches back about six years, and the page labels the span it drew.
    "/api/home": () => {
      const out: Record<string, unknown> = {};
      for (const entry of catalogList()) {
        if (entry.home === false) continue;
        const regions = seriesRegions(entry.key);
        // A series that names home regions (trade by partner: the US, the EU,
        // ASEAN) is one row per region, keyed key@region, in place of its default.
        const wanted = entry.homeRegions
          ? entry.homeRegions.map((code) => regions.find((item) => item.value === code)).filter((item): item is NonNullable<typeof item> => item !== undefined)
          : [regions.length > 0 ? (regions.find((item) => item.value === seriesRegion(entry.key)) ?? regions[0]) : undefined];
        for (const region of wanted) {
          const stored = onlyConfigured(entry.key, readSeries(entry.key, homeWindow(entry.frequency), region?.value));
          if (!stored || !stored.series.some((s) => s.points.length > 0)) continue;
          const series = homeLines(entry, stored.series);
          if (series.length === 0) continue;
          out[entry.homeRegions && region ? `${entry.key}@${region.value}` : entry.key] = { ...stored, series, region, source: "store", transform: "raw" };
        }
      }
      return Response.json(out);
    },
    "/api/catalog/stats": async () => Response.json(await nbsCatalogStats()),
    "/api/releases": async (req: RouteRequest) => {
      const params = new URL(req.url).searchParams;
      const now = new Date();
      // Default window: this month and next, so a series' next release is still in scope after
      // its last release of the month (CPI on the 9th has nothing left this month).
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);
      try {
        return Response.json(await fetchAgenda(agendaBound(params.get("start") ?? nbsDate(monthStart), false), agendaBound(params.get("end") ?? nbsDate(monthEnd, true), true)));
      } catch (error) {
        const message = error instanceof Error ? error.message : "NBS release calendar failed";
        return Response.json({ error: message }, { status: 502 });
      }
    },
    "/api/release-map": () => Response.json(RELEASE_MAP),
    // Every curated headline against an independent reading of the same
    // statistic, from the store (server/concordance.ts). A mismatch is a
    // mislabel or a documented difference; the nightly run logs them.
    "/api/audit/concordance": () => {
      const results = runConcordance();
      return Response.json({ ranAt: new Date().toISOString(), findings: results.filter((result) => result.status === "mismatch").length, results });
    },
    "/api/schedule": () => Response.json({ ...scheduleStatus(), crawl: crawlState, worker: workerState(), upstream: upstreamStats() }),
    // Every release-day check of the last two weeks, attempt by attempt, with what was still behind.
    "/api/release-checks": (req: RouteRequest) => {
      const days = Math.min(90, Math.max(1, Number(new URL(req.url).searchParams.get("days") ?? 14) || 14));
      return Response.json({ days, checks: recentReleaseChecks(days) });
    },
    // NBS press releases read in shadow mode (server/nbs-releases.ts): the
    // headline figures parsed from each release page and how they stand
    // against the store, when read and now. Nothing here is served as a series.
    "/api/press-releases": (req: RouteRequest) => {
      const limit = Math.min(100, Math.max(1, Number(new URL(req.url).searchParams.get("limit") ?? 24) || 24));
      return Response.json({ agency: "National Bureau of Statistics", mode: "shadow", releases: recentPressReleases(limit) });
    },
    // Every region of a multi-region series at once, for the map: the latest
    // value per region plus the periods available, all from the store.
    // Every place one series is published for, at one period: the tile map and
    // the ranking. Curated regional series and NBS regional tables alike, so a
    // provincial indicator from the catalog gets the same treatment as
    // provincial GDP.
    "/api/regional/:key": async (req: RouteRequest) => {
      const key = req.params.key;
      if (!key) return Response.json({ error: "Series key is required" }, { status: 400 });
      const entry = key.startsWith("nbs_") ? await getNbsCatalogEntry(key) : null;
      const regions = entry && entry.geography !== "National" ? await getNbsDimensions(entry) : seriesRegions(key);
      if (regions.length === 0) return Response.json({ error: "Not a regional series" }, { status: 404 });
      const geography = entry ? entry.geography : seriesGeography(key);
      const params = new URL(req.url).searchParams;
      const period = params.get("period") ?? "";
      // A series with several lines (exports, imports, balance) ranks by the
      // line asked for; the response names the lines so the page can offer them.
      const configured = entry ? null : configuredLabels(key);
      const labels = entry ? [] : configured && configured.length > 0 ? configured : (readSeries(key, 1, regions[0]?.value)?.series.map((line) => line.label) ?? []);
      const label = labels.find((name) => name === params.get("label")) ?? labels[0];
      const periods = new Set<string>();
      const values = regions.map((region) => {
        const stored = readSeries(key, 120, region.value);
        const points = (label ? stored?.series.find((line) => line.label === label) : stored?.series[0])?.points ?? [];
        for (const point of points) periods.add(point.date);
        const chosenIndex = period ? points.findIndex((point) => point.date === period) : points.length - 1;
        const chosen = chosenIndex >= 0 ? points[chosenIndex] : undefined;
        // The sparkline is the two years up to the chosen period, so picking 2020 shows the run into 2020.
        const window = chosenIndex >= 0 ? points.slice(0, chosenIndex + 1).slice(-8) : points.slice(-8);
        return { region, value: chosen?.value ?? null, period: chosen?.date ?? null, points: window };
      });
      const meta = readSeries(key, 1, regions[0]?.value);
      const stored = values.filter((item) => item.points.length > 0).length;
      // Opening the map is the signal that this series matters more than its
      // place in the crawl's queue. The missing places are fetched behind the
      // response, so the next visit is complete.
      if (entry && stored < values.length) {
        void fillRegionalSeries(key).catch(() => undefined);
      }
      return Response.json({
        key, geography,
        title: (entry ? entry.nameEn ?? entry.name : meta?.title) ?? key,
        unit: meta?.unit ?? entry?.unit ?? "",
        frequency: meta?.frequency ?? entry?.frequency ?? "",
        agency: meta?.agency ?? "National Bureau of Statistics",
        updatedAt: meta?.updatedAt ?? null,
        // A place with nothing stored yet is still listed, so the map shows a gap rather than dropping a province.
        stored,
        labels, label: label ?? null,
        periods: [...periods].sort().reverse(), values });
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
      const allTerms = normalizeQuery(queryText).split(/\s+/).filter(Boolean);
      // Function words and the country drop out ("exports to the united states"), unless that would leave nothing.
      const meaningful = allTerms.filter((term) => !SEARCH_STOP_WORDS.has(term));
      const queryTerms = meaningful.length > 0 ? meaningful : allTerms;
      const featured = queryText && datasetCode === undefined && (!geography || geography === "National")
        // Latin terms match at a word start ("unemp" finds unemployment, "ppi" no longer finds shopping); Chinese anywhere.
        ? matchCurated(catalogList().filter((entry) => (!frequency || entry.frequency === frequency) && (!category || entry.group === category)), allTerms, queryTerms).map((entry) => ({
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
      const nbs = await searchNbsCatalogWithPlaces({
        query: queryText,
        frequency,
        geography,
        datasetCode: datasetCode !== undefined && Number.isFinite(datasetCode) ? datasetCode : undefined,
        category,
        limit: Math.max(1, remainingLimit),
        offset: nbsOffset,
      });
      // A headline series leads the results, except where an NBS series is
      // exactly what was asked for: "birth rate" put the World Bank fertility
      // rate first, on the strength of "births" in its synonyms, above the
      // bureau's own birth rate.
      const nbsResults = nbs.results.slice(0, remainingLimit);
      const asked = queryText.trim().toLocaleLowerCase();
      // The bureau's own titles end in the unit ("Birth Rate(‰)"); the words before it are the title.
      const titleWords = (title: string) => title.toLocaleLowerCase().replace(/\s*[(（][^()（）]*[)）]\s*$/, "").trim();
      const exactIndex = asked ? nbsResults.findIndex((entry) => titleWords(entry.nameEn ?? "") === asked || titleWords(entry.glossEn ?? "") === asked) : -1;
      const exact = exactIndex >= 0 ? nbsResults.splice(exactIndex, 1) : [];
      return jsonFor(req, {
        total: featured.length + nbs.total,
        offset: requestedOffset,
        limit: requestedLimit,
        // Set when the query named a province or city: the results are that
        // place's series, and each carries the region to open at.
        place: nbs.place,
        results: [...exact, ...featuredResults, ...nbsResults],
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
    // A copy of the whole store, for whoever holds the token. The archive of
    // what the bureau published and when is the one thing here that cannot be
    // rebuilt from the source, and a mounted volume is not a backup. Off unless
    // BACKUP_TOKEN is set, so a deployment without one exposes nothing.
    "/api/backup": async (req: RouteRequest, server: { timeout(request: Request, seconds: number): void }) => {
      const token = process.env.BACKUP_TOKEN;
      if (!token) return new Response("Not found", { status: 404 });
      const offered = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? new URL(req.url).searchParams.get("token") ?? "";
      const expectedBytes = Buffer.from(token), offeredBytes = Buffer.from(offered);
      if (offeredBytes.length !== expectedBytes.length || !timingSafeEqual(offeredBytes, expectedBytes)) return new Response("Unauthorized", { status: 401 });
      // Snapshot validation can outlast an ordinary page request. The manager
      // enforces separate creation/download deadlines and one backup at a time.
      server.timeout(req, 0);
      return backups.createResponse(req.signal);
    },
    // Coverage and recent ingest runs — a stale chart should be diagnosable.
    // The coverage list is heavy; it comes only with ?series=1.
    "/api/status": async (req: RouteRequest) => {
      const params = new URL(req.url).searchParams;
      // Coverage is a page of the store's series, not all of them: there are
      // more than a hundred thousand once the regional tables are stored.
      const status = params.get("series") === "1"
        ? dbStatusWithSeries(Number(params.get("limit") ?? "2000"), Number(params.get("offset") ?? "0"))
        : dbStatus();
      // How much of the catalog is regional, and whether the places those
      // tables cover have been collected: a table with no region list is a
      // table the site cannot fetch.
      return Response.json({ ...status, regions: await regionCoverage() });
    },
    // When each period of a series arrived, and with which release. A period
    // first seen long after it closed came from a backfill, and says so
    // rather than borrowing a publication date it cannot know.
    "/api/arrivals/:key": (req: RouteRequest) => {
      const key = req.params.key;
      if (!key) return Response.json({ error: "Series key is required" }, { status: 400 });
      const url = new URL(req.url);
      const entry = CATALOG[key];
      const arrivals = arrivalsFor(key, {
        region: url.searchParams.get("region") ?? undefined,
        label: url.searchParams.get("label") ?? undefined,
        frequency: entry?.frequency,
        agency: entry?.agency,
        limit: Number(url.searchParams.get("limit") ?? "48"),
      });
      return Response.json({
        key, frequency: entry?.frequency ?? "", agency: entry?.agency ?? "",
        backfillNote: BEFORE_RELEASES_RECORDED,
        arrivals: arrivals.map((arrival) => ({ ...arrival, sentence: arrivalSentence(arrival) })),
      });
    },
    // Every release this site has recorded from the publishers' calendars.
    "/api/release-log": () => Response.json({ releases: storedReleases(Number(200)) }),
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
        // No region asked for: the entry's configured default (Guangdong for provincial GDP, the
        // 70-city average for home prices), not whichever region happens to be listed first.
        const requested = params.get("region") ?? seriesRegion(key);
        const region = regions.length > 0 ? (regions.find((item) => item.value === requested) ?? regions[0]) : undefined;
        const stored = onlyConfigured(key, readSeries(key, Number.isFinite(limit) ? limit : 120, region?.value));
        if (stored && stored.series.some((s) => s.points.length > 0)) {
          return Response.json({ ...applyTransform(stored, transform), region, source: "store" });
        }
        if (!SERVE_LIVE_FALLBACK) {
          return Response.json({ error: "Not yet ingested" }, { status: 503 });
        }
        const data = region ? await fetchLiveRegion(key, region, Number.isFinite(limit) ? limit : 120) : await getSeries(key, Number.isFinite(limit) ? limit : 120);
        if (!data) return Response.json({ error: "Unknown series" }, { status: 404 });
        return Response.json({ ...applyTransform(data, transform), region, source: "live" });
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
if (process.env.BACKUP_TOKEN) {
  void backups.cleanupStale().catch((error) => console.error("  Backup temporary-file cleanup failed:", error instanceof Error ? error.message : String(error)));
}
// Warm the catalog, gloss and search index now rather than on the first visitor; the
// healthcheck waits for it so the previous container keeps serving meanwhile.
void readiness.warm(async () => {
  const catalog = await nbsCatalogStats();
  if (catalog.seriesCount === 0) throw new Error("NBS catalog contains no usable series");
  await warmSearchIndex();
}).then(() => {
  console.log(`  Catalog warm in ${((Date.now() - bootAt) / 1000).toFixed(1)}s`);
}).catch((error) => {
  console.error("  Readiness warmup failed; this deployment remains unavailable:", error instanceof Error ? error.message : String(error));
});

// On a single-service deployment the daily refresh runs in this process: a
// separate cron cannot share the volume the store lives on. Off in
// development unless asked for; every 24 hours in production by default.
const ingestEveryHours = Number(process.env.INGEST_EVERY_HOURS ?? (process.env.NODE_ENV === "production" ? 24 : 0));
if (ingestEveryHours > 0) {
  // One job at a time against the bureau's portal, most urgent first. A release
  // check jumps the queue and the crawl yields to it between table requests.
  const worker = createWorker();
  workerState = () => worker.state();
  let ingesting = false;
  const tick = async () => {
    if (ingesting) return;
    ingesting = true;
    const started = Date.now();
    try {
      await worker.run("Scheduled ingest", PRIORITY.catchUp, async () => {
        const tally = await runIngest();
        console.log(`  Scheduled ingest: ${tally.ok} ok, ${tally.error} failed, ${tally.empty} empty in ${Math.round((Date.now() - started) / 1000)}s`);
      });
      recordRun("ingest");
    } catch (error) {
      console.error("  Scheduled ingest failed:", error instanceof Error ? error.message : String(error));
    } finally {
      ingesting = false;
    }
  };
  // The ingest's clock is in the store, not in this process. A boot used to
  // run a full ingest two minutes in and restart the 24 hours, so a day of
  // deploys was a day of full sweeps against every publisher. Now the full
  // ingest waits out its period from the last one that finished, and a boot
  // fetches only the curated keys the store has never held (a series the
  // deploy just added).
  const ingestPeriodMs = ingestEveryHours * 60 * 60 * 1000;
  const scheduleIngest = (delayMs: number) => {
    setTimeout(() => { void tick().finally(() => scheduleIngest(ingestPeriodMs)); }, delayMs);
  };
  const firstIngestMs = delayUntilDue(lastRun("ingest"), ingestPeriodMs, 2 * 60 * 1000);
  scheduleIngest(firstIngestMs);
  console.log(`  Ingest scheduled every ${ingestEveryHours}h (next full run in ${Math.round(firstIngestMs / 60000)} minutes)`);
  setTimeout(() => {
    const stored = new Set(storedLatest("").map((row) => row.key));
    const unstored = catalogList().map((entry) => entry.key).filter((key) => !stored.has(key));
    if (unstored.length === 0) return;
    void worker.run("New series", PRIORITY.catchUp, async () => {
      const tally = await runIngest(unstored);
      console.log(`  New series (${unstored.join(", ")}): ${tally.ok} ok, ${tally.error} failed`);
    }).catch((error) => console.error("  New series ingest failed:", error instanceof Error ? error.message : String(error)));
  }, 2 * 60 * 1000);

  // Release days. NBS publishes on a fixed agenda (09:30 and 10:00 CST, mostly),
  // PBOC and Customs in the afternoon. Three things make the site current
  // within minutes rather than a day: a refresh ten minutes after each
  // scheduled NBS release, aimed at the series that release updates and
  // retried every fifteen minutes until the new period shows; fixed sweeps
  // of the headline series at the usual publication hours; and the daily
  // due-check above as the backstop.
  const headlineKeys = catalogList().map((entry) => entry.key);
  const scheduled = new Set<string>();
  const status = { nextReleases: [] as { en: string; at: string; keys: string[] }[], lastReleaseRefresh: lastReleaseRefresh() };
  const runWhenFree = async (job: () => Promise<void>, label: string): Promise<void> => {
    try { await worker.run(label, PRIORITY.release, job); }
    catch (error) { console.error(`  ${label} failed:`, error instanceof Error ? error.message : String(error)); }
  };
  // A release job is in the store from the moment its first attempt is
  // planned until it is complete or given up, so a restart inside the
  // bureau's three-day loading window picks up the retries where they were.
  const releaseJobId = (item: AgendaItem) => `release:${item._id}`;
  const scheduleReleaseAttempt = (item: AgendaItem, attempt: number, at: number) => {
    scheduleJob({ id: releaseJobId(item), kind: "release", payload: item, attempt, nextAt: at });
    setTimeout(() => { void releaseRefresh(item, attempt); }, Math.max(0, at - Date.now()));
  };
  const releaseRefresh = async (item: AgendaItem, attempt: number) => {
    const startedAt = new Date().toISOString();
    const at = cstToDate(item.fb_time) ?? new Date();
    const targets = releaseTargets({ title: item.content, keys: item.keys, categories: item.categories }, at);
    const covered = () => storedLatest("").filter((row) => item.keys.includes(row.key))
      .map((row) => ({ key: row.key, region: row.region, frequency: frequencyOfKey(row.key), lastPeriod: row.lastPeriod }));
    await runWhenFree(async () => {
      if (item.keys.length > 0) await runIngest(item.keys);
      const catalog = item.categories.length > 0
        ? await refreshCatalogForRelease(item.categories, targets)
        : { advanced: 0, checked: 0, requests: 0, pending: 0 };
      const after = covered();
      const behind = pendingSeries(targets, after);
      // Finished when every series this release covers holds the period it
      // reports, and every catalog series it touched did too. One series
      // arriving early used to end the retries for all the others.
      const done = behind.length === 0 && catalog.pending === 0 && (after.length > 0 || catalog.checked > 0);
      status.lastReleaseRefresh = { en: item.en || item.content, at: new Date().toISOString(), attempts: attempt, advanced: catalog.advanced + (after.length - behind.length) };
      // One row per attempt naming what was still missing, so a release that
      // lands days late can be read back as "NBS had not loaded it" or "we
      // did not ask" (/api/release-checks).
      const missing = behind.map((series) => (series.region ? `${series.key}@${series.region}` : series.key));
      logFetch({
        key: "release_attempt", region: item._id, startedAt, finishedAt: status.lastReleaseRefresh.at, status: "ok",
        points: after.length - behind.length, changed: attempt,
        message: `${item.en || item.content}: ${done ? "complete" : `behind ${missing.join(", ") || "none"}${catalog.pending > 0 ? `; ${catalog.pending} catalog series pending` : ""}`}`,
      });
      logFetch({ key: "release_refresh", region: "", startedAt, finishedAt: status.lastReleaseRefresh.at, status: "ok", points: catalog.advanced, changed: attempt, message: item.en || item.content });
      const periods = targets.map((target: ReleaseTarget) => `${target.frequency.toLowerCase()} ${target.period}`).join(" and ");
      console.log(`  Release refresh (${item.en || item.content}, attempt ${attempt}): ${after.length - behind.length}/${after.length} headline and ${catalog.advanced}/${catalog.checked} catalog series hold ${periods}${done ? "" : `; ${behind.length + catalog.pending} still behind`}`);
      if (done) { settleJob(releaseJobId(item), "done"); return; }
      // The bureau gives itself about three working days for every short-term
      // indicator to reach its database, so a release that has not arrived is
      // normally late rather than lost. Check often at first, then back off,
      // and keep checking across that window instead of giving up after three
      // hours.
      const wait = releaseRetryDelayMs(attempt);
      if (wait === null) {
        console.log(`  Release refresh (${item.en || item.content}): still incomplete after ${attempt} attempts; leaving it to the due check`);
        settleJob(releaseJobId(item), "abandoned");
        return;
      }
      scheduleReleaseAttempt(item, attempt + 1, Date.now() + wait);
    }, "Release refresh");
    // The release page is on www.stats.gov.cn at the release time, often days
    // before the bureau's database has the figures. Read it in shadow mode
    // after each attempt for an NBS item (Customs items share this agenda),
    // once per attempt, through the same worker so it never runs beside
    // another job. It fetches the listing and only pages not yet read.
    if (!CUSTOMS_KEYS.includes(item.keys[0] ?? "")) await runPressReleaseCheck();
  };
  // Mid-month, six or more NBS items share one release time and each attempt
  // would fetch the listing again within seconds. Nothing new can appear on
  // it that fast, so a check within ten minutes of the last one is skipped.
  let lastPressReleaseCheckAt = 0;
  const runPressReleaseCheck = async () => {
    if (Date.now() - lastPressReleaseCheckAt < 10 * 60 * 1000) return;
    lastPressReleaseCheckAt = Date.now();
    await runWhenFree(async () => {
      const tally = await checkPressReleases();
      console.log(`  Press releases (shadow): ${tally.relevant} of ${tally.listed} listed are read here; ${tally.read} new read, ${tally.failed} refused, ${tally.unreachable} could not be fetched, ${tally.givenUp} given up, ${tally.waiting} refused earlier and waiting a day, ${tally.retriedUnlisted} no longer listed retried`);
    }, "Press release check");
  };
  const planReleases = async () => {
    try {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 2, 0);
      const agenda = await fetchAgenda(nbsDate(start), nbsDate(end, true));
      status.nextReleases = [];
      for (const item of agenda.data) {
        const at = cstToDate(item.fb_time);
        if (!at || (item.keys.length === 0 && item.categories.length === 0)) continue;
        const fireAt = at.getTime() + 10 * 60 * 1000;
        if (fireAt < Date.now() - 60 * 60 * 1000) continue; // already past
        status.nextReleases.push({ en: item.en || item.content, at: at.toISOString(), keys: item.keys });
        if (scheduled.has(item._id) || fireAt - Date.now() > 8 * 24 * 60 * 60 * 1000) continue;
        scheduled.add(item._id);
        scheduleReleaseAttempt(item, 1, fireAt);
      }
      status.nextReleases.sort((a, b) => a.at.localeCompare(b.at));
      console.log(`  Release plan: ${status.nextReleases.length} upcoming releases, ${scheduled.size} scheduled`);
    } catch (error) {
      console.error("  Release plan failed:", error instanceof Error ? error.message : String(error));
    }
  };
  // Releases a previous process was still retrying, at the attempt they were
  // on. Marked scheduled first so the plan below does not start them over.
  const resumed = pendingJobs<AgendaItem>("release");
  for (const job of resumed) {
    scheduled.add(job.payload._id);
    setTimeout(() => { void releaseRefresh(job.payload, job.attempt); }, Math.max(60 * 1000, job.nextAt - Date.now()));
  }
  if (resumed.length > 0) console.log(`  Release refresh: resumed ${resumed.length} release${resumed.length === 1 ? "" : "s"} from the store`);
  pruneSettledJobs();
  setTimeout(() => { void planReleases(); }, 60 * 1000);
  setInterval(() => { void planReleases(); }, 6 * 60 * 60 * 1000);

  // The concordance audit, nightly and once after boot. Store reads only; each
  // finding goes to fetch_log under the key "concordance" so it outlives the
  // process log and the CLI (china:audit) shows the same thing.
  const audit = () => {
    const startedAt = new Date().toISOString();
    try {
      const results = runConcordance();
      const findings = results.filter((result) => result.status === "mismatch");
      for (const result of findings) console.warn(`  Concordance: ${formatResult(result)}`);
      console.log(`  Concordance: ${results.length} pairs, ${findings.length} findings`);
      for (const result of results) {
        if (result.status === "ok") continue;
        logFetch({ key: "concordance", region: result.name, startedAt, finishedAt: new Date().toISOString(), status: result.status === "mismatch" ? "error" : "empty", points: result.compared, changed: result.disagreements.length, message: formatResult(result) });
      }
    } catch (error) {
      console.error("  Concordance audit failed:", error instanceof Error ? error.message : String(error));
    }
  };
  setTimeout(audit, 5 * 60 * 1000);
  setInterval(audit, 24 * 60 * 60 * 1000);

  // Fixed sweeps of the headline series at the usual publication hours (UTC).
  // 10:10, 11:10 and 16:10 Beijing time, and 18:40 for the central bank's
  // late-afternoon releases, which otherwise waited for the next morning.
  const sweepTimes: [number, number][] = [[2, 10], [3, 10], [8, 10], [10, 40]];
  const scheduleSweep = () => {
    const now = new Date();
    const today = (hour: number, minute: number) => Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute);
    const candidates = sweepTimes.flatMap(([hour, minute]) => [today(hour, minute), today(hour, minute) + 24 * 60 * 60 * 1000]);
    const next = Math.min(...candidates.filter((t) => t > now.getTime()));
    setTimeout(() => { void runWhenFree(async () => { const tally = await runIngest(headlineKeys); console.log(`  Headline sweep: ${tally.ok} ok, ${tally.error} failed`); }, "Headline sweep").then(scheduleSweep); }, next - now.getTime());
  };
  scheduleSweep();

  // Publishers with no calendar (PBOC, MOF, SAFE, MOFCOM, NEA): inside each
  // one's usual stretch of the month, an hourly check of the series still
  // one month behind. See release-windows.ts.
  const windowStatus = { lastCheck: null as null | { at: string; checked: string[]; arrived: string[] } };
  const latestPeriods = (keys: string[]) => {
    const latest = new Map<string, string>();
    for (const row of storedLatest("")) if (keys.includes(row.key) && row.lastPeriod && row.lastPeriod > (latest.get(row.key) ?? "")) latest.set(row.key, row.lastPeriod);
    return latest;
  };
  const checkPublisherWindows = async () => {
    const series = catalogList().map((entry) => ({ key: entry.key, agency: entry.agency, frequency: entry.frequency, ...(entry.ended ? { ended: entry.ended } : {}) }));
    const keys = keysAwaitingRelease(series, storedLatest("").map((row) => ({ key: row.key, lastPeriod: row.lastPeriod })), new Date());
    if (keys.length === 0) return;
    await runWhenFree(async () => {
      const startedAt = new Date().toISOString();
      const before = latestPeriods(keys);
      await runIngest(keys);
      const after = latestPeriods(keys);
      const arrived = keys.filter((key) => (after.get(key) ?? "") > (before.get(key) ?? ""));
      const finishedAt = new Date().toISOString();
      windowStatus.lastCheck = { at: finishedAt, checked: keys, arrived };
      logFetch({ key: "publisher_window", region: "", startedAt, finishedAt, status: "ok", points: arrived.length, changed: keys.length, message: `checked ${keys.join(", ")}; arrived ${arrived.join(", ") || "none"}` });
      console.log(`  Publisher window: checked ${keys.length}, arrived ${arrived.length}${arrived.length > 0 ? ` (${arrived.join(", ")})` : ""}`);
    }, "Publisher window");
  };
  setTimeout(() => { void checkPublisherWindows(); }, 4 * 60 * 1000);
  setInterval(() => { void checkPublisherWindows(); }, 60 * 60 * 1000);

  scheduleStatus = () => ({
    ...status,
    publisherWindows: { open: activeWindows(new Date()).map((window) => window.agency), windows: PUBLISHER_WINDOWS, lastCheck: windowStatus.lastCheck },
  });

  // The catalog crawl fills in series nobody has opened: a budget of series
  // every few hours until the whole catalog is stored, then a no-op. It
  // shares the running flag with the ingest so the two never overlap.
  // Batched by table, a whole-catalog run is a few hundred requests spread over a couple of hours.
  const crawlBudget = Number(process.env.CRAWL_PER_RUN ?? 20000);
  const crawlEveryHours = Number(process.env.CRAWL_EVERY_HOURS ?? 6);
  if (process.env.CATALOG_CRAWL !== "off" && crawlBudget > 0) {
    const crawl = async () => {
      if (crawlState.running) return;
      crawlState.running = true;
      crawlState.startedAt = new Date().toISOString();
      const started = Date.now();
      let yielded = false;
      try {
        await worker.run("Catalog crawl", PRIORITY.backfill, async () => {
          const tally = await runCatalogCrawl(crawlBudget, { shouldYield: () => worker.shouldYield(PRIORITY.backfill) });
          crawlState.lastTally = tally;
          crawlState.lastError = null;
          yielded = tally.ok + tally.error + tally.empty < crawlBudget && tally.remaining > 0;
          if (tally.ok + tally.error + tally.empty > 0) console.log(`  Catalog crawl: ${tally.ok} ok, ${tally.error} failed, ${tally.empty} empty, ${tally.remaining} remaining, ${Math.round((Date.now() - started) / 1000)}s`);
        });
      } catch (error) {
        crawlState.lastError = error instanceof Error ? error.message : String(error);
        console.error("  Catalog crawl failed:", crawlState.lastError);
      } finally {
        crawlState.running = false;
        crawlState.finishedAt = new Date().toISOString();
      }
      // A run that stopped short to let a release through picks up again
      // shortly rather than waiting for the next six-hourly turn.
      if (yielded) setTimeout(crawl, 10 * 60 * 1000);
    };

    // A restart cancels whatever the crawl was doing and the timer starts
    // again, so a day of deployments can mean a day of no crawling. Three
    // minutes is long enough for the boot ingest to get going and short enough
    // that a deployment costs almost nothing.
    const firstRunMinutes = Number(process.env.CRAWL_FIRST_RUN_MINUTES ?? 3);
    setTimeout(crawl, firstRunMinutes * 60 * 1000);
    setInterval(crawl, crawlEveryHours * 60 * 60 * 1000);
    crawlState.scheduled = true;
    console.log(`  Catalog crawl scheduled: ${crawlBudget} series every ${crawlEveryHours}h (first run in ${firstRunMinutes} minutes)`);
  }
}
