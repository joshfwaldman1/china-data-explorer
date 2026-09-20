import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startOfflineServer, TEST_CATALOG } from "./test-server";
import { manifestFromHeaders, verifyBackup } from "../scripts/verify-backup";

test("HTTP backups require the configured token and download a verifiable standalone database", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "china-backup-http-"));
  const env = {
    ...process.env, CHINA_DB_PATH: join(scratch, "store.db"), CHINA_CATALOG_DB_PATH: join(scratch, "catalog.db"),
    NBS_CATALOG_PATH: join(scratch, "catalog.json"), CHINA_SEED: "off", NBS_QUERY_EXPANSION: "off",
    CHINA_LIVE_FALLBACK: "0", INGEST_EVERY_HOURS: "0", CATALOG_CRAWL: "off", NODE_ENV: "test", PORT: "0",
    BACKUP_TOKEN: "",
  };
  let server: Awaited<ReturnType<typeof startOfflineServer>> | undefined;
  try {
    await Bun.write(env.NBS_CATALOG_PATH, JSON.stringify(TEST_CATALOG));
    server = await startOfflineServer(env);
    expect((await fetch(`${server.url}/api/backup`)).status).toBe(404);
    // A functioning catalog with a healthy, empty store is a valid fresh installation.
    for (let attempt = 0; attempt < 200; attempt++) {
      if ((await fetch(`${server.url}/ready`)).ok) break;
      await Bun.sleep(10);
    }
    expect((await fetch(`${server.url}/ready`)).status).toBe(200);
    await server.stop();
    server = undefined;

    const seed = `
      const { writeSeries, db } = await import(${JSON.stringify(resolve(import.meta.dir, "db.ts"))});
      for (const [date, value] of [["2026-09-10T00:00:00Z", 1.1], ["2026-09-11T00:00:00Z", 1.2]]) {
        writeSeries({ key: "cpi", title: "CPI", agency: "NBS", sourceUrl: "", frequency: "Monthly", unit: "%",
          series: [{ label: "CPI", points: [{ date: "2026-08", value }] }] }, "", date);
      }
      db().close();
    `;
    const child = Bun.spawn([process.execPath, "-e", seed], { env, stdout: "pipe", stderr: "pipe" });
    const [errors, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
    expect(errors).toBe("");
    expect(code).toBe(0);
    server = await startOfflineServer({ ...env, BACKUP_TOKEN: "test-only-backup-credential" });
    expect((await fetch(`${server.url}/api/backup`)).status).toBe(401);
    expect((await fetch(`${server.url}/api/backup`, { headers: { Authorization: "Bearer incorrect" } })).status).toBe(401);
    const pending = fetch(`${server.url}/api/backup`, { headers: { Authorization: "Bearer test-only-backup-credential" } });
    expect((await fetch(`${server.url}/live`)).status).toBe(200);
    const response = await pending;
    expect(response.status).toBe(200);
    const manifest = manifestFromHeaders(`HTTP/1.1 200 OK\r\nX-Backup-Manifest: ${response.headers.get("x-backup-manifest")}\r\n\r\n`);
    const downloaded = join(scratch, "downloaded.db");
    await Bun.write(downloaded, await response.arrayBuffer());
    expect((await verifyBackup(downloaded, manifest)).observations).toBe(2);
  } finally {
    await server?.stop();
    await rm(scratch, { recursive: true, force: true });
  }
}, 15_000);
