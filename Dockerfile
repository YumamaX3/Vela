# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE} AS base
WORKDIR /app

FROM base AS builder

RUN apk --no-cache upgrade && apk --no-cache add python3 make g++ linux-headers

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
  npm ci

COPY . ./
ENV NEXT_TELEMETRY_DISABLED=1
# `next build` prerenders DB-backed pages, which initializes the storage layer
# (the build log shows migrations #1-#11 running at build time). The default
# fallback chain picks better-sqlite3 first — a native addon compiled during
# `npm install`. On the linux/arm64 cross-build leg, loading that addon under
# QEMU crashes with "qemu: uncaught target signal 4 (Illegal instruction)".
# Force Node's built-in node:sqlite here instead: it ships inside the node
# binary, needs no native compile, and never executes a .node file under QEMU.
# Builder-scoped only — the runner stage keeps its own env and is unaffected.
ENV VELA_DB_DRIVER=node:sqlite
RUN npm run build

FROM ${NODE_IMAGE} AS runner
WORKDIR /app

LABEL org.opencontainers.image.title="vela"

ENV NODE_ENV=production
ENV PORT=32060
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATA_DIR=/app/data

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/custom-server.js ./custom-server.js
COPY --from=builder /app/open-sse ./open-sse
# Next file tracing can omit sibling files; MITM runs server.js as a separate process.
COPY --from=builder /app/src/mitm ./src/mitm
# Standalone node_modules may omit deps only required by the MITM child process.
COPY --from=builder /app/node_modules/node-forge ./node_modules/node-forge
# Ensure `next` is available at runtime in case tracing did not include it.
COPY --from=builder /app/node_modules/next ./node_modules/next
# sql.js loads dist/sql-wasm.wasm by path at runtime; tracing only follows JS imports,
# so the last-resort DB driver would abort with ENOENT on the missing binary.
COPY --from=builder /app/node_modules/sql.js ./node_modules/sql.js
# mysql2 loads via a runtime dynamic import (src/lib/db/mysql/pool.js); file tracing
# does not follow it, so the mysql/mirror postures would boot with no mysql2 present.
# mysql2 is pure JS (no native bindings) but NOT self-contained — its 9 runtime deps
# load only through that same untraced import, so the WHOLE closure must ride along.
# (Closure computed at Wave C7; the Docker smoke — VELA_DB_MODE=mysql against a
#  throwaway MariaDB — fails loud if any dep is missing. Extend this list if mysql2
#  ever gains a dependency.)
COPY --from=builder /app/node_modules/mysql2 ./node_modules/mysql2
COPY --from=builder /app/node_modules/aws-ssl-profiles ./node_modules/aws-ssl-profiles
COPY --from=builder /app/node_modules/generate-function ./node_modules/generate-function
COPY --from=builder /app/node_modules/iconv-lite ./node_modules/iconv-lite
COPY --from=builder /app/node_modules/is-property ./node_modules/is-property
COPY --from=builder /app/node_modules/long ./node_modules/long
COPY --from=builder /app/node_modules/lru.min ./node_modules/lru.min
COPY --from=builder /app/node_modules/named-placeholders ./node_modules/named-placeholders
COPY --from=builder /app/node_modules/safer-buffer ./node_modules/safer-buffer
COPY --from=builder /app/node_modules/sql-escaper ./node_modules/sql-escaper

RUN mkdir -p /app/data && chown -R node:node /app && \
  mkdir -p /app/data-home && chown node:node /app/data-home && \
  ln -sf /app/data-home /root/.vela 2>/dev/null || true

# Fix permissions at runtime (handles mounted volumes)
RUN apk --no-cache upgrade && apk --no-cache add su-exec && \
  printf '#!/bin/sh\nchown -R node:node /app/data /app/data-home 2>/dev/null\nexec su-exec node "$@"\n' > /entrypoint.sh && \
  chmod +x /entrypoint.sh

EXPOSE 32060

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "custom-server.js"]
