/**
 * China Data Explorer — a FRED-style browser for Chinese macro data.
 *
 * Open-source stack, nothing from scratch:
 *   - Bun.serve for the server + bundler (bundles the React/TSX frontend)
 *   - React 19 for the UI, Recharts for the charts (both already in the project)
 *   - data.ts proxies Eastmoney / NBS server-side (avoids browser CORS)
 *
 * Run:  bun run china-explorer/server.ts   (from the project root)
 */

import index from "./index.html";
import { catalogList, getSeries } from "./data";

const port = Number(process.env.PORT ?? 5173);

const routes = {
    "/": index,
    "/api/catalog": () => Response.json(catalogList()),
    "/api/series/:key": async (req) => {
      const key = req.params.key;
      const limit = Number(new URL(req.url).searchParams.get("limit") ?? "120");
      try {
        const data = await getSeries(key, Number.isFinite(limit) ? limit : 120);
        if (!data) return Response.json({ error: "Unknown series" }, { status: 404 });
        return Response.json(data);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Upstream fetch failed";
        return Response.json({ error: message }, { status: 502 });
      }
    },
} as const;

const dev = { hmr: true, console: true } as const;

// AkShare calls (via AKTools) can take 15-25s; Bun's default 10s idle timeout
// would kill those connections mid-fetch. Give slow upstreams room.
const idleTimeout = 60;

let server;
try {
  server = Bun.serve({ port, idleTimeout, routes, development: dev });
} catch (error) {
  // Most commonly the port is already taken (5173 is also Vite's default).
  // Fall back to an OS-assigned free port instead of crashing.
  const code = error && typeof error === "object" && "code" in error ? error.code : "";
  if (code === "EADDRINUSE") {
    console.warn(`Port ${port} is in use — starting on a free port instead. (Set PORT to choose one.)`);
    server = Bun.serve({ port: 0, idleTimeout, routes, development: dev });
  } else {
    throw error;
  }
}

console.log(`\n  China Data Explorer running at ${server.url}\n`);
