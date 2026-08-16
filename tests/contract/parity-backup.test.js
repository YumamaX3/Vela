// Storage Covenant Wave B2 — the backup engine exit gate.
// Plan: plans/storage-covenant.md Wave B + Tidebreaker S1–S7 + line 430-433
// ("B gates must include negative tests: wrong-key restore → GCM tag refusal;
// truncated artifact → refusal; missing VELA_BACKUP_ENCRYPTION_KEY with
// enabled=true → loud boot refusal; retention pruning on synthetic mtime
// fixtures; purge on both engines with fixed-date fixtures").
//
// This suite proves the sqlite leg end-to-end. The mysql leg of purge/restore
// lands with Wave B4's mysql backupRepo twin (named in EXEMPT_PROCESS).
//
// What is pinned here:
//   1. CRYPTO — scrypt N=2^17/r=8/p=1 key derivation, AES-256-GCM round-trip,
//      wrong-key refusal, tamper refusal, truncation refusal, magic refusal.
//   2. KEY LAW — missing/short VELA_BACKUP_ENCRYPTION_KEY refuses LOUD.
//   3. ENGINE — runBackup → artifact file + ledger row; restoreBackup →
//      payload round-trips; pre-restore safety backup taken; restartRequired
//      when a secret bundle restored; schema-newer refusal.
//   4. S1 — RESTORE-QUARANTINED fields (settings.password/requireLogin/
//      authMode/oidc*, apiKeys keyHash/isInternal/deletedAt) preserve CURRENT
//      values by default; restore from payload only under adoptSecrets.
//   5. S2 — SECRET_SETTING_KEYS redacted from exportDb()/exportSettings();
//      non-secret completeness preserved.
//   6. S3 — backupLedger (+ future outbox) excluded from exportDb BY NAME;
//      ledger rows live in the DB but never in an artifact.
//   7. DRILL — restore drill decrypts into a scratch DB, smoke-checks it, and
//      never touches the live database.
//   8. RETENTION — synthetic-mtime fixtures prune per retainDaily/retainWeekly.
//   9. PURGE — VELA_USAGE_RETENTION_DAYS purges old usageHistory batched.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const KEY = "backup-exit-gate-key-0123456789"; // ≥16 chars → passes min-entropy

let tempDir;
const saved = {};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-b2-"));
  saved.DATA_DIR = process.env.DATA_DIR;
  saved.API_KEY_SECRET = process.env.API_KEY_SECRET;
  saved.KEY = process.env.VELA_BACKUP_ENCRYPTION_KEY;
  saved.MODE = process.env.VELA_DB_MODE;
  saved.URL = process.env.VELA_MYSQL_URL;
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "b2-test-api-secret";
  process.env.VELA_BACKUP_ENCRYPTION_KEY = KEY;
  delete process.env.VELA_DB_MODE;
  delete process.env.VELA_MYSQL_URL;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function freshDb() {
  const db = await import("@/lib/db/index.js");
  await db.initDb();
  return db;
}

/** Seed a small world: settings WITH secrets, one combo, one apiKeys row,
 *  one kv scope, one usage row. Returns the barrel module. */
async function seedWorld() {
  // A real install generates these secret files under DATA_DIR on first use
  // (dashboardSession loadJwtSecret / apiKey getApiKeySecret / machineId).
  // Mirror that so the secret-file bundle capture + restore have cargo to carry.
  for (const [name, content] of [
    ["jwt-secret", "b2-jwt-secret-value"],
    ["api-key-secret", "b2-api-key-secret-value"],
    ["machine-id", "b2-machine-id-value"],
  ]) {
    fs.writeFileSync(path.join(tempDir, name), content, { mode: 0o600 });
  }
  const db = await freshDb();
  await db.updateSettings({
    password: "current-pass",
    requireLogin: true,
    authMode: "password",
    oidcClientSecret: "current-oidc-secret",
    cloudEnabled: false,
    comboStrategy: "fallback",
  });
  await db.createCombo({ name: "b2-combo", models: ["gpt-test"] });
  const { getAdapter } = await import("@/lib/db/driver.js");
  const adapter = await getAdapter();
  adapter.run(
    `INSERT INTO apiKeys(id, key, name, isActive, createdAt, keyHash, keyPrefix, isInternal, deletedAt) VALUES(?, ?, ?, 1, ?, ?, ?, 0, NULL)`,
    ["key-live", "restored-key-live", "live key", new Date().toISOString(), "live-hash", "vela-v1"]
  );
  adapter.run(`INSERT INTO kv(scope, key, value) VALUES('b2scope', 'k1', '"v1"')`);
  // usageHistory.id is INTEGER PRIMARY KEY AUTOINCREMENT — integer ids only.
  adapter.run(
    `INSERT INTO usageHistory(id, timestamp, provider, model, connectionId, apiKey, keyId, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(1, ?, 'openai', 'gpt-test', 'c1', NULL, 'key-live', 10, 5, 0.001, 'ok', '{}', '{}')`,
    [new Date().toISOString()]
  );
  return db;
}

describe("Wave B2 — S5 crypto spec", () => {
  it("seal → open round-trips (correct key)", async () => {
    const { sealArtifact, openArtifact } = await import("@/lib/db/repos/sqlite/backupRepo.js");
    const plain = Buffer.from(JSON.stringify({ hello: "shores" }), "utf8");
    const sealed = sealArtifact(plain, KEY, { schemaVersion: 7 });
    const { plain: opened, header } = openArtifact(sealed, KEY);
    expect(opened.toString("utf8")).toBe(plain.toString("utf8"));
    expect(header.manifest.schemaVersion).toBe(7); // round-trips what was sealed — not a live-census pin
    expect(header.kdf).toBe("scrypt");
    expect(header.N).toBe(2 ** 17);
    expect(header.r).toBe(8);
    expect(header.p).toBe(1);
  }, 60000);

  it("wrong key refuses — GCM tag mismatch", async () => {
    const { sealArtifact, openArtifact } = await import("@/lib/db/repos/sqlite/backupRepo.js");
    const sealed = sealArtifact(Buffer.from("secret cargo"), KEY, {});
    expect(() => openArtifact(sealed, "a-different-key-0123456789")).toThrow(
      /authentication failed|wrong key|tampered/i
    );
  }, 60000);

  it("tampered ciphertext refuses", async () => {
    const { sealArtifact, openArtifact } = await import("@/lib/db/repos/sqlite/backupRepo.js");
    const sealed = sealArtifact(Buffer.from("integrity cargo"), KEY, {});
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 20] ^= 0xff; // flip one ciphertext byte
    expect(() => openArtifact(tampered, KEY)).toThrow(/authentication failed|tampered/i);
  }, 60000);

  it("truncated artifact refuses", async () => {
    const { sealArtifact, openArtifact } = await import("@/lib/db/repos/sqlite/backupRepo.js");
    const sealed = sealArtifact(Buffer.from("truncation cargo"), KEY, {});
    expect(() => openArtifact(sealed.subarray(0, 30), KEY)).toThrow(/truncated|malformed|magic/i);
  }, 60000);

  it("magic mismatch refuses", async () => {
    const { openArtifact } = await import("@/lib/db/repos/sqlite/backupRepo.js");
    const junk = Buffer.concat([Buffer.from("NOTAVELA"), Buffer.alloc(64)]);
    expect(() => openArtifact(junk, KEY)).toThrow(/magic mismatch/i);
  });

  it("missing VELA_BACKUP_ENCRYPTION_KEY refuses LOUD", async () => {
    delete process.env.VELA_BACKUP_ENCRYPTION_KEY;
    const { getBackupEncryptionKey, runBackup } = await import("@/lib/db/repos/sqlite/backupRepo.js");
    expect(() => getBackupEncryptionKey()).toThrow(/VELA_BACKUP_ENCRYPTION_KEY is not set/i);
    await seedWorld();
    await expect(runBackup()).rejects.toThrow(/VELA_BACKUP_ENCRYPTION_KEY is not set/i);
  });

  it("short key fails minimum-entropy validation", async () => {
    process.env.VELA_BACKUP_ENCRYPTION_KEY = "short";
    const { getBackupEncryptionKey } = await import("@/lib/db/repos/sqlite/backupRepo.js");
    expect(() => getBackupEncryptionKey()).toThrow(/too short|minimum-entropy/i);
  });
});

describe("Wave B2 — the backup engine round-trip", () => {
  it("runBackup writes an artifact + ledger row; restoreBackup round-trips", async () => {
    const db = await seedWorld();
    const result = await db.runBackup({ trigger: "test" });
    expect(result.ok).toBe(true);
    expect(fs.existsSync(result.file)).toBe(true);
    expect(result.manifest.schemaVersion).toBe(8);
    expect(result.manifest.secretBundle.length).toBeGreaterThan(0);

    // Mutate the live DB, then restore — the payload comes back.
    await db.updateSettings({ comboStrategy: "roundrobin" });
    const restored = await db.restoreBackup({ artifactId: result.artifactId });
    expect(restored.ok).toBe(true);
    expect(restored.restartRequired).toBe(true); // secret bundle restored (S6)
    expect(restored.safetyBackupTaken).toBe(true);

    const settings = await db.getSettings();
    expect(settings.comboStrategy).toBe("fallback"); // pre-mutation value is back
    const combos = await db.getCombos();
    expect(combos.some((c) => c.name === "b2-combo")).toBe(true);

    // The ledger records both events, metadata-only (S4: no error field out).
    const ledger = await db.listBackupLedger();
    expect(ledger.some((r) => r.kind === "backup" && r.artifactId === result.artifactId)).toBe(true);
    expect(ledger.some((r) => r.kind === "restore")).toBe(true);
    for (const row of ledger) expect("error" in row).toBe(false);
  }, 120000);

  it("restoreBackup refuses an artifact newer than this build", async () => {
    const db = await seedWorld();
    const { sealArtifact, artifactsDir } = await import("@/lib/db/repos/sqlite/backupRepo.js");
    const futurePayload = { _meta: { schemaVersion: 99 }, settings: {}, apiKeys: [] };
    const plain = zlib.gzipSync(Buffer.from(JSON.stringify({ payload: futurePayload, secretBundle: null }), "utf8"));
    const sealed = sealArtifact(plain, KEY, { schemaVersion: 99 });
    fs.writeFileSync(path.join(artifactsDir(), "future.velabak"), sealed);
    await expect(db.restoreBackup({ artifactId: "future" })).rejects.toThrow(/newer than this build/i);
  }, 60000);

  it("restoreBackup refuses a wrong-key artifact end-to-end", async () => {
    const db = await seedWorld();
    const result = await db.runBackup({ trigger: "test" });
    process.env.VELA_BACKUP_ENCRYPTION_KEY = "another-key-entirely-0123456789";
    await expect(db.restoreBackup({ artifactId: result.artifactId })).rejects.toThrow(
      /authentication failed|wrong key|tampered/i
    );
  }, 120000);
});

describe("Wave B2 — S1 restore is a trust crossing", () => {
  function hostilePayload(currentExport) {
    return {
      ...currentExport,
      settings: {
        ...currentExport.settings,
        password: "attacker-pass",
        requireLogin: false,
        authMode: "oidc",
        oidcClientSecret: "attacker-oidc",
      },
      apiKeys: (currentExport.apiKeys || []).map((k) => ({
        ...k,
        keyHash: "attacker-hash",
        isInternal: true,
        deletedAt: null,
      })),
    };
  }

  it("default path preserves CURRENT quarantined values", async () => {
    const db = await seedWorld();
    const exportBefore = await db.exportDb();
    const hostile = hostilePayload(exportBefore);
    await db.importDb(hostile); // no adoptSecrets

    const { getAdapter } = await import("@/lib/db/driver.js");
    const adapter = await getAdapter();
    const raw = JSON.parse(adapter.get(`SELECT data FROM settings WHERE id = 1`).data);
    expect(raw.password).toBe("current-pass"); // quarantined — kept
    expect(raw.requireLogin).toBe(true);
    expect(raw.authMode).toBe("password");
    expect(raw.oidcClientSecret).toBe("current-oidc-secret");
    expect(raw.comboStrategy).toBe("fallback"); // non-quarantined restores fine

    const keyRow = adapter.get(`SELECT keyHash, isInternal, deletedAt FROM apiKeys WHERE id = 'key-live'`);
    expect(keyRow.keyHash).toBe("live-hash"); // quarantined — kept
    expect(keyRow.isInternal).toBe(0);
    expect(keyRow.deletedAt).toBeNull();
  });

  it("adoptSecrets restores the quarantined fields from the payload", async () => {
    const db = await seedWorld();
    const exportBefore = await db.exportDb();
    const hostile = hostilePayload(exportBefore);
    await db.importDb(hostile, { adoptSecrets: true });

    const { getAdapter } = await import("@/lib/db/driver.js");
    const adapter = await getAdapter();
    const raw = JSON.parse(adapter.get(`SELECT data FROM settings WHERE id = 1`).data);
    expect(raw.password).toBe("attacker-pass"); // adopted under the explicit flag
    expect(raw.requireLogin).toBe(false);
    const keyRow = adapter.get(`SELECT keyHash, isInternal FROM apiKeys WHERE id = 'key-live'`);
    expect(keyRow.keyHash).toBe("attacker-hash");
    expect(keyRow.isInternal).toBe(1);
  });

  it("payload bounds + shape refuse hostile shapes before any write", async () => {
    const db = await seedWorld();
    await expect(db.importDb(null)).rejects.toThrow(/Invalid database payload/i);
    await expect(db.importDb({ apiKeys: "not-an-array" })).rejects.toThrow(/must be an array/i);
    await expect(db.importDb({ settings: [1, 2, 3] })).rejects.toThrow(/must be an object/i);
    // The DB must be untouched after refusals.
    const settings = await db.getSettings();
    expect(settings.password).toBe("current-pass");
  });
});

describe("Wave B2 — S2 redaction + S3 exclusions", () => {
  it("exportDb redacts SECRET_SETTING_KEYS and keeps completeness", async () => {
    const db = await seedWorld();
    const payload = await db.exportDb();
    expect(payload.settings.password).toBe("[REDACTED]");
    expect(payload.settings.oidcClientSecret).toBe("[REDACTED]");
    // Non-secret completeness preserved
    expect(payload.settings.authMode).toBe("password");
    expect(payload.settings.requireLogin).toBe(true);
    expect(payload.kvScopes.b2scope).toEqual({ k1: "v1" });
    expect(payload.combos.some((c) => c.name === "b2-combo")).toBe(true);
    expect(payload._meta.schemaVersion).toBe(8);
  });

  it("exportSettings redacts at the source", async () => {
    const db = await seedWorld();
    const exported = await db.exportSettings();
    expect(exported.password).toBe("[REDACTED]");
    expect(exported.oidcClientSecret).toBe("[REDACTED]");
    expect(exported.comboStrategy).toBe("fallback");
  });

  it("S3 — backupLedger + outbox excluded from exportDb BY NAME", async () => {
    const db = await seedWorld();
    const { EXPORT_EXCLUDED_TABLES } = await import("@/lib/db/repos/sqlite/backupRepo.js");
    expect(EXPORT_EXCLUDED_TABLES).toContain("backupLedger");
    expect(EXPORT_EXCLUDED_TABLES).toContain("outbox"); // Wave C table named BEFORE it exists

    // Write a real ledger row, then prove it never leaves via export.
    await db.runBackup({ trigger: "exclusion-proof" });
    const payload = await db.exportDb();
    expect(payload.backupLedger).toBeUndefined();
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("exclusion-proof"); // ledger meta never leaks
  }, 120000);
});

describe("Wave B2 — restore drill", () => {
  it("drills the newest artifact into a scratch DB without touching live state", async () => {
    const db = await seedWorld();
    await db.runBackup({ trigger: "drill-source" });
    const result = await db.runRestoreDrill();
    expect(result.ok).toBe(true);
    expect(result.tableCensus).toBeGreaterThan(8);

    // Live DB untouched — the seeded world still stands.
    const settings = await db.getSettings();
    expect(settings.password).toBe("current-pass");
    const ledger = await db.listBackupLedger();
    expect(ledger.some((r) => r.kind === "drill" && r.status === "ok")).toBe(true);
  }, 120000);

  it("drill with no artifacts reports skipped honestly", async () => {
    const db = await freshDb();
    const result = await db.runRestoreDrill();
    expect(result.ok).toBe(false);
    expect(result.skipped).toBe("no-artifact");
  });
});

describe("Wave B2 — retention + purge", () => {
  it("prunes by mtime per retainDaily/retainWeekly tiers", async () => {
    const db = await freshDb();
    const { artifactsDir, pruneBackupArtifacts } = await import("@/lib/db/repos/sqlite/backupRepo.js");
    const dir = artifactsDir();
    const now = Date.now();
    const mk = (name, ageDays) => {
      const p = path.join(dir, name);
      fs.writeFileSync(p, Buffer.from("synthetic"));
      const t = new Date(now - ageDays * 86400000);
      fs.utimesSync(p, t, t);
    };
    mk("old-9d.velabak", 9);
    mk("old-5d.velabak", 5);
    mk("fresh-0d.velabak", 0);

    const result = pruneBackupArtifacts({ retainDaily: 1, retainWeekly: 0 });
    expect(result.removed.sort()).toEqual(["old-5d.velabak", "old-9d.velabak"]);
    expect(result.kept).toBe(1);
    expect(fs.existsSync(path.join(dir, "fresh-0d.velabak"))).toBe(true);
  });

  it("purgeOldUsage removes only rows older than retentionDays (batched)", async () => {
    const db = await seedWorld();
    const { getAdapter } = await import("@/lib/db/driver.js");
    const adapter = await getAdapter();
    const oldTs = new Date(Date.now() - 100 * 86400000).toISOString();
    adapter.run(
      `INSERT INTO usageHistory(id, timestamp, provider, model, connectionId, apiKey, keyId, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(999, ?, 'openai', 'gpt-old', 'c1', NULL, '', 1, 1, 0, 'ok', '{}', '{}')`,
      [oldTs]
    );
    const result = await db.purgeOldUsage({ retentionDays: 30 });
    expect(result.purged).toBe(true);
    expect(result.usageHistory).toBe(1); // uh-old (999) purged, uh-1 (1, fresh) kept
    const remaining = adapter.all(`SELECT id FROM usageHistory ORDER BY id`);
    expect(remaining.map((r) => r.id)).toEqual([1]);
    // The ledger records the purge.
    const ledger = await db.listBackupLedger();
    expect(ledger.some((r) => r.kind === "purge")).toBe(true);
  });

  it("purge with retentionDays=0 keeps forever", async () => {
    const db = await seedWorld();
    const result = await db.purgeOldUsage({ retentionDays: 0 });
    expect(result.purged).toBe(false);
  });
});

describe("Wave B2 — migration 005 + posture refusals", () => {
  it("a fresh DB migrates to schemaVersion 8 with backupLedger", async () => {
    await freshDb();
    const { getAdapter } = await import("@/lib/db/driver.js");
    const adapter = await getAdapter();
    expect(adapter.get(`SELECT value FROM _meta WHERE key = 'schemaVersion'`).value).toBe("8");
    const tables = adapter.all(`SELECT name FROM sqlite_master WHERE type='table'`).map((r) => r.name);
    expect(tables).toContain("backupLedger");
  });

  it("mysql posture refuses the backup engine LOUD (boot gate validates first)", async () => {
    process.env.VELA_DB_MODE = "mysql";
    // Unreachable URL → the assertHarborBound boot gate fails loud at the
    // reachability probe (never a silent downgrade, never a sqlite export).
    process.env.VELA_MYSQL_URL = "mysql://u:p@127.0.0.1:1/vela";
    const db = await import("@/lib/db/index.js");
    await expect(db.runBackup()).rejects.toThrow(/mysql|ECONNREFUSED|connect|refused/i);
    // restoreBackup validates artifact existence BEFORE posture dispatch
    // (engine law) — with no artifacts it refuses loud regardless of posture.
    await expect(db.restoreBackup()).rejects.toThrow(/artifact not found/i);
  }, 30000);

  it("mirror posture refuses LOUD", async () => {
    process.env.VELA_DB_MODE = "mirror";
    const db = await import("@/lib/db/index.js");
    await expect(db.runBackup()).rejects.toThrow(/Wave C|refusal/i);
  });
});
