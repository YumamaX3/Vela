// Storage Covenant Wave B3 — the scheduler exit gate.
// Plan: plans/storage-covenant.md line 286-288 (scheduler) + line 300-302
// (purge AFTER backup) + line 430-433 (negative tests).
//
// Pinned here:
//   1. CONFIG — env-only policy read (enabled/interval/retention/purge window).
//   2. LIFECYCLE — start/stop idempotent; disabled master switch refuses to arm.
//   3. TICK ORDER — backup → retention prune → usage purge, IN THAT ORDER
//      (purge after backup so purged rows live in the artifact).
//   4. FAIL-OPEN — a failing backup sets degraded + lastResult.ok=false,
//      the tick never throws, the scheduler keeps living.
//   5. STATUS — getBackupStatus returns metadata only (S4): no error internals
//      beyond the message, never artifact bytes or keys.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const KEY = "scheduler-exit-gate-key-0123456789";

let tempDir;
const saved = {};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-b3-"));
  saved.DATA_DIR = process.env.DATA_DIR;
  saved.API_KEY_SECRET = process.env.API_KEY_SECRET;
  saved.KEY = process.env.VELA_BACKUP_ENCRYPTION_KEY;
  saved.ENABLED = process.env.VELA_BACKUP_ENABLED;
  saved.INTERVAL = process.env.VELA_BACKUP_INTERVAL_HOURS;
  saved.PURGE = process.env.VELA_USAGE_RETENTION_DAYS;
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "b3-test-api-secret";
  process.env.VELA_BACKUP_ENCRYPTION_KEY = KEY;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  // Belt-and-braces: a test that fails mid-body must never leak its backupRepo
  // mock into the next test (the barrel re-exports from the facade).
  vi.doUnmock("@/lib/db/repos/backupRepo.js");
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function seedWorld() {
  for (const [name, content] of [
    ["jwt-secret", "b3-jwt"],
    ["api-key-secret", "b3-apikey"],
  ]) {
    fs.writeFileSync(path.join(tempDir, name), content, { mode: 0o600 });
  }
  const db = await import("@/lib/db/index.js");
  await db.initDb();
  await db.updateSettings({ cloudEnabled: false });
  return db;
}

describe("Wave B3 — env policy config", () => {
  it("reads the env-only policy with defaults", async () => {
    delete process.env.VELA_BACKUP_ENABLED;
    const { isBackupEnabled, getBackupStatus } = await import("@/shared/services/backupScheduler.js");
    expect(isBackupEnabled()).toBe(false);
    const status = getBackupStatus();
    expect(status.enabled).toBe(false);
    expect(status.intervalHours).toBe(24);
    expect(status.retainDaily).toBe(7);
    expect(status.retainWeekly).toBe(4);
    expect(status.retentionDays).toBe(90);
  });

  it("honors explicit env values", async () => {
    process.env.VELA_BACKUP_ENABLED = "true";
    process.env.VELA_BACKUP_INTERVAL_HOURS = "12";
    process.env.VELA_USAGE_RETENTION_DAYS = "30";
    const { isBackupEnabled, getBackupStatus } = await import("@/shared/services/backupScheduler.js");
    expect(isBackupEnabled()).toBe(true);
    const status = getBackupStatus();
    expect(status.enabled).toBe(true);
    expect(status.intervalHours).toBe(12);
    expect(status.retentionDays).toBe(30);
  });
});

describe("Wave B3 — lifecycle", () => {
  it("start is a no-op when disabled (master switch law)", async () => {
    delete process.env.VELA_BACKUP_ENABLED;
    const mod = await import("@/shared/services/backupScheduler.js");
    mod.startBackupScheduler();
    const status = mod.getBackupStatus();
    expect(status.enabled).toBe(false);
    expect(status.nextRunAt).toBeNull(); // no timer armed
    mod.stopBackupScheduler(); // idempotent stop — must not throw
  });

  it("start arms when enabled; stop disarms; both are idempotent", async () => {
    process.env.VELA_BACKUP_ENABLED = "true";
    const mod = await import("@/shared/services/backupScheduler.js");
    mod.startBackupScheduler();
    mod.startBackupScheduler(); // second call — idempotent, no double timer
    let status = mod.getBackupStatus();
    expect(status.nextRunAt).not.toBeNull();
    mod.stopBackupScheduler();
    mod.stopBackupScheduler(); // second stop — idempotent
    status = mod.getBackupStatus();
    expect(status.nextRunAt).toBeNull();
  });

  it("configureBackupScheduler starts on enabled=true, stops on false", async () => {
    process.env.VELA_BACKUP_ENABLED = "true";
    const mod = await import("@/shared/services/backupScheduler.js");
    mod.configureBackupScheduler();
    expect(mod.getBackupStatus().nextRunAt).not.toBeNull();
    process.env.VELA_BACKUP_ENABLED = "false";
    mod.configureBackupScheduler();
    expect(mod.getBackupStatus().nextRunAt).toBeNull();
  });
});

describe("Wave B3 — tick order + fail-open", () => {
  it("tick runs backup → prune → purge IN ORDER", async () => {
    process.env.VELA_BACKUP_ENABLED = "true";
    process.env.VELA_USAGE_RETENTION_DAYS = "90";

    const callOrder = [];
    const deps = {
      runBackup: async () => {
        callOrder.push("runBackup");
        return { ok: true, artifactId: "vela-backup-test", sizeBytes: 10 };
      },
      pruneBackupArtifacts: () => {
        callOrder.push("pruneBackupArtifacts");
        return { kept: 1, removed: [] };
      },
      purgeOldUsage: async () => {
        callOrder.push("purgeOldUsage");
        return { purged: true, usageHistory: 0, requestDetails: 0 };
      },
    };

    const { runBackupTick } = await import("@/shared/services/backupScheduler.js");
    const result = await runBackupTick(deps);
    expect(result.ok).toBe(true);
    // THE ORDER LAW — purge AFTER backup so purged rows live in the artifact.
    expect(callOrder).toEqual(["runBackup", "pruneBackupArtifacts", "purgeOldUsage"]);
  }, 60000);

  it("tick refuses to run when disabled", async () => {
    delete process.env.VELA_BACKUP_ENABLED;
    const { runBackupTick } = await import("@/shared/services/backupScheduler.js");
    const result = await runBackupTick();
    expect(result.skipped).toBe("disabled");
  });

  it("fail-open — a failing backup sets degraded, never throws", async () => {
    process.env.VELA_BACKUP_ENABLED = "true";

    const deps = {
      runBackup: async () => { throw new Error("disk full"); },
      pruneBackupArtifacts: () => ({ kept: 0, removed: [] }),
      purgeOldUsage: async () => ({ purged: false }),
    };

    const { runBackupTick, getBackupStatus } = await import("@/shared/services/backupScheduler.js");
    // Must NOT throw — the routing hot path must never feel a backup failure.
    const result = await runBackupTick(deps);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/disk full/);
    const status = getBackupStatus();
    expect(status.degraded).toBe(true);
    expect(status.lastResult.ok).toBe(false);
  }, 60000);

  it("concurrent ticks are guarded — the second skips", async () => {
    process.env.VELA_BACKUP_ENABLED = "true";

    let resolveBackup;
    const deps = {
      runBackup: () => new Promise((res) => {
        resolveBackup = () => res({ ok: true, artifactId: "x", sizeBytes: 1 });
      }),
      pruneBackupArtifacts: () => ({ kept: 0, removed: [] }),
      purgeOldUsage: async () => ({ purged: false }),
    };

    const mod = await import("@/shared/services/backupScheduler.js");
    const first = mod.runBackupTick(deps); // holds the running guard
    // runBackup is called synchronously inside the tick — resolveBackup is set.
    expect(typeof resolveBackup).toBe("function");
    const second = await mod.runBackupTick(deps);
    expect(second.skipped).toBe("already-running");
    resolveBackup();
    const firstResult = await first;
    expect(firstResult.ok).toBe(true);
  }, 60000);

  it("real tick end-to-end (no mocks) — backup lands + status records it", async () => {
    process.env.VELA_BACKUP_ENABLED = "true";
    await seedWorld();
    const mod = await import("@/shared/services/backupScheduler.js");
    const result = await mod.runBackupTick();
    expect(result.ok).toBe(true);
    expect(result.artifactId).toMatch(/^vela-backup-/);
    const status = mod.getBackupStatus();
    expect(status.lastResult.ok).toBe(true);
    expect(status.degraded).toBe(false);
    // S4 — status is metadata only: never artifact bytes, never the key.
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain(KEY);
  }, 120000);
});
