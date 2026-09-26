// M0 Tag 3 — route-level wiring of the lockout ladder and the fixed-window
// rate limit through POST /api/auth/login. Injectable clock (setNow) drives
// lock/window arithmetic exactly. The REAL limiter store is used, reset
// between tests.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const PEER_TOKEN = "peer-token-fixture";
const MIN = 60_000;

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
  // The credential store (migration 017) — mocked so this suite can never open
  // the operator's REAL harbour. Without it, every case here reads (and the seed
  // WRITES) into the machine's own DATA_DIR, and vitest runs these files in
  // PARALLEL — three suites racing for one real database. The store's own
  // persistence is proven against a real migrated harbour in
  // auth-users-repo-017.test.js; this file is about the ladder's arithmetic.
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

/** An empty, readable store — the pre-017 posture, where a legacy mirror or
 *  INITIAL_PASSWORD still stands alone. (A readable store that MATCHED no seat
 *  must NOT be rescued by the mirror; that contract is pinned in the
 *  credential-store suite.) Called from BOTH describes' beforeEach, because the
 *  lockout ladder and the rate window each reset their own mocks. */
function primeEmptyStore() {
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
}

const { POST } = await import("../../src/app/api/auth/login/route.js");
const { resetForTests, setNow } = await import("../../src/lib/auth/loginLimiter.js");

const originalNodeEnv = process.env.NODE_ENV;
let now;

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

async function post(password) {
  return POST(remoteRequest(password));
}

describe("POST /api/auth/login — lockout ladder wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetForTests();
    now = 1_000_000_000_000;
    setNow(() => now);
    process.env.NODE_ENV = "production";
    process.env.VELA_PEER_TOKEN = PEER_TOKEN;
    process.env.INITIAL_PASSWORD = "env-secret";
    mocks.getSettings.mockResolvedValue({}); // configured via INITIAL_PASSWORD
    mocks.cookies.mockResolvedValue({ set: vi.fn(), get: vi.fn(() => undefined) });
    mocks.isOidcConfigured.mockReturnValue(false);
    mocks.isSamlConfigured.mockReturnValue(false);
    primeEmptyStore();
  });

  afterEach(() => {
    resetForTests();
    process.env.NODE_ENV = originalNodeEnv;
    delete process.env.VELA_PEER_TOKEN;
    delete process.env.INITIAL_PASSWORD;
  });

  it("the 5th failure returns 429 with Retry-After 60", async () => {
    for (let i = 0; i < 4; i++) {
      const r = await post("wrong");
      expect(r.status).toBe(401);
      expect(r.body.remainingBeforeLock).toBe(4 - i);
    }

    const fifth = await post("wrong");
    expect(fifth.status).toBe(429);
    expect(fifth.init.headers["Retry-After"]).toBe("60");
    expect(fifth.body.retryAfter).toBe(60);
    expect(fifth.body.resetHint).toContain("Reset Password (clear)");
  });

  it("attempts while locked get 429 without consuming the failure ladder", async () => {
    for (let i = 0; i < 5; i++) await post("wrong");

    const blocked = await post("wrong");
    expect(blocked.status).toBe(429);
    expect(blocked.body.retryAfter).toBeLessThanOrEqual(60);
    expect(blocked.body.retryAfter).toBeGreaterThan(0);

    // Still wrong password after the lock expires → ladder continues (fails
    // accumulate), it does not reset.
    now += MIN + 1;
    const sixth = await post("wrong");
    expect(sixth.status).toBe(401);
    expect(sixth.body.remainingBeforeLock).toBe(4); // next lock at 10 fails
  });

  it("a success resets the failure state", async () => {
    for (let i = 0; i < 4; i++) await post("wrong");
    const ok = await post("env-secret");
    expect(ok.status).toBe(200);

    // Fresh ladder after success: 4 more failures still below the 5 threshold.
    for (let i = 0; i < 4; i++) {
      const r = await post("wrong");
      expect(r.status).toBe(401);
    }
  });
});

describe("POST /api/auth/login — fixed-window rate limit wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetForTests();
    now = 1_000_000_000_000;
    setNow(() => now);
    process.env.NODE_ENV = "production";
    process.env.VELA_PEER_TOKEN = PEER_TOKEN;
    delete process.env.INITIAL_PASSWORD;
    // Unconfigured install + remote origin: every attempt is refused with
    // 403 and never touches the failure ladder — isolating the rate window.
    mocks.getSettings.mockResolvedValue({});
    mocks.cookies.mockResolvedValue({ set: vi.fn(), get: vi.fn(() => undefined) });
    mocks.isOidcConfigured.mockReturnValue(false);
    mocks.isSamlConfigured.mockReturnValue(false);
    primeEmptyStore();
  });

  afterEach(() => {
    resetForTests();
    process.env.NODE_ENV = originalNodeEnv;
    delete process.env.VELA_PEER_TOKEN;
    delete process.env.INITIAL_PASSWORD;
  });

  it("exhausting the window returns 429 with Retry-After; expiry clears it", async () => {
    for (let i = 0; i < 10; i++) {
      const r = await post("anything");
      expect(r.status).toBe(403); // honest refusal, not rate limited yet
    }

    const denied = await post("anything");
    expect(denied.status).toBe(429);
    expect(denied.init.headers["Retry-After"]).toBe("900");
    expect(denied.body.retryAfter).toBe(900);

    // Window expiry clears the limiter.
    now += 15 * MIN;
    const after = await post("anything");
    expect(after.status).toBe(403);
  });

  it("rate limiting is independent of the failure ladder (different counters)", async () => {
    // Ladder state alone (5 fails → locked) must not consume all 10 window
    // slots in a way that hides which gate fired: the lock check answers
    // first with its own message shape.
    process.env.INITIAL_PASSWORD = "env-secret";
    for (let i = 0; i < 5; i++) await post("wrong");

    const locked = await post("wrong");
    expect(locked.status).toBe(429);
    expect(locked.body.resetHint).toContain("Reset Password"); // lockout shape
    expect(locked.body.retryAfter).toBeLessThanOrEqual(60);
  });
});
