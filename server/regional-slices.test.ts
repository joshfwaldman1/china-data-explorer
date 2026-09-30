/**
 * A province's history reaches back through the bureau's earlier tables, as
 * the national series does: the provincial CPI table restarts every five
 * years, and a province read from the current table alone begins in 2026.
 */
import { test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(tmpdir(), `regional-slices-${process.pid}.db`);
const { fetchLiveRegion, NBS_PROVINCES } = await import("./data.ts");

test("Guangdong's consumer prices read the 2021-2025 table behind the current one", async () => {
  const guangdong = NBS_PROVINCES.find((region) => region.value === "440000000000");
  if (!guangdong) throw new Error("Guangdong is missing from the province list");
  // One period per table, in the portal's own shape; the value is the index on a year earlier = 100.
  const answers: Record<string, { code: string; value: string }> = {
    b5e122302ad745358ba7415bd4a22c2f: { code: "202608MM", value: "101.0" },
    c7b31f465b2b4a40b9999090b03b5a37: { code: "202512MM", value: "100.4" },
    f6b9c87376ad4b24b170766f419dc076: { code: "202012MM", value: "100.2" },
  };
  const asked: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(async (_input: string | URL | Request, init?: RequestInit) => {
    const body: unknown = JSON.parse(String(init?.body ?? "{}"));
    const cid = typeof body === "object" && body !== null ? String(Reflect.get(body, "cid")) : "";
    const ids: unknown = typeof body === "object" && body !== null ? Reflect.get(body, "indicatorIds") : [];
    asked.push(cid);
    const answer = answers[cid];
    const id = Array.isArray(ids) ? String(ids[0]) : "";
    const data = answer ? [{ code: answer.code, values: [{ _id: id, da: "440000000000", value: answer.value }] }] : [];
    return new Response(JSON.stringify({ data }), { headers: { "Content-Type": "application/json" } });
  }, { preconnect: realFetch.preconnect });
  try {
    const result = await fetchLiveRegion("provincial_cpi", guangdong, 120);
    const points = result?.series[0]?.points ?? [];
    expect(asked).toEqual(Object.keys(answers));
    expect(points).toEqual([{ date: "2020-12", value: 0.2 }, { date: "2025-12", value: 0.4 }, { date: "2026-08", value: 1 }]);
  } finally {
    globalThis.fetch = realFetch;
  }
}, 30_000);
