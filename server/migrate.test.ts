/**
 * The observations table changed shape once the regional datasets made its
 * size matter: the redundant lookup index went, and the table became WITHOUT
 * ROWID so a row is stored once rather than twice. A store written by the
 * earlier schema has to come through that unchanged, so this builds one in the
 * old shape and opens it the way a deployment would.
 *
 * Opening happens in a child process: db.ts reads its path once, at import,
 * and the other test files in this suite have already imported it.
 */

import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const DB_MODULE = resolve(import.meta.dir, "db.ts");

/** A store in the schema that shipped before the rebuild, holding `rows` observations. */
function legacyStore(path: string, rows: { key: string; period: string; value: number }[]): void {
  const database = new Database(path, { create: true });
  database.exec(`
    CREATE TABLE series (
      key TEXT NOT NULL, region TEXT NOT NULL DEFAULT '', label TEXT NOT NULL,
      title TEXT NOT NULL, agency TEXT NOT NULL, frequency TEXT NOT NULL,
      unit TEXT NOT NULL, source_url TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (key, region, label)
    )
  `);
  database.exec(`
    CREATE TABLE observations (
      key TEXT NOT NULL, region TEXT NOT NULL DEFAULT '', label TEXT NOT NULL,
      period TEXT NOT NULL, value REAL, fetched_at TEXT NOT NULL,
      PRIMARY KEY (key, region, label, period, fetched_at)
    )
  `);
  database.exec("CREATE INDEX idx_observations_lookup ON observations (key, region, label, period, fetched_at DESC)");
  database.exec(`
    CREATE TABLE fetch_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL, status TEXT NOT NULL, point_count INTEGER NOT NULL DEFAULT 0,
      changed_count INTEGER NOT NULL DEFAULT 0, message TEXT NOT NULL DEFAULT '', region TEXT NOT NULL DEFAULT ''
    )
  `);
  database.query("INSERT INTO series VALUES ('cpi_t', '', '全国', 'CPI', 'NBS', 'Monthly', '%', '', '2026-01-01T00:00:00.000Z', 0)").run();
  const insert = database.prepare("INSERT INTO observations (key, region, label, period, value, fetched_at) VALUES (?, '', '全国', ?, ?, ?)");
  for (const row of rows) insert.run(row.key, row.period, row.value, "2026-01-01T00:00:00.000Z");
  database.close();
}

/** Open the store through db.ts in a child process and report what it found. */
async function openStore(path: string): Promise<{ withoutRowid: boolean; indexes: string[]; observations: number; health: number; cpi: number | undefined }> {
  const script = `
    import { db, dbHealth, readSeries } from ${JSON.stringify(DB_MODULE)};
    const database = db();
    const sql = database.query("SELECT sql FROM sqlite_master WHERE name = 'observations'").get().sql;
    const indexes = database.query("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'observations'").all().map((row) => row.name);
    const observations = database.query("SELECT COUNT(*) AS n FROM observations").get().n;
    const series = readSeries("cpi_t", 10, "");
    console.log(JSON.stringify({
      withoutRowid: /WITHOUT ROWID/i.test(sql),
      indexes,
      observations,
      health: dbHealth().observations,
      cpi: series?.series[0]?.points.at(-1)?.value,
    }));
  `;
  const child = Bun.spawn(["bun", "-e", script], {
    env: { ...process.env, CHINA_DB_PATH: path, CHINA_SEED: "off" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = await new Response(child.stdout).text();
  const errors = await new Response(child.stderr).text();
  const line = output.trim().split("\n").at(-1) ?? "";
  if (!line.startsWith("{")) throw new Error(`child produced no result: ${output}${errors}`);
  return JSON.parse(line);
}

test("a store written by the old schema is rebuilt without losing observations", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "china-migrate-")), "old.db");
  legacyStore(path, [
    { key: "cpi_t", period: "2026-06", value: 0.1 },
    { key: "cpi_t", period: "2026-07", value: 0.5 },
    { key: "cpi_t", period: "2026-08", value: 0.8 },
  ]);

  const first = await openStore(path);
  expect(first.observations).toBe(3);
  expect(first.withoutRowid).toBe(true);
  expect(first.indexes).toEqual([]);
  expect(first.cpi).toBe(0.8);
  // The rebuild counts the table it copies, so the healthcheck is exact without a scan.
  expect(first.health).toBe(3);

  // Opening again is a no-op: nothing to migrate, nothing lost.
  const second = await openStore(path);
  expect(second.observations).toBe(3);
  expect(second.withoutRowid).toBe(true);
  expect(second.health).toBe(3);
}, 30_000);

test("a store already in the current shape keeps its running count across writes", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "china-count-")), "new.db");
  const script = `
    import { db, writeSeries, dbHealth } from ${JSON.stringify(DB_MODULE)};
    db();
    const series = (points) => ({ key: "t", title: "T", agency: "NBS", sourceUrl: "", frequency: "Monthly", unit: "%", series: [{ label: "全国", points }] });
    writeSeries(series([{ date: "2026-01", value: 1 }, { date: "2026-02", value: 2 }]), "", "2026-01-01T00:00:00.000Z");
    writeSeries(series([{ date: "2026-01", value: 1 }, { date: "2026-02", value: 9 }]), "", "2026-02-01T00:00:00.000Z");
    console.log(JSON.stringify({ health: dbHealth().observations, counted: db().query("SELECT COUNT(*) AS n FROM observations").get().n }));
  `;
  const child = Bun.spawn(["bun", "-e", script], { env: { ...process.env, CHINA_DB_PATH: path, CHINA_SEED: "off" }, stdout: "pipe", stderr: "pipe" });
  const output = (await new Response(child.stdout).text()).trim().split("\n").at(-1) ?? "";
  const result = JSON.parse(output);
  // Two first sightings and one revision: the unchanged repeat writes nothing.
  expect(result.counted).toBe(3);
  expect(result.health).toBe(3);
}, 30_000);

test("legacy full-history clocks remain unknown and their first audits are staggered once across restarts", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "china-revision-migrate-")), "old.db");
  legacyStore(path, [{ key: "cpi_t", period: "2026-08", value: 1 }]);
  const legacy = new Database(path);
  const addSeries = legacy.prepare(`INSERT INTO series
    SELECT ?, region, label, title, agency, frequency, unit, source_url, updated_at, position
    FROM series WHERE key = 'cpi_t'`);
  for (let index = 0; index < 90; index += 1) addSeries.run(`nbs_legacy_audit_${index}`);
  const addObservation = legacy.prepare(`INSERT INTO observations
    SELECT ?, region, label, period, value, fetched_at FROM observations WHERE key = 'cpi_t'`);
  for (let index = 0; index < 90; index += 1) addObservation.run(`nbs_legacy_audit_${index}`);
  legacy.close();

  async function states(recentRefresh: boolean) {
    const script = `
      import { db, writeSeries } from ${JSON.stringify(DB_MODULE)};
      const database = db();
      if (${recentRefresh}) writeSeries({ key: 'nbs_legacy_audit_0', title: 'CPI', agency: 'NBS', sourceUrl: '', frequency: 'Monthly', unit: '%', series: [{ label: '全国', points: [{ date: '2026-08', value: 1 }] }] }, '', new Date().toISOString(), { historyWindow: 'recent' });
      console.log(JSON.stringify(database.query('SELECT key, last_full_history_check AS lastFull, first_full_history_check_due_at AS firstDue FROM series_refresh_state ORDER BY key').all()));
    `;
    const child = Bun.spawn(["bun", "-e", script], {
      env: { ...process.env, CHINA_DB_PATH: path, CHINA_SEED: "off" }, stdout: "pipe", stderr: "pipe",
    });
    const output = await new Response(child.stdout).text();
    const errors = await new Response(child.stderr).text();
    expect(await child.exited).toBe(0);
    const line = output.trim().split("\n").at(-1) ?? "";
    if (!line.startsWith("[")) throw new Error(`${output}${errors}`);
    const rows: { key: string; lastFull: string | null; firstDue: string }[] = JSON.parse(line);
    return rows;
  }

  const startedAt = Date.now();
  const first = await states(false);
  const finishedAt = Date.now();
  expect(first).toHaveLength(90);
  expect(new Set(first.map((row) => row.firstDue)).size).toBeGreaterThan(20);
  for (const row of first) {
    expect(row.lastFull).toBeNull();
    expect(Date.parse(row.firstDue)).toBeGreaterThanOrEqual(startedAt + 86400000);
    expect(Date.parse(row.firstDue)).toBeLessThanOrEqual(finishedAt + 45 * 86400000);
  }
  expect(await states(true)).toEqual(first);
  expect(await states(false)).toEqual(first);
  const migrated = new Database(path, { readonly: true });
  expect(migrated.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM observations").get()?.n).toBe(91);
  migrated.close();
}, 30_000);
