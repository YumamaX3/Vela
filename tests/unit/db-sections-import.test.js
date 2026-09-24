// Selective import (the sections law) — Storage Covenant extension.
//
// A backup file is the whole database, but a restore no longer has to be.
// Three falsifiable claims, all on a REAL migrated SQLite harbor (per-test
// DATA_DIR + vi.resetModules in BOTH hooks — the DB-harness trap):
//
//   1. SECTIONS — importDb(payload, { sections }) wipes and refills ONLY the
//      named partitions; unselected sections keep their rows verbatim.
//   2. DRY RUN — importDb(payload, { dryRun: true }) writes NOTHING and
//      answers the plan it would execute (per-section counts).
//   3. QUARANTINE HOLDS UNDER SELECTION — a selective restore still preserves
//      CURRENT quarantined values (password hash, keyHash) unless adoptSecrets.
//
// The whole-restore path (no sections) is pinned by db-export-completeness
// (A3 round-trip) and must remain byte-identical — the last block here
// re-proves its exact prior return contract: a flat payload spread.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalSecret = process.env.API_KEY_SECRET;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-sections-"));
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "sections-test-secret";
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalSecret === undefined) delete process.env.API_KEY_SECRET;
  else process.env.API_KEY_SECRET = originalSecret;
});

/** Seed one row into every section so each test can prove what survived. */
async function seedWorld() {
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    ["conn-1", "openai", "api_key", "Seed Conn", null, 1, JSON.stringify({ apiKey: "seed" }), now, now]
  );
  db.run(
    `INSERT INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
    ["node-1", "worker", "Seed Node", JSON.stringify({ region: "local" }), now, now]
  );
  db.run(
    `INSERT INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt) VALUES(?, 1, ?, ?, ?, ?)`,
    ["pool-1", "unknown", JSON.stringify({ name: "Seed Pool", proxies: [] }), now, now]
  );
  db.run(
    `INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
    ["combo-1", "Seed Combo", "fallback", JSON.stringify(["openai/gpt-4o"]), now, now]
  );
  db.run(
    `INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, keyId, keyPrefix, endpoint, promptTokens, completionTokens, cost, status) VALUES(?, ?, ?, ?, 'sk-leaked-legacy', ?, ?, ?, ?, ?, ?, ?)`,
    [now, "openai", "gpt-4o", "conn-1", "k-1", "sk-1", "/v1/chat", 100, 50, 0.0012, "success"]
  );
  const { setModelAlias } = await import("@/lib/db/repos/aliasRepo.js");
  await setModelAlias("gpt-fast", "openai/gpt-4o");
  return { db, now };
}

/** Build a full backup payload (what /api/settings/database GET returns). */
async function buildPayload() {
  const { exportDb } = await import("@/lib/db/index.js");
  return exportDb();
}

describe("Selective import — the sections law", () => {
  it("restores ONLY the selected sections and leaves the rest untouched", async () => {
    await seedWorld();
    const { exportDb, importDb } = await import("@/lib/db/index.js");
    const payload = await exportDb();

    // Wipe the harbor to a known second state, then selectively restore just
    // combos from the original payload.
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.transaction(() => {
      db.run(`DELETE FROM combos`);
      db.run(`INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES('combo-live', 'Live Combo', 'fallback', '[]', '2026-01-01', '2026-01-01')`);
      db.run(`DELETE FROM usageHistory`);
    });

    const result = await importDb(payload, { sections: ["combos"] });

    // The selected section moved: the file's combo replaced the live one.
    expect(db.get(`SELECT name FROM combos WHERE id = 'combo-1'`)?.name).toBe("Seed Combo");
    expect(db.get(`SELECT id FROM combos WHERE id = 'combo-live'`)).toBeFalsy();
    // Every unselected section kept its current rows verbatim.
    expect(db.get(`SELECT id FROM providerConnections WHERE id = 'conn-1'`)).toBeTruthy();
    expect(db.get(`SELECT id FROM proxyPools WHERE id = 'pool-1'`)).toBeTruthy();
    // The usage table the file COULD have refilled was untouched because
    // usage was not selected — the live (emptied) ledger stays empty.
    expect(db.all(`SELECT id FROM usageHistory`)).toHaveLength(0);
    // The report names exactly what moved.
    expect(result.appliedSections).toEqual(["combos"]);
    expect(result.appliedRows).toBe(1);
  });

  it("refuses a selection the file carries nothing for (loud, not silent success)", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    await seedWorld();
    // A payload with only kv content: selecting keys must refuse.
    const { exportDb, importDb } = await import("@/lib/db/index.js");
    const payload = await buildPayload();
    expect(payload.apiKeys.length).toBeGreaterThanOrEqual(0);
    await expect(
      importDb({ kvScopes: { modelAliases: { a: "openai/gpt-4o" } } }, { sections: ["keys"] })
    ).rejects.toThrow(/No selected sections are present/);
    // And it refused BEFORE touching the harbor: the seeded rows all survive.
    expect(db.get(`SELECT id FROM providerConnections WHERE id = 'conn-1'`)).toBeTruthy();
    expect(db.get(`SELECT id FROM combos WHERE id = 'combo-1'`)).toBeTruthy();
  });

  it("dry run writes NOTHING and answers the plan", async () => {
    await seedWorld();
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const { exportDb, importDb } = await import("@/lib/db/index.js");
    const payload = await buildPayload();

    const result = await importDb(payload, { sections: ["combos", "usage"], dryRun: true });

    // Nothing was written: every seeded row still stands.
    expect(db.get(`SELECT id FROM combos WHERE id = 'combo-1'`)).toBeTruthy();
    expect(db.all(`SELECT id FROM usageHistory`)).toHaveLength(1);
    // The plan covers only the asked sections, with honest counts.
    expect(result.dryRun).toBe(true);
    expect(result.plan.map((p) => p.section)).toEqual(["combos", "usage"]);
    const combosRow = result.plan.find((p) => p.section === "combos");
    const usageRow = result.plan.find((p) => p.section === "usage");
    expect(combosRow.items).toBe(1);
    expect(usageRow.items).toBe(1); // one usageHistory row, zero usageDaily
    // An unrequested section is not in the plan.
    expect(result.plan.find((p) => p.section === "keys")).toBeUndefined();
  });

  it("quarantine holds under selection: current secrets survive a selective restore", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    await seedWorld();
    // A live key with a real hash identity.
    const { createApiKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    const key = await createApiKey("Live Probe", { category: "live" });
    const liveHash = db.get(`SELECT keyHash FROM apiKeys WHERE id = ?`, [key.keyId])?.keyHash;
    expect(liveHash).toBeTruthy();

    const { exportDb, importDb } = await import("@/lib/db/index.js");
    const payload = await buildPayload();

    // Selective restore of keys WITHOUT adoptSecrets: the live key's hash
    // identity must survive (current values stitched back), and the payload's
    // hash-bearing rows are quarantined the same way the whole-restore does it.
    const result = await importDb(payload, { sections: ["keys"] });
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [key.keyId]);
    expect(row.keyHash).toBe(liveHash);
    expect(row.category).toBe("live");
    // The report says keys moved.
    expect(result.appliedSections).toContain("keys");
  });

  it("whole restore without sections keeps the historical contract (flat payload spread)", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    await seedWorld();
    const { exportDb, importDb } = await import("@/lib/db/index.js");
    const payload = await buildPayload();

    // No options object at all — the call shape every existing caller uses.
    const result = await importDb(payload);

    // Everything came back (A3 round-trip on the cheap).
    expect(db.get(`SELECT id FROM providerConnections WHERE id = 'conn-1'`)).toBeTruthy();
    expect(db.get(`SELECT id FROM combos WHERE id = 'combo-1'`)).toBeTruthy();
    expect(db.all(`SELECT id FROM usageHistory`)).toHaveLength(1);
    expect(db.get(`SELECT value FROM kv WHERE scope = 'modelAliases' AND key = 'gpt-fast'`)).toBeTruthy();
    // The return still spreads the whole export — callers reading payload
    // fields off the return (mirror resync watermark, engine) see no change.
    expect(result.providerConnections).toHaveLength(1);
    expect(result._meta.schemaVersion).toBeGreaterThan(0);
    expect(result.appliedSections).toHaveLength(7);
  });
});
