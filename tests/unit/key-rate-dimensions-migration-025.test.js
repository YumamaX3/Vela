// Test covenant: key-rate-dimensions-migration-025 — the five-dimension rate
// limits' columns via the PORTABLE adapter surface (run/get/all/exec/
// transaction — NO raw prepare(), the 013 lesson).
//
// The columns are additive and nullable: an upgraded database must behave
// exactly as it did the instant before the ALTER, so NULL — not 0, not a
// default — is the only "unset" the migration may write.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalSecret = process.env.API_KEY_SECRET;

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

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-mig025-"));
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "mig025-test-secret";
  delete global._dbAdapter;
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  vi.doUnmock("@/lib/db/adapters/betterSqliteAdapter.js");
  vi.doUnmock("@/lib/db/adapters/nodeSqliteAdapter.js");
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalSecret === undefined) delete process.env.API_KEY_SECRET;
  else process.env.API_KEY_SECRET = originalSecret;
});

const RATE_COLUMNS = ["rateLimitTpm", "rateLimitRph", "rateLimitRpd", "maxConcurrentRequests"];

describe("Migration 025 — five-dimension rate columns", () => {
  it("fresh DB (sql.js) → migration chain runs to v25, all four columns exist and default NULL", async () => {
    const db = await bootSqlJs();
    const cols = db.all(`PRAGMA table_info(apiKeys)`);
    const byName = new Map(cols.map((c) => [c.name, c]));
    for (const col of RATE_COLUMNS) {
      expect(byName.has(col)).toBe(true);
      // Additive + nullable: no NOT NULL, no default — NULL is "off".
      expect(byName.get(col).dflt_value).toBeNull();
      expect(byName.get(col).notnull).toBe(0);
    }
  });

  it("the chain's latest version is at least 25", async () => {
    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    // 025 itself is fixed; later tides (026 guardrail prompts, 027 policy kinds)
    // extend the chain. The coherence test in 016 pins latestVersion()===SCHEMA_VERSION.
    expect(latestVersion()).toBeGreaterThanOrEqual(25);
  });

  it("idempotent — re-running up() on the native driver does not throw", async () => {
    delete global._dbAdapter;
    vi.doUnmock("@/lib/db/adapters/betterSqliteAdapter.js");
    vi.doUnmock("@/lib/db/adapters/nodeSqliteAdapter.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    if (db.driver === "sql.js") return; // heap-bound driver — the first test covers it

    const { default: m025 } = await import("@/lib/db/migrations/025-key-rate-dimensions.js");
    expect(() => m025.up(db)).not.toThrow();
    const cols = db.all(`PRAGMA table_info(apiKeys)`).map((c) => c.name);
    for (const col of RATE_COLUMNS) expect(cols).toContain(col);
  });

  it("the mysql TABLES mirror carries every column (bootstrap's auto-sync source)", async () => {
    const { TABLES } = await import("@/lib/db/schema.js");
    for (const col of RATE_COLUMNS) {
      expect(TABLES.apiKeys.columns[col]).toBe("INTEGER");
    }
  });
});
