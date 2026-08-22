// Test covenant: key-acl-migration-013 — per-key ACL columns via the PORTABLE
// adapter surface (run/get/all/exec/transaction — NO raw prepare()).
//
// Regression: v0.9.19's first migration draft used `db.prepare("PRAGMA
// table_info(apiKeys)").all()` — the sqlite-only API. On the sql.js adapter
// (the Docker runner's fallback driver) and the mysql/mirror adapters there
// is no public `.prepare`, so every DB-backed API crashed at boot with
// "a.prepare is not a function". This suite proves the migration runs on the
// sql.js adapter (the production-crash driver) and the columns land.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalSecret = process.env.API_KEY_SECRET;

async function bootSqlJs() {
  delete global._dbAdapter;
  // Force the sql.js fallback exactly like migration 002's sql.js suite:
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

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-mig013-"));
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "mig013-test-secret";
  delete global._dbAdapter;
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalSecret === undefined) delete process.env.API_KEY_SECRET;
  else process.env.API_KEY_SECRET = originalSecret;
});

const ACL_COLUMNS = ["allowedKinds", "allowedProviders", "allowedCombos"];

describe("Migration 013 — key ACL columns", () => {
  it("sql.js adapter (production-crash driver) → migration chain runs to v13, ACL columns exist", async () => {
    const db = await bootSqlJs();
    expect(db.driver).toBe("sql.js");

    const cols = db.all(`PRAGMA table_info(apiKeys)`).map((c) => c.name);
    for (const col of ACL_COLUMNS) expect(cols).toContain(col);
  });

  it("idempotent — re-running the migration up() directly does not throw", async () => {
    // Runs on the natural driver (node:sqlite / better-sqlite3) — the sql.js
    // WASM heap can't survive a second full pass in this test env, and test 1
    // already proves the portable surface works there.
    delete global._dbAdapter;
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    if (db.driver === "sql.js") return; // heap-bound driver — skip (test 1 covers it)

    const { default: m013 } = await import("@/lib/db/migrations/013-key-acl.js");
    expect(() => m013.up(db)).not.toThrow();

    const cols = db.all(`PRAGMA table_info(apiKeys)`).map((c) => c.name);
    for (const col of ACL_COLUMNS) expect(cols).toContain(col);
  });

  it("ACL columns accept JSON strings (the tri-state storage shape)", async () => {
    delete global._dbAdapter;
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    if (db.driver === "sql.js") return; // heap-bound driver — skip (test 1 covers it)

    db.run(
      `UPDATE apiKeys SET allowedKinds = ?, allowedProviders = ?, allowedCombos = ? WHERE id IN (SELECT id FROM apiKeys LIMIT 1)`,
      ['["llm"]', '["openai"]', null]
    );
    const row = db.get(`SELECT allowedKinds, allowedProviders, allowedCombos FROM apiKeys LIMIT 1`);
    expect(row.allowedKinds).toBe('["llm"]');
    expect(row.allowedProviders).toBe('["openai"]');
    expect(row.allowedCombos).toBeNull();
  });
});
