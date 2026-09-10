/**
 * Ingest job for the China Data Explorer.
 *
 * Walks the catalog, fetches each series from its upstream source, and stores
 * the result. Run it on a schedule (daily is generous — Chinese macro is
 * monthly or quarterly) and the web app never has to touch a foreign portal
 * during a page load.
 *
 *   bun run china-explorer/ingest.ts                        # curated + every stored catalog series
 *   bun run china-explorer/ingest.ts cpi gdp                # named curated series only
 *   bun run china-explorer/ingest.ts nbs_<id>@440000000000  # one catalog series, one region
 *
 * Failures are per-series and recorded, not fatal. If AKTools is not running,
 * the AkShare series fail and the rest still land. A deployment that has said
 * it has none (AKTOOLS_URL=off) skips them instead of logging a failure.
 */

import { CATALOG, aktoolsConfigured, fetchLive, fetchLiveRegion, seriesRegion, seriesRegions } from "./data.ts";
import { db, writeSeries, logFetch, dbStatus, listStoredSeries, recentlyEmptyKeys, storedLatest } from "./db.ts";
import { NBS_BATCH_SIZE, fetchNbsTableBatch, getNbsCatalogEntry, listNbsCatalogEntries, refreshNbsCatalogSeries, storeNbsPoints, type NbsCatalogEntry } from "./nbs-catalog.ts";
import { isDue } from "./due.ts";

// Upstream sources are public and unauthenticated, so we stay well-mannered:
// one series at a time with a pause between, rather than a burst of parallel
// requests at a government portal.
const PAUSE_MS = Number(process.env.INGEST_PAUSE_MS ?? 1500);
const HISTORY_LIMIT = Number(process.env.INGEST_LIMIT ?? 240);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One region of a multi-region curated series, keyed by its NBS code. */
async function ingestRegion(key: string, region: { text: string; value: string }): Promise<"ok" | "error" | "empty"> {
  const startedAt = new Date().toISOString();
  const label = `${key}@${region.value}`;
  try {
    const result = await fetchLiveRegion(key, region, HISTORY_LIMIT);
    const finishedAt = new Date().toISOString();
    if (!result || result.series.every((s) => s.points.length === 0)) {
      logFetch({ key, region: region.value, startedAt, finishedAt, status: "empty", points: 0, changed: 0, message: "source returned no points" });
      console.log(`  ${label.padEnd(36)} ${region.text.padEnd(8)} empty`);
      return "empty";
    }
    const summary = writeSeries(result, region.value, finishedAt);
    logFetch({ key, region: region.value, startedAt, finishedAt, status: "ok", points: summary.points, changed: summary.changed });
    console.log(`  ${label.padEnd(36)} ${region.text.padEnd(8)} ${String(summary.points).padStart(4)} points, ${summary.changed} new or revised`);
    return "ok";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logFetch({ key, region: region.value, startedAt, finishedAt: new Date().toISOString(), status: "error", points: 0, changed: 0, message });
    console.log(`  ${label.padEnd(36)} ${region.text.padEnd(8)} FAILED  ${message}`);
    return "error";
  }
}

async function ingestOne(key: string): Promise<"ok" | "error" | "empty"> {
  const startedAt = new Date().toISOString();

  try {
    const result = await fetchLive(key, HISTORY_LIMIT);
    const finishedAt = new Date().toISOString();

    if (!result || result.series.every((s) => s.points.length === 0)) {
      logFetch({ key, startedAt, finishedAt, status: "empty", points: 0, changed: 0,
        message: "source returned no points" });
      console.log(`  ${key.padEnd(22)} empty`);
      return "empty";
    }

    const summary = writeSeries(result, seriesRegion(key), finishedAt);
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
async function dueCatalogTargets(now = new Date()): Promise<{ key: string; region: string }[]> {
  const rows = storedLatest("nbs_");
  const targets: { key: string; region: string }[] = [];
  for (const [index, row] of rows.entries()) {
    // Fifteen thousand rows of synchronous lookups held the event loop for
    // about eight seconds at the start of every ingest, so page requests
    // stalled; yielding every few hundred rows lets them interleave.
    if (index > 0 && index % 500 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    const entry = await getNbsCatalogEntry(row.key);
    if (!entry) continue;
    if (isDue(entry.frequency, row.lastPeriod, row.updatedAt, now)) targets.push({ key: row.key, region: row.region });
  }
  return targets;
}

const CRAWL_PAUSE_MS = Number(process.env.CRAWL_PAUSE_MS ?? 1200);
const NATIONAL_REGION = { text: "全国", value: "000000000000" };

/**
 * Fill the store with catalog series nobody has opened yet. Indicators are
 * grouped by table and fetched `NBS_BATCH_SIZE` at a time in one request
 * each, paced, up to `budget` indicators per run. Five failed requests in a
 * row pause the run for ten minutes; twenty end it. Returns what was done
 * and how many indicators remain.
 */
export async function runCatalogCrawl(budget: number): Promise<{ ok: number; error: number; empty: number; remaining: number }> {
  db();
  const stored = new Set(listStoredSeries("nbs_").map((row) => row.key));
  // NBS's index tree lists indicators it no longer publishes (whole blocks of
  // tax lines by industry return nothing). Once an entry has come back empty
  // it waits a month before another try.
  const empty = recentlyEmptyKeys("nbs_", 30);
  const entries = (await listNbsCatalogEntries()).filter((entry) => !stored.has(entry.key) && !empty.has(entry.key));
  const tally = { ok: 0, error: 0, empty: 0, remaining: entries.length };
  if (entries.length === 0) return tally;

  // Same table, same frequency: one request per chunk.
  const tables = new Map<string, NbsCatalogEntry[]>();
  for (const entry of entries.slice(0, budget)) {
    const tableKey = `${entry.cid}|${entry.rootId}|${entry.frequency}`;
    tables.set(tableKey, [...(tables.get(tableKey) ?? []), entry]);
  }
  const chunks: NbsCatalogEntry[][] = [];
  for (const group of tables.values()) for (let at = 0; at < group.length; at += NBS_BATCH_SIZE) chunks.push(group.slice(at, at + NBS_BATCH_SIZE));
  console.log(`\nCrawling ${Math.min(budget, entries.length)} of ${entries.length} catalog series not yet stored, in ${chunks.length} table requests\n`);

  let consecutiveFailures = 0;
  for (const [index, chunk] of chunks.entries()) {
    const startedAt = new Date().toISOString();
    try {
      const points = await fetchNbsTableBatch(chunk, NATIONAL_REGION);
      let okHere = 0;
      for (const entry of chunk) {
        const outcome = storeNbsPoints(entry, NATIONAL_REGION, points.get(entry.id) ?? [], startedAt);
        tally[outcome] += 1;
        tally.remaining -= 1;
        if (outcome === "ok") okHere += 1;
      }
      consecutiveFailures = 0;
      console.log(`  ${String(index + 1).padStart(4)}/${chunks.length}  ${(chunk[0]?.categories.slice(-1)[0] ?? "").slice(0, 40).padEnd(40)} ${okHere}/${chunk.length} with data`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const entry of chunk) logFetch({ key: entry.key, region: NATIONAL_REGION.value, startedAt, finishedAt: new Date().toISOString(), status: "error", points: 0, changed: 0, message });
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
 * After an NBS release: re-fetch the stored catalog series in the categories
 * that release covers and that still lack `targetPeriod`, batched by table.
 * Returns how many series gained a period, so the caller knows whether the
 * portal has the new numbers yet.
 */
export async function refreshCatalogForRelease(categories: string[], targetPeriod: string, frequency: "Monthly" | "Quarterly"): Promise<{ advanced: number; checked: number; requests: number }> {
  db();
  const latest = new Map(storedLatest("nbs_").map((row) => [row.key, row.lastPeriod ?? ""]));
  const wanted: NbsCatalogEntry[] = [];
  for (const entry of await listNbsCatalogEntries()) {
    if (entry.frequency !== frequency || !latest.has(entry.key)) continue;
    if (!categories.includes(entry.categories[0] ?? "")) continue;
    if ((latest.get(entry.key) ?? "") >= targetPeriod) continue;
    wanted.push(entry);
  }
  const tables = new Map<string, NbsCatalogEntry[]>();
  for (const entry of wanted) {
    const tableKey = `${entry.cid}|${entry.rootId}`;
    tables.set(tableKey, [...(tables.get(tableKey) ?? []), entry]);
  }
  const result = { advanced: 0, checked: wanted.length, requests: 0 };
  for (const group of tables.values()) {
    for (let at = 0; at < group.length; at += NBS_BATCH_SIZE) {
      const chunk = group.slice(at, at + NBS_BATCH_SIZE);
      const startedAt = new Date().toISOString();
      try {
        const points = await fetchNbsTableBatch(chunk, NATIONAL_REGION);
        result.requests += 1;
        for (const entry of chunk) {
          const fetched = points.get(entry.id) ?? [];
          storeNbsPoints(entry, NATIONAL_REGION, fetched, startedAt);
          if ((fetched.at(-1)?.date ?? "") >= targetPeriod) result.advanced += 1;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        for (const entry of chunk) logFetch({ key: entry.key, region: NATIONAL_REGION.value, startedAt, finishedAt: new Date().toISOString(), status: "error", points: 0, changed: 0, message });
      }
      await sleep(CRAWL_PAUSE_MS);
    }
  }
  return result;
}

/** One full ingest pass. `requested` is the CLI argument list; empty means everything. */
export async function runIngest(requested: string[] = []): Promise<{ ok: number; error: number; empty: number }> {
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

  if (curatedKeys.length > 0) {
    console.log(`Ingesting ${curatedKeys.length} curated series\n`);
    for (const [index, key] of curatedKeys.entries()) {
      const regions = seriesRegions(key);
      if (regions.length > 0) {
        // One request per region, paced like everything else. A failure in
        // one province does not discard the others.
        for (const [regionIndex, region] of regions.entries()) {
          tally[await ingestRegion(key, region)] += 1;
          if (regionIndex < regions.length - 1) await sleep(PAUSE_MS);
        }
      } else {
        tally[await ingestOne(key)] += 1;
      }
      if (index < curatedKeys.length - 1) await sleep(PAUSE_MS);
    }
  }

  // Stored catalog series are re-checked when the NBS calendar says a new
  // period should be out, or after 45 days for revisions (see due.ts), not
  // all 15,000 every day.
  if (catalogTargets.length > 0) {
    console.log(`\nRefreshing ${catalogTargets.length} stored catalog series that are due\n`);
    for (const [index, target] of catalogTargets.entries()) {
      tally[await refreshOne(target.key, target.region)] += 1;
      if (index < catalogTargets.length - 1) await sleep(PAUSE_MS);
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
