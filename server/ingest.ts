/**
 * Ingest job for the China Data Explorer.
 *
 * Walks the catalog, fetches each series from its upstream source, and stores
 * the result. Run it on a schedule (daily is generous — Chinese macro is
 * monthly or quarterly) and the web app never has to touch a foreign portal
 * during a page load.
 *
 *   bun run ingest                        # curated + every stored catalog series
 *   bun run ingest cpi gdp                # named curated series only
 *   bun run ingest nbs_<id>@440000000000  # one catalog series, one region
 *
 * Failures are per-series and recorded, not fatal. If AKTools is not running,
 * the AkShare series fail and the rest still land. A deployment that has said
 * it has none (AKTOOLS_URL=off) skips them instead of logging a failure.
 */

import { CATALOG, aktoolsConfigured, fetchLive, fetchLiveRegion, seriesRegion, seriesRegions, type SeriesResult } from "./data.ts";
import { db, writeSeries, logFetch, dbStatus, latestByRegion, listStoredSeries, recentlyEmptyTargets, retractUnpublished, storedLatest, storedValue } from "./db.ts";
import { NBS_BATCH_SIZE, fetchNbsTableBatch, getNbsCatalogEntry, getNbsDimensions, listNbsCatalogEntries, refreshNbsCatalogSeries, storeNbsPoints, type FetchWindow, type NbsCatalogEntry } from "./nbs-catalog.ts";
import { comparablePeriod, dueReason } from "./due.ts";
import type { ReleaseTarget } from "./release-plan.ts";

// Upstream sources are public and unauthenticated, so we stay well-mannered:
// one series at a time with a pause between, rather than a burst of parallel
// requests at a government portal.
const PAUSE_MS = Number(process.env.INGEST_PAUSE_MS ?? 1500);
const HISTORY_LIMIT = Number(process.env.INGEST_LIMIT ?? 240);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One region of a multi-region curated series, keyed by its NBS code. */
async function ingestRegion(key: string, region: { text: string; value: string }, oldestStored: string | null = null): Promise<"ok" | "error" | "empty"> {
  const startedAt = new Date().toISOString();
  const label = `${key}@${region.value}`;
  try {
    const result = await fetchLiveRegion(key, region, HISTORY_LIMIT, { oldestStored });
    const finishedAt = new Date().toISOString();
    if (!result || result.series.every((s) => s.points.length === 0)) {
      logFetch({ key, region: region.value, startedAt, finishedAt, status: "empty", points: 0, changed: 0, message: "source returned no points" });
      console.log(`  ${label.padEnd(36)} ${region.text.padEnd(8)} empty`);
      return "empty";
    }
    if (isZeroedFetch(result, region.value)) {
      const message = "every series read 0 where the store holds a value; treated as a bad response from the mirror";
      logFetch({ key, region: region.value, startedAt, finishedAt, status: "error", points: 0, changed: 0, message });
      console.log(`  ${label.padEnd(36)} REJECTED  ${message}`);
      return "error";
    }
    const summary = writeSeries(result, region.value, finishedAt);
    // A period the source publishes no figure for, where the store holds one, is retracted as a null revision.
    const retracted = result.unpublished ? retractUnpublished(key, region.value, result.unpublished, finishedAt) : 0;
    logFetch({ key, region: region.value, startedAt, finishedAt, status: "ok", points: summary.points, changed: summary.changed + retracted });
    console.log(`  ${label.padEnd(36)} ${region.text.padEnd(8)} ${String(summary.points).padStart(4)} points, ${summary.changed} new or revised${retracted > 0 ? `, ${retracted} retracted` : ""}`);
    return "ok";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logFetch({ key, region: region.value, startedAt, finishedAt: new Date().toISOString(), status: "error", points: 0, changed: 0, message });
    console.log(`  ${label.padEnd(36)} ${region.text.padEnd(8)} FAILED  ${message}`);
    return "error";
  }
}

/**
 * A mirror glitch, not a revision: every label's newest reading is exactly 0 where the store
 * already holds a non-zero value for that same period. Eastmoney served M1 and M2 as 0.0 for
 * July 2026 at 09:02 on 10 September 2026 and the real 4.0 and 7.7 ten minutes later, and the
 * append-only store recorded the zeros as a vintage. Such a fetch is rejected and logged as an
 * error, so the next run retries and a source that really did publish zeros keeps failing
 * visibly rather than quietly rewriting the archive.
 */
export function isZeroedFetch(result: SeriesResult, region: string, stored = storedValue): boolean {
  const newest = result.series
    .map((series) => series.points[series.points.length - 1])
    .filter((point): point is { date: string; value: number } => point !== undefined);
  if (newest.length === 0 || !newest.every((point) => point.value === 0)) return false;
  return result.series.every((series, index) => {
    const point = newest[index];
    const previous = point ? stored(result.key, region, series.label, point.date) : null;
    return previous !== null && previous !== 0;
  });
}

async function ingestOne(key: string): Promise<"ok" | "error" | "empty"> {
  const startedAt = new Date().toISOString();

  try {
    const lastStored = storedLatest(key).find((row) => row.key === key && row.region === seriesRegion(key))?.lastPeriod ?? null;
    const result = await fetchLive(key, HISTORY_LIMIT, { lastStored });
    const finishedAt = new Date().toISOString();

    if (!result || result.series.every((s) => s.points.length === 0)) {
      logFetch({ key, startedAt, finishedAt, status: "empty", points: 0, changed: 0,
        message: "source returned no points" });
      console.log(`  ${key.padEnd(22)} empty`);
      return "empty";
    }

    const region = seriesRegion(key);
    if (isZeroedFetch(result, region)) {
      const message = "every series read 0 where the store holds a value; treated as a bad response from the mirror";
      logFetch({ key, region, startedAt, finishedAt, status: "error", points: 0, changed: 0, message });
      console.log(`  ${key.padEnd(22)} REJECTED  ${message}`);
      return "error";
    }

    const summary = writeSeries(result, region, finishedAt);
    logFetch({ key, startedAt, finishedAt, status: "ok",
      points: summary.points, changed: summary.changed });
    console.log(
      `  ${key.padEnd(22)} ${String(summary.points).padStart(4)} points, ` +
      `${summary.changed} new or revised`,
    );
    return "ok";
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : String(error);
    logFetch({ key, startedAt, finishedAt, status: "error", points: 0, changed: 0, message });
    console.log(`  ${key.padEnd(22)} FAILED  ${message}`);
    return "error";
  }
}

/**
 * One catalog series in one region. Logging happens inside the refresh, so a
 * failure here is already in fetch_log by the time it is printed.
 */
async function refreshOne(key: string, region: string): Promise<"ok" | "error" | "empty"> {
  const label = region ? `${key}@${region}` : key;
  const entry = await getNbsCatalogEntry(key);
  if (!entry) {
    console.log(`  ${label.padEnd(52)} not in the catalog snapshot`);
    return "error";
  }
  try {
    const result = await refreshNbsCatalogSeries(entry, region || undefined);
    console.log(
      `  ${label.padEnd(52)} ${String(result.points.length).padStart(4)} points, ` +
      `${result.changed} new or revised`,
    );
    return "ok";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  ${label.padEnd(52)} FAILED  ${message}`);
    return "error";
  }
}

/** Stored catalog series whose next period should be out, or that have not been checked in 45 days. */
async function dueCatalogTargets(now = new Date()): Promise<{ key: string; region: string; reason: "new-period" | "revision" }[]> {
  const rows = storedLatest("nbs_");
  const targets: { key: string; region: string; reason: "new-period" | "revision" }[] = [];
  for (const [index, row] of rows.entries()) {
    // Fifteen thousand rows of synchronous lookups held the event loop for
    // about eight seconds at the start of every ingest, so page requests
    // stalled; yielding every few hundred rows lets them interleave.
    if (index > 0 && index % 500 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    const entry = await getNbsCatalogEntry(row.key);
    if (!entry) continue;
    const reason = dueReason(entry.frequency, row.lastPeriod, row.updatedAt, now, undefined, row);
    if (reason) targets.push({ key: row.key, region: row.region, reason });
  }
  return targets;
}

const CRAWL_PAUSE_MS = Number(process.env.CRAWL_PAUSE_MS ?? 1200);
const NATIONAL_REGION = { text: "全国", value: "000000000000" };

/**
 * The bureau's own ordering of its subject headings, as the portal's menu
 * lists them. The catalog snapshot is sorted by name, so without this the
 * crawl would work through a hundred thousand regional series in alphabetical
 * order of Chinese title, and the first day of fetching would be spent on
 * whatever happens to sort early rather than on output, prices and population.
 */
const CATEGORY_ORDER = [
  "综合", "国民经济核算", "人口", "就业人员和工资", "固定资产投资和房地产", "固定资产投资 (不含农户)",
  "房地产", "对外经济贸易", "对外经济", "能源", "财政", "金融", "价格指数", "人民生活", "城市概况",
  "资源和环境", "农业", "工业", "建筑业", "运输和邮电", "交通运输", "邮电通信",
  "社会消费品零售总额", "国内贸易", "批发和零售业", "住宿和餐饮业", "旅游业",
  "教育", "科技", "卫生", "社会服务", "文化", "体育", "公共管理、社会保障及其他",
];

function categoryRank(entry: NbsCatalogEntry): number {
  const at = CATEGORY_ORDER.indexOf(entry.categories[0] ?? "");
  return at < 0 ? CATEGORY_ORDER.length : at;
}

/** One thing the crawl can fetch: an indicator, in one place. */
interface CrawlTarget { entry: NbsCatalogEntry; region: { text: string; value: string } }

/**
 * Everything in the catalog the store does not hold yet, as (indicator, place)
 * pairs. A national series is one target; a provincial series is one per
 * province, because the bureau answers for a single place per request.
 *
 * Regional targets come after national ones so that a run always finishes the
 * cheaper, more-read national catalog first, and the order within a dataset is
 * table by table: the same forty indicators are then asked for across each
 * place in turn, which is one request per place rather than per series.
 */
async function catalogTargets(budget: number): Promise<{ targets: CrawlTarget[]; remaining: number }> {
  const stored = new Set(listStoredSeries("nbs_").map((row) => `${row.key}@${row.region}`));
  // NBS's index tree lists indicators it no longer publishes (whole blocks of
  // tax lines by industry return nothing). Once a pair has come back empty it
  // waits a month before another try.
  const empty = recentlyEmptyTargets("nbs_", 30);
  const entries = await listNbsCatalogEntries();
  const national: CrawlTarget[] = [];
  const regional: CrawlTarget[] = [];
  let remaining = 0;

  for (const [index, entry] of entries.entries()) {
    // Fifteen thousand synchronous iterations hold the event loop; yield
    // often enough that page requests still get served during a crawl.
    if (index > 0 && index % 500 === 0) await sleep(0);
    if (entry.geography === "National") {
      if (stored.has(`${entry.key}@${NATIONAL_REGION.value}`) || empty.has(`${entry.key}@${NATIONAL_REGION.value}`)) continue;
      remaining += 1;
      if (national.length < budget) national.push({ entry, region: NATIONAL_REGION });
      continue;
    }
    // Cached per table, so this is one lookup per table rather than per series,
    // and offline: selection must not wait on the portal.
    const regions = await getNbsDimensions(entry, { offline: true });
    for (const region of regions) {
      if (stored.has(`${entry.key}@${region.value}`) || empty.has(`${entry.key}@${region.value}`)) continue;
      remaining += 1;
      // Every outstanding regional target is collected before any is chosen,
      // because the choice is by subject and the catalog is sorted by name.
      regional.push({ entry, region });
    }
  }
  // Regional targets are fetched in the bureau's own order of subjects, and
  // within a subject table by table, so each place gets its headline series
  // before the crawl reaches the long tail.
  regional.sort((a, b) => categoryRank(a.entry) - categoryRank(b.entry));
  return { targets: [...national, ...regional].slice(0, budget), remaining };
}

/**
 * Fill the store with catalog series nobody has opened yet. Indicators are
 * grouped by table and place and fetched `NBS_BATCH_SIZE` at a time in one
 * request each, paced, up to `budget` indicators per run. Five failed requests
 * in a row pause the run for ten minutes; twenty end it. Returns what was done
 * and how many indicator-places remain.
 */
export async function runCatalogCrawl(budget: number, options: { shouldYield?: () => boolean } = {}): Promise<{ ok: number; error: number; empty: number; remaining: number }> {
  db();
  console.log("\nChoosing what to crawl...");
  const chooseStarted = Date.now();
  const { targets, remaining } = await catalogTargets(budget);
  console.log(`  ${targets.length} targets chosen from ${remaining} outstanding in ${((Date.now() - chooseStarted) / 1000).toFixed(1)}s`);
  const tally = { ok: 0, error: 0, empty: 0, remaining };
  if (targets.length === 0) return tally;

  // Same table, same frequency, same place: one request per chunk.
  const tables = new Map<string, CrawlTarget[]>();
  for (const target of targets) {
    const tableKey = `${target.entry.cid}|${target.entry.rootId}|${target.entry.frequency}|${target.region.value}`;
    tables.set(tableKey, [...(tables.get(tableKey) ?? []), target]);
  }
  const chunks: CrawlTarget[][] = [];
  for (const group of tables.values()) for (let at = 0; at < group.length; at += NBS_BATCH_SIZE) chunks.push(group.slice(at, at + NBS_BATCH_SIZE));
  console.log(`\nCrawling ${targets.length} of ${remaining} catalog series not yet stored, in ${chunks.length} table requests\n`);

  let consecutiveFailures = 0;
  for (const [index, chunk] of chunks.entries()) {
    // Between table requests, never inside one: a release check waiting behind
    // a crawl of a hundred thousand series should not wait for all of it. What
    // is stored is skipped next time, so stopping here loses nothing.
    if (options.shouldYield?.()) {
      console.log(`  Yielding after ${index} of ${chunks.length} table requests; more urgent work is waiting`);
      break;
    }
    const startedAt = new Date().toISOString();
    const region = chunk[0]?.region ?? NATIONAL_REGION;
    try {
      const points = await fetchNbsTableBatch(chunk.map((target) => target.entry), region);
      let okHere = 0;
      for (const target of chunk) {
        const outcome = storeNbsPoints(target.entry, region, points.get(target.entry.id) ?? [], startedAt);
        tally[outcome] += 1;
        tally.remaining -= 1;
        if (outcome === "ok") okHere += 1;
      }
      consecutiveFailures = 0;
      const where = region.value === NATIONAL_REGION.value ? "" : ` ${region.text}`;
      console.log(`  ${String(index + 1).padStart(4)}/${chunks.length}  ${((chunk[0]?.entry.categories.slice(-1)[0] ?? "") + where).slice(0, 44).padEnd(44)} ${okHere}/${chunk.length} with data`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const target of chunk) logFetch({ key: target.entry.key, region: region.value, startedAt, finishedAt: new Date().toISOString(), status: "error", points: 0, changed: 0, message });
      tally.error += chunk.length;
      consecutiveFailures += 1;
      console.log(`  ${String(index + 1).padStart(4)}/${chunks.length}  FAILED  ${message.slice(0, 80)}`);
      if (consecutiveFailures >= 20) { console.log("  Twenty failed requests in a row; ending this crawl run."); break; }
      if (consecutiveFailures === 5) { console.log("  Five failed requests in a row; pausing ten minutes."); await sleep(10 * 60 * 1000); }
    }
    if (index < chunks.length - 1) await sleep(CRAWL_PAUSE_MS);
  }
  console.log(`\nCrawl: ${tally.ok} ok, ${tally.empty} empty, ${tally.error} failed, ${tally.remaining} still to fetch`);
  return tally;
}

/**
 * Fetch the places of one regional series that the store does not hold yet.
 *
 * The crawl works through the whole catalog in the bureau's subject order, so
 * a series someone opens today may not be reached for days. Opening its map is
 * a signal that this one matters: the missing places are fetched in the
 * background, paced like the crawl, and the page fills in for the next visitor.
 * One series at a time, and never the same series twice at once.
 */
const fillingRegions = new Set<string>();
export async function fillRegionalSeries(key: string, limit = 40): Promise<{ fetched: number; failed: number }> {
  const tally = { fetched: 0, failed: 0 };
  if (fillingRegions.has(key) || fillingRegions.size > 0) return tally;
  const entry = await getNbsCatalogEntry(key);
  if (!entry || entry.geography === "National") return tally;
  fillingRegions.add(key);
  try {
    const stored = new Set(listStoredSeries(key).filter((row) => row.key === key).map((row) => row.region));
    const empty = recentlyEmptyTargets(key, 30);
    const missing = (await getNbsDimensions(entry))
      .filter((region) => !stored.has(region.value) && !empty.has(`${key}@${region.value}`))
      .slice(0, limit);
    for (const [index, region] of missing.entries()) {
      const startedAt = new Date().toISOString();
      try {
        const points = await fetchNbsTableBatch([entry], region);
        if (storeNbsPoints(entry, region, points.get(entry.id) ?? [], startedAt) === "ok") tally.fetched += 1;
      } catch (error) {
        logFetch({ key, region: region.value, startedAt, finishedAt: new Date().toISOString(), status: "error", points: 0, changed: 0, message: error instanceof Error ? error.message : String(error) });
        tally.failed += 1;
        // A portal that is refusing will refuse the next thirty too.
        if (tally.failed >= 3) break;
      }
      if (index < missing.length - 1) await sleep(CRAWL_PAUSE_MS);
    }
  } finally {
    fillingRegions.delete(key);
  }
  return tally;
}

/**
 * After an NBS release: re-fetch the stored catalog series in the categories
 * that release covers and that still lack `targetPeriod`, batched by table.
 * Returns how many series gained a period, so the caller knows whether the
 * portal has the new numbers yet.
 */
/**
 * After a release: re-fetch the stored catalog series in the categories that
 * release covers and that do not yet hold the period it reports.
 *
 * Three things this has to get right, each of which it used to get wrong.
 *
 * A series is a (key, region) pair. Keying the work by indicator alone meant
 * one province standing in for all of them, and every request going out for the
 * national figure — which, on a table published only by province or city, is a
 * grid of zeroes the bureau will happily return.
 *
 * Periods arrive in two shapes: "2026-Q2" from the catalog, "2026-06" from the
 * mirrors. "2026-Q2" > "2026-06" as strings, so every quarterly series counted
 * as current and was never refreshed after a quarterly release.
 *
 * One event can report a month and a quarter — the national economy briefing in
 * January, April, July and October does — so the caller passes a target per
 * frequency rather than one target and one frequency.
 */
/**
 * The oldest period a series can hold and still be one release behind the
 * target: two months for a monthly target (the bureau publishes January and
 * February together for many series, so December is the period before a
 * February), one quarter for a quarterly one. In the quarter-end month form
 * comparablePeriod gives.
 */
export function earliestOnCadence(target: ReleaseTarget): string {
  const [year = 0, month = 1] = target.period.split("-").map(Number);
  const back = target.frequency === "Quarterly" ? 3 : 2;
  const at = new Date(Date.UTC(year, month - 1 - back, 1));
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function refreshCatalogForRelease(
  categories: string[],
  targets: ReleaseTarget[],
  options: {
    fetchBatch?: typeof fetchNbsTableBatch; pauseMs?: number; entries?: NbsCatalogEntry[]; maxRequests?: number;
    /** The release's attempt number, from 1: each attempt starts its slice where the previous one stopped. */
    attempt?: number;
  } = {},
): Promise<{ advanced: number; checked: number; requests: number; pending: number }> {
  db();
  const fetchBatch = options.fetchBatch ?? fetchNbsTableBatch;
  const pauseMs = options.pauseMs ?? CRAWL_PAUSE_MS;
  const targetFor = (frequency: string) => targets.find((target) => target.frequency === frequency);

  // The release's own entries first, then what the store holds for just
  // those, by indicator and place, so a place that is behind is refreshed
  // even when its neighbours are current. The store used to be read whole
  // (every stored place, ~194,000) on every attempt, on the thread serving HTTP.
  const inRelease = (options.entries ?? await listNbsCatalogEntries())
    .filter((entry) => targetFor(entry.frequency) && categories.includes(entry.categories[0] ?? ""));
  const stored = new Map<string, { region: string; lastPeriod: string }>();
  for (const row of latestByRegion(inRelease.map((entry) => entry.key))) stored.set(`${row.key}@${row.region}`, { region: row.region, lastPeriod: row.lastPeriod ?? "" });

  const wanted: { entry: NbsCatalogEntry; region: { text: string; value: string } }[] = [];
  for (const entry of inRelease) {
    const target = targetFor(entry.frequency);
    if (!target) continue;
    const regions = entry.geography === "National" ? [NATIONAL_REGION] : await getNbsDimensions(entry, { offline: true });
    for (const region of regions) {
      const held = stored.get(`${entry.key}@${region.value}`);
      if (!held) continue; // never stored: the crawl's job, not the release's
      if (comparablePeriod(held.lastPeriod) >= target.period) continue;
      // A place far behind is not on this release's cadence: it stopped
      // publishing the indicator (boiler output in Hainan, Tibet, Qinghai and
      // Ningxia ends in 2021) or is published on another schedule. Chasing it
      // was most of the 27 September profits release's 9,995 pending series,
      // asked at every one of 66 attempts. The due-based refresh still covers it.
      if (comparablePeriod(held.lastPeriod) < earliestOnCadence(target)) continue;
      wanted.push({ entry, region });
    }
  }

  // One request per table, frequency and place.
  const tables = new Map<string, { entry: NbsCatalogEntry; region: { text: string; value: string } }[]>();
  for (const item of wanted) {
    const tableKey = `${item.entry.cid}|${item.entry.rootId}|${item.entry.frequency}|${item.region.value}`;
    tables.set(tableKey, [...(tables.get(tableKey) ?? []), item]);
  }

  // A release in a category with provincial tables behind it can imply
  // thousands of requests, one per place. Each attempt takes a bounded slice
  // and reports the rest as pending, so the next attempt continues rather than
  // one attempt running for hours.
  const maxRequests = options.maxRequests ?? Number(process.env.RELEASE_MAX_REQUESTS ?? 400);
  const result = { advanced: 0, checked: wanted.length, requests: 0, pending: 0 };
  // Every attempt used to start from the first table, so a release whose
  // first 400 tables never advance (the industrial profits release of 27
  // September: provincial tables, 9,995 series pending through attempt 64)
  // asked for the same tables every time and never reached the rest. The
  // requests are laid out in order and each attempt starts where the one
  // before it stopped, wrapping round; the attempt number is kept with the
  // release's job, so this holds across a deploy.
  const chunks: { entry: NbsCatalogEntry; region: { text: string; value: string } }[][] = [];
  for (const group of tables.values()) {
    for (let at = 0; at < group.length; at += NBS_BATCH_SIZE) chunks.push(group.slice(at, at + NBS_BATCH_SIZE));
  }
  const offset = chunks.length > 0 ? (((options.attempt ?? 1) - 1) * maxRequests) % chunks.length : 0;
  const ordered = [...chunks.slice(offset), ...chunks.slice(0, offset)];
  for (const chunk of ordered) {
    if (result.requests >= maxRequests) { result.pending += chunk.length; continue; }
    const region = chunk[0]?.region ?? NATIONAL_REGION;
    const startedAt = new Date().toISOString();
    // A failed table call spends the same request budget as a successful
    // one; otherwise an outage turns a bounded release job into a full sweep.
    result.requests += 1;
    try {
      const points = await fetchBatch(chunk.map((item) => item.entry), region, "recent");
      for (const item of chunk) {
        const fetched = points.get(item.entry.id) ?? [];
        storeNbsPoints(item.entry, region, fetched, startedAt, "recent");
        const target = targetFor(item.entry.frequency);
        if (target && comparablePeriod(fetched.at(-1)?.date ?? "") >= target.period) result.advanced += 1;
        else result.pending += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const item of chunk) logFetch({ key: item.entry.key, region: region.value, startedAt, finishedAt: new Date().toISOString(), status: "error", points: 0, changed: 0, message });
      result.pending += chunk.length;
    }
    await sleep(pauseMs);
  }
  return result;
}

/** One full ingest pass. `requested` is the CLI argument list; empty means everything. */
/**
 * Re-fetch stored catalog series that are due, batched by table and place.
 *
 * The bureau answers for one table and one place per request but for as many
 * of that table's indicators as are asked for, so a sweep over a catalog this
 * size has to be grouped rather than walked: one request per forty series,
 * paced, instead of one per series. A series whose entry has left the catalog
 * snapshot is counted as an error and skipped, not fetched blind.
 */
export async function refreshCatalogTargets(
  targets: { key: string; region: string; reason?: "new-period" | "revision" }[],
  options: { fetchBatch?: typeof fetchNbsTableBatch; pauseMs?: number; entries?: NbsCatalogEntry[] } = {},
): Promise<{ ok: number; error: number; empty: number }> {
  const tally = { ok: 0, error: 0, empty: 0 };
  const fetchBatch = options.fetchBatch ?? fetchNbsTableBatch;
  const suppliedEntries = options.entries ? new Map(options.entries.map((entry) => [entry.key, entry])) : null;
  const tables = new Map<string, { entry: NbsCatalogEntry; region: { text: string; value: string }; window: FetchWindow }[]>();
  for (const target of targets) {
    const entry = suppliedEntries ? suppliedEntries.get(target.key) : await getNbsCatalogEntry(target.key);
    if (!entry) { tally.error += 1; continue; }
    const regions = await getNbsDimensions(entry);
    const region = regions.find((option) => option.value === target.region)
      ?? (target.region ? { text: target.region, value: target.region } : NATIONAL_REGION);
    // A series due because a new period should exist asks for the last two
    // years; one due for its revision check asks for everything, because a
    // restatement of an old year is invisible in a recent window.
    const window: FetchWindow = target.reason === "new-period" ? "recent" : "full";
    const tableKey = `${entry.cid}|${entry.rootId}|${entry.frequency}|${region.value}|${window}`;
    tables.set(tableKey, [...(tables.get(tableKey) ?? []), { entry, region, window }]);
  }
  const chunks: { entry: NbsCatalogEntry; region: { text: string; value: string }; window: FetchWindow }[][] = [];
  for (const group of tables.values()) for (let at = 0; at < group.length; at += NBS_BATCH_SIZE) chunks.push(group.slice(at, at + NBS_BATCH_SIZE));
  console.log(`  ${chunks.length} table requests for ${targets.length} series`);

  for (const [index, chunk] of chunks.entries()) {
    const region = chunk[0]?.region ?? NATIONAL_REGION;
    const startedAt = new Date().toISOString();
    try {
      const points = await fetchBatch(chunk.map((item) => item.entry), region, chunk[0]?.window ?? "full");
      let okHere = 0;
      for (const item of chunk) {
        const outcome = storeNbsPoints(item.entry, region, points.get(item.entry.id) ?? [], startedAt, item.window);
        tally[outcome] += 1;
        if (outcome === "ok") okHere += 1;
      }
      console.log(`  ${String(index + 1).padStart(4)}/${chunks.length}  ${(chunk[0]?.entry.categories.slice(-1)[0] ?? "").slice(0, 40).padEnd(40)} ${okHere}/${chunk.length} refreshed`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const item of chunk) logFetch({ key: item.entry.key, region: region.value, startedAt, finishedAt: new Date().toISOString(), status: "error", points: 0, changed: 0, message });
      tally.error += chunk.length;
      console.log(`  ${String(index + 1).padStart(4)}/${chunks.length}  FAILED  ${message.slice(0, 80)}`);
    }
    if (index < chunks.length - 1) await sleep(options.pauseMs ?? CRAWL_PAUSE_MS);
  }
  return tally;
}

/** Keys with nothing stored first, then the rest in their catalog order. */
export function orderForIngest(keys: string[], hasStored: (key: string) => boolean): string[] {
  const fresh = keys.filter((key) => !hasStored(key));
  return [...fresh, ...keys.filter((key) => !fresh.includes(key))];
}

/**
 * `between` runs between one curated key (or one region of it) and the next: the scheduled
 * ingest passes the worker's `runWaiting`, so a release check queued behind a long ingest
 * runs within one key's time instead of after every key.
 */
export async function runIngest(requested: string[] = [], options: {
  between?: () => Promise<void>;
  /** Curated keys a resumed run already finished; skipped. */
  skip?: ReadonlySet<string>;
  /** Called after each curated key, whatever its outcome, so the run's progress can be kept. */
  onKeyDone?: (key: string) => void;
} = {}): Promise<{ ok: number; error: number; empty: number }> {
  let curatedKeys = requested.length > 0
    ? requested.filter((spec) => !spec.startsWith("nbs_"))
    : Object.keys(CATALOG);
  // Catalog series are named nbs_<id>, with an optional @<region code>. With
  // no arguments, every catalog series anyone has viewed is refreshed.
  const catalogTargets = requested.length > 0
    ? requested.filter((spec) => spec.startsWith("nbs_")).map((spec) => {
        const [key = "", region = ""] = spec.split("@");
        return { key, region };
      })
    : await dueCatalogTargets();

  const unknown = curatedKeys.filter((k) => !CATALOG[k]);
  if (unknown.length > 0) {
    console.error(`Unknown series: ${unknown.join(", ")}`);
    process.exit(1);
  }

  // A deployment without AKTools cannot refresh the AkShare series; they serve
  // from the store. Skipping them here keeps the fetch log to real failures.
  const skipped = aktoolsConfigured() ? [] : curatedKeys.filter((key) => CATALOG[key]?.kind === "aktools");
  if (skipped.length > 0) {
    console.log(`Skipping ${skipped.length} AkShare series (AKTOOLS_URL=off): ${skipped.join(", ")}`);
    curatedKeys = curatedKeys.filter((key) => !skipped.includes(key));
  }

  db(); // create and migrate before the first write
  const tally = { ok: 0, error: 0, empty: 0 };

  // A series nothing has stored yet goes first: a key added in today's deploy
  // reaches the Home page within minutes, not after every older key has been
  // refreshed (and not never, when a restart cuts the run short).
  if (requested.length === 0) curatedKeys = orderForIngest(curatedKeys, (key) => storedLatest(key).some((row) => row.key === key && row.lastPeriod !== null));
  const skip = options.skip;
  if (skip && skip.size > 0) {
    const before = curatedKeys.length;
    curatedKeys = curatedKeys.filter((key) => !skip.has(key));
    console.log(`Resuming an interrupted run: ${before - curatedKeys.length} curated series already done`);
  }

  if (curatedKeys.length > 0) {
    console.log(`Ingesting ${curatedKeys.length} curated series\n`);
    for (const [index, key] of curatedKeys.entries()) {
      const regions = seriesRegions(key);
      if (regions.length > 0) {
        // One request per region, paced like everything else. A failure in
        // one province does not discard the others. A source with an archive
        // to walk (Customs) is told the oldest month already stored, so each
        // run carries the history back a bounded step.
        const oldest = new Map(storedLatest(key).filter((row) => row.key === key).map((row) => [row.region, row.firstPeriod]));
        for (const [regionIndex, region] of regions.entries()) {
          tally[await ingestRegion(key, region, oldest.get(region.value) ?? null)] += 1;
          if (regionIndex < regions.length - 1) { await options.between?.(); await sleep(PAUSE_MS); }
        }
      } else {
        tally[await ingestOne(key)] += 1;
      }
      options.onKeyDone?.(key);
      if (index < curatedKeys.length - 1) { await options.between?.(); await sleep(PAUSE_MS); }
    }
  }

  // Stored catalog series are re-checked when the NBS calendar says a new
  // period should be out, or after 45 days for revisions (see due.ts), not
  // the whole store every day.
  if (catalogTargets.length > 0) {
    const named = requested.length > 0;
    console.log(`\nRefreshing ${catalogTargets.length} stored catalog series that are due\n`);
    // A handful of series named on the command line are fetched one by one so
    // the output names each; a due sweep is batched by table and place, which
    // is one request per forty series instead of forty.
    if (named && catalogTargets.length <= NBS_BATCH_SIZE) {
      for (const [index, target] of catalogTargets.entries()) {
        tally[await refreshOne(target.key, target.region)] += 1;
        if (index < catalogTargets.length - 1) await sleep(PAUSE_MS);
      }
    } else {
      const batched = await refreshCatalogTargets(catalogTargets);
      tally.ok += batched.ok;
      tally.error += batched.error;
      tally.empty += batched.empty;
    }
  }

  const status = dbStatus();
  console.log(
    `\n${tally.ok} ok, ${tally.empty} empty, ${tally.error} failed` +
    `\n${status.totals.observations} observations across ` +
    `${status.totals.keys} series in ${status.path}`,
  );

  return tally;
}

if (import.meta.main) {
  const crawlFlag = process.argv.indexOf("--crawl");
  if (crawlFlag >= 0) {
    const tally = await runCatalogCrawl(Number(process.argv[crawlFlag + 1] ?? 3000));
    if (tally.ok === 0 && tally.remaining > 0) process.exit(1);
    process.exit(0);
  }
  const tally = await runIngest(process.argv.slice(2));
  // A run where nothing at all landed is worth a non-zero exit so a scheduler
  // surfaces it. Partial failure is normal and stays quiet.
  if (tally.ok === 0) process.exit(1);
}
