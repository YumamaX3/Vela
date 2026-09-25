// Network cockpit — the Network lens's engine and reader proof.
//
// The lens is a cockpit over engines that already ran: the Doctor measures
// phases, the readers open live state, the timeout policy is live-settable, and
// two long-broken console buttons were mended. This suite pins the LOGIC —
// verdicts, floors, the mended paths — without needing a live network, because
// every probe takes an injectable seam.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── The Doctor's pure verdict logic ─────────────────────────────────────────
describe("Network Doctor — phase verdicts", () => {
  it("certVerdict names the operator's thresholds exactly", async () => {
    const { certVerdict } = await import("@/lib/network/networkDoctor.js");
    expect(certVerdict(-1)).toBe("expired");
    expect(certVerdict(0)).toBe("critical");
    expect(certVerdict(7)).toBe("critical");
    expect(certVerdict(8)).toBe("warning");
    expect(certVerdict(30)).toBe("warning");
    expect(certVerdict(31)).toBe("ok");
    expect(certVerdict(null)).toBe("unknown");
  });

  it("refuses an SSRF target WITHOUT dialling it", async () => {
    const { diagnoseEndpoint } = await import("@/lib/network/networkDoctor.js");
    const loopback = await diagnoseEndpoint("http://127.0.0.1:32060/x");
    expect(loopback.verdict).toBe("refused");
    expect(loopback.refused).toBe(true);
    expect(loopback.dns).toBeNull(); // never resolved — the gate stopped it first
    const metadata = await diagnoseEndpoint("http://169.254.169.254/latest/meta-data");
    expect(metadata.verdict).toBe("refused");
    const badScheme = await diagnoseEndpoint("file:///etc/passwd");
    expect(badScheme.verdict).toBe("refused");
  });

  it("names the FIRST phase that broke (dns → tcp → tls → http)", async () => {
    const mod = await import("@/lib/network/networkDoctor.js");
    // DNS fails → verdict 'dns', and no later phase is even attempted.
    const dnsFail = await mod.diagnoseEndpoint("https://example.com", {
      dnsImpl: { lookup: async () => { throw Object.assign(new Error("nope"), { code: "ENOTFOUND" }); } },
    });
    expect(dnsFail.verdict).toBe("dns");
    expect(dnsFail.tcp).toBeNull();
    expect(dnsFail.tls).toBeNull();
    expect(dnsFail.http).toBeNull();
  });

  it("a resolving host whose TCP refuses reports verdict 'tcp'", async () => {
    const mod = await import("@/lib/network/networkDoctor.js");
    const result = await mod.diagnoseEndpoint("https://example.com", {
      dnsImpl: { lookup: async () => [{ address: "203.0.113.9", family: 4 }] },
      netImpl: { Socket: class { setTimeout() {} once(ev, cb) { if (ev === "error") setTimeout(() => cb(Object.assign(new Error("refused"), { code: "ECONNREFUSED" })), 0); } connect() {} destroy() {} } },
    });
    expect(result.verdict).toBe("tcp");
    expect(result.dns.ok).toBe(true);
    expect(result.tls).toBeNull();
  });

  it("a full happy path reports 'ok' with every phase measured", async () => {
    const mod = await import("@/lib/network/networkDoctor.js");
    const fakeSocket = class {
      setTimeout() {}
      once(ev, cb) { if (ev === "connect") setTimeout(() => cb(), 0); }
      connect() {}
      destroy() {}
    };
    const fakeTlsSocket = {
      setTimeout() {},
      once(ev, cb) {
        if (ev === "secureConnect") setTimeout(() => cb(), 0);
      },
      getPeerCertificate() {
        return { valid_to: new Date(Date.now() + 90 * 86_400_000).toISOString(), subject: { CN: "example.com" }, issuer: { O: "Test CA" } };
      },
      authorized: true,
      getProtocol: () => "TLSv1.3",
      destroy() {},
    };
    const result = await mod.diagnoseEndpoint("https://example.com", {
      dnsImpl: { lookup: async () => [{ address: "203.0.113.9", family: 4 }] },
      netImpl: { Socket: fakeSocket },
      tlsImpl: { connect: () => fakeTlsSocket },
      fetchImpl: async () => ({ status: 200, ok: true }),
    });
    expect(result.verdict).toBe("ok");
    expect(result.dns.ok).toBe(true);
    expect(result.tcp.ok).toBe(true);
    expect(result.tls.ok).toBe(true);
    expect(result.http.status).toBe(200);
    expect(result.cert).toBe("ok");
    expect(result.tls.daysRemaining).toBeGreaterThan(80);
  });

  it("an expired certificate is named by the cert verdict, not silently 'ok'", async () => {
    const mod = await import("@/lib/network/networkDoctor.js");
    const fakeSocket = class { setTimeout() {} once(ev, cb) { if (ev === "connect") setTimeout(() => cb(), 0); } connect() {} destroy() {} };
    const fakeTlsSocket = {
      setTimeout() {},
      once(ev, cb) { if (ev === "secureConnect") setTimeout(() => cb(), 0); },
      getPeerCertificate() { return { valid_to: new Date(Date.now() - 86_400_000).toISOString() }; },
      authorized: false,
      getProtocol: () => "TLSv1.2",
      destroy() {},
    };
    const result = await mod.diagnoseEndpoint("https://example.com", {
      dnsImpl: { lookup: async () => [{ address: "203.0.113.9", family: 4 }] },
      netImpl: { Socket: fakeSocket },
      tlsImpl: { connect: () => fakeTlsSocket },
      fetchImpl: async () => ({ status: 200, ok: true }),
    });
    expect(result.cert).toBe("expired");
    expect(result.verdict).toBe("ok"); // the path still answers; the CERT is what warns
  });
});

// ── The timeout policy ──────────────────────────────────────────────────────
describe("Network timeout policy — live bindings", () => {
  afterEach(async () => {
    const rt = await import("open-sse/config/runtimeConfig.js");
    rt.applyNetworkTimeoutOverrides({}); // restore the floor
  });

  it("a stored override changes the live binding; blank restores the floor", async () => {
    const rt = await import("open-sse/config/runtimeConfig.js");
    const floor = rt.NETWORK_TIMEOUT_DEFAULTS;
    expect(rt.STREAM_STALL_TIMEOUT_MS).toBe(floor.streamStallTimeoutMs);

    rt.applyNetworkTimeoutOverrides({ streamStallTimeoutMs: 12345 });
    expect(rt.STREAM_STALL_TIMEOUT_MS).toBe(12345);
    expect(rt.STREAM_FIRST_CHUNK_TIMEOUT_MS).toBe(floor.streamFirstChunkTimeoutMs);

    rt.applyNetworkTimeoutOverrides({ streamStallTimeoutMs: null });
    expect(rt.STREAM_STALL_TIMEOUT_MS).toBe(floor.streamStallTimeoutMs);
  });

  it("rejects junk values to the floor rather than a NaN timeout", async () => {
    const rt = await import("open-sse/config/runtimeConfig.js");
    const floor = rt.NETWORK_TIMEOUT_DEFAULTS;
    rt.applyNetworkTimeoutOverrides({ streamStallTimeoutMs: -5, fetchConnectTimeoutMs: "abc" });
    expect(rt.STREAM_STALL_TIMEOUT_MS).toBe(floor.streamStallTimeoutMs);
    expect(rt.FETCH_CONNECT_TIMEOUT_MS).toBe(floor.fetchConnectTimeoutMs);
  });
});

// ── The readers ─────────────────────────────────────────────────────────────
describe("Network status readers — fail-open, honest shapes", () => {
  it("the egress report honors poolGeoSnapshot's object-keyed shape", async () => {
    const poolGeo = await import("@/lib/network/poolGeo.js");
    poolGeo.resetPoolGeo();
    poolGeo.setPoolGeo("pool-1", { ip: "203.0.113.7", country: "NL", city: "Amsterdam", org: "Test" });
    const { getEgressReport } = await import("@/lib/network/networkStatus.js");
    const report = await getEgressReport();
    expect(report.ok).toBe(true);
    expect(report.observedCount).toBe(1);
    expect(report.entries[0].poolId).toBe("pool-1");
    expect(report.entries[0].ip).toBe("203.0.113.7");
    poolGeo.resetPoolGeo();
  });

  it("flapping is flagged when a pool shows ≥2 distinct egress IPs", async () => {
    const poolGeo = await import("@/lib/network/poolGeo.js");
    poolGeo.resetPoolGeo();
    poolGeo.setPoolGeo("pool-2", { ip: "203.0.113.1" });
    poolGeo.setPoolGeo("pool-2", { ip: "203.0.113.2" });
    const { getEgressReport } = await import("@/lib/network/networkStatus.js");
    const report = await getEgressReport();
    expect(report.flappingCount).toBe(1);
    expect(report.entries[0].isUnstable).toBe(true);
    poolGeo.resetPoolGeo();
  });

  it("the rate snapshot reads the live window Map and the key's own cap", async () => {
    const now = Date.now();
    global._velaRateWindows = new Map([["key-a", [now - 1000, now - 500]]]);
    // networkStatus.js was already imported by an earlier case, so its binding to
    // the real @/lib/localDb is cached — reset the registry so the mock binds.
    vi.resetModules();
    vi.doMock("@/lib/localDb", () => ({
      getApiKeys: async () => [
        { id: "1", keyId: "key-a", name: "Limited", rateLimitRpm: 5, ipAllowlist: ["10.0.0.0/8"] },
        { id: "2", keyId: "key-b", name: "Unlimited", rateLimitRpm: null, ipAllowlist: [] },
      ],
      getProxyPools: async () => [],
      getSettings: async () => ({}),
    }));
    try {
      const { getRateLimitSnapshot } = await import("@/lib/network/networkStatus.js");
      const snap = await getRateLimitSnapshot({ now });
      expect(snap.ok).toBe(true);
      expect(snap.limited).toBe(1);
      const limited = snap.keys.find((k) => k.name === "Limited");
      expect(limited.used).toBe(2);
      expect(limited.remaining).toBe(3);
      expect(limited.ipRestricted).toBe(true);
      const unlimited = snap.keys.find((k) => k.name === "Unlimited");
      expect(unlimited.cap).toBeNull();
      expect(unlimited.remaining).toBeNull();
    } finally {
      vi.doUnmock("@/lib/localDb");
      vi.resetModules();
      delete global._velaRateWindows;
    }
  });

  it("the timeout policy reader reports live, floor, and stored together", async () => {
    const { getTimeoutPolicy } = await import("@/lib/network/networkStatus.js");
    const policy = await getTimeoutPolicy();
    expect(policy.ok).toBe(true);
    expect(policy.live.streamStallTimeoutMs).toBeGreaterThan(0);
    expect(policy.floor.streamStallTimeoutMs).toBeGreaterThan(0);
    expect(policy).toHaveProperty("stored");
  });
});

// ── The mended console seams ────────────────────────────────────────────────
describe("Proxy console — the two mended paths", () => {
  it("resetFitness posts to the route that exists (/fitness, not /fitness/reset)", async () => {
    const calls = [];
    global.fetch = vi.fn(async (url, opts) => { calls.push({ url, method: opts?.method }); return { ok: true, status: 200, json: async () => ({ success: true }) }; });
    const { resetFitness } = await import("@/app/(dashboard)/dashboard/proxy/lib/proxyApi.js");
    await resetFitness("pool-1", "openai");
    expect(calls[0].url).toBe("/api/proxy-pools/fitness");
    expect(calls[0].method).toBe("POST");
  });

  it("probePoolEgress posts to the pool-scoped route that now exists", async () => {
    const calls = [];
    global.fetch = vi.fn(async (url, opts) => { calls.push({ url, method: opts?.method }); return { ok: true, status: 200, json: async () => ({ ok: true }) }; });
    const { probePoolEgress } = await import("@/app/(dashboard)/dashboard/proxy/lib/proxyApi.js");
    await probePoolEgress("pool-9");
    expect(calls[0].url).toBe("/api/proxy-pools/pool-9/probe");
  });
});
