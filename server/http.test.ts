import { expect, test } from "bun:test";
import { fetchJson } from "./http";

function responder(sequence: (number | Error)[]) {
  const calls: string[] = [];
  const fetchImpl = async (url: string): Promise<Response> => {
    calls.push(url);
    const next = sequence.shift();
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify({ n: calls.length }), { status: next ?? 200, headers: { "Content-Type": "application/json" } });
  };
  return { calls, fetchImpl };
}

test("a dropped connection is tried once more", async () => {
  const { calls, fetchImpl } = responder([new Error("The socket connection was closed unexpectedly."), 200]);
  const result = await fetchJson("https://example.org/a", {}, { fetchImpl, retryDelayMs: 0 });
  expect(result.ok).toBe(true);
  expect(calls.length).toBe(2);
});

test("a 502 is tried once more, a second failure is thrown", async () => {
  const ok = responder([502, 200]);
  expect((await fetchJson("https://example.org/b", {}, { fetchImpl: ok.fetchImpl, retryDelayMs: 0 })).ok).toBe(true);
  expect(ok.calls.length).toBe(2);
  const bad = responder([new Error("first"), new Error("second")]);
  await expect(fetchJson("https://example.org/c", {}, { fetchImpl: bad.fetchImpl, retryDelayMs: 0 })).rejects.toThrow("second");
});

test("a 404 comes back as is without a retry", async () => {
  const { calls, fetchImpl } = responder([404, 200]);
  const result = await fetchJson("https://example.org/d", {}, { fetchImpl, retryDelayMs: 0 });
  expect(result.ok).toBe(false);
  expect(result.status).toBe(404);
  expect(calls.length).toBe(1);
});
