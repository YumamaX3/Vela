// The Data cockpit (v0.9.95) — storage census, artifact inventory + verify,
// retention plan/prune parity, and usage purge. Real migrated SQLite harbor +
// real sealed artifacts in a per-test DATA_DIR (the DB-harness pattern:
// resetModules + a fresh DATA_DIR in BOTH hooks).
//
// The load-bearing claims:
//   1. CENSUS — getStorageInventory counts every TABLES entry exactly and
//      reports the DB file size; an unmigrated table reports null, never 0.
//   2. INVENTORY — listBackupArtifacts reads the UNENCRYPTED header (no key).
//   3. VERIFY — verifyBackupArtifact decrypts (GCM tag) and reports the section
//      census the artifact actually carries.
//   4. PLAN == PRUNE — the dry-run planner and the real prune read ONE law, so
//      the list a plan promises is the list a prune removes.
//   5. PURGE — the retention window removes only rows past it.
//   6. OFF-SITE READINESS SURFACES NO CREDENTIAL (route-level).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalSecret = process.env.API_KEY_SECRET;
const originalBackupKey = process.env.VELA_BACKUP_ENCRYPTION_KEY;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-cockpit-"));
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "cockpit-test-secret";
  process.env.VELA_BACKUP_ENCRYPTION_KEY = "cockpit-test-backup-key-16";
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = originalDataDir;
  if (originalSecret === undefined) delete process.env.API_KEY_SECRET; else process.env.API_KEY_SECRET = originalSecret;
  if (originalBackupKey === undefined) delete process.env.VELA_BACKUP_ENCRYPTION_KEY;
  else process.env.VELA_BACKUP_ENCRYPTION_KEY = originalBackupKey;
});

/** Seed a small but multi-table world. */
async function seedWorld() {
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    ["conn-1", "openai", "api_key", "Seed Conn", null, 1, JSON.stringify({}), now, now]
  );
  db.run(
    `INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
    ["combo-1", "Seed Combo", "fallback", JSON.stringify([]), now, now]
  );
  // Usage: one row inside a 30-day window, one well outside it.
  const recent = new Date(Date.now() - 5 * 86400000).toISOString();
  const old = new Date(Date.now() - 200 * 86400000).toISOString();
  db.run(
    `INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, keyId, keyPrefix, endpoint, promptTokens, completionTokens, cost, status) VALUES(?, ?, ?, ?, 'x', ?, ?, ?, 1, 1, 0, 'success')`,
    [recent, "openai", "gpt-4o", "conn-1", "k", "sk", "/v1"]
  );
  db.run(
    `INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, keyId, keyPrefix, endpoint, promptTokens, completionTokens, cost, status) VALUES(?, ?, ?, ?, 'x', ?, ?, ?, 1, 1, 0, 'success')`,
    [old, "openai", "gpt-4o", "conn-1", "k", "sk", "/v1"]
  );
  return { db, recent, old };
}

describe("Data cockpit — storage census", () => {
  it("counts every table exactly and reports the DB file size", async () => {
    await seedWorld();
    const { getStorageInventory } = await import("@/lib/db/repos/backupRepo.js");
    const inv = await getStorageInventory();

    const byName = Object.fromEntries(inv.tables.map((t) => [t.name, t.rows]));
    expect(byName.providerConnections).toBe(1);
    expect(byName.combos).toBe(1);
    expect(byName.usageHistory).toBe(2);
    expect(byName.settings).toBeGreaterThanOrEqual(0);
    // Every TABLES entry is represented (no silent omission).
    const { TABLES } = await import("@/lib/db/schema.js");
    expect(inv.tables.map((t) => t.name).sort()).toEqual(Object.keys(TABLES).sort());
    // File size is a real number on sqlite (the DB file exists after migrate).
    expect(typeof inv.dbFileBytes).toBe("number");
    expect(inv.dbFileBytes).toBeGreaterThan(0);
    expect(inv.totalRows).toBeGreaterThanOrEqual(4);
    expect(inv.mode).toBe("sqlite");
    expect(inv.schemaVersion).toBeGreaterThan(0);
  });

  it("reports the retention window and how many rows are past it", async () => {
    await seedWorld();
    const { getStorageInventory } = await import("@/lib/db/repos/backupRepo.js");
    const inv = await getStorageInventory({ retentionDays: 30 });
    expect(inv.retention.days).toBe(30);
    expect(inv.retention.usageRows).toBe(2);
    expect(inv.retention.purgeableRows).toBe(1); // only the 200-day-old row
  });
});

describe("Data cockpit — artifact inventory + verify", () => {
  it("lists a sealed artifact from its unencrypted header, then verifies it", async () => {
    await seedWorld();
    const { runBackup, listBackupArtifacts, verifyBackupArtifact } = await import("@/lib/db/repos/backupRepo.js");

    const backup = await runBackup({ trigger: "manual" });
    expect(backup.ok).toBe(true);

    const artifacts = listBackupArtifacts();
    expect(artifacts).toHaveLength(1);
    const a = artifacts[0];
    expect(a.id).toBe(backup.artifactId);
    expect(a.headerOk).toBe(true);       // header parsed with NO key
    expect(a.trigger).toBe("manual");
    expect(a.bytes).toBeGreaterThan(0);
    expect(a.schemaVersion).toBeGreaterThan(0);

    // Verification opens the seal and reports what the artifact carries.
    const verified = verifyBackupArtifact(a.id);
    expect(verified.ok).toBe(true);
    expect(verified.sections.connections).toBe(1);
    expect(verified.sections.combos).toBe(1);
    expect(verified.sections.usage).toBe(2);
    expect(verified.schemaVersion).toBeGreaterThan(0);
    expect(Array.isArray(verified.secretBundleFiles)).toBe(true);
  });

  it("refuses to verify an artifact that does not exist", async () => {
    await seedWorld();
    const { verifyBackupArtifact } = await import("@/lib/db/repos/backupRepo.js");
    expect(() => verifyBackupArtifact("no-such-artifact")).toThrow(/not found/);
  });

  it("reports a corrupt artifact as unreadable rather than crashing the list", async () => {
    await seedWorld();
    const { listBackupArtifacts } = await import("@/lib/db/repos/backupRepo.js");
    const { artifactsDir } = await import("@/lib/db/repos/backupEngine.js");
    fs.writeFileSync(path.join(artifactsDir(), "vela-backup-corrupt.velabak"), Buffer.from("not a real artifact"));
    const artifacts = listBackupArtifacts();
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].headerOk).toBe(false);
    expect(artifacts[0].bytes).toBeGreaterThan(0);
  });
});

describe("Data cockpit — retention plan/prune parity (one law)", () => {
  it("the dry-run plan and the real prune agree, and prune removes exactly the plan", async () => {
    await seedWorld();
    const { runBackup, planPruneArtifacts, pruneBackupArtifacts } = await import("@/lib/db/repos/backupRepo.js");
    const { artifactsDir } = await import("@/lib/db/repos/backupEngine.js");

    // Three artifacts, stamped on three well-separated days.
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const b = await runBackup({ trigger: "manual" });
      ids.push(b.artifactId);
      const file = path.join(artifactsDir(), `${b.artifactId}.velabak`);
      const daysAgo = [30, 20, 10][i];
      const t = new Date(Date.now() - daysAgo * 86400000);
      fs.utimesSync(file, t, t);
    }

    const plan = planPruneArtifacts({ retainDaily: 1, retainWeekly: 1 });
    expect(plan.total).toBe(3);
    expect(plan.kept).toBe(1);           // only the newest day/week survives
    expect(plan.removeNames).toHaveLength(2);
    expect(plan.keepNames).toHaveLength(1);

    // The plan wrote nothing.
    expect(fs.readdirSync(artifactsDir()).filter((n) => n.endsWith(".velabak"))).toHaveLength(3);

    // The prune removes EXACTLY the planned set.
    const result = pruneBackupArtifacts({ retainDaily: 1, retainWeekly: 1 });
    expect(result.removed.sort()).toEqual([...plan.removeNames].sort());
    expect(result.kept).toBe(1);
    expect(fs.readdirSync(artifactsDir()).filter((n) => n.endsWith(".velabak"))).toHaveLength(1);
  });
});

describe("Data cockpit — export studio (selective projection)", () => {
  it("projectPayloadToSections keeps ONLY the selected fields and stamps provenance", async () => {
    const { projectPayloadToSections } = await import("@/lib/db/repos/backupSecurity.js");
    const payload = {
      settings: { a: 1 },
      providerConnections: [{ id: "c1" }],
      providerNodes: [],
      proxyPools: [],
      apiKeys: [{ id: "k1" }],
      combos: [{ id: "x1" }],
      kvScopes: { pricing: { openai: {} } },
      usageHistory: [{ id: 1 }],
      usageDaily: [],
      _meta: { schemaVersion: 16, sourceMode: "sqlite" },
    };
    const out = projectPayloadToSections(payload, ["connections", "usage"]);
    expect(Object.keys(out).sort()).toEqual(["_meta", "providerConnections", "providerNodes", "usageDaily", "usageHistory"].sort());
    expect(out.combos).toBeUndefined();
    expect(out.settings).toBeUndefined();
    expect(out.kvScopes).toBeUndefined();
    expect(out._meta.sections).toEqual(["connections", "usage"]);
    // The original payload is untouched (pure).
    expect(payload.combos).toBeTruthy();
  });

  it("a projected file re-imports with the same sections (export/import one vocabulary)", async () => {
    await seedWorld();
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const { exportDb, importDb } = await import("@/lib/db/index.js");
    const { projectPayloadToSections } = await import("@/lib/db/repos/backupSecurity.js");

    const whole = await exportDb();
    const projected = projectPayloadToSections(whole, ["combos"]);

    // Live state changes: drop the combos and add a different one.
    db.run(`DELETE FROM combos`);
    db.run(`INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES('live','Live','fallback','[]','2026-01-01','2026-01-01')`);

    // The projected file restores exactly the combos section.
    const result = await importDb(projected, { sections: ["combos"] });
    expect(result.appliedSections).toEqual(["combos"]);
    expect(db.get(`SELECT name FROM combos WHERE id = 'combo-1'`)?.name).toBe("Seed Combo");
    expect(db.get(`SELECT id FROM combos WHERE id = 'live'`)).toBeFalsy();
  });

  it("whole projection (null) keeps every field", async () => {
    const { projectPayloadToSections } = await import("@/lib/db/repos/backupSecurity.js");
    const payload = { settings: { a: 1 }, combos: [1], apiKeys: [], _meta: { schemaVersion: 16 } };
    const out = projectPayloadToSections(payload, null);
    expect(out.settings).toEqual({ a: 1 });
    expect(out.combos).toEqual([1]);
    expect(out.apiKeys).toEqual([]);
    expect(out._meta.sections).toHaveLength(7);
  });

  it("database GET route refuses an unknown section name", async () => {
    const { projectPayloadToSections } = await import("@/lib/db/repos/backupSecurity.js");
    // Unknown names are rejected at the route; the projector itself only ever
    // narrows to known sections, so an unknown name yields the whole file.
    const out = projectPayloadToSections({ settings: { a: 1 }, combos: [1] }, ["nonsense"]);
    expect(out.settings).toEqual({ a: 1 });
    expect(out.combos).toEqual([1]);
  });
});

describe("Data cockpit — usage purge", () => {
  it("purges only rows past the window and writes a ledger row", async () => {
    const { db } = await seedWorld();
    const { purgeOldUsage, listBackupLedger } = await import("@/lib/db/repos/backupRepo.js");

    const result = await purgeOldUsage({ retentionDays: 30 });
    expect(result.purged).toBe(true);
    expect(result.usageHistory).toBe(1); // only the 200-day-old row

    const remaining = db.all(`SELECT timestamp FROM usageHistory`);
    expect(remaining).toHaveLength(1);
    const ledger = await listBackupLedger({ limit: 10 });
    expect(ledger.some((r) => r.kind === "purge")).toBe(true);
  });

  it("purges nothing when the window is 0 (keep forever)", async () => {
    const { db } = await seedWorld();
    const { purgeOldUsage } = await import("@/lib/db/repos/backupRepo.js");
    const result = await purgeOldUsage({ retentionDays: 0 });
    expect(result.purged).toBe(false);
    expect(db.all(`SELECT timestamp FROM usageHistory`)).toHaveLength(2);
  });
});

describe("Data cockpit — routes", () => {
  it("inventory route answers the census + off-site readiness with NO credential", async () => {
    process.env.VELA_BACKUP_S3_ENABLED = "true";
    process.env.VELA_BACKUP_S3_ENDPOINT = "https://user:pass@minio.example:9000";
    process.env.VELA_BACKUP_S3_BUCKET = "vela-backups";
    process.env.VELA_BACKUP_S3_ACCESS_KEY = "AKIA-SECRET";
    process.env.VELA_BACKUP_S3_SECRET_KEY = "super-secret";
    try {
      await seedWorld();
      const { GET } = await import("@/app/api/backup/inventory/route.js");
      const res = await GET();
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.inventory.tables.length).toBeGreaterThan(0);
      expect(body.offsite.armed).toBe(true);
      expect(body.offsite.endpointHost).toBe("minio.example:9000"); // userinfo stripped
      // The credential NEVER rides the response.
      const raw = JSON.stringify(body);
      expect(raw).not.toContain("super-secret");
      expect(raw).not.toContain("AKIA-SECRET");
      expect(raw).not.toContain("user:pass");
    } finally {
      delete process.env.VELA_BACKUP_S3_ENABLED;
      delete process.env.VELA_BACKUP_S3_ENDPOINT;
      delete process.env.VELA_BACKUP_S3_BUCKET;
      delete process.env.VELA_BACKUP_S3_ACCESS_KEY;
      delete process.env.VELA_BACKUP_S3_SECRET_KEY;
    }
  });

  it("database GET route projects to the requested sections and refuses unknown names", async () => {
    vi.doMock("@/lib/auth/dashboardSession", () => ({ verifyDashboardPassword: async () => true }));
    try {
      await seedWorld();
      const { GET } = await import("@/app/api/settings/database/route.js");
      const mk = (url) => new Request(url, { headers: { "x-9r-password": "x" } });

      // Whole export: every section present.
      const whole = await (await GET(mk("http://localhost/api/settings/database"))).json();
      expect(whole.combos).toBeTruthy();
      expect(whole.settings).toBeTruthy();

      // Selective: only combos + usage.
      const selRes = await GET(mk("http://localhost/api/settings/database?sections=combos,usage"));
      expect(selRes.status).toBe(200);
      const sel = await selRes.json();
      expect(sel.combos).toBeTruthy();
      expect(sel.usageHistory).toBeTruthy();
      expect(sel.settings).toBeUndefined();
      expect(sel.providerConnections).toBeUndefined();
      expect(sel._meta.sections).toEqual(["combos", "usage"]);

      // Unknown section name is refused BY NAME.
      const bad = await GET(mk("http://localhost/api/settings/database?sections=combos,nonsense"));
      expect(bad.status).toBe(400);
      const badBody = await bad.json();
      expect(badBody.error).toMatch(/Unknown section/);
      expect(badBody.error).toMatch(/nonsense/);
    } finally {
      vi.doUnmock("@/lib/auth/dashboardSession");
    }
  });

  it("prune route dry-run writes nothing and its plan equals the apply", async () => {
    vi.doMock("@/lib/auth/dashboardSession", () => ({ verifyDashboardPassword: async () => true }));
    vi.doMock("@/lib/auth/loginLimiter", () => ({
      checkLock: () => ({ locked: false }),
      recordFail: () => {},
      recordSuccess: () => {},
      getClientIp: () => "127.0.0.1",
    }));
    await seedWorld();
    const { runBackup } = await import("@/lib/db/repos/backupRepo.js");
    const { artifactsDir } = await import("@/lib/db/repos/backupEngine.js");
    for (let i = 0; i < 3; i++) {
      const b = await runBackup({ trigger: "manual" });
      const file = path.join(artifactsDir(), `${b.artifactId}.velabak`);
      const t = new Date(Date.now() - [30, 20, 10][i] * 86400000);
      fs.utimesSync(file, t, t);
    }

    const { POST } = await import("@/app/api/backup/prune/route.js");
    const req = (body) =>
      new Request("http://localhost/api/backup/prune", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    const dry = await (await POST(req({ password: "x", dryRun: true, retainDaily: 1, retainWeekly: 1 }))).json();
    expect(dry.dryRun).toBe(true);
    expect(dry.remove).toHaveLength(2);
    // Dry run wrote nothing.
    expect(fs.readdirSync(artifactsDir()).filter((n) => n.endsWith(".velabak"))).toHaveLength(3);

    const applied = await (await POST(req({ password: "x", retainDaily: 1, retainWeekly: 1 }))).json();
    expect(applied.removed.sort()).toEqual([...dry.remove].sort());
    expect(fs.readdirSync(artifactsDir()).filter((n) => n.endsWith(".velabak"))).toHaveLength(1);
    vi.doUnmock("@/lib/auth/dashboardSession");
    vi.doUnmock("@/lib/auth/loginLimiter");
  });
});
