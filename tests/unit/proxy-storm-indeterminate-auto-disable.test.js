/**
 * STORM 1 — Indeterminate Auto-Disable (v0.9.42 Wave 0)
 *
 * The incident this storm is named after: the 5-minute health scheduler called
 * a symbol that was never imported, the ReferenceError fell into a catch that
 * returned `{ ok: false }`, and the sweep read that as "dead" — disabling EVERY
 * pool, then replicating the damage to the live MariaDB twin. One missing import
 * emptied the fleet, and it self-masked after a single pass.
 *
 * The law under test: a pool may only be deactivated on a DETERMINISTIC verdict.
 * A timeout, a 5xx, a rate-limited probe target, or any throw is INDETERMINATE —
 * the probe's own path may have faltered, and that is not the pool's fault.
 *
 * Everything here is the real chain: real `undici` seam → real testProxyUrl /
 * testRelayUrl → real classifyProbeVerdict → real testPoolReachability → real
 * checkPoolHealth → real checkAllPools → real disablePool. Only the network and
 * the DB are mocked. No `__test__` surface is touched.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const undici = vi.hoisted(() => ({
  fetch: vi.fn(),
  // Real constructors would open sockets; these stand in so the module's
  // availability checks pass and dispatcher.close() is a no-op.
  ProxyAgent: class { constructor(opts) { this.opts = opts; } async close() {} },
  Socks5ProxyAgent: class { constructor(opts) { this.opts = opts; } async close() {} },
}));

const repoMocks = vi.hoisted(() => ({
  getProxyPools: vi.fn(),
  getProxyPoolById: vi.fn(),
  updateProxyPool: vi.fn(),
  deleteProxyPool: vi.fn(),
}));

vi.mock("undici", () => undici);
vi.mock("../../src/lib/db/repos/proxyPoolsRepo.js", () => repoMocks);
// probeEgress's transport — mocked so no storm reaches the real network.
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));
// connectionProxy pulls @/models → the DB driver at import time.
vi.mock("@/models", () => ({ getProxyPoolById: repoMocks.getProxyPoolById }));

const { checkAllPools, checkPoolHealth } = await import("../../src/lib/network/proxyFleet.js");

/** Build an active pool row shaped like the repo returns it. */
const pool = (id, type = "http", proxyUrl = "http://192.168.1.20:8080") => ({
  id, type, proxyUrl, isActive: true, name: id,
});

beforeEach(() => {
  vi.clearAllMocks();
  undici.fetch.mockReset();
  repoMocks.updateProxyPool.mockResolvedValue({});
});

describe("S1.1: a probe-path outage can no longer empty the fleet", () => {
  it("leaves EVERY pool active when the probe target itself is unreachable", async () => {
    repoMocks.getProxyPools.mockResolvedValue([pool("a"), pool("b"), pool("c")]);
    // The probe's own path dies — this is what the incident mistook for death.
    undici.fetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await checkAllPools({ autoDisable: true });

    expect(result.total).toBe(3);
    expect(result.indeterminate).toBe(3);
    expect(result.dead).toBe(0);
    expect(result.alive).toBe(0);
    // The load-bearing assertion: nothing was deactivated.
    expect(repoMocks.updateProxyPool).not.toHaveBeenCalled();
  });

  it("leaves a pool active on a timeout", async () => {
    repoMocks.getProxyPools.mockResolvedValue([pool("slow")]);
    const abort = new Error("This operation was aborted");
    abort.name = "AbortError";
    undici.fetch.mockRejectedValue(abort);

    const result = await checkAllPools({ autoDisable: true });

    expect(result.indeterminate).toBe(1);
    expect(repoMocks.updateProxyPool).not.toHaveBeenCalled();
  });

  it("leaves a pool active on a 5xx from the probe target", async () => {
    repoMocks.getProxyPools.mockResolvedValue([pool("flaky")]);
    undici.fetch.mockResolvedValue({ ok: false, status: 503, statusText: "Service Unavailable" });

    const result = await checkAllPools({ autoDisable: true });

    expect(result.indeterminate).toBe(1);
    expect(repoMocks.updateProxyPool).not.toHaveBeenCalled();
  });

  it("leaves a pool active on a 429 from the probe target", async () => {
    repoMocks.getProxyPools.mockResolvedValue([pool("ratelimited")]);
    undici.fetch.mockResolvedValue({ ok: false, status: 429, statusText: "Too Many Requests" });

    const result = await checkAllPools({ autoDisable: true });

    expect(result.indeterminate).toBe(1);
    expect(repoMocks.updateProxyPool).not.toHaveBeenCalled();
  });
});

describe("S1.2: a deterministic verdict DOES deactivate", () => {
  it("disables a pool whose config is provably bad (400)", async () => {
    repoMocks.getProxyPools.mockResolvedValue([pool("bad-config")]);
    undici.fetch.mockResolvedValue({ ok: false, status: 400, statusText: "Bad Request" });

    const result = await checkAllPools({ autoDisable: true });

    expect(result.dead).toBe(1);
    expect(repoMocks.updateProxyPool).toHaveBeenCalledWith("bad-config", { isActive: false });
  });

  it("disables a relay that is gone (404)", async () => {
    repoMocks.getProxyPools.mockResolvedValue([
      pool("gone-relay", "vercel", "https://relay.example.workers.dev"),
    ]);
    undici.fetch.mockResolvedValue({ ok: false, status: 404, statusText: "Not Found" });

    const result = await checkAllPools({ autoDisable: true });

    expect(result.dead).toBe(1);
    expect(repoMocks.updateProxyPool).toHaveBeenCalledWith("gone-relay", { isActive: false });
  });

  it("disables a pool with no proxyUrl at all (dead by construction)", async () => {
    repoMocks.getProxyPools.mockResolvedValue([{ ...pool("empty"), proxyUrl: "" }]);

    const result = await checkAllPools({ autoDisable: true });

    expect(result.dead).toBe(1);
    expect(repoMocks.updateProxyPool).toHaveBeenCalledWith("empty", { isActive: false });
    // No network was needed to know this one.
    expect(undici.fetch).not.toHaveBeenCalled();
  });

  it("counts an alive pool without touching isActive", async () => {
    repoMocks.getProxyPools.mockResolvedValue([pool("healthy")]);
    undici.fetch.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });

    const result = await checkAllPools({ autoDisable: true });

    expect(result.alive).toBe(1);
    expect(result.dead).toBe(0);
    expect(repoMocks.updateProxyPool).not.toHaveBeenCalled();
  });
});

describe("S1.3: the sweep is mixed-verdict honest", () => {
  it("reports all three states from one pass and disables only the dead one", async () => {
    repoMocks.getProxyPools.mockResolvedValue([
      pool("alive-one"),
      pool("dead-one"),
      pool("unsure-one"),
    ]);
    undici.fetch
      .mockResolvedValueOnce({ ok: true, status: 200, statusText: "OK" })          // alive-one
      .mockResolvedValueOnce({ ok: false, status: 400, statusText: "Bad Request" }) // dead-one
      .mockRejectedValueOnce(new Error("ETIMEDOUT"));                              // unsure-one

    const result = await checkAllPools({ autoDisable: true });

    // ⚠️ WIDENED DELIBERATELY at v0.9.44 (milestone 0.6, LIVE-B) — not broken by
    // accident. `checkAllPools` now also returns the per-pool `results` array it
    // had always built internally, so `bulk-health/route.js` can delegate to it
    // instead of keeping its own drifted copy of this loop. The three counts are
    // unchanged and still asserted strictly; the new key is asserted too, so
    // this stays a whole-shape assertion rather than silently loosening into
    // `objectContaining`.
    //
    // `results` is matched unordered on purpose: with 3 pools the dynamic
    // concurrency is min(16, max(4, ceil(3/50))) = 4, so all three run in ONE
    // `Promise.all` batch and their `results.push()` order is nondeterministic.
    expect(result).toEqual({
      total: 3,
      alive: 1,
      dead: 1,
      indeterminate: 1,
      results: expect.arrayContaining([
        expect.objectContaining({ poolId: "alive-one", verdict: "alive" }),
        expect.objectContaining({ poolId: "dead-one", verdict: "dead" }),
        expect.objectContaining({ poolId: "unsure-one", verdict: "indeterminate" }),
      ]),
    });
    expect(result.results).toHaveLength(3);
    expect(repoMocks.updateProxyPool).toHaveBeenCalledTimes(1);
    expect(repoMocks.updateProxyPool).toHaveBeenCalledWith("dead-one", { isActive: false });
  });

  it("does NOT disable anything when autoDisable is off", async () => {
    repoMocks.getProxyPools.mockResolvedValue([pool("dead-one")]);
    undici.fetch.mockResolvedValue({ ok: false, status: 410, statusText: "Gone" });

    const result = await checkAllPools({ autoDisable: false });

    expect(result.dead).toBe(1);
    expect(repoMocks.updateProxyPool).not.toHaveBeenCalled();
  });
});

describe("S1.4: checkPoolHealth — the seam the sweep lost", () => {
  it("returns a verdict string, never a bare ok:false", async () => {
    undici.fetch.mockRejectedValue(new Error("ECONNRESET"));
    const result = await checkPoolHealth("p1", pool("p1"));
    expect(result.verdict).toBe("indeterminate");
    expect(result.ok).toBe(false);
  });

  it("accepts a pre-fetched row without re-querying the DB (the N+1 fix)", async () => {
    undici.fetch.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });
    const row = pool("p2");

    const result = await checkPoolHealth("p2", row);

    expect(result.verdict).toBe("alive");
    expect(repoMocks.getProxyPoolById).not.toHaveBeenCalled();
  });

  it("returns dead — not a throw — for an unknown pool id", async () => {
    repoMocks.getProxyPoolById.mockResolvedValue(null);
    const result = await checkPoolHealth("missing");
    expect(result.verdict).toBe("dead");
    expect(result.error).toBe("pool not found");
  });

  it("classifies a throw as indeterminate rather than dead", async () => {
    repoMocks.getProxyPoolById.mockRejectedValue(new Error("db exploded"));
    const result = await checkPoolHealth("p3");
    expect(result.verdict).toBe("indeterminate");
    expect(result.error).toContain("db exploded");
  });
});

describe("S1.5: relays are probed through their envelope, never CONNECTed through", () => {
  it.each(["vercel", "cloudflare", "deno"])(
    "a %s pool sends the relay headers, not a proxy dispatcher",
    async (type) => {
      repoMocks.getProxyPools.mockResolvedValue([pool(`relay-${type}`, type, "https://relay.example.workers.dev")]);
      undici.fetch.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });

      await checkAllPools({ autoDisable: true });

      const [url, init] = undici.fetch.mock.calls[0];
      expect(url).toBe("https://relay.example.workers.dev");
      expect(init.method).toBe("GET");
      expect(init.headers["x-relay-target"]).toBeTruthy();
      expect(init.headers["x-relay-path"]).toBeTruthy();
      // A relay must NOT be handed a dispatcher — that would CONNECT through it.
      expect(init.dispatcher).toBeUndefined();
    }
  );

  it("a socks5 pool takes the SOCKS5 agent branch", async () => {
    repoMocks.getProxyPools.mockResolvedValue([
      pool("socks", "socks5", "socks5://192.168.1.20:1080"),
    ]);
    undici.fetch.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });

    const result = await checkAllPools({ autoDisable: true });

    expect(result.alive).toBe(1);
    const [, init] = undici.fetch.mock.calls[0];
    expect(init.dispatcher).toBeInstanceOf(undici.Socks5ProxyAgent);
  });
});
