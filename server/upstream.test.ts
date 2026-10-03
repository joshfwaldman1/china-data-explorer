/**
 * The host gate: one request at a time per host, a gap after each, hosts
 * independent of each other, and the relay used only for the hosts named.
 */

import { test, expect } from "bun:test";
import { createUpstream, BREAKER, UpstreamDownError, type UpstreamDeps } from "./upstream";

/** A fake clock that sleeping advances, and a fetch that records when each request started and ended. */
function harness(options: { env?: Record<string, string>; gaps?: Record<string, number>; took?: number; respond?: (url: string, init: RequestInit) => Response } = {}) {
  let clock = 0;
  const log: { url: string; start: number; end: number; init: RequestInit }[] = [];
  const deps: UpstreamDeps = {
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    fetchImpl: async (url, init) => {
      const start = clock;
      await Promise.resolve();
      clock += options.took ?? 100;
      log.push({ url, start, end: clock, init });
      return options.respond ? options.respond(url, init) : new Response("{}", { status: 200 });
    },
    env: options.env ?? {},
    gaps: options.gaps ?? { "slow.example": 1000 },
    defaultGapMs: 250,
  };
  return { upstream: createUpstream(deps), log };
}

test("requests to one host wait for the previous one and its gap, in the order they arrived", async () => {
  const { upstream, log } = harness();
  await Promise.all([1, 2, 3].map((n) => upstream.upstreamFetch(`https://slow.example/page/${n}`)));
  expect(log.map((item) => item.url)).toEqual(["https://slow.example/page/1", "https://slow.example/page/2", "https://slow.example/page/3"]);
  for (let index = 1; index < log.length; index += 1) {
    expect(log[index]!.start - log[index - 1]!.end).toBeGreaterThanOrEqual(1000);
  }
});

test("a host with no gap of its own gets the default, and a different host is not held up", async () => {
  const { upstream, log } = harness();
  await upstream.upstreamFetch("https://api.example/a");
  await upstream.upstreamFetch("https://api.example/b");
  expect(log[1]!.start - log[0]!.end).toBe(250);
  const stats = upstream.upstreamStats();
  expect(stats.find((item) => item.host === "api.example")?.requests).toBe(2);
});

test("an adapter's own pause counts towards the gap, so a paced loop is not slowed twice", async () => {
  let clock = 0;
  const starts: number[] = [];
  const upstream = createUpstream({
    now: () => clock, sleep: async (ms) => { clock += ms; }, env: {}, gaps: { "slow.example": 1000 }, defaultGapMs: 0,
    fetchImpl: async () => { starts.push(clock); clock += 100; return new Response("{}"); },
  });
  await upstream.upstreamFetch("https://slow.example/1");
  clock += 1000; // the adapter's own Bun.sleep(1000)
  await upstream.upstreamFetch("https://slow.example/2");
  expect(starts[1]! - starts[0]!).toBe(1100);
});

test("a request that throws releases the host and is counted as a failure", async () => {
  let calls = 0;
  const { upstream } = harness({ respond: () => { calls += 1; if (calls === 1) throw new Error("socket hang up"); return new Response("{}"); } });
  await expect(upstream.upstreamFetch("https://api.example/x")).rejects.toThrow("socket hang up");
  const ok = await upstream.upstreamFetch("https://api.example/y");
  expect(ok.status).toBe(200);
  const entry = upstream.upstreamStats().find((item) => item.host === "api.example")!;
  expect(entry.failures).toBe(1);
  expect(entry.lastError).toBeNull();
});

test("a 4xx or 5xx is returned to the adapter and counted as refused, not thrown", async () => {
  const { upstream } = harness({ respond: () => new Response("blocked", { status: 412 }) });
  const response = await upstream.upstreamFetch("https://stats.customs.example/q");
  expect(response.status).toBe(412);
  expect(upstream.upstreamStats()[0]).toMatchObject({ refused: 1, lastStatus: 412, failures: 0 });
});

test("only the hosts named go through the relay, with the request wrapped and the publisher's answer unwrapped", async () => {
  const env = { CHINA_RELAY_URL: "https://relay.example/", CHINA_RELAY_TOKEN: "secret", CHINA_RELAY_HOSTS: "stats.customs.gov.cn" };
  const { upstream, log } = harness({
    env,
    respond: (url) => url.startsWith("https://relay.example")
      ? new Response("<table>1</table>", { status: 200, headers: { "x-upstream-status": "200", "x-upstream-content-type": "text/html" } })
      : new Response("direct"),
  });
  expect(upstream.channelFor("stats.customs.gov.cn")).toBe("relay");
  expect(upstream.channelFor("www.pbc.gov.cn")).toBe("direct");

  const relayed = await upstream.upstreamFetch("https://stats.customs.gov.cn/query?x=1", { method: "POST", body: "a=1", headers: { "User-Agent": "UA" } });
  expect(await relayed.text()).toBe("<table>1</table>");
  expect(relayed.headers.get("content-type")).toBe("text/html");
  const sent = log[0]!;
  expect(sent.url).toBe("https://relay.example/fetch");
  expect(new Headers(sent.init.headers).get("authorization")).toBe("Bearer secret");
  expect(JSON.parse(String(sent.init.body))).toEqual({ url: "https://stats.customs.gov.cn/query?x=1", method: "POST", headers: { "user-agent": "UA" }, body: "a=1" });

  const direct = await upstream.upstreamFetch("https://www.pbc.gov.cn/table");
  expect(await direct.text()).toBe("direct");
  expect(log[1]!.url).toBe("https://www.pbc.gov.cn/table");
});

test("the relay's own refusal is passed on as the relay's status", async () => {
  const env = { CHINA_RELAY_URL: "https://relay.example", CHINA_RELAY_TOKEN: "wrong", CHINA_RELAY_HOSTS: "stats.customs.gov.cn" };
  const { upstream } = harness({ env, respond: () => new Response("unauthorised", { status: 401 }) });
  const response = await upstream.upstreamFetch("https://stats.customs.gov.cn/q");
  expect(response.status).toBe(401);
});

test("a host failing five times in a row is left alone for a cooldown, then tried once; a success closes it", async () => {
  let status = 502;
  const { upstream, log } = harness({ respond: () => new Response("bad gateway", { status }) });
  for (let n = 0; n < BREAKER.threshold; n += 1) await upstream.upstreamFetch("https://down.example/a");
  expect(log).toHaveLength(BREAKER.threshold);
  // Open: refused at the gate, nothing sent.
  await expect(upstream.upstreamFetch("https://down.example/b")).rejects.toBeInstanceOf(UpstreamDownError);
  expect(log).toHaveLength(BREAKER.threshold);
  const stats = upstream.upstreamStats().find((entry) => entry.host === "down.example");
  expect(stats?.shortCircuited).toBe(1);
  expect(stats?.openUntil).not.toBeNull();
  // A 4xx elsewhere is a refusal, not an outage, and opens nothing.
  status = 412;
  for (let n = 0; n < BREAKER.threshold + 2; n += 1) await upstream.upstreamFetch("https://refusing.example/x");
  expect(upstream.upstreamStats().find((entry) => entry.host === "refusing.example")?.openUntil).toBeNull();
});

test("after the cooldown a failed trial reopens at once for twice as long, and a successful one closes the breaker", async () => {
  let clock = 0;
  let status = 503;
  const sent: string[] = [];
  const upstream = createUpstream({
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    fetchImpl: async (url) => { sent.push(url); clock += 10; return new Response("", { status }); },
    env: {}, gaps: {}, defaultGapMs: 0,
  });
  const host = () => upstream.upstreamStats().find((entry) => entry.host === "flaky.example");
  for (let n = 0; n < BREAKER.threshold; n += 1) await upstream.upstreamFetch("https://flaky.example/");
  const firstOpen = Date.parse(host()?.openUntil ?? "") - clock;
  expect(firstOpen).toBe(BREAKER.firstCooldownMs);
  clock += BREAKER.firstCooldownMs;
  await upstream.upstreamFetch("https://flaky.example/"); // the trial, still failing
  expect(Date.parse(host()?.openUntil ?? "") - clock).toBe(BREAKER.firstCooldownMs * 2);
  clock += BREAKER.firstCooldownMs * 2;
  status = 200;
  await upstream.upstreamFetch("https://flaky.example/");
  expect(host()?.openUntil).toBeNull();
  expect(host()?.consecutiveDown).toBe(0);
  expect(sent).toHaveLength(BREAKER.threshold + 2);
});

test("a request that throws counts towards the breaker like a 5xx", async () => {
  const { upstream } = harness({ respond: () => { throw new Error("socket connection was closed"); } });
  for (let n = 0; n < BREAKER.threshold; n += 1) await expect(upstream.upstreamFetch("https://gone.example/")).rejects.toThrow("socket");
  await expect(upstream.upstreamFetch("https://gone.example/")).rejects.toBeInstanceOf(UpstreamDownError);
});

test("an open breaker is kept in the store and read back by the next process; a close is saved too", async () => {
  const kept = new Map<string, { openUntil: string | null; nextCooldownMs: number | null }>();
  const store = { load: (host: string) => kept.get(host) ?? null, save: (host: string, state: { openUntil: string | null; nextCooldownMs: number | null }) => { kept.set(host, state); } };
  let clock = 0;
  let status = 502;
  const sent: string[] = [];
  const make = () => {
    const upstream = createUpstream({
      now: () => clock, sleep: async (ms) => { clock += ms; },
      fetchImpl: async (url) => { sent.push(url); return new Response("", { status }); },
      env: {}, gaps: {}, defaultGapMs: 0,
    });
    upstream.useBreakerStore(store);
    return upstream;
  };
  const before = make();
  for (let n = 0; n < BREAKER.threshold; n += 1) await before.upstreamFetch("https://mof.example/");
  expect(kept.get("mof.example")?.openUntil).not.toBeNull();
  expect(kept.get("mof.example")?.nextCooldownMs).toBe(BREAKER.firstCooldownMs * 2);
  // A deploy: a new process, the same store. Still open, so nothing is sent.
  const after = make();
  await expect(after.upstreamFetch("https://mof.example/")).rejects.toBeInstanceOf(UpstreamDownError);
  expect(sent).toHaveLength(BREAKER.threshold);
  // Past the cooldown the trial succeeds, and the close is saved.
  clock += BREAKER.firstCooldownMs;
  status = 200;
  await after.upstreamFetch("https://mof.example/");
  expect(kept.get("mof.example")).toEqual({ openUntil: null, nextCooldownMs: null });
});
