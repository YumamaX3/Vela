/**
 * Freebuff device-code login provider.
 * Covers: composite device_code round-trip, loginUrl hostname allowlist
 * (exact host, dot-boundary suffix, homograph/includes traps, non-https),
 * pollToken pending vs success (access_token synthesis), defensive composite
 * validation, and the mapTokens null-refresh / no-expiresIn invariants.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import freebuff from "../../src/lib/oauth/providers/freebuff.js";

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("requestDeviceCode", () => {
  const goodResponse = {
    fingerprintId: "fp-1",
    fingerprintHash: "hash-1",
    loginUrl: "https://freebuff.com/login?auth_code=abc",
    expiresAt: Date.now() + 300000,
  };

  it("returns a composite device_code + verification_uri + interval + numeric expires_in", async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse(goodResponse));
    const data = await freebuff.requestDeviceCode(freebuff.config);
    const parts = data.device_code.split("|");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBeTruthy(); // per-connection fingerprintId (random UUID)
    expect(parts[1]).toBe("hash-1");
    expect(Number(parts[2])).toBeGreaterThan(Date.now());
    expect(data.verification_uri).toBe(goodResponse.loginUrl);
    expect(data.interval).toBe(5);
    expect(typeof data.expires_in).toBe("number");
    expect(data.expires_in).toBeGreaterThan(0);
  });

  it("accepts an exact allowlisted host and a dot-boundary subdomain", async () => {
    for (const host of ["freebuff.com", "www.codebuff.com", "login.freebuff.com"]) {
      global.fetch.mockResolvedValueOnce(jsonResponse({ ...goodResponse, loginUrl: `https://${host}/login` }));
      const data = await freebuff.requestDeviceCode(freebuff.config);
      expect(data.verification_uri).toBe(`https://${host}/login`);
    }
  });

  it("rejects non-https, foreign hosts, and includes()-style traps", async () => {
    for (const loginUrl of [
      "http://freebuff.com/login", // not https
      "https://freebuff.com.evil.com/login", // suffix trap
      "https://evilfreebuff.com/login", // prefix trap
      "https://attacker.com/login", // foreign
    ]) {
      global.fetch.mockResolvedValueOnce(jsonResponse({ ...goodResponse, loginUrl }));
      await expect(freebuff.requestDeviceCode(freebuff.config)).rejects.toThrow(/not allowed|invalid/i);
    }
  });

  it("rejects responses missing loginUrl or fingerprintHash", async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({ fingerprintHash: "h" }));
    await expect(freebuff.requestDeviceCode(freebuff.config)).rejects.toThrow(/missing/i);
  });
});

describe("pollToken", () => {
  const composite = `fp-1|hash-1|${Date.now() + 300000}`;

  it("returns authorization_pending while upstream answers 401", async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({ error: "Authentication failed" }, 401));
    const result = await freebuff.pollToken(freebuff.config, composite);
    expect(result.ok).toBe(true);
    expect(result.data.error).toBe("authorization_pending");
  });

  it("synthesizes access_token from user.authToken on success", async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({ user: { authToken: "cb_tok", email: "a@b.c", name: "A", id: 7 } }));
    const result = await freebuff.pollToken(freebuff.config, composite);
    expect(result.ok).toBe(true);
    expect(result.data.access_token).toBe("cb_tok");
    expect(result.data.email).toBe("a@b.c");
  });

  it("treats a 200 without authToken as pending", async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({ user: {} }));
    const result = await freebuff.pollToken(freebuff.config, composite);
    expect(result.data.error).toBe("authorization_pending");
  });

  it("rejects malformed composites defensively", async () => {
    for (const bad of ["only-two|parts", "", null, "a|b|notanumber", "a||123"]) {
      const result = await freebuff.pollToken(freebuff.config, bad);
      expect(result.ok).toBe(false);
      expect(result.data.error).toMatch(/invalid_device_code|expired_token/);
    }
  });

  it("rejects expired composites", async () => {
    const expired = `fp-1|hash-1|${Date.now() - 1000}`;
    const result = await freebuff.pollToken(freebuff.config, expired);
    expect(result.ok).toBe(false);
    expect(result.data.error).toBe("expired_token");
  });
});

describe("mapTokens — no-refresh invariants", () => {
  it("returns refreshToken null and NEVER emits expiresIn/expiresAt", () => {
    const mapped = freebuff.mapTokens({ access_token: "cb_tok", email: "a@b.c", name: "A", fingerprintId: "fp-1", fingerprintHash: "h" });
    expect(mapped.accessToken).toBe("cb_tok");
    expect(mapped.refreshToken).toBeNull();
    expect(mapped).not.toHaveProperty("expiresIn");
    expect(mapped).not.toHaveProperty("expiresAt");
    expect(mapped.providerSpecificData.fingerprintId).toBe("fp-1");
    expect(mapped.providerSpecificData.authMethod).toBe("freebuff_cli");
  });
});
