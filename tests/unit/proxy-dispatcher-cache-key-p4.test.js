/**
 * P4 · the dispatcher cache-key miss — the Responsive Tide campaign
 * (plans/2026-11-01-responsive-tide-performance.md §III, suspect 4 → mend P4).
 *
 * THE TURBULENCE. getDispatcher() WROTE under `cacheKey` (proxyFetch.js:444) but
 * READ back under `normalized` (:447). With no pooling knobs the two strings are
 * identical (`cacheKey = normalized`), so the miss was invisible — which is why
 * proxy-storm-error-redaction.test.js's reuse test (:265) stayed green. With ANY
 * pooling object, `cacheKey` is `normalized|{json}` and every read misses: has()
 * was false each time, a fresh ProxyAgent was built on every request, and the
 * 20-entry cap never even evicted (size never reached it — the pooled entry
 * lingered while the caller was handed a new pool each call).
 *
 * THE EXIT (the plan's words): "Cache-hit test (agent built once per key)" — the
 * agent is CONSTRUCTED once per composite key, and two pools behind one URL with
 * different pooling knobs stay TWO entries (F9's cache identity).
 *
 * Two suites of instruments, deliberately separate:
 *   • mocked undici agents → COUNTS (fast, hermetic, exact);
 *   • the witness below     → the dispatcher actually REACHING the wrapper's
 *                             fetch with REAL undici (a fake cannot prove this).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const HOSTPORT = "203.0.113.7:8080";
const HTTP_PROXY = `http://${HOSTPORT}`;
const SOCKS_PROXY = "socks5://operator:hunter2-example@203.0.113.7:1080";
const TARGET = "https://api.openai.com/v1/chat/completions";

const POOL_32 = { connections: 32, keepAliveTimeout: 4000 };
const POOL_8 = { connections: 8, keepAliveTimeout: 4000 };

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("fetch", async () => new Response("UPSTREAM", { status: 200 }));
});
afterEach(() => {
  vi.resetModules();
  vi.doUnmock("undici");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Import proxyFetch with recording fake agents, to count constructions.
 *
 * Socks5ProxyAgent is POSITIONAL — proxyFetch.js:435 passes `pooling` as the
 * SECOND argument, not an options key. A fake declaring only `constructor(url)`
 * records the url and silently drops the knobs, so a pooling-blind socks row
 * would look identical to a pooling one. Both are recorded.
 *
 * close() is recorded too — the cap test asserts the OLDEST dispatcher is
 * CLOSED, not merely dropped from the map (v0.9.42's fd-leak shape).
 */
async function importWithRecordingAgents() {
  const calls = { socks5: [], proxy: [], closed: [] };
  // Capture the suite's fetch stub BEFORE importing proxyFetch (which patches globalThis).
  const suiteFetch = globalThis.fetch;
  vi.doMock("undici", () => ({
    Socks5ProxyAgent: class {
      constructor(url, opts) {
        calls.socks5.push({ url, opts });
        this.close = async () => { calls.closed.push(url); };
      }
    },
    ProxyAgent: class {
      constructor(opts) {
        calls.proxy.push(opts);
        this.close = async () => { calls.closed.push(opts?.uri); };
      }
    },
    Agent: class {},
    fetch: (...args) => suiteFetch(...args),
  }));
  const mod = await import("open-sse/utils/proxyFetch.js");
  return { mod, calls };
}

const proxied = (url, extra = {}) => ({
  connectionProxyEnabled: true,
  connectionProxyUrl: url,
  ...extra,
});

describe("P4 — read key == write key", () => {
  it("HTTP: the SAME url + pooling reuses ONE dispatcher (the miss)", { timeout: 20000 }, async () => {
    const { mod, calls } = await importWithRecordingAgents();

    for (let i = 0; i < 3; i++) {
      await mod.proxyAwareFetch(TARGET, {}, proxied(HTTP_PROXY, { pooling: POOL_32 }));
    }

    // Pre-mend this was 3 — a new pool per request.
    expect(calls.proxy.length).toBe(1);
    expect(calls.proxy[0]).toMatchObject({ uri: HTTP_PROXY, ...POOL_32 });
  });

  it("SOCKS5: the SAME url + pooling reuses ONE dispatcher (the miss)", { timeout: 20000 }, async () => {
    const { mod, calls } = await importWithRecordingAgents();

    for (let i = 0; i < 3; i++) {
      await mod.proxyAwareFetch(TARGET, {}, proxied(SOCKS_PROXY, { pooling: POOL_32 }));
    }

    expect(calls.socks5.length).toBe(1);
    expect(calls.socks5[0].url).toBe(SOCKS_PROXY);
    // The pooling knobs must arrive POSITIONALLY (proxyFetch.js:435). A fake
    // that declares only constructor(url) cannot see this, and a bare-token
    // test stays green even if pooling silently drops off the socks path.
    expect(calls.socks5[0].opts).toEqual(POOL_32);
  });

  it("F9 identity held: ONE url with TWO pooling sizes is TWO agents, each cached", { timeout: 20000 }, async () => {
    const { mod, calls } = await importWithRecordingAgents();

    for (let i = 0; i < 2; i++) {
      await mod.proxyAwareFetch(TARGET, {}, proxied(HTTP_PROXY, { pooling: POOL_32 }));
      await mod.proxyAwareFetch(TARGET, {}, proxied(HTTP_PROXY, { pooling: POOL_8 }));
    }

    expect(calls.proxy.length).toBe(2);
    expect(calls.proxy.map((o) => o.connections)).toEqual([32, 8]);
  });

  it("a pooling request does NOT share the no-pooling entry (key is composite, not normalized)", { timeout: 20000 }, async () => {
    const { mod, calls } = await importWithRecordingAgents();

    await mod.proxyAwareFetch(TARGET, {}, proxied(HTTP_PROXY));
    await mod.proxyAwareFetch(TARGET, {}, proxied(HTTP_PROXY, { pooling: POOL_32 }));
    await mod.proxyAwareFetch(TARGET, {}, proxied(HTTP_PROXY));
    await mod.proxyAwareFetch(TARGET, {}, proxied(HTTP_PROXY, { pooling: POOL_32 }));

    // Two distinct keys → one construction each; each read hits its own entry.
    expect(calls.proxy.length).toBe(2);
    expect(calls.proxy[0].connections).toBeUndefined();
    expect(calls.proxy[1].connections).toBe(32);
  });

  it("the 20-entry cap still EVICTS and CLOSES the oldest (behaviour preserved)", { timeout: 20000 }, async () => {
    const { mod, calls } = await importWithRecordingAgents();
    const max = (await import("open-sse/config/runtimeConfig.js")).MEMORY_CONFIG.proxyDispatchersMaxSize;
    expect(max).toBe(20);

    // Fill cap + 1 distinct composite keys (distinct pooling sizes).
    for (let n = 1; n <= max + 1; n++) {
      await mod.proxyAwareFetch(TARGET, {}, proxied(HTTP_PROXY, { pooling: { connections: n } }));
    }
    expect(calls.proxy.length).toBe(max + 1);

    // THE CLOSE, observed: the v0.9.42 eviction contract is that the evicted
    // dispatcher's pool is RELEASED, not merely dropped (a dangling entry leaks
    // fds for the process lifetime). The title claims CLOSES; this row now
    // asserts it — and a mutation that removed the close() call turned it red.
    expect(calls.closed).toContain(HTTP_PROXY);
    expect(calls.closed.length).toBeGreaterThanOrEqual(1);

    // The oldest key (connections:1) was evicted — asking again re-constructs.
    await mod.proxyAwareFetch(TARGET, {}, proxied(HTTP_PROXY, { pooling: { connections: 1 } }));
    expect(calls.proxy.length).toBe(max + 2);

    // …a key still inside the cap hits: no re-construct, no spurious close.
    const closedBeforeHit = calls.closed.length;
    await mod.proxyAwareFetch(TARGET, {}, proxied(HTTP_PROXY, { pooling: { connections: 5 } }));
    expect(calls.proxy.length).toBe(max + 2);
    expect(calls.closed.length).toBe(closedBeforeHit);
  });
});

describe("P4 — the RED-TO-GREEN witness (real undici, unique dead origin)", () => {
  // MEASURED, both directions, on the same instrument:
  //   pre-fix (read :447 `normalized`, pooling)  → `warned=false` : the wrapper's
  //       fetch went out with NO dispatcher — the configured proxy was silently
  //       IGNORED and the request went DIRECT.
  //   post-fix (read :447 `cacheKey`)            → `warned=true`  : the real
  //       dispatcher reached fetch, the dead proxy refused, the documented
  //       fail-open warn fired, and the request completed direct.
  // Two earlier shapes failed and are recorded in the plan: a shared origin
  // (undici keep-alive pools PER DISPOSER, yet a neighbouring test's dead agent
  // still swallowed this test's error in-suite — measured sameDefault=false,
  // i.e. two module records) and a refusing fetch stub (proxyFetch had already
  // captured its own record of the global). A FRESH never-contacted origin per
  // run sidesteps both.
  it("the pooling dispatcher reaches fetch (pre-fix it left as UNDEFINED → direct)", { timeout: 20000 }, async () => {
    const proxyOpts = [];
    // console.warn is the floor: the logger's own sink writes through it, and its
    // ESM namespace is frozen (vi.doMock re-evaluates it into a record whose
    // export identity differs — measured). Spy-with-delegation keeps the line
    // visible AND captured.
    const warns = [];
    const realWarn = console.warn;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation((...a) => {
      warns.push(a.map(String).join(" "));
      realWarn.apply(console, a);
    });
    const deadProxy = "http://127.0.0.1:1";

    // Capture what reaches the wrapper's fetch. The stub REFUSES when a
    // dispatcher is present, so the wrapper's fail-open path (catch → warn →
    // direct retry) is exercised deterministically — undici's own socket timing
    // is not relied on. Measured with this shape: dispatcherSeen defined,
    // status 200, warn captured.
    let dispatcherSeen;
    let proxyDispatcher; // the ProxyAgent instance this run built — the only one that refuses
    const refused = [];
    // Capture the suite's fetch stub BEFORE importing proxyFetch: the module body
    // reassigns globalThis.fetch to patchedFetch, and reading it at call time would
    // loop forever (patchedFetch → rawFetch → our mock → patchedFetch → …).
    const suiteFetch = globalThis.fetch;
    // The direct path ALSO builds a dispatcher now (getDirectDispatcher), so the
    // discriminator cannot be "is there a dispatcher?" — it must be "is this the
    // PROXY dispatcher?". Only the proxy try refuses; the direct retry (a different
    // Agent) passes through to the suite stub, which returns 200.
    vi.doMock("undici", async (orig) => {
      const real = await orig();
      class RecordingProxyAgent extends real.ProxyAgent {
        constructor(o) { super(o); proxyOpts.push(o); proxyDispatcher = this; }
      }
      return {
        Socks5ProxyAgent: real.Socks5ProxyAgent,
        ProxyAgent: RecordingProxyAgent,
        Agent: real.Agent,
        fetch: (url, init) => {
          if (init?.dispatcher === proxyDispatcher) {
            dispatcherSeen = init.dispatcher;
            refused.push("fetch");
            throw new TypeError("fetch failed"); // only the proxy try refuses
          }
          return suiteFetch(url, init); // direct retry → suite stub returns 200
        },
      };
    });

    const { proxyAwareFetch } = await import("open-sse/utils/proxyFetch.js");
    const res = await proxyAwareFetch(TARGET, {}, proxied(deadProxy, { pooling: POOL_32 }));
    warnSpy.mockRestore();
    // The witness imports a FRESH proxyFetch record (doMock + resetModules in
    // beforeEach), so the dispatcher map this run built dies with the record —
    // but doUnmock in afterEach must be preceded by a reset to drop the doMock
    // registration itself, or a later test file importing proxyFetch under a
    // stale doMock sees THIS record's dead-proxy state (the order-dependence
    // the P3 ledger flagged).
    vi.resetModules();
    vi.doUnmock("undici");

    // 1. The pooling knobs reached the constructor at all.
    expect(proxyOpts).toEqual([{ uri: deadProxy, ...POOL_32 }]);
    // 2. THE PROOF: a REAL dispatcher reached the seam. Pre-fix `get(normalized)`
    //    returned undefined and the fetch left with NO dispatcher — direct.
    expect(dispatcherSeen).toBeDefined();
    expect(refused).toEqual(["fetch"]); // the proxy try refused on the dispatcher seam
    // 3. The wrapper's documented fail-open warn fired…
    expect(warns.join("\n")).toContain("[ProxyFetch] Proxy failed");
    // 4. …and fail-open is intact: the request still completed directly.
    expect(res?.status).toBe(200);
  });
});

describe("P4 — source guard: the fix cannot be silently undone", () => {
  it("getDispatcher returns under cacheKey, never under bare normalized", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.join(process.cwd(), "open-sse/utils/proxyFetch.js"), "utf8");
    const body = src.slice(src.indexOf("async function getDispatcher"));
    const end = body.indexOf("\n}\n");
    const fn = body.slice(0, end);
    expect(fn).toContain("proxyDispatchers.set(cacheKey, Dispatcher);");
    expect(fn).toContain("return proxyDispatchers.get(cacheKey);");
    expect(fn).not.toContain("return proxyDispatchers.get(normalized);");
  });
});
