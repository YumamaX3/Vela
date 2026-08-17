// Storage Covenant Wave A3 — the export completeness law, pinned.
// Plan: plans/storage-covenant.md A3 + success criterion 4 + Tidebreaker
// revision 5 (generic-scope export is a PRECONDITION for mirror resync).
//
// Two falsifiable claims:
//   1. COMPLETENESS — exportDb() covers every table and every kv scope,
//      including a scope no hardcoded list could know about (generic
//      enumeration), the previously-dropped `disabledModels` scope, and the
//      previously-dropped usageHistory/usageDaily tables.
//   2. ROUND-TRIP EQUALITY — importDb(exportDb()) preserves content: every
//      seeded row and scope survives the wipe + restore.
//
// S2 redaction / S1 quarantine are Wave B bindings (plan line 467) and are
// deliberately not asserted here — they would contradict round-trip equality.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalSecret = process.env.API_KEY_SECRET;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-export-"));
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "completeness-test-secret";
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

/** Seed every table + a spread of kv scopes through the repos + raw kv writes. */
async function seedWorld() {
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  const now = new Date().toISOString();

  // Config tables — direct inserts (the test targets export/import, not the
  // create fns; deterministic rows beat repo validation here).
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
    ["pool-1", "unknown", JSON.stringify({ name: "Seed Pool", proxyUrl: "socks5://seed", proxies: [] }), now, now]
  );
  db.run(
    `INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
    ["combo-1", "Seed Combo", "fallback", JSON.stringify(["openai/gpt-4o"]), now, now]
  );

  // apiKeys through the repo — the hash identity must round-trip.
  const { createApiKey } = await import("@/lib/db/repos/apiKeysRepo.js");
  const key = await createApiKey("Completeness Probe", { description: "round-trip", category: "seed-cat" });

  // kv scopes through their repos (key format matters).
  const { setModelAlias, addCustomModel } = await import("@/lib/db/repos/aliasRepo.js");
  const { disableModels } = await import("@/lib/db/repos/disabledModelsRepo.js");
  const { updatePricing } = await import("@/lib/db/repos/pricingRepo.js");
  await setModelAlias("gpt-fast", "openai/gpt-4o");
  await addCustomModel({ providerAlias: "seed", id: "custom-1", type: "llm", name: "Seed Custom" });
  await disableModels("openai", ["gpt-4.1"]); // THE previously-dropped scope
  await updatePricing({ openai: { "gpt-4o": { input: 2.5, output: 10 } } });

  // A scope no hardcoded list could know about — the decisive generic-scope probe.
  db.run(`INSERT INTO kv(scope, key, value) VALUES('futureScope', 'probe', ?)`, [JSON.stringify({ seeded: true })]);

  // Usage ledger — previously dropped from exports entirely.
  db.run(
    `INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, keyId, keyPrefix, endpoint, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, ?, ?, 'sk-leaked-legacy', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [now, "openai", "gpt-4o", "conn-1", key.keyId, key.keyPrefix, "/v1/chat", 100, 50, 0.0012, "success", JSON.stringify({ cached: 10 }), JSON.stringify({ seed: true })]
  );
  db.run(
    `INSERT INTO usageDaily(dateKey, data) VALUES(?, ?)`,
    ["2026-08-15", JSON.stringify({ totalRequests: 1, byApiKey: { probe: { requests: 1 } } })]
  );

  // requestDetails — opt-in only.
  db.run(
    `INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?)`,
    ["rd-1", now, "openai", "gpt-4o", "conn-1", "success", JSON.stringify({ detail: "seed" })]
  );

  return { key, now };
}

describe("Storage Covenant A3 — export completeness law", () => {
  it("exportDb covers every table, every kv scope, and an unknown scope (generic enumeration)", async () => {
    await import("@/lib/db/driver.js").then((m) => m.getAdapter());
    await seedWorld();
    const { exportDb } = await import("@/lib/db/index.js");

    const payload = await exportDb();

    // Every table present
    expect(payload.providerConnections.length).toBe(1);
    expect(payload.providerNodes.length).toBe(1);
    expect(payload.proxyPools.length).toBe(1);
    expect(payload.combos.length).toBe(1);
    expect(payload.apiKeys.length).toBeGreaterThanOrEqual(1);
    // The previously-dropped tables now flow
    expect(payload.usageHistory.length).toBe(1);
    expect(payload.usageDaily.length).toBe(1);
    // requestDetails is opt-in — absent unless asked
    expect(payload.requestDetails).toBeUndefined();

    // Generic-scope kv: known scopes + the previously-dropped disabledModels +
    // the unknown futureScope, all by construction.
    expect(payload.kvScopes.modelAliases["gpt-fast"]).toBe("openai/gpt-4o");
    expect(payload.kvScopes.disabledModels.openai).toEqual(["gpt-4.1"]);
    expect(payload.kvScopes.pricing.openai["gpt-4o"]).toMatchObject({ input: 2.5 });
    expect(payload.kvScopes.futureScope.probe).toEqual({ seeded: true });
    expect(Object.keys(payload.kvScopes.customModels).length).toBe(1);

    // Legacy named views still present for pre-A3 consumers
    expect(payload.modelAliases["gpt-fast"]).toBe("openai/gpt-4o");
    expect(payload.disabledModels.openai).toEqual(["gpt-4.1"]);
    expect(payload.customModels.length).toBe(1);

    // Provenance header
    expect(payload._meta.schemaVersion).toBe(9);
    expect(payload._meta.sourceMode).toBe("sqlite");
    expect(payload._meta.sourceDriver).toBeTruthy();
    expect(payload._meta.exportedAt).toBeTruthy();

    // The legacy plaintext apiKey column never rides an artifact
    expect(payload.usageHistory[0].apiKey).toBeNull();

    // apiKeys carry the migration-003 category (previously dropped)
    const probe = payload.apiKeys.find((k) => k.name === "Completeness Probe");
    expect(probe.category).toBe("seed-cat");
    expect(probe.keyHash).toBeTruthy();
  });

  it("round-trip equality: importDb(exportDb()) preserves every table and scope", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const { key } = await seedWorld();
    // createApiKey returns {key, keyId, keyPrefix}; the hash lives in the row.
    const keyHash = db.get(`SELECT keyHash FROM apiKeys WHERE id = ?`, [key.keyId]).keyHash;
    const { exportDb, importDb } = await import("@/lib/db/index.js");

    const payload = await exportDb();
    await importDb(payload);

    // Config tables survived
    expect(db.get(`SELECT id FROM providerConnections WHERE id = 'conn-1'`)).toBeTruthy();
    expect(db.get(`SELECT id FROM providerNodes WHERE id = 'node-1'`)).toBeTruthy();
    expect(db.get(`SELECT id FROM proxyPools WHERE id = 'pool-1'`)).toBeTruthy();
    expect(db.get(`SELECT id FROM combos WHERE id = 'combo-1'`)).toBeTruthy();

    // apiKeys: hash + category survived; the key still resolves
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [key.keyId]);
    expect(row.keyHash).toBe(keyHash);
    expect(row.category).toBe("seed-cat");
    const { resolveKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    expect((await resolveKey(key.key))?.id).toBe(key.keyId);

    // Every kv scope survived — including the unknown one
    const scopes = db.all(`SELECT DISTINCT scope FROM kv ORDER BY scope`).map((r) => r.scope);
    expect(scopes).toContain("modelAliases");
    expect(scopes).toContain("customModels");
    expect(scopes).toContain("disabledModels");
    expect(scopes).toContain("pricing");
    expect(scopes).toContain("futureScope");
    expect(db.get(`SELECT value FROM kv WHERE scope = 'futureScope' AND key = 'probe'`).value).toContain("seeded");

    // Usage ledger survived with ids intact
    const uh = db.get(`SELECT * FROM usageHistory LIMIT 1`);
    expect(uh.promptTokens).toBe(100);
    expect(uh.completionTokens).toBe(50);
    expect(uh.apiKey).toBeNull(); // banned column stays null
    expect(db.get(`SELECT data FROM usageDaily WHERE dateKey = '2026-08-15'`).data).toContain("totalRequests");

    // requestDetails wiped by default export (not present in payload)
    expect(db.get(`SELECT id FROM requestDetails WHERE id = 'rd-1'`)).toBeFalsy();

    // Re-export equals export (stable round-trip). Volatile columns are
    // normalized away — the same set the plan's divergence-sweep checksum
    // spec enumerates (line 245): exportedAt (provenance), and
    // apiKeys.lastUsedAt (written by three paths; the resolveKey assertion
    // above fired its first throttled touch between the two exports).
    const again = await exportDb();
    const strip = (p) => JSON.stringify({
      ...p,
      _meta: { ...p._meta, exportedAt: null },
      apiKeys: (p.apiKeys || []).map((k) => ({ ...k, lastUsedAt: null })),
    });
    expect(strip(again)).toBe(strip(payload));
  });

  it("requestDetails round-trips when opted in", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    await seedWorld();
    const { exportDb, importDb } = await import("@/lib/db/index.js");

    const payload = await exportDb({ includeRequestDetails: true });
    expect(payload.requestDetails.length).toBe(1);
    await importDb(payload);

    const rd = db.get(`SELECT * FROM requestDetails WHERE id = 'rd-1'`);
    expect(rd).toBeTruthy();
    expect(JSON.parse(rd.data).detail).toBe("seed");
  });

  it("pre-A3 payloads (legacy named kv fields, no kvScopes) still import", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    await getAdapter();
    const { importDb } = await import("@/lib/db/index.js");

    const now = new Date().toISOString();
    await importDb({
      settings: { requireApiKey: true },
      providerConnections: [], providerNodes: [], proxyPools: [], combos: [], apiKeys: [],
      modelAliases: { "legacy-alias": "openai/gpt-4o" },
      customModels: [{ providerAlias: "legacy", id: "cm-1", type: "llm", name: "Legacy" }],
      mitmAlias: { claude: { "legacy-m": "anthropic/claude" } },
      pricing: { openai: { "gpt-4o": { input: 1, output: 2 } } },
      pricingSync: {},
      disabledModels: { legacy: ["blocked-1"] },
    });

    expect(db.get(`SELECT value FROM kv WHERE scope = 'modelAliases' AND key = 'legacy-alias'`).value).toContain("gpt-4o");
    expect(db.get(`SELECT value FROM kv WHERE scope = 'customModels' AND key = 'legacy|cm-1|llm'`).value).toContain("Legacy");
    expect(db.get(`SELECT value FROM kv WHERE scope = 'disabledModels' AND key = 'legacy'`).value).toContain("blocked-1");
    expect(db.get(`SELECT data FROM settings WHERE id = 1`).data).toContain("requireApiKey");
  });
});
