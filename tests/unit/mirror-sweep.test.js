// Storage Covenant Wave C4 — divergence sweep + usage-resync (sqlite leg).
// Plan (plans/storage-covenant.md) named C4 scenario (line 434):
//   "drift-injection → sweep flags → resync restores"
//
// Proven here against the REAL sqlite primary and a SHADOW twin injected via
// setMirrorSweepSeams / setUsageResyncSeams — the Star's parity twin is never
// touched by this leg (its live legs ride tests/unit/mirror-sweep-live.test.js
// behind the double opt-in). The shadow's importDb rebuilds rows exactly the
// way repos/mysql/backupRepo.js importDb does (named columns out, rest → data,
// booleans → 0/1), so "resync restores" proves the export→import round-trip
// yields twin-faithful RAW rows whose fingerprint matches the primary's.
//
// Also pinned: the fingerprint's named exclusion list (updatedAt, lastUsedAt,
// apiKeys pk divergence — the C3 mirror-minted `mirror:${keyHash}` ids), the
// REAL-vs-DECIMAL epsilon guard, the drain-window guard, the ledger alerts,
// the watermark idempotence law, S3 (usage batches never carry apiKey), and
// the full-resync secret stitch (mitmSudoEncrypted never lands as sentinel).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const saved = {};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-c4-"));
  saved.DATA_DIR = process.env.DATA_DIR;
  saved.MODE = process.env.VELA_DB_MODE;
  process.env.DATA_DIR = tempDir;
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

async function freshDb() {
  const db = await import("@/lib/db/index.js");
  await db.initDb();
  return db;
}

async function adapter() {
  const { getAdapter } = await import("@/lib/db/driver.js");
  return getAdapter();
}

async function ledgerRows() {
  const db = await adapter();
  return db.all(`SELECT * FROM backupLedger ORDER BY createdAt ASC`);
}

// ─── Primary seeding (run-prefixed, raw-row shapes) ─────────────────────

async function seedPrimary() {
  const db = await adapter();
  db.run(
    `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?)`,
    ["pc-1", "anthropic", "oauth", "c4-conn", null, null, 1, JSON.stringify({ baseUrl: "https://example.test" }), "t1", "t1"]
  );
  db.run(
    `INSERT INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?,?,?,?,?,?)`,
    ["pn-1", "relay", "c4-node", JSON.stringify({ region: "sg" }), "t1", "t1"]
  );
  db.run(
    `INSERT INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt) VALUES(?,?,?,?,?,?)`,
    ["pp-1", 1, "unknown", JSON.stringify({ name: "c4-pool" }), "t1", "t1"]
  );
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, keyVersion, keyHash, keyPrefix, description, allowedModels, isInternal, deletedAt, expiresAt, lastUsedAt, rotatedFrom, rotationPrevHash, rotationPrevKeyId, rotationGraceUntil, tokenBudgetDaily, spendCapDailyCents, budgetScope, rateLimitRpm, ipAllowlist, category) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ["key-1", "vela-c4-key", "c4-key", null, 1, "t1", "w1", "kh-c4-1", "vela-c4", null, null, 0, null, null, "t-used", null, null, null, null, null, null, null, null, null, null]
  );
  db.run(
    `INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?,?,?,?,?,?)`,
    ["combo-1", "c4-combo", "fallback", JSON.stringify(["m1", "m2"]), "t1", "t1"]
  );
  db.run(`INSERT INTO kv(scope, key, value) VALUES(?,?,?)`, ["modelAliases", "alias-a", JSON.stringify({ target: "m1" })]);
}

/** Snapshot the primary's raw rows into the shadow twin. */
async function snapshotShadow() {
  const db = await adapter();
  const shadow = {};
  for (const t of ["providerConnections", "providerNodes", "proxyPools", "apiKeys", "combos", "kv"]) {
    shadow[t] = db.all(`SELECT * FROM ${t}`).map((r) => ({ ...r }));
  }
  return shadow;
}

/** Rebuild the shadow twin from an export payload EXACTLY the way
 *  repos/mysql/backupRepo.js importDb maps payload rows onto table rows. */
function rebuildShadow(shadow, payload) {
  shadow.providerConnections = (payload.providerConnections || []).map(({ id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest }) => ({
    id, provider, authType: authType || "oauth", name: name || null, email: email || null,
    priority: priority || null, isActive: isActive === false ? 0 : 1,
    data: JSON.stringify(rest), createdAt, updatedAt,
  }));
  shadow.providerNodes = (payload.providerNodes || []).map(({ id, type, name, createdAt, updatedAt, ...rest }) => ({
    id, type: type || null, name: name || null, data: JSON.stringify(rest), createdAt, updatedAt,
  }));
  shadow.proxyPools = (payload.proxyPools || []).map(({ id, isActive, testStatus, createdAt, updatedAt, ...rest }) => ({
    id, isActive: isActive === false ? 0 : 1, testStatus: testStatus || "unknown",
    data: JSON.stringify(rest), createdAt, updatedAt,
  }));
  shadow.apiKeys = (payload.apiKeys || []).map((k) => ({
    id: k.id, key: k.key, name: k.name, machineId: k.machineId ?? null,
    isActive: k.isActive ? 1 : 0, createdAt: k.createdAt,
    keyVersion: k.keyVersion ?? null, keyHash: k.keyHash ?? null, keyPrefix: k.keyPrefix ?? null,
    description: k.description ?? null, allowedModels: k.allowedModels ?? null,
    isInternal: k.isInternal ? 1 : 0, deletedAt: k.deletedAt ?? null,
    expiresAt: k.expiresAt ?? null, lastUsedAt: k.lastUsedAt ?? null,
    rotatedFrom: k.rotatedFrom ?? null, rotationPrevHash: k.rotationPrevHash ?? null,
    rotationPrevKeyId: k.rotationPrevKeyId ?? null, rotationGraceUntil: k.rotationGraceUntil ?? null,
    tokenBudgetDaily: k.tokenBudgetDaily ?? null, spendCapDailyCents: k.spendCapDailyCents ?? null,
    budgetScope: k.budgetScope ?? null, rateLimitRpm: k.rateLimitRpm ?? null,
    ipAllowlist: k.ipAllowlist ?? null, category: k.category ?? null,
  }));
  shadow.combos = (payload.combos || []).map((c) => ({
    id: c.id, name: c.name, kind: c.kind || null, models: JSON.stringify(c.models || []),
    createdAt: c.createdAt, updatedAt: c.updatedAt,
  }));
  shadow.kv = [];
  for (const [scope, entries] of Object.entries(payload.kvScopes || {})) {
    for (const [key, value] of Object.entries(entries || {})) {
      shadow.kv.push({ scope, key, value: JSON.stringify(value) });
    }
  }
}

// ─── The pure fingerprint ────────────────────────────────────────────────

describe("Wave C4 — the divergence fingerprint (pure)", () => {
  it("tolerates the named hazards: updatedAt, lastUsedAt, JSON key order, order, epsilon, apiKeys pk divergence", async () => {
    const { fingerprintRows, compareFingerprints } = await import("@/lib/db/mirror/mirrorFingerprint.js");

    // updatedAt is derived — a merge-write stamp is never divergence.
    const a = [{ id: "c1", name: "x", kind: null, models: '["m"]', createdAt: "t", updatedAt: "t1" }];
    const b = [{ id: "c1", name: "x", kind: null, models: '["m"]', createdAt: "t", updatedAt: "t2" }];
    expect(compareFingerprints("combos", fingerprintRows("combos", a), fingerprintRows("combos", b)).match).toBe(true);

    // JSON key order never reads as drift.
    const j1 = [{ scope: "s", key: "k", value: '{"b":2,"a":1}' }];
    const j2 = [{ scope: "s", key: "k", value: '{"a":1,"b":2}' }];
    expect(compareFingerprints("kv", fingerprintRows("kv", j1), fingerprintRows("kv", j2)).match).toBe(true);

    // Storage/return order never reads as drift (sorted multiset).
    const two = [
      { id: "c1", name: "x", kind: null, models: "[]", createdAt: "t", updatedAt: "t" },
      { id: "c2", name: "y", kind: null, models: "[]", createdAt: "t", updatedAt: "t" },
    ];
    expect(compareFingerprints("combos", fingerprintRows("combos", two), fingerprintRows("combos", [two[1], two[0]])).match).toBe(true);

    // REAL-vs-DECIMAL epsilon — fractional values round to the twin's 6dp width.
    const e1 = [{ id: "pc", provider: "p", authType: "oauth", name: "n", email: null, priority: 0.5, isActive: 1, data: "{}", createdAt: "t" }];
    const e2 = [{ id: "pc", provider: "p", authType: "oauth", name: "n", email: null, priority: 0.5000001, isActive: 1, data: "{}", createdAt: "t" }];
    expect(compareFingerprints("providerConnections", fingerprintRows("providerConnections", e1), fingerprintRows("providerConnections", e2)).match).toBe(true);

    // apiKeys — the C3 mirror-minted twin row (`mirror:${keyHash}` id + derived
    // key, replay-NULL machineId, flapping lastUsedAt) fingerprints EQUAL to
    // its primary row: keyHash + governance fields are the compared content.
    const primary = [{ id: "key-1", key: "vela-live", machineId: "m-1", keyHash: "kh-1", keyPrefix: "p", name: "n", isActive: 1, createdAt: "t", lastUsedAt: "t1", rotatedFrom: null, rotationPrevKeyId: null, rotationPrevHash: "h", keyVersion: "w1", description: null, allowedModels: null, isInternal: 0, deletedAt: null, expiresAt: null, rotationGraceUntil: null, tokenBudgetDaily: null, spendCapDailyCents: null, budgetScope: null, rateLimitRpm: null, ipAllowlist: null, category: null }];
    const mirrorMinted = [{ ...primary[0], id: "mirror:kh-1", key: "vela-minted-42", machineId: null, lastUsedAt: "t9" }];
    expect(compareFingerprints("apiKeys", fingerprintRows("apiKeys", primary), fingerprintRows("apiKeys", mirrorMinted)).match).toBe(true);

    // Genuine drift still flags — content change (rowDrift) and count change.
    const drifted = [{ ...b[0], name: "changed" }];
    const verdict = compareFingerprints("combos", fingerprintRows("combos", a), fingerprintRows("combos", drifted));
    expect(verdict.match).toBe(false);
    expect(verdict.rowDrift).toBe(true); // same count, drifted rows
    const fewer = compareFingerprints("combos", fingerprintRows("combos", two), fingerprintRows("combos", a));
    expect(fewer.match).toBe(false);
    expect(fewer.rowDrift).toBe(false); // count mismatch
  });

  it("the sweep read seams refuse anything off the fingerprint whitelist", async () => {
    await freshDb();
    const sqliteSeam = await import("@/lib/db/repos/sqlite/mirrorSweepRepo.js");
    await expect(sqliteSeam.fetchSweepRows("usageHistory")).rejects.toThrow(/whitelist/);
    await expect(sqliteSeam.fetchSweepRows("outbox")).rejects.toThrow(/whitelist/);
    await expect(sqliteSeam.fetchSweepRows("backupLedger")).rejects.toThrow(/whitelist/);
  });
});

// ─── The named scenario ──────────────────────────────────────────────────

describe("Wave C4 — drift-injection → sweep flags → resync restores", () => {
  it("the full scenario: clean world → injected drift → ledger alert + full resync → fingerprints match again", async () => {
    await freshDb();
    await seedPrimary();
    const shadow = await snapshotShadow();
    const twinSettings = { mitmSudoEncrypted: "twin-mitm-secret" };
    const importCalls = [];

    const { setMirrorSweepSeams, runDivergenceSweepOnce } = await import("@/lib/db/mirror/mirrorSweep.js");
    const sqliteBackup = await import("@/lib/db/repos/sqlite/backupRepo.js");
    const sweepRead = await import("@/lib/db/repos/sqlite/mirrorSweepRepo.js");
    setMirrorSweepSeams({
      fetchRows: async (harbor, table) =>
        harbor === "sqlite" ? sweepRead.fetchSweepRows(table) : shadow[table].map((r) => ({ ...r })),
      exportDb: () => sqliteBackup.exportDb({ includeRequestDetails: false }),
      importDb: async (payload, opts) => { importCalls.push(opts); rebuildShadow(shadow, payload); },
      getTwinSettings: async () => ({ ...twinSettings }),
    });

    // 1. The clean world — primary and twin agree on every table.
    const clean = await runDivergenceSweepOnce();
    expect(clean.swept).toBe(true);
    expect(clean.divergent).toEqual([]);
    expect(clean.matched.length).toBe(6);
    expect(clean.resynced).toBeNull();

    // 2. Drift-injection — a row mutates AND a row vanishes on the twin.
    shadow.combos[0] = { ...shadow.combos[0], name: "drifted-combo" };
    shadow.providerConnections.pop();

    // 3. The sweep flags it LOUD — ledger alert names both drifted tables,
    //    then the full resync restores the twin from the primary's truth.
    const flagged = await runDivergenceSweepOnce();
    expect(flagged.divergent.map((d) => d.table).sort()).toEqual(["combos", "providerConnections"]);
    const comboVerdict = flagged.divergent.find((d) => d.table === "combos");
    expect(comboVerdict.rowDrift).toBe(true); // same count, drifted content
    expect(importCalls).toEqual([{ adoptKeys: true }]); // mirror-faithful key identity
    expect(flagged.resynced.resynced).toBe(true);

    const ledger = await ledgerRows();
    const alert = ledger.find((r) => r.kind === "mirrorDivergence");
    expect(alert).toBeTruthy();
    expect(alert.status).toBe("failed");
    expect(alert.meta).toContain("combos");
    const resync = ledger.find((r) => r.kind === "mirrorResync");
    expect(resync).toBeTruthy();
    expect(resync.status).toBe("ok");

    // 4. Restored — the post-resync sweep finds zero divergence, and the
    //    twin's apiKeys row carries the PRIMARY's keyHash (adoptKeys).
    const restored = await runDivergenceSweepOnce();
    expect(restored.divergent).toEqual([]);
    expect(shadow.apiKeys[0].keyHash).toBe("kh-c4-1");
    expect(shadow.apiKeys[0].id).toBe("key-1"); // the primary's id replaced the mint
    // The twin kept its own secret — never the S2 sentinel.
    expect(shadow.providerConnections.length).toBe(1);
  });

  it("the drain-window guard: pending outbox rows read as intentional lag, never drift", async () => {
    await freshDb();
    await seedPrimary();
    const shadow = await snapshotShadow();
    const { setMirrorSweepSeams, runDivergenceSweepOnce } = await import("@/lib/db/mirror/mirrorSweep.js");
    const sweepRead = await import("@/lib/db/repos/sqlite/mirrorSweepRepo.js");
    setMirrorSweepSeams({
      fetchRows: async (harbor, table) =>
        harbor === "sqlite" ? sweepRead.fetchSweepRows(table) : shadow[table].map((r) => ({ ...r })),
      importDb: async () => { throw new Error("resync must not run mid-drain"); },
    });

    const outbox = await import("@/lib/db/repos/sqlite/outboxRepo.js");
    await outbox.enqueueOutbox({ replayClass: "idempotent-upsert", fnName: "deleteCombo", args: ["x"] });

    const result = await runDivergenceSweepOnce();
    expect(result).toEqual({ swept: false, skipped: "drain-in-progress", matched: [], divergent: [] });
    expect(await ledgerRows()).toEqual([]); // no alert, no resync
  });

  it("autoResync off: the alert lands, the resync is owed but not run", async () => {
    await freshDb();
    await seedPrimary();
    const shadow = await snapshotShadow();
    shadow.combos[0] = { ...shadow.combos[0], name: "drifted" };
    let imported = 0;
    const { setMirrorSweepSeams, runDivergenceSweepOnce } = await import("@/lib/db/mirror/mirrorSweep.js");
    const sweepRead = await import("@/lib/db/repos/sqlite/mirrorSweepRepo.js");
    setMirrorSweepSeams({
      fetchRows: async (harbor, table) =>
        harbor === "sqlite" ? sweepRead.fetchSweepRows(table) : shadow[table].map((r) => ({ ...r })),
      importDb: async () => { imported++; },
    });

    const result = await runDivergenceSweepOnce({ autoResync: false });
    expect(result.divergent.length).toBe(1);
    expect(result.resynced).toBeNull();
    expect(imported).toBe(0);
    const alert = (await ledgerRows()).find((r) => r.kind === "mirrorDivergence");
    expect(alert.status).toBe("failed");
  });
});

// ─── The full-resync secret stitch ───────────────────────────────────────

describe("Wave C4 — the full resync keeps the twin's secrets (S2 + the mitm hazard)", () => {
  it("sentinels are stitched back to the twin's live secrets; a twin without one drops the sentinel", async () => {
    await freshDb();
    const settingsRepo = await import("@/lib/db/repos/sqlite/settingsRepo.js");
    await settingsRepo.updateSettings({
      password: "primary-pass", mitmSudoEncrypted: "primary-mitm",
      oidcClientSecret: "primary-oidc", theme: "dark",
    });

    const { setMirrorSweepSeams, runFullResync } = await import("@/lib/db/mirror/mirrorSweep.js");
    const sqliteBackup = await import("@/lib/db/repos/sqlite/backupRepo.js");
    const captured = [];
    setMirrorSweepSeams({
      exportDb: () => sqliteBackup.exportDb({ includeRequestDetails: false }),
      importDb: async (payload, opts) => { captured.push({ payload, opts }); },
      // The twin holds password + mitm but NOT oidcClientSecret.
      getTwinSettings: async () => ({ password: "twin-pass", mitmSudoEncrypted: "twin-mitm-secret" }),
    });

    const result = await runFullResync();
    expect(result.resynced).toBe(true);
    const { payload, opts } = captured[0];
    expect(opts).toEqual({ adoptKeys: true });
    // The twin's own live secrets are stitched back over the S2 sentinels —
    // mitmSudoEncrypted is redacted-but-NOT-quarantined, so without the stitch
    // the literal sentinel would land as a live secret.
    expect(payload.settings.password).toBe("twin-pass");
    expect(payload.settings.mitmSudoEncrypted).toBe("twin-mitm-secret");
    // The twin holds no oidcClientSecret — the sentinel is dropped, never installed.
    expect(payload.settings.oidcClientSecret).toBeUndefined();
    expect(payload.settings.theme).toBe("dark"); // non-secret settings flow
  });
});

// ─── The usage-resync watermark ──────────────────────────────────────────

describe("Wave C4 — the usage-resync watermark (incremental, bounded, idempotent)", () => {
  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  async function seedUsage() {
    const usage = await import("@/lib/db/repos/sqlite/usageRepo.js");
    // Deterministic distinct timestamps + token counts — migration 004's
    // uq_uh_dedupe identity is (timestamp, provider, model, connectionId,
    // keyId, promptTokens, completionTokens); identical rows written in the
    // same millisecond collapse by design, so the seed must vary its identity.
    for (let i = 0; i < 3; i++) {
      await usage.saveRequestUsage({
        provider: "p", model: "m",
        timestamp: `2026-08-16T06:0${i}:00.000Z`,
        tokens: { prompt_tokens: 10 + i, completion_tokens: 5 },
      });
    }
    const db = await adapter();
    // A deterministic day-aggregate for the touched bucket.
    db.run(`INSERT OR REPLACE INTO usageDaily(dateKey, data) VALUES(?, ?)`, [todayKey(), JSON.stringify({ requests: 3 })]);
  }

  it("bounded batches drain beyond the watermark; daily + lifetime counter ride the pass; redelivery is a no-op", async () => {
    await freshDb();
    await seedUsage();
    const applied = [];
    const dailies = [];
    const lifetimes = [];
    const { setUsageResyncSeams, runUsageResyncOnce } = await import("@/lib/db/mirror/usageResync.js");
    setUsageResyncSeams({
      applyUsageBatch: async (rows) => { applied.push(rows.map((r) => r.id)); return rows.length; },
      applyUsageDaily: async (rows) => { dailies.push(...rows); return rows.length; },
      applyLifetimeCounter: async (v) => { lifetimes.push(v); },
    });

    // Batch size 2 → two batches (2 + 1) drain the three rows in id order.
    const pass = await runUsageResyncOnce({ batchSize: 2 });
    expect(pass.appended).toBe(3);
    expect(pass.watermark).toBe(3);
    expect(pass.synced).toBe(true);
    expect(applied.flat()).toEqual([1, 2, 3]);
    expect(applied[0]).toEqual([1, 2]); // bounded
    expect(dailies.map((d) => d.dateKey)).toEqual([todayKey()]);
    const { fetchTotalRequestsLifetime } = await import("@/lib/db/repos/sqlite/usageResyncRepo.js");
    expect(lifetimes).toEqual([await fetchTotalRequestsLifetime()]);

    // Caught up — the rerun is a no-op (the watermark holds).
    const again = await runUsageResyncOnce({ batchSize: 2 });
    expect(again).toMatchObject({ synced: false, appended: 0, watermark: 3 });
    expect(applied.length).toBe(2); // no third batch call

    // New rows beyond the watermark are picked up incrementally.
    const usage = await import("@/lib/db/repos/sqlite/usageRepo.js");
    await usage.saveRequestUsage({ provider: "p", model: "m", tokens: { prompt_tokens: 1 } });
    const third = await runUsageResyncOnce({ batchSize: 2 });
    expect(third.appended).toBe(1);
    expect(third.watermark).toBe(4);
    expect(applied[2]).toEqual([4]);
  });

  it("S3 — the usage batch never carries the legacy plaintext apiKey column", async () => {
    await freshDb();
    await seedUsage();
    const { fetchUsageBatch } = await import("@/lib/db/repos/sqlite/usageResyncRepo.js");
    const batch = await fetchUsageBatch(0, 10);
    expect(batch.length).toBe(3);
    for (const row of batch) expect(row.apiKey).toBeUndefined(); // never selected
  });

  it("the watermark only moves forward — a stale call never regresses it", async () => {
    await freshDb();
    const { setUsageWatermark, getUsageWatermark } = await import("@/lib/db/repos/sqlite/usageResyncRepo.js");
    expect(await setUsageWatermark(7)).toBe(7);
    expect(await setUsageWatermark(3)).toBe(7); // stale — refused
    expect(await setUsageWatermark(0)).toBe(7); // invalid — refused
    expect(await getUsageWatermark()).toBe(7);
  });
});
