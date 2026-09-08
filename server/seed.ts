/**
 * Refresh the committed seed snapshot from the live store. Run after a good
 * ingest; commit the result. A fresh deployment copies it in on first boot.
 *
 *   bun run china:seed
 */

import { Database } from "bun:sqlite";
import { copyFileSync, mkdirSync } from "node:fs";

const live = process.env.CHINA_DB_PATH ?? `${import.meta.dir}/../china.db`;
const seed = `${import.meta.dir}/../seed/china.db`;

// Fold the write-ahead log into the main file and compact before copying.
const database = new Database(live);
database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
database.exec("VACUUM");
const totals = database.query<{ n: number; k: number }, []>("SELECT COUNT(*) AS n, COUNT(DISTINCT key) AS k FROM observations").get();
database.close();

mkdirSync(`${import.meta.dir}/../seed`, { recursive: true });
copyFileSync(live, seed);
console.log(`Seed written: ${seed} — ${totals?.n ?? 0} observations across ${totals?.k ?? 0} series`);
