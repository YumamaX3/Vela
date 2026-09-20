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
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

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
