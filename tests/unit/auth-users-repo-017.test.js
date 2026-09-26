// Test covenant: the credential store (migration 017) — one operator,
// username + password.
//
// WHY THIS SUITE EXISTS: migration 016's lesson was that a migration's real risk
// is the DRIVER, not the SQL; the same holds here one step further — the
// authUsers ROW is now the authority the login door consults, so a row that
// cannot round-trip is a lockout, and a UNIQUE index that does not bite is a
// second seat waiting to happen. This suite drives the REAL repo against a REAL
// migrated harbour on BOTH the production-crash driver (sql.js) and the native
// one, and proves the four properties the door leans on:
//   · a seat round-trips (createUser → getUserByUsername) and the named UNIQUE
//     index refuses a rival of the same name;
//   · setUserPassword moves the credential the door verifies;
//   · ensureSeedUser adopts the legacy mirror hash VERBATIM, once, and never
//     re-hashes or re-seeds;
//   · a submitted username that matches no seat resolves to null — never to the
//     single seat (the difference between "wrong name" and "no name at all" is
//     the whole point of the claim).
//
// ADAPTER CONTRACT under test: portable surface only — run/get/all/exec, never
// db.prepare (the 0.9.19/0.9.22 boot storms). The migration calls db.exec alone.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalInitialPassword = process.env.INITIAL_PASSWORD;

const COLS = ["id", "username", "passwordHash", "disabledAt", "lastLoginAt", "createdAt", "updatedAt"];

const NATIVE_ADAPTERS = [
  "@/lib/db/adapters/betterSqliteAdapter.js",
  "@/lib/db/adapters/nodeSqliteAdapter.js",
];

/**
 * Lift the sql.js case's doMock registrations.
 *
 * The first case below mocks BOTH native adapters away to exercise the
 * production-crash driver — and vitest keeps a doMock registration for the whole
 * FILE, not just the case that made it (016's measured trap: the durability
 * cases passed while the ledger's veto was deleted from the source). Every later
 * "native" case must therefore lift them explicitly.
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
  // Force the sql.js fallback exactly like migration 002's, 013's and 016's
  // suites: make the native adapters unavailable so resolveDriver lands on sql.js.
  vi.doMock("@/lib/db/adapters/betterSqliteAdapter.js", () => {
    throw new Error("simulated unavailable");
  });
  vi.doMock("@/lib/db/adapters/nodeSqliteAdapter.js", () => {
    throw new Error("simulated unavailable");
  });
  const { getAdapter } = await import("@/lib/db/driver.js");
  return getAdapter(); // already migrated by initAdapter
}

async function bootNative() {
  liftNativeAdapterMocks();
  delete global._dbAdapter;
  const { getAdapter } = await import("@/lib/db/driver.js");
  return getAdapter();
}

/** Boot a native, migrated harbour and hand back the repo + the seam. */
async function harborAndSeam() {
  await bootNative();
  const usersRepo = await import("@/lib/db/repos/usersRepo.js");
  const seam = await import("@/lib/auth/users.js");
  return { usersRepo, seam };
}

beforeEach(() => {
  // The DB-harness trap: paths.js freezes DATA_DIR at first import and
  // driver.js binds global._dbAdapter at module eval. Both hooks must bust the
  // module cache or a later test writes into an earlier test's deleted dir.
  vi.resetModules();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-authusers170-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  delete process.env.INITIAL_PASSWORD;
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  try { if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalInitialPassword === undefined) delete process.env.INITIAL_PASSWORD;
  else process.env.INITIAL_PASSWORD = originalInitialPassword;
});

describe("Migration 017 — the credential store's table", () => {
  it("sql.js adapter (production-crash driver) → chain reaches v17, authUsers exists with its columns", async () => {
    const db = await bootSqlJs();
    expect(db.driver).toBe("sql.js");

    const found = db.all("PRAGMA table_info(authUsers)").map((c) => c.name);
    expect(found).toEqual(expect.arrayContaining(COLS));
  });

  it("declares the named UNIQUE index the one-seat law rides on", async () => {
    const db = await bootSqlJs();
    const indexes = db
      .all("SELECT name FROM sqlite_master WHERE type='index'")
      .map((r) => r.name);
    expect(indexes).toContain("uq_auth_users_username");
  });

  it("version coherence — SCHEMA_VERSION and the migration chain agree at 17", async () => {
    await bootSqlJs();
    const { MIGRATIONS, latestVersion } = await import("@/lib/db/migrations/index.js");
    const { SCHEMA_VERSION } = await import("@/lib/db/schema.js");
    expect(latestVersion()).toBe(SCHEMA_VERSION);
    expect(latestVersion()).toBe(17);
    const m = MIGRATIONS.find((x) => x.version === 17);
    expect(m?.name).toBe("auth-users");
  });

  it("up is replay-safe — a second run against a populated harbour is a no-op", async () => {
    const db = await bootSqlJs();
    const mod = await import("@/lib/db/migrations/017-auth-users.js");
    const m = mod.default || mod;

    expect(() => {
      m.up(db);
      m.up(db);
    }).not.toThrow();

    const found = db.all("PRAGMA table_info(authUsers)").map((c) => c.name);
    expect(found).toEqual(expect.arrayContaining(COLS));
  });

  it("down is a real inverse — the table drops", async () => {
    const db = await bootSqlJs();
    const mod = await import("@/lib/db/migrations/017-auth-users.js");
    const m = mod.default || mod;

    m.down(db);
    expect(db.all("PRAGMA table_info(authUsers)")).toEqual([]);
  });
});

describe("The credential store — the seat round-trips", () => {
  it("createUser → getUserByUsername returns the row the door will read", async () => {
    const { usersRepo } = await harborAndSeam();
    const hash = await bcrypt.hash("correct-horse", 4);

    const created = await usersRepo.createUser({ id: "u-1", username: "operator", passwordHash: hash });
    expect(created.username).toBe("operator");

    const found = await usersRepo.getUserByUsername("operator");
    expect(found.id).toBe("u-1");
    expect(found.passwordHash).toBe(hash);
    expect(found.disabledAt).toBeNull();
    expect(await usersRepo.countUsers()).toBe(1);
  });

  it("the UNIQUE index refuses a second seat — the table cannot grow a rival", async () => {
    const { usersRepo } = await harborAndSeam();
    await usersRepo.createUser({ id: "u-1", username: "operator", passwordHash: await bcrypt.hash("a", 4) });

    await expect(
      usersRepo.createUser({ id: "u-2", username: "operator", passwordHash: await bcrypt.hash("b", 4) })
    ).rejects.toThrow();
    expect(await usersRepo.countUsers()).toBe(1);
  });

  it("setUserPassword moves the credential the login door verifies", async () => {
    const { usersRepo, seam } = await harborAndSeam();
    await usersRepo.createUser({ id: "u-1", username: "operator", passwordHash: await bcrypt.hash("old-secret", 4) });

    const after = await bcrypt.hash("new-secret", 4);
    expect(await usersRepo.setUserPassword("u-1", after)).toBe(true);

    const reloaded = await usersRepo.getUserByUsername("operator");
    expect(await seam.verifyUserPassword(reloaded, "new-secret")).toBe(true);
    expect(await seam.verifyUserPassword(reloaded, "old-secret")).toBe(false);
  });

  it("touchUserLogin stamps lastLoginAt without touching the credential", async () => {
    const { usersRepo } = await harborAndSeam();
    const hash = await bcrypt.hash("s3cret", 4);
    await usersRepo.createUser({ id: "u-1", username: "operator", passwordHash: hash });

    const at = "2026-09-26T00:00:00.000Z";
    expect(await usersRepo.touchUserLogin("u-1", at)).toBe(true);

    const row = await usersRepo.getUserById("u-1");
    expect(row.lastLoginAt).toBe(at);
    expect(row.passwordHash).toBe(hash);
  });

  it("deleteAllUsers empties the table — the reset route's law", async () => {
    const { usersRepo } = await harborAndSeam();
    await usersRepo.createUser({ id: "u-1", username: "operator", passwordHash: "x" });

    expect(await usersRepo.countUsers()).toBe(1);
    expect(await usersRepo.deleteAllUsers()).toBe(1);
    expect(await usersRepo.countUsers()).toBe(0);
    expect(await usersRepo.listUsers()).toEqual([]);
  });
});

describe("The seed seam — the transition, not a cutover", () => {
  it("ensureSeedUser adopts the legacy mirror hash VERBATIM, then no-ops", async () => {
    const { usersRepo, seam } = await harborAndSeam();
    const legacy = await bcrypt.hash("legacy-secret", 4);

    const seeded = await seam.ensureSeedUser({ password: legacy });
    expect(seeded.username).toBe(seam.DEFAULT_USERNAME);
    // Verbatim, never re-hashed: adopting a fresh salt would still verify, but it
    // would silently stop the mirror and the row from being comparable.
    expect(seeded.passwordHash).toBe(legacy);

    // The count guard short-circuits a second call even with a different mirror.
    const again = await seam.ensureSeedUser({ password: await bcrypt.hash("other", 4) });
    expect(again).toBeNull();

    const row = await usersRepo.getUserByUsername(seam.DEFAULT_USERNAME);
    expect(row.passwordHash).toBe(legacy);
    expect(await usersRepo.countUsers()).toBe(1);
  });

  it("ensureSeedUser hashes INITIAL_PASSWORD when no mirror hash exists", async () => {
    const { usersRepo, seam } = await harborAndSeam();
    process.env.INITIAL_PASSWORD = "env-secret";

    const seeded = await seam.ensureSeedUser({});
    expect(seeded.username).toBe(seam.DEFAULT_USERNAME);
    expect(await seam.verifyUserPassword(seeded, "env-secret")).toBe(true);
    expect(await usersRepo.countUsers()).toBe(1);
  });

  it("ensureSeedUser does nothing when no credential exists anywhere", async () => {
    const { usersRepo, seam } = await harborAndSeam();

    expect(await seam.ensureSeedUser({})).toBeNull();
    expect(await usersRepo.countUsers()).toBe(0);
  });

  it("loadLoginTarget seeds lazily from the mirror and resolves the seat", async () => {
    const { seam } = await harborAndSeam();
    const legacy = await bcrypt.hash("legacy-secret", 4);

    const seat = await seam.loadLoginTarget({ password: legacy }, undefined);
    expect(seat.username).toBe(seam.DEFAULT_USERNAME);
    expect(await seam.verifyUserPassword(seat, "legacy-secret")).toBe(true);
  });

  it("a submitted username matching no seat resolves to null — never to the single seat", async () => {
    const { seam } = await harborAndSeam();
    await seam.loadLoginTarget({ password: await bcrypt.hash("legacy-secret", 4) }, undefined);

    expect(await seam.loadLoginTarget({}, "someone-else")).toBeNull();
    expect(await seam.loadLoginTarget({}, seam.DEFAULT_USERNAME)).not.toBeNull();
  });

  it("no username resolves the single seat — the transition's compatibility path", async () => {
    const { seam } = await harborAndSeam();
    await seam.loadLoginTarget({ password: await bcrypt.hash("legacy-secret", 4) }, undefined);

    const seat = await seam.loadLoginTarget({}, undefined);
    expect(seat.username).toBe(seam.DEFAULT_USERNAME);
  });

  it("the seat resolves case-insensitively, keyed by usernameKey", async () => {
    const { usersRepo, seam } = await harborAndSeam();
    await usersRepo.createUser({ id: "u-1", username: "Operator", passwordHash: await bcrypt.hash("s3cret", 4) });

    expect((await seam.resolveLoginUser("OPERATOR"))?.username).toBe("Operator");
    expect(await seam.resolveLoginUser("nobody")).toBeNull();
  });
});

describe("normalizeUsername — the shape one seat may carry", () => {
  it("trims a plain name and reports honestly on every refusal", async () => {
    const { normalizeUsername } = await import("@/lib/auth/users.js");

    expect(normalizeUsername("  operator ").value).toBe("operator");
    expect(normalizeUsername("a.b_c-d").ok).toBe(true);
    expect(normalizeUsername("ab").ok).toBe(false); // below USERNAME_MIN
    expect(normalizeUsername("bad name").ok).toBe(false); // space
    expect(normalizeUsername("-leading").ok).toBe(false); // must start alphanumeric
    expect(normalizeUsername("a".repeat(65)).ok).toBe(false); // beyond USERNAME_MAX
    expect(normalizeUsername(123).ok).toBe(false); // not a string
  });
});
