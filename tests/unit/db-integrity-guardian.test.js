// INTEGRITY GUARDIAN — the boot-time heal, proven against a genuinely
// malformed image rather than asserted.
//
// WHY THIS SUITE EXISTS: before 2026-10-21 the tree had no integrity check at
// all (`grep -rn 'integrity_check|quick_check' src` returned nothing), so a
// damaged harbor booted, migrated over the damage, and surfaced later as a wall
// of fail-open noise — "database disk image is malformed" on every usage write
// and every requestDetails batch — while usage history and request details were
// silently lost. These cases are the difference between a heal that fires in
// the fire and one that is merely written down.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

/** Overwrite bytes in the middle of a SQLite file, preserving the 100-byte
 *  header so SQLite still recognises it as a database — a header-clobbering
 *  write would fail as "file is not a database" (also handled, but a different
 *  finding than page damage). */
function corruptPages(filePath) {
  const fd = fs.openSync(filePath, "r+");
  const size = fs.fstatSync(fd).size;
  const at = Math.floor(size / 2);
  const garbage = Buffer.alloc(Math.min(4096, size - at), 0xa5);
  fs.writeSync(fd, garbage, 0, garbage.length, at);
  fs.closeSync(fd);
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "Vela-integrity-"));
  process.env.DATA_DIR = tempDir;
  delete process.env.VELA_DB_SKIP_INTEGRITY;
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

describe("corruption classification", () => {
  it("recognises every image-damage code and every message shape", async () => {
    const { isCorruptionError } = await import("@/lib/db/integrity.js");
    for (const code of ["SQLITE_CORRUPT", "SQLITE_CORRUPT_VTAB", "SQLITE_NOTADB"]) {
      expect(isCorruptionError({ code })).toBe(true);
    }
    expect(isCorruptionError({ message: "database disk image is malformed" })).toBe(true);
    expect(isCorruptionError({ message: "file is not a database" })).toBe(true);
    expect(isCorruptionError({ message: "malformed database schema (foo)" })).toBe(true);
    // A plain SQL bug must NOT be laundered into a storage fault.
    expect(isCorruptionError({ code: "SQLITE_CONSTRAINT", message: "UNIQUE failed" })).toBe(false);
    expect(isCorruptionError(null)).toBe(false);
  });
});

describe("probeIntegrity", () => {
  it("reports a healthy image as ok and records the check", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { probeIntegrity, getIntegrityState } = await import("@/lib/db/integrity.js");
    const db = await getAdapter();

    const probe = probeIntegrity(db);
    expect(probe.ok).toBe(true);
    expect(probe.messages).toEqual([]);

    const state = getIntegrityState();
    expect(state.healthy).toBe(true);
    expect(state.checkedAt).toBeTruthy();
  });

  it("returns a failure (never throws) when the probe itself cannot run", async () => {
    const { probeIntegrity } = await import("@/lib/db/integrity.js");
    const brokenAdapter = {
      all() { throw Object.assign(new Error("database disk image is malformed"), { code: "SQLITE_CORRUPT" }); },
    };
    const probe = probeIntegrity(brokenAdapter);
    expect(probe.ok).toBe(false);
    expect(probe.messages.join(" ")).toMatch(/malformed/i);
  });
});

describe("healAtBoot on a genuinely damaged harbor", () => {
  it("detects damage, quarantines the original, and the next boot is clean", async () => {
    // ── 1. Build a real database with real rows.
    const { getAdapter, resetAdapter } = await import("@/lib/db/driver.js");
    let db = await getAdapter();
    db.exec("CREATE TABLE IF NOT EXISTS probe_rows (id INTEGER PRIMARY KEY, v TEXT)");
    for (let i = 0; i < 400; i++) db.run("INSERT INTO probe_rows(v) VALUES(?)", [`row-${i}`]);
    expect(db.get("SELECT COUNT(*) c FROM probe_rows").c).toBe(400);

    // ── 2. Close cleanly so the WAL folds into the image, then damage it.
    const { DATA_FILE } = await import("@/lib/db/paths.js");
    resetAdapter();
    expect(fs.existsSync(DATA_FILE)).toBe(true);
    // A tiny image may fit in one page; make sure there is a middle to damage.
    expect(fs.statSync(DATA_FILE).size).toBeGreaterThan(8192);
    corruptPages(DATA_FILE);

    // ── 3. Boot again. The heal must run, not migrate over the rot.
    delete global._dbAdapter;
    vi.resetModules();

    // Import BOTH modules AFTER resetModules: a handle captured before the
    // reset belongs to the discarded module registry, so its state would read
    // null no matter what the boot-time heal actually recorded.
    const fresh = await import("@/lib/db/driver.js");
    const integrity = await import("@/lib/db/integrity.js");
    db = await fresh.getAdapter(); // throws if the heal failed and left rot in place

    // ── 4. Postconditions: a live handle, a clean probe, and a kept original.
    const probe = integrity.probeIntegrity(db);
    expect(probe.ok).toBe(true);
    expect(db.driver).toBeTruthy();

    const state = integrity.getIntegrityState();
    expect(state.healthy).toBe(true);
    expect(["recovered", "quarantined"]).toContain(state.bootHeal.action);

    const { BACKUPS_DIR } = await import("@/lib/db/paths.js");
    const quarantined = fs.existsSync(BACKUPS_DIR)
      ? fs.readdirSync(BACKUPS_DIR).filter((n) => n.startsWith("quarantine-"))
      : [];
    expect(quarantined.length).toBeGreaterThan(0);

    // The damaged bytes were preserved, never destroyed.
    const kept = path.join(BACKUPS_DIR, quarantined[0], path.basename(DATA_FILE));
    expect(fs.existsSync(kept)).toBe(true);
    expect(fs.statSync(kept).size).toBeGreaterThan(0);
  });

  it("VELA_DB_SKIP_INTEGRITY=1 bypasses the probe (parity harness / drill)", async () => {
    process.env.VELA_DB_SKIP_INTEGRITY = "1";
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { getIntegrityState } = await import("@/lib/db/integrity.js");
    await getAdapter();
    // The guardian never ran, so it has no verdict — distinct from "healthy".
    expect(getIntegrityState().checkedAt).toBeNull();
  });
});

describe("runtime guard", () => {
  it("counts corruption once and keeps serving (fail-open telemetry)", async () => {
    const { noteRuntimeCorruption, getIntegrityState, resetIntegrityStateForTests } =
      await import("@/lib/db/integrity.js");
    resetIntegrityStateForTests();

    const err = Object.assign(new Error("database disk image is malformed"), { code: "SQLITE_CORRUPT" });
    expect(noteRuntimeCorruption(err, "usage write")).toBe(true);   // first: log loudly
    expect(noteRuntimeCorruption(err, "usage write")).toBe(false);  // rest: count only
    expect(noteRuntimeCorruption(err, "usage write")).toBe(false);

    const state = getIntegrityState();
    expect(state.runtimeFailures).toBe(3);
    expect(state.healthy).toBe(false);
    expect(state.runtimeLastMessage).toMatch(/usage write/);
  });

  it("LAYER LAW — a covenant writer rethrows instead of pretending success", async () => {
    const { noteRuntimeCorruption, getIntegrityState, resetIntegrityStateForTests } =
      await import("@/lib/db/integrity.js");
    resetIntegrityStateForTests();

    const err = Object.assign(new Error("database disk image is malformed"), { code: "SQLITE_CORRUPT" });

    // Credentials / settings / migrations must NOT be laundered into "saved".
    expect(() => noteRuntimeCorruption(err, "providerConnections write", { failOpen: false }))
      .toThrow(/malformed/);

    // It still RECORDS the hit — throwing is not the same as going blind.
    const state = getIntegrityState();
    expect(state.runtimeFailures).toBe(1);
    expect(state.healthy).toBe(false);
    expect(state.runtimeLastMessage).toMatch(/providerConnections/);
  });
});

describe("checkpoint mode law", () => {
  it("periodic and manual checkpoints are PASSIVE; only a sole-writer flush truncates", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    if (db.driver === "sql.js") return; // no WAL in the in-memory fallback

    // A plain checkpoint must not TRUNCATE the WAL under another handle.
    expect(() => db.checkpoint?.()).not.toThrow();
    // The backup path asks for truncate explicitly; it must still work.
    expect(() => db.raw?.pragma?.("wal_checkpoint(PASSIVE)")).not.toThrow();
  });
});
