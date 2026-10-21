// Storage Covenant — the restore drill must not touch the operator's backups.
//
// DEFECT (proven, then fixed): getScratchAdapter() ran runMigrationOnce()
// without a scratch flag. runMigrationOnce() calls makeBackupDir() +
// backupDbLite() + pruneOldBackups(), all of which resolve BACKUPS_DIR from the
// REAL DATA_DIR — not from the scratch file's path. So every restore drill
// wrote a `schema-N-to-M` snapshot into the operator's backup directory and
// then pruned that directory down to KEEP_BACKUPS (=3). A drill whose whole
// promise is "the live DB is never touched" was silently destroying recovery
// points. Only three `schema-*` dirs surviving on a host that has migrated far
// past three schema versions is the fingerprint.
//
// These tests are deliberately behavioural, not tautological: they assert on
// the OBSERVABLE filesystem effect (backup dir contents before/after) rather
// than asserting that a flag was passed.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

const backupDirs = () => {
  const dir = path.join(tempDir, "db", "backups");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort();
};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "Vela-scratchiso-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("scratch adapter isolation", () => {
  // NOTE ON TIMEOUTS — every case below opens a REAL adapter, which drives
  // getScratchAdapter/getAdapter → runMigrationOnce → the full versioned
  // migration chain. Measured ~2.2s of test time in isolation, against
  // vitest's 5000ms default — so under parallel load this suite crosses the
  // default ceiling and fails as a TIMEOUT, not as a defect. The generous
  // per-case budget below is deliberate; do NOT "recover" the time by shrinking
  // the work, because the work IS the assertion (a scratch adapter is only
  // meaningful if it actually migrated).
  it("getScratchAdapter does NOT write into the real backups dir", { timeout: 30_000 }, async () => {
    const { getScratchAdapter } = await import("@/lib/db/driver.js");
    const scratchPath = path.join(tempDir, "drill-scratch.sqlite");

    // Put an existing operator backup in place so pruning would be OBSERVABLE.
    fs.mkdirSync(path.join(tempDir, "db", "backups"), { recursive: true });
    const keeper = path.join(tempDir, "db", "backups", "schema-1-to-2-keepme");
    fs.mkdirSync(keeper, { recursive: true });
    fs.writeFileSync(path.join(keeper, "data.sqlite"), "operator-backup");

    const before = backupDirs();
    expect(before).toEqual(["schema-1-to-2-keepme"]);

    const adapter = await getScratchAdapter(scratchPath);
    try { adapter.close?.(); } catch {}

    const after = backupDirs();
    // The defect wrote a NEW snapshot here and could prune the operator's.
    expect(after).toEqual(before);
    // And the operator's backup content must be untouched.
    expect(fs.readFileSync(path.join(keeper, "data.sqlite"), "utf8")).toBe("operator-backup");
  });

  it("scratch adapter still gets a full migrated schema", { timeout: 30_000 }, async () => {
    const { getScratchAdapter } = await import("@/lib/db/driver.js");
    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    const scratchPath = path.join(tempDir, "schema-check.sqlite");

    const db = await getScratchAdapter(scratchPath);
    const row = db.get(`SELECT value FROM _meta WHERE key='schemaVersion'`);
    expect(parseInt(row.value, 10)).toBe(latestVersion());

    const tables = db.all(`SELECT name FROM sqlite_master WHERE type='table'`).map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(["_meta", "settings", "providerConnections", "apiKeys"]));
    db.close?.();
  });

  it("a REAL boot still takes its pre-schema backup (guard is not a blanket mute)", { timeout: 30_000 }, async () => {
    // Proves the fix did not disable legitimate backups: getAdapter() with no
    // scratch flag must still exercise the backup path.
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const row = db.get(`SELECT value FROM _meta WHERE key='backupSchemaVersion'`);
    expect(parseInt(row.value, 10)).toBeGreaterThan(0);
    db.close?.();
  });
});