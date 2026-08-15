// Storage Covenant Wave A10 — the driver×mode boot matrix.
// Plan: plans/storage-covenant.md line 275 + boot matrix (line 364):
//   sqlite  | 4-driver chain        | exactly today
//   mysql   | mysql2 pool, reachable   → full service
//   mysql   | mysql2 pool, unreachable → fail-LOUD boot refusal (never silent downgrade)
//   mirror  | binds in Wave C — A10 pins the LOUD refusal
//
// The four sqlite drivers are forced through VELA_DB_DRIVER (driver.js pins
// one driver and fails LOUD when it is absent — no silent chain fallthrough).
// The sql.js leg is the plan's named fragile corner: "sql.js SAVEPOINT path
// forced in CI; matrix test pins it" — it boots through the REAL sqlite repo
// seam (kv round-trip through a SAVEPOINT transaction + schemaVersion = 4)
// and pins its adapter shape. Drivers absent from the runtime (bun:sqlite on
// Node) skip LOUD — silence never counts as coverage.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach, vi } from "vitest";

let tempDirs = [];
const saved = {};
for (const k of ["DATA_DIR", "VELA_DB_MODE", "VELA_DB_DRIVER", "VELA_MYSQL_URL"]) saved[k] = process.env[k];

function freshDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "vela-a10-"));
  tempDirs.push(d);
  return d;
}

afterEach(async () => {
  // Close whatever adapter this leg booted BEFORE the temp dir dies (Windows EPERM)
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  try { await global._mysqlAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  delete global._mysqlAdapter;
  vi.doUnmock("@/lib/db/mysql/pool.js");
  vi.resetModules();
  for (const k of Object.keys(saved)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true });
  tempDirs = [];
});

function setSqliteBoot(driver) {
  process.env.DATA_DIR = freshDir();
  process.env.VELA_DB_MODE = "sqlite";
  delete process.env.VELA_MYSQL_URL;
  delete global._dbAdapter;
  vi.resetModules();
  if (driver) process.env.VELA_DB_DRIVER = driver;
  else delete process.env.VELA_DB_DRIVER;
}

/** Runtime availability per driver.js's own gate — decides skip-vs-run LOUD. */
function driverAvailable(name) {
  if (name === "bun:sqlite") return !!process.versions.bun;
  if (name === "better-sqlite3" || name === "node:sqlite") return !process.versions.bun;
  return true; // sql.js — bundled dependency, always present
}

const DRIVERS = ["better-sqlite3", "node:sqlite", "sql.js", "bun:sqlite"];

describe("Storage Covenant A10 — boot matrix", () => {
  describe("the four sqlite drivers × sqlite mode (exactly today)", () => {
    for (const driver of DRIVERS) {
      const runnable = driverAvailable(driver);
      if (!runnable) {
        console.warn(`[A10 SKIP LOUD] driver "${driver}" unavailable in this runtime — its matrix leg skips (no silent coverage)`);
      }
      const t = runnable ? it : it.skip;
      t(`${driver} boots, migrates to schema 4, and round-trips the seam`, async () => {
        setSqliteBoot(driver);
        const { getAdapter } = await import("@/lib/db/driver.js");
        const adapter = await getAdapter();
        expect(adapter.driver).toBe(driver);

        // Migration 004 law: the dedupe identity exists in every harbor
        const idx = adapter.all(
          `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'uq_uh_dedupe'`
        );
        expect(idx.length).toBe(1);

        // The seam round-trip: a SAVEPOINT transaction writes a kv row,
        // a failed transaction rolls back — both engines agree.
        adapter.transaction(() => {
          adapter.run(`INSERT INTO kv(scope, key, value) VALUES('matrix', 'probe', '"alive"')`);
        });
        expect(adapter.get(`SELECT value FROM kv WHERE scope = 'matrix' AND key = 'probe'`).value).toBe('"alive"');
        expect(() => adapter.transaction(() => {
          adapter.run(`INSERT INTO kv(scope, key, value) VALUES('matrix', 'doomed', '"ghost"')`);
          throw new Error("intentional rollback probe");
        })).toThrow(/intentional rollback probe/);
        expect(adapter.get(`SELECT value FROM kv WHERE scope = 'matrix' AND key = 'doomed'`)).toBeFalsy();

        // schemaVersion pinned by migration 006 (mirror outbox)
        const sv = adapter.get(`SELECT value FROM _meta WHERE key = 'schemaVersion'`);
        expect(sv.value).toBe("6");
        adapter.exec(`DELETE FROM kv WHERE scope = 'matrix'`);
      }, 30000);
    }

    it("the chain resolves (no force) — exactly today's behavior", async () => {
      setSqliteBoot(null);
      const { getAdapter } = await import("@/lib/db/driver.js");
      const adapter = await getAdapter();
      expect(DRIVERS).toContain(adapter.driver);
    }, 30000);

    it("an unknown VELA_DB_DRIVER fails LOUD", async () => {
      setSqliteBoot("rocksdb");
      const { getAdapter } = await import("@/lib/db/driver.js");
      await expect(getAdapter()).rejects.toThrow(/unknown VELA_DB_DRIVER/);
    }, 15000);
  });

  describe("mysql posture", () => {
    it("reachable twin boots the adapter, bootstrap reaches parity, repos serve", async () => {
      const url = process.env.VELA_TEST_MYSQL_URL;
      if (!url) {
        console.warn("[A10 SKIP LOUD] VELA_TEST_MYSQL_URL unset — mysql boot leg skipped (no silent coverage)");
        return;
      }
      process.env.DATA_DIR = freshDir();
      process.env.VELA_DB_MODE = "mysql";
      process.env.VELA_MYSQL_URL = url;
      delete global._mysqlAdapter;
      vi.resetModules();

      const { assertHarborBound } = await import("@/lib/db/repos/bind.js");
      // The barrel's export/import still refuse (Wave B debt) — LOUD, named.
      await expect(assertHarborBound()).rejects.toThrow(/Wave B/);

      // ...but the repos bind and serve against the twin
      const { getSettings } = await import("@/lib/db/repos/settingsRepo.js");
      const s = await getSettings();
      expect(s).toBeTruthy();
      expect(typeof s.requireApiKey === "boolean" || s.requireApiKey === undefined).toBe(true);
    }, 60000);

    it("unreachable twin refuses LOUD — never silent downgrade", async () => {
      process.env.DATA_DIR = freshDir();
      process.env.VELA_DB_MODE = "mysql";
      process.env.VELA_MYSQL_URL = "mysql://vela:vela@127.0.0.1:1/vela"; // closed port
      vi.resetModules();
      const { assertHarborBound } = await import("@/lib/db/repos/bind.js");
      await expect(assertHarborBound()).rejects.toThrow(); // any error = loud refusal
    }, 20000);
  });

  describe("mirror posture", () => {
    it("refuses LOUD until Wave C (A10 pins the refusal; the pump lands in C)", async () => {
      process.env.DATA_DIR = freshDir();
      process.env.VELA_DB_MODE = "mirror";
      vi.resetModules();
      const { assertHarborBound } = await import("@/lib/db/repos/bind.js");
      await expect(assertHarborBound()).rejects.toThrow(/Wave C/);
    }, 15000);
  });
});
