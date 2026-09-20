// CodeBuddy Intl (.ai) OAuth identity fix (plan §3.2 row 12 / MIBP 604b4d85).
//
// Two behaviours, both ported into Vela:
//  1. The connection test must actually PROBE the token. Before this fix
//     codebuddy-intl was absent from OAUTH_TEST_CONFIG, so testOAuthConnection
//     bailed with "Provider test not supported" without touching the network.
//     The probe hits the Keycloak realm's userinfo endpoint, so a revoked/expired
//     token is caught (401 → invalid).
//  2. A fresh OAuth login must be NAMED BY IDENTITY. The access token is a
//     Keycloak JWT carrying email/name claims; mapTokens now surfaces them, so
//     createProviderConnection names the row from the email instead of falling
//     back to the generic "Account N" placeholder.
//
// Proof shape (Vela's house harness): the REAL sqlite adapter under a temp
// DATA_DIR, plus a mocked global.fetch for the network probe.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalFetch = global.fetch;

// Minimal unsigned JWT (header.payload.sig) — the helpers only decode the payload.
function makeJwt(payload) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64({ alg: "RS256", typ: "JWT" })}.${b64(payload)}.sig`;
}

const IDENTITY_JWT = makeJwt({
  iss: "https://www.codebuddy.ai/auth/realms/copilot",
  email: "aghiyaramadh@gmail.com",
  name: "aghiya ramadh",
});

async function loadModules() {
  const provider = (await import("../../src/lib/oauth/providers/codebuddy-intl.js")).default;
  const { testSingleConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");
  const { createProviderConnection } = await import("../../src/lib/localDb.js");
  return { provider, testSingleConnection, createProviderConnection };
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-cbintl-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  global.fetch = originalFetch;
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("codebuddy-intl connection test probes the token", () => {
  it("reports failure when the token probe returns 401 (not 'Provider test not supported')", async () => {
    const { testSingleConnection, createProviderConnection } = await loadModules();
    const conn = await createProviderConnection({
      provider: "codebuddy-intl",
      authType: "oauth",
      accessToken: IDENTITY_JWT,
      refreshToken: "rt-401",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      testStatus: "active",
    });

    const calls = [];
    global.fetch = vi.fn((url) => {
      calls.push(String(url));
      return Promise.resolve(new Response("unauthorized", { status: 401 }));
    });

    const result = await testSingleConnection(conn.id);

    // The regression: this used to short-circuit before any probe.
    expect(result.error).not.toBe("Provider test not supported");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/invalid|revoked/i);
    // A real probe actually ran, against the codebuddy.ai realm.
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.some((u) => u.includes("codebuddy.ai"))).toBe(true);
  }, 30_000);

  it("reports success when the token probe returns 200", async () => {
    const { testSingleConnection, createProviderConnection } = await loadModules();
    const conn = await createProviderConnection({
      provider: "codebuddy-intl",
      authType: "oauth",
      accessToken: IDENTITY_JWT,
      refreshToken: "rt-200",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      testStatus: "active",
    });

    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ email: "aghiyaramadh@gmail.com" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const result = await testSingleConnection(conn.id);
    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
  }, 30_000);
});

describe("codebuddy-intl account is named from identity", () => {
  it("names the connection from the access-token identity when present", async () => {
    const { provider, createProviderConnection } = await loadModules();
    const tokens = provider.mapTokens({
      access_token: IDENTITY_JWT,
      refresh_token: "rt",
      expires_in: 3600,
    });

    expect(tokens.email).toBe("aghiyaramadh@gmail.com");
    expect(tokens.displayName).toBe("aghiya ramadh");

    const conn = await createProviderConnection({
      provider: "codebuddy-intl",
      authType: "oauth",
      ...tokens,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      testStatus: "active",
    });

    // Named from identity, not "Account N".
    expect(conn.name).toBe("aghiyaramadh@gmail.com");
    expect(conn.email).toBe("aghiyaramadh@gmail.com");
    expect(conn.displayName).toBe("aghiya ramadh");
  });

  it("falls back to the generic 'Account N' placeholder for an opaque token", async () => {
    const { provider, createProviderConnection } = await loadModules();
    const tokens = provider.mapTokens({ access_token: "opaque-token", expires_in: 3600 });

    expect(tokens.accessToken).toBe("opaque-token");
    expect(tokens.email).toBeNull();
    expect(tokens.displayName).toBeNull();

    const conn = await createProviderConnection({
      provider: "codebuddy-intl",
      authType: "oauth",
      ...tokens,
      testStatus: "active",
    });

    expect(conn.name).toMatch(/^Account \d+$/);
  });
});
