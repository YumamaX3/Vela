// M0 Tag 3 — the login route after DEFAULT_PASSWORD retirement.
//
// Contract under test:
//  - the retired "123456" default never authenticates (any origin)
//  - INITIAL_PASSWORD env and stored-hash paths are unchanged
//  - no password configured anywhere → loopback keeps its frictionless
//    operator posture; non-loopback is refused with the honest 403 message
//    that names the setting path (never falls open)
// The limiter store is the REAL module (reset between tests) so the route's
// wiring of lockout / rate-limit / IP keying is exercised end to end.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import bcrypt from "bcryptjs";

const PEER_TOKEN = "peer-token-fixture";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init) => ({ status: init?.status || 200, body, init })),
  cookies: vi.fn(),
  getSettings: vi.fn(),
  validateApiKey: vi.fn(),
  getConsistentMachineId: vi.fn(),
  verifyDashboardAuthToken: vi.fn(),
  setDashboardAuthCookie: vi.fn(),
  isOidcConfigured: vi.fn(),
  isSamlConfigured: vi.fn(),
  // The credential store (migration 017). Mocked here for TWO reasons, and the
  // second is not optional: (1) this suite is about the door's credential
  // ARITHMETIC, not the row's persistence — the row is proven in
  // auth-users-repo-017.test.js against a real migrated harbour; (2) without the
  // mock the door opens the operator's REAL database (this suite sets no
  // DATA_DIR), so every case here would read — and the seed would WRITE — into
  // the machine's own data dir. An empty in-memory store is the honest default.
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

const { POST } = await import("../../src/app/api/auth/login/route.js");
const { NO_PASSWORD_REMOTE_MESSAGE } = await import("../../src/lib/auth/loginMessages.js");
const { resetForTests } = await import("../../src/lib/auth/loginLimiter.js");

const originalNodeEnv = process.env.NODE_ENV;

// A request stamped by custom-server.js from a loopback socket.
function loopbackRequest(password) {
  return {
    headers: new Headers({
      host: "localhost:32060",
      "x-9r-real-ip": "127.0.0.1",
      "x-9r-peer-token": PEER_TOKEN,
      "content-type": "application/json",
    }),
    json: async () => ({ password }),
  };
}

// A remote request — no peer stamp, so x-9r-real-ip (if present) is
// attacker-supplied and must not be trusted.
function remoteRequest(password, extraHeaders = {}) {
  return {
    headers: new Headers({
      host: "203.0.113.9:32060",
      "x-9r-real-ip": "203.0.113.9",
      "content-type": "application/json",
      ...extraHeaders,
    }),
    json: async () => ({ password }),
  };
}

describe("POST /api/auth/login — Tag 3 (default password retired)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetForTests();
    process.env.NODE_ENV = "production";
    process.env.VELA_PEER_TOKEN = PEER_TOKEN;
    delete process.env.INITIAL_PASSWORD;
    delete process.env.TRUST_PROXY;
    mocks.cookies.mockResolvedValue({ set: vi.fn(), get: vi.fn(() => undefined) });
    mocks.isOidcConfigured.mockReturnValue(false);
    mocks.isSamlConfigured.mockReturnValue(false);
    // An empty, readable store: the seed's count guard sees no crew, so a
    // legacy mirror or INITIAL_PASSWORD is adopted exactly as it was before
    // this wave. (A readable store that MATCHED no seat is a different state —
    // it must NOT be rescued by the mirror, and that contract is pinned in the
    // credential-store suite.)
    mocks.listUsers.mockResolvedValue([]);
    mocks.countUsers.mockResolvedValue(0);
    mocks.createUser.mockImplementation(async (u) => ({
      ...u,
      disabledAt: null,
      lastLoginAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }));
    mocks.setUserPassword.mockResolvedValue(true);
    mocks.touchUserLogin.mockResolvedValue(true);
    mocks.deleteAllUsers.mockResolvedValue(0);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    delete process.env.VELA_PEER_TOKEN;
    delete process.env.INITIAL_PASSWORD;
    delete process.env.TRUST_PROXY;
  });

  describe("no password configured anywhere (no stored hash, no INITIAL_PASSWORD)", () => {
    beforeEach(() => {
      mocks.getSettings.mockResolvedValue({});
    });

    it("loopback keeps its frictionless operator posture — no credential needed", async () => {
      const response = await POST(loopbackRequest(undefined));

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mocks.setDashboardAuthCookie).toHaveBeenCalledTimes(1);
    });

    it("loopback entry works with any submitted password (nothing is compared)", async () => {
      const response = await POST(loopbackRequest("anything at all"));

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it("non-loopback login is refused with an honest 403 naming the setting path", async () => {
      const response = await POST(remoteRequest("anything"));

      expect(response.status).toBe(403);
      expect(response.body.error).toBe(NO_PASSWORD_REMOTE_MESSAGE);
      expect(response.body.error).toContain("INITIAL_PASSWORD");
      expect(response.body.error).toContain("Profile → Security");
      expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
    });

    it("never falls open for a spoofed loopback stamp (remote origin claiming 127.0.0.1)", async () => {
      const spoofed = remoteRequest("anything", { "x-9r-real-ip": "127.0.0.1" });

      const response = await POST(spoofed);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe(NO_PASSWORD_REMOTE_MESSAGE);
    });
  });

  describe("the retired default never authenticates", () => {
    it("123456 does not open a stored-hash install from any origin", async () => {
      mocks.getSettings.mockResolvedValue({ password: bcrypt.hashSync("real-secret", 4) });

      expect((await POST(remoteRequest("123456"))).status).toBe(401);
      expect((await POST(loopbackRequest("123456"))).status).toBe(401);
    });

    it("123456 does not open an INITIAL_PASSWORD install", async () => {
      process.env.INITIAL_PASSWORD = "env-secret";
      mocks.getSettings.mockResolvedValue({});

      expect((await POST(remoteRequest("123456"))).status).toBe(401);
      expect((await POST(loopbackRequest("123456"))).status).toBe(401);
    });

    it("123456 does not open an unconfigured install remotely (403 refusal, not a guess hit)", async () => {
      mocks.getSettings.mockResolvedValue({});

      const response = await POST(remoteRequest("123456"));

      expect(response.status).toBe(403);
      expect(response.body.error).toBe(NO_PASSWORD_REMOTE_MESSAGE);
    });
  });

  describe("configured-password paths are unchanged", () => {
    it("INITIAL_PASSWORD env still authenticates", async () => {
      process.env.INITIAL_PASSWORD = "env-secret";
      mocks.getSettings.mockResolvedValue({});

      const ok = await POST(remoteRequest("env-secret"));
      expect(ok.status).toBe(200);
      expect(ok.body.success).toBe(true);
      expect(mocks.setDashboardAuthCookie).toHaveBeenCalled();

      const bad = await POST(remoteRequest("wrong"));
      expect(bad.status).toBe(401);
    });

    it("the stored-hash (bcrypt) path still authenticates", async () => {
      mocks.getSettings.mockResolvedValue({ password: bcrypt.hashSync("s3cret-pass", 4) });

      const ok = await POST(remoteRequest("s3cret-pass"));
      expect(ok.status).toBe(200);
      expect(ok.body.success).toBe(true);

      const bad = await POST(remoteRequest("other-pass"));
      expect(bad.status).toBe(401);
    });

    it("a stored hash outranks INITIAL_PASSWORD when both exist", async () => {
      process.env.INITIAL_PASSWORD = "env-secret";
      mocks.getSettings.mockResolvedValue({ password: bcrypt.hashSync("s3cret-pass", 4) });

      expect((await POST(remoteRequest("s3cret-pass"))).status).toBe(200);
      expect((await POST(remoteRequest("env-secret"))).status).toBe(401);
    });
  });
});

describe("POST /api/auth/login — the seat outranks the mirror (username, migration 017)", () => {
  const seatHash = bcrypt.hashSync("seat-pass", 4);
  const seat = {
    id: "u-op",
    username: "operator",
    passwordHash: seatHash,
    disabledAt: null,
    lastLoginAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  /** A remote caller carrying a username and a password — the post-017 shape. */
  function credentialRequest(username, password) {
    return {
      headers: new Headers({
        host: "203.0.113.9:32060",
        "x-9r-real-ip": "203.0.113.9",
        "content-type": "application/json",
      }),
      json: async () => ({ username, password }),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resetForTests();
    process.env.NODE_ENV = "production";
    process.env.VELA_PEER_TOKEN = PEER_TOKEN;
    delete process.env.INITIAL_PASSWORD;
    delete process.env.TRUST_PROXY;
    mocks.cookies.mockResolvedValue({ set: vi.fn(), get: vi.fn(() => undefined) });
    mocks.isOidcConfigured.mockReturnValue(false);
    mocks.isSamlConfigured.mockReturnValue(false);
    // A readable store holding exactly one seat.
    mocks.listUsers.mockResolvedValue([seat]);
    mocks.countUsers.mockResolvedValue(1);
    mocks.createUser.mockResolvedValue(null);
    mocks.setUserPassword.mockResolvedValue(true);
    mocks.touchUserLogin.mockResolvedValue(true);
    mocks.deleteAllUsers.mockResolvedValue(0);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    delete process.env.VELA_PEER_TOKEN;
    delete process.env.INITIAL_PASSWORD;
    delete process.env.TRUST_PROXY;
  });

  it("the seat's own username + password opens, and the login is stamped", async () => {
    mocks.getSettings.mockResolvedValue({});

    const ok = await POST(credentialRequest("operator", "seat-pass"));
    expect(ok.status).toBe(200);
    expect(ok.body.success).toBe(true);
    expect(mocks.setDashboardAuthCookie).toHaveBeenCalledTimes(1);
    expect(mocks.touchUserLogin).toHaveBeenCalledWith("u-op", expect.any(String));
  });

  it("the seat's hash wins over a different stored mirror", async () => {
    // Both a seat and a mirror exist, and they disagree. The row is the
    // authority: its password opens, the mirror's does not.
    mocks.getSettings.mockResolvedValue({ password: bcrypt.hashSync("mirror-pass", 4) });

    expect((await POST(credentialRequest("operator", "seat-pass"))).status).toBe(200);
    expect((await POST(credentialRequest("operator", "mirror-pass"))).status).toBe(401);
  });

  it("an unknown username against a readable, non-empty store is refused — the mirror never rescues it", async () => {
    // The whole point of the wave: a store that READ and matched no seat means
    // the NAME is wrong. Letting the mirror rescue it would authenticate any
    // username against one hash.
    mocks.getSettings.mockResolvedValue({ password: bcrypt.hashSync("mirror-pass", 4) });

    const wrongName = await POST(credentialRequest("intruder", "mirror-pass"));
    expect(wrongName.status).toBe(401);

    const alsoWrong = await POST(credentialRequest("intruder", "seat-pass"));
    expect(alsoWrong.status).toBe(401);
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
  });

  it("a wrong password for the right username is refused without a stamp", async () => {
    mocks.getSettings.mockResolvedValue({});

    const bad = await POST(credentialRequest("operator", "not-the-pass"));
    expect(bad.status).toBe(401);
    expect(mocks.touchUserLogin).not.toHaveBeenCalled();
  });
});
