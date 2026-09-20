# The China Data Explorer. The store and the catalog cache live on a volume at
# /data; the catalog cache rebuilds itself from the checked-in snapshots on
# first start; a cold rebuild can take over a minute on a small instance.
#
#   docker build -t china-data-explorer .
#   docker run -p 5173:5173 -v china-data:/data china-data-explorer
#
# Refresh the store from inside the container:
#   docker exec <id> bun run server/ingest.ts
FROM oven/bun:1.3

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY tsconfig.json bun-env.d.ts ./
COPY server ./server
COPY client ./client
COPY shared ./shared
COPY catalog ./catalog
COPY seed ./seed

ENV NODE_ENV=production \
    PORT=5173 \
    CHINA_DB_PATH=/data/china.db \
    CHINA_CATALOG_DB_PATH=/data/catalog.db

# /data is mounted by the platform (Railway rejects a VOLUME instruction and
# supplies its own); it only needs to exist for a plain `docker run`.
RUN mkdir -p /data
EXPOSE 5173

HEALTHCHECK --interval=30s --timeout=5s --start-period=180s \
  CMD bun -e "fetch('http://127.0.0.1:5173/ready').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["bun", "run", "server/app.ts"]
