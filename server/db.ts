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
import { REVISION_CHECK_DAYS, type FullHistoryCheckState } from "./due.ts";

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
 * The seed is refreshed by `bun run seed`.
 */
function seedStoreIfMissing(): void {
  if (process.env.CHINA_SEED === "off" || existsSync(DB_PATH) || !existsSync(SEED_PATH)) return;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  copyFileSync(SEED_PATH, DB_PATH);
  console.log(`  Store seeded from ${SEED_PATH}`);
}

/**
 * Bring an older observations table up to the storage the schema above
 * describes: no separate lookup index, and the rows held once rather than
 * twice.
 *
 * The first shipped schema carried an index on (key, region, label, period,
 * fetched_at DESC), which is the primary key with the last column reversed —
 * SQLite reads the primary-key index backwards perfectly well, so that index
 * was a second copy of every row for nothing. The table itself was then a
 * third copy, because an ordinary table stores the row and the primary key
 * indexes it again.
 *
 * Rebuilding is a copy, so it needs room for a second table before the old one
 * goes; a store too close to filling its volume is left alone and tried again
 * on the next boot rather than failing to open. The work happens inside a
 * transaction: an interrupted migration rolls back to the table it started
 * with and no observation is lost.
 */
function migrateObservationsStorage(database: Database): void {
  const schema = database.query<{ sql: string | null }, []>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'observations'",
  ).get();
  if (!schema?.sql) return;
  const hasIndex = database.query<{ name: string }, []>(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_observations_lookup'",
  ).get() !== null;
  const rowidTable = !/WITHOUT\s+ROWID/i.test(schema.sql);
  if (!hasIndex && !rowidTable) return;

  if (hasIndex) {
    database.exec("DROP INDEX idx_observations_lookup");
    console.log("  Store: dropped the redundant observations index");
  }
  if (!rowidTable) return;

  const rows = database.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM observations").get()?.n ?? 0;
  console.log(`  Store: rebuilding ${rows.toLocaleString()} observations without a duplicate copy...`);
  const startedAt = Date.now();
  try {
    database.exec("PRAGMA foreign_keys = OFF");
    database.transaction(() => {
      database.exec(`
        CREATE TABLE observations_rebuilt (
          key         TEXT NOT NULL,
          region      TEXT NOT NULL DEFAULT '',
          label       TEXT NOT NULL,
          period      TEXT NOT NULL,
          value       REAL,
          fetched_at  TEXT NOT NULL,
          PRIMARY KEY (key, region, label, period, fetched_at)
        ) WITHOUT ROWID
      `);
      database.exec("INSERT INTO observations_rebuilt SELECT key, region, label, period, value, fetched_at FROM observations");
      database.exec("DROP TABLE observations");
      database.exec("ALTER TABLE observations_rebuilt RENAME TO observations");
      // The rebuild is the one moment the whole table is counted anyway, so
      // the running count starts out exact.
      database.query("INSERT OR REPLACE INTO store_stats (id, observations) VALUES (1, ?)").run(rows);
    })();
    // No VACUUM. It would halve the file, but it rewrites the whole database
    // while the process is blocked on it, and this runs at boot where a
    // platform healthcheck is waiting. The pages the old table freed are
    // reused by the next writes, and the regional crawl fills them within a
    // day. `CHINA_VACUUM=1` asks for it anyway, for a maintenance run.
    if (process.env.CHINA_VACUUM === "1") database.exec("VACUUM");
    console.log(`  Store: rebuilt in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  } catch (error) {
    // Out of disk, most likely. The old table is still there and correct.
    database.exec("DROP TABLE IF EXISTS observations_rebuilt");
    console.warn(`  Store: rebuild postponed (${error instanceof Error ? error.message : String(error)})`);
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
  }
}

/**
 * Fill series_range for a store that predates it, in the one pass the old
 * query used to make on every search. A store where every series already has a
 * row costs one indexed count.
 */
function backfillSeriesRanges(database: Database): void {
  const missing = database.query<{ n: number }, []>(`
    SELECT COUNT(*) AS n FROM series s
    WHERE NOT EXISTS (SELECT 1 FROM series_range r WHERE r.key = s.key AND r.region = s.region)
  `).get()?.n ?? 0;
  if (missing === 0) return;
  console.log(`  Store: summarising the range of ${missing.toLocaleString()} series...`);
  const startedAt = Date.now();
  database.exec(`
    INSERT OR REPLACE INTO series_range (key, region, first_period, first_real_period, last_period, periods, last_fetch)
    SELECT key, region, MIN(period), MIN(CASE WHEN value <> 0 THEN period END), MAX(period),
           COUNT(DISTINCT period), MAX(fetched_at)
    FROM observations GROUP BY key, region
  `);
  console.log(`  Store: summarised in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

/** Spread legacy series' first known audit over one revision interval, never at boot. */
function firstFullHistoryCheckDueAt(key: string, region: string, now: Date): string {
  let hash = 2166136261;
  for (const character of `${key}@${region}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  const days = 1 + hash % REVISION_CHECK_DAYS;
  return new Date(now.getTime() + days * 86400000).toISOString();
}

function migrateFullHistoryChecks(database: Database): void {
  // Earlier fetches did not record their window. Do not pretend updated_at
  // proves a full audit, or schedule the entire catalog on its first new boot.
  // A separate first deadline preserves that uncertainty and bounds the delay
  // to 45 days. It is written once; restarts and recent fetches never move it.
  database.transaction(() => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS series_refresh_state (
        key                             TEXT NOT NULL,
        region                          TEXT NOT NULL,
        last_full_history_check         TEXT,
        first_full_history_check_due_at TEXT NOT NULL,
        PRIMARY KEY (key, region)
      ) WITHOUT ROWID
    `);
    const missing = database.query<{ key: string; region: string }, []>(`
      SELECT DISTINCT s.key, s.region FROM series s
      WHERE s.key GLOB 'nbs_*' AND NOT EXISTS (
        SELECT 1 FROM series_refresh_state r WHERE r.key = s.key AND r.region = s.region
      )
    `).all();
    const insert = database.prepare("INSERT INTO series_refresh_state (key, region, first_full_history_check_due_at) VALUES (?, ?, ?)");
    const now = new Date();
    for (const row of missing) insert.run(row.key, row.region, firstFullHistoryCheckDueAt(row.key, row.region, now));
  })();
}

/**
 * The partner series' February 2022 to 2025 figures were misread: Customs
 * publishes January and February together, and through 2025 that table had
 * no month column, so the parser stored the two months' imports as
 * February's exports and a growth rate as its imports (customs.ts,
 * parseByCountry). No single-month figure exists for those Februaries. The
 * store is append-only and the crawl only writes values it reads, so a
 * corrected parse, which reads nothing for them, cannot retract them; this
 * writes the retraction as a null revision, once, and the trail keeps what
 * was shown before it.
 */
export const MISREAD_FEBRUARIES = { keys: ["trade_partners", "trade_partners_cny"], periods: ["2022-02", "2023-02", "2024-02", "2025-02"], labels: ["Exports", "Imports", "Balance"] } as const;

export function retractMisreadFebruaries(database: Database, now = new Date()): number {
  const latest = database.query<{ key: string; region: string; label: string; period: string }, []>(`
    SELECT o.key, o.region, o.label, o.period FROM observations o
    WHERE o.key IN (${MISREAD_FEBRUARIES.keys.map((key) => `'${key}'`).join(", ")})
      AND o.period IN (${MISREAD_FEBRUARIES.periods.map((period) => `'${period}'`).join(", ")})
      AND o.label IN (${MISREAD_FEBRUARIES.labels.map((label) => `'${label}'`).join(", ")})
      AND o.value IS NOT NULL
      AND o.fetched_at = (SELECT MAX(fetched_at) FROM observations WHERE key = o.key AND region = o.region AND label = o.label AND period = o.period)
  `).all();
  if (latest.length === 0) return 0;
  const retract = database.prepare("INSERT OR IGNORE INTO observations (key, region, label, period, value, fetched_at) VALUES (?, ?, ?, ?, NULL, ?)");
  const at = now.toISOString();
  database.transaction(() => { for (const row of latest) retract.run(row.key, row.region, row.label, row.period, at); })();
  console.log(`  Store: retracted ${latest.length} misread February partner figures`);
  return latest.length;
}

/**
 * April 2025's major exports table was published without its quantity-unit
 * column (customs.ts, parseCommodities), and the parser, reading the unit
 * from the quantity cell, stored each commodity's quantity as a line named
 * for the number it found there: "Quantity (62.0)" for motor vehicles. Those
 * lines are not a figure Customs published under any name; they are the
 * parser's, so they are removed rather than retracted, trail and all. The
 * value line's misread April is a real period read wrongly, and the next
 * ingest revises it in place, keeping the trail.
 */
export function removeMisparsedQuantityLines(database: Database): number {
  const lines = database.query<{ key: string; region: string; label: string }, []>(`
    SELECT DISTINCT key, region, label FROM series
    WHERE key IN ('major_exports', 'major_exports_cny', 'major_imports', 'major_imports_cny') AND label LIKE 'Quantity (%'
  `).all().filter((row) => /^Quantity \([\d.,-]+\)$/.test(row.label));
  if (lines.length === 0) return 0;
  const dropObservations = database.prepare("DELETE FROM observations WHERE key = ? AND region = ? AND label = ?");
  const dropSeries = database.prepare("DELETE FROM series WHERE key = ? AND region = ? AND label = ?");
  let removed = 0;
  database.transaction(() => {
    for (const row of lines) { removed += dropObservations.run(row.key, row.region, row.label).changes; dropSeries.run(row.key, row.region, row.label); }
    // The running observation count is kept by hand (no rowid to count from); it comes down with the rows.
    database.query("UPDATE store_stats SET observations = MAX(0, observations - $removed) WHERE id = 1").run({ $removed: removed });
  })();
  console.log(`  Store: removed ${lines.length} commodity quantity lines named for a misread number (${removed} observations)`);
  return lines.length;
}

/**
 * A null revision for each (label, period) the source says it publishes no
 * figure for, where the store's latest value is not already null. The
 * observations table is append-only and the ingest writes only what it
 * reads, so a corrected parse that reads nothing for a period cannot on its
 * own take back what an earlier parse read from the wrong column; this does,
 * keeping the trail. Returns how many figures were retracted.
 */
export function retractUnpublished(key: string, region: string, unpublished: { labels: string[]; periods: string[] }, fetchedAt: string): number {
  if (unpublished.labels.length === 0 || unpublished.periods.length === 0) return 0;
  const database = db();
  const latest = database.prepare(`
    SELECT value FROM observations
    WHERE key = $key AND region = $region AND label = $label AND period = $period
    ORDER BY fetched_at DESC LIMIT 1
  `);
  const retract = database.prepare("INSERT OR IGNORE INTO observations (key, region, label, period, value, fetched_at) VALUES (?, ?, ?, ?, NULL, ?)");
  let count = 0;
  database.transaction(() => {
    for (const label of unpublished.labels) {
      for (const period of unpublished.periods) {
        const row = latest.get({ $key: key, $region: region, $label: label, $period: period }) as { value: number | null } | null;
        if (row === null || row.value === null) continue;
        retract.run(key, region, label, period, fetchedAt);
        count += 1;
      }
    }
    if (count > 0) database.query("INSERT INTO store_stats (id, observations) VALUES (1, $count) ON CONFLICT (id) DO UPDATE SET observations = observations + $count").run({ $count: count });
  })();
  return count;
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
  //
  // WITHOUT ROWID because every column but `value` is in the primary key and
  // every read is a prefix of it: an ordinary table would hold each row twice,
  // once in the table and once in the automatic primary-key index. At the size
  // the regional datasets take this store to, that duplication is gigabytes.
  database.exec(`
    CREATE TABLE IF NOT EXISTS observations (
      key         TEXT NOT NULL,
      region      TEXT NOT NULL DEFAULT '',
      label       TEXT NOT NULL,
      period      TEXT NOT NULL,
      value       REAL,
      fetched_at  TEXT NOT NULL,
      PRIMARY KEY (key, region, label, period, fetched_at)
    ) WITHOUT ROWID
  `);

  // One row per (key, region): the first period stored, the first with a
  // non-zero value, and the last. Kept by the write path. Without it, every
  // search and every ingest run walks the whole observations table to find
  // out where each series starts and ends, which is a scan of millions of
  // rows for an answer that changes only when something is written.
  database.exec(`
    CREATE TABLE IF NOT EXISTS series_range (
      key                TEXT NOT NULL,
      region             TEXT NOT NULL DEFAULT '',
      first_period       TEXT,
      first_real_period  TEXT,
      last_period        TEXT,
      periods            INTEGER NOT NULL DEFAULT 0,
      last_fetch         TEXT,
      PRIMARY KEY (key, region)
    ) WITHOUT ROWID
  `);

  // A running count of stored observations, kept by the write path. The
  // healthcheck needs a number without walking a table of millions of rows,
  // and a WITHOUT ROWID table has no rowid to take the maximum of.
  database.exec(`
    CREATE TABLE IF NOT EXISTS store_stats (
      id            INTEGER PRIMARY KEY CHECK (id = 1),
      observations  INTEGER NOT NULL DEFAULT 0
    )
  `);
  migrateObservationsStorage(database);
  // The summary gained its coverage columns after it first shipped.
  const rangeColumns = database.query<{ name: string }, []>("PRAGMA table_info(series_range)").all();
  if (!rangeColumns.some((column) => column.name === "periods")) {
    database.exec("ALTER TABLE series_range ADD COLUMN periods INTEGER NOT NULL DEFAULT 0");
    database.exec("ALTER TABLE series_range ADD COLUMN last_fetch TEXT");
    database.exec("DELETE FROM series_range");
  }
  backfillSeriesRanges(database);
  migrateFullHistoryChecks(database);
  retractMisreadFebruaries(database);
  removeMisparsedQuantityLines(database);

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

  // The health report asks the log for recent failures; without this that is a
  // scan of every row ever written (370,000 and growing), synchronously, on the
  // thread that also serves HTTP. It was, briefly, enough to take the site down.
  database.exec("CREATE INDEX IF NOT EXISTS fetch_log_status_time ON fetch_log (status, finished_at)");

  // fetch_log gained a region column after the first schema shipped; add it
  // to databases created before then. A blank region is a national or
  // curated series.
  const fetchLogColumns = database.query<{ name: string }, []>("PRAGMA table_info(fetch_log)").all();
  if (!fetchLogColumns.some((column) => column.name === "region")) {
    database.exec("ALTER TABLE fetch_log ADD COLUMN region TEXT NOT NULL DEFAULT ''");
  }
  // pruneFetchLog keeps the newest row of each (key, region, status); this is
  // what lets it ask "is there a newer one?" with a seek instead of a scan.
  database.exec("CREATE INDEX IF NOT EXISTS fetch_log_target_status ON fetch_log (key, region, status, id)");

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
  // How many periods each line holds, kept by the write path so the health
  // report can find a line with a single point without counting observations.
  // NULL means "not yet counted": a store that predates the column is counted
  // lazily, key by key, by singlePointLines, never in one pass at boot.
  if (!seriesColumns.some((column) => column.name === "periods")) {
    database.exec("ALTER TABLE series ADD COLUMN periods INTEGER");
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
  options: { historyWindow?: "full" | "recent" } = {},
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

  // The line's own period count, refreshed only when something in it was
  // written: one prefix read of the primary key, the same as series_range's.
  const countLinePeriods = database.prepare(`
    UPDATE series SET periods = (
      SELECT COUNT(DISTINCT period) FROM observations WHERE key = $key AND region = $region AND label = $label
    ) WHERE key = $key AND region = $region AND label = $label
  `);

  let points = 0;
  let changed = 0;

  const write = database.transaction((series: Series[]) => {
    for (const [position, one] of series.entries()) {
      const changedBeforeThisLine = changed;
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
      if (changed > changedBeforeThisLine) countLinePeriods.run({ $key: result.key, $region: region, $label: one.label });
    }
    // Same transaction as the rows themselves, so neither the count nor the
    // range summary can drift from what was actually written.
    if (changed > 0) {
      database.query("INSERT INTO store_stats (id, observations) VALUES (1, $changed) ON CONFLICT (id) DO UPDATE SET observations = observations + $changed")
        .run({ $changed: changed });
      database.query(`
        INSERT OR REPLACE INTO series_range (key, region, first_period, first_real_period, last_period, periods, last_fetch)
        SELECT key, region, MIN(period), MIN(CASE WHEN value <> 0 THEN period END), MAX(period),
               COUNT(DISTINCT period), MAX(fetched_at)
        FROM observations WHERE key = $key AND region = $region
      `).run({ $key: result.key, $region: region });
    }
    // A successful nonempty full answer advances the audit clock even when
    // every value was unchanged. Keep it in the observation transaction: a
    // failed write must not claim that its history has been checked.
    if (points > 0 && result.key.startsWith("nbs_")) {
      database.query(`
        INSERT INTO series_refresh_state (key, region, last_full_history_check, first_full_history_check_due_at)
        VALUES ($key, $region, $lastFull, $firstDue)
        ON CONFLICT (key, region) DO UPDATE SET last_full_history_check = CASE
          WHEN excluded.last_full_history_check IS NOT NULL AND
            (series_refresh_state.last_full_history_check IS NULL OR excluded.last_full_history_check > series_refresh_state.last_full_history_check)
          THEN excluded.last_full_history_check ELSE series_refresh_state.last_full_history_check END
      `).run({
        $key: result.key, $region: region,
        $lastFull: options.historyWindow === "full" ? fetchedAt : null,
        $firstDue: firstFullHistoryCheckDueAt(result.key, region, new Date(fetchedAt)),
      });
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
      -- A period whose latest revision is a retraction (a null row) has no value to serve.
      -- It was served as a null point, and every reader that did arithmetic on it (the share
      -- image, the Home sparkline, a latest-value tile) read it as 0. The trail keeps it.
      AND value IS NOT NULL
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

export function seriesFullHistoryCheck(key: string, region: string): FullHistoryCheckState {
  return db().query<FullHistoryCheckState, Record<string, string>>(`
    SELECT last_full_history_check AS lastFullHistoryCheck,
           first_full_history_check_due_at AS firstFullHistoryCheckDueAt
    FROM series_refresh_state WHERE key = $key AND region = $region
  `).get({ $key: key, $region: region }) ?? { lastFullHistoryCheck: null, firstFullHistoryCheckDueAt: null };
}

/** For each stored series with the prefix: its latest period and when it was last written. */
/** The most recently stored value for one observation, or null when the store has none. */
export function storedValue(key: string, region: string, label: string, period: string): number | null {
  const row = db().query<{ value: number | null }, Record<string, string>>(`
    SELECT value FROM observations
    WHERE key = $key AND region = $region AND label = $label AND period = $period
    ORDER BY fetched_at DESC
    LIMIT 1
  `).get({ $key: key, $region: region, $label: label, $period: period });
  return row?.value ?? null;
}

export function storedLatest(prefix: string): ({ key: string; region: string; firstPeriod: string | null; firstRealPeriod: string | null; lastPeriod: string | null; updatedAt: string | null } & FullHistoryCheckState)[] {
  // Read from the summary kept by the write path, not from the observations
  // themselves: the answer is the same and it does not walk the store.
  // firstRealPeriod is the first period with a non-zero value: NBS pads the months before an
  // indicator existed with 0.0, which the series page drops from level and index series.
  return db().query<{ key: string; region: string; firstPeriod: string | null; firstRealPeriod: string | null; lastPeriod: string | null; updatedAt: string | null } & FullHistoryCheckState, Record<string, string>>(`
    SELECT s.key AS key, s.region AS region,
           r.first_period AS firstPeriod, r.first_real_period AS firstRealPeriod, r.last_period AS lastPeriod,
           MAX(s.updated_at) AS updatedAt,
           f.last_full_history_check AS lastFullHistoryCheck,
           f.first_full_history_check_due_at AS firstFullHistoryCheckDueAt
    FROM series s LEFT JOIN series_range r ON r.key = s.key AND r.region = s.region
    LEFT JOIN series_refresh_state f ON f.key = s.key AND f.region = s.region
    WHERE s.key LIKE $prefix || '%'
    GROUP BY s.key, s.region
  `).all({ $prefix: prefix });
}

/**
 * The last release-day refresh, read back from fetch_log where each one is
 * recorded under the key "release_refresh" (points = series that gained the
 * new period, changed = the attempt number). In memory it would reset on
 * every deploy, and there are many.
 */
/**
 * Release-day checks from the fetch log, newest first: each release refresh
 * attempt with the series it found still behind, and each publisher-window
 * check with what arrived. A release that took days to land can be read
 * back attempt by attempt, to tell a publisher loading late from a check
 * that never ran.
 */
export function recentReleaseChecks(days = 14, limit = 300): { kind: string; release: string; at: string; attempt: number; arrived: number; message: string }[] {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  return db().query<{ kind: string; release: string; at: string; attempt: number; arrived: number; message: string }, Record<string, string | number>>(`
    SELECT key AS kind, region AS release, finished_at AS at, changed_count AS attempt, point_count AS arrived, message
    FROM fetch_log WHERE key IN ('release_attempt', 'publisher_window') AND finished_at > $cutoff
    ORDER BY id DESC LIMIT $limit
  `).all({ $cutoff: cutoff, $limit: limit });
}

export function lastReleaseRefresh(): { en: string; at: string; attempts: number; advanced: number } | null {
  const row = db().query<{ message: string; finishedAt: string; attempts: number; advanced: number }, []>(
    "SELECT message, finished_at AS finishedAt, changed_count AS attempts, point_count AS advanced FROM fetch_log WHERE key = 'release_refresh' ORDER BY id DESC LIMIT 1",
  ).get();
  return row ? { en: row.message, at: row.finishedAt, attempts: row.attempts, advanced: row.advanced } : null;
}


/**
 * (key, region) pairs whose recent fetches came back empty, as "key@region".
 *
 * Region matters here: an indicator the bureau lists for every province is
 * often published for only some of them, so a crawl that skipped the whole
 * series on one empty province would lose the provinces that do have it.
 */
export function recentlyEmptyTargets(prefix: string, days: number): Set<string> {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const rows = db().query<{ key: string; region: string }, Record<string, string>>(`
    SELECT DISTINCT key, region FROM fetch_log
    WHERE status = 'empty' AND key LIKE $prefix || '%' AND finished_at > $cutoff
  `).all({ $prefix: prefix, $cutoff: cutoff });
  return new Set(rows.map((row) => `${row.key}@${row.region}`));
}

/** Every distinct (key, region) in the store whose key starts with `prefix`. */
export function listStoredSeries(prefix: string): { key: string; region: string }[] {
  return db().query<{ key: string; region: string }, Record<string, string>>(`
    SELECT DISTINCT key, region FROM series WHERE key LIKE $prefix || '%' ORDER BY key, region
  `).all({ $prefix: prefix });
}

/** Coverage summary, for the /api/status route and for eyeballing an ingest. */
/**
 * A liveness check must not scan the store: with a million rows the status
 * summary takes seconds and a platform healthcheck runs it every few seconds,
 * stalling every other request behind it. This answers from one indexed
 * read and a cached summary.
 */
/**
 * Platform healthcheck. The observation count is kept for five minutes on its own,
 * so the answer is right from the first boot ping rather than zero until someone
 * has opened the status page; the full coverage summary is not computed here.
 */
export function dbHealth(): { ok: boolean; observations: number; lastFetch: string | null } {
  const database = db();
  database.query("SELECT 1").get();
  const last = database.query<{ finishedAt: string | null }, []>("SELECT MAX(finished_at) AS finishedAt FROM fetch_log WHERE status = 'ok'").get();
  const now = Date.now();
  if (cachedStatus && cachedStatusAt > healthCountAt) { healthCount = cachedStatus.totals.observations; healthCountAt = cachedStatusAt; }
  if (now - healthCountAt >= STATUS_TTL_MS) {
    // The running count, not COUNT(*): counting walks the whole store, which on a fresh
    // container's cold volume took 13 to 16 s on the first health calls after each deploy.
    // The count is kept by the write path (writeSeries) and seeded exactly when the
    // observations table is rebuilt. A store that has neither — a seed copied in before this
    // schema shipped — is counted once, here, and then kept up by the writes.
    // The status page's exact count replaces this figure whenever it is fresher (above).
    const row = database.query<{ observations: number | null }, []>("SELECT observations FROM store_stats WHERE id = 1").get();
    if (row) {
      healthCount = row.observations ?? 0;
    } else {
      const counted = database.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM observations").get()?.n ?? 0;
      database.query("INSERT OR REPLACE INTO store_stats (id, observations) VALUES (1, ?)").run(counted);
      healthCount = counted;
    }
    healthCountAt = now;
  }
  return { ok: true, observations: healthCount, lastFetch: last?.finishedAt ?? null };
}

let healthCount = 0;
let healthCountAt = 0;

let cachedStatus: ReturnType<typeof computeStatus> | null = null;
let cachedStatusAt = 0;
const STATUS_TTL_MS = 5 * 60 * 1000;

/**
 * Store status, cached for five minutes. The summary (size, totals, the last runs, the week's
 * failures) is cheap; the coverage list over all fifteen thousand (key, region) pairs is a group-by
 * across the whole store and a 2.6 MB payload, so it is computed and sent only when asked for
 * (`/api/status?series=1`). A status call during a boot ingest once hung for over a minute on it.
 */
/**
 * Every failing fetch recorded since a cutoff, grouped by series with a count
 * and the first and last time it failed.
 *
 * `dbStatus` also carries recent failures, but behind a five-minute cache and
 * capped at the last fifty rows: right for a monitor polling it, wrong for a
 * page whose whole question is what is broken now. A source failing on every
 * run also fills that cap on its own and hides the others. This asks the log
 * directly, for the window the page states.
 */
export function fetchFailures(sinceIso: string): { key: string; failures: number; since: string; latest: string; message: string }[] {
  // One indexed pass over the window, grouped here. The first version asked
  // SQLite for the newest message per key with a correlated subquery, which on
  // an unindexed table is a full scan of the log for every failing key — and
  // bun:sqlite is synchronous, so that ran on the thread serving HTTP. Polling
  // the health page was enough to stop the site answering at all.
  const rows = db().query<{ key: string; finishedAt: string; message: string }, { $since: string }>(`
    SELECT key, finished_at AS finishedAt, message
    FROM fetch_log
    WHERE status <> 'ok' AND finished_at >= $since
    ORDER BY finished_at ASC
  `).all({ $since: sinceIso });
  const grouped = new Map<string, { key: string; failures: number; since: string; latest: string; message: string }>();
  for (const row of rows) {
    const found = grouped.get(row.key);
    // Rows arrive oldest first, so the last one seen for a key is the newest.
    if (found) { found.failures += 1; found.latest = row.finishedAt; found.message = row.message; continue; }
    grouped.set(row.key, { key: row.key, failures: 1, since: row.finishedAt, latest: row.finishedAt, message: row.message });
  }
  return [...grouped.values()].sort((left, right) => right.failures - left.failures || left.key.localeCompare(right.key));
}

/** A stored line that holds exactly one period, and which period that is. */
export interface SinglePointLine { key: string; region: string; label: string; period: string | null }

/**
 * Lines of the named keys that hold a single period.
 *
 * A line with one point is worth a look. The parser may have invented it:
 * April 2025's Customs exports table dropped its unit column, the parser read
 * the quantity as the unit, and "Quantity (62.0)" sat beside the real quantity
 * line for months, flagged by nothing. Or the publisher changed a line's name
 * or unit and it split in two (Customs moved a quantity from "Ton" to "10,000
 * Tons"). Or the line is simply new. Read from the per-line count the write
 * path keeps in `series.periods`, never by counting observations. A line whose
 * count predates the column is counted here, once, for these keys only (the
 * curated ones, not the crawl's sixty thousand); a key with nothing left to
 * count costs one indexed lookup and no write.
 */
export function singlePointLines(keys: string[]): SinglePointLine[] {
  if (keys.length === 0) return [];
  const database = db();
  const hasUncounted = database.query<{ found: number }, { $key: string }>(
    "SELECT 1 AS found FROM series WHERE key = $key AND periods IS NULL LIMIT 1",
  );
  const countUncounted = database.prepare(`
    UPDATE series SET periods = (
      SELECT COUNT(DISTINCT o.period) FROM observations o
      WHERE o.key = series.key AND o.region = series.region AND o.label = series.label
    ) WHERE key = $key AND periods IS NULL
  `);
  const single = database.query<{ key: string; region: string; label: string }, { $key: string }>(
    "SELECT key, region, label FROM series WHERE key = $key AND periods = 1 ORDER BY region, position, label",
  );
  const onlyPeriod = database.query<{ period: string | null }, { $key: string; $region: string; $label: string }>(
    "SELECT MIN(period) AS period FROM observations WHERE key = $key AND region = $region AND label = $label",
  );
  const uncounted = keys.filter((key) => hasUncounted.get({ $key: key }) !== null);
  // One transaction for whatever is left to count, and none at all once everything has been.
  if (uncounted.length > 0) database.transaction(() => { for (const key of uncounted) countUncounted.run({ $key: key }); })();
  const out: SinglePointLine[] = [];
  for (const key of keys) {
    for (const line of single.all({ $key: key })) {
      out.push({ ...line, period: onlyPeriod.get({ $key: key, $region: line.region, $label: line.label })?.period ?? null });
    }
  }
  return out;
}

/**
 * The newest stored period of each place of the named keys, one row per
 * (key, region) that holds anything. Reads the summary on its primary key, so
 * the cost follows the keys asked about rather than the whole store.
 */
export function latestByRegion(keys: string[]): { key: string; region: string; lastPeriod: string | null }[] {
  if (keys.length === 0) return [];
  const statement = db().query<{ key: string; region: string; lastPeriod: string | null }, { $key: string }>(
    "SELECT key, region, last_period AS lastPeriod FROM series_range WHERE key = $key",
  );
  return [...new Set(keys)].flatMap((key) => statement.all({ $key: key }));
}

/**
 * The newest stored period for each of the named keys, at whichever region
 * reaches furthest. Reads the summary the write path keeps.
 *
 * `storedLatest("")` answers this too and is the wrong tool: it joins three
 * tables across every stored series — 78,000 of them, nearly all from the
 * catalog crawl — to answer a question about the 149 that are curated.
 */
export function latestPeriods(keys: string[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  if (keys.length === 0) return out;
  const statement = db().query<{ key: string; lastPeriod: string | null }, { $key: string }>(
    "SELECT key, MAX(last_period) AS lastPeriod FROM series_range WHERE key = $key",
  );
  for (const key of keys) out.set(key, statement.get({ $key: key })?.lastPeriod ?? null);
  return out;
}

/**
 * When each of the named keys last fetched successfully, if ever.
 *
 * A failure is only news while it is the latest thing that happened to a
 * source. The aggregate-financing keys failed ten times in five hours on the
 * morning their adapter was built, fetched cleanly thirty-seven minutes later,
 * and have every day since — and the health page listed them as "failing to
 * parse" for a fortnight, which sent one of those failures to the top of the
 * queue as a live bug. This is what tells a recovered source from a failing one.
 */
export function lastSuccessByKey(keys: string[]): Map<string, string> {
  const out = new Map<string, string>();
  if (keys.length === 0) return out;
  const statement = db().query<{ latest: string | null }, { $key: string }>(
    "SELECT MAX(finished_at) AS latest FROM fetch_log WHERE key = $key AND status = 'ok'",
  );
  for (const key of keys) { const latest = statement.get({ $key: key })?.latest; if (latest) out.set(key, latest); }
  return out;
}

/**
 * How long each kind of fetch_log row is kept once a newer row of the same
 * (key, region, status) exists. Each is longer than the longest window that
 * reads that kind: the health report's fortnight (failures, crawl attempts),
 * the crawl's thirty days of empty targets, a month of successes.
 */
export const FETCH_LOG_RETENTION_DAYS = { empty: 14, ok: 31, error: 45 } as const;

/**
 * Deletes the superseded fetch_log rows among ids [fromId, fromId + span) and
 * returns how many went and where the next slice starts (back to the first
 * row once the slice passes the end, with `wrapped` set).
 *
 * The log grew by about 62,000 rows a day and was never pruned: it, not the
 * observations, was what made each backup larger. A row goes only when a
 * newer row of the same (key, region, status) exists and it is older than its
 * kind's retention, so the newest success, the newest empty answer and the
 * newest error of every target stay, whatever their age, and every reader's
 * window is still whole. Successes that changed values are kept: they are the
 * record of when a revision arrived.
 *
 * Most of the log is one row per target, not repeats: the crawl does not
 * re-ask an empty target for thirty days. So little is deletable at any time
 * and this is a guard against regrowth; it must stay cheap. Work per call is
 * bounded by the id slice, not by what is deletable. The
 * first version asked for "up to N deletable rows anywhere", which SQLite
 * answered by scanning the whole log: 3.7 s on the thread serving HTTP, to
 * find 108 rows, because most of the log was still inside its windows.
 */
export function pruneFetchLog(fromId: number, span = 5_000, now = Date.now()): { removed: number; nextId: number; wrapped: boolean } {
  const before = (days: number) => new Date(now - days * 86_400_000).toISOString();
  const restart = () => db().query<{ id: number | null }, []>("SELECT MIN(id) AS id FROM fetch_log").get()?.id ?? 0;
  // Ids rise with time, so once a whole slice is younger than the shortest
  // window nothing from there on can be deleted yet: the sweep is done. The
  // whole slice, not its first row, so one row logged out of order cannot
  // end every sweep early. A slice with no rows (ids freed by earlier
  // prunes) skips to the next row that exists.
  const slice = db().query<{ oldest: string | null }, { $from: number; $to: number }>(
    "SELECT MIN(finished_at) AS oldest FROM fetch_log WHERE id >= $from AND id < $to",
  ).get({ $from: fromId, $to: fromId + span });
  if (!slice?.oldest) {
    const next = db().query<{ id: number }, { $from: number }>("SELECT id FROM fetch_log WHERE id >= $from ORDER BY id LIMIT 1").get({ $from: fromId + span });
    return next ? { removed: 0, nextId: next.id, wrapped: false } : { removed: 0, nextId: restart(), wrapped: true };
  }
  const shortest = before(Math.min(...Object.values(FETCH_LOG_RETENTION_DAYS)));
  if (slice.oldest >= shortest) return { removed: 0, nextId: restart(), wrapped: true };
  const removed = db().query<never, Record<string, string | number>>(`
    DELETE FROM fetch_log WHERE id IN (
      SELECT f.id FROM fetch_log f
      WHERE f.id >= $from AND f.id < $to
        AND ((f.status = 'empty' AND f.finished_at < $empty)
          OR (f.status = 'ok' AND f.changed_count = 0 AND f.finished_at < $ok)
          OR (f.status NOT IN ('ok', 'empty') AND f.finished_at < $error))
        AND EXISTS (SELECT 1 FROM fetch_log n WHERE n.key = f.key AND n.region = f.region AND n.status = f.status AND n.id > f.id)
    )
  `).run({
    $from: fromId, $to: fromId + span,
    $empty: before(FETCH_LOG_RETENTION_DAYS.empty), $ok: before(FETCH_LOG_RETENTION_DAYS.ok), $error: before(FETCH_LOG_RETENTION_DAYS.error),
  }).changes;
  return { removed, nextId: fromId + span, wrapped: false };
}

/** The oldest failure the log still holds, so "nothing failing" can be read as "none since". */
export function fetchLogOldest(): string | null {
  return db().query<{ oldest: string | null }, []>("SELECT MIN(finished_at) AS oldest FROM fetch_log").get()?.oldest ?? null;
}

export function dbStatus() {
  const now = Date.now();
  if (!cachedStatus || now - cachedStatusAt >= STATUS_TTL_MS) { cachedStatus = computeStatus(); cachedStatusAt = now; }
  return cachedStatus;
}

/** The summary plus coverage per (key, region), for `/api/status?series=1`. */
export function dbStatusWithSeries(limit = 2000, offset = 0) {
  const total = db().query<{ n: number }, []>("SELECT COUNT(*) AS n FROM series_range").get()?.n ?? 0;
  const page = Math.min(Math.max(1, limit), 20000);
  const from = Math.max(0, offset);
  return { ...dbStatus(), coverage: { total, limit: page, offset: from }, perSeries: computePerSeries(page, from) };
}


/**
 * Coverage per (key, region), a page at a time, from the summary the write
 * path keeps. Reading it from the observations themselves was a group-by over
 * the whole store and, at the size the regional datasets bring, a response of
 * tens of megabytes.
 */
function computePerSeries(limit: number, offset: number) {
  return db().query(`
    SELECT key, region, periods, first_period AS firstPeriod, last_period AS lastPeriod, last_fetch AS lastFetch
    FROM series_range
    ORDER BY key, region
    LIMIT $limit OFFSET $offset
  `).all({ $limit: limit, $offset: offset });
}

function computeStatus() {
  const database = db();
  const sizeBytes = (() => { try { return Bun.file(DB_PATH).size; } catch { return 0; } })();
  // From the summaries the write path keeps, not from the observations
  // themselves: counting ten million rows took seconds and this route is
  // called by anything watching the store, every five minutes.
  const counted = database.query<{ observations: number | null }, []>("SELECT observations FROM store_stats WHERE id = 1").get();
  const summary = database.query<{ keys: number; lastFetch: string | null }, []>(
    "SELECT COUNT(DISTINCT key) AS keys, MAX(last_fetch) AS lastFetch FROM series_range",
  ).get();
  const totals = {
    observations: counted?.observations ?? 0,
    keys: summary?.keys ?? 0,
    lastFetch: summary?.lastFetch ?? null,
  };

  // The fetch log grows by a run per series on every boot ingest (about 140 rows), so its size is
  // reported here for the audit that decides when to prune it.
  const fetchLogRow = database.query<{ rows: number; oldest: string | null }, []>("SELECT COUNT(*) AS rows, MIN(finished_at) AS oldest FROM fetch_log").get();
  const fetchLog = { rows: fetchLogRow?.rows ?? 0, oldest: fetchLogRow?.oldest ?? null };

  const recentRuns = database.prepare(`
    SELECT key, region, status, point_count AS points, changed_count AS changed,
           finished_at AS finishedAt, message
    FROM fetch_log
    ORDER BY id DESC
    LIMIT 20
  `).all();

  // The last twenty runs are usually one regional table's seventy cities, so
  // failures get their own list: every error from the past seven days, newest first.
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const recentFailures = database.prepare(`
    SELECT key, region, status, point_count AS points, changed_count AS changed,
           finished_at AS finishedAt, message
    FROM fetch_log
    WHERE status = 'error' AND finished_at > $weekAgo
    ORDER BY id DESC
    LIMIT 50
  `).all({ $weekAgo: weekAgo });

  return { sizeBytes,
    path: DB_PATH, totals, fetchLog, recentRuns, recentFailures };
}

/**
 * Write a consistent copy of the store to `path` and return its size.
 *
 * `VACUUM INTO` takes the copy inside a read transaction, so an ingest writing
 * at the same time cannot tear it, and the copy comes out compact rather than
 * carrying the free pages the running store keeps. It is the supported way to
 * back up SQLite while it is in use; copying the file with the operating system
 * is not, because the write-ahead log lives beside it.
 */
export function backupStore(path: string): number {
  db().query("VACUUM INTO ?").run(path);
  return Bun.file(path).size;
}
