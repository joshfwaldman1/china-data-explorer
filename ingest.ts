/**
 * Ingest job for the China Data Explorer.
 *
 * Walks the catalog, fetches each series from its upstream source, and stores
 * the result. Run it on a schedule (daily is generous — Chinese macro is
 * monthly or quarterly) and the web app never has to touch a foreign portal
 * during a page load.
 *
 *   bun run china-explorer/ingest.ts             # everything
 *   bun run china-explorer/ingest.ts cpi gdp     # named series only
 *
 * Failures are per-series and recorded, not fatal. If AKTools is not running,
 * four series fail and the other thirteen still land — that is the intended
 * behaviour, not a broken run.
 */

import { CATALOG, fetchLive, seriesRegion } from "./data.ts";
import { db, writeSeries, logFetch, dbStatus } from "./db.ts";

// Upstream sources are public and unauthenticated, so we stay well-mannered:
// one series at a time with a pause between, rather than a burst of parallel
// requests at a government portal.
const PAUSE_MS = Number(process.env.INGEST_PAUSE_MS ?? 1500);
const HISTORY_LIMIT = Number(process.env.INGEST_LIMIT ?? 240);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function main(): Promise<void> {
  const requested = process.argv.slice(2);
  const keys = requested.length > 0 ? requested : Object.keys(CATALOG);

  const unknown = keys.filter((k) => !CATALOG[k]);
  if (unknown.length > 0) {
    console.error(`Unknown series: ${unknown.join(", ")}`);
    process.exit(1);
  }

  db(); // create and migrate before the first write
  console.log(`Ingesting ${keys.length} series\n`);

  const tally = { ok: 0, error: 0, empty: 0 };
  for (const [index, key] of keys.entries()) {
    tally[await ingestOne(key)] += 1;
    if (index < keys.length - 1) await sleep(PAUSE_MS);
  }

  const status = dbStatus();
  console.log(
    `\n${tally.ok} ok, ${tally.empty} empty, ${tally.error} failed` +
    `\n${status.totals.observations} observations across ` +
    `${status.totals.keys} series in ${status.path}`,
  );

  // A run where nothing at all landed is worth a non-zero exit so a scheduler
  // surfaces it. Partial failure is normal and stays quiet.
  if (tally.ok === 0) process.exit(1);
}

await main();
