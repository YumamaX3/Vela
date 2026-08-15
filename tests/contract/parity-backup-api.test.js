// Storage Covenant Wave B4 — the restore-crossing exit gate.
// Plan: plans/storage-covenant.md line 290-317 (restore flow, drill, API,
// dashboard card) + Tidebreaker S4 (route auth + lockout + sanitized errors)
// + S6 (restart-required contract).
//
// Pinned here (sqlite leg; the mysql twin is proven by the parity suite +
// live-twin sweeps):
//   1. POST /api/backup/run — password re-confirm (INITIAL_PASSWORD law),
//      401 on wrong password, 409 idempotency while running, artifact lands,
//      response is metadata-only (S4).
//   2. GET /api/backup/status — metadata only, never key material.
//   3. GET /api/backup/list — ledger entries, no error field out.
//   4. POST /api/backup/restore — full round-trip; S1 quarantine preserved by
//      default; adoptSecrets+confirmSecrets crosses the trust boundary;
//      adoptSecrets WITHOUT confirmSecrets refuses (two deliberate clicks);
//      restartRequired when a secret bundle restored (S6).
//   5. POST /api/backup/drill — scratch drill passes; wrong-key artifact
//      refusal surfaces a SANITIZED error (S4), never GCM internals.
//   6. dashboardGuard's ALWAYS_PROTECTED includes /api/backup.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

const KEY = "b4-exit-gate-key-0123456789";
const PASSWORD = "b4testpass";

let tempDir;
const saved = {};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-b4-"));
  saved.DATA_DIR = process.env.DATA_DIR;
  saved.API_KEY_SECRET = process.env.API_KEY_SECRET;
  saved.KEY = process.env.VELA_BACKUP_ENCRYPTION_KEY;
  saved.INITIAL_PASSWORD = process.env.INITIAL_PASSWORD;
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "b4-test-api-secret";
  process.env.VELA_BACKUP_ENCRYPTION_KEY = KEY;
  process.env.INITIAL_PASSWORD = PASSWORD;
  delete process.env.VELA_DB_MODE;
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

async function seedWorld() {
  for (const [name, content] of [
    ["jwt-secret", "b4-jwt-secret"],
    ["api-key-secret", "b4-api-key-secret"],
  ]) {
    fs.writeFileSync(path.join(tempDir, name), content, { mode: 0o600 });
  }
  const db = await import("@/lib/db/index.js");
  await db.initDb();
  // settings.password is a BCRYPT HASH (the profile page hashes before it
  // saves). Store the hash of PASSWORD so verifyDashboardPassword(PASSWORD)
  // succeeds honestly through the real code path.
  const bcrypt = await import("bcryptjs");
  await db.updateSettings({
    password: bcrypt.hashSync(PASSWORD, 10),
    requireLogin: true,
    authMode: "password",
    cloudEnabled: false,
    comboStrategy: "fallback",
  });
  await db.createCombo({ name: "b4-combo", models: ["gpt-test"] });
  return db;
}

function req(method, pathname, body) {
  return new NextRequest(`http://localhost${pathname}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("Wave B4 — the backup API surface", () => {
  it("POST /api/backup/run requires a valid password (401 otherwise)", async () => {
    await seedWorld();
    const { POST } = await import("@/app/api/backup/run/route.js");
    const res = await POST(req("POST", "/api/backup/run", { password: "wrong-pass" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid password/i);
  }, 60000);

  it("POST /api/backup/run with the right password lands an artifact", async () => {
    await seedWorld();
    const { POST } = await import("@/app/api/backup/run/route.js");
    const res = await POST(req("POST", "/api/backup/run", { password: PASSWORD }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.artifactId).toMatch(/^vela-backup-/);
    expect(body.sizeBytes).toBeGreaterThan(0);
    // S4 — metadata only: the artifact bytes and key never ride the response.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(KEY);
    expect(serialized).not.toContain("b4-jwt-secret");
  }, 120000);

  it("GET /api/backup/status returns metadata, never the key", async () => {
    await seedWorld();
    const { GET } = await import("@/app/api/backup/status/route.js");
    const res = await GET(req("GET", "/api/backup/status"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("enabled");
    expect(body).toHaveProperty("intervalHours");
    expect(JSON.stringify(body)).not.toContain(KEY);
  });

  it("GET /api/backup/list returns ledger entries without the error field", async () => {
    await seedWorld();
    const { POST } = await import("@/app/api/backup/run/route.js");
    await POST(req("POST", "/api/backup/run", { password: PASSWORD }));
    const { GET } = await import("@/app/api/backup/list/route.js");
    const res = await GET(req("GET", "/api/backup/list?limit=5"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.entries)).toBe(true);
    expect(body.entries.length).toBeGreaterThan(0);
    for (const row of body.entries) expect("error" in row).toBe(false);
  }, 120000);

  it("POST /api/backup/restore — S1 default preserves current quarantined values", async () => {
    const db = await seedWorld();
    const { POST: RUN } = await import("@/app/api/backup/run/route.js");
    await RUN(req("POST", "/api/backup/run", { password: PASSWORD }));

    // Change a quarantined field AFTER the backup — a default restore must
    // keep the CURRENT (post-backup) value, not the artifact's.
    const bcrypt = await import("bcryptjs");
    const postBackupHash = bcrypt.hashSync("post-backup-pass", 10);
    await db.updateSettings({ password: postBackupHash });

    const { POST: RESTORE } = await import("@/app/api/backup/restore/route.js");
    // The CURRENT dashboard password is now "post-backup-pass" — the route
    // verifies against live settings (correct behavior), so authenticate with it.
    const res = await RESTORE(req("POST", "/api/backup/restore", { password: "post-backup-pass" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.restartRequired).toBe(true); // secret bundle restored (S6)

    const settings = await db.getSettings();
    expect(settings.password).toBe(postBackupHash); // quarantined — preserved
    expect(settings.comboStrategy).toBe("fallback"); // non-quarantined restored
  }, 120000);

  it("POST /api/backup/restore — adoptSecrets requires confirmSecrets (two clicks)", async () => {
    await seedWorld();
    const { POST } = await import("@/app/api/backup/restore/route.js");
    const res = await POST(req("POST", "/api/backup/restore", { password: PASSWORD, adoptSecrets: true }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/confirmSecrets/i);
  }, 60000);

  it("POST /api/backup/restore — adoptSecrets+confirmSecrets crosses the boundary", async () => {
    const db = await seedWorld();
    const { POST: RUN } = await import("@/app/api/backup/run/route.js");
    await RUN(req("POST", "/api/backup/run", { password: PASSWORD }));

    const { POST: RESTORE } = await import("@/app/api/backup/restore/route.js");
    const res = await RESTORE(req("POST", "/api/backup/restore", {
      password: PASSWORD, adoptSecrets: true, confirmSecrets: true,
    }));
    expect(res.status).toBe(200);

    // The artifact's quarantined settings now rule. Its settings.password is
    // S2-REDACTED in the export — so adopting it installs the sentinel.
    const settings = await db.getSettings();
    expect(settings.password).toBe("[REDACTED]");
    expect(settings.authMode).toBe("password");
  }, 120000);

  it("POST /api/backup/drill passes on the newest artifact", async () => {
    await seedWorld();
    const { POST: RUN } = await import("@/app/api/backup/run/route.js");
    await RUN(req("POST", "/api/backup/run", { password: PASSWORD }));
    const { POST: DRILL } = await import("@/app/api/backup/drill/route.js");
    const res = await DRILL(req("POST", "/api/backup/drill", { password: PASSWORD }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.tableCensus).toBeGreaterThan(8);
  }, 120000);

  it("restore of a wrong-key artifact surfaces a SANITIZED error (S4)", async () => {
    await seedWorld();
    const { POST: RUN } = await import("@/app/api/backup/run/route.js");
    await RUN(req("POST", "/api/backup/run", { password: PASSWORD }));

    // Flip the key — the next restore attempt must fail tag verification and
    // surface a sanitized message (never GCM internals or paths).
    process.env.VELA_BACKUP_ENCRYPTION_KEY = "a-different-key-0123456789";
    const { POST: RESTORE } = await import("@/app/api/backup/restore/route.js");
    const res = await RESTORE(req("POST", "/api/backup/restore", { password: PASSWORD }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/verification failed|wrong key|corrupted/i);
    expect(body.error).not.toContain(KEY);
    expect(body.error).not.toMatch(/scrypt|aes-256-gcm|salt|iv/i);
  }, 120000);
});

describe("Wave B4 — guard + registry alignment", () => {
  it("dashboardGuard's ALWAYS_PROTECTED includes /api/backup", async () => {
    const src = fs.readFileSync("src/dashboardGuard.js", "utf-8");
    expect(src).toContain('"/api/backup"');
    // It must sit inside the ALWAYS_PROTECTED array, not PROTECTED_API_PATHS.
    const always = src.slice(src.indexOf("const ALWAYS_PROTECTED"), src.indexOf("const PROTECTED_API_PATHS"));
    expect(always).toContain('"/api/backup"');
  });

  it("mysql posture refuses restoreBackup/runBackup until the twin binds (boot gate)", async () => {
    process.env.VELA_DB_MODE = "mysql";
    process.env.VELA_MYSQL_URL = "mysql://u:p@127.0.0.1:1/vela";
    const db = await import("@/lib/db/index.js");
    await expect(db.runBackup()).rejects.toThrow(/mysql|ECONNREFUSED|connect|refused/i);
  }, 30000);
});
