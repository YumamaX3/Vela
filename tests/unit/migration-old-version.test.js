// Migration guarantee — an OLD Vela database (v0.9.23 and earlier) must always
// migrate to the current schema. This is the contract the Star asked for:
// "i want all vela database can migrate from version 0.9.23 or old version
//  and i want it always can migrate from vela old version than current version."
//
// Proves, on the sql.js crash-driver (the Docker runner's fallback — the same
// harness migration-016 / key-acl-013 use):
//   1. A DB stamped at an old mid-chain version (schemaVersion = 9, the
//      v0.9.23-era apex) runs the REAL chain 010→latest, not just 001-002.
//   2. Legacy rows survive the whole voyage — a key + a combo + usage survive.
//   3. New columns appear (requestCapDaily is the 019-era column; the
//      per-key ACL columns are the 013-era ones).
//   4. syncSchemaFromTables backfills a deliberately dropped column.
//   5. The chain's apex version == latestVersion() == SCHEMA_VERSION (the
//      off-by-one the registry drift caused — the guard that catches it).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalSecret = process.env.API_KEY_SECRET;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-migold-"));
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "migold-test-secret";
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) {
    // Windows file-lock resilience: retry cleanup briefly — the sql.js DB
    // handle can hold the temp dir for a tick after close().
    for (let i = 0; i < 5; i++) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); break; }
      catch { new Promise((r) => setTimeout(r, 25)); }
    }
  }
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalSecret === undefined) delete process.env.API_KEY_SECRET;
  else process.env.API_KEY_SECRET = originalSecret;
});

/** Force the sql.js fallback exactly like migration 002/013's sql.js suites:
 * make the native adapters unavailable so resolveDriver lands on sql.js. */
async function bootSqlJs() {
  delete global._dbAdapter;
  vi.doMock("@/lib/db/adapters/betterSqliteAdapter.js", () => {
    throw new Error("simulated unavailable");
  });
  vi.doMock("@/lib/db/adapters/nodeSqliteAdapter.js", () => {
    throw new Error("simulated unavailable");
  });
  const { getAdapter } = await import("@/lib/db/driver.js");
  return getAdapter();
}

/**
 * Build a v0.9.23-era sqlite FILE faithfully: run the REAL migrations
 * 001→009 (the chain apex a v0.9.23 install had), stamp the schemaVersion
 * back to 9, insert legacy rows through the era's surface, close() to
 * persist — then boot the runner (getAdapter → runMigrationOnce) which
 * takes the file forward through the whole chain 010→latest. This is the
 * honest shape of the upgrade: an old on-disk database + the current binary.
 */
async function buildOldDb() {
  const { createSqlJsAdapter } = await import("@/lib/db/adapters/sqljsAdapter.js");
  const { DATA_FILE, ensureDirs } = await import("@/lib/db/paths.js");
  ensureDirs();
  const builder = await createSqlJsAdapter(DATA_FILE);

  // The era's schema = what migrations 001-009 built.
  builder.exec(`CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT)`);
  const { MIGRATIONS } = await import("@/lib/db/migrations/index.js");
  const oldApex = 9;
  for (const m of MIGRATIONS.filter((m) => m.version <= oldApex)) {
    m.up(builder);
  }
  builder.run(`INSERT OR REPLACE INTO _meta (key, value) VALUES ('schemaVersion', '9')`);
  builder.run(`INSERT OR REPLACE INTO _meta (key, value) VALUES ('appVersion', '0.9.23')`);

  // Legacy rows through the era's surface. Plaintext `key` is present —
  // migration 002's tombstone sweep already ran on these (the era WAS
  // post-governance), so the row carries keyHash + keyPrefix + scrubbed key.
  builder.run(
    `INSERT INTO apiKeys (id, key, keyHash, keyPrefix, name, isActive, createdAt, keyVersion)
     VALUES ('old-key-1', 'revoked-old-key-1', 'hash-old-key-1', 'old-prefix', 'Legacy Key', 1, ?, 'legacy')`,
    [new Date().toISOString()]
  );
  builder.run(
    `INSERT INTO combos (id, name, kind, models, createdAt, updatedAt) VALUES ('combo-1', 'Legacy Combo', 'llm', '["gpt-4o"]', ?, ?)`,
    [new Date().toISOString(), new Date().toISOString()]
  );
  builder.run(
    `INSERT INTO usageHistory (timestamp, provider, model, status, promptTokens, completionTokens, cost, tokens, meta)
     VALUES (?, 'openai', 'gpt-4o', 'ok', 100, 50, 0.001, '{}', '{}')`,
    [new Date().toISOString()]
  );
  builder.close(); // persists to DATA_FILE

  // Boot the runner — reads the old file, migrates chain 010→latest, syncs.
  const db = await bootSqlJs();
  return db;
}

describe("Migration guarantee — old Vela DB → current (the covenant test)", () => {
  it("old schemaVersion=9 DB runs the REAL chain to latestVersion()", async () => {
    const db = await buildOldDb();

    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    const { SCHEMA_VERSION } = await import("@/lib/db/schema.js");

    // The chain apex must equal the const — the registry drift guard.
    expect(latestVersion()).toBe(SCHEMA_VERSION);

    const stored = db.get(`SELECT value FROM _meta WHERE key = 'schemaVersion'`);
    expect(parseInt(stored.value, 10)).toBe(latestVersion());

    // Post-020: the governance ledger exists, the 020-removed tables are gone.
    const tables = db.all(`SELECT name FROM sqlite_master WHERE type = 'table'`).map((t) => t.name);
    expect(tables).toContain("key_mutation_ledger");
    expect(tables).not.toContain("keyTiers");
    expect(tables).not.toContain("redemptions");
  });

  it("legacy rows survive the whole voyage (key + combo + usage)", async () => {
    const db = await buildOldDb();

    const keys = db.all(`SELECT * FROM apiKeys WHERE id = 'old-key-1'`);
    expect(keys.length).toBe(1);
    expect(keys[0].name).toBe("Legacy Key");

    const combos = db.all(`SELECT * FROM combos WHERE id = 'combo-1'`);
    expect(combos.length).toBe(1);
    expect(JSON.parse(combos[0].models)).toEqual(["gpt-4o"]);

    const usage = db.all(`SELECT * FROM usageHistory`);
    expect(usage.length).toBe(1);
    expect(usage[0].status).toBe("ok");
  });

  it("new columns appear after migration (requestCapDaily, ACL columns)", async () => {
    const db = await buildOldDb();

    const keyCols = db.all(`PRAGMA table_info(apiKeys)`).map((c) => c.name);
    // 019's daily request cap survives the 020 removal.
    expect(keyCols).toContain("requestCapDaily");
    // 020 dropped the tier/balance columns.
    expect(keyCols).not.toContain("tierId");
    expect(keyCols).not.toContain("balanceCents");
    // 013-era ACL columns
    for (const col of ["allowedKinds", "allowedProviders", "allowedCombos", "allowedModels"]) {
      expect(keyCols).toContain(col);
    }
  });

  it("syncSchemaFromTables backfills a deliberately dropped column", async () => {
    const db = await buildOldDb();
    // 013 added allowedModels via the chain; drop it, then re-run sync.
    db.exec(`ALTER TABLE apiKeys DROP COLUMN allowedModels`);
    expect(db.all(`PRAGMA table_info(apiKeys)`).map((c) => c.name)).not.toContain("allowedModels");

    db.close?.();
    delete global._dbAdapter;
    vi.resetModules();
    const db2 = await bootSqlJs();
    const cols = db2.all(`PRAGMA table_info(apiKeys)`).map((c) => c.name);
    expect(cols).toContain("allowedModels");
  });

  it("schemaVersion pin parity — no registry drift", async () => {
    // The guard the 019-off-by-one would have caught: the chain apex and the
    // SCHEMA_VERSION const must agree, or a boot would silently skip the last
    // migration while the const claims a higher version.
    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    const { SCHEMA_VERSION } = await import("@/lib/db/schema.js");
    expect(latestVersion()).toBe(SCHEMA_VERSION);
  });
});
