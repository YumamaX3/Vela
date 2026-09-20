// Auth Hardening W1 — the CSRF second lock at the edge.
//
// Contract under test: the dashboard session rides a cookie, and its only
// defence against a cross-site submit is SameSite=Lax — browser policy, not a
// check we run. This lock refuses a browser-labelled cross-site MUTATION and
// nothing else. Every case below pins one half of that sentence, and the
// exemptions are pinned because each one is a real caller: a lock that broke
// enterprise login or the gateway's own cross-origin clients would be a wound,
// not a defence.
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

const { proxy } = await import("../../src/dashboardGuard.js");

const PEER_TOKEN = "peer-token-fixture";
const REFUSAL = "Forbidden: cross-site mutation refused";

// `secFetchSite` is omitted entirely when undefined, so the "no header at all"
// case is real rather than an empty-string stand-in. `extra` carries the
// custom-server peer stamp for cases that must read as loopback.
function edgeRequest(
  pathname,
  { method = "POST", secFetchSite, host = "localhost:32060", extra = {} } = {}
) {
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

describe("CSRF second lock — a cross-site mutation never reaches a handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VELA_PEER_TOKEN = PEER_TOKEN;
    // requireLogin:false is the posture in which the dashboard API answers with
    // no credential at all — the widest surface this lock has to hold.
    mocks.getSettings.mockResolvedValue({ requireLogin: false });
    mocks.validateApiKey.mockResolvedValue(true);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
  });

  it("refuses a cross-site POST to a deny-by-default API route", async () => {
    const response = await proxy(edgeRequest("/api/settings", { secFetchSite: "cross-site" }));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe(REFUSAL);
  });

  it("refuses a cross-site POST to the backup restore surface (ALWAYS_PROTECTED)", async () => {
    const response = await proxy(
      edgeRequest("/api/backup/restore", { secFetchSite: "cross-site" })
    );

    expect(response.status).toBe(403);
    expect(response.body.error).toBe(REFUSAL);
  });

  it("refuses a cross-site POST to a PUBLIC route — login CSRF is real too", async () => {
    const response = await proxy(edgeRequest("/api/auth/login", { secFetchSite: "cross-site" }));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe(REFUSAL);
  });

  it("lets a same-origin POST through untouched", async () => {
    const response = await proxy(edgeRequest("/api/settings", { secFetchSite: "same-origin" }));

    expect(response).toBe(mocks.nextResponse);
  });

  it("lets a cross-site GET through — an OAuth return is a navigation, not a mutation", async () => {
    const response = await proxy(
      edgeRequest("/api/settings", { method: "GET", secFetchSite: "cross-site" })
    );

    expect(response).toBe(mocks.nextResponse);
  });

  it("lets a caller with no Sec-Fetch-Site through — curl, the CLI, another agent", async () => {
    const response = await proxy(edgeRequest("/api/settings"));

    expect(response).toBe(mocks.nextResponse);
  });

  it("exempts the SAML assertion consumer — an IdP posts cross-site by protocol", async () => {
    const response = await proxy(
      edgeRequest("/api/auth/saml/acs", { secFetchSite: "cross-site" })
    );

    expect(response).toBe(mocks.nextResponse);
  });

  it("exempts the OIDC callback — form_post arrives cross-site by protocol", async () => {
    const response = await proxy(
      edgeRequest("/api/auth/oidc/callback", { secFetchSite: "cross-site" })
    );

    expect(response).toBe(mocks.nextResponse);
  });

  it("leaves the public LLM surface alone — browser clients call it cross-origin on purpose", async () => {
    // Loopback-stamped exactly as custom-server.js delivers it: the contract is
    // that the LOCK lets this through to the LLM branch rather than answering 403
    // itself. (Unstamped it would still pass the lock, then fail the LLM branch's
    // own key check — a different seam, and not what this case is pinning.)
    const response = await proxy(
      edgeRequest("/v1/chat/completions", {
        secFetchSite: "cross-site",
        extra: { "x-9r-peer-token": PEER_TOKEN, "x-9r-real-ip": "127.0.0.1" },
      })
    );

    expect(response).toBe(mocks.nextResponse);
  });
});
