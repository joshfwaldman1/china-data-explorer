/**
 * The relay fetches only allowed hosts for a caller with the token, and hands
 * back the publisher's answer with its status in a header.
 */

import { test, expect } from "bun:test";
import { handleRelay, type RelayConfig } from "./server";
import { createUpstream } from "../server/upstream";

function config(respond: (url: string, init: RequestInit) => Response | Promise<Response> = () => new Response("<table/>", { status: 200, headers: { "content-type": "text/html" } })) {
  const seen: { url: string; init: RequestInit }[] = [];
  const cfg: RelayConfig = {
    token: "secret",
    allowedHosts: new Set(["stats.customs.gov.cn"]),
    timeoutMs: 1000,
    fetchImpl: async (url, init) => { seen.push({ url, init }); return respond(url, init); },
  };
  return { cfg, seen };
}

const call = (body: unknown, token = "secret") => new Request("http://relay.local/fetch", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
});

test("a caller without the token is refused before anything is fetched", async () => {
  const { cfg, seen } = config();
  const response = await handleRelay(call({ url: "https://stats.customs.gov.cn/q" }, "wrong"), cfg);
  expect(response.status).toBe(401);
  expect(seen).toHaveLength(0);
});

test("a relay with no token configured refuses everyone", async () => {
  const { cfg } = config();
  const response = await handleRelay(call({ url: "https://stats.customs.gov.cn/q" }, ""), { ...cfg, token: "" });
  expect(response.status).toBe(401);
});

test("a host outside the allow list is refused, so the relay is not an open proxy", async () => {
  const { cfg, seen } = config();
  const response = await handleRelay(call({ url: "https://example.com/" }), cfg);
  expect(response.status).toBe(403);
  expect(seen).toHaveLength(0);
});

test("an allowed request is sent as asked, without the relay's own headers, and answered with the publisher's status and body", async () => {
  const { cfg, seen } = config(() => new Response("blocked page", { status: 412, headers: { "content-type": "text/html" } }));
  const response = await handleRelay(call({ url: "https://stats.customs.gov.cn/q", method: "POST", headers: { "User-Agent": "UA", Authorization: "leak", Host: "x" }, body: "a=1" }), cfg);
  expect(response.status).toBe(200);
  expect(response.headers.get("x-upstream-status")).toBe("412");
  expect(response.headers.get("x-upstream-content-type")).toBe("text/html");
  expect(await response.text()).toBe("blocked page");
  expect(seen[0]!.url).toBe("https://stats.customs.gov.cn/q");
  expect(seen[0]!.init.method).toBe("POST");
  expect(seen[0]!.init.body).toBe("a=1");
  expect(seen[0]!.init.headers).toEqual({ "User-Agent": "UA" });
});

test("a publisher that cannot be reached is a 502 from the relay, not a publisher status", async () => {
  const { cfg } = config(() => { throw new Error("connect ETIMEDOUT"); });
  const response = await handleRelay(call({ url: "https://stats.customs.gov.cn/q" }), cfg);
  expect(response.status).toBe(502);
  expect(response.headers.has("x-upstream-status")).toBe(false);
});

test("the explorer's gate and the relay agree: a relayed request arrives at the publisher and its answer comes back intact", async () => {
  const { cfg, seen } = config(() => new Response("<table>42</table>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }));
  let clock = 0;
  const upstream = createUpstream({
    now: () => clock, sleep: async (ms) => { clock += ms; }, gaps: {}, defaultGapMs: 0,
    env: { CHINA_RELAY_URL: "http://relay.local", CHINA_RELAY_TOKEN: "secret", CHINA_RELAY_HOSTS: "stats.customs.gov.cn" },
    fetchImpl: (url, init) => handleRelay(new Request(url, init), cfg),
  });
  const response = await upstream.upstreamFetch("https://stats.customs.gov.cn/q?month=2026-08", { headers: { Accept: "text/html" } });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(await response.text()).toBe("<table>42</table>");
  expect(seen[0]!.url).toBe("https://stats.customs.gov.cn/q?month=2026-08");
});
