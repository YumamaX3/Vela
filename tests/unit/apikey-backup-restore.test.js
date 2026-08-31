// Test covenant: apikey-backup-restore — hashes survive, plaintext never;
// pre-W1 payloads are tombstoned at restore time.
// Plan: plans/vela-key-governance.md §7.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalSecret = process.env.API_KEY_SECRET;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-backup-"));
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "backup-test-secret";
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

describe("backup/restore — hash survival, plaintext ban", () => {
  it("export → import round-trip: hash survives, the one-time key still resolves", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    await getAdapter();
    const { createApiKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    const { exportDb, importDb } = await import("@/lib/db/index.js");

    const { key, keyId, keyPrefix } = await createApiKey("Backup Probe", {
      description: "round-trip",
      allowedModels: ["openai/gpt-4o"],
    });

    const payload = await exportDb();
    expect(payload).toBeTruthy();

    // Wipe and restore
    await importDb(payload);
    const db = await getAdapter();
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [keyId]);
    expect(row).toBeTruthy();
    expect(row.keyPrefix).toBe(keyPrefix);
    expect(row.description).toBe("round-trip");
    expect(JSON.parse(row.allowedModels)).toEqual(["openai/gpt-4o"]);
    expect(row.keyVersion).toBe("v1");

    // The hash survived → the one-time key still resolves after restore
    const { resolveKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    const resolved = await resolveKey(key);
    expect(resolved?.id).toBe(keyId);
  });

  it("export payload never contains the one-time plaintext key", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    await getAdapter();
    const { createApiKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    const { exportDb } = await import("@/lib/db/index.js");

    const { key } = await createApiKey("Payload Probe");
    const payload = await exportDb();
    expect(JSON.stringify(payload)).not.toContain(key);

    const exported = payload.apiKeys[0];
    // M0 Tag 2 — the key column exports as NULL unconditionally (previously
    // the vela-minted placeholder). keyHash is the only exported identity.
    expect(exported.key).toBeNull();
    expect(exported.keyHash).toBeTruthy(); // hash IS exported — it's the identity
  });

  it("restoring a pre-W1 payload with a plaintext key tombstones it in-transaction", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    await getAdapter();
    const { importDb } = await import("@/lib/db/index.js");

    const now = new Date().toISOString();
    await importDb({
      settings: {},
      providerConnections: [], providerNodes: [], proxyPools: [], combos: [],
      modelAliases: {}, customModels: [], mitmAlias: {}, pricing: {},
      apiKeys: [
        { id: "pre-w1", key: "sk-ancient-plaintext", name: "Ancient Key", isActive: true, createdAt: now, machineId: null },
      ],
    });

    const db = await getAdapter();
    const row = db.get(`SELECT * FROM apiKeys WHERE id = 'pre-w1'`);
    expect(row).toBeTruthy();
    expect(row.key).toBe("revoked-pre-w1"); // tombstoned at restore time
    expect(row.key).not.toContain("sk-ancient-plaintext");
    expect(row.isActive).toBe(0);
    expect(row.keyVersion).toBe("legacy");
  });

  it("soft-revoked rows (hash NULL) survive the round-trip as audit rows", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    await getAdapter();
    const { createApiKey, deleteApiKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    const { exportDb, importDb } = await import("@/lib/db/index.js");

    const created = await createApiKey("Audit Survivor");
    await deleteApiKey(created.keyId); // soft-revoke → hash NULL

    const payload = await exportDb();
    await importDb(payload);

    const db = await getAdapter();
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [created.keyId]);
    expect(row).toBeTruthy(); // audit row persists through backup/restore
    expect(row.keyHash).toBeNull();
    expect(row.deletedAt).toBeTruthy();

    // Two NULL hashes can coexist through the restore (UNIQUE NULL-distinct)
    const second = await createApiKey("Audit Survivor 2");
    await deleteApiKey(second.keyId);
    const payload2 = await exportDb();
    await importDb(payload2);
    const nulls = db.all(`SELECT id FROM apiKeys WHERE keyHash IS NULL`);
    expect(nulls.length).toBe(2);
  });
});
