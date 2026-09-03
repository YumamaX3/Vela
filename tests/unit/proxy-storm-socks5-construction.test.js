/**
 * PROXY STORM — SOCKS5 CONSTRUCTION CONTRACT (milestone 0.6, LIVE-A)
 *
 * ⚠️ THIS SUITE DELIBERATELY DOES NOT `vi.mock("undici")`.
 *
 * That is the whole design. The v0.9.42 storms mocked undici wholesale with a
 * permissive stand-in:
 *
 *     Socks5ProxyAgent: class { constructor(opts) { this.opts = opts; } }
 *
 * and then asserted `toBeInstanceOf(undici.Socks5ProxyAgent)` — the mock's OWN
 * class. A mock whose constructor accepts any argument cannot fail that
 * assertion, so it is self-fulfilling: the same tautology class as the deleted
 * `proxy-fleet-covenant.test.js` (`expect(30000).toBe(30000)`), wearing a
 * disguise because it names a real production symbol and inspects a real return
 * value.
 *
 * The consequence was that EVERY socks5:// pool was broken in production while
 * the suite stayed green. Both construction sites passed `{ uri: normalized }`
 * where undici's `Socks5ProxyAgent` signature is `(proxyUrl, options = {})`, so
 * the object reached `typeof proxyUrl === 'string' ? new URL(proxyUrl) :
 * proxyUrl` with `url.protocol === undefined` and threw InvalidArgumentError at
 * CONSTRUCTION — before any socket opened. Two live harms:
 *
 *   1. `proxyFetch.js` caught the throw and, unless `strictProxy === true`, fell
 *      back to DIRECT — a SILENT EGRESS BYPASS of the operator's own proxy.
 *   2. `proxyTest.js` converted the throw to `{ ok:false, status:400 }`, and 400
 *      IS in DETERMINISTIC_FAILURE_STATUSES, so `classifyProbeVerdict` returned
 *      "dead" and the health sweep disabled every socks5 pool. This is a
 *      per-scheme self-liquidation that Wave 0's indeterminate≠dead law could
 *      NOT catch, because the status looked deterministic.
 *
 * So these tests exercise the REAL undici against a closed local port — hermetic
 * (no external network, ~100-500ms), and discriminating (each assertion has a
 * different value before vs after the fix).
 *
 * Provenance: plans/vela-proxy-fleet-rebirth.md §15.1 (LIVE-A). The shapes below
 * were measured empirically against the installed undici 7.29.0 before the test
 * was written, not inferred.
 */
import { describe, expect, it, vi } from "vitest";

// REAL undici — no vi.mock anywhere in this file. If a future edit adds one,
// this suite stops proving anything and becomes the tautology it was written to
// replace.
import { Socks5ProxyAgent, ProxyAgent } from "undici";

import { testProxyUrl, classifyProbeVerdict } from "@/lib/network/proxyTest.js";
// open-sse is NOT under the `@/` alias (`@/` → ../src, and src/open-sse does not
// exist). The repo convention — used by 11 existing suites — is the relative
// specifier. Matching it also avoids forking a second module record for
// proxyFetch's module-level `proxyDispatchers` cache (§15.6's restated
// dual-instance law: identity is per-specifier-string).
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";

// A closed local port: connect attempts refuse immediately, no egress, no DNS.
const DEAD_SOCKS5 = "socks5://127.0.0.1:1";
// A host that cannot resolve/be reached — the fetch target, never the proxy.
const UNREACHABLE_TARGET = "https://example.invalid/probe";

describe("S1 — the undici constructor contract itself (the root cause)", () => {
  it("S1.1 REJECTS the `{ uri }` object shape — the shape production used", () => {
    // This is the assertion the mocked storms could never make: the real
    // constructor throws on the exact argument production passed.
    let threw = null;
    try {
      new Socks5ProxyAgent({ uri: DEAD_SOCKS5 });
    } catch (e) {
      threw = e;
    }
    expect(threw).not.toBeNull();
    expect(threw.constructor.name).toBe("InvalidArgumentError");
    expect(threw.message).toMatch(/must use socks5:\/\/ or socks:\/\/ protocol/);
  });

  it("S1.2 ACCEPTS the positional URL shape — what the fix ships", () => {
    let agent = null;
    expect(() => {
      agent = new Socks5ProxyAgent(DEAD_SOCKS5);
    }).not.toThrow();
    expect(agent).toBeInstanceOf(Socks5ProxyAgent);
  });

  it("S1.3 the POSITIONAL form is not a ProxyAgent convention — the sibling branch legitimately takes { uri }", () => {
    // This is WHY the bug looked plausible: `new ProxyAgent({ uri })` in the
    // HTTP branch immediately below is CORRECT. A future reader "tidying up" the
    // two branches to match would reintroduce LIVE-A, so the asymmetry is
    // asserted rather than left as a comment.
    let proxyAgentErr = null;
    try {
      const a = new ProxyAgent({ uri: "http://127.0.0.1:1" });
      expect(a).toBeInstanceOf(ProxyAgent);
    } catch (e) {
      proxyAgentErr = e;
    }
    expect(proxyAgentErr).toBeNull();

    // ...and Socks5ProxyAgent rejects that same object shape (S1.1 above).
    // Two dispatchers, two different constructor conventions. Measured, not assumed.
  });

  it("S1.4 accepts socks:// as well as socks5://, and rejects a non-socks scheme", () => {
    expect(() => new Socks5ProxyAgent("socks://127.0.0.1:1")).not.toThrow();

    let threw = null;
    try {
      new Socks5ProxyAgent("http://127.0.0.1:1");
    } catch (e) {
      threw = e;
    }
    expect(threw).not.toBeNull();
    expect(threw.message).toMatch(/must use socks5:\/\/ or socks:\/\/ protocol/);
  });
});

describe("S2 — proxyTest: the self-liquidation path is closed", () => {
  it("S2.1 a socks5 probe no longer reports status 400 (the bug's construction throw)", { timeout: 20000 }, async () => {
    const result = await testProxyUrl({
      proxyUrl: DEAD_SOCKS5,
      testUrl: UNREACHABLE_TARGET,
      timeoutMs: 5000,
    });

    // Pre-fix this was EXACTLY { ok:false, status:400, error:"Invalid proxy URL:
    // Proxy URL must use socks5:// or socks:// protocol" }. The 400 is what made
    // it look deterministic.
    expect(result.ok).toBe(false);
    expect(result.status).not.toBe(400);
    // Post-fix the failure is a genuine connection refusal at the network layer,
    // surfaced as 500 (measured) — and the message is the fetch failure, not a
    // proxy-URL protocol complaint.
    expect(String(result.error || "")).not.toMatch(/must use socks5:\/\/ or socks:\/\/ protocol/);
    expect(String(result.error || "")).toMatch(/ECONNREFUSED|fetch failed|ENOTFOUND|EAI_AGAIN/i);
  });

  it("S2.2 THE LOAD-BEARING ASSERTION — the verdict is 'indeterminate', never 'dead'", { timeout: 20000 }, async () => {
    const result = await testProxyUrl({
      proxyUrl: DEAD_SOCKS5,
      testUrl: UNREACHABLE_TARGET,
      timeoutMs: 5000,
    });

    // Pre-fix: classifyProbeVerdict(result) === "dead" → the health sweep
    // disabled EVERY socks5 pool and replicated the disable to the mirror twin.
    // Post-fix: "indeterminate" → the pool stays active. Wave 0's law can finally
    // do its job, because the status is no longer wearing a deterministic mask.
    expect(classifyProbeVerdict(result)).toBe("indeterminate");
  });

  it("S2.3 the boundary the bug exploited: 400/404/410 are dead, everything else is indeterminate", () => {
    // Pinning the classification table makes the S2.2 assertion meaningful — it
    // shows WHY a 400 was fatal and a 500 is not.
    for (const dead of [400, 404, 410]) {
      expect(classifyProbeVerdict({ ok: false, status: dead })).toBe("dead");
    }
    for (const indeterminate of [500, 502, 503, 429, undefined, null]) {
      expect(classifyProbeVerdict({ ok: false, status: indeterminate })).toBe("indeterminate");
    }
    // A missing/absent result is indeterminate too — never death.
    expect(classifyProbeVerdict(null)).toBe("indeterminate");
    expect(classifyProbeVerdict(undefined)).toBe("indeterminate");
    // And a success is alive.
    expect(classifyProbeVerdict({ ok: true })).toBe("alive");
  });
});

describe("S3 — proxyFetch: the silent DIRECT-egress bypass is closed", () => {
  // ⚠️ TWO option keys are load-bearing here, and getting either wrong makes the
  // test pass while proving NOTHING (this suite's first draft did exactly that,
  // and only a mutation run caught it):
  //
  //   1. `enabled: true` — `resolveConnectionProxyUrl` (proxyFetch.js:204)
  //      returns null unless `enabled === true || connectionProxyEnabled === true`.
  //      Without it the proxy is never resolved.
  //   2. `url` (or `connectionProxyUrl`) — NOT `proxyUrl`. `:207` reads
  //      `proxyOptions?.url ?? proxyOptions?.connectionProxyUrl`; a `proxyUrl` key
  //      is never read, so `proxyUrl` stays null and the socks5 branch at :253 is
  //      never reached. The call then succeeds/fails for unrelated reasons and the
  //      assertions pass vacuously.
  //
  // If `proxyUrl` ever resolves null again, S3.3 catches it — it asserts the
  // dispatcher path was actually taken.
  const SOCKS5_PROXY_OPTIONS = (extra = {}) => ({
    enabled: true,
    url: DEAD_SOCKS5,
    ...extra,
  });

  it("S3.1 with strictProxy the failure is a CONNECTION error, not a proxy-URL protocol error", { timeout: 20000 }, async () => {
    // Pre-fix this threw:
    //   "[ProxyFetch] Proxy required but failed (strictProxy=true): Proxy URL
    //    must use socks5:// or socks:// protocol"
    // i.e. the CONSTRUCTION error leaked through. Post-fix the dispatcher is
    // built successfully and the failure happens at the network layer instead.
    let message = "";
    try {
      await proxyAwareFetch(UNREACHABLE_TARGET, {}, SOCKS5_PROXY_OPTIONS({ strictProxy: true }));
      throw new Error("EXPECTED_A_THROW");
    } catch (e) {
      message = String(e?.message || "");
    }

    expect(message).not.toBe("EXPECTED_A_THROW");
    // The discriminating assertion: the protocol complaint is GONE.
    expect(message).not.toMatch(/must use socks5:\/\/ or socks:\/\/ protocol/);
    expect(message).not.toMatch(/Socks5ProxyAgent unavailable/);
    // What remains is a real fetch/connection failure (or its strictProxy wrapper).
    expect(message).toMatch(/fetch failed|Proxy required but failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i);
  });

  it("S3.2 without strictProxy the DIRECT fallback is taken for a NETWORK reason, never a construction reason", { timeout: 20000 }, async () => {
    // The bypass is SILENT to the caller by design: without strictProxy both the
    // bug and the fix end in `originalFetch` direct, so the thrown/returned value
    // is IDENTICAL either way ("fetch failed" — the target is unreachable). The
    // ONLY observable difference is the `console.warn` at proxyFetch.js:385.
    //
    // That is exactly why this asserts on the warn rather than on the result, and
    // why the first draft of this test (which asserted on the result) could not
    // fail: it was measuring the one thing the bug does not change.
    //
    // Measured, with the fix in place:
    //   warn → "[ProxyFetch] Proxy failed, falling back to direct: fetch failed"
    // Under the `{ uri }` mutation:
    //   warn → "…falling back to direct: Proxy URL must use socks5:// or socks://
    //           protocol"
    const warnings = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((...args) => {
      warnings.push(args.map(String).join(" "));
    });
    try {
      let surfaced = "";
      try {
        await proxyAwareFetch(UNREACHABLE_TARGET, {}, SOCKS5_PROXY_OPTIONS());
      } catch (e) {
        surfaced = String(e?.message || "");
      }
      // The caller-visible result is the same either way — documented, not asserted
      // as discriminating.
      expect(surfaced).not.toMatch(/must use socks5:\/\/ or socks:\/\/ protocol/);

      // The discriminating assertion: the warn proves WHY the fallback fired.
      const fallbackWarn = warnings.find((w) => /falling back to direct/i.test(w));
      expect(fallbackWarn, "expected a 'falling back to direct' console.warn").toBeTruthy();
      expect(fallbackWarn).not.toMatch(/must use socks5:\/\/ or socks:\/\/ protocol/);
      expect(fallbackWarn).not.toMatch(/Socks5ProxyAgent unavailable/);
      // It must name a real network failure — the dispatcher was BUILT and then
      // the connection was refused, which is the intended fail-open behaviour.
      expect(fallbackWarn).toMatch(/fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i);
    } finally {
      spy.mockRestore();
    }
  });

  it("S3.3 GUARD — the socks5 dispatcher path was actually reached (so S3.1/S3.2 cannot pass vacuously)", { timeout: 20000 }, async () => {
    // This is the assertion the first draft lacked, and its absence is why S3.1
    // and S3.2 stayed GREEN while the production code was mutated back to the
    // buggy `{ uri }` shape. A test that does not prove it reached the code under
    // test is not a test.
    //
    // The first version of THIS guard was also weak — it accepted
    // /Proxy required but failed|fetch failed/, which matches both the
    // dispatcher path and a bare direct fetch, so it too passed under mutation.
    // Measured evidence for the two shapes:
    //
    //   correct keys (dispatcher built) →
    //     "[ProxyFetch] Proxy required but failed (strictProxy=true): fetch failed"
    //   wrong keys / no `enabled` (proxy never resolved, direct fetch) →
    //     "fetch failed"
    //
    // So the strictProxy WRAPPER is the discriminator: it is emitted only from
    // :372, inside the branch that already called getDispatcher successfully or
    // caught its throw. Requiring it proves the proxy path was taken.
    let message = "";
    try {
      await proxyAwareFetch(UNREACHABLE_TARGET, {}, SOCKS5_PROXY_OPTIONS({ strictProxy: true }));
    } catch (e) {
      message = String(e?.message || "");
    }
    expect(message).toMatch(/^\[ProxyFetch\] Proxy required but failed \(strictProxy=true\):/);
    // And it must NOT be the bare direct-fetch message, which is what a vacuous
    // pass looks like (proxy silently never resolved).
    expect(message).not.toBe("fetch failed");
  });
});

describe("S4 — the tautology guard (why this suite cannot silently stop proving anything)", () => {
  it("S4.1 this suite imports the REAL undici, not a mock", async () => {
    const undici = await import("undici");
    // A vi.mock'd undici would be a plain object of `vi.fn()`s and stub classes.
    // The real module's Socks5ProxyAgent is a genuine class with the real
    // constructor semantics — proven by S1.1 throwing InvalidArgumentError, which
    // no permissive stub would do.
    expect(typeof undici.Socks5ProxyAgent).toBe("function");
    expect(undici.Socks5ProxyAgent).toBe(Socks5ProxyAgent);
    // And the real one rejects the object shape. A stub that accepts it would
    // make this suite green while proving nothing — exactly the v0.9.42 failure.
    expect(() => new undici.Socks5ProxyAgent({ uri: DEAD_SOCKS5 })).toThrow(/must use socks5:/);
  });

  it("S4.2 the two production call sites are asserted through their PUBLIC exports", () => {
    // Storms assert public exports only (never `__test__` internals), so this
    // suite stays valid through milestone 2a's FleetState shim.
    expect(typeof testProxyUrl).toBe("function");
    expect(typeof classifyProbeVerdict).toBe("function");
    expect(typeof proxyAwareFetch).toBe("function");
  });
});
