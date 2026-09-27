# The China-side relay (relay/server.ts). No dependencies: Bun alone.
# docker build -f relay/Dockerfile -t china-relay . && docker run -e RELAY_TOKEN=... -e RELAY_ALLOWED_HOSTS=stats.customs.gov.cn -p 8787:8787 china-relay
FROM oven/bun:1.3-alpine
WORKDIR /app
COPY relay/server.ts ./server.ts
ENV PORT=8787
EXPOSE 8787
USER bun
CMD ["bun", "run", "server.ts"]
