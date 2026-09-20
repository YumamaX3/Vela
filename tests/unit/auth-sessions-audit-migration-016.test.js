// Test covenant: auth-sessions-audit-migration-016 — the session ledger, the
// durable login-failure store, and the audit trail (Auth Hardening W1).
//
// Why this suite exists rather than "the schema looks right": migration 013's
// lesson is that a migration's real risk is the DRIVER, not the SQL. This wave
// adds three whole tables, so the questions worth answering are (a) does the
// versioned chain reach v16 on the production-crash driver, (b) can it be
// replayed without throwing, and (c) do the declared column shapes actually
// hold the values the limiter and the session ledger intend to write.
//
// ADAPTER CONTRACT under test: portable surface only — run/get/all/exec/
// transaction, NEVER a raw prepare(). The migration calls db.exec alone.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

const NATIVE_ADAPTERS = [
  "@/lib/db/adapters/betterSqliteAdapter.js",
  "@/lib/db/adapters/nodeSqliteAdapter.js",
];

/**
 * Lift the sql.js case's doMock registrations.
 *
 * The first case below mocks BOTH native adapters away to exercise the
 * production-crash driver — and vitest keeps a doMock registration for the
 * whole file, not just the case that made it. So every later "native" case fell
 * through to sql.js and returned early at its own guard, asserting nothing.
 * MEASURED 2026-09-21: the durability cases passed while the ledger's veto was
 * deleted from the source, which is what a silently-skipped proof looks like.
 */
function liftNativeAdapterMocks() {
  for (const spec of NATIVE_ADAPTERS) {
    try {
      vi.doUnmock(spec);
    } catch {}
  }
}

async function bootSqlJs() {
  delete global._dbAdapter;
  // Force the sql.js fallback exactly like migration 002's and 013's suites:
  // make the native adapters unavailable so resolveDriver lands on sql.js.
  vi.doMock("@/lib/db/adapters/betterSqliteAdapter.js", () => {
    throw new Error("simulated unavailable");
  });
  vi.doMock("@/lib/db/adapters/nodeSqliteAdapter.js", () => {
    throw new Error("simulated unavailable");
  });
  const { getAdapter } = await import("@/lib/db/driver.js");
  return getAdapter();
}

async function bootNative() {
  liftNativeAdapterMocks();
  delete global._dbAdapter;
  const { getAdapter } = await import("@/lib/db/driver.js");
  return getAdapter();
}

beforeEach(() => {
  // The DB-harness trap: paths.js freezes DATA_DIR at first import and
  // driver.js binds global._dbAdapter at module eval. Both hooks must bust the
  // module cache or a later test writes into an earlier test's deleted dir.
  vi.resetModules();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-mig016-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  try { if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

const NEW_TABLES = {
  authSessions: ["id", "createdAt", "lastSeenAt", "expiresAt", "ip", "userAgent", "label", "revokedAt", "revokedReason"],
  authFailures: ["ipKey", "fails", "tier", "lockUntil", "windowStart", "windowCount", "lastActivityAt"],
  authAuditLog: ["id", "ts", "eventType", "ip", "userAgent", "detail"],
};

const NEW_INDEXES = ["idx_as_expires", "idx_as_revoked", "idx_af_last", "idx_aal_ts", "idx_aal_event"];

describe("Migration 016 — auth sessions, durable failures, audit log", () => {
  it("sql.js adapter (production-crash driver) → chain reaches v16, all three tables exist", async () => {
    const db = await bootSqlJs();
    expect(db.driver).toBe("sql.js");

    for (const [table, cols] of Object.entries(NEW_TABLES)) {
      const found = db.all(`PRAGMA table_info(${table})`).map((c) => c.name);
      expect(found, `table ${table} should exist with its columns`).toEqual(
        expect.arrayContaining(cols)
      );
    }
  });

  it("declares every index the schema promised", async () => {
    const db = await bootSqlJs();
    const found = db
      .all(`SELECT name FROM sqlite_master WHERE type='index'`)
      .map((r) => r.name);
    for (const idx of NEW_INDEXES) expect(found).toContain(idx);
  });

  it("version coherence — SCHEMA_VERSION and the migration chain agree", async () => {
    // Catches the exact drift the count-discipline notes keep warning about:
    // a bumped version with no migration, or a migration whose version the
    // schema block never followed.
    const { SCHEMA_VERSION } = await import("@/lib/db/schema.js");
    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    expect(latestVersion()).toBe(16);
    expect(SCHEMA_VERSION).toBe(16);
  });

  it("idempotent — replaying up() against a migrated database does not throw", async () => {
    const db = await bootNative();
    if (db.driver === "sql.js") return; // heap-bound driver — case 1 covers it

    const { default: m016 } = await import("@/lib/db/migrations/016-auth-sessions-audit.js");
    expect(() => m016.up(db)).not.toThrow();

    const cols = db.all(`PRAGMA table_info(authSessions)`).map((c) => c.name);
    expect(cols).toContain("revokedAt");
  });

  it("holds the shapes the writers intend — a revoked session and a locked caller round-trip", async () => {
    const db = await bootNative();
    if (db.driver === "sql.js") return; // heap-bound driver — case 1 covers it

    const nowIso = new Date().toISOString();
    db.run(
      `INSERT INTO authSessions (id, createdAt, lastSeenAt, expiresAt, ip, userAgent, label, revokedAt, revokedReason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["jti-1", nowIso, nowIso, nowIso, "127.0.0.1", "vitest", "this device", nowIso, "logout-everywhere"]
    );
    const session = db.get(`SELECT id, revokedAt, revokedReason FROM authSessions WHERE id = ?`, ["jti-1"]);
    expect(session.revokedReason).toBe("logout-everywhere");

    // The ladder row: epoch-ms integers, with "unset" honestly NULL — the shape
    // loginLimiter.js will persist, and the reason these are INTEGER not TEXT.
    const until = 1_800_000_000_000;
    db.run(
      `INSERT INTO authFailures (ipKey, fails, tier, lockUntil, windowStart, windowCount, lastActivityAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["127.0.0.1", 7, 2, until, until - 1000, 9, until]
    );
    const row = db.get(`SELECT fails, tier, lockUntil, windowCount FROM authFailures WHERE ipKey = ?`, ["127.0.0.1"]);
    expect(row.lockUntil).toBe(until);
    expect(row.fails).toBe(7);
    expect(row.windowCount).toBe(9);
  });
});

// ── Durability: the ledger is stone, not memory (Auth Hardening W1) ─────────
//
// The revocation consult is memoised in-process for 15s (bounded staleness, and
// the cost is named in dashboardSession.js). The failure this suite exists to
// catch is the opposite one: a memo — or a module-local Map, or the adapter
// object — mistaken for the source of truth. So the proof does not merely clear
// the memo. It REBUILDS the whole process's module state and rebinds the
// adapter from cold, then asks the same token whether it may still pass.
//
// Mutation check (why the assertions are behavioural rather than structural):
// delete `if (await isSessionRevoked(payload?.jti)) return false;` from
// verifyDashboardAuthToken and the first case fails — the token comes back
// admitted after a kill that supposedly happened.
const LEDGER_SECRET = "auth-ledger-durability-secret";
let originalJwtSecret;

describe("Auth Hardening W1 — the ledger survives a restart", () => {
  beforeAll(() => {
    originalJwtSecret = process.env.JWT_SECRET;
    // Pinned so SECRET is stable across a module rebuild (README-equivalent of
    // dashboard-session-cookie.test.js's own pin) — and so no real DATA_DIR is
    // ever asked for a secret.
    process.env.JWT_SECRET = LEDGER_SECRET;
  });

  afterAll(() => {
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
  });

  /**
   * Rebuild the process state: fresh modules, cold adapter, same DATA_DIR stone.
   * The previous adapter is closed first — a graceful restart, WAL flushed.
   */
  async function reboot() {
    try {
      global._dbAdapter?.instance?.close?.();
    } catch {}
    liftNativeAdapterMocks();
    vi.resetModules();
    delete global._dbAdapter;
    const { getAdapter } = await import("@/lib/db/driver.js");
    const adapter = await getAdapter();
    const session = await import("@/lib/auth/dashboardSession.js");
    const store = await import("@/lib/db/repos/authStoreRepo.js");
    return { adapter, ...session, ...store };
  }

  /** Read a claim out of a freshly signed token (no verify needed). */
  function claimsOf(token) {
    const [, payloadB64] = token.split(".");
    return JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  }

  it("a revoked seat is still refused after the process state is rebuilt from cold", async () => {
    const first = await reboot();
    // On-disk stone is the whole point; a heap-bound fallback cannot carry this
    // proof, and an early return here is how it lied. Fail loudly instead.
    expect(first.adapter.driver).not.toBe("sql.js");

    const token = await first.createDashboardAuthToken();
    const { jti, exp } = claimsOf(token);
    expect(typeof jti).toBe("string");

    const nowIso = new Date().toISOString();
    await first.insertAuthSession({
      id: jti,
      createdAt: nowIso,
      lastSeenAt: nowIso,
      expiresAt: new Date(exp * 1000).toISOString(),
      ip: "127.0.0.1",
      userAgent: "vitest",
      label: "this device",
    });

    // 2. SIGNATURE CONTROL — and the reason this case is worth anything. Rebuild
    //    the process state BEFORE any revocation and require the same token to
    //    still be admitted. That proves the signing secret survived the rebuild,
    //    so the final assertion can only be the ledger's veto and never a broken
    //    signature. MEASURED: before this step existed, this case stayed green
    //    with the veto deleted from the source — a run that proved nothing.
    const second = await reboot();
    expect(await second.verifyDashboardAuthToken(token)).toBe(true);

    // 3. The kill, stamped in the rebuilt process.
    expect(await second.revokeAuthSession(jti, { at: nowIso, reason: "logout" })).toBe(true);

    // 4. Rebuild again — fresh modules, cold adapter, and the memo gone with
    //    them. Nothing in memory survives this; only the stone does.
    const third = await reboot();
    expect(await third.verifyDashboardAuthToken(token)).toBe(false);

    // 5. And the stone still carries the record, with the reason the route
    //    stamped — so the trail's *why* outlives the process too.
    const row = await third.getAuthSession(jti);
    expect(row?.revokedAt).toBe(nowIso);
    expect(row?.revokedReason).toBe("logout");
  });

  it("a token with no ledger row is admitted — fail-open, never retroactive", async () => {
    const { adapter, createDashboardAuthToken, verifyDashboardAuthToken } = await reboot();
    expect(adapter.driver).not.toBe("sql.js");

    // No row was ever written for this jti (the pre-W1 shape, and the pruned-row
    // case): the signature alone admits it. A store that cannot speak must never
    // lock the operator out of their own dashboard.
    const token = await createDashboardAuthToken();
    expect(await verifyDashboardAuthToken(token)).toBe(true);
  });
});
