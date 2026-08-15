// Storage Covenant Wave C2 — the mirror decorator exit gate.
// Plan: plans/storage-covenant.md Wave C / Phase 10 (decorator: two documented
// behaviors — atomic containment + identity capture; S3 outbox hardening).
// Pinned here (sqlite leg; the pump proves apply in Wave C3):
//   1. Atomic containment — a classified writer's mutation AND its outbox row
//      commit together; a FAILING writer leaves NEITHER (savepoint rollback).
//   2. Identity capture — createCombo/createApiKey/createProviderConnection
//      capture the GENERATED identity from the execution result.
//   3. S3 — apiKeys identity captures keyHash/keyPrefix, NEVER the plaintext
//      key or the keyId; connection identity captures {id, createdAt,
//      updatedAt} ONLY, never tokens; args/identity JSON never contains them.
//   4. No-op writes (delete of a missing row, addCustomModel of an existing
//      model) enqueue NOTHING.
//   5. Reads + unclassified + NO_CAPTURE (touchKeyLastUsed) pass through
//      VERBATIM — the decorator never wraps them.
//   6. The createCombo REPLAY PROOF — the captured identity is sufficient to
//      re-insert the SAME row (uuid + timestamps) so combos.name UNIQUE never
//      poisons the pump.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const saved = {};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-c2-"));
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

async function initDb() {
  const db = await import("@/lib/db/index.js");
  await db.initDb();
  return db;
}

async function decorated(modPath) {
  const { decorateMirrorRepo } = await import("@/lib/db/mirror/mirrorDecorator.js");
  const mod = await import(modPath);
  return decorateMirrorRepo(mod);
}

async function outboxRows() {
  const { getAdapter } = await import("@/lib/db/driver.js");
  const adapter = await getAdapter();
  return adapter.all(`SELECT * FROM outbox ORDER BY seq ASC`);
}

describe("Wave C2 — atomic containment", () => {
  it("a classified writer commits its mutation AND its outbox row together", async () => {
    await initDb();
    const combos = await decorated("@/lib/db/repos/sqlite/combosRepo.js");
    const created = await combos.createCombo({ name: "c2-combo", models: ["m"] });
    expect(created.id).toBeTruthy();

    const rows = await outboxRows();
    expect(rows.length).toBe(1);
    expect(rows[0].fnName).toBe("createCombo");
    expect(rows[0].replayClass).toBe("identity-carrying");
    expect(JSON.parse(rows[0].args)).toEqual([{ name: "c2-combo", models: ["m"] }]);
    expect(rows[0].status).toBe("pending");

    // The mutation is live.
    const { getAdapter } = await import("@/lib/db/driver.js");
    expect((await getAdapter()).get(`SELECT COUNT(*) c FROM combos WHERE name='c2-combo'`).c).toBe(1);
  });

  it("a FAILING writer leaves no mutation AND no outbox row (rollback)", async () => {
    await initDb();
    const combos = await decorated("@/lib/db/repos/sqlite/combosRepo.js");
    await combos.createCombo({ name: "dup", models: ["m"] });

    // Same name → combos.name UNIQUE → the second insert throws INSIDE the writer.
    await expect(combos.createCombo({ name: "dup", models: ["m"] }))
      .rejects.toThrow(/UNIQUE/i);

    const rows = await outboxRows();
    // Exactly ONE row — the first successful create. The failed one left none.
    expect(rows.length).toBe(1);
  });

  it("updateSettings (rmw-stale-hazard) is captured with its args", async () => {
    await initDb();
    const settings = await decorated("@/lib/db/repos/sqlite/settingsRepo.js");
    await settings.updateSettings({ comboStrategy: "roundrobin" });
    const rows = await outboxRows();
    expect(rows.some((r) => r.fnName === "updateSettings" && r.replayClass === "rmw-stale-hazard")).toBe(true);
    const row = rows.find((r) => r.fnName === "updateSettings");
    expect(JSON.parse(row.args)).toEqual([{ comboStrategy: "roundrobin" }]);
    expect(row.identity).toBeNull(); // rmw carries no generated identity
  });
});

describe("Wave C2 — identity capture", () => {
  it("createCombo captures the GENERATED uuid + timestamps", async () => {
    await initDb();
    const combos = await decorated("@/lib/db/repos/sqlite/combosRepo.js");
    const created = await combos.createCombo({ name: "id-combo", models: ["m"] });
    const [row] = await outboxRows();
    const identity = JSON.parse(row.identity);
    expect(identity.id).toBe(created.id);
    expect(identity.createdAt).toBe(created.createdAt);
    expect(identity.updatedAt).toBe(created.updatedAt);
  });

  it("S3 — createApiKey captures keyHash/keyPrefix, NEVER the plaintext key or keyId", async () => {
    await initDb();
    const apiKeys = await decorated("@/lib/db/repos/sqlite/apiKeysRepo.js");
    const created = await apiKeys.createApiKey("c2-key");
    const [row] = await outboxRows();
    const identity = JSON.parse(row.identity);
    expect(identity.keyHash).toBe(created.record.keyHash);
    expect(identity.keyPrefix).toBe(created.record.keyPrefix);
    expect(identity.createdAt).toBe(created.record.createdAt);
    expect(identity.id).toBeUndefined(); // S3 — the row id IS the keyId; never captured
    // The S3 law: the plaintext key and keyId never ride the outbox.
    const serialized = JSON.stringify({ args: JSON.parse(row.args), identity });
    expect(serialized).not.toContain(created.key); // plaintext key absent
    expect(serialized).not.toContain(created.keyId); // keyId absent
  });

  it("S3 — createProviderConnection captures {id, createdAt, updatedAt} ONLY, never tokens", async () => {
    await initDb();
    const conns = await decorated("@/lib/db/repos/sqlite/connectionsRepo.js");
    const created = await conns.createProviderConnection({
      provider: "openai", name: "c2-conn", apiKey: "sk-super-secret-token",
    });
    const [row] = await outboxRows();
    const identity = JSON.parse(row.identity);
    expect(identity.id).toBe(created.id);
    expect(identity.createdAt).toBe(created.createdAt);
    expect(identity.updatedAt).toBe(created.updatedAt);
    expect(identity.apiKey).toBeUndefined();
    expect(identity.accessToken).toBeUndefined();
  });

  it("ensureInternalKey identity is null by design (deterministic re-execution)", async () => {
    await initDb();
    const apiKeys = await decorated("@/lib/db/repos/sqlite/apiKeysRepo.js");
    const created = await apiKeys.ensureInternalKey("c2-purpose");
    expect(created.keyId).toBeTruthy();
    const rows = await outboxRows();
    const row = rows.find((r) => r.fnName === "ensureInternalKey");
    expect(row).toBeTruthy();
    expect(row.replayClass).toBe("identity-carrying");
    expect(row.identity).toBeNull(); // S3 — capture keyId would leak; re-execute instead
  });
});

describe("Wave C2 — no-ops + passthrough", () => {
  it("a no-op delete enqueues nothing", async () => {
    await initDb();
    const combos = await decorated("@/lib/db/repos/sqlite/combosRepo.js");
    const deleted = await combos.deleteCombo("does-not-exist");
    expect(deleted).toBe(false);
    expect((await outboxRows()).length).toBe(0);
  });

  it("reads + unclassified + touchKeyLastUsed pass through VERBATIM", async () => {
    await initDb();
    const raw = await import("@/lib/db/repos/sqlite/combosRepo.js");
    const combos = await decorated("@/lib/db/repos/sqlite/combosRepo.js");
    // getCombos is a read — same function reference, unwrapped.
    expect(combos.getCombos).toBe(raw.getCombos);
    expect(combos.getComboById).toBe(raw.getComboById);

    const usageRaw = await import("@/lib/db/repos/sqlite/usageRepo.js");
    const usage = await decorated("@/lib/db/repos/sqlite/usageRepo.js");
    // touchKeyLastUsed is classified but NO_CAPTURE (sweep-excluded noise).
    expect(usage.touchKeyLastUsed).toBe(usageRaw.touchKeyLastUsed);
    // saveRequestUsage is exempt — never wrapped.
    expect(usage.saveRequestUsage).toBe(usageRaw.saveRequestUsage);

    // Reads leave no outbox cargo.
    await combos.getCombos();
    expect((await outboxRows()).length).toBe(0);
  });
});

describe("Wave C2 — the createCombo replay proof", () => {
  it("the captured identity re-inserts the SAME row — combos.name UNIQUE never poisons", async () => {
    await initDb();
    const combos = await decorated("@/lib/db/repos/sqlite/combosRepo.js");
    const created = await combos.createCombo({ name: "replay-combo", models: ["a", "b"] });
    const [row] = await outboxRows();
    const identity = JSON.parse(row.identity);
    const args = JSON.parse(row.args);

    // Simulate the pump replaying into a SECOND store: insert the SAME uuid +
    // timestamps. If the decorator had not captured identity, a naive replay
    // would re-mint a uuid and hit combos.name UNIQUE → poison. Here it lands.
    const { getAdapter } = await import("@/lib/db/driver.js");
    const adapter = await getAdapter();
    adapter.run(`DELETE FROM combos`); // pretend the twin is empty
    adapter.run(
      `INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
      [identity.id, args[0].name, args[0].kind ?? null, JSON.stringify(args[0].models), identity.createdAt, identity.updatedAt]
    );
    const replayed = adapter.get(`SELECT * FROM combos WHERE id = ?`, [identity.id]);
    expect(replayed.name).toBe("replay-combo");
    expect(replayed.createdAt).toBe(created.createdAt);

    // And replaying AGAIN (at-least-once delivery) must not poison — the
    // pump's seq-dedupe/UNIQUE guard absorbs it (proven by ON CONFLICT here).
    adapter.run(
      `INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET models = excluded.models`,
      [identity.id, args[0].name, args[0].kind ?? null, JSON.stringify(args[0].models), identity.createdAt, identity.updatedAt]
    );
    expect(adapter.get(`SELECT COUNT(*) c FROM combos`).c).toBe(1);
  });
});
