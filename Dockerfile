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

# ─── Vela — The AI Gateway ───────────────────────────────────────────────
# Full OCI metadata so the image self-describes in registries and UIs.
# VELA_VERSION is injected by CI (docker build --build-arg VELA_VERSION=<tag>);
# the default below is only a fallback for local builds.
ARG VELA_VERSION=dev
LABEL org.opencontainers.image.title="Vela"
LABEL org.opencontainers.image.description="The AI Gateway — one OpenAI-compatible endpoint across 140+ providers"
LABEL org.opencontainers.image.source="https://github.com/YumamaX3/Vela"
LABEL org.opencontainers.image.version="${VELA_VERSION}"
LABEL org.opencontainers.image.revision="${GITHUB_SHA:-unknown}"
LABEL org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production
ENV PORT=32060
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATA_DIR=/app/data
ENV VELA_DEPLOYMENT=docker

# ─── Runtime hardening ───────────────────────────────────────────────────
# ca-certificates: the gateway makes TLS calls to upstream providers, the
# npm registry, and GitHub's API; without a current CA bundle those fail.
# tini: a proper PID 1 that reaps zombies and forwards signals cleanly, so
# SIGTERM reaches the Node process for the graceful drain.
RUN apk --no-cache upgrade && apk --no-cache add ca-certificates tini su-exec && \
  printf '#!/bin/sh\nchown -R node:node /app/data /app/data-home 2>/dev/null\nexec su-exec node "$@"\n' > /entrypoint.sh && \
  chmod +x /entrypoint.sh

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

# Graceful drain is handled in custom-server.js (SIGTERM → close → drain → exit).
STOPSIGNAL SIGTERM

EXPOSE 32060

# Liveness for orchestrators and the compose chart alike — public allow-list,
# no auth. The health endpoint doubles as the drain probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:32060/api/health >/dev/null 2>&1 || exit 1

# tini is PID 1 — it reaps zombies and forwards SIGTERM cleanly to the
# entrypoint, which chowns mounted volumes then drops to the node user.
ENTRYPOINT ["/sbin/tini", "--", "/entrypoint.sh"]
CMD ["node", "custom-server.js"]
