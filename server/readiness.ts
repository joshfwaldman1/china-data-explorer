/** Readiness is earned by successful warmup, never by time spent starting. */
type CatalogState = { status: "warming" } | { status: "ready" } | { status: "failed"; error: string };

export function createReadinessProbe<T extends { ok: boolean }>(readStore: () => T) {
  let catalog: CatalogState = { status: "warming" };
  const response = (body: object, status: number) => Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

  return {
    async warm(loadCatalog: () => Promise<unknown>): Promise<void> {
      try {
        await loadCatalog();
        if (!readStore().ok) throw new Error("Store health check failed during warmup");
        catalog = { status: "ready" };
      } catch (error) {
        catalog = { status: "failed", error: error instanceof Error ? error.message : String(error) };
        throw error;
      }
    },
    check(): Response {
      if (catalog.status === "warming") return response({ ok: false, warming: true }, 503);
      if (catalog.status === "failed") return response({ ok: false, warming: false, error: catalog.error }, 503);
      // A successful boot does not conceal a store that later stops answering.
      try {
        const health = readStore();
        return response(health, health.ok ? 200 : 503);
      } catch (error) {
        return response({ ok: false, error: error instanceof Error ? error.message : String(error) }, 503);
      }
    },
  };
}
