/**
 * One JSON request to an upstream portal, with one retry.
 *
 * Eastmoney, NBS and FRED all drop a socket or answer 502 now and then, and
 * a second try a moment later almost always succeeds. Every upstream call
 * goes through here so that behaviour is in one place: a request that
 * throws (connection, timeout, or the body read) or comes back 5xx is tried
 * again once after a short pause; a 4xx is returned as is, since repeating
 * it would not change the answer.
 */

import { upstreamFetch } from "./upstream";

export interface JsonResponse { ok: boolean; status: number; json: unknown }

export interface FetchJsonOptions {
  timeoutMs?: number;
  retryDelayMs?: number;
  attempts?: number;
  /** Injected for tests; defaults to the process-wide host gate (`upstream.ts`). */
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
}

export async function fetchJson(url: string, init: RequestInit = {}, options: FetchJsonOptions = {}): Promise<JsonResponse> {
  const { timeoutMs = 45_000, retryDelayMs = 1500, attempts = 2, fetchImpl } = options;
  let lastError: unknown = new Error("no attempt made");
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      // Through the gate the timeout starts when the host is free, so a wait behind a crawl is not charged to the request.
      const response = fetchImpl
        ? await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
        : await upstreamFetch(url, { ...init, timeoutMs });
      if (response.status >= 500 && attempt < attempts) {
        lastError = new Error(`HTTP ${response.status}`);
      } else {
        const json: unknown = response.ok ? await response.json() : null;
        return { ok: response.ok, status: response.status, json };
      }
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
