// Proxy Fleet Rebirth — milestone 1 (Security Closure), §5.1
// The fail-closed proxy-pools route gate, proven across the full posture matrix.
//
// WHY THIS STORM EXISTS
// The ADR prescribed "remove /api/proxy-pools from PROTECTED_API_PATHS so it
// defaults to ALWAYS_PROTECTED". That instruction could not be implemented
// literally, because PROTECTED_API_PATHS was DEAD CODE: commit bb868085
// ("deny-by-default API auth") replaced `PROTECTED_API_PATHS.some(...)` with
// `pathname.startsWith("/api/")`, orphaning the 18-entry list. There is also no
// "default to ALWAYS_PROTECTED" — it is a positive list. The Star's decree
// 2026-09-03 resolved this to a method-aware fail-closed gate scoped to the
// prefix, so every other route stays byte-identical.
//
// WHAT THE GATE MUST DO
//   • every mutation under /api/proxy-pools needs a real credential — a remote
//     unauthenticated caller must NOT be able to mint an open forward-proxy via
//     the three deploy routes, nor flip fleet state via bulk-health's autoDisable
//   • the three verified dashboard GET reads stay posture-consistent (they pass
//     under requireLogin===false exactly like every other dashboard read)
//   • an UNLISTED read fail-closes LOUDLY rather than silently leaking — a new
//     GET route under the prefix 401s visibly until it is added to the list
//
// ⚠️ THE LOCALITY ESCAPE IS LOAD-BEARING, NOT A LOOPHOLE
// The first cut of this gate (JWT || local CLI token only) was PROBED and found
// to 401 every mutation for a first-run local user: README:133 documents entry
// with no password (requireLogin===false), and a browser on the box carries
// neither a JWT cookie nor the machine-derived CLI header. The page rendered and
// every button failed — create, edit, toggle, test, delete, bulk-health, deploy.
// The third arm `(isLocalRequest && isAuthenticated)` is the shape
// canAccessLocalOnlyRoute already uses for 15 spawn-capable routes. Sections A
// and D-G below are the two halves of that proof: A says the local flow works,
// D/E/F say the escape admits nobody it should not.
//
// Every case is BEHAVIOURAL — a request object driven through the real proxy().
// No source grepping: the repaired guard CONTAINS the strings this storm's
// subject is about, so a text assertion would pass on its own explanation
// (the recorded negative-regex-source-guard-defeated-by-comment lesson).
//
// Fixtures use example addresses only (TEST-NET-3 203.0.113.0/24), never a live
// LAN or Tailscale value.
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  nextResponse: Symbol("next"),
  jsonResponse: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  getSettings: vi.fn(),
  validateApiKey: vi.fn(),
  getConsistentMachineId: vi.fn(),
  verifyDashboardAuthToken: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    next: vi.fn(() => mocks.nextResponse),
    json: mocks.jsonResponse,
    redirect: vi.fn((url) => ({ status: 307, url })),
  },
}));
vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  validateApiKey: mocks.validateApiKey,
}));
vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: mocks.getConsistentMachineId,
}));
vi.mock("@/lib/auth/dashboardSession", () => ({
  verifyDashboardAuthToken: mocks.verifyDashboardAuthToken,
  AUTH_COOKIE_NAME: "vela_auth_token",
}));

const { proxy, __test__ } = await import("../../src/dashboardGuard.js");

const PEER_TOKEN = "peer-token-fixture";
const CLI_HEADER = "x-vela-cli-token";
const LOCAL_ORIGIN = "http://localhost:32060";

/**
 * A request shaped the way custom-server.js hands it to the middleware.
 * `local` reproduces the real stamping protocol: the peer token proves the
 * socket-derived IP, so locality is not spoofable from the client side.
 */
function buildRequest(pathname, method, {
  local = true,
  origin = null,
  cliHeader = false,
  jwt = false,
} = {}) {
  const headers = {};
  if (local) {
    headers["x-9r-peer-token"] = PEER_TOKEN;
    headers["x-9r-real-ip"] = "127.0.0.1";
    headers.host = "localhost:32060";
  } else {
    headers.host = "203.0.113.9:32060";
    headers["x-9r-real-ip"] = "203.0.113.9";
  }
  if (origin) headers.origin = origin;
  if (cliHeader) headers[CLI_HEADER] = "cli-token";

  return {
    nextUrl: { pathname, searchParams: new URL(`http://localhost${pathname}`).searchParams },
    headers: new Headers(headers),
    cookies: { get: vi.fn(() => (jwt ? { value: "jwt-fixture" } : undefined)) },
    url: `http://localhost${pathname}`,
    method,
  };
}

const passed = (r) => r === mocks.nextResponse;

/** Assert a refusal carries the status AND does not leak the reason for a
 *  distinct credential shape. Locality-before-credential is 403; everything
 *  else is 401. */
function expectRefused(response, status) {
  expect(passed(response)).toBe(false);
  expect(response.status).toBe(status);
  expect(response.body).toHaveProperty("error");
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.VELA_PEER_TOKEN = PEER_TOKEN;
  mocks.getSettings.mockResolvedValue({ requireLogin: false });
  mocks.validateApiKey.mockResolvedValue(false);
  mocks.getConsistentMachineId.mockResolvedValue("cli-token");
  mocks.verifyDashboardAuthToken.mockResolvedValue(false);
});

// ─────────────────────────────────────────────────────────────────────────
// S1 · The pure predicate — the read/method matrix, isolated from request
//      plumbing so a wrong entry fails on the matrix rather than on a mock.
// ─────────────────────────────────────────────────────────────────────────
describe("S1 — the posture-read predicate is method-aware and exact-match", () => {
  const { isProxyPoolsPostureRead, PROXY_POOLS_POSTURE_READS } = __test__;

  it("names exactly the three verified dashboard GET reads", () => {
    expect([...PROXY_POOLS_POSTURE_READS].sort()).toEqual([
      "/api/proxy-pools",
      "/api/proxy-pools/export",
      "/api/proxy-pools/fitness",
    ]);
  });

  it("admits each listed read on GET only", () => {
    for (const p of PROXY_POOLS_POSTURE_READS) {
      expect(isProxyPoolsPostureRead(p, "GET")).toBe(true);
      for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
        expect(isProxyPoolsPostureRead(p, m)).toBe(false);
      }
    }
  });

  it("fail-closes every unlisted read under the prefix — loud, not silent", () => {
    // GET /api/proxy-pools/<id> is exported but has no consumer, so it
    // fail-closes with no dashboard impact. A NEW read route must be added
    // here deliberately; it must not inherit the posture by accident.
    for (const p of [
      "/api/proxy-pools/abc",
      "/api/proxy-pools/probe",
      "/api/proxy-pools/bulk-health",
      "/api/proxy-pools/vercel-deploy",
      "/api/proxy-pools/cloudflare-deploy",
      "/api/proxy-pools/deno-deploy",
      "/api/proxy-pools/fitness/reset",
    ]) {
      expect(isProxyPoolsPostureRead(p, "GET")).toBe(false);
    }
  });

  it("never matches a path outside the prefix", () => {
    expect(isProxyPoolsPostureRead("/api/providers", "GET")).toBe(false);
    expect(isProxyPoolsPostureRead("/api/usage/metrics/kpis", "GET")).toBe(false);
    // A prefix that merely starts the same is still outside the gate's scope
    // for the predicate, which is scoped to the proxy-pools subtree.
    expect(isProxyPoolsPostureRead("/api/proxy-poolsy", "GET")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// S2 · The local first-run flow — the regression the locality escape closes.
// ─────────────────────────────────────────────────────────────────────────
describe("S2 — a first-run LOCAL dashboard may still operate the fleet", () => {
  // requireLogin===false (README:133: no password on first run), a browser on
  // the box, no JWT cookie, no CLI header. This is the primary documented flow.
  const localBrowser = (p, m) => buildRequest(p, m, { local: true, origin: LOCAL_ORIGIN });

  const MUTATIONS = [
    ["/api/proxy-pools", "POST"],
    ["/api/proxy-pools/abc", "PUT"],
    ["/api/proxy-pools/abc", "DELETE"],
    ["/api/proxy-pools/abc/test", "POST"],
    ["/api/proxy-pools/bulk-health", "POST"],
    ["/api/proxy-pools/vercel-deploy", "POST"],
    ["/api/proxy-pools/cloudflare-deploy", "POST"],
    ["/api/proxy-pools/deno-deploy", "POST"],
    ["/api/proxy-pools/fitness/reset", "POST"],
  ];

  it.each(MUTATIONS)("admits %s %s from the local first-run browser", async (p, m) => {
    expect(passed(await proxy(localBrowser(p, m)))).toBe(true);
  });

  it.each([
    ["/api/proxy-pools", "GET"],
    ["/api/proxy-pools/fitness", "GET"],
    ["/api/proxy-pools/export", "GET"],
  ])("admits the posture read %s %s", async (p, m) => {
    expect(passed(await proxy(localBrowser(p, m)))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// S3 · The wound the gate exists to close — remote unauthenticated mutation.
// ─────────────────────────────────────────────────────────────────────────
describe("S3 — a REMOTE caller with no credential cannot operate the fleet", () => {
  const remote = (p, m) => buildRequest(p, m, { local: false });

  it.each([
    ["/api/proxy-pools", "POST"],
    ["/api/proxy-pools/abc", "PUT"],
    ["/api/proxy-pools/abc", "DELETE"],
    ["/api/proxy-pools/abc/test", "POST"],
    ["/api/proxy-pools/bulk-health", "POST"],
    // The three deploy routes mint an OPEN FORWARD-PROXY on a public platform.
    // Reachable unauthenticated, they are the sharpest edge of this wound.
    ["/api/proxy-pools/vercel-deploy", "POST"],
    ["/api/proxy-pools/cloudflare-deploy", "POST"],
    ["/api/proxy-pools/deno-deploy", "POST"],
  ])("refuses %s %s with 401", async (p, m) => {
    expectRefused(await proxy(remote(p, m)), 401);
  });

  it("refuses an unlisted read remotely — fail-closed beats silent leak", async () => {
    expectRefused(await proxy(remote("/api/proxy-pools/abc", "GET")), 401);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// S4 · Locality-before-credential — the machine token is local-bound.
// ─────────────────────────────────────────────────────────────────────────
describe("S4 — a machine token from a remote origin is FORBIDDEN, not merely unauthorized", () => {
  const remoteWithCli = (p, m) => buildRequest(p, m, { local: false, cliHeader: true });

  it.each([
    ["/api/proxy-pools", "POST"],
    ["/api/proxy-pools/vercel-deploy", "POST"],
    ["/api/proxy-pools/bulk-health", "POST"],
  ])("refuses %s %s with 403", async (p, m) => {
    const r = await proxy(remoteWithCli(p, m));
    expectRefused(r, 403);
    // The 403 says the token is local-bound — a distinct, louder failure than
    // "you sent nothing", matching the ALWAYS_PROTECTED and public-LLM seams.
    expect(r.body.error).toMatch(/local origins/i);
  });

  it("honours the same token from a LOCAL origin", async () => {
    const r = await proxy(buildRequest("/api/proxy-pools", "POST", { local: true, cliHeader: true }));
    expect(passed(r)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// S5 · The escape hatch admits nobody it should not.
// ─────────────────────────────────────────────────────────────────────────
describe("S5 — the locality escape is bounded", () => {
  it("rejects a CROSS-ORIGIN page even though the socket is loopback", async () => {
    // The CSRF / DNS-rebind shape: the request arrives from 127.0.0.1 because
    // the victim's browser is on the box, but Origin is an attacker page.
    // isLocalRequest checks Origin, so locality is false and the escape cannot
    // fire — this is what stops a malicious site from driving the local fleet.
    for (const [p, m] of [["/api/proxy-pools", "POST"], ["/api/proxy-pools/abc", "DELETE"]]) {
      const r = await proxy(buildRequest(p, m, { local: true, origin: "https://evil.example" }));
      expectRefused(r, 401);
    }
  });

  it("rejects a LOCAL caller once requireLogin is on and no JWT exists", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: true });
    for (const [p, m] of [["/api/proxy-pools", "POST"], ["/api/proxy-pools", "GET"]]) {
      const r = await proxy(buildRequest(p, m, { local: true, origin: LOCAL_ORIGIN }));
      expectRefused(r, 401);
    }
  });

  it("rejects a REMOTE caller under requireLogin=true", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: true });
    expectRefused(await proxy(buildRequest("/api/proxy-pools", "POST", { local: false })), 401);
  });

  it("admits a logged-in operator from ANY origin — the JWT arm is not local-bound", async () => {
    mocks.verifyDashboardAuthToken.mockResolvedValue(true);
    for (const [p, m] of [["/api/proxy-pools", "POST"], ["/api/proxy-pools/abc", "DELETE"]]) {
      expect(passed(await proxy(buildRequest(p, m, { local: false, jwt: true })))).toBe(true);
    }
  });

  it("admits a logged-in operator locally under requireLogin=true", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: true });
    mocks.verifyDashboardAuthToken.mockResolvedValue(true);
    expect(passed(await proxy(buildRequest("/api/proxy-pools", "POST", { local: true, origin: LOCAL_ORIGIN, jwt: true })))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// S6 · Preflight, and the blast radius on every OTHER route.
// ─────────────────────────────────────────────────────────────────────────
describe("S6 — preflight passes, and no other route changed posture", () => {
  it("passes OPTIONS preflight unconditionally (no body, no action)", async () => {
    expect(passed(await proxy(buildRequest("/api/proxy-pools", "OPTIONS", { local: false })))).toBe(true);
  });

  // The Star's decree scoped the gate to /api/proxy-pools "so every other route
  // stays byte-identical". These pin that: surfaces with a posture BEFORE this
  // change must keep exactly that posture after it.
  it("leaves the deny-by-default /api/* posture untouched", async () => {
    // A mutation on an ordinary dashboard surface still rides requireLogin.
    expect(passed(await proxy(buildRequest("/api/usage/budgets", "POST", { local: false })))).toBe(true);
    expect(passed(await proxy(buildRequest("/api/usage/metrics/kpis", "GET", { local: false })))).toBe(true);
  });

  it("leaves ALWAYS_PROTECTED surfaces untouched — still 401 on first run", async () => {
    // /api/backup has ALWAYS required a real credential, even locally. The gate
    // must not have softened it, and must not have hardened the others.
    expectRefused(await proxy(buildRequest("/api/backup/run", "POST", { local: true, origin: LOCAL_ORIGIN })), 401);
    expectRefused(await proxy(buildRequest("/api/settings/database", "GET", { local: false })), 401);
  });

  it("leaves the public LLM surface on API-key auth, not on this gate", async () => {
    // No API key, remote → 401 from the LLM seam with its own message.
    const r = await proxy(buildRequest("/v1/chat/completions", "POST", { local: false }));
    expectRefused(r, 401);
    expect(r.body.error).toMatch(/API key/i);
  });

  it("leaves providers reads on their own posture (not gated by this change)", async () => {
    expect(passed(await proxy(buildRequest("/api/providers", "GET", { local: false })))).toBe(true);
    expect(passed(await proxy(buildRequest("/api/providers/abc", "GET", { local: false })))).toBe(true);
  });
});
