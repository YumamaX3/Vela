/**
 * P7 · the global undici dispatcher, tuned once at boot — the Responsive Tide
 * (plans/2026-11-01-responsive-tide-performance.md §III, mend P7).
 *
 * THE EXIT (the plan's words): "Config pinned in a test" — the tuned Agent is
 * installed as the process global, and every option is proven where undici
 * actually READS it in the vendored build (7.30.1), not merely where it was passed:
 *
 *   Agent[kOptions]  ← connections, keepAliveTimeout, keepAliveMaxTimeout,
 *                      keepAliveTimeoutThreshold, headersTimeout, bodyTimeout,
 *                      maxOrigins, connect   (agent.js:48 — the options Agent hands
 *                                             to every Pool it builds, :128)
 *   Pool/Client opts ← the same set PLUS pipelining + maxCachedSessions +
 *                      connectTimeout, recorded by the factory's live getter as
 *                      the first origin is dispatched (client.js:87-117)
 *
 * The witnesses are REAL: a live loopback HTTP server, a real fetch through
 * `getGlobalDispatcher()` from the vendored undici (the same specifier the boot
 * imports). The witnesses are SIDE-EFFECT-FREE outside this file: the dispatch
 * installs into THIS file's undici record, drives one loopback request, and hands
 * the prior global back in afterEach, so no other suite inherits the tuning.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { createServer } from "node:http";
import * as undici from "undici";
import {
  UNDICI_DEFAULTS,
  UNDICI_TUNING,
  UNDICI_CONNECT_TIMEOUT_MS,
  UNDICI_WATCHDOG_MS,
  installGlobalDispatcher,
  consumeDispatcher,
  getUndiciTuning,
  __resetGlobalDispatcherForTests,
} from "../../src/lib/perf/undiciDispatcher.js";

let server;
let origin;

beforeAll(async () => {
  server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("PONG");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await __resetGlobalDispatcherForTests();
  await new Promise((resolve) => server.close(resolve));
});

afterEach(async () => {
  await __resetGlobalDispatcherForTests();
});

/** Install, make ONE real request THROUGH THE GLOBAL (forcing the per-origin Pool). */
async function installAndProbe(path = "/") {
  const installed = await installGlobalDispatcher();
  expect(installed.ok).toBe(true);
  const response = await undici.request(`${origin}${path}`, { dispatcher: undici.getGlobalDispatcher() });
  expect(response.statusCode).toBe(200);
  expect(await response.body.text()).toBe("PONG");
  return consumeDispatcher();
}

describe("P7 — the install", () => {
  it("makes the tuned Agent the process global dispatcher", async () => {
    const prior = undici.getGlobalDispatcher();
    const result = await installGlobalDispatcher();
    expect(result).toEqual({ ok: true, connected: true });
    expect(undici.getGlobalDispatcher()).not.toBe(prior);
    expect(getUndiciTuning().installed).toBe(true);
  });

  it("is idempotent — a second boot call does not rebuild or replace the agent", async () => {
    await installGlobalDispatcher();
    const first = undici.getGlobalDispatcher();
    const second = await installGlobalDispatcher();
    expect(second).toEqual({ ok: true, connected: true, alreadyInstalled: true });
    expect(undici.getGlobalDispatcher()).toBe(first);
  });

  it("hands the prior global back on reset (no process left with no dispatcher)", async () => {
    const prior = undici.getGlobalDispatcher();
    await installGlobalDispatcher();
    const reset = await __resetGlobalDispatcherForTests();
    expect(reset.restored).toBe(true);
    expect(undici.getGlobalDispatcher()).toBe(prior);
    expect(getUndiciTuning().installed).toBe(false);
  });
});

describe("P7 — the tuning, as undici actually received it", () => {
  it("Agent[kOptions] carries connections, the keep-alive family and the stream timeouts", async () => {
    const { agentOptions } = await installAndProbe();
    expect(agentOptions).toBeTruthy();
    expect(agentOptions.connections).toBe(16);
    expect(agentOptions.keepAliveTimeout).toBe(65_000);
    expect(agentOptions.keepAliveMaxTimeout).toBe(600_000);
    expect(agentOptions.keepAliveTimeoutThreshold).toBe(2_000);
    expect(agentOptions.headersTimeout).toBe(120_000);
    expect(agentOptions.bodyTimeout).toBe(600_000);
    // `connect` is the watchdog-wrapped connector — a function, never undefined,
    // or the option-level connectTimeout would be the only bound left.
    expect(typeof agentOptions.connect).toBe("function");
  });

  it("the first origin's Pool/Client receives the FULL set, pipelining and session cache included", async () => {
    const { poolOptions, factoryFailure, origins } = await installAndProbe("/warm");
    expect(factoryFailure).toBeNull();
    expect(origins).toBe(1);
    expect(poolOptions).toMatchObject({
      connections: 16,
      keepAliveTimeout: 65_000,
      keepAliveMaxTimeout: 600_000,
      keepAliveTimeoutThreshold: 2_000,
      headersTimeout: 120_000,
      bodyTimeout: 600_000,
      pipelining: 1,
      maxCachedSessions: 256,
      connectTimeout: UNDICI_CONNECT_TIMEOUT_MS,
    });
  });

  it("a second ORIGIN builds its own pool with the same tuning (per-origin factory is live)", async () => {
    await installGlobalDispatcher();
    const one = await undici.request(`${origin}/a`, { dispatcher: undici.getGlobalDispatcher() });
    await one.body.dump();
    // Same origin, different path — the Agent keys clients by ORIGIN, so the
    // factory must NOT fire again. Two paths ≠ two pools.
    const two = await undici.request(`${origin}/b`, { dispatcher: undici.getGlobalDispatcher() });
    await two.body.dump();
    expect(consumeDispatcher().origins).toBe(1);
    // A genuinely different origin (a second loopback port) does build a pool.
    const second = createServer((req, res) => { res.writeHead(200); res.end("OK"); });
    await new Promise((r) => second.listen(0, "127.0.0.1", r));
    try {
      const res = await undici.request(`http://127.0.0.1:${second.address().port}/`, { dispatcher: undici.getGlobalDispatcher() });
      await res.body.dump();
      const probe = consumeDispatcher();
      expect(probe.origins).toBe(2);
      expect(probe.poolOptions.connections).toBe(16);
      expect(probe.poolOptions.keepAliveTimeout).toBe(65_000);
    } finally {
      await new Promise((r) => second.close(r));
    }
  });
});

describe("P7 — precedence (MEASURED, so the mend's claims can rot visibly)", () => {
  it("an explicit per-request dispatcher still WINS over the global", async () => {
    await installGlobalDispatcher();
    const explicit = new undici.Agent({ connections: 3 });
    try {
      const res = await undici.request(`${origin}/explicit`, { dispatcher: explicit });
      await res.body.dump();
      // The explicit agent tracked its own origin; the GLOBAL recorded nothing.
      expect(Object.keys(explicit.stats)).toHaveLength(1);
      expect(consumeDispatcher().origins).toBe(0);
    } finally {
      await explicit.close();
    }
  });

  it("a ProxyAgent's terminator Agent carries our connectTimeout (proxy paths are bounded too)", async () => {
    await installGlobalDispatcher();
    const proxy = new undici.ProxyAgent({ uri: "http://127.0.0.1:9", connectTimeout: UNDICI_CONNECT_TIMEOUT_MS });
    try {
      // undici/lib/dispatcher/proxy-agent.js builds `new Agent({ ...opts, factory,
      // connect })` from the ProxyAgent's OWN options, so a ProxyAgent is a
      // SEPARATE Agent tuned by its own knobs — the global's tuning never reaches
      // it. That is exactly why proxyFetch must pass connectTimeout (and why P7
      // wires the global only for no-proxy traffic). MEASURED here on the live
      // object: the terminator Agent (the `proxy agent` slot, the one that owns
      // Agent[kOptions]) carries connectTimeout; the ProxyAgent's own client slot
      // does not.
      const agentSlot = proxy[Object.getOwnPropertySymbols(proxy).find((s) => s.description === "proxy agent")];
      expect(agentSlot).toBeTruthy();
      const optSym = Object.getOwnPropertySymbols(agentSlot).find((s) => s.description === "options");
      expect(agentSlot[optSym].connectTimeout).toBe(UNDICI_CONNECT_TIMEOUT_MS);
    } finally {
      await proxy.close();
    }
  });

  it("fetch() with no dispatcher reaches the tuned global (the gateway's direct path)", async () => {
    await installGlobalDispatcher();
    // globalThis.fetch is Node's undici fetch — the same module record this file
    // imported. A plain fetch, no dispatcher option, must land on our Agent.
    const before = consumeDispatcher().origins;
    const res = await fetch(`${origin}/fetch`);
    expect(await res.text()).toBe("PONG");
    expect(consumeDispatcher().origins).toBe(before + 1);
  });
});

describe("P7 — head-of-line freedom (the reason connections > 1)", () => {
  it("a request hung at HEADERS does not block a fast one (the connections:1 defect)", async () => {
    // MEASURED on undici 7.30.1: with connections:1 an unpipelined client whose
    // first request is still awaiting headers reports kNeedDrain=2 (client.js:354-358,
    // gated by kResuming + kBusy), so Pool refuses to hand it back (pool.js:112) and
    // cannot build another — the SECOND request waits for the first. Live proof:
    // connections:1 fast=929ms / slow=930ms; connections:2 fast=57ms; 16 fast=62ms.
    // The TUNED global must sit on the free side of that line.
    const gate = createServer((req, res) => {
      const send = () => { res.writeHead(200, { "content-type": "text/plain" }); res.end(req.url === "/slow" ? "SLOW" : "FAST"); };
      if (req.url === "/slow") setTimeout(send, 700);
      else send();
    });
    await new Promise((r) => gate.listen(0, "127.0.0.1", r));
    const g = `http://127.0.0.1:${gate.address().port}`;
    try {
      const installed = await installGlobalDispatcher();
      expect(installed.ok).toBe(true);
      const t0 = Date.now();
      const slow = undici.request(`${g}/slow`, { dispatcher: undici.getGlobalDispatcher() });
      await new Promise((r) => setTimeout(r, 60)); // the slow request is now hung by headers
      const fast = undici.request(`${g}/fast`, { dispatcher: undici.getGlobalDispatcher() });
      const fastRes = await fast;
      const fastMs = Date.now() - t0;
      expect(await fastRes.body.text()).toBe("FAST");
      const slowRes = await slow;
      const slowMs = Date.now() - t0;
      expect(await slowRes.body.text()).toBe("SLOW");
      // The fast turn must land WELL before the slow one releases (~700ms).
      expect(fastMs).toBeLessThan(400);
      expect(slowMs).toBeGreaterThanOrEqual(600);
    } finally {
      await new Promise((r) => gate.close(r));
    }
  });
});

describe("P7 — the documented tuning (pin)", () => {
  it("UNDICI_TUNING is the measured table, and differs from the defaults only where intended", () => {
    expect(UNDICI_DEFAULTS).toEqual({
      connections: 1,
      keepAliveTimeout: 4_000,
      keepAliveMaxTimeout: 600_000,
      keepAliveTimeoutThreshold: 2_000,
      headersTimeout: 300_000,
      bodyTimeout: 300_000,
      pipelining: 1,
    });
    expect(UNDICI_TUNING).toEqual({
      connections: 16,
      keepAliveTimeout: 65_000,
      keepAliveMaxTimeout: 600_000,
      keepAliveTimeoutThreshold: 2_000,
      headersTimeout: 120_000,
      bodyTimeout: 600_000,
      pipelining: 1,
      maxCachedSessions: 256,
    });
    // The two deliberate "unchanged" pins, and the two bounds that are raised
    // (bodyTimeout) or tightened (headersTimeout) — a reader can diff intent.
    expect(UNDICI_TUNING.keepAliveMaxTimeout).toBe(UNDICI_DEFAULTS.keepAliveMaxTimeout);
    expect(UNDICI_TUNING.keepAliveTimeoutThreshold).toBe(UNDICI_DEFAULTS.keepAliveTimeoutThreshold);
    expect(UNDICI_TUNING.bodyTimeout).toBeGreaterThan(UNDICI_DEFAULTS.bodyTimeout);
    expect(UNDICI_TUNING.headersTimeout).toBeLessThan(UNDICI_DEFAULTS.headersTimeout);
    expect(UNDICI_WATCHDOG_MS).toBeGreaterThan(UNDICI_CONNECT_TIMEOUT_MS);
  });

  it("the reported tuning is a live read of what was built, and mutation of the copy cannot rewrite it", async () => {
    await installGlobalDispatcher();
    const a = getUndiciTuning();
    expect(a.installed).toBe(true);
    expect(a.connectTimeoutMs).toBe(UNDICI_CONNECT_TIMEOUT_MS);
    expect(a.watchdogMs).toBe(UNDICI_WATCHDOG_MS);
    a.tuning.connections = 999;
    expect(getUndiciTuning().tuning.connections).toBe(16);
  });

  it("before an install, the reported tuning is undici's documented default, flagged installed:false", () => {
    const t = getUndiciTuning();
    expect(t.installed).toBe(false);
    expect(t.tuning).toEqual({ ...UNDICI_DEFAULTS });
    expect(t.connectTimeoutMs).toBeNull();
  });
});
