import { Database } from "bun:sqlite";
import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";

export interface BackupManifest {
  version: 1;
  createdAt: string;
  sha256: string;
  sizeBytes: number;
  integrityCheck: "ok";
  observations: number;
  series: number;
  fetchLog: number;
  latestPeriod: string | null;
  lastSuccessfulFetch: string | null;
}

/** Run in a backup/verification process, never in the HTTP process. */
export async function inspectBackup(path: string): Promise<BackupManifest> {
  const file = await lstat(path);
  if (!file.isFile() || file.size === 0) throw new Error("Backup must be a nonempty regular file");
  // Importing db.ts here would seed or migrate the database we are checking.
  const database = new Database(path, { readonly: true, create: false });
  let facts: Omit<BackupManifest, "version" | "createdAt" | "sha256" | "sizeBytes" | "integrityCheck">;
  try {
    const integrity = database.query<{ integrity_check: string }, []>("PRAGMA integrity_check").all();
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") throw new Error("SQLite integrity check failed");
    if (database.query("PRAGMA foreign_key_check").all().length) throw new Error("SQLite foreign key check failed");
    const observations = database.query<{ count: number; latestPeriod: string | null }, []>("SELECT COUNT(*) AS count, MAX(period) AS latestPeriod FROM observations").get();
    const series = database.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM series").get()?.count ?? 0;
    const fetchLog = database.query<{ count: number; lastSuccessfulFetch: string | null }, []>("SELECT COUNT(*) AS count, MAX(CASE WHEN status = 'ok' THEN finished_at END) AS lastSuccessfulFetch FROM fetch_log").get();
    if (!observations?.count || !series) throw new Error("Backup has no stored series or observations");
    facts = { observations: observations.count, series, fetchLog: fetchLog?.count ?? 0, latestPeriod: observations.latestPeriod, lastSuccessfulFetch: fetchLog?.lastSuccessfulFetch ?? null };
  } finally {
    database.close();
  }
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of createReadStream(path)) hasher.update(chunk);
  return { version: 1, createdAt: new Date().toISOString(), sha256: hasher.digest("hex"), sizeBytes: file.size, integrityCheck: "ok", ...facts };
}

export function parseBackupManifest(value: unknown): BackupManifest {
  if (typeof value !== "object" || value === null) throw new Error("Invalid backup manifest");
  const version = Reflect.get(value, "version");
  const createdAt = Reflect.get(value, "createdAt");
  const sha256 = Reflect.get(value, "sha256");
  const sizeBytes = Reflect.get(value, "sizeBytes");
  const integrityCheck = Reflect.get(value, "integrityCheck");
  const observations = Reflect.get(value, "observations");
  const series = Reflect.get(value, "series");
  const fetchLog = Reflect.get(value, "fetchLog");
  const latestPeriod = Reflect.get(value, "latestPeriod");
  const lastSuccessfulFetch = Reflect.get(value, "lastSuccessfulFetch");
  if (version !== 1 || typeof createdAt !== "string" || !Number.isFinite(Date.parse(createdAt)) ||
      typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256) || integrityCheck !== "ok" ||
      !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || !Number.isSafeInteger(observations) || observations <= 0 ||
      !Number.isSafeInteger(series) || series <= 0 || !Number.isSafeInteger(fetchLog) || fetchLog < 0 ||
      (latestPeriod !== null && typeof latestPeriod !== "string") || (lastSuccessfulFetch !== null && typeof lastSuccessfulFetch !== "string")) {
    throw new Error("Invalid backup manifest");
  }
  return { version, createdAt, sha256, sizeBytes, integrityCheck, observations, series, fetchLog, latestPeriod, lastSuccessfulFetch };
}

export function assertBackupMatches(actual: BackupManifest, expected: BackupManifest): void {
  for (const key of ["sha256", "sizeBytes", "observations", "series", "fetchLog", "latestPeriod", "lastSuccessfulFetch"] as const) {
    if (actual[key] !== expected[key]) throw new Error(`Backup manifest mismatch: ${key}`);
  }
}
