// Test covenant: W2d — dashboardGuard method-aware key-write escalation.
// Key-MUTATION writes (POST/PUT/PATCH/DELETE under /api/keys) must require a
// JWT or CLI token even when requireLogin=false. Key READS stay on the
// deny-by-default posture (JWT-or-requireLogin) by construction.
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

function req(method, pathname) {
  return {
    method,
    nextUrl: { pathname, searchParams: new URL(`http://localhost${pathname}`).searchParams },
    headers: new Headers({ "x-9r-peer-token": PEER_TOKEN, "x-9r-real-ip": "127.0.0.1", host: "localhost:32060", origin: "http://localhost:32060" }),
    cookies: { get: vi.fn(() => undefined) },
    url: `http://localhost${pathname}`,
  };
}

describe("dashboardGuard key-write escalation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VELA_PEER_TOKEN = PEER_TOKEN;
    mocks.getSettings.mockResolvedValue({ requireLogin: false });
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
    mocks.validateApiKey.mockResolvedValue(false);
  });

  it("blocks POST /api/keys when requireLogin=false and no JWT/CLI", async () => {
    const res = await proxy(req("POST", "/api/keys"));
    expect(res.status).toBe(401);
  });

  it("blocks DELETE /api/keys/[id] (mutation) even without login", async () => {
    const res = await proxy(req("DELETE", "/api/keys/k1"));
    expect(res.status).toBe(401);
  });

  it("blocks POST import-mint (mutation) even without login", async () => {
    const res = await proxy(req("POST", "/api/keys/export"));
    expect(res.status).toBe(401);
  });

  it("allows POST /api/keys with a valid CLI token", async () => {
    const res = await proxy(req("POST", "/api/keys"));
    // CLI token path: getConsistentMachineId returns "cli-token" but the
    // request carries no header → 401. Re-send with the header to prove pass.
    expect(res.status).toBe(401);

    const authed = await proxy({
      ...req("POST", "/api/keys"),
      headers: new Headers({ "x-vela-cli-token": "cli-token", "x-9r-peer-token": PEER_TOKEN, "x-9r-real-ip": "127.0.0.1", host: "localhost:32060" }),
    });
    expect(authed).toBe(mocks.nextResponse);
  });

  it("allows a GET read under /api/keys without login (posture-consistent)", async () => {
    const res = await proxy(req("GET", "/api/keys"));
    // Deny-by-default branch: requireLogin=false → passes through next().
    expect(res).toBe(mocks.nextResponse);
  });

  it("allows a GET read on a nested key route without login", async () => {
    const res = await proxy(req("GET", "/api/keys/k1/activity"));
    expect(res).toBe(mocks.nextResponse);
  });
});
