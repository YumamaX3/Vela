// Test covenant: the login page's device label — migration 016's `label`
// column, filled from the door the operator actually uses.
//
// WHY THIS SUITE EXISTS: the ledger already accepted a label (its signature and
// its own 120-char slice were written in the auth-hardening wave) and the list
// route already returned it — but nothing ever SUPPLIED one. The password door
// passed `{ ip }` alone, so the column was born null and stayed null forever. A
// column no writer fills is indistinguishable from a column that does not
// exist, and only a proof that drives the REAL route against a REAL migrated
// harbour can tell those two apart. So the collaborators are mocked (settings,
// cookies, the mint) while the ledger, the repo and the SQLite row stay real.
//
// The load-bearing case is the sanitizer, not the plumbing: the ledger
// truncates but does NOT flatten, and a label is one line. Delete the route's
// replace() chain and case 2 reddens alone — every other assertion here stays
// green, which is exactly the blind spot this case covers.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const PEER_TOKEN = "peer-token-fixture";
const THE_LABEL = "Ryzen NAS — Chrome";
const THE_JTI = "jti-device-label";

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

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalNodeEnv = process.env.NODE_ENV;

// A request stamped by custom-server.js from a loopback socket — the shape
// isLocalRequest() trusts, and the only shape that reaches the frictionless
// door.
function stampedRequest(body) {
  return {
    headers: new Headers({
      host: "localhost:32060",
      "x-9r-real-ip": "127.0.0.1",
      "x-9r-peer-token": PEER_TOKEN,
      "content-type": "application/json",
    }),
    json: async () => body,
  };
}

/**
 * Boot a real, migrated harbour and hand back the parts the cases read.
 *
 * The route is imported HERE rather than at file scope on purpose: paths.js
 * freezes DATA_DIR at first import, so a top-level import would pin the ledger
 * to the machine's real data dir and every case would write outside its own
 * temp harbour (the DB-harness trap, in its "wrong dir" shape).
 */
async function bootHarbor() {
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  const { runMigrationOnce } = await import("@/lib/db/migrate.js");
  await runMigrationOnce(db);
  const { listAuthSessions } = await import("@/lib/db/repos/authStoreRepo.js");
  const { POST } = await import("../../src/app/api/auth/login/route.js");
  const { resetForTests } = await import("../../src/lib/auth/loginLimiter.js");
  resetForTests();
  return { POST, listAuthSessions };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-devlabel-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  process.env.NODE_ENV = "production";
  process.env.VELA_PEER_TOKEN = PEER_TOKEN;
  delete process.env.INITIAL_PASSWORD;
  mocks.cookies.mockResolvedValue({ set: vi.fn(), get: vi.fn(() => undefined) });
  mocks.isOidcConfigured.mockReturnValue(false);
  mocks.isSamlConfigured.mockReturnValue(false);
  mocks.setDashboardAuthCookie.mockResolvedValue({
    jti: THE_JTI,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  try { if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  process.env.NODE_ENV = originalNodeEnv;
  delete process.env.VELA_PEER_TOKEN;
  delete process.env.INITIAL_PASSWORD;
});

describe("POST /api/auth/login — the operator's device label", () => {
  it("the password door records the label on the session's own ledger row", async () => {
    const { POST, listAuthSessions } = await bootHarbor();
    mocks.getSettings.mockResolvedValue({ password: bcrypt.hashSync("correct-horse-battery", 4) });

    const res = await POST(stampedRequest({ password: "correct-horse-battery", label: THE_LABEL }));

    expect(res.status).toBe(200);
    const rows = await listAuthSessions();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(THE_JTI);
    expect(rows[0].label).toBe(THE_LABEL);
  });

  it("flattens a multi-line label to one line and caps it at the ledger's 120 characters", async () => {
    const { POST, listAuthSessions } = await bootHarbor();
    mocks.getSettings.mockResolvedValue({ password: bcrypt.hashSync("pw", 4) });

    await POST(
      stampedRequest({ password: "pw", label: `  Ryzen\nNAS\t—  Chrome  ${"x".repeat(200)}` })
    );

    const [row] = await listAuthSessions();
    expect(row.label.slice(0, 18)).toBe("Ryzen NAS — Chrome");
    expect(row.label).not.toMatch(/[\n\t]/);
    expect(row.label).toHaveLength(120);
  });

  it("records no label when the operator offers none — never a fabricated name", async () => {
    const { POST, listAuthSessions } = await bootHarbor();
    mocks.getSettings.mockResolvedValue({ password: bcrypt.hashSync("pw", 4) });

    await POST(stampedRequest({ password: "pw" }));

    const [row] = await listAuthSessions();
    expect(row.label).toBeNull();
  });

  it("the frictionless loopback door carries the label too", async () => {
    const { POST, listAuthSessions } = await bootHarbor();
    // No stored hash and no INITIAL_PASSWORD: the loopback door is the only
    // door left, and it mints a session all the same.
    mocks.getSettings.mockResolvedValue({});

    const res = await POST(stampedRequest({ label: THE_LABEL }));

    expect(res.status).toBe(200);
    const [row] = await listAuthSessions();
    expect(row.id).toBe(THE_JTI);
    expect(row.label).toBe(THE_LABEL);
  });
});
