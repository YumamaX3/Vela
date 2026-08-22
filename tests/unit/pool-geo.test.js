/**
 * Pool Geo Test Suite — v0.9.18
 *
 * Proves the shared egress-geo registry and the background probe's failure
 * handling:
 *
 *   G1. set/get round-trip with TTL expiry
 *   G2. ipHistory + flapping detection (isUnstable at >=2 distinct IPs)
 *   G3. pruneStaleGeo removes expired entries only
 *   G4. probe failure classification maps to backoff families
 *   G5. probePool succeeds through the proxy-aware fetch (mock)
 *   G6. probePool failure does not throw — returns { error }
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setPoolGeo, getPoolGeo, poolGeoSnapshot, pruneStaleGeo, resetPoolGeo, POOL_GEO_IP_HISTORY_MAX, __test__ as poolGeoTest } from "../../src/lib/network/poolGeo.js";

const proxyAwareFetch = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch,
}));

import * as poolEgressProbe from "../../src/lib/network/poolEgressProbe.js";

beforeEach(() => {
  resetPoolGeo();
  proxyAwareFetch.mockReset();
});

describe("G1: set/get round-trip with TTL", () => {
  it("stores and returns a geo entry", () => {
    setPoolGeo("pool-1", { ip: "1.2.3.4", country: "US" });
    const geo = getPoolGeo("pool-1");
    expect(geo.ip).toBe("1.2.3.4");
    expect(geo.country).toBe("US");
    expect(geo.ts).toBeTypeOf("number");
  });

  it("ignores entries without an IP (fail-open)", () => {
    setPoolGeo("pool-1", { country: "US" });
    expect(getPoolGeo("pool-1")).toBeNull();
  });

  it("returns null for unknown pools", () => {
    expect(getPoolGeo("nope")).toBeNull();
  });
});

describe("G2: ipHistory + flapping detection", () => {
  it("is stable with a single egress IP", () => {
    setPoolGeo("pool-1", { ip: "1.2.3.4", country: "US" });
    expect(getPoolGeo("pool-1").isUnstable).toBe(false);
    expect(getPoolGeo("pool-1").ipCount).toBe(1);
  });

  it("flags flapping after a second distinct egress IP", () => {
    setPoolGeo("pool-1", { ip: "1.2.3.4", country: "US" });
    setPoolGeo("pool-1", { ip: "5.6.7.8", country: "US" });
    const geo = getPoolGeo("pool-1");
    expect(geo.isUnstable).toBe(true);
    expect(geo.ipCount).toBe(2);
    expect(geo.ipHistory).toHaveLength(1);
    expect(geo.ipHistory[0].ip).toBe("1.2.3.4");
  });

  it("bounds ipHistory to the max", () => {
    for (let i = 0; i < POOL_GEO_IP_HISTORY_MAX + 4; i++) {
      setPoolGeo("pool-1", { ip: `10.0.0.${i}`, country: "US" });
    }
    const geo = getPoolGeo("pool-1");
    expect(geo.ipHistory.length).toBeLessThanOrEqual(POOL_GEO_IP_HISTORY_MAX);
    expect(geo.ipCount).toBeGreaterThanOrEqual(2);
  });

  it("re-observing the same IP does not count as flapping", () => {
    setPoolGeo("pool-1", { ip: "1.2.3.4", country: "US" });
    setPoolGeo("pool-1", { ip: "1.2.3.4", country: "US" });
    const geo = getPoolGeo("pool-1");
    expect(geo.isUnstable).toBe(false);
    expect(geo.ipCount).toBe(1);
  });
});

describe("G3: pruneStaleGeo", () => {
  it("removes only expired entries", () => {
    setPoolGeo("fresh", { ip: "1.2.3.4" });
    setPoolGeo("keep", { ip: "2.2.2.2" });
    // Backdate only "fresh" via the exported test seam.
    poolGeoTest.geoCache.get("fresh").ts = Date.now() - 2 * 60 * 60 * 1000; // 2h old — expired

    expect(pruneStaleGeo()).toBe(1);
    expect(getPoolGeo("fresh")).toBeNull();
    expect(getPoolGeo("keep")).not.toBeNull();
  });

  it("returns 0 when nothing is expired", () => {
    setPoolGeo("a", { ip: "1.1.1.1" });
    setPoolGeo("b", { ip: "2.2.2.2" });
    expect(pruneStaleGeo()).toBe(0);
  });
});

describe("G4: probe failure classification", () => {
  it("maps 429/rate messages to rate-limit family", () => {
    expect(poolEgressProbe.__test__.classifyFailure({ message: "HTTP 429 rate limited" })).toBe("rate-limit");
  });

  it("maps timeouts/aborts to timeout family", () => {
    expect(poolEgressProbe.__test__.classifyFailure({ message: "geo probe timeout" })).toBe("timeout");
    expect(poolEgressProbe.__test__.classifyFailure({ name: "AbortError" })).toBe("timeout");
  });

  it("maps network errors to network family", () => {
    expect(poolEgressProbe.__test__.classifyFailure({ message: "ECONNREFUSED" })).toBe("network");
    expect(poolEgressProbe.__test__.classifyFailure({ message: "ENOTFOUND host" })).toBe("network");
  });

  it("defaults to server family", () => {
    expect(poolEgressProbe.__test__.classifyFailure({ message: "something else" })).toBe("server");
  });

  it("backoff map covers every family", () => {
    const { BACKOFF } = poolEgressProbe.__test__;
    for (const family of ["rate-limit", "server", "network", "timeout", "no-ip"]) {
      expect(BACKOFF[family]).toBeTypeOf("number");
    }
  });
});

describe("G5/G6: probePool via mocked proxy fetch", () => {
  it("returns parsed geo on a successful probe", async () => {
    proxyAwareFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ip: "9.9.9.9", country: "SG" }),
    });

    const result = await poolEgressProbe.__test__.probePool({ proxyUrl: "http://relay:8080" });
    expect(result.ip).toBe("9.9.9.9");
    expect(result.country).toBe("SG");
    expect(result.error).toBeUndefined();
    // First chain source (ipwho.is) must be what answered.
    expect(proxyAwareFetch).toHaveBeenCalledWith(
      "https://ipwho.is/",
      expect.anything(),
      expect.objectContaining({ enabled: true, url: "http://relay:8080" })
    );
  });

  it("returns an error family instead of throwing on network failure", async () => {
    proxyAwareFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await poolEgressProbe.__test__.probePool({ proxyUrl: "http://relay:8080" });
    expect(result.error).toBe("network");
  });

  it("walks the chain when a source returns 4xx", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce({ ok: false, status: 403, text: async () => "forbidden" })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ query: "7.7.7.7", country: "DE", regionName: "Berlin", city: "Berlin" }),
      });

    const result = await poolEgressProbe.__test__.probePool({ proxyUrl: "http://relay:8080" });
    expect(result.ip).toBe("7.7.7.7");
    expect(result.country).toBe("DE");
    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
  });
});
