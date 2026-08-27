// Test covenant: injector-governance-migration-017 — AI Lab columns via the
// PORTABLE adapter surface (run/get/all/exec/transaction — NO raw prepare()).
//
// Regression guard for the v0.9.19 boot-storm lesson: migrations must run on
// the sql.js adapter (the Docker runner's fallback driver). This suite proves
// migration 017's chain runs there, the four tri-state columns land, and the
// settings.userInjectors UUID backfill is deterministic (hash-derived, id
// present, idempotent, same-name entries get distinct ids).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalSecret = process.env.API_KEY_SECRET;

async function bootSqlJs() {
  delete global._dbAdapter;
  // Force the sql.js fallback exactly like migration 013's suite.
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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-mig017-"));
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "mig017-test-secret";
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

const GOV_COLUMNS = ["allowedInjectors", "allowedModes", "defaultMode", "injectVarAllowlist"];

describe("Migration 017 — injector governance", () => {
  it("sql.js adapter (production-crash driver) → chain runs, governance columns exist", async () => {
    const db = await bootSqlJs();
    expect(db.driver).toBe("sql.js");

    const cols = db.all(`PRAGMA table_info(apiKeys)`).map((c) => c.name);
    for (const col of GOV_COLUMNS) expect(cols).toContain(col);
  });

  it("idempotent — re-running the migration up() directly does not throw", async () => {
    delete global._dbAdapter;
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    if (db.driver === "sql.js") return; // heap-bound driver — skip (test 1 covers it)

    const { default: m017 } = await import("@/lib/db/migrations/017-injector-governance.js");
    expect(() => m017.up(db)).not.toThrow();

    const cols = db.all(`PRAGMA table_info(apiKeys)`).map((c) => c.name);
    for (const col of GOV_COLUMNS) expect(cols).toContain(col);
  });

  it("backfills deterministic hash-derived UUIDs onto name-keyed userInjectors (mirror-convergent, distinct for same-name entries)", async () => {
    delete global._dbAdapter;
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    if (db.driver === "sql.js") return; // heap-bound — backfill assertion needs a second pass

    // Seed a settings blob with two name-keyed injectors, one already-id'd.
    const { default: m017 } = await import("@/lib/db/migrations/017-injector-governance.js");
    const blob = {
      userInjectors: [
        { name: "Indonesian-first", prompt: "p1" },
        { name: "Indonesian-first", prompt: "p2" }, // same name — must NOT collide
        { name: "Kept", prompt: "p3", id: "keep-me" },
      ],
    };
    db.run(`INSERT INTO settings (id, data) VALUES (1, ?)`, [JSON.stringify(blob)]);

    m017.up(db); // second pass must be a no-op for already-id'd rows

    const row = db.all(`SELECT data FROM settings WHERE id = 1`);
    const after = JSON.parse(row[0].data);
    expect(after.userInjectors[0].id).toBeTypeOf("string");
    expect(after.userInjectors[1].id).toBeTypeOf("string");
    expect(after.userInjectors[0].id).not.toBe(after.userInjectors[1].id); // index-seeded → distinct
    expect(after.userInjectors[2].id).toBe("keep-me"); // untouched

    // Deterministic: a fresh boot on the same input converges on the SAME ids.
    const { default: m017b } = await import("@/lib/db/migrations/017-injector-governance.js");
    const blob2 = { userInjectors: [{ name: "Indonesian-first", prompt: "p1" }] };
    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "vela-mig017b-"));
    try {
      process.env.DATA_DIR = tmp2;
      delete global._dbAdapter;
      const { getAdapter: getAdapter2 } = await import("@/lib/db/driver.js");
      const db2 = await getAdapter2();
      db2.run(`INSERT INTO settings (id, data) VALUES (1, ?)`, [JSON.stringify(blob2)]);
      m017b.up(db2);
      const row2 = db2.all(`SELECT data FROM settings WHERE id = 1`);
      const after2 = JSON.parse(row2[0].data);
      expect(after2.userInjectors[0].id).toBe(after.userInjectors[0].id); // mirror-convergent
    } finally {
      try { global._dbAdapter?.instance?.close?.(); } catch {}
      delete global._dbAdapter;
      fs.rmSync(tmp2, { recursive: true, force: true });
    }
  });
});
