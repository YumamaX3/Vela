const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const origCreate = http.createServer.bind(http);

// ─── Ship constants ─────────────────────────────────────────────────────────
// Hard ceiling for an h2c-upgraded request body (the replay path buffers it in
// memory). Reconciled with the dashboard's own /v1 cap (32mb in next.config.mjs)
// — this guard is not a second, larger door but the same one, since an h2c
// upgrade replays into the identical handler. It was 512mb, four times the old
// /v1 ceiling and a quarter of the chart's 2G memory limit, which meant a single
// upgrade could exhaust the container before the proxy's own cap ever ran.
const MAX_H2C_BODY_BYTES = 16 * 1024 * 1024;
// Drain window for in-flight requests before the process exits on SIGTERM.
const DRAIN_TIMEOUT_MS = 10_000;
// Hop-by-hop headers (RFC 7230 §6.1) must never be forwarded by a proxy.
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

// Response security headers applied to every response the gateway emits
// (dashboard HTML, /v1 JSON/SSE, API routes). Only headers that are
// universally safe for a proxied-API surface are set here. CSP is NOT set
// at the helm: the dashboard document CSP lives in src/dashboardGuard.js
// (nonce'd, scoped to /dashboard + /login, added 2026-09-30) — the old claim
// that "the dashboard's React runtime owns its own CSP" was false; nothing
// set one until that tide.
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

// Connection hygiene for a long-lived gateway. keepAliveTimeout bounds idle
// kept-alive sockets; headersTimeout bounds header receipt and MUST exceed
// keepAliveTimeout (Node throws otherwise). requestTimeout is left at Node's
// default on purpose — this server proxies long-lived SSE streams, and a low
// request cap would sever them.
const KEEPALIVE_TIMEOUT_MS = 65_000;
const HEADERS_TIMEOUT_MS = 66_000;

// Per-process secret proving x-9r-real-ip was stamped below rather than sent by the client.
// A bare `next start` / `next dev` never loads this file, so it cannot produce a matching
// header even though the env var is inherited by child processes. Named like x-9r-cli-token
// so the request-detail header sanitizer redacts it too.
const PEER_TOKEN = crypto.randomBytes(24).toString("hex");
process.env.VELA_PEER_TOKEN = PEER_TOKEN;

// NOTE: the background token refresh scheduler is started by src/shared/services/
// initializeApp.js (via bootstrap) when the Next app boots — the ONLY live start
// path. An earlier fs-path import here never worked in ANY layout (the raw file’s
// bare `open-sse/...` import cannot resolve from repo root or standalone) and was
// removed 2026-09-30; the import failure was swallowed, making the old latch dead
// weight that only pretended to be a second start path.

// Wrap Next standalone HTTP server: derive client IP from the TCP socket
// (unspoofable) and strip client-supplied forwarding headers so downstream
// rate-limiting keys on the real peer address instead of attacker-controlled XFF.
http.createServer = (...args) => {
  const handler = args.find((a) => typeof a === "function");
  const rest = args.filter((a) => typeof a !== "function");
  if (!handler) return origCreate(...args);
  const wrapped = (req, res) => {
    // Apply the security header set before the handler runs, so every
    // response the gateway emits carries them. Skip keys the handler already
    // set (Next may set its own x-frame-options on some routes) — the handler
    // wins, and we only fill the gaps.
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      if (!res.hasHeader?.(name)) res.setHeader(name, value);
    }
    const socketIp = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "";
    const xff = req.headers["x-forwarded-for"];
    const xRealIp = req.headers["x-real-ip"];
    const viaProxy = !!(xff || xRealIp);
    const isLoopbackProxy = socketIp === "127.0.0.1" || socketIp === "::1" || socketIp === "::ffff:127.0.0.1";
    // Trust forwarding headers only when the TCP peer is a local reverse proxy.
    // Direct/public sockets remain keyed by the unspoofable peer address.
    const proxyIp = xRealIp || (xff ? String(xff).split(",")[0].trim() : "");
    const ip = isLoopbackProxy && proxyIp ? proxyIp : socketIp;
    // Hop-by-hop hygiene: a client must not dictate connection semantics to
    // upstreams through this server. Strip the RFC 7230 §6.1 set (the h2c
    // path deletes `upgrade` explicitly; the main path strips all of them).
    for (const h of HOP_BY_HOP) delete req.headers[h];
    delete req.headers["x-9r-real-ip"];
    delete req.headers["x-forwarded-for"];
    delete req.headers["x-9r-via-proxy"];
    delete req.headers["x-9r-peer-token"];
    req.headers["x-9r-real-ip"] = ip;
    req.headers["x-9r-peer-token"] = PEER_TOKEN;
    if (viaProxy) req.headers["x-9r-via-proxy"] = "1";
    return handler(req, res);
  };
  const server = origCreate(...rest, wrapped);
  // Connection hygiene for a long-lived gateway (see the constants above).
  server.keepAliveTimeout = KEEPALIVE_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.once("listening", () => {
    // Background token refresh starts via initializeApp (bootstrap) — see the
    // NOTE near the top of this file. Nothing else is owed on listening.
  });

  // Graceful drain: stop accepting new connections, let in-flight requests
  // finish (bounded), then exit. Docker sends SIGTERM on `docker stop`; a
  // clean drain avoids the half-boot states that cost the 0.9.19 tide.
  //
  // M4 — THE LOGSHIPPER HANDSHAKE (sealed plan §2.1). The measured wound:
  // 5,000/5,000 accepted log lines were lost on a graceful restart, because
  // the ring's last batches sat in a worker thread when `process.exit(0)` fired.
  // So the drain now FLUSHES BEFORE IT EXITS.
  //
  // THREE SEQUENCING FACTS — the third one is a MEASURED correction, and the
  // measurement is why this comment is longer than the code:
  //   1. `server.close()` is INITIATED first, never awaited. Awaiting it before
  //      flushing would serialize the flush behind every in-flight request.
  //   2. THE EXIT WAITS FOR THE FLUSH. This was WRONG on the first attempt, and
  //      the probe caught it: with the exit racing the handshake, `server.close()`'s
  //      callback fired at +1ms and called `process.exit(0)` while the worker's
  //      `stopped` ack was still 99ms away — the rows were never written and the
  //      whole handshake was theatre. The close callback therefore resolves a
  //      PROMISE, and the exit happens after BOTH the close and the flush have
  //      settled. Neither may wait on the other.
  //   3. THE 10s BACKSTOP IS UNTOUCHED and remains the outer ceiling; the 2s
  //      handshake sits INSIDE it, so a wedged worker cannot strand the process.
  //      `draining` is the idempotency latch — Docker sends SIGTERM twice on a
  //      slow stop, and the handshake is itself idempotent (one shared promise).
  let draining = false;
  let exited = false;
  const exitAfterDrain = () => {
    if (exited) return;
    exited = true;
    process.exit(0);
  };
  const drain = () => {
    if (draining) return;
    draining = true;
    // Close the listener now; resolve the promise only when the socket drains.
    const closed = new Promise((resolve) => server.close(() => resolve()));
    // The handshake never rejects and never outlives its 2s bound, so awaiting
    // both can only make this drain FINITE — which is the whole law.
    void Promise.all([closed, flushLogsBeforeExit()]).then(exitAfterDrain);
    // The outer backstop, unchanged: if an in-flight request or a wedged worker
    // outlasts everything above, the process still leaves on time.
    setTimeout(exitAfterDrain, DRAIN_TIMEOUT_MS).unref();
  };
  process.once("SIGTERM", drain);
  process.once("SIGINT", drain);

  // M4 — reach the shipper's shutdown door. BEST-EFFORT BY CONSTRUCTION, and
  // the seam is chosen from what was MEASURED rather than what reads well:
  //
  //
  //   · This file is CommonJS at the repo root; the shipper is ESM under `src/`.
  //   · `require()` of that ESM path works on Node 22+/25 (verified), BUT an ESM
  //     module already registered in the loader is NOT re-requireable by path
  //     (measured: MODULE_NOT_FOUND once the app had booted it). So whether this
  //     reaches the LIVE module or a SECOND, never-booted copy depends on layout.
  //   · A never-booted copy is harmless but useless — `state.booted` is false, so
  //     its handshake resolves immediately and flushes nothing. The flush is
  //     therefore LOSSLESS only where the module resolves to the booted instance.
  //
  // Every failure path resolves, so a missing module costs the flush, never the
  // drain. `next dev` and a bare `next start` never load this file at all, so no
  // flush is lost there — nothing boots a shipper in those paths.
  let shutdownPromise = null;
  function flushLogsBeforeExit() {
    try {
      const mod = require("./src/lib/logshipper/index.js");
      shutdownPromise = Promise.resolve(mod.shutdownLogshipper());
    } catch {
      shutdownPromise = Promise.resolve();
    }
    return shutdownPromise;
  }

  // The `beforeExit` belt (§2.1): fires when the loop drains NATURALLY, which a
  // SIGTERM never does — so this covers `next dev`, a plain `next start`, and any
  // path that reaches the end of its work without a signal.
  process.once("beforeExit", () => {
    void flushLogsBeforeExit();
  });
  const origEmit = server.emit;
  // JBR 25 sends h2c upgrades that the HTTP/1.1 server would otherwise close.
  server.emit = function (event, ...eventArgs) {
    const [req, socket, head] = eventArgs;
    if (event !== "upgrade" || String(req.headers.upgrade || "").toLowerCase() !== "h2c") {
      return origEmit.call(this, event, ...eventArgs);
    }

    const contentLength = Number(req.headers["content-length"] || 0);
    if (
      !Number.isSafeInteger(contentLength) ||
      contentLength < 0 ||
      contentLength > MAX_H2C_BODY_BYTES
    ) {
      socket.destroy();
      return true;
    }
    const chunks = [head];
    let received = head.length;
    const serve = () => {
      // Replay the upgraded request through the existing HTTP/1.1 handler.
      const replay = new http.IncomingMessage(socket);
      Object.assign(replay, { method: req.method, url: req.url, headers: req.headers, complete: true });
      if (received) replay.push(Buffer.concat(chunks, received).subarray(0, contentLength));
      replay.push(null);
      const res = new http.ServerResponse(replay);
      res.shouldKeepAlive = false;
      res.assignSocket(socket);
      res.once("finish", () => socket.end());
      Promise.resolve().then(() => wrapped(replay, res)).catch((error) => {
        console.error("Failed to downgrade h2c request", error);
        socket.destroy();
      });
    };
    if (received >= contentLength) serve();
    else {
      socket.on("data", function readBody(chunk) {
        chunks.push(chunk);
        received += chunk.length;
        if (received < contentLength) return;
        socket.off("data", readBody);
        serve();
      });
      socket.resume();
    }
    delete req.headers.upgrade;
    delete req.headers["http2-settings"];
    req.headers.connection = "close";
    return true;
  };
  return server;
};

if (require.main === module) {
  const standalone = path.join(__dirname, "server.js");
  if (fs.existsSync(standalone)) {
    require(standalone);
  } else {
    // Repo checkout has no standalone build next to us. `next start` builds its HTTP
    // server in-process, so the wrapper above still sanitizes every request.
    const nextBin = require.resolve("next/dist/bin/next");
    process.argv = [process.argv[0], nextBin, "start", ...process.argv.slice(2)];
    require(nextBin);
  }
}
