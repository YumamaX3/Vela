// tests/unit/api-mutation-locality.test.js — C1 MEND (full-deep audit,
// 2026-10-11). The deny-by-default /api/* branch used to pass EVERY method to
// ANY remote origin when requireLogin===false — and the settings route's
// first-password branch (no currentPassword required when no hash is stored)
// let an unauthenticated remote PATCH mint the operator's dashboard password.
//
// The mend extends the §5.1 proxy-pools law to the whole prefix BY CLASS:
// a mutation (POST/PUT/PATCH/DELETE) needs a real credential (JWT) or the
// box's own console (loopback stamp + posture, or the local CLI token).
// Reads keep the posture-consistent pass — the documented no-login dashboard
// stays readable. "peer-token-fixture" and every other literal here is an
// EXAMPLE fixture, never a credential.
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
const PEER_TOKEN = "peer-token-fixture"; // EXAMPLE fixture

function req(pathname, { method = "GET", host = "localhost:32060", headers = {} } = {}) {
  return {
    method,
    nextUrl: { pathname, searchParams: new URL(`http://localhost${pathname}`).searchParams },
    headers: new Headers({ host, ...headers }),
    cookies: { get: vi.fn(() => undefined) },
    url: `http://localhost${pathname}`,
  };
}
// Stamped by custom-server.js: loopback peer proven by the per-process secret.
const LOCAL_STAMP = { "x-9r-peer-token": PEER_TOKEN, "x-9r-real-ip": "127.0.0.1" };

describe("C1 — /api/* mutations are fail-closed by class (locality or credential)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VELA_PEER_TOKEN = PEER_TOKEN;
    // The no-login posture — the widest surface the old hole lived in.
    mocks.getSettings.mockResolvedValue({ requireLogin: false });
    mocks.validateApiKey.mockResolvedValue(true);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
  });

  it("refuses an unauthenticated remote PATCH to /api/settings even at requireLogin:false", async () => {
    const response = await proxy(req("/api/settings", { method: "PATCH", host: "router.example.com" }));
    expect(response.status).toBe(401);
    expect(String(response.body.error)).toMatch(/mutating/i);
  });

  it("refuses an unauthenticated remote POST to /api/providers even at requireLogin:false", async () => {
    const response = await proxy(req("/api/providers", { method: "POST", host: "router.example.com" }));
    expect(response.status).toBe(401);
  });

  it("admits the same PATCH from the box's own console (loopback stamp + posture)", async () => {
    const response = await proxy(req("/api/settings", { method: "PATCH", headers: LOCAL_STAMP }));
    expect(response).toBe(mocks.nextResponse);
  });

  it("admits a remote PATCH carrying a valid dashboard JWT", async () => {
    mocks.verifyDashboardAuthToken.mockResolvedValue(true);
    const response = await proxy(req("/api/settings", { method: "PATCH", host: "router.example.com" }));
    expect(response).toBe(mocks.nextResponse);
  });

  it("forbids (403) a remote caller presenting only the machine CLI token on a mutation", async () => {
    const response = await proxy(req("/api/settings", {
      method: "PATCH",
      host: "router.example.com",
      headers: { "x-vela-cli-token": "cli-token" },
    }));
    expect(response.status).toBe(403);
    expect(String(response.body.error)).toMatch(/local origins/i);
  });

  it("keeps the posture-consistent READ pass: remote GET /api/settings at requireLogin:false", async () => {
    const response = await proxy(req("/api/settings", { method: "GET", host: "router.example.com" }));
    expect(response).toBe(mocks.nextResponse);
  });

  it("public routes are untouched: remote POST /api/auth/login passes the guard", async () => {
    const response = await proxy(req("/api/auth/login", { method: "POST", host: "router.example.com" }));
    expect(response).toBe(mocks.nextResponse);
  });

  it("the public LLM surface is untouched: remote POST /v1/chat/completions with a valid key passes", async () => {
    mocks.validateApiKey.mockResolvedValue(true);
    const response = await proxy(req("/v1/chat/completions", {
      method: "POST",
      host: "router.example.com",
      headers: { authorization: "Bearer sk-valid" },
    }));
    expect(response).toBe(mocks.nextResponse);
  });
});
