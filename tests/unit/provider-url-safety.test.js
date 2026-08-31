/**
 * Provider-Test SSRF URL Gate — M0 TAG 4 proof suite
 *
 * Proves src/lib/network/providerUrlSafety.js, the gate that guards every
 * operator-controlled provider-test URL (connection baseUrl / azureEndpoint /
 * node baseUrl) before the server fetches it:
 *
 *   S1. blocked targets — loopback, metadata/link-local, 0.0.0.0, hostile
 *       decimal/hex/octal spellings, bracketed IPv6, non-http(s) schemes
 *   S2. allowed targets — public https, RFC1918 LAN, Tailscale CGNAT (the
 *       homelab subnet), ULA — deliberately NOT blocked per the sealed plan
 *   S3. unparseable → 400-class honest refusal
 *   S4. validateProviderTestBaseUrl wrapper behavior
 *   S5. redirect hardening — each hop re-validated, metadata hop refused,
 *       loops and hop floods refused, allowed hops followed
 *   S6. internal-loopback flag behavior — allowLocalLoopback bypasses for
 *       internal pings; allowLocal loosens loopback only, never metadata
 */
import { describe, it, expect, vi } from "vitest";
import {
  validateProviderTestUrl,
  validateProviderTestBaseUrl,
  extractHopTarget,
  probeWithHopValidation,
  allowLocalTestingFor,
  ProviderUrlSafetyError,
} from "../../src/lib/network/providerUrlSafety.js";

/* ── S1: blocked targets ─────────────────────────────────────────────── */

describe("S1: blocked targets are refused with blocked-range", () => {
  const blockedRange = [
    // loopback literals
    "http://127.0.0.1/v1",
    "https://127.255.0.99/",
    "http://[::1]/x",
    "http://localhost:11434/api/tags",
    "http://LOCALHOST/",
    "http://127.0.0.1@169.254.169.254/",
    // metadata / link-local
    "http://169.254.169.254/latest/meta-data/",
    "http://[fe80::abcd]/x",
    "http://[::ffff:169.254.169.254]/x", // parser folds to ::ffff:a9fe:a9fe
    "http://[::ffff:7f00:1]/x", // IPv4-mapped loopback
    // unspecified
    "http://0.0.0.0/x",
    "http://[::]/x",
    // hostile numeric spellings of loopback
    "http://2130706433/",
    "http://0x7f000001/",
    "http://017700000001/",
    "http://0x7f.0.0.1/",
    "http://127.1/",
    // hostile numeric spellings of the metadata IP
    "http://2852039166/", // decimal
    "http://0251.0376.0251.0376/", // octal (0251=169, 0376=254)
    "http://0xa9fea9fe/", // hex
    // documentation range (never legitimately routable)
    "http://[2001:db8::1]/x",
    // backslash authority trick — parser sees 169.254.169.254 as the host
    "http://169.254.169.254\\@evil.example/",
  ];

  it.each(blockedRange)("refuses %s", (url) => {
    const result = validateProviderTestUrl(url);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("blocked-range");
    // honest-but-generic: the refusal never echoes the internal reason chain
    expect(result.message).not.toMatch(/169\.254|127\.0|loopback|metadata/i);
  });

  it("refuses zone-id link-local (unparseable in the fetch grammar)", () => {
    // undici/Node's URL parser rejects %zone-id outright, so the gate refuses
    // it — either code is a safe 400-class refusal.
    const result = validateProviderTestUrl("http://[fe80::1%25eth0]/x");
    expect(result.ok).toBe(false);
    expect(["blocked-range", "unparseable"]).toContain(result.code);
  });
});

describe("S1b: non-http(s) schemes are refused with scheme", () => {
  const badSchemes = [
    "file:///etc/passwd",
    "FILE:///etc/passwd",
    "gopher://127.0.0.1/x",
    "data:text/plain;base64,aGk=",
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "ftp://10.0.0.1/files",
  ];

  it.each(badSchemes)("refuses %s", (url) => {
    const result = validateProviderTestUrl(url);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("scheme");
  });
});

/* ── S2: allowed targets ─────────────────────────────────────────────── */

describe("S2: allowed targets pass", () => {
  const allowed = [
    // public
    "https://api.openai.com/v1",
    "http://my-homelab.example.tld:11434",
    // RFC1918 — deliberately NOT blocked (homelab proxies)
    "http://192.168.1.50:8080/v1",
    "http://10.0.0.5/v1",
    "http://172.16.5.5/x",
    "http://172.31.255.254/x",
    // CGNAT — Tailscale's subnet block (100.64.0.0/10) lives here
    "http://100.64.5.20:8085/v1",
    "http://100.64.0.1/x",
    "http://100.127.255.254/x",
    // public IPv6 + ULA (homelab rationale as RFC1918)
    "http://[2606:4700:4700::1111]/x",
    "http://[fc00::1]:3000/x",
  ];

  it.each(allowed)("allows %s", (url) => {
    const result = validateProviderTestUrl(url);
    expect(result.ok).toBe(true);
    expect(result.url).toBe(new URL(url).href);
  });

  it("accepts a hostname that could rebind (documented residual)", () => {
    // DNS rebinding (a hostname resolving to a blocked IP at connect time) is
    // a documented residual in the utility header — the literal-IP blocks
    // carry the cloud-metadata defense. Hostnames themselves pass.
    const result = validateProviderTestUrl("http://my-gateway.example/computeMetadata/v1/");
    expect(result.ok).toBe(true);
  });
});

/* ── S3: unparseable → 400-class ─────────────────────────────────────── */

describe("S3: unparseable inputs refuse with 400-class code", () => {
  const junk = ["", "   ", "not a url", "http://", "http://[::1/x", "http://[zzzz::1]/x", "just-a-name"];

  it.each(junk)("refuses %s", (url) => {
    const result = validateProviderTestUrl(url);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("unparseable");
  });

  it("refuses null/undefined", () => {
    expect(validateProviderTestUrl(null).code).toBe("unparseable");
    expect(validateProviderTestUrl(undefined).code).toBe("unparseable");
  });
});

/* ── S4: baseUrl wrapper ─────────────────────────────────────────────── */

describe("S4: validateProviderTestBaseUrl", () => {
  it("refuses a bare metadata host", () => {
    const result = validateProviderTestBaseUrl("http://169.254.169.254");
    expect(result.ok).toBe(false);
    expect(result.code).toBe("blocked-range");
  });

  it("refuses hostile hex loopback", () => {
    expect(validateProviderTestBaseUrl("http://0x7f000001").ok).toBe(false);
  });

  it("normalizes trailing slashes and returns the base for suffixing", () => {
    const result = validateProviderTestBaseUrl("https://api.example.com/v1///");
    expect(result.ok).toBe(true);
    expect(result.baseUrl).toBe("https://api.example.com/v1");
    expect(`${result.baseUrl}/models`).toBe("https://api.example.com/v1/models");
  });

  it("refuses empty with the missing message", () => {
    const result = validateProviderTestBaseUrl("");
    expect(result.ok).toBe(false);
    expect(result.code).toBe("unparseable");
  });
});

/* ── S5: redirect hardening ──────────────────────────────────────────── */

describe("S5: each redirect hop is re-validated", () => {
  function redirectResponse(location) {
    return {
      status: 302,
      headers: { get: (k) => (k.toLowerCase() === "location" ? location : null) },
      body: { cancel: vi.fn() },
    };
  }
  const okResponse = { status: 200, ok: true, headers: { get: () => null } };

  it("refuses a hop into the metadata range", () => {
    const target = extractHopTarget("http://169.254.169.254/latest/meta-data/", "https://allowed.example/start");
    expect(target.ok).toBe(false);
    expect(target.code).toBe("blocked-range");
    expect(target.message).toMatch(/redirect/i);
  });

  it("refuses a hop into loopback and hostile spellings", () => {
    expect(extractHopTarget("http://[::1]/x", "https://allowed.example/").code).toBe("blocked-range");
    expect(extractHopTarget("http://2130706433/", "https://allowed.example/").code).toBe("blocked-range");
  });

  it("refuses a hop with a disallowed scheme", () => {
    expect(extractHopTarget("file:///etc/passwd", "https://allowed.example/").code).toBe("scheme");
  });

  it("resolves relative hops against the request URL", () => {
    const target = extractHopTarget("/next/step", "https://allowed.example/start");
    expect(target.ok).toBe(true);
    expect(target.url).toBe("https://allowed.example/next/step");
  });

  it("probeWithHopValidation throws on a metadata hop", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(redirectResponse("http://169.254.169.254/latest/meta-data/"));
    await expect(
      probeWithHopValidation("https://allowed.example/start", fetchFn, { headers: { a: "b" } })
    ).rejects.toMatchObject({ name: "ProviderUrlSafetyError", code: "blocked-range" });
    // the probe was sent with redirects disabled
    expect(fetchFn.mock.calls[0][1].redirect).toBe("manual");
  });

  it("follows an allowed hop and returns the final response", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(redirectResponse("https://allowed.example/final"))
      .mockResolvedValueOnce(okResponse);
    const res = await probeWithHopValidation("https://allowed.example/start", fetchFn, {});
    expect(res.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[1][0]).toBe("https://allowed.example/final");
  });

  it("refuses redirect loops", async () => {
    const fetchFn = vi.fn().mockResolvedValue(redirectResponse("https://allowed.example/start"));
    await expect(probeWithHopValidation("https://allowed.example/start", fetchFn, {})).rejects.toMatchObject({
      name: "ProviderUrlSafetyError",
    });
  });

  it("refuses a hop flood (more than 3 hops)", async () => {
    let n = 0;
    const fetchFn = vi.fn().mockImplementation(async () => {
      n += 1;
      return redirectResponse(`https://allowed.example/hop${n}`);
    });
    await expect(probeWithHopValidation("https://allowed.example/start", fetchFn, {})).rejects.toMatchObject({
      name: "ProviderUrlSafetyError",
    });
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it("passes extra args through to fetchFn (proxy config threading)", async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse);
    const proxyCfg = { connectionProxyEnabled: true };
    await probeWithHopValidation("https://allowed.example/start", fetchFn, {}, proxyCfg);
    expect(fetchFn.mock.calls[0][2]).toBe(proxyCfg);
  });
});

/* ── S6: internal-loopback flag behavior ─────────────────────────────── */

describe("S6: the internal path stays untouched", () => {
  it("allowLocalLoopback lets the internal model-ping loopback through", () => {
    // models/test ping targets loopback BY DESIGN — the flag keeps it working
    const result = validateProviderTestUrl("http://127.0.0.1:20127/api/v1/chat/completions", {
      allowLocalLoopback: true,
    });
    expect(result.ok).toBe(true);
    expect(result.url).toBe("http://127.0.0.1:20127/api/v1/chat/completions");
  });

  it("allowLocal loosens loopback but NEVER metadata", () => {
    expect(validateProviderTestUrl("http://localhost:11434/api/tags", { allowLocal: true }).ok).toBe(true);
    expect(validateProviderTestUrl("http://127.0.0.1:11434/api/tags", { allowLocal: true }).ok).toBe(true);
    expect(validateProviderTestUrl("http://[::ffff:127.0.0.1]/x", { allowLocal: true }).ok).toBe(true);
    expect(validateProviderTestUrl("http://169.254.169.254/x", { allowLocal: true }).ok).toBe(false);
    expect(validateProviderTestUrl("http://[::ffff:169.254.169.254]/x", { allowLocal: true }).ok).toBe(false);
    expect(validateProviderTestUrl("http://[fe80::abcd]/x", { allowLocal: true }).ok).toBe(false);
  });

  it("allowLocalTestingFor reads only the explicit opt-ins", () => {
    expect(allowLocalTestingFor({ env: { VELA_ALLOW_LOCAL_TESTING: "1" } })).toBe(true);
    expect(allowLocalTestingFor({ env: { VELA_ALLOW_LOCAL_TESTING: "true" } })).toBe(true);
    expect(allowLocalTestingFor({ env: { VELA_ALLOW_LOCAL_TESTING: "0" } })).toBe(false);
    expect(allowLocalTestingFor({ env: {} })).toBe(false);
    expect(allowLocalTestingFor({ env: {}, connection: { providerSpecificData: { vela_allow_local: true } } })).toBe(true);
    expect(allowLocalTestingFor({ env: {}, connection: { providerSpecificData: { vela_allow_local: "yes" } } })).toBe(false);
  });
});
