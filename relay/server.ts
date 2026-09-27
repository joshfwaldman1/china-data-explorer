/**
 * The China-side relay: fetches a publisher page for the explorer from a
 * mainland address, and does nothing else.
 *
 * Some publishers refuse a foreign address outright: Customs' statistics
 * portal answers HTTP 412 and the NBS query API a UrlACL 403, from any US
 * address we tried, residential included. The explorer's host gate
 * (`server/upstream.ts`) sends requests for the hosts named in
 * `CHINA_RELAY_HOSTS` here instead of to the publisher. This service makes the
 * request and hands back the publisher's status, content type and body
 * unchanged. It parses nothing, stores nothing and paces nothing: pacing is
 * the explorer's gate, which already sends one request at a time per host.
 *
 * It is not an open proxy. A request needs the bearer token, and the target
 * must be one of `RELAY_ALLOWED_HOSTS`. Deploy it on any small mainland host
 * (a Bun process or the Dockerfile beside this file):
 *
 *   RELAY_TOKEN=... RELAY_ALLOWED_HOSTS=stats.customs.gov.cn,data.stats.gov.cn bun run relay/server.ts
 *
 * then set `CHINA_RELAY_URL`, `CHINA_RELAY_TOKEN` and `CHINA_RELAY_HOSTS` on
 * the explorer.
 */

export interface RelayConfig {
  token: string;
  allowedHosts: Set<string>;
  timeoutMs: number;
  fetchImpl: (input: string, init: RequestInit) => Promise<Response>;
}

interface RelayRequest { url: string; method: string; headers: Record<string, string>; body?: string }

/** Headers a caller may not set on the publisher request: they describe the relay hop, not the request. */
const DROPPED_HEADERS = new Set(["host", "authorization", "content-length", "connection", "x-forwarded-for", "x-real-ip"]);

function parseRelayRequest(value: unknown): RelayRequest | null {
  if (typeof value !== "object" || value === null) return null;
  const url = Reflect.get(value, "url");
  const method = Reflect.get(value, "method") ?? "GET";
  const headers = Reflect.get(value, "headers") ?? {};
  const body = Reflect.get(value, "body");
  if (typeof url !== "string" || typeof method !== "string" || typeof headers !== "object" || headers === null) return null;
  if (body !== undefined && typeof body !== "string") return null;
  if (!["GET", "POST"].includes(method.toUpperCase())) return null;
  const cleanHeaders: Record<string, string> = {};
  for (const [name, headerValue] of Object.entries(headers)) {
    if (typeof headerValue === "string" && !DROPPED_HEADERS.has(name.toLowerCase())) cleanHeaders[name] = headerValue;
  }
  return { url, method: method.toUpperCase(), headers: cleanHeaders, ...(body !== undefined ? { body } : {}) };
}

/** Answer one request to the relay. Exported so the tests can drive it without a socket. */
export async function handleRelay(request: Request, config: RelayConfig): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === "/health") return Response.json({ ok: true, hosts: [...config.allowedHosts] });
  if (path !== "/fetch" || request.method !== "POST") return new Response("not found", { status: 404 });
  // A relay started without a token refuses everything rather than serving anyone.
  if (!config.token || request.headers.get("authorization") !== `Bearer ${config.token}`) return new Response("unauthorised", { status: 401 });

  let parsed: RelayRequest | null = null;
  try { parsed = parseRelayRequest(await request.json()); } catch { parsed = null; }
  if (!parsed) return new Response("bad request", { status: 400 });

  let target: URL;
  try { target = new URL(parsed.url); } catch { return new Response("bad url", { status: 400 }); }
  if (!["http:", "https:"].includes(target.protocol) || !config.allowedHosts.has(target.hostname.toLowerCase())) {
    return new Response(`host not allowed: ${target.hostname}`, { status: 403 });
  }

  try {
    const upstream = await config.fetchImpl(target.toString(), {
      method: parsed.method,
      headers: parsed.headers,
      ...(parsed.body !== undefined ? { body: parsed.body } : {}),
      redirect: "follow",
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    const headers = new Headers({ "x-upstream-status": String(upstream.status) });
    const type = upstream.headers.get("content-type");
    if (type) headers.set("x-upstream-content-type", type);
    // Always 200 on the hop itself: the publisher's status travels in the header, so the explorer can tell a relay fault from a publisher's refusal.
    return new Response(await upstream.arrayBuffer(), { status: 200, headers });
  } catch (error) {
    return new Response(`upstream fetch failed: ${error instanceof Error ? error.message : String(error)}`, { status: 502 });
  }
}

if (import.meta.main) {
  const config: RelayConfig = {
    token: process.env.RELAY_TOKEN?.trim() ?? "",
    allowedHosts: new Set((process.env.RELAY_ALLOWED_HOSTS ?? "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean)),
    timeoutMs: Number(process.env.RELAY_TIMEOUT_MS ?? 60_000),
    fetchImpl: (input, init) => fetch(input, init),
  };
  if (!config.token) throw new Error("RELAY_TOKEN is required");
  if (config.allowedHosts.size === 0) throw new Error("RELAY_ALLOWED_HOSTS is required");
  const server = Bun.serve({ port: Number(process.env.PORT ?? 8787), idleTimeout: 120, fetch: (request) => handleRelay(request, config) });
  console.log(`relay listening on ${server.port} for ${[...config.allowedHosts].join(", ")}`);
}
