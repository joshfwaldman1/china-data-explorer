import { expect, test } from "bun:test";
import { createReadinessProbe } from "./readiness";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startOfflineServer } from "./test-server";

const healthyStore = { ok: true, observations: 123, lastFetch: "2026-09-19T00:00:00Z" };

test("readiness stays unavailable until catalog warmup finishes", async () => {
  let finishCatalog = () => {};
  let storeChecks = 0;
  const catalog = new Promise<void>((resolve) => { finishCatalog = resolve; });
  const readiness = createReadinessProbe(() => { storeChecks += 1; return healthyStore; });
  const warming = readiness.warm(() => catalog);
  expect(readiness.check().status).toBe(503);
  expect(await readiness.check().json()).toEqual({ ok: false, warming: true });
  expect(storeChecks).toBe(0);

  finishCatalog();
  await warming;
  const ready = readiness.check();
  expect(ready.status).toBe(200);
  expect(ready.headers.get("Cache-Control")).toBe("no-store");
  expect(await ready.json()).toEqual(healthyStore);
});

test("a failed catalog cannot become ready just because the store works", async () => {
  const readiness = createReadinessProbe(() => healthyStore);
  await expect(readiness.warm(async () => { throw new Error("Catalog snapshot is corrupt"); })).rejects.toThrow("Catalog snapshot is corrupt");
  expect(readiness.check().status).toBe(503);
  expect(await readiness.check().json()).toEqual({ ok: false, warming: false, error: "Catalog snapshot is corrupt" });
});

test("catalog success does not mark an unreadable store ready", async () => {
  const readiness = createReadinessProbe(() => { throw new Error("Store is unavailable"); });
  await expect(readiness.warm(async () => undefined)).rejects.toThrow("Store is unavailable");
  expect(readiness.check().status).toBe(503);
});

test("a ready process checks the store again and recovers when it answers", async () => {
  let available = true;
  const readiness = createReadinessProbe(() => {
    if (!available) throw new Error("Store is unavailable");
    return healthyStore;
  });
  await readiness.warm(async () => undefined);
  available = false;
  expect(readiness.check().status).toBe(503);
  available = true;
  expect(readiness.check().status).toBe(200);
});

test("an explicit unhealthy store result returns 503", async () => {
  let healthy = true;
  const readiness = createReadinessProbe(() => ({ ...healthyStore, ok: healthy }));
  await readiness.warm(async () => undefined);
  healthy = false;
  expect(readiness.check().status).toBe(503);
});

test.each([
  ["broken", "{ invalid JSON"],
  ["empty", JSON.stringify({ entries: [] })],
  ["unusable", JSON.stringify({ entries: [{ invalid: true }] })],
])("HTTP readiness reports a %s catalog while liveness still answers", async (_name, contents) => {
  const scratch = mkdtempSync(join(tmpdir(), "china-readiness-"));
  const catalog = join(scratch, "broken-catalog.json");
  await Bun.write(catalog, contents);
  const server = await startOfflineServer({
    ...process.env,
    CHINA_DB_PATH: join(scratch, "store.db"),
    CHINA_CATALOG_DB_PATH: join(scratch, "catalog.db"),
    NBS_CATALOG_PATH: catalog,
    CHINA_SEED: "off", NBS_QUERY_EXPANSION: "off", CHINA_LIVE_FALLBACK: "0",
    INGEST_EVERY_HOURS: "0", CATALOG_CRAWL: "off", NODE_ENV: "test", PORT: "0",
  });
  try {
    const deadline = Date.now() + 5000;
    let failed = false;
    while (Date.now() < deadline) {
      const response = await fetch(`${server.url}/ready`);
      expect(response.status).toBe(503);
      const body: unknown = await response.json();
      if (body !== null && typeof body === "object" && "warming" in body && body.warming === false) { failed = true; break; }
      await Bun.sleep(10);
    }
    expect(failed).toBe(true);
    expect((await fetch(`${server.url}/health`)).status).toBe(503);
    expect((await fetch(`${server.url}/live`)).status).toBe(200);
  } finally {
    await server.stop();
    rmSync(scratch, { recursive: true, force: true });
  }
  expect(server.logs()).toContain("Readiness warmup failed");
  expect(server.logs()).not.toContain("Catalog warm in");
}, 15_000);
