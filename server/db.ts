/**
 * Local store for the China Data Explorer.
 *
 * Why this exists: the explorer used to read straight from Eastmoney, the NBS
 * portal, and AkShare on every request. That makes the site only as available
 * as a foreign government portal, and it means we keep no record of what was
 * published. China matters here specifically — NBS suspended the 16-24 youth
 * unemployment series after June 2023 and resumed it in January 2024 on a
 * different basis. Anyone storing observations through that window owns a
 * record of what was published before it stopped. That is the point of this
 * file; the fact that reads also get fast is a side effect.
 *
 * The observations table is append-only. A new row is written only when a
 * value actually differs from the most recent stored value for that period,
 * so a revision shows up as a second row rather than silently overwriting the
 * first, and an unchanged daily ingest costs nothing.
 */

import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Series, SeriesResult } from "./data.ts";

const DB_PATH = process.env.CHINA_DB_PATH ?? `${import.meta.dir}/../china.db`;

let handle: Database | null = null;

/**
 * Open the database, creating and migrating it on first use. WAL mode lets the
 * server keep reading while an ingest run writes.
 */
const SEED_PATH = `${import.meta.dir}/../seed/china.db`;

/**
 * A fresh deployment starts with an empty volume. Rather than an empty site
 * until the first ingest, copy the committed seed snapshot into place once.
 * The seed is refreshed by `bun run china:seed`.
 */
function seedStoreIfMissing(): void {
  if (process.env.CHINA_SEED === "off" || existsSync(DB_PATH) || !existsSync(SEED_PATH)) return;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  copyFileSync(SEED_PATH, DB_PATH);
  console.log(`  Store seeded from ${SEED_PATH}`);
}

export function db(): Database {
  if (handle) return handle;

  seedStoreIfMissing();
  const database = new Database(DB_PATH, { create: true });
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA foreign_keys = ON");

  // One row per series we track. `region` is empty for national series and
  // carries the NBS region label (for example 广东省) for provincial ones.
  database.exec(`
    CREATE TABLE IF NOT EXISTS series (
      key         TEXT NOT NULL,
      region      TEXT NOT NULL DEFAULT '',
      label       TEXT NOT NULL,
      title       TEXT NOT NULL,
      agency      TEXT NOT NULL,
      frequency   TEXT NOT NULL,
      unit        TEXT NOT NULL,
      source_url  TEXT NOT NULL DEFAULT '',
      updated_at  TEXT NOT NULL,
      PRIMARY KEY (key, region, label)
    )
  `);

  // Append-only. `fetched_at` in the primary key is what makes a revision a
  // new row instead of an overwrite.
  database.exec(`
    CREATE TABLE IF NOT EXISTS observations (
      key         TEXT NOT NULL,
      region      TEXT NOT NULL DEFAULT '',
      label       TEXT NOT NULL,
      period      TEXT NOT NULL,
      value       REAL,
      fetched_at  TEXT NOT NULL,
      PRIMARY KEY (key, region, label, period, fetched_at)
    )
  `);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_observations_lookup
      ON observations (key, region, label, period, fetched_at DESC)
  `);

  // Every ingest attempt, successful or not. A source going dark should be
  // visible as a run that failed, not as a chart that quietly goes stale.
  database.exec(`
    CREATE TABLE IF NOT EXISTS fetch_log (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      key          TEXT NOT NULL,
      started_at   TEXT NOT NULL,
      finished_at  TEXT NOT NULL,
      status       TEXT NOT NULL,
      point_count  INTEGER NOT NULL DEFAULT 0,
      changed_count INTEGER NOT NULL DEFAULT 0,
      message      TEXT NOT NULL DEFAULT ''
    )
  `);

  // fetch_log gained a region column after the first schema shipped; add it
  // to databases created before then. A blank region is a national or
  // curated series.
  const fetchLogColumns = database.query<{ name: string }, []>("PRAGMA table_info(fetch_log)").all();
  if (!fetchLogColumns.some((column) => column.name === "region")) {
    database.exec("ALTER TABLE fetch_log ADD COLUMN region TEXT NOT NULL DEFAULT ''");
  }

  // The catalog briefly lived in this file; it belongs in catalog.db (a
  // rebuildable cache), not beside the observations that get backed up.
  const stray = database.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE name IN ('catalog', 'catalog_fts', 'catalog_meta')").all();
  if (stray.length > 0) {
    database.exec("DROP TABLE IF EXISTS catalog_fts; DROP TABLE IF EXISTS catalog; DROP TABLE IF EXISTS catalog_meta; VACUUM");
  }

  // Series order is meaningful — the first series of a curated key is its
  // headline. Stored as a position so reads return the declared order rather
  // than alphabetical.
  const seriesColumns = database.query<{ name: string }, []>("PRAGMA table_info(series)").all();
  if (!seriesColumns.some((column) => column.name === "position")) {
    database.exec("ALTER TABLE series ADD COLUMN position INTEGER NOT NULL DEFAULT 0");
  }

  handle = database;
  return handle;
}

const CATALOG_DB_PATH = process.env.CHINA_CATALOG_DB_PATH ?? `${import.meta.dir}/../catalog.db`;
let catalogHandle: Database | null = null;

/**
 * The catalog cache: one JSON document per series plus a persistent full-text
 * index, keyed by a version derived from the snapshot files. It is a separate
 * file from the observations because it is derived — rebuilt from the JSON
 * snapshot in under a second whenever it is missing or stale — and 36 MB of
 * trigrams has no business in the file the daily workflow commits.
 */
export function catalogDb(): Database {
  if (catalogHandle) return catalogHandle;
  const database = new Database(CATALOG_DB_PATH, { create: true });
  database.exec("PRAGMA journal_mode = WAL");
  database.exec(`
    CREATE TABLE IF NOT EXISTS catalog_meta (
      id            INTEGER PRIMARY KEY CHECK (id = 1),
      version       TEXT NOT NULL,
      generated_at  TEXT NOT NULL,
      source        TEXT NOT NULL,
      loaded_at     TEXT NOT NULL
    )
  `);
  database.exec("CREATE TABLE IF NOT EXISTS catalog (key TEXT PRIMARY KEY, entry TEXT NOT NULL)");
  database.exec("CREATE VIRTUAL TABLE IF NOT EXISTS catalog_fts USING fts5(key UNINDEXED, name, name_en, short, path, py, tokenize = 'trigram')");
  catalogHandle = database;
  return catalogHandle;
}

export interface WriteSummary {
  points: number;
  changed: number;
}

/**
 * Store one fetched series result. Returns how many points were seen and how
 * many were genuinely new or revised.
 */
export function writeSeries(
  result: SeriesResult,
  region: string,
  fetchedAt: string,
): WriteSummary {
  const database = db();

  const upsertSeries = database.prepare(`
    INSERT INTO series (key, region, label, title, agency, frequency, unit, source_url, updated_at, position)
    VALUES ($key, $region, $label, $title, $agency, $frequency, $unit, $sourceUrl, $updatedAt, $position)
    ON CONFLICT (key, region, label) DO UPDATE SET
      title = $title, agency = $agency, frequency = $frequency,
      unit = $unit, source_url = $sourceUrl, updated_at = $updatedAt, position = $position
  `);

  // The most recent stored value for one period, so we can tell a revision
  // from an unchanged repeat.
  const latestValue = database.prepare(`
    SELECT value FROM observations
    WHERE key = $key AND region = $region AND label = $label AND period = $period
    ORDER BY fetched_at DESC
    LIMIT 1
  `);

  const insertObservation = database.prepare(`
    INSERT OR IGNORE INTO observations (key, region, label, period, value, fetched_at)
    VALUES ($key, $region, $label, $period, $value, $fetchedAt)
  `);

  let points = 0;
  let changed = 0;

  const write = database.transaction((series: Series[]) => {
    for (const [position, one] of series.entries()) {
      upsertSeries.run({
        $key: result.key, $region: region, $label: one.label,
        $title: result.title, $agency: result.agency,
        $frequency: result.frequency, $unit: result.unit,
        $sourceUrl: result.sourceUrl, $updatedAt: fetchedAt, $position: position,
      });

      for (const point of one.points) {
        points += 1;
        const previous = latestValue.get({
          $key: result.key, $region: region, $label: one.label, $period: point.date,
        }) as { value: number | null } | null;

        // Unchanged values are not re-stored; only first sightings and
        // revisions become rows.
        if (previous !== null && previous.value === point.value) continue;

        insertObservation.run({
          $key: result.key, $region: region, $label: one.label,
          $period: point.date, $value: point.value, $fetchedAt: fetchedAt,
        });
        changed += 1;
      }
    }
  });

  write(result.series);
  return { points, changed };
}

export function logFetch(entry: {
  key: string;
  region?: string;
  startedAt: string;
  finishedAt: string;
  status: "ok" | "error" | "empty";
  points: number;
  changed: number;
  message?: string;
}): void {
  db().prepare(`
    INSERT INTO fetch_log (key, region, started_at, finished_at, status, point_count, changed_count, message)
    VALUES ($key, $region, $startedAt, $finishedAt, $status, $points, $changed, $message)
  `).run({
    $key: entry.key, $region: entry.region ?? "", $startedAt: entry.startedAt, $finishedAt: entry.finishedAt,
    $status: entry.status, $points: entry.points, $changed: entry.changed,
    $message: entry.message ?? "",
  });
}

/**
 * Read a series back out as the current best view: for each period, the value
 * from the most recent fetch that recorded one.
 */
export function readSeries(key: string, limit = 120, region?: string): SeriesResult | null {
  const database = db();

  const meta = database.prepare(`
    SELECT key, region, label, title, agency, frequency, unit, source_url AS sourceUrl,
           updated_at AS updatedAt
    FROM series
    WHERE key = $key AND ($region IS NULL OR region = $region)
    ORDER BY region, position, label
  `).all({ $key: key, $region: region ?? null }) as {
    key: string; region: string; label: string; title: string;
    agency: string; frequency: string; unit: string; sourceUrl: string; updatedAt: string;
  }[];

  if (meta.length === 0) return null;

  const latestPoints = database.prepare(`
    SELECT period AS date, value
    FROM observations o
    WHERE key = $key AND region = $region AND label = $label
      AND fetched_at = (
        SELECT MAX(fetched_at) FROM observations
        WHERE key = o.key AND region = o.region AND label = o.label AND period = o.period
      )
    ORDER BY period DESC
    LIMIT $limit
  `);

  const series: Series[] = meta.map((row) => {
    const points = latestPoints.all({
      $key: key, $region: row.region, $label: row.label, $limit: limit,
    }) as { date: string; value: number }[];
    points.sort((a, b) => a.date.localeCompare(b.date));
    return { label: row.label, points };
  });

  const first = meta[0];
  if (!first) return null;
  const updatedAt = meta.map((row) => row.updatedAt).sort().at(-1);
  return {
    key, title: first.title, agency: first.agency, sourceUrl: first.sourceUrl,
    frequency: first.frequency, unit: first.unit, series, updatedAt,
  };
}

/** Every stored value for one period, oldest first — the revision trail. */
export function readRevisions(key: string, label: string, period: string, region?: string) {
  return db().query<{ region: string; period: string; value: number | null; fetchedAt: string }, Record<string, string | null>>(`
    SELECT region, period, value, fetched_at AS fetchedAt
    FROM observations
    WHERE key = $key AND label = $label AND period = $period
      AND ($region IS NULL OR region = $region)
    ORDER BY fetched_at ASC
  `).all({ $key: key, $label: label, $period: period, $region: region ?? null });
}

/**
 * Every period that has more than one stored value, with all of its
 * vintages — the "what did they say before" view. Empty until a source
 * actually revises something.
 */
export function readRevisionHistory(key: string, region?: string) {
  const rows = db().query<{ label: string; period: string; value: number | null; fetchedAt: string }, Record<string, string | null>>(`
    SELECT o.label, o.period, o.value, o.fetched_at AS fetchedAt
    FROM observations o
    JOIN (
      SELECT key, region, label, period FROM observations
      WHERE key = $key AND ($region IS NULL OR region = $region)
      GROUP BY key, region, label, period HAVING COUNT(*) > 1
    ) r ON r.key = o.key AND r.region = o.region AND r.label = o.label AND r.period = o.period
    WHERE o.key = $key AND ($region IS NULL OR o.region = $region)
    ORDER BY o.period DESC, o.label, o.fetched_at ASC
  `).all({ $key: key, $region: region ?? null });
  const grouped = new Map<string, { label: string; period: string; vintages: { value: number | null; fetchedAt: string }[] }>();
  for (const row of rows) {
    const id = `${row.label}\u0000${row.period}`;
    const entry = grouped.get(id) ?? { label: row.label, period: row.period, vintages: [] };
    entry.vintages.push({ value: row.value, fetchedAt: row.fetchedAt });
    grouped.set(id, entry);
  }
  return [...grouped.values()];
}

/** When any series for this key and region was last written, as an ISO stamp. */
export function seriesFreshness(key: string, region: string): string | null {
  const row = db().query<{ updatedAt: string | null }, Record<string, string>>(`
    SELECT MAX(updated_at) AS updatedAt FROM series WHERE key = $key AND region = $region
  `).get({ $key: key, $region: region });
  return row?.updatedAt ?? null;
}

/** For each stored series with the prefix: its latest period and when it was last written. */
export function storedLatest(prefix: string): { key: string; region: string; lastPeriod: string | null; updatedAt: string | null }[] {
  return db().query<{ key: string; region: string; lastPeriod: string | null; updatedAt: string | null }, Record<string, string>>(`
    SELECT s.key AS key, s.region AS region, MAX(o.period) AS lastPeriod, MAX(s.updated_at) AS updatedAt
    FROM series s LEFT JOIN observations o ON o.key = s.key AND o.region = s.region
    WHERE s.key LIKE $prefix || '%'
    GROUP BY s.key, s.region
  `).all({ $prefix: prefix });
}

/** Every distinct (key, region) in the store whose key starts with `prefix`. */
export function listStoredSeries(prefix: string): { key: string; region: string }[] {
  return db().query<{ key: string; region: string }, Record<string, string>>(`
    SELECT DISTINCT key, region FROM series WHERE key LIKE $prefix || '%' ORDER BY key, region
  `).all({ $prefix: prefix });
}

/** Coverage summary, for the /api/status route and for eyeballing an ingest. */
export function dbStatus() {
  const database = db();
  const totals = database.prepare(`
    SELECT COUNT(*) AS observations,
           COUNT(DISTINCT key) AS keys,
           MAX(fetched_at) AS lastFetch
    FROM observations
  `).get() as { observations: number; keys: number; lastFetch: string | null };

  const perSeries = database.prepare(`
    SELECT key, region,
           COUNT(DISTINCT period) AS periods,
           MIN(period) AS firstPeriod,
           MAX(period) AS lastPeriod,
           MAX(fetched_at) AS lastFetch
    FROM observations
    GROUP BY key, region
    ORDER BY key, region
  `).all();

  const recentRuns = database.prepare(`
    SELECT key, region, status, point_count AS points, changed_count AS changed,
           finished_at AS finishedAt, message
    FROM fetch_log
    ORDER BY id DESC
    LIMIT 20
  `).all();

  return { path: DB_PATH, totals, perSeries, recentRuns };
}
