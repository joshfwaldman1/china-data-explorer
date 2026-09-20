import { lstat, mkdir, mkdtemp, open, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseBackupManifest } from "./backup-validation";

interface BackupOptions {
  sourcePath: string;
  directory?: string;
  timeoutMs?: number;
  streamTimeoutMs?: number;
}

/** Only these private temporary directories belong to this service. */
export async function cleanupStaleBackups(directory: string, olderThanMs: number): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (!(await lstat(directory)).isDirectory()) throw new Error("Backup directory must be a real directory");
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^snapshot-[A-Za-z0-9]+$/.test(entry.name)) continue;
    const path = join(directory, entry.name);
    if (Date.now() - (await lstat(path)).mtimeMs > olderThanMs) await rm(path, { recursive: true, force: true });
  }
}

/** One copy/download at a time bounds CPU, disk use and long-lived readers. */
export function createBackupManager(options: BackupOptions) {
  const sourcePath = resolve(options.sourcePath);
  const directory = resolve(options.directory ?? join(dirname(sourcePath), ".china-backups"));
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;
  const streamTimeoutMs = options.streamTimeoutMs ?? 30 * 60_000;
  const staleAfterMs = Math.max(24 * 60 * 60_000, 2 * (timeoutMs + streamTimeoutMs));
  let active = false;
  let initialCleanup: Promise<void> | undefined;
  const cleanupStale = () => initialCleanup ??= cleanupStaleBackups(directory, staleAfterMs).catch((error: unknown) => {
    initialCleanup = undefined;
    throw error;
  });

  async function createResponse(signal?: AbortSignal): Promise<Response> {
    if (active) return Response.json({ error: "A backup is already in progress" }, { status: 429, headers: { "Retry-After": "60" } });
    if (signal?.aborted) return new Response("Backup cancelled", { status: 499 });
    active = true;
    let scratch: string | undefined;
    let streamOwnsCleanup = false;
    const cleanup = async () => {
      try { if (scratch) await rm(scratch, { recursive: true, force: true }); }
      catch (error) { console.error("Backup temporary files could not be removed", error); }
      finally { active = false; }
    };
    try {
      await cleanupStale();
      scratch = await mkdtemp(join(directory, "snapshot-"));
      const path = join(scratch, "china.db");
      const child = Bun.spawn([process.execPath, join(import.meta.dir, "backup-worker.ts"), "snapshot", sourcePath, path], { stdout: "pipe", stderr: "pipe" });
      let timedOut = false;
      const abort = () => { child.kill(); };
      const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      let output: string;
      let errors: string;
      let code: number;
      try {
        [output, errors, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      }
      if (signal?.aborted) return new Response("Backup cancelled", { status: 499 });
      if (timedOut) return Response.json({ error: "Backup creation timed out" }, { status: 504 });
      if (code !== 0) throw new Error(`Backup worker failed: ${errors.trim() || `exit ${code}`}`);
      const manifest = parseBackupManifest(JSON.parse(output));
      const file = await open(path, "r");
      let finished = false;
      let streamTimer: ReturnType<typeof setTimeout> | undefined;
      let cancelDownload: () => void = () => {};
      const finish = async () => {
        if (finished) return;
        finished = true;
        clearTimeout(streamTimer);
        signal?.removeEventListener("abort", cancelDownload);
        try { await file.close(); }
        finally { await cleanup(); }
      };
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          cancelDownload = () => {
            if (finished) return;
            controller.error(new Error("Backup download cancelled"));
            void finish().catch((error: unknown) => console.error("Backup cleanup failed", error));
          };
          signal?.addEventListener("abort", cancelDownload, { once: true });
          streamTimer = setTimeout(cancelDownload, streamTimeoutMs);
          if (signal?.aborted) cancelDownload();
        },
        async pull(controller) {
          if (finished) return;
          try {
            const buffer = new Uint8Array(64 * 1024);
            const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
            if (finished) return;
            if (bytesRead) controller.enqueue(buffer.subarray(0, bytesRead));
            else { await finish(); controller.close(); }
          } catch (error) {
            if (!finished) controller.error(error);
            await finish();
          }
        },
        cancel: finish,
      });
      streamOwnsCleanup = true;
      return new Response(body, { headers: {
        "Content-Type": "application/vnd.sqlite3",
        "Content-Length": String(manifest.sizeBytes),
        "Content-Disposition": `attachment; filename="china-${manifest.createdAt.slice(0, 10)}.db"`,
        "Cache-Control": "no-store",
        "X-Backup-Manifest": Buffer.from(JSON.stringify(manifest)).toString("base64"),
      } });
    } catch (error) {
      console.error("Backup failed", error);
      return Response.json({ error: "Backup creation failed" }, { status: 500 });
    } finally {
      if (!streamOwnsCleanup) await cleanup();
    }
  }
  return { createResponse, cleanupStale };
}
