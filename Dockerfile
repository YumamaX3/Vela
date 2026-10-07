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
# ─── The log driver's pin (M10) ──────────────────────────────────────────
# The runner does NOT pin VELA_DB_DRIVER today — only the BUILDER does, and
# that ENV is builder-scoped by design (Dockerfile:24). So on the shipped image
# "the main handle is node:sqlite" is NOT true; it is merely whatever the chain
# resolves. `VELA_LOG_DRIVER` pins the WORKER's own handle (sealed plan §2,
# "Driver pin"), so this ENV is what makes the declaration TRUE rather than
# inferred. node:sqlite ships inside the node binary: no native addon, so the
# arm64-under-QEMU SIGILL class cannot reach it, and the wasm fallback is not
# paid for either. Same declaration shape as the builder's line 24.
ENV VELA_LOG_DRIVER=node:sqlite
# ─── The heap ceiling (stability) ────────────────────────────────────────
# V8 sizes its old space from the HOST's memory, not from the container's
# cgroup limit, so on a large host inside a 2G container the GC happily grows
# past the limit and the kernel SIGKILLs the process mid-request — an abrupt
# death with no heap trace. A cap makes the GC work harder and, in the worst
# case, throw an ordinary JS heap error the process can log and survive. 1024
# leaves room under the chart's 2G for the 32mb body copies and native buffers.
# Override per deployment with `NODE_OPTIONS` in the compose chart.
ENV NODE_OPTIONS=--max-old-space-size=1024

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
# ─── The log shipper's worker (M10) ──────────────────────────────────────
# `initLogshipper` spawns a REAL `worker_threads` Worker by PATH:
# `new Worker(new URL("./worker.js", import.meta.url))` (logshipper/index.js:424).
# Next's standalone output tracing CANNOT follow `new Worker(url)` — there is
# no static import edge to follow — so worker.js is absent from the image and
# the shipper would die at boot, taking the durable log ledger with it.
# Measured, not assumed: `import.meta.url` is INLINED by the server bundler as
# a build-machine absolute literal (chunk: `fileURLToPath("file:///…/src/…")`,
# zero occurrences of `import.meta.url` survive in the compiled chunks), so the
# URL resolves against THIS mirrored path, not against the bundler's chunk dir.
# Hence the src-mirror layout, the same precedent as the MITM copy above.
#
# THE COPY IS THE WHOLE CLOSURE, NOT JUST worker.js (mysql2-closure precedent):
# the worker is loaded BY PATH by Node, so its relative imports are resolved by
# Node's ESM loader and NO bundler follows them. Measured closure:
#   logshipper/{writer,workerDriver}.js
#   db/repos/sqlite/logStore.js → db/schema.js
#   db/adapters/{node,betterSqlite,bunSqlite,sqljs}Adapter.js → db/{schema,checkpointOwner}.js
# Every one of those files is alias-free (`@/` does NOT resolve in a spawned
# thread — workerDriver.js's header) but Node-relative, so a lone worker.js COPY
# would ENOENT on `./writer.js` the first time it boots.
COPY --from=builder /app/src/lib/logshipper ./src/lib/logshipper
COPY --from=builder /app/src/lib/db/repos/sqlite/logStore.js ./src/lib/db/repos/sqlite/logStore.js
COPY --from=builder /app/src/lib/db/adapters ./src/lib/db/adapters
COPY --from=builder /app/src/lib/db/schema.js ./src/lib/db/schema.js
COPY --from=builder /app/src/lib/db/checkpointOwner.js ./src/lib/db/checkpointOwner.js
# v1.0.70 added retention.js's import of settingsDefaults.js (the ONE set of
# retention numbers) but the closure above was never re-measured, so the
# worker's retention sweep died at boot: ERR_MODULE_NOT_FOUND for
# /app/src/lib/db/repos/settingsDefaults.js. The file imports nothing, so this
# one COPY closes the gap. Re-measure this closure whenever any file in it
# gains a NEW cross-directory import — that is the law this block already
# states, and this line is what honoring it looks like.
COPY --from=builder /app/src/lib/db/repos/settingsDefaults.js ./src/lib/db/repos/settingsDefaults.js
# Standalone node_modules may omit deps only required by the MITM child process.
COPY --from=builder /app/node_modules/node-forge ./node_modules/node-forge
# Ensure `next` is available at runtime in case tracing did not include it.
COPY --from=builder /app/node_modules/next ./node_modules/next
# sql.js loads dist/sql-wasm.wasm by path at runtime; tracing only follows JS imports,
# so the last-resort DB driver would abort with ENOENT on the missing binary.
COPY --from=builder /app/node_modules/sql.js ./node_modules/sql.js
# node-machine-id is createRequire-loaded at runtime (src/mitm/manager.js:156) and
# a plain ESM import in src/shared/utils/machine*.js that tracing omits — the
# standalone image would crash on first machine-id read (ported from upstream
# 9router 15687d19 — W1, v0.9.47).
COPY --from=builder /app/node_modules/node-machine-id ./node_modules/node-machine-id
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
