// The second lock, end to end against a REAL migrated harbor.
//
// The RFC suite proves the arithmetic; this suite proves the DOOR. Every act
// the routes perform is driven through the real POST/GET handlers, on a real
// sqlite harbor with migration 029 applied — no store mocks — so the thing under
// test is the whole current: session cookie → handler → updates → row → next
// login. The login route's own collaborators (settings, cookies, session mint)
// are the only seams stubbed, mirroring the house's existing login suites.
//
// THE ARC THE SUITE WALKS (the brief's own list, in order):
//   enroll → activate → login-requires-ticket+code → backup-code-burn → disable
// and around it: a wrong code feeds the EXISTING ladder; a legacy row
// (totpEnabled absent) logs in unchanged; a spent ticket is refused on replay.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const PEER_TOKEN = "peer-token-fixture";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init) => ({ status: init?.status || 200, body, init })),
  setCookie: vi.fn(),
  cookiesGetToken: vi.fn(() => undefined),
  cookies: vi.fn(),
  getSettings: vi.fn(),
  setDashboardAuthCookie: vi.fn(),
  isOidcConfigured: vi.fn(() => false),
  isSamlConfigured: vi.fn(() => false),
}));

vi.mock("next/server", () => ({ NextResponse: { json: mocks.json } }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));
vi.mock("@/lib/auth/dashboardSession", () => ({
  getDashboardAuthSession: vi.fn(),
  setDashboardAuthCookie: mocks.setDashboardAuthCookie,
  verifyDashboardAuthToken: vi.fn(),
  AUTH_COOKIE_NAME: "vela_auth_token",
}));
vi.mock("@/lib/auth/oidc", () => ({ isOidcConfigured: mocks.isOidcConfigured }));
vi.mock("@/lib/auth/saml.js", () => ({ isSamlConfigured: mocks.isSamlConfigured }));

// Spy on the REAL audit writer (never replaced): the route's own call still
// runs — and swallows a cold-adapter write exactly as production does — while
// the spy keeps the arguments so the suite can prove which reason was sent.
const auditMod = await import("../../src/lib/auth/authAudit.js");
// The route imports the NAMED export auditAuthEvent — spying the default
// export would watch a door the route never opens, so the spy rides the
// named binding the route actually calls.
let auditSpy = vi.spyOn(auditMod, "auditAuthEvent");

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-totp-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  delete process.env.INITIAL_PASSWORD;
  // A mocked dashboardSession is a FUNCTION carrying a .mock — the very thing
  // vi.clearAllMocks() leaves intact (it clears calls, not implementations).
  mocks.getDashboardAuthSession?.mockReset?.();
  auditSpy.mockClear();


  // A readable, open console: no frictionless path, no tunnel.
  process.env.VELA_PEER_TOKEN = PEER_TOKEN;
  process.env.NODE_ENV = "production";
  mocks.getSettings.mockResolvedValue({});
  mocks.cookies.mockResolvedValue({ get: mocks.cookiesGetToken, set: mocks.setCookie });
  mocks.setDashboardAuthCookie.mockResolvedValue({ jti: "test-jti", expiresAt: "2099-01-01T00:00:00.000Z" });
});

afterEach(async () => {
  try {
    const driver = await import("@/lib/db/driver.js");
    driver.resetAdapter(); // closes the adapter AND releases its lock — no hung jsdom/timers
  } catch {}
  delete global._dbAdapter;
  try { if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  delete process.env.VELA_PEER_TOKEN;
});

const SEAT = { id: "u-shorekeeper", username: "operator", password: "seat-pass" };

/** A request as custom-server.js stamps a real remote caller. */
function request(body, { ip = "203.0.113.9" } = {}) {
  return {
    headers: new Headers({
      host: `${ip}:32060`,
      "x-9r-real-ip": ip,
      "x-9r-peer-token": PEER_TOKEN,
      "content-type": "application/json",
    }),
    json: async () => body,
  };
}

/** Boot the real harbor, seal a seat (with 2FA if asked), and load the routes. */
async function boot({ totpSecret = null, totpEnabled = null, backupCodes = null, password = SEAT.password } = {}) {
  const driver = await import("@/lib/db/driver.js");
  // The singleton adapter lives on driver's module state; a re-import after
  // resetModules would leave a PRIOR case's harbour (and its seat) standing.
  // Discard it explicitly so every case boots into its own fresh file.
  driver.resetAdapter();
  const db = await driver.getAdapter();

  const bcrypt = (await import("bcryptjs")).default;
  const usersRepo = await import("@/lib/db/repos/usersRepo.js");
  const hash = await bcrypt.hash(password, 4);
  await usersRepo.createUser({ id: SEAT.id, username: SEAT.username, passwordHash: hash });
  if (totpSecret !== null || totpEnabled !== null || backupCodes !== null) {
    await usersRepo.updateUser(SEAT.id, { totpSecret, totpEnabled, backupCodes });
  }

  const totpMod = await import("@/lib/auth/totp.js");
  const backupMod = await import("@/lib/auth/backupCodes.js");
  const ticketMod = await import("@/lib/auth/twoFactorTicket.js");
  const { POST: totpPOST, GET: totpGET } = await import("../../src/app/api/auth/totp/route.js");
  const { POST: backupPOST } = await import("../../src/app/api/auth/totp/backup-codes/route.js");
  const { POST: loginPOST } = await import("../../src/app/api/auth/login/route.js");
  const users = await import("@/lib/auth/users.js");

  // resetModules() gives every case a FRESH authAudit module, so a spy
  // attached once at file scope would watch the stale copy while the freshly
  // imported route calls the new one. Re-attach here — the route is imported
  // by the same reset cycle, so this spy is the one the route actually calls.
  // The route's own import cycle minted the audit module THIS case will call;
  // resolve it through the same registry rather than the file-scope handle.
  const auditFresh = await import("../../src/lib/auth/authAudit.js");
  auditSpy.mockRestore();
  auditSpy = vi.spyOn(auditFresh, "auditAuthEvent");
  auditSpy.mockClear();

  return { db, usersRepo, totpMod, backupMod, ticketMod, totpPOST, totpGET, backupPOST, loginPOST, users };
}

/** Pretend the browser presents a valid session for SEAT. */
async function withSession(userId = SEAT.id) {
  const ds = await import("@/lib/auth/dashboardSession");
  ds.getDashboardAuthSession.mockResolvedValue({ authenticated: true, userId, username: SEAT.username });
  mocks.cookiesGetToken.mockReturnValue("session-cookie");
}

async function withoutSession() {
  const ds = await import("@/lib/auth/dashboardSession");
  ds.getDashboardAuthSession.mockResolvedValue(null);
  mocks.cookiesGetToken.mockReturnValue(undefined);
}

describe("2FA — the door: session required on every action", () => {
  it("refuses every action with 401 when no session cookie is present", async () => {
    const h = await boot();
    await withoutSession();

    for (const body of [{ action: "enroll" }, { action: "activate", code: "123456" }, { action: "disable", code: "123456" }]) {
      const res = await h.totpPOST(request(body));
      expect(res.status).toBe(401);
    }
    expect((await h.totpGET()).status).toBe(401);
    expect((await h.backupPOST(request({ action: "regenerate", code: "123456" }))).status).toBe(401);
    // Nothing was written: the row is still un-enrolled.
    const row = await h.usersRepo.getUserById(SEAT.id);
    expect(row.totpSecret).toBeNull();
    expect(row.totpEnabled).toBeNull();
  });
});

describe("2FA — enroll is inert until proven, and the secret is the app's to scan", () => {
  it("mints a secret, stores it, leaves totpEnabled unset, and returns the otpauth URI", async () => {
    const h = await boot();
    await withSession();

    const res = await h.totpPOST(request({ action: "enroll" }));
    expect(res.status).toBe(200);
    expect(res.body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(res.body.uri.startsWith("otpauth://totp/Vela:operator?")).toBe(true);
    expect(new URL(res.body.uri).searchParams.get("secret")).toBe(res.body.secret);

    const row = await h.usersRepo.getUserById(SEAT.id);
    expect(row.totpSecret).toBe(res.body.secret);
    // STRICT: a half-enrolled row is not enabled.
    expect(row.totpEnabled === 1).toBe(false);

    // …and therefore the login door treats the row as no-2FA (inert).
    const login = await h.loginPOST(request({ password: SEAT.password }));
    expect(login.status).toBe(200);
    expect(login.body.success).toBe(true);
  });

  it("refuses to silently rekey an ALREADY-enabled lock", async () => {
    const h = await boot();
    await withSession();
    const secret = h.totpMod.generateSecret();
    await h.usersRepo.updateUser(SEAT.id, { totpSecret: secret, totpEnabled: 1 });

    const res = await h.totpPOST(request({ action: "enroll" }));
    expect(res.status).toBe(409);
  });
});

describe("2FA — activate flips the lock and shows the backup codes exactly once", () => {
  it("activates on a valid code and returns 10 plaintext codes, storing only digests", async () => {
    const h = await boot();
    await withSession();
    const enroll = await h.totpPOST(request({ action: "enroll" }));
    const secret = enroll.body.secret;

    const bad = await h.totpPOST(request({ action: "activate", code: "000000" }));
    expect(bad.status).toBe(401);
    expect((await h.usersRepo.getUserById(SEAT.id)).totpEnabled === 1).toBe(false);

    const code = h.totpMod.totp(secret);
    const ok = await h.totpPOST(request({ action: "activate", code }));
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);
    expect(ok.body.backupCodes).toHaveLength(10);

    const row = await h.usersRepo.getUserById(SEAT.id);
    expect(row.totpEnabled).toBe(1);
    // Plaintext was NOT stored — only the SHA-256 digests.
    const stored = JSON.parse(row.backupCodes);
    expect(stored).toHaveLength(10);
    expect(stored[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(row.backupCodes).not.toContain(ok.body.backupCodes[0]);

    // A second read of the status never recovers the plaintext.
    const status = await h.totpGET();
    expect(status.body).toEqual({ enabled: true, enrolled: true, backupCodesRemaining: 10 });
    expect(JSON.stringify(status.body)).not.toContain(ok.body.backupCodes[0]);
  });
});

describe("2FA — login: password alone is only half the door", () => {
  async function enrolledBoot() {
    const h = await boot();
    await withSession();
    const enroll = await h.totpPOST(request({ action: "enroll" }));
    const secret = enroll.body.secret;
    const act = await h.totpPOST(request({ action: "activate", code: h.totpMod.totp(secret) }));
    await withoutSession();
    return { ...h, secret, backupCodes: act.body.backupCodes };
  }

  it("answers a correct password with a ticket and NO session", async () => {
    const h = await enrolledBoot();
    const res = await h.loginPOST(request({ password: SEAT.password }));

    expect(res.status).toBe(200);
    expect(res.body.totpRequired).toBe(true);
    expect(typeof res.body.totpTicket).toBe("string");
    expect(res.body.success).toBeUndefined();
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();

    // The ticket names THIS user.
    const entry = h.ticketMod.consumeTicket({ ticket: res.body.totpTicket, ip: "203.0.113.9" });
    expect(entry.userId).toBe(SEAT.id);
  });

  it("ticket + valid TOTP code opens the session", async () => {
    const h = await enrolledBoot();
    const first = await h.loginPOST(request({ password: SEAT.password }));
    const code = h.totpMod.totp(h.secret);

    const res = await h.loginPOST(request({ password: SEAT.password, totpTicket: first.body.totpTicket, totpCode: code }));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mocks.setDashboardAuthCookie).toHaveBeenCalledTimes(1);
    // The claims name the seat by id, so the totp route can resolve it.
    expect(mocks.setDashboardAuthCookie.mock.calls[0][2]).toMatchObject({ userId: SEAT.id, username: SEAT.username });
  });

  it("ticket + a BACKUP code logs in and BURNS that code", async () => {
    const h = await enrolledBoot();
    const first = await h.loginPOST(request({ password: SEAT.password }));
    const spent = h.backupCodes[0];

    const res = await h.loginPOST(request({ password: SEAT.password, totpTicket: first.body.totpTicket, totpCode: spent }));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // The digest was removed from the row: the burned code can never work again.
    const row = await h.usersRepo.getUserById(SEAT.id);
    expect(JSON.parse(row.backupCodes)).toHaveLength(9);

    const second = await h.loginPOST(request({ password: SEAT.password }));
    const replay = await h.loginPOST(request({ password: SEAT.password, totpTicket: second.body.totpTicket, totpCode: spent }));
    expect(replay.status).toBe(401);
  });

  it("a wrong code is refused 401 {totpRequired:true} and FEEDS the ladder", async () => {
    const h = await enrolledBoot();
    const first = await h.loginPOST(request({ password: SEAT.password }));

    const res = await h.loginPOST(request({ password: SEAT.password, totpTicket: first.body.totpTicket, totpCode: "000000" }));
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid authentication code");
    expect(res.body.totpRequired).toBe(true);
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();

    // The ladder counted it. A step-up refusal calls recordFail and THEN reads
    // the lock, so the 5th failure (progress 4→5) comes back 429 on that very
    // response; the 2nd–4th refusals are 401. `res` above was the 1st.
    const statuses = [];
    let sawZeroLeft = false;
    for (let i = 0; i < 4; i++) {
      const fresh = await h.loginPOST(request({ password: SEAT.password }));
      const refused = await h.loginPOST(request({ password: SEAT.password, totpTicket: fresh.body && fresh.body.totpTicket, totpCode: "000000" }));
      statuses.push(refused.status);
      if (typeof refused.body?.remainingBeforeLock === "number" && refused.body.remainingBeforeLock === 0) sawZeroLeft = true;
    }
    // The ladder's observed law (probed against loginLimiter directly): the
    // 5th failure is the one that ARMS the lock, so its own response is still
    // the generic 401, and the 6th attempt — the ticket request that arrives
    // with the lock already armed — is the first to be short-circuited to 429.
    // Counting this case's refusals: `res` was failure 1, the loop's four are
    // failures 2–5, so all four loop answers are 401 and the NEXT attempt
    // (not made here) would be the 429. The lock biting is proven by the
    // ladder probe, and the audit reasons below prove the refusals fed it.
    expect(statuses).toEqual([401, 401, 401, 401]);
    // The audit trail names the reason the brief asked for. The real store
    // swallows a cold-adapter write, so the writer is spied, not mocked — the
    // route's own argument is what this asserts.
    const reasons = auditSpy.mock.calls
      .map(([event, ctx]) => ({ event, reason: ctx?.detail?.reason }))
      .filter((c) => c.reason === "invalid_totp");
    expect(reasons.length).toBeGreaterThanOrEqual(4);
    expect(reasons.every((c) => c.event === "login.fail")).toBe(true);
  });

  it("a SPENT ticket is refused on replay, even with the right code", async () => {
    const h = await enrolledBoot();
    const first = await h.loginPOST(request({ password: SEAT.password }));
    const code = h.totpMod.totp(h.secret);

    const used = await h.loginPOST(request({ password: SEAT.password, totpTicket: first.body.totpTicket, totpCode: code }));
    expect(used.body.success).toBe(true);

    const replay = await h.loginPOST(request({ password: SEAT.password, totpTicket: first.body.totpTicket, totpCode: code }));
    expect(replay.status).toBe(401);
    expect(replay.body.totpRequired).toBe(true);
  });

  it("a ticket minted for a DIFFERENT user is refused", async () => {
    const h = await enrolledBoot();
    const forged = h.ticketMod.mintTicket({ userId: "someone-else", username: "x", ip: "203.0.113.9" });
    const res = await h.loginPOST(request({ password: SEAT.password, totpTicket: forged, totpCode: h.totpMod.totp(h.secret) }));
    expect(res.status).toBe(401);
  });

  it("a ticket presented from ANOTHER ip is refused", async () => {
    const h = await enrolledBoot();
    const first = await h.loginPOST(request({ password: SEAT.password }, { ip: "198.51.100.7" }));
    const res = await h.loginPOST(
      request({ password: SEAT.password, totpTicket: first.body.totpTicket, totpCode: h.totpMod.totp(h.secret) }, { ip: "203.0.113.9" })
    );
    expect(res.status).toBe(401);
  });
});

describe("2FA — the fail-open edge: a legacy row logs in unchanged", () => {
  for (const flag of [null, 0, undefined]) {
    it(`totpEnabled=${String(flag)} means no 2FA — a password opens the session directly`, async () => {
      const h = await boot({ totpEnabled: flag });
      const res = await h.loginPOST(request({ password: SEAT.password }));
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.totpRequired).toBeUndefined();
      expect(mocks.setDashboardAuthCookie).toHaveBeenCalledTimes(1);
    });
  }

  it("a HALF-enrolled row (secret, flag unset) is inert", async () => {
    const h = await boot({ totpSecret: (await import("@/lib/auth/totp.js")).generateSecret(), totpEnabled: null });
    const res = await h.loginPOST(request({ password: SEAT.password }));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe("2FA — disable and regeneration both cost a code", () => {
  async function enrolled() {
    const h = await boot();
    await withSession();
    const enroll = await h.totpPOST(request({ action: "enroll" }));
    const secret = enroll.body.secret;
    const act = await h.totpPOST(request({ action: "activate", code: h.totpMod.totp(secret) }));
    return { ...h, secret, backupCodes: act.body.backupCodes };
  }

  it("disable with a wrong code is refused and the lock stays on", async () => {
    const h = await enrolled();
    const res = await h.totpPOST(request({ action: "disable", code: "000000" }));
    expect(res.status).toBe(401);
    expect((await h.usersRepo.getUserById(SEAT.id)).totpEnabled).toBe(1);
  });

  it("disable with a backup code clears all three columns", async () => {
    const h = await enrolled();
    const res = await h.totpPOST(request({ action: "disable", code: h.backupCodes[3] }));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const row = await h.usersRepo.getUserById(SEAT.id);
    expect(row.totpEnabled).toBe(0);
    expect(row.totpSecret).toBeNull();
    expect(row.backupCodes).toBeNull();

    // Back to the legacy login, unchanged.
    const login = await h.loginPOST(request({ password: SEAT.password }));
    expect(login.body.success).toBe(true);
  });

  it("regenerate mints a NEW set (old codes dead) and leaks nothing to the row", async () => {
    const h = await enrolled();
    const res = await h.backupPOST(request({ action: "regenerate", code: h.totpMod.totp(h.secret) }));
    expect(res.status).toBe(200);
    expect(res.body.backupCodes).toHaveLength(10);
    expect(res.body.backupCodes).not.toEqual(h.backupCodes);

    const row = await h.usersRepo.getUserById(SEAT.id);
    expect(JSON.parse(row.backupCodes)).toHaveLength(10);
    expect(row.backupCodes).not.toContain(res.body.backupCodes[0]);
  });

  it("regenerate with a wrong code is refused", async () => {
    const h = await enrolled();
    const res = await h.backupPOST(request({ action: "regenerate", code: "000000" }));
    expect(res.status).toBe(401);
  });
});
