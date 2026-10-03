/**
 * The one door every upstream request goes through.
 *
 * Each adapter paces itself (a second between MOF pages, 800 ms between NEA
 * pages), but only within its own loop. Nothing stopped two loops reaching
 * the same host at once: the worker keeps scheduled jobs one at a time, yet a
 * reader's live fallback, a map filling its missing provinces in the
 * background and a release refresh all fetch outside it, and NBS throttles
 * per address (a probe "failed" whenever a crawl was running). This module is
 * a gate per host, shared across the process: one request in flight to a
 * host, and a minimum gap after the previous one finished. An adapter's own
 * sleep counts towards the gap, so a paced loop is not slowed twice.
 *
 * It is also where a request's channel is chosen. Some publishers answer a
 * foreign address with a block (Customs' statistics portal with HTTP 412, the
 * NBS query API with a UrlACL 403). With `CHINA_RELAY_URL` set, the hosts
 * named in `CHINA_RELAY_HOSTS` are fetched through a relay on a mainland
 * address (`relay/server.ts`); the relay only fetches, and every byte is
 * parsed here. Everything else goes direct.
 *
 * And it keeps a tally per host (requests, failures, time spent, last status,
 * channel), so `/api/schedule` can say which publisher is slow or refusing
 * before a series goes stale.
 */

export type UpstreamChannel = "direct" | "relay";

export interface UpstreamHostStats {
  host: string;
  channel: UpstreamChannel;
  requests: number;
  failures: number;
  /** Requests answered 4xx or 5xx; a failure is a request that threw. */
  refused: number;
  lastStatus: number | null;
  lastError: string | null;
  lastAt: string | null;
  /** Mean time per request, from send to headers, in milliseconds. */
  meanMs: number;
  /** Total time requests waited at the gate for the host to be free. */
  waitedMs: number;
  /** Requests in a row that threw or were answered 5xx; reset by any other answer. */
  consecutiveDown: number;
  /** While set and in the future, requests to the host fail at once without being sent. */
  openUntil: string | null;
  /** Requests refused at the gate because the host was down. */
  shortCircuited: number;
}

/**
 * A host is treated as down after this many requests in a row threw or were
 * answered 5xx, and is left alone for a cooldown that doubles while it stays
 * down. On 2 October the finance ministry answered 502 for most of an hour
 * and every series was still asked three times over (54 failures for one).
 * A 4xx is a refusal of that request, not an outage, and does not count.
 */
export const BREAKER = { threshold: 5, firstCooldownMs: 15 * 60 * 1000, maxCooldownMs: 60 * 60 * 1000 } as const;

/** Thrown, without a request, for a host whose breaker is open. */
export class UpstreamDownError extends Error {
  constructor(host: string, until: string) {
    super(`${host} is treated as down until ${until} after ${BREAKER.threshold} failed requests in a row; not asked`);
    this.name = "UpstreamDownError";
  }
}

export interface UpstreamInit extends RequestInit {
  /** Abort after this long; the gate's wait does not count. Defaults to 45 s. */
  timeoutMs?: number;
}

/** The gap kept after each request to a host, where a publisher needs more than the default. */
const HOST_GAP_MS: Record<string, number> = {
  "data.stats.gov.cn": 1000,
  "www.stats.gov.cn": 1000,
  "english.customs.gov.cn": 800,
  "stats.customs.gov.cn": 1500,
  "www.pbc.gov.cn": 1000,
  "www.mof.gov.cn": 1000,
  "www.safe.gov.cn": 800,
  "www.nea.gov.cn": 800,
  "www.chinamoney.com.cn": 800,
  "data.mofcom.gov.cn": 800,
  "www.mofcom.gov.cn": 800,
};
/** Hosts not named above: APIs built for machine traffic (FRED, Eastmoney's datacenter) still get a small gap. */
const DEFAULT_GAP_MS = 250;

interface HostGate { tail: Promise<void>; finishedAt: number }

interface Relay { url: string; token: string; hosts: Set<string> }

/** Clock, sleep and fetch are injected so the tests can run the gate without waiting or a network. */
export interface UpstreamDeps {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  fetchImpl: (input: string, init: RequestInit) => Promise<Response>;
  env: Record<string, string | undefined>;
  gaps: Record<string, number>;
  defaultGapMs: number;
}

/** A host's breaker as kept across restarts: open until when, and the cooldown its next opening uses. */
export interface BreakerState { openUntil: string | null; nextCooldownMs: number | null }

/** Where breaker state is kept between processes; the server gives the store's jobs table. */
export interface BreakerStore {
  load: (host: string) => BreakerState | null;
  save: (host: string, state: BreakerState) => void;
}

export function createUpstream(deps: UpstreamDeps) {
  const gates = new Map<string, HostGate>();
  const stats = new Map<string, UpstreamHostStats>();
  /** The cooldown the next opening of each host's breaker will use. */
  const cooldowns = new Map<string, number>();
  // Held in memory, a breaker closed at every deploy, and a host that was
  // down before it was asked again by every series after it.
  let breakerStore: BreakerStore | null = null;
  const persist = (host: string, entry: UpstreamHostStats) => {
    breakerStore?.save(host, { openUntil: entry.openUntil, nextCooldownMs: cooldowns.get(host) ?? null });
  };

  /** Record one answered or failed request against the host's breaker. */
  function noteOutcome(host: string, entry: UpstreamHostStats, down: boolean): void {
    if (!down) {
      const wasTripped = entry.openUntil !== null || cooldowns.has(host);
      entry.consecutiveDown = 0;
      entry.openUntil = null;
      cooldowns.delete(host);
      if (wasTripped) persist(host, entry);
      return;
    }
    entry.consecutiveDown += 1;
    // A failed trial after a cooldown reopens at once; otherwise the threshold opens it.
    const trialFailed = cooldowns.has(host);
    if (!trialFailed && entry.consecutiveDown < BREAKER.threshold) return;
    const cooldown = cooldowns.get(host) ?? BREAKER.firstCooldownMs;
    entry.openUntil = new Date(deps.now() + cooldown).toISOString();
    cooldowns.set(host, Math.min(cooldown * 2, BREAKER.maxCooldownMs));
    persist(host, entry);
  }

  function relayConfig(): Relay | null {
    const url = deps.env.CHINA_RELAY_URL?.trim();
    const token = deps.env.CHINA_RELAY_TOKEN?.trim() ?? "";
    if (!url) return null;
    const hosts = new Set((deps.env.CHINA_RELAY_HOSTS ?? "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean));
    return { url: url.replace(/\/+$/, ""), token, hosts };
  }

  function channelFor(host: string): UpstreamChannel {
    const relay = relayConfig();
    return relay && relay.hosts.has(host) ? "relay" : "direct";
  }

  function statsFor(host: string, channel: UpstreamChannel): UpstreamHostStats {
    let entry = stats.get(host);
    if (!entry) {
      entry = { host, channel, requests: 0, failures: 0, refused: 0, lastStatus: null, lastError: null, lastAt: null, meanMs: 0, waitedMs: 0, consecutiveDown: 0, openUntil: null, shortCircuited: 0 };
      const kept = breakerStore?.load(host);
      if (kept) {
        entry.openUntil = kept.openUntil;
        if (kept.nextCooldownMs !== null) cooldowns.set(host, kept.nextCooldownMs);
      }
      stats.set(host, entry);
    }
    entry.channel = channel;
    return entry;
  }

  /**
   * Wait for the host to be free and its gap to have passed, run `work`, and
   * release the host when it settles, success or not. Requests to one host
   * run in the order they arrived.
   */
  async function throughGate<T>(host: string, work: () => Promise<T>): Promise<{ value: T; waitedMs: number }> {
    const gate = gates.get(host) ?? { tail: Promise.resolve(), finishedAt: 0 };
    gates.set(host, gate);
    const gap = deps.gaps[host] ?? deps.defaultGapMs;
    let release!: () => void;
    const previous = gate.tail;
    gate.tail = new Promise<void>((resolve) => { release = resolve; });
    const queuedAt = deps.now();
    await previous;
    const wait = gate.finishedAt + gap - deps.now();
    if (wait > 0) await deps.sleep(wait);
    const waitedMs = deps.now() - queuedAt;
    try {
      return { value: await work(), waitedMs };
    } finally {
      gate.finishedAt = deps.now();
      release();
    }
  }

  /** Send one request through the relay; the relay answers with the publisher's status, headers and body as they came. */
  async function viaRelay(relay: Relay, url: string, init: RequestInit): Promise<Response> {
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const body = typeof init.body === "string" ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : undefined;
    if (init.body !== undefined && init.body !== null && body === undefined) throw new Error("relay: only string or form bodies can be relayed");
    const response = await deps.fetchImpl(`${relay.url}/fetch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${relay.token}` },
      body: JSON.stringify({ url, method: init.method ?? "GET", headers, body }),
      signal: init.signal ?? null,
    });
    // The relay's own refusal (bad token, host not allowed) is its status with no upstream header; pass it on as is.
    if (!response.headers.has("x-upstream-status")) return response;
    const status = Number(response.headers.get("x-upstream-status"));
    const passed = new Headers();
    const type = response.headers.get("x-upstream-content-type");
    if (type) passed.set("content-type", type);
    return new Response(await response.arrayBuffer(), { status, headers: passed });
  }

  async function upstreamFetch(input: string | URL, init: UpstreamInit = {}): Promise<Response> {
    const url = String(input);
    const host = new URL(url).hostname.toLowerCase();
    const channel = channelFor(host);
    const entry = statsFor(host, channel);
    const { timeoutMs = 45_000, ...rest } = init;
    const { value, waitedMs } = await throughGate(host, async () => {
      // Checked inside the gate, so requests queued behind the one that opened it fail at once too.
      if (entry.openUntil && Date.parse(entry.openUntil) > deps.now()) {
        entry.shortCircuited += 1;
        throw new UpstreamDownError(host, entry.openUntil);
      }
      const started = deps.now();
      entry.requests += 1;
      entry.lastAt = new Date(started).toISOString();
      try {
        // The timeout starts once the host is free, so time spent queued behind a crawl is not charged to this request.
        const signal = rest.signal ?? AbortSignal.timeout(timeoutMs);
        const relay = relayConfig();
        const response = channel === "relay" && relay ? await viaRelay(relay, url, { ...rest, signal }) : await deps.fetchImpl(url, { ...rest, signal });
        entry.lastStatus = response.status;
        entry.lastError = null;
        if (response.status >= 400) entry.refused += 1;
        noteOutcome(host, entry, response.status >= 500);
        return response;
      } catch (error) {
        entry.failures += 1;
        noteOutcome(host, entry, true);
        entry.lastStatus = null;
        entry.lastError = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        const took = deps.now() - started;
        entry.meanMs = Math.round(entry.meanMs + (took - entry.meanMs) / entry.requests);
      }
    });
    entry.waitedMs += waitedMs;
    return value;
  }

  function upstreamStats(): UpstreamHostStats[] {
    return [...stats.values()].sort((a, b) => b.requests - a.requests);
  }

  /** Keep breaker state in `store` from now on; hosts already seen keep their in-memory state. */
  function useBreakerStore(store: BreakerStore): void {
    breakerStore = store;
  }

  return { upstreamFetch, upstreamStats, channelFor, useBreakerStore };
}

const shared = createUpstream({
  now: () => Date.now(),
  sleep: (ms) => Bun.sleep(ms),
  fetchImpl: (input, init) => fetch(input, init),
  env: process.env,
  gaps: HOST_GAP_MS,
  defaultGapMs: DEFAULT_GAP_MS,
});

/** Fetch from a publisher through the process-wide host gate, direct or by the relay. */
export const upstreamFetch = shared.upstreamFetch;
/** Requests, refusals and timing per host since the process started, busiest first. */
export const upstreamStats = shared.upstreamStats;
/** Which channel a host is fetched through under the current environment. */
export const upstreamChannel = shared.channelFor;
/** Where the process-wide gate keeps breaker state between restarts. */
export const useBreakerStore = shared.useBreakerStore;
