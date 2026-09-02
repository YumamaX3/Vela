// Sentinel covenant — milestone 0.5 of the proxy-fleet rebirth:
// "tethys_sentry_snapshot taken AND a restore PROVEN (not just a backup —
// migrate.js auto-backs-up)."
//
// WHY THIS SUITE EXISTS
// ---------------------
// The production backup engine has a restore DRILL (`runRestoreDrill`,
// backupEngine.js:306) and a real RESTORE (`restoreBackup`, :232), and both
// were shipped in Storage Covenant Wave B — but NO test ever exercised them.
// `ls tests/unit | grep -i backup` returned nothing at v0.9.42. A backup
// engine nobody has restored from is a hope, not a safeguard.
//
// WHAT THE DRILL DOES NOT PROVE
// -----------------------------
// The drill asserts TABLE EXISTENCE only: it opens the newest artifact into a
// scratch sqlite DB and fails only if `expectedTables.filter(t => !have.has(t))`
// is non-empty (backupEngine.js:332-338). An artifact whose payload decrypts to
// EMPTY tables passes the drill with `ok: true`. So the drill proves the crypto
// and the schema; it does NOT prove data fidelity.
//
// This suite proves the stronger property: WRITE → SEAL → DESTROY → OPEN →
// IMPORT → READ → COMPARE, field by field. The payload that matters most is a
// proxyPools row, because the proxy-fleet rebuild (milestones 2b and 3) is
// about to add a column and a kv scope to exactly that table — and proxyPools
// has only SIX real columns (id, isActive, testStatus, data, createdAt,
// updatedAt) with everything else riding the `data` JSON blob. Fidelity of that
// blob through a restore is load-bearing for the whole rebuild.
//
// THE ROUND-TRIP UNDER TEST (the symmetry this pins)
//   exportDb  (backupRepo.js:73-76): spreads the blob, then overlays the six
//             real columns → a FLAT object
//   importDb  (backupRepo.js:~218): destructures `{id, isActive, testStatus,
//             createdAt, updatedAt, ...rest}` and re-blobs `rest`
//   If those two ever drift — e.g. a new real column is added to TABLES but not
//   to the import destructure — the field silently moves from column to blob or
//   is dropped entirely. This suite fails loudly on that drift.
//
// ISOLATION — and the trap this harness had to defeat.
// Two module-level caches make per-test DATA_DIR isolation FAIL silently:
//   1. src/lib/db/paths.js freezes DB_DIR / DATA_FILE / BACKUPS_DIR at first
//      import. Reassigning process.env.DATA_DIR afterwards changes nothing.
//   2. src/lib/db/driver.js binds `const state = global._dbAdapter` once at
//      module eval, so `delete global._dbAdapter` never rebinds it — the next
//      getAdapter() returns the PREVIOUS test's (already closed) instance.
// The symptom is not a clean failure: tests see each other's artifacts, so the
// "no artifact exists" drill reports ok:true from a stale .velabak file, and
// DB tests die with "The database connection is not open". The fix is
// vi.resetModules() plus setting DATA_DIR BEFORE the first dynamic import of
// every test, so paths.js and driver.js are re-evaluated against the new dir.
// (The key-acl-migration-013 harness gets away with `delete global._dbAdapter`
// because it never re-points DATA_DIR between tests; this suite must.)
//
// SECURITY NOTE: the encryption key below is a TEST value, never a live secret.
// Example-only, per the standing decree that no live credential enters a test.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const TEST_BACKUP_KEY = "sentinel-restore-proof-test-key-0123456789";

let tempDir;
let liveAdapter = null;
const originalDataDir = process.env.DATA_DIR;
const originalBackupKey = process.env.VELA_BACKUP_ENCRYPTION_KEY;
const originalApiKeySecret = process.env.API_KEY_SECRET;

beforeEach(() => {
  // Reset FIRST, then point the env, then let each test import dynamically.
  vi.resetModules();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-sentinel-"));
  process.env.DATA_DIR = tempDir;
  process.env.VELA_BACKUP_ENCRYPTION_KEY = TEST_BACKUP_KEY;
  process.env.API_KEY_SECRET = "sentinel-test-secret";
  delete global._dbAdapter;
  liveAdapter = null;
});

afterEach(() => {
  try { liveAdapter?.instance?.close?.(); } catch {}
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  liveAdapter = null;
  delete global._dbAdapter;
  vi.resetModules();
  if (tempDir) { try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {} }
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalBackupKey === undefined) delete process.env.VELA_BACKUP_ENCRYPTION_KEY;
  else process.env.VELA_BACKUP_ENCRYPTION_KEY = originalBackupKey;
  if (originalApiKeySecret === undefined) delete process.env.API_KEY_SECRET;
  else process.env.API_KEY_SECRET = originalApiKeySecret;
});

/** Fresh adapter bound to THIS test's temp DATA_DIR (post-resetModules). */
async function freshAdapter() {
  delete global._dbAdapter;
  const { getAdapter } = await import("@/lib/db/driver.js");
  liveAdapter = await getAdapter();
  return liveAdapter;
}

/**
 * A proxy pool exercising EVERY blob-borne field the rebuild depends on.
 * proxyUrl carries embedded credentials on purpose: the restore must not
 * corrupt it, and milestone 1's redaction work must not silently drop it
 * from a NON-redacted (full-fidelity) backup path.
 */
function sentinelPool(overrides = {}) {
  return {
    id: "sentinel-pool-1",
    name: "Sentinel Restore Proof",
    proxyUrl: "http://sentinel-user:example-pass@192.168.1.20:8080",
    noProxy: "localhost,127.0.0.1",
    type: "socks5",
    isActive: true,
    strictProxy: true,
    testStatus: "ok",
    lastTestedAt: "2026-09-02T00:00:00.000Z",
    lastError: null,
    ...overrides,
  };
}

describe("Sentinel — the backup engine refuses to run without a key", () => {
  it("getBackupEncryptionKey throws when VELA_BACKUP_ENCRYPTION_KEY is unset", async () => {
    delete process.env.VELA_BACKUP_ENCRYPTION_KEY;
    const { getBackupEncryptionKey } = await import("@/lib/db/repos/backupEngine.js");
    expect(() => getBackupEncryptionKey()).toThrow(/VELA_BACKUP_ENCRYPTION_KEY is not set/);
  });

  it("rejects a key below the minimum entropy bound (< 16 chars)", async () => {
    process.env.VELA_BACKUP_ENCRYPTION_KEY = "too-short";
    const { getBackupEncryptionKey } = await import("@/lib/db/repos/backupEngine.js");
    expect(() => getBackupEncryptionKey()).toThrow(/too short/);
  });

  it("accepts the test key at or above the bound", async () => {
    const { getBackupEncryptionKey } = await import("@/lib/db/repos/backupEngine.js");
    expect(getBackupEncryptionKey()).toBe(TEST_BACKUP_KEY);
  });
});

describe("Sentinel — a restore is PROVEN, not merely backed up", () => {
  it("seal → open round-trips: the artifact decrypts and the manifest survives", async () => {
    const { sealArtifact, openArtifact } = await import("@/lib/db/repos/backupEngine.js");
    const plain = Buffer.from(JSON.stringify({ sentinel: "round-trip" }), "utf8");
    const manifest = { created: "2026-09-02T00:00:00.000Z", schemaVersion: 13, trigger: "test" };

    const sealed = sealArtifact(plain, TEST_BACKUP_KEY, manifest);
    const { plain: opened, header } = openArtifact(sealed, TEST_BACKUP_KEY);

    expect(opened.toString("utf8")).toBe(plain.toString("utf8"));
    expect(header?.manifest?.schemaVersion).toBe(13);
  });

  it("open REFUSES a wrong key — AES-256-GCM tag verified before any restore step (S5)", async () => {
    const { sealArtifact, openArtifact } = await import("@/lib/db/repos/backupEngine.js");
    const sealed = sealArtifact(Buffer.from("secret payload", "utf8"), TEST_BACKUP_KEY, { schemaVersion: 13 });

    expect(() => openArtifact(sealed, "a-completely-different-wrong-key")).toThrow();
  });

  // MEASURED BUDGET, not a guess. This test does the full round-trip: adapter
  // boot + the 001–015 migration chain + exportDb + TWO scrypt KDF passes at
  // N=2^17 (~400ms each, measured) + importDb + the pre-restore safety backup
  // (VACUUM INTO a hot file copy). The crypto is only ~825ms of it; the
  // migration chain and the VACUUM dominate. The whole 11-test suite runs in
  // ~7.25s (measured), so this single heavy test is well under 3s. 20s is a
  // ~7× ceiling — headroom for a slow CI runner or the sql.js fallback driver,
  // but NOT so generous that a genuine hang hides for a minute. The default 5s
  // was hit at 5056ms under load; 20s is the honest right-size.
  it("THE PROOF — write a proxy pool, back up, DELETE it, restore, and the blob fields come back byte-exact", { timeout: 20000 }, async () => {
    const db = await freshAdapter();
    const { createProxyPool, getProxyPoolById, deleteProxyPool } = await import("@/lib/db/index.js");
    const { runBackup, restoreBackup } = await import("@/lib/db/repos/backupEngine.js");

    // 1. WRITE the sentinel row
    const original = sentinelPool();
    await createProxyPool(original);
    const before = await getProxyPoolById("sentinel-pool-1");
    expect(before, "precondition: the row must exist before the backup").toBeTruthy();
    expect(before.proxyUrl).toBe(original.proxyUrl);
    expect(before.type).toBe("socks5");

    // 2. SEAL it
    const backup = await runBackup({ trigger: "sentinel-proof" });
    expect(backup.ok).toBe(true);
    expect(fs.existsSync(backup.file)).toBe(true);
    expect(backup.sizeBytes).toBeGreaterThan(0);
    expect(backup.manifest.schemaVersion).toBeGreaterThan(0);

    // 3. DESTROY it — this is the step that makes it a restore proof and not a
    //    no-op read. Without the delete, a passing assertion could be satisfied
    //    by the row simply never having left the live DB.
    await deleteProxyPool("sentinel-pool-1");
    expect(await getProxyPoolById("sentinel-pool-1")).toBeFalsy();

    // 4. RESTORE from the artifact
    const result = await restoreBackup({ artifactId: backup.artifactId, adoptSecrets: false, trigger: "sentinel-proof" });
    expect(result.ok).toBe(true);
    expect(result.artifactId).toBe(backup.artifactId);

    // 5. READ it back and COMPARE — every blob-borne field, exactly
    const after = await getProxyPoolById("sentinel-pool-1");
    expect(after, "the restored row must exist").toBeTruthy();
    expect(after.name).toBe(original.name);
    expect(after.proxyUrl).toBe(original.proxyUrl);
    expect(after.noProxy).toBe(original.noProxy);
    expect(after.type).toBe("socks5");
    expect(after.strictProxy).toBe(true);
    expect(after.isActive).toBe(true);
    expect(after.testStatus).toBe("ok");
    expect(after.lastTestedAt).toBe(original.lastTestedAt);
    expect(db.driver).toBeTruthy();
  });

  it("the restore takes a PRE-RESTORE SAFETY BACKUP and records it (the escape hatch)", async () => {
    await freshAdapter();
    const { createProxyPool } = await import("@/lib/db/index.js");
    const { runBackup, restoreBackup } = await import("@/lib/db/repos/backupEngine.js");

    await createProxyPool(sentinelPool({ id: "sentinel-pool-2", name: "Safety Backup Check" }));
    const backup = await runBackup({ trigger: "sentinel-proof" });
    const result = await restoreBackup({ artifactId: backup.artifactId, trigger: "sentinel-proof" });

    expect(result.ok).toBe(true);
    // sqlite posture keeps a hot file copy via backupDbLite; mysql keeps a JSON
    // snapshot. Either way the manifest must flag that the safety net was taken.
    expect(result.safetyBackupTaken).toBe(true);
  });

  it("REFUSES an artifact whose schema version is newer than this build", async () => {
    await freshAdapter();
    const { runBackup } = await import("@/lib/db/repos/backupEngine.js");
    const { restoreBackup } = await import("@/lib/db/repos/backupEngine.js");
    const { SCHEMA_VERSION } = await import("@/lib/db/schema.js");

    const backup = await runBackup({ trigger: "sentinel-proof" });

    // Forge a manifest claiming a future schema by re-sealing the same payload
    // with a bumped version — the refusal must be on the version check, not the
    // crypto, so re-seal with the CORRECT key.
    const zlib = await import("node:zlib");
    const { sealArtifact, openArtifact } = await import("@/lib/db/repos/backupEngine.js");
    const { plain } = openArtifact(fs.readFileSync(backup.file), TEST_BACKUP_KEY);
    const envelope = JSON.parse(zlib.gunzipSync(plain).toString("utf8"));
    envelope.payload._meta = { ...(envelope.payload._meta || {}), schemaVersion: SCHEMA_VERSION + 1 };
    const forged = sealArtifact(
      zlib.gzipSync(Buffer.from(JSON.stringify(envelope), "utf8"), { level: 9 }),
      TEST_BACKUP_KEY,
      { schemaVersion: SCHEMA_VERSION + 1 }
    );
    fs.writeFileSync(backup.file, forged, { mode: 0o600 });

    await expect(restoreBackup({ artifactId: backup.artifactId, trigger: "sentinel-proof" }))
      .rejects.toThrow(/newer than this build/);
  });

  it("the restore DRILL runs green against a real artifact", async () => {
    await freshAdapter();
    const { createProxyPool } = await import("@/lib/db/index.js");
    const { runBackup, runRestoreDrill } = await import("@/lib/db/repos/backupEngine.js");

    await createProxyPool(sentinelPool({ id: "sentinel-pool-3", name: "Drill Target" }));
    const backup = await runBackup({ trigger: "sentinel-proof" });
    expect(backup.ok).toBe(true);

    const drill = await runRestoreDrill();
    expect(drill.ok, `drill must succeed; got ${JSON.stringify(drill)}`).toBe(true);
    expect(drill.artifactId).toBe(backup.artifactId);
    expect(drill.tableCensus).toBeGreaterThan(0);
  });

  it("the drill reports skipped (not ok) when NO artifact exists — an honest refusal, not a green lie", async () => {
    await freshAdapter();
    const { runRestoreDrill } = await import("@/lib/db/repos/backupEngine.js");

    const drill = await runRestoreDrill();
    expect(drill.ok).toBe(false);
    expect(drill.skipped).toBe("no-artifact");
  });

  it("a MULTIPLE-POOL fleet survives the round-trip with no cross-row bleed", async () => {
    await freshAdapter();
    const { createProxyPool, getProxyPools, deleteProxyPool } = await import("@/lib/db/index.js");
    const engine = await import("@/lib/db/repos/backupEngine.js");

    const pools = [
      sentinelPool({ id: "pool-a", name: "Pool A", type: "http", proxyUrl: "http://192.168.1.21:3128" }),
      sentinelPool({ id: "pool-b", name: "Pool B", type: "socks5", proxyUrl: "socks5://192.168.1.22:1080" }),
      sentinelPool({ id: "pool-c", name: "Pool C", type: "vercel", isActive: false }),
    ];
    for (const p of pools) await createProxyPool(p);

    const backup = await engine.runBackup({ trigger: "sentinel-proof" });
    for (const p of pools) await deleteProxyPool(p.id);
    expect((await getProxyPools()).length).toBe(0);

    const result = await engine.restoreBackup({ artifactId: backup.artifactId, trigger: "sentinel-proof" });
    expect(result.ok).toBe(true);

    const restored = await getProxyPools();
    expect(restored.length).toBe(3);
    const byId = Object.fromEntries(restored.map((r) => [r.id, r]));
    expect(byId["pool-a"].type).toBe("http");
    expect(byId["pool-a"].proxyUrl).toBe("http://192.168.1.21:3128");
    expect(byId["pool-b"].type).toBe("socks5");
    expect(byId["pool-b"].proxyUrl).toBe("socks5://192.168.1.22:1080");
    // the inactive pool must come back STILL inactive — isActive is a real
    // column, not blob-borne, so it exercises the other half of the symmetry
    expect(byId["pool-c"].isActive).toBe(false);
    expect(byId["pool-c"].type).toBe("vercel");
  });
});
