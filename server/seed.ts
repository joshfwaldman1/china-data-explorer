/**
 * Refresh the committed seed snapshot from the live store. Run after a good
 * ingest; commit the result. A fresh deployment copies it in on first boot.
 *
 *   bun run china:seed
 */

import { Database } from "bun:sqlite";
import { copyFileSync, mkdirSync, renameSync } from "node:fs";

const live = process.env.CHINA_DB_PATH ?? `${import.meta.dir}/../china.db`;
const seed = `${import.meta.dir}/../seed/china.db`;

// The seed is the headline series only. The full store holds the whole NBS
// catalog (hundreds of megabytes) and rebuilds itself from NBS in half an
// hour, so it has no business in git. Copy the live file, strip the catalog
// series, compact, then move into place.
mkdirSync(`${import.meta.dir}/../seed`, { recursive: true });
const scratch = `${seed}.tmp`;
const source = new Database(live);
source.exec("PRAGMA wal_checkpoint(TRUNCATE)");
source.close();
copyFileSync(live, scratch);
const database = new Database(scratch);
for (const table of ["observations", "series", "fetch_log"]) database.exec(`DELETE FROM ${table} WHERE key LIKE 'nbs_%'`);
database.exec("VACUUM");
const totals = database.query<{ n: number; k: number }, []>("SELECT COUNT(*) AS n, COUNT(DISTINCT key) AS k FROM observations").get();
database.close();
renameSync(scratch, seed);
const size = Bun.file(seed).size;
if (size > 20 * 1024 * 1024) throw new Error(`Seed is ${Math.round(size / 1e6)} MB; it should be a few megabytes. Not committing that.`);
console.log(`Seed written: ${seed} — ${totals?.n ?? 0} observations across ${totals?.k ?? 0} headline series, ${Math.round(size / 1e6)} MB`);
