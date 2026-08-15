// Storage Covenant Wave B4 — the backupRepo PARITY GATE (mysql twin).
// Plan line 284: "MySQL posture: JSON export is the artifact (engine-portable
// by construction)" — the SAME exportDb payload shape serves both engines, so
// a restore can cross postures. This suite proves repos/mysql/backupRepo.js
// converges with repos/sqlite/backupRepo.js against a REAL MariaDB (opt-in
// VELA_TEST_MYSQL_URL, LOUD skip banner), covering exportDb, importDb
// (incl. S1 quarantine), writeLedger, listBackupLedger, purgeOldUsage, and
// the facade seam under VELA_DB_MODE=mysql.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterAll, vi } from "vitest";

const MYSQL_URL = process.env.VELA_TEST_MYSQL_URL;
if (!MYSQL_URL) {
  console.warn("[B4 SKIP LOUD] VELA_TEST_MYSQL_URL unset — backupRepo mysql-twin parity vs real MariaDB skipped (no silent coverage)");
}

let tempDirs = [];
// Every adapter this file mints — closed in afterAll regardless of what the
// globals point at then (a test may delete global._dbAdapter/_mysqlAdapter
// mid-flight; on Windows an unclosed handle = EPERM on temp-dir cleanup).
const liveAdapters = new Set();
const saved = {};
for (const k of ["DATA_DIR", "VELA_DB_MODE", "VELA_MYSQL_URL", "VELA_BACKUP_ENCRYPTION_KEY", "API_KEY_SECRET"]) saved[k] = process.env[k];

function freshDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "vela-b4m-"));
  tempDirs.push(d);
  return d;
}

afterAll(async () => {
  for (const a of liveAdapters) {
    try { await a?.instance?.close?.(); } catch {}
    try { await a?.close?.(); } catch {}
  }
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  try { await global._mysqlAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  delete global._mysqlAdapter;
  vi.resetModules();
  for (const k of Object.keys(saved)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  for (const d of tempDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); }
    catch { try { await new Promise((r) => setTimeout(r, 250)); fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  }
  tempDirs = [];
});

function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  }
  return v;
}

/** One deterministic world — identical statements on both engines. */
const SEED_TS = "2026-08-16T00:00:00.000Z";
async function seedWorld(api, raw) {
  await api.updateSettings({
    password: "parity-pass",
    requireLogin: true,
    authMode: "password",
    cloudEnabled: false,
    comboStrategy: "fallback",
  });
  await api.createCombo({ name: "parity-combo", kind: "fallback", models: ["openai/gpt-4o"] });
  // apiKeys + kv + usageHistory via raw SQL (deterministic ids/hashes).
  raw.run(
    `INSERT INTO apiKeys(id, ${raw.dialect === "mysql" ? "`key`" : "key"}, name, isActive, createdAt, keyHash, keyPrefix, isInternal, deletedAt) VALUES(?, ?, ?, 1, ?, ?, ?, 0, NULL)`,
    ["pk-1", "restored-pk-1", "parity key", SEED_TS, "parity-hash", "vela-v1"]
  );
  raw.run(
    `INSERT INTO kv(scope, ${raw.dialect === "mysql" ? "`key`" : "key"}, value) VALUES(?, ?, ?)`,
    ["pariscope", "k1", '"v1"']
  );
  raw.run(
    `INSERT INTO usageHistory(id, timestamp, provider, model, connectionId, apiKey, keyId, keyPrefix, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [1, SEED_TS, "openai", "gpt-4o", "conn-1", "", "vela-v1-seed", 100, 50, 0.0012, "success", "{}", "{}"]
  );
}

import { VOLATILE_BY_TABLE } from "./harness/runner.js";

/** Normalize a payload for canonical comparison — the A4 contract: strip
 *  provenance (_meta) + generated/volatile fields per table (uuids, wall-clock
 *  timestamps), NEVER the row content. Identity-sensitive fields the seed made
 *  deterministic are asserted individually below; this normalization covers the
 *  generated ones (createCombo mints a uuid + now() on each side). */
function normalizeForCompare(payload) {
  const out = { ...payload };
  delete out._meta;
  for (const [table, fields] of Object.entries(VOLATILE_BY_TABLE)) {
    if (!Array.isArray(out[table]) || !fields.length) continue;
    out[table] = out[table].map((row) => {
      const c = { ...row };
      for (const f of fields) delete c[f];
      return c;
    });
  }
  return canon(out);
}

async function buildSqliteWorld() {
  process.env.DATA_DIR = freshDir();
  process.env.VELA_DB_MODE = "sqlite";
  delete process.env.VELA_MYSQL_URL;
  delete global._dbAdapter;
  vi.resetModules();
  const sqliteBackup = await import("@/lib/db/repos/sqlite/backupRepo.js");
  const settingsRepo = await import("@/lib/db/repos/sqlite/settingsRepo.js");
  const combosRepo = await import("@/lib/db/repos/sqlite/combosRepo.js");
  const { getAdapter } = await import("@/lib/db/driver.js");
  await sqliteBackup.initDb();
  const db = await getAdapter();
  liveAdapters.add(db);
  await seedWorld(
    { updateSettings: settingsRepo.updateSettings, createCombo: combosRepo.createCombo },
    { run: (sql, p) => db.run(sql, p), dialect: "sqlite" }
  );
  const exportBefore = await sqliteBackup.exportDb({});
  const restored = await sqliteBackup.importDb(JSON.parse(JSON.stringify(exportBefore)));
  return { export: restored, repo: sqliteBackup };
}

async function buildMysqlWorld() {
  process.env.VELA_MYSQL_URL = MYSQL_URL;
  delete global._mysqlAdapter;
  vi.resetModules();
  const mysqlBackup = await import("@/lib/db/repos/mysql/backupRepo.js");
  const mysqlSettings = await import("@/lib/db/repos/mysql/settingsRepo.js");
  const mysqlCombos = await import("@/lib/db/repos/mysql/combosRepo.js");
  const { getMysqlAdapter } = await import("@/lib/db/mysql/adapter.js");
  const db = await getMysqlAdapter();
  liveAdapters.add(db);
  // Clean slate for the twin.
  for (const t of ["settings", "providerConnections", "providerNodes", "proxyPools", "apiKeys", "combos", "kv", "usageHistory", "usageDaily", "requestDetails", "backupLedger"]) {
    await db.exec(`DELETE FROM ${t}`);
  }
  await seedWorld(
    { updateSettings: mysqlSettings.updateSettings, createCombo: mysqlCombos.createCombo },
    { run: (sql, p) => db.run(sql, p), dialect: "mysql" }
  );
  const exportBefore = await mysqlBackup.exportDb({});
  const restored = await mysqlBackup.importDb(JSON.parse(JSON.stringify(exportBefore)));
  return { export: restored, repo: mysqlBackup, db };
}

describe.skipIf(!MYSQL_URL)("Storage Covenant B4 — backupRepo parity vs real MariaDB", () => {
  it("sqlite harbor ≡ mysql twin — exportDb payloads converge", async () => {
    const sqliteWorld = await buildSqliteWorld();
    const mysqlWorld = await buildMysqlWorld();

    const a = normalizeForCompare(sqliteWorld.export);
    const b = normalizeForCompare(mysqlWorld.export);

    // Per-table convergence on the core shapes.
    expect(a.settings.comboStrategy).toBe(b.settings.comboStrategy);
    expect(a.combos.map((c) => c.name)).toEqual(b.combos.map((c) => c.name));
    expect(a.apiKeys.map((k) => k.keyHash)).toEqual(b.apiKeys.map((k) => k.keyHash));
    expect(a.kvScopes.pariscope).toEqual(b.kvScopes.pariscope);
    expect(a.usageHistory.length).toBe(b.usageHistory.length);
    // Full canonical equality of the comparable surface.
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  }, 60000);

  it("mysql importDb round-trips (wipe + restore preserves content)", async () => {
    const mysqlWorld = await buildMysqlWorld();
    const re = await mysqlWorld.repo.exportDb({});
    expect(re.combos.some((c) => c.name === "parity-combo")).toBe(true);
    expect(re.apiKeys.some((k) => k.keyHash === "parity-hash")).toBe(true);
    expect(re.kvScopes.pariscope).toEqual({ k1: "v1" });
  }, 60000);

  it("mysql S1 quarantine — default restore preserves CURRENT quarantined values", async () => {
    const mysqlWorld = await buildMysqlWorld();
    // Change a quarantined field AFTER the export snapshot we hold.
    await mysqlWorld.repo.importDb({
      ...(await mysqlWorld.repo.exportDb({})),
      settings: {
        ...(await mysqlWorld.repo.exportDb({})).settings,
        password: "attacker-pass",
        requireLogin: false,
      },
    }); // no adoptSecrets — quarantined fields keep CURRENT values
    const raw = await mysqlWorld.db.get(`SELECT data FROM settings WHERE id = 1`);
    const settings = JSON.parse(raw.data);
    expect(settings.password).not.toBe("attacker-pass");
    expect(settings.requireLogin).not.toBe(false);
  }, 60000);

  it("mysql ledger + purge — writeLedger/listBackupLedger/purgeOldUsage work", async () => {
    const mysqlWorld = await buildMysqlWorld();
    await mysqlWorld.repo.writeLedger("backup", { artifactId: "parity-test-artifact", sizeBytes: 1234 });
    const ledger = await mysqlWorld.repo.listBackupLedger();
    expect(ledger.some((r) => r.kind === "backup" && r.artifactId === "parity-test-artifact")).toBe(true);
    for (const row of ledger) expect("error" in row).toBe(false); // S4

    const purge = await mysqlWorld.repo.purgeOldUsage({ retentionDays: 90 });
    expect(purge.purged).toBe(true);
  }, 60000);

  it("the FACADE seam dispatches backupRepo to the mysql twin under VELA_DB_MODE=mysql", async () => {
    process.env.VELA_DB_MODE = "mysql";
    process.env.VELA_MYSQL_URL = MYSQL_URL;
    delete global._mysqlAdapter;
    delete global._dbAdapter;
    vi.resetModules();
    const facade = await import("@/lib/db/repos/backupRepo.js");
    // Under mysql the facade must NOT touch sqlite — exportDb rides the mysql twin.
    const payload = await facade.exportDb({});
    // Capture whatever the facade minted so afterAll can close it.
    if (global._mysqlAdapter) liveAdapters.add(global._mysqlAdapter);
    if (global._dbAdapter) liveAdapters.add(global._dbAdapter);
    expect(payload._meta.sourceDriver).toBe("mysql2");
    expect(payload._meta.sourceMode).toBe("mysql");
  }, 60000);
});
