// Auth Hardening W1 — error hygiene at the gate.
//
// Contract under test: /api/auth/login is a PUBLIC path and
// /api/auth/reset-password is reachable from the same untrusted direction, so an
// internal failure must never echo its own shape back to the caller. The detail
// goes to the log — where consoleLogBuffer keeps it visible to the operator on
// the dashboard's console-log page — and the caller receives one stable,
// non-revealing line.
//
// Both are proven by forcing the real handler down its catch branch through the
// real store seam, then asserting the offending string is ABSENT from the body.
// A test that only asserted the stable message could pass while the detail
// leaked through some other field; the substring assertions close that gap.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const PEER_TOKEN = "peer-token-fixture";
const INTERNAL_DETAIL = "SQLITE_ERROR: no such table: authFailures";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init) => ({ status: init?.status || 200, body, init })),
  cookies: vi.fn(),
  getSettings: vi.fn(),
  validateApiKey: vi.fn(),
  updateSettings: vi.fn(),
  getConsistentMachineId: vi.fn(),
  verifyDashboardAuthToken: vi.fn(),
  setDashboardAuthCookie: vi.fn(),
  isOidcConfigured: vi.fn(),
  isSamlConfigured: vi.fn(),
  // The credential store (migration 017). Mocked for isolation: the login route
  // reads the store on its happy path, and reset-password now calls
  // deleteAllUsers() BEFORE updateSettings — so with the real repo bound, this
  // suite would open (and the reset case would WIPE) the operator's real
  // harbour. The store's persistence is proven in auth-users-repo-017.test.js.
  listUsers: vi.fn(),
  countUsers: vi.fn(),
  createUser: vi.fn(),
  setUserPassword: vi.fn(),
  touchUserLogin: vi.fn(),
  deleteAllUsers: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: mocks.json,
    next: vi.fn(() => Symbol("next")),
    redirect: vi.fn((url) => ({ status: 307, url })),
  },
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  validateApiKey: mocks.validateApiKey,
  updateSettings: mocks.updateSettings,
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: mocks.getConsistentMachineId,
}));

vi.mock("@/lib/auth/dashboardSession", () => ({
  verifyDashboardAuthToken: mocks.verifyDashboardAuthToken,
  setDashboardAuthCookie: mocks.setDashboardAuthCookie,
  AUTH_COOKIE_NAME: "vela_auth_token",
}));

vi.mock("@/lib/auth/oidc", () => ({ isOidcConfigured: mocks.isOidcConfigured }));
vi.mock("@/lib/auth/saml.js", () => ({ isSamlConfigured: mocks.isSamlConfigured }));

// Every name @/lib/auth/users.js imports must exist on the factory, or the
// static import fails before a case runs.
vi.mock("@/lib/db/repos/usersRepo.js", () => ({
  listUsers: mocks.listUsers,
  countUsers: mocks.countUsers,
  createUser: mocks.createUser,
  setUserPassword: mocks.setUserPassword,
  touchUserLogin: mocks.touchUserLogin,
  deleteAllUsers: mocks.deleteAllUsers,
}));

const { POST: login } = await import("../../src/app/api/auth/login/route.js");
const { POST: resetPassword } = await import(
  "../../src/app/api/auth/reset-password/route.js"
);
const { resetForTests } = await import("../../src/lib/auth/loginLimiter.js");

const originalNodeEnv = process.env.NODE_ENV;

// A remote caller — no peer stamp, so any x-9r-real-ip is attacker-supplied and
// must not be trusted. The store failure lands before any trust decision.
function remoteRequest(password) {
  return {
    headers: new Headers({
      host: "203.0.113.9:32060",
      "x-9r-real-ip": "203.0.113.9",
      "content-type": "application/json",
    }),
    json: async () => ({ password }),
  };
}

describe("auth error hygiene — an internal failure never narrates itself", () => {
  let errorSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    resetForTests();
    process.env.NODE_ENV = "production";
    process.env.VELA_PEER_TOKEN = PEER_TOKEN;
    delete process.env.INITIAL_PASSWORD;
    mocks.cookies.mockResolvedValue({ set: vi.fn(), get: vi.fn(() => undefined) });
    mocks.isOidcConfigured.mockReturnValue(false);
    mocks.isSamlConfigured.mockReturnValue(false);
    // An empty, readable store: the reset case's deleteAllUsers resolves (its
    // job is to be the FIRST call, and the suite's failing dependency is
    // updateSettings, not the store), and the login case's store read is
    // never reached — getSettings rejects first.
    mocks.listUsers.mockResolvedValue([]);
    mocks.countUsers.mockResolvedValue(0);
    mocks.createUser.mockResolvedValue(null);
    mocks.setUserPassword.mockResolvedValue(true);
    mocks.touchUserLogin.mockResolvedValue(true);
    mocks.deleteAllUsers.mockResolvedValue(0);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    delete process.env.VELA_PEER_TOKEN;
    delete process.env.INITIAL_PASSWORD;
    errorSpy.mockRestore();
  });

  it("login: a store failure answers one stable line, and the detail stays in the log", async () => {
    mocks.getSettings.mockRejectedValue(new Error(INTERNAL_DETAIL));

    const response = await login(remoteRequest("whatever"));

    expect(response.status).toBe(500);
    expect(response.body.error).toBe("Login failed. Check the server logs.");
    expect(JSON.stringify(response.body)).not.toContain(INTERNAL_DETAIL);
    expect(JSON.stringify(response.body)).not.toContain("SQLITE_ERROR");
    // The remedy, not merely the redaction — the operator still receives it.
    expect(errorSpy).toHaveBeenCalledWith(
      "[auth/login] unexpected failure:",
      INTERNAL_DETAIL
    );
  });

  it("reset-password: a store failure answers one stable line, and the detail stays in the log", async () => {
    mocks.updateSettings.mockRejectedValue(new Error(INTERNAL_DETAIL));

    const response = await resetPassword();

    expect(response.status).toBe(500);
    expect(response.body.error).toBe(
      "Could not reset the password. Check the server logs."
    );
    expect(JSON.stringify(response.body)).not.toContain(INTERNAL_DETAIL);
    expect(errorSpy).toHaveBeenCalledWith(
      "[auth/reset-password] unexpected failure:",
      INTERNAL_DETAIL
    );
  });
});
