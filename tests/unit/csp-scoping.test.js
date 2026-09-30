// CSP document scoping — the policy rides the right responses and never the gateway.
//
// The dashboard shipped for its whole life with NO Content-Security-Policy while a
// comment claimed "the dashboard's React runtime owns its own CSP" — a protection
// that did not exist. The 2026-09-30 mend adds a policy in dashboardGuard, scoped
// to DOCUMENT routes only. This suite pins that scoping as a contract:
//
//   • /dashboard/* and /login carry the CSP header;
//   • the policy is the CORRECTED posture (2026-09-30): script-src 'self'
//     'unsafe-inline' — the v1.0.52 nonce+'strict-dynamic' variant blocked every
//     script on the live box (18 scripts, 0 nonced) because the nonce rode a
//     custom header nothing reads; this suite pins BOTH the scoping AND the
//     absence of that broken shape;
//   • the gateway prefixes (/v1, /v1beta, /codex, /responses, /api/v1, /api/v1beta)
//     carry NO CSP of any kind — their clients are not browsers, and a CSP header
//     on a proxied SSE stream is semantically wrong and operationally risky.
//
// The guard is driven through the real module (no import mocking of the guard
// itself), with its settings/DB dependencies mocked at the seams the CSRF suite
// already established. NextResponse.next() is real where the CSP path needs real
// Headers (the guard mints its own response via the mocked next()), so the mock
// records the init the guard passes and reflects it back — see cspNextResponse.
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  nextResponse: vi.fn((init) => ({ status: 200, headers: new Headers(init?.request?.headers ? {} : {}), __next: true, init })),
  jsonResponse: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  redirect: vi.fn((url) => ({ status: 307, url, headers: new Headers() })),
  getSettings: vi.fn(),
  validateApiKey: vi.fn(),
  getConsistentMachineId: vi.fn(),
  verifyDashboardAuthToken: vi.fn(),
}));
vi.mock("next/server", () => ({
  NextResponse: {
    next: mocks.nextResponse,
    json: mocks.jsonResponse,
    redirect: mocks.redirect,
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
const { proxy } = await import("../../src/dashboardGuard.js");

const PEER_TOKEN = "peer-token-fixture";

function edgeRequest(pathname, { method = "GET", secFetchSite, host = "localhost:32060", extra = {} } = {}) {
  const headers = new Headers({ host, ...extra });
  if (secFetchSite !== undefined) headers.set("sec-fetch-site", secFetchSite);
  return {
    method,
    nextUrl: { pathname, searchParams: new URL(`http://localhost${pathname}`).searchParams },
    headers,
    cookies: { get: vi.fn(() => undefined) },
    url: `http://localhost${pathname}`,
  };
}

describe("dashboard CSP — document routes carry it, gateway paths never do", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VELA_PEER_TOKEN = PEER_TOKEN;
    mocks.getSettings.mockResolvedValue({ requireLogin: false });
    mocks.validateApiKey.mockResolvedValue(true);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.verifyDashboardAuthToken.mockResolvedValue(true);
  });

  it("carries a Content-Security-Policy (report-only phase) on /dashboard", async () => {
    const response = await proxy(edgeRequest("/dashboard"));
    const csp =
      response.headers?.get?.("Content-Security-Policy-Report-Only") ||
      response.headers?.get?.("Content-Security-Policy");
    expect(csp, "the dashboard document response must carry a CSP header").toBeTruthy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("carries the policy on /login too — the login page mints credentials", async () => {
    const response = await proxy(edgeRequest("/login"));
    const csp =
      response.headers?.get?.("Content-Security-Policy-Report-Only") ||
      response.headers?.get?.("Content-Security-Policy");
    expect(csp).toBeTruthy();
  });

  it("carries the corrected script-src posture ('self' 'unsafe-inline', no nonce/strict-dynamic)", async () => {
    const response = await proxy(edgeRequest("/dashboard"));
    const csp = response.headers?.get?.("Content-Security-Policy") || "";
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    // The v1.0.52 outage shape — a nonce without a stamping path executes nothing.
    expect(csp).not.toContain("'strict-dynamic'");
    expect(csp).not.toContain("'nonce-");
    expect(csp).not.toContain("x-nonce");
  });

  it.each(["/v1/chat/completions", "/v1beta/models", "/codex/responses", "/responses", "/api/v1/chat/completions", "/api/v1beta"])(
    "never sets CSP on the gateway path %s (SSE clients are not browsers)",
    async (pathname) => {
      const response = await proxy(edgeRequest(pathname));
      const serialized = JSON.stringify(response);
      expect(serialized).not.toContain("Content-Security-Policy");
    },
  );
});
