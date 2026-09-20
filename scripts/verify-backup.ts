import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { assertBackupMatches, inspectBackup, parseBackupManifest, type BackupManifest } from "../server/backup-validation";

export function manifestFromHeaders(headers: string): BackupManifest {
  // curl may record retry responses or a proxy's CONNECT before the final response.
  const blocks = headers.trim().split(/\r?\n\r?\n/);
  const finalHeaders = blocks.at(-1) ?? "";
  const manifests = finalHeaders.split(/\r?\n/).filter((line) => /^x-backup-manifest:/i.test(line));
  if (manifests.length !== 1) throw new Error("Response must carry exactly one backup manifest");
  const encoded = manifests[0]?.slice(manifests[0].indexOf(":") + 1).trim() ?? "";
  return parseBackupManifest(JSON.parse(Buffer.from(encoded, "base64").toString("utf8")));
}

/** Restore only the downloaded file into an empty directory, with no WAL or app initializer. */
export async function verifyBackup(path: string, expected: BackupManifest): Promise<BackupManifest> {
  const actual = await inspectBackup(path);
  assertBackupMatches(actual, expected);
  const scratch = await mkdtemp(join(tmpdir(), "china-backup-restore-"));
  try {
    const restored = join(scratch, "restored.db");
    await copyFile(path, restored);
    const child = Bun.spawn([process.execPath, resolve(import.meta.dir, "../server/backup-worker.ts"), "inspect", restored], { stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill(), 10 * 60_000);
    try {
      const [output, errors, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      if (code !== 0) throw new Error(`Restored database failed verification: ${errors.trim() || `exit ${code}`}`);
      assertBackupMatches(parseBackupManifest(JSON.parse(output)), expected);
    } finally {
      clearTimeout(timer);
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  return expected;
}

if (import.meta.main) {
  // Say what happened, then leave, deliberately.
  //
  // Setting `process.exitCode` and falling off the end means the process
  // exits only once the event loop drains, and this script opens SQLite
  // through its imports and spawns a child of its own. A single handle that
  // outlives the work turns "finished" into "never exits", and a caller
  // reading this process's output waits for an end of file that does not
  // come. That is what happened on CI on 20 September 2026: the verifier
  // test did not run slowly, it hung, first against the default five-second
  // budget and then against a sixty-second one. Writing the streams and then
  // exiting on a stated code makes the outcome independent of what any
  // import left running. Bun.write resolves once the bytes are handed over,
  // so nothing is truncated by the exit that follows.
  let code = 0;
  try {
    const [path, metadataPath] = Bun.argv.slice(2);
    if (!path || !metadataPath) throw new Error("Usage: bun scripts/verify-backup.ts SNAPSHOT MANIFEST_OR_CURL_HEADERS");
    const metadata = await Bun.file(metadataPath).text();
    const expected = metadata.trimStart().startsWith("{") ? parseBackupManifest(JSON.parse(metadata)) : manifestFromHeaders(metadata);
    const manifest = await verifyBackup(path, expected);
    const name = basename(path);
    if (/[\r\n\\]/.test(name)) throw new Error("Invalid backup filename");
    await writeFile(`${path}.manifest.json`, `${JSON.stringify({ ...manifest, verifiedAt: new Date().toISOString(), restoreVerified: true }, null, 2)}\n`);
    await writeFile(`${path}.sha256`, `${manifest.sha256}  ${name}\n`);
    await Bun.write(Bun.stdout, `Verified and restored ${manifest.observations} observations, ${manifest.series} series; SHA-256 ${manifest.sha256}\n`);
  } catch (error) {
    await Bun.write(Bun.stderr, `${error instanceof Error ? error.message : String(error)}\n`);
    code = 1;
  }
  process.exit(code);
}
