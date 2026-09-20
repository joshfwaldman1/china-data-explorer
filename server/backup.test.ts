import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackupManager, cleanupStaleBackups } from "./backup";
import { assertBackupMatches, inspectBackup, parseBackupManifest } from "./backup-validation";
import { writeBackupSnapshot } from "./backup-worker";
import { manifestFromHeaders, verifyBackup } from "../scripts/verify-backup";

const scratches: string[] = [];
async function scratch() {
  const directory = await mkdtemp(join(tmpdir(), "china-backup-test-"));
  scratches.push(directory);
  return directory;
}
afterEach(async () => {
  for (const path of scratches.splice(0)) await rm(path, { recursive: true, force: true });
});

/** Deliberately an old, small schema: a backup must not migrate or seed it. */
function sourceStore(path: string) {
  const database = new Database(path, { create: true });
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE series (key TEXT PRIMARY KEY);
    CREATE TABLE observations (key TEXT, period TEXT, value REAL, fetched_at TEXT,
      PRIMARY KEY (key, period, fetched_at));
    CREATE TABLE fetch_log (status TEXT, finished_at TEXT);
    INSERT INTO series VALUES ('cpi');
    INSERT INTO observations VALUES ('cpi', '2026-08', 1.1, '2026-09-10'), ('cpi', '2026-08', 1.2, '2026-09-11');
    INSERT INTO fetch_log VALUES ('ok', '2026-09-11');
  `);
  return database;
}

test("a subprocess snapshot includes WAL revisions, leaves the source schema alone and restores independently", async () => {
  const directory = await scratch();
  const path = join(directory, "source.db");
  const source = sourceStore(path);
  try {
    expect(existsSync(`${path}-wal`)).toBe(true);
    const schema = source.query("SELECT name, sql FROM sqlite_master ORDER BY name").all();
    const manager = createBackupManager({ sourcePath: path });
    const response = await manager.createResponse();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const expected = manifestFromHeaders(`HTTP/1.1 200 OK\r\nX-Backup-Manifest: ${response.headers.get("x-backup-manifest")}\r\n\r\n`);
    expect(expected.observations).toBe(2);
    source.exec("INSERT INTO observations VALUES ('cpi', '2026-09', 1.3, '2026-10-10')");
    const downloaded = join(directory, "downloaded.db");
    await Bun.write(downloaded, await response.arrayBuffer());
    expect(Number(response.headers.get("content-length"))).toBe((await lstat(downloaded)).size);
    expect((await verifyBackup(downloaded, expected)).sha256).toBe(expected.sha256);
    expect(await readdir(join(directory, ".china-backups"))).toEqual([]);
    expect(source.query("SELECT name, sql FROM sqlite_master ORDER BY name").all()).toEqual(schema);
    const restored = new Database(downloaded, { readonly: true });
    expect(restored.query("SELECT value FROM observations ORDER BY fetched_at").all()).toEqual([{ value: 1.1 }, { value: 1.2 }]);
    restored.close();
  } finally { source.close(); }
});

test("one copy or download holds the slot, and cancelling the download removes it and frees the slot", async () => {
  const directory = await scratch();
  const path = join(directory, "source.db");
  const source = sourceStore(path);
  source.close();
  const manager = createBackupManager({ sourcePath: path });
  const first = manager.createResponse();
  const busy = await manager.createResponse();
  expect(busy.status).toBe(429);
  expect(busy.headers.get("retry-after")).toBe("60");
  const response = await first;
  expect(response.status).toBe(200);
  expect((await manager.createResponse()).status).toBe(429);
  await response.body?.cancel();
  expect(await readdir(join(directory, ".china-backups"))).toEqual([]);
  const next = await manager.createResponse();
  expect(next.status).toBe(200);
  await next.body?.cancel();
});

test("an aborted request kills its copy and a later request can take a backup", async () => {
  const directory = await scratch();
  const path = join(directory, "source.db");
  sourceStore(path).close();
  const manager = createBackupManager({ sourcePath: path });
  const controller = new AbortController();
  const pending = manager.createResponse(controller.signal);
  controller.abort();
  expect((await pending).status).toBe(499);
  expect(await readdir(join(directory, ".china-backups"))).toEqual([]);
  const response = await manager.createResponse();
  expect(response.status).toBe(200);
  await response.body?.cancel();
});

test("a worker timeout is bounded and leaves no partial snapshot", async () => {
  const directory = await scratch();
  const path = join(directory, "source.db");
  sourceStore(path).close();
  const manager = createBackupManager({ sourcePath: path, timeoutMs: 1 });
  expect((await manager.createResponse()).status).toBe(504);
  expect(await readdir(join(directory, ".china-backups"))).toEqual([]);
  expect((await manager.createResponse()).status).not.toBe(429);
});

test("a stalled download expires instead of keeping its snapshot and slot forever", async () => {
  const directory = await scratch();
  const path = join(directory, "source.db");
  sourceStore(path).close();
  const manager = createBackupManager({ sourcePath: path, streamTimeoutMs: 10 });
  const response = await manager.createResponse();
  const reader = response.body!.getReader();
  // A network consumer observes its stream's closure even when it stops reading.
  void reader.closed.catch(() => undefined);
  await Bun.sleep(40);
  await expect(reader.read()).rejects.toThrow("cancelled");
  expect(await readdir(join(directory, ".china-backups"))).toEqual([]);
  const next = await manager.createResponse();
  expect(next.status).toBe(200);
  await next.body?.cancel();
});

test("disconnecting during a download closes the file and clears the temporary directory", async () => {
  const directory = await scratch();
  const path = join(directory, "source.db");
  sourceStore(path).close();
  const manager = createBackupManager({ sourcePath: path });
  const controller = new AbortController();
  const response = await manager.createResponse(controller.signal);
  const reader = response.body!.getReader();
  void reader.closed.catch(() => undefined);
  controller.abort();
  await expect(reader.read()).rejects.toThrow("cancelled");
  for (let attempt = 0; attempt < 20 && (await readdir(join(directory, ".china-backups"))).length; attempt++) await Bun.sleep(5);
  expect(await readdir(join(directory, ".china-backups"))).toEqual([]);
  const next = await manager.createResponse();
  expect(next.status).toBe(200);
  await next.body?.cancel();
});

test("a missing source is never created and a failed worker releases the slot", async () => {
  const directory = await scratch();
  const path = join(directory, "missing.db");
  const manager = createBackupManager({ sourcePath: path });
  expect((await manager.createResponse()).status).toBe(500);
  expect(existsSync(path)).toBe(false);
  expect(await readdir(join(directory, ".china-backups"))).toEqual([]);
  sourceStore(path).close();
  const response = await manager.createResponse();
  expect(response.status).toBe(200);
  await response.body?.cancel();
}, 60_000);

test("a snapshot refuses an existing destination, the source itself, and a source symlink", async () => {
  const directory = await scratch();
  const path = join(directory, "source.db");
  sourceStore(path).close();
  const existing = join(directory, "existing.db");
  await writeFile(existing, "keep this file");
  await expect(writeBackupSnapshot(path, existing)).rejects.toThrow("already exists");
  expect(await Bun.file(existing).text()).toBe("keep this file");
  await expect(writeBackupSnapshot(path, path)).rejects.toThrow("differ");
  const linked = join(directory, "source-link.db");
  await symlink(path, linked);
  await expect(writeBackupSnapshot(linked, join(directory, "new.db"))).rejects.toThrow("regular file");
});

test("cleanup removes only abandoned private snapshot directories", async () => {
  const directory = await scratch();
  const old = join(directory, "snapshot-old123");
  const recent = join(directory, "snapshot-new123");
  const unrelated = join(directory, "other-data");
  for (const path of [old, recent, unrelated]) await mkdir(path);
  const linked = join(directory, "snapshot-link123");
  await symlink(unrelated, linked);
  const yesterday = new Date(Date.now() - 2 * 24 * 60 * 60_000);
  await utimes(old, yesterday, yesterday);
  await utimes(unrelated, yesterday, yesterday);
  await cleanupStaleBackups(directory, 24 * 60 * 60_000);
  expect((await readdir(directory)).sort()).toEqual(["other-data", "snapshot-link123", "snapshot-new123"]);
});

test("manifest validation rejects altered downloads, invented counts and missing response provenance", async () => {
  const directory = await scratch();
  const path = join(directory, "source.db");
  sourceStore(path).close();
  const manifest = await inspectBackup(path);
  expect(() => assertBackupMatches(manifest, { ...manifest, observations: 999 })).toThrow("observations");
  await expect(verifyBackup(path, { ...manifest, sha256: "0".repeat(64) })).rejects.toThrow("sha256");
  expect(() => parseBackupManifest({ ...manifest, sizeBytes: -1 })).toThrow("Invalid");
  expect(() => manifestFromHeaders("HTTP/1.1 200 OK\r\n\r\n")).toThrow("exactly one");
  const encoded = Buffer.from(JSON.stringify(manifest)).toString("base64");
  expect(manifestFromHeaders(`HTTP/1.1 502 Bad Gateway\r\n\r\nHTTP/1.1 200 OK\r\nx-backup-manifest: ${encoded}\r\n\r\n`)).toEqual(manifest);
  expect(() => manifestFromHeaders(`HTTP/1.1 200 OK\r\nx-backup-manifest: ${encoded}\r\nx-backup-manifest: ${encoded}`)).toThrow("exactly one");
  const broken = join(directory, "broken.db");
  await copyFile(path, broken);
  await writeFile(broken, "not a SQLite database");
  await expect(inspectBackup(broken)).rejects.toThrow();
});

test("the workflow verifier writes checksummed restore evidence only for a verified artifact", async () => {
  const directory = await scratch();
  const path = join(directory, "downloaded.db");
  const source = join(directory, "source.db");
  sourceStore(source).close();
  await writeBackupSnapshot(source, path);
  const manifest = await inspectBackup(path);
  const headers = join(directory, "headers.txt");
  const verify = async (metadata: string) => {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "../scripts/verify-backup.ts"), path, metadata], { stdout: "pipe", stderr: "pipe" });
    const [output, errors, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { output, errors, code };
  };
  await writeFile(headers, `HTTP/1.1 200 OK\r\nX-Backup-Manifest: ${Buffer.from(JSON.stringify({ ...manifest, observations: 999 })).toString("base64")}\r\n\r\n`);
  const bad = await verify(headers);
  expect(bad.code).toBe(1);
  expect(bad.errors).toContain("manifest mismatch: observations");
  expect(existsSync(`${path}.manifest.json`)).toBe(false);
  expect(existsSync(`${path}.sha256`)).toBe(false);
  await writeFile(headers, `HTTP/1.1 200 OK\r\nX-Backup-Manifest: ${Buffer.from(JSON.stringify(manifest)).toString("base64")}\r\n\r\n`);
  const good = await verify(headers);
  expect(good.errors).toBe("");
  expect(good.code).toBe(0);
  expect(good.output).toContain("Verified and restored 2 observations");
  const saved = await Bun.file(`${path}.manifest.json`).json();
  expect(saved.restoreVerified).toBe(true);
  expect(saved.sha256).toBe(manifest.sha256);
  expect(await Bun.file(`${path}.sha256`).text()).toBe(`${manifest.sha256}  downloaded.db\n`);
  // The downloaded artifact can be rechecked without the original HTTP headers.
  expect((await verify(`${path}.manifest.json`)).code).toBe(0);
  // Three subprocesses and a snapshot: on a loaded runner this passes five
  // seconds and fails on the clock rather than on anything it checks. It did
  // exactly that on CI on 20 September 2026, so the budget is stated here.
}, 60_000);
