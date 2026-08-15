// Storage Covenant Wave C3 — the mirror pump exit gate (LIVE MariaDB legs).
// The three named C3 scenarios (plan line 435-436) proven against the real
// twin, through the REAL apply path (no applier override):
//   1. outage → N writes → outbox N pending → catch-up drains
//   2. double-delivery → seq-dedupe idempotent
//   3. poison-loop → createCombo replay with captured identity never hits
//      UNIQUE (naive re-mint replay contrasted + dedupe-row proof)
// Plus: identity-carrying content parity for every creator, rmw dispatch,
// S3 (replayed apiKeys never carry keyId/plaintext; twin rows resolve).
//
// LOUD-SKIP CONVENTION (B4 + the real-provider precedent): these legs write
// to the shared parity twin, so they ride a DOUBLE opt-in — VELA_TEST_MYSQL_URL
// AND VELA_MIRROR_LIVE must both be set, and the legs must run ALONE (never in
// the same invocation as the parity-* suites: those compare whole-table worlds
// and a foreign write mid-comparison reads as divergence). The wave gate runs
// them in a dedicated invocation; the default regression run skips LOUD.
//
// The legs honor the shared-twin law: unique run-suffixed names, row-scoped
// assertions, and NO wipes of parity-owned tables (only mirrorSeq — the
// pump's own twin-side bookkeeping).
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const MYSQL_URL = process.env.VELA_TEST_MYSQL_URL;
const LIVE = MYSQL_URL && process.env.VELA_MIRROR_LIVE;

if (!LIVE) {
  console.warn(
    "[C3 SKIP LOUD] VELA_TEST_MYSQL_URL and/or VELA_MIRROR_LIVE unset — mirror pump live-MariaDB legs skipped (run ALONE, never alongside parity-* suites; no silent coverage)"
  );
}

const d = LIVE ? describe : describe.skip;

let tempDir;
const saved = {};
const liveAdapters = new Set();
const RUN = crypto.randomUUID().slice(0, 8);

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-c3-live-"));
  for (const k of ["DATA_DIR", "VELA_DB_MODE", "VELA_MYSQL_URL", "API_KEY_SECRET"]) saved[k] = process.env[k];
  process.env.DATA_DIR = tempDir;
  delete process.env.VELA_DB_MODE; // the PRIMARY leg stays sqlite; the twin rides VELA_MYSQL_URL
  process.env.API_KEY_SECRET = "c3-live-api-secret";
  delete global._dbAdapter;
  delete global._mysqlAdapter;
  vi.resetModules();
});

afterEach(async () => {
  for (const a of liveAdapters) { await cleanupTwin(a); try { await a.close(); } catch {} }
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
});

async function twin() {
  const { createMysqlAdapter } = await import("@/lib/db/mysql/pool.js");
  const adapter = await createMysqlAdapter(MYSQL_URL);
  liveAdapters.add(adapter);
  // mirrorSeq is the PUMP's own twin-side ledger — safe to reset. Parity-owned
  // tables are never wiped (whole-table world comparisons depend on them).
  try { await adapter.exec(`CREATE TABLE IF NOT EXISTS mirrorSeq (seq BIGINT PRIMARY KEY)`); } catch {}
  try { await adapter.exec(`DELETE FROM mirrorSeq`); } catch {}
  return adapter;
}

/** Clean up ONLY this run's rows (unique c3live-${RUN} prefix) — the twin
 *  must stay parity-clean: the parity-* suites compare whole-table worlds,
 *  and foreign residue reads as divergence in their next invocation. */
async function cleanupTwin(adapter) {
  try {
    await adapter.run(`DELETE FROM combos WHERE name LIKE ?`, [`c3live-${RUN}-%`]);
    await adapter.run(`DELETE FROM providerConnections WHERE name LIKE ?`, [`c3live-${RUN}-%`]);
    await adapter.run(`DELETE FROM providerNodes WHERE name LIKE ?`, [`c3live-${RUN}-%`]);
    await adapter.run(`DELETE FROM proxyPools WHERE data LIKE ?`, [`%c3live-${RUN}%`]);
    await adapter.run(`DELETE FROM apiKeys WHERE name LIKE ? OR name LIKE ?`, [`c3live-${RUN}-%`, `internal:c3live-${RUN}-%`]);
    await adapter.exec(`DELETE FROM mirrorSeq`);
  } catch {} // best-effort — the prefix makes every delete safe
}

async function seedSqlite() {
  const db = await import("@/lib/db/index.js");
  await db.initDb();
  return db;
}

/** Capture a decorated sqlite writer call into the outbox exactly like C2. */
async function capturedWriter(modPath, fnName) {
  const { decorateMirrorRepo } = await import("@/lib/db/mirror/mirrorDecorator.js");
  const mod = decorateMirrorRepo(await import(modPath));
  return mod[fnName];
}

d("Wave C3 LIVE — scenario 1: outage → N writes → catch-up drains", () => {
  it("N decorated writes accumulate; the pump drains them all into the twin", async () => {
    const adapter = await twin();
    await seedSqlite();
    process.env.VELA_MYSQL_URL = MYSQL_URL;

    const createCombo = await capturedWriter("@/lib/db/repos/sqlite/combosRepo.js", "createCombo");
    const updateCombo = await capturedWriter("@/lib/db/repos/sqlite/combosRepo.js", "updateCombo");
    const createApiKey = await capturedWriter("@/lib/db/repos/sqlite/apiKeysRepo.js", "createApiKey");

    // The outage window: writes land on the primary, outbox accumulates.
    const comboName = `c3live-${RUN}-combo`;
    const combo = await createCombo({ name: comboName, models: ["m1", "m2"] });
    await updateCombo(combo.id, { models: ["m1", "m2", "m3"] });
    const key = await createApiKey(`c3live-${RUN}-key`);

    const outbox = await import("@/lib/db/repos/sqlite/outboxRepo.js");
    expect((await outbox.fetchPendingOutbox()).length).toBe(3);

    // The twin returns — the REAL apply path drains.
    const { runMirrorPumpOnce } = await import("@/lib/db/mirror/mirrorPump.js");
    const stats = await runMirrorPumpOnce();
    expect(stats.applied).toBe(3);
    expect(stats.poisoned).toBe(0);

    // Twin state: combo landed with captured identity + rmw merge applied.
    const twinCombo = await adapter.get(`SELECT * FROM combos WHERE id = ?`, [combo.id]);
    expect(twinCombo.name).toBe(comboName);
    expect(twinCombo.createdAt).toBe(combo.createdAt);
    expect(JSON.parse(twinCombo.models)).toEqual(["m1", "m2", "m3"]); // rmw merge

    const { getAdapter: getSqlite } = await import("@/lib/db/driver.js");
    const sqliteKey = (await getSqlite()).get(`SELECT keyHash FROM apiKeys WHERE id = ?`, [key.keyId]);
    const twinKey = await adapter.get(`SELECT * FROM apiKeys WHERE keyHash = ?`, [sqliteKey.keyHash]);
    expect(twinKey).toBeTruthy();
    expect(twinKey.keyPrefix).toBe(key.record.keyPrefix);
    expect(twinKey.id).not.toBe(key.keyId); // S3 — keyId never crossed
    expect(twinKey.key).not.toContain(key.key); // S3 — plaintext never crossed

    // The twin's seq-dedupe ledger carries exactly this run's three seqs.
    const dedupe = await adapter.all(`SELECT seq FROM mirrorSeq ORDER BY seq ASC`);
    expect(dedupe.map((r) => Number(r.seq)).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  }, 60000);
});

d("Wave C3 LIVE — scenario 2: double-delivery → seq-dedupe idempotent", () => {
  it("re-delivering an applied outbox row leaves the twin untouched", async () => {
    const adapter = await twin();
    await seedSqlite();
    process.env.VELA_MYSQL_URL = MYSQL_URL;

    const createCombo = await capturedWriter("@/lib/db/repos/sqlite/combosRepo.js", "createCombo");
    const combo = await createCombo({ name: `c3live-${RUN}-dup`, models: ["m"] });

    const { runMirrorPumpOnce } = await import("@/lib/db/mirror/mirrorPump.js");
    const outbox = await import("@/lib/db/repos/sqlite/outboxRepo.js");
    expect((await runMirrorPumpOnce()).applied).toBe(1);
    expect((await outbox.fetchPendingOutbox()).length).toBe(0); // drained

    // Double delivery: the same op lands in the outbox AGAIN (at-least-once).
    // The first application burned its args (S3) — exactly the shape a real
    // redelivery arrives in: pending + redacted cargo. The twin's seq-dedupe
    // row must answer "already applied" without needing the args.
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run(`UPDATE outbox SET status = 'pending', retries = 0, appliedAt = NULL, args = '[REDACTED]' WHERE seq = 1`);

    const stats = await runMirrorPumpOnce();
    expect(stats.applied).toBe(1); // the dedupe guard answered "already applied"
    expect(stats.poisoned).toBe(0);

    // Twin untouched — exactly one row for this combo's id.
    expect((await adapter.get(`SELECT COUNT(*) AS n FROM combos WHERE id = ?`, [combo.id])).n).toBe(1);
    expect((await adapter.all(`SELECT seq FROM mirrorSeq`)).length).toBe(1);
  }, 60000);
});

d("Wave C3 LIVE — scenario 3: poison-loop never strikes (captured identity)", () => {
  it("createCombo replay with captured identity survives UNIQUE; naive re-mint dies", async () => {
    const adapter = await twin();
    await seedSqlite();
    process.env.VELA_MYSQL_URL = MYSQL_URL;

    const createCombo = await capturedWriter("@/lib/db/repos/sqlite/combosRepo.js", "createCombo");
    const name = `c3live-${RUN}-poisonproof`;
    await createCombo({ name, models: ["a"] });

    const { runMirrorPumpOnce } = await import("@/lib/db/mirror/mirrorPump.js");
    expect((await runMirrorPumpOnce()).applied).toBe(1);

    // The naive replay (re-mint a uuid, keep the name) hits combos.name UNIQUE.
    await expect(
      adapter.run(`INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(UUID(), ?, NULL, '[]', NOW(), NOW())`, [name])
    ).rejects.toThrow(/Duplicate entry/i);

    // The captured-identity replay: redeliver the same outbox row — the
    // seq-dedupe guard answers "already applied" (args stay intact here; the
    // naive INSERT above proved UNIQUE would have fired on a re-minted uuid).
    const { getAdapter } = await import("@/lib/db/driver.js");
    (await getAdapter()).run(`UPDATE outbox SET status = 'pending', retries = 0, appliedAt = NULL`);
    const stats = await runMirrorPumpOnce();
    expect(stats.applied).toBe(1);
    expect(stats.poisoned).toBe(0);
    expect((await adapter.get(`SELECT COUNT(*) AS n FROM combos WHERE name = ?`, [name])).n).toBe(1);
  }, 60000);

  it("a lost identity (redacted crash window) poisons at once + ledger alert", async () => {
    const adapter = await twin();
    await seedSqlite();
    process.env.VELA_MYSQL_URL = MYSQL_URL;

    const createCombo = await capturedWriter("@/lib/db/repos/sqlite/combosRepo.js", "createCombo");
    const name = `c3live-${RUN}-lostid`;
    await createCombo({ name, models: ["x"] });

    // Simulate the crash window: args burned, identity vanished, still pending.
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run(`UPDATE outbox SET args = '[REDACTED]'`);

    const { runMirrorPumpOnce } = await import("@/lib/db/mirror/mirrorPump.js");
    const stats = await runMirrorPumpOnce();
    expect(stats.poisoned).toBe(1);
    expect(stats.applied).toBe(0);
    const [row] = await db.all(`SELECT * FROM outbox`);
    expect(row.status).toBe("failed");
    // This test's exact combo was never applied — poison terminals BEFORE
    // any twin write (row-scoped: other live legs' rows stay on the twin).
    expect((await adapter.get(`SELECT COUNT(*) AS n FROM combos WHERE name = ?`, [name])).n).toBe(0);

    const ledger = db.all(`SELECT * FROM backupLedger WHERE kind = 'mirrorPoison'`);
    expect(ledger.length).toBe(1);
  }, 60000);
});

d("Wave C3 LIVE — identity parity across every creator", () => {
  it("connections/nodes/pools/apiKeys/internal-key replays land with captured identity", async () => {
    const adapter = await twin();
    await seedSqlite();
    process.env.VELA_MYSQL_URL = MYSQL_URL;

    const createConn = await capturedWriter("@/lib/db/repos/sqlite/connectionsRepo.js", "createProviderConnection");
    const createNode = await capturedWriter("@/lib/db/repos/sqlite/nodesRepo.js", "createProviderNode");
    const createPool = await capturedWriter("@/lib/db/repos/sqlite/proxyPoolsRepo.js", "createProxyPool");
    const ensureInternal = await capturedWriter("@/lib/db/repos/sqlite/apiKeysRepo.js", "ensureInternalKey");

    const conn = await createConn({ provider: "openai", authType: "apikey", name: `c3live-${RUN}-conn`, apiKey: `sk-test-${RUN}` });
    const node = await createNode({ type: "gateway", name: `c3live-${RUN}-node`, baseUrl: "https://example.invalid" });
    const pool = await createPool({ name: `c3live-${RUN}-pool`, proxyUrl: "http://proxy.invalid" });
    const internal = await ensureInternal(`c3live-${RUN}-purpose`);

    const { runMirrorPumpOnce } = await import("@/lib/db/mirror/mirrorPump.js");
    const stats = await runMirrorPumpOnce();
    expect(stats.applied).toBe(4);
    expect(stats.poisoned).toBe(0);

    const twinConn = await adapter.get(`SELECT * FROM providerConnections WHERE id = ?`, [conn.id]);
    expect(twinConn.name).toBe(`c3live-${RUN}-conn`);
    expect(twinConn.createdAt).toBe(conn.createdAt);
    expect(JSON.parse(twinConn.data).apiKey).toBe(`sk-test-${RUN}`); // content parity

    const twinNode = await adapter.get(`SELECT * FROM providerNodes WHERE id = ?`, [node.id]);
    expect(twinNode.name).toBe(`c3live-${RUN}-node`);
    expect(JSON.parse(twinNode.data).baseUrl).toBe("https://example.invalid");

    const twinPool = await adapter.get(`SELECT * FROM proxyPools WHERE id = ?`, [pool.id]);
    expect(JSON.parse(twinPool.data).name).toBe(`c3live-${RUN}-pool`);

    // ensureInternalKey: deterministic re-execution under the shared secret.
    const twinInternal = await adapter.get(`SELECT * FROM apiKeys WHERE name = ?`, [`internal:c3live-${RUN}-purpose`]);
    expect(twinInternal.isInternal === 1 || twinInternal.isInternal === true).toBe(true);
    expect(twinInternal.id).toBe(internal.keyId); // deterministic derivation
  }, 60000);

  it("rmw-stale-hazard ops dispatch through the twin repos the parity tests prove", async () => {
    const adapter = await twin();
    await seedSqlite();
    process.env.VELA_MYSQL_URL = MYSQL_URL;

    const createCombo = await capturedWriter("@/lib/db/repos/sqlite/combosRepo.js", "createCombo");
    const updateCombo = await capturedWriter("@/lib/db/repos/sqlite/combosRepo.js", "updateCombo");
    const combo = await createCombo({ name: `c3live-${RUN}-rmw`, models: ["m"] });
    await updateCombo(combo.id, { models: ["m", "n"] });

    const { runMirrorPumpOnce } = await import("@/lib/db/mirror/mirrorPump.js");
    const stats = await runMirrorPumpOnce();
    expect(stats.applied).toBe(2);

    const twinCombo = await adapter.get(`SELECT * FROM combos WHERE id = ?`, [combo.id]);
    expect(JSON.parse(twinCombo.models)).toEqual(["m", "n"]); // rmw merge applied
  }, 60000);
});
