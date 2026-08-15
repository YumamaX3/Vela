// Storage Covenant Wave C4 — divergence sweep + usage-resync (LIVE MariaDB legs).
// The named C4 scenario (plan line 434) proven against the REAL twin:
//   "drift-injection → sweep flags → resync restores"
// — sweep fingerprints BOTH real harbors (real sweep seams, NO fetchRows
// override), divergence is injected by mutating a twin row (a c4live-prefixed
// combo), and the full resync restores through the REAL exportDb →
// preserveTwinSecrets → importDb({adoptKeys}) path. Plus: the usage-resync
// watermark against the REAL mysql apply seams (bounded, idempotent, S3-NULL).
//
// LOUD-SKIP CONVENTION (C3 precedent): these legs write to the shared parity
// twin, so they ride a DOUBLE opt-in — VELA_TEST_MYSQL_URL AND
// VELA_MIRROR_LIVE must both be set, and they must run ALONE (never in the
// same invocation as the parity-* suites: those compare whole-table worlds).
//
// Shared-twin law honored: unique c4live-${RUN} prefixes, row-scoped
// assertions, NO wipes of parity-owned tables. The config sweep tables are
// wiped/restored AROUND the scenario (the resync's importDb wipes them anyway
// — restoring the parity export at the end is strictly safer than the
// mid-test state). usageHistory ids are shifted by the twin's current MAX(id)
// so the fresh test primary's ids can never collide with parity rows, and
// every row this leg appends is deleted by id in cleanup.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const MYSQL_URL = process.env.VELA_TEST_MYSQL_URL;
const LIVE = MYSQL_URL && process.env.VELA_MIRROR_LIVE;

if (!LIVE) {
  console.warn(
    "[C4 SKIP LOUD] VELA_TEST_MYSQL_URL and/or VELA_MIRROR_LIVE unset — divergence sweep live-MariaDB legs skipped (run ALONE, never alongside parity-* suites; no silent coverage)"
  );
}

const d = LIVE ? describe : describe.skip;

let tempDir;
const saved = {};
const liveAdapters = new Set();
const RUN = crypto.randomUUID().slice(0, 8);
const state = { parityExport: null, idShift: 0, usageIds: [] };

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-c4-live-"));
  for (const k of ["DATA_DIR", "VELA_DB_MODE", "VELA_MYSQL_URL", "API_KEY_SECRET"]) saved[k] = process.env[k];
  process.env.DATA_DIR = tempDir;
  delete process.env.VELA_DB_MODE; // the PRIMARY leg stays sqlite; the twin rides VELA_MYSQL_URL
  process.env.API_KEY_SECRET = "c4-live-api-secret";
  delete global._dbAdapter;
  delete global._mysqlAdapter;
  vi.resetModules();
});

afterEach(async () => {
  // Restore the parity twin's world first — then close, then clean up local.
  // IMPORTANT: parityExport.settings is S2-REDACED (secret keys are the
  // "[REDACTED]" sentinel). The restore strips SECRET_SETTING_KEYS from the
  // payload and relies on importDb's S1 quarantine to keep the twin's CURRENT
  // secret values — so this leg can never write the literal sentinel onto the
  // shared twin's real secret settings (the mitmSudoEncrypted-style hazard).
  if (state.parityExport) {
    try {
      const mysqlBackup = await import("@/lib/db/repos/mysql/backupRepo.js");
      process.env.VELA_MYSQL_URL = MYSQL_URL;
      delete global._mysqlAdapter;
      const payload = { ...state.parityExport };
      if (payload.settings && typeof payload.settings === "object") {
        payload.settings = { ...payload.settings };
        for (const k of ["password", "mitmSudoEncrypted", "oidcClientSecret"]) {
          delete payload.settings[k]; // quarantine keeps the twin's live values
        }
      }
      await mysqlBackup.importDb(payload, { adoptKeys: true });
    } catch (e) {
      console.error(`[C4 LIVE] parity restore FAILED — the twin needs a manual re-sync: ${e.message}`);
    }
  }
  // Delete this run's usage rows by id (they may have ridden the resync).
  for (const a of liveAdapters) {
    try {
      for (const id of state.usageIds) {
        await a.run(`DELETE FROM usageHistory WHERE id = ?`, [id]);
        await a.run(`DELETE FROM usageDaily WHERE dateKey = ?`, [usageDateKey(id)]);
      }
    } catch {}
    try { await a.close(); } catch {}
  }
  liveAdapters.clear();
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  delete global._mysqlAdapter;
  if (tempDir) {
    for (let i = 0; i < 5; i++) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); break; }
      catch { await new Promise((r) => setTimeout(r, 100)); } // Windows EPERM
    }
  }
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  state.parityExport = null; state.idShift = 0; state.usageIds = [];
});

/** The local dateKey for a shifted usage id's timestamp (seedUsage stamps it). */
function usageDateKey(shiftedId) {
  // Timestamps are stamped deterministically from the shift (see seedUsage) —
  // recompute the same local date bucket the writer used.
  const d = new Date(`2026-08-16T00:00:${String((shiftedId % 60)).padStart(2, "0")}.000Z`);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

async function twin() {
  const { createMysqlAdapter } = await import("@/lib/db/mysql/pool.js");
  const adapter = await createMysqlAdapter(MYSQL_URL);
  liveAdapters.add(adapter);
  return adapter;
}

async function seedSqlite() {
  const db = await import("@/lib/db/index.js");
  await db.initDb();
  return db;
}

/** Capture the twin's CURRENT config-table world so the end-of-test restore
 *  returns it to parity-clean state. */
async function captureParityWorld() {
  process.env.VELA_MYSQL_URL = MYSQL_URL;
  delete global._mysqlAdapter;
  const mysqlBackup = await import("@/lib/db/repos/mysql/backupRepo.js");
  return mysqlBackup.exportDb({ includeRequestDetails: false });
}

/** Seed the fresh primary with a c4live-prefixed world. */
async function seedPrimary() {
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  db.run(
    `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?)`,
    [`pc-c4live-${RUN}`, "anthropic", "oauth", `c4live-${RUN}-conn`, null, null, 1, JSON.stringify({ baseUrl: "https://example.test" }), "t1", "t1"]
  );
  db.run(
    `INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?,?,?,?,?,?)`,
    [`combo-c4live-${RUN}`, `c4live-${RUN}-combo`, "fallback", JSON.stringify(["m1", "m2"]), "t1", "t1"]
  );
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, keyVersion, keyHash, keyPrefix, description, allowedModels, isInternal, deletedAt, expiresAt, lastUsedAt, rotatedFrom, rotationPrevHash, rotationPrevKeyId, rotationGraceUntil, tokenBudgetDaily, spendCapDailyCents, budgetScope, rateLimitRpm, ipAllowlist, category) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [`key-c4live-${RUN}`, `vela-c4live-${RUN}-key`, `c4live-${RUN}-key`, null, 1, "t1", "w1", `kh-c4live-${RUN}`, `vela-c4live-${RUN}`, null, null, 0, null, null, null, null, null, null, null, null, null, null, null, null, null]
  );
}

/** Seed the fresh primary with 3 usage rows whose ids are shifted beyond the
 *  twin's current MAX(id) — so they can never collide with parity rows. */
async function seedUsage() {
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  for (let i = 0; i < 3; i++) {
    const id = state.idShift + 1 + i;
    const ts = `2026-08-16T00:00:${String(id % 60).padStart(2, "0")}.000Z`;
    // '' is the normalized "unset" form on BOTH engines (migration 004 law);
    // only the legacy apiKey column rides NULL (S3 — the twin writer's law).
    db.run(
      `INSERT INTO usageHistory(id, timestamp, provider, model, connectionId, apiKey, keyId, keyPrefix, endpoint, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, ts, "p", "m", "", null, "", null, null, 10 + i, 5, 0, null, null, null]
    );
    state.usageIds.push(id);
  }
  const { getUsageWatermark, setUsageWatermark } = await import("@/lib/db/repos/sqlite/usageResyncRepo.js");
  expect(await getUsageWatermark()).toBe(0); // fresh primary
  await setUsageWatermark(0); // stays 0 — rows beyond the watermark
}

d("Wave C4 LIVE — drift-injection → sweep flags → resync restores", () => {
  it("a mutated twin row is flagged by the real sweep and healed by the real full resync", async () => {
    const adapter = await twin();
    await seedSqlite();
    await seedPrimary();
    process.env.VELA_MYSQL_URL = MYSQL_URL;

    // Capture the parity world for the end-of-test restore.
    state.parityExport = await captureParityWorld();

    const mysqlBackup = await import("@/lib/db/repos/mysql/backupRepo.js");
    const sqliteBackup = await import("@/lib/db/repos/sqlite/backupRepo.js");
    const { setMirrorSweepSeams, runDivergenceSweepOnce, runFullResync } = await import("@/lib/db/mirror/mirrorSweep.js");
    setMirrorSweepSeams(null); // the REAL seams — sqlite sweep repo + mysql sweep repo

    // 1. Mirror the primary's world onto the twin through the REAL importDb
    //    (the pump would have carried these rows; the resync is the same law).
    const primaryExport = await sqliteBackup.exportDb({ includeRequestDetails: false });
    await mysqlBackup.importDb(primaryExport, { adoptKeys: true });

    // 2. The mirrored world agrees — the sweep finds zero divergence.
    const clean = await runDivergenceSweepOnce({ autoResync: false });
    expect(clean.swept).toBe(true);
    expect(clean.divergent).toEqual([]);

    // 3. Drift-injection — mutate the twin's c4live combo row directly.
    await adapter.run(`UPDATE combos SET name = ? WHERE id = ?`, [`drifted-c4live-${RUN}`, `combo-c4live-${RUN}`]);
    const flagged = await runDivergenceSweepOnce({ autoResync: false });
    const comboVerdict = flagged.divergent.find((v) => v.table === "combos");
    expect(comboVerdict).toBeTruthy(); // the sweep flags the injected drift
    expect(comboVerdict.rowDrift).toBe(true); // same count, drifted content

    // 4. The real full resync heals it — export → secret stitch → adoptKeys import.
    const resynced = await runFullResync();
    expect(resynced.resynced).toBe(true);
    const healed = await runDivergenceSweepOnce({ autoResync: false });
    expect(healed.divergent).toEqual([]);

    // The twin's row carries the primary's truth again — and its key identity
    // is the PRIMARY's keyHash (adoptKeys), not a mirror-mint.
    const [comboRow] = await adapter.all(`SELECT name FROM combos WHERE id = ?`, [`combo-c4live-${RUN}`]);
    expect(comboRow.name).toBe(`c4live-${RUN}-combo`);
    const [keyRow] = await adapter.all(`SELECT id, keyHash FROM apiKeys WHERE keyHash = ?`, [`kh-c4live-${RUN}`]);
    expect(keyRow).toBeTruthy();
    expect(keyRow.id).toBe(`key-c4live-${RUN}`); // the primary's id, adopted

    // 5. The ledger holds the divergence alert + the resync record (S4: no error
    //    surfaces; meta carries the table names).
    const ledger = (await sqliteBackup.listBackupLedger({ limit: 50 }));
    const alert = ledger.find((r) => r.kind === "mirrorDivergence" && r.status === "failed");
    expect(alert).toBeTruthy();
    expect(alert.meta.tables.some((t) => t.table === "combos")).toBe(true);
    const resync = ledger.find((r) => r.kind === "mirrorResync" && r.status === "ok");
    expect(resync).toBeTruthy();
  }, 120000);
});

d("Wave C4 LIVE — the usage-resync watermark against the real twin seams", () => {
  it("bounded batches append verbatim; redelivery is idempotent; S3 keeps apiKey NULL on the twin", async () => {
    const adapter = await twin();
    await seedSqlite();
    process.env.VELA_MYSQL_URL = MYSQL_URL;

    // The shift: the fresh primary's ids must clear the twin's current max.
    const [{ maxId }] = await adapter.all(`SELECT COALESCE(MAX(id), 0) AS maxId FROM usageHistory`);
    state.idShift = Number(maxId);
    await seedUsage();

    const { runUsageResyncOnce } = await import("@/lib/db/mirror/usageResync.js");
    const { setUsageResyncSeams } = await import("@/lib/db/mirror/usageResync.js");
    setUsageResyncSeams(null); // the REAL mysql apply seams

    // Batch size 2 → two batches (2 + 1) drain the three shifted rows.
    const pass = await runUsageResyncOnce({ batchSize: 2 });
    expect(pass.appended).toBe(3);
    expect(pass.watermark).toBe(state.idShift + 3);

    // The twin holds the rows verbatim — same ids, apiKey NULL (S3).
    const rows = await adapter.all(
      `SELECT id, promptTokens, completionTokens, apiKey FROM usageHistory WHERE id IN (?, ?, ?)`,
      [state.idShift + 1, state.idShift + 2, state.idShift + 3]
    );
    expect(rows.length).toBe(3);
    for (const r of rows) {
      expect(r.apiKey).toBeNull(); // the twin writer's law — never plaintext
      expect(Number(r.promptTokens)).toBeGreaterThanOrEqual(10);
    }

    // Idempotence — the rerun is a no-op (watermark holds, no redelivery).
    const again = await runUsageResyncOnce({ batchSize: 2 });
    expect(again).toMatchObject({ synced: false, appended: 0 });
    const count = await adapter.all(
      `SELECT COUNT(*) AS c FROM usageHistory WHERE id IN (?, ?, ?)`,
      [state.idShift + 1, state.idShift + 2, state.idShift + 3]
    );
    expect(Number(count[0].c)).toBe(3); // no duplicates
  }, 120000);
});
