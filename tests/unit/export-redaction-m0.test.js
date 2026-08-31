// M0 Tag 2 — the plaintext export redaction gate.
// The wound: exportDb spread providerConnections' full `data` blob (upstream
// apiKey/accessToken/refreshToken secrets) and apiKeys' raw `key` column into
// every export. Combined with any auth hole that was a credential-exfil path.
//
// Pinned here:
//   1. REDACTION (opt-in: exportDb({ redact: true })) — no secret value rides
//      the plaintext payload anywhere: top-level connection credential fields,
//      nested providerSpecificData credentials, and proxy-URL userinfo.
//   2. GATEWAY KEYS — apiKeys[].key exports as NULL UNCONDITIONALLY (even on
//      the default full-fidelity export); keyHash/keyPrefix survive.
//   3. FULL-FIDELITY DEFAULT — exportDb() without the flag keeps upstream
//      credentials intact: runBackup's encrypted artifact path and mirrorSweep
//      resync both ride it and both need the real secrets.
//   4. COMPLETENESS — redaction never drops rows/fields it doesn't name:
//      name/email/priority/pool urls without userinfo all survive.
//   5. RESTORE — importDb accepts a redacted export without throwing
//      (redacted fields restore as redacted; the S1 quarantine law unchanged).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Fake upstream secrets — searchable in the serialized payload.
const FAKE = {
  apiKey: "sk-live-fake-apikey-9f8e7d6c",
  accessToken: "at-fake-access-token-1a2b3c",
  refreshToken: "rt-fake-refresh-token-4d5e6f",
  idToken: "idt-fake-id-token-7g8h9i",
  clientSecret: "cs-fake-oidc-client-secret",
  copilotToken: "cpt-fake-copilot-token",
  machineId: "mid-fake-cursor-machine-id",
  firebaseIdToken: "fbt-fake-firebase-token",
  proxyCredUrl: "http://proxy-user:proxy-pass-XYZ@10.0.0.9:7897",
  gatewayKey: "vela-v1-fakegatewaykey0123456789abcdef",
};

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalSecret = process.env.API_KEY_SECRET;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-m0-redact-"));
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "m0-redaction-test-secret";
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

/** Seed: one secret-laden connection, one clean connection, two proxy pools
 *  (one with userinfo credentials, one clean), one W1 key, one legacy
 *  plaintext-key row (simulating a pre-W1 survivor). */
async function seedWorld() {
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    ["conn-secret", "openai", "oauth", "Secret Conn", "star@shores.eternal", 1,
      JSON.stringify({
        apiKey: FAKE.apiKey,
        accessToken: FAKE.accessToken,
        refreshToken: FAKE.refreshToken,
        idToken: FAKE.idToken,
        displayName: "keep-me",
        providerSpecificData: {
          clientSecret: FAKE.clientSecret,
          copilotToken: FAKE.copilotToken,
          machineId: FAKE.machineId,
          firebaseIdToken: FAKE.firebaseIdToken,
          authMethod: "oauth",          // non-secret — must survive
          chatgptAccountId: "acc-123",  // non-secret — must survive
          deep: { token: "deep-nested-secret-token", harmless: "keep" },
        },
      }), now, now]
  );
  db.run(
    `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    ["conn-clean", "openai", "apikey", "Clean Conn", null, 2,
      JSON.stringify({ baseUrl: "https://clean.example", displayName: "clean" }), now, now]
  );
  db.run(
    `INSERT INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt) VALUES(?, 1, ?, ?, ?, ?)`,
    ["pool-secret", "unknown",
      JSON.stringify({ name: "Credentialed Pool", proxyUrl: FAKE.proxyCredUrl, proxies: [] }), now, now]
  );
  db.run(
    `INSERT INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt) VALUES(?, 1, ?, ?, ?, ?)`,
    ["pool-clean", "unknown",
      JSON.stringify({ name: "Clean Pool", proxyUrl: "socks5://10.0.0.1:1080", proxies: [] }), now, now]
  );

  const { createApiKey } = await import("@/lib/db/repos/apiKeysRepo.js");
  const { key } = await createApiKey("M0 Probe", { description: "redaction pin" });

  // A pre-W1-style row whose `key` column still carries plaintext (keyHash
  // present so migration 002's tombstone never touched it — the export must
  // null it regardless).
  db.run(
    `INSERT INTO apiKeys(id, key, name, isActive, createdAt, keyHash, keyPrefix, isInternal, deletedAt) VALUES(?, ?, ?, 1, ?, ?, ?, 0, NULL)`,
    ["key-legacy", FAKE.gatewayKey, "legacy survivor", now, "m0-legacy-hash", "vela-legacy"]
  );

  return { key };
}

describe("M0 Tag 2 — export redaction (the plaintext surface)", () => {
  it("redacted export carries NO secret value anywhere in the payload", async () => {
    await seedWorld();
    const { exportDb } = await import("@/lib/db/index.js");

    const payload = await exportDb({ redact: true });
    const serialized = JSON.stringify(payload);

    // Every fake secret — top-level, nested, deep-nested, URL userinfo, and
    // the legacy gateway key — must be absent from the serialized payload.
    for (const secret of Object.values(FAKE)) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("redacts connection secret fields but keeps completeness", async () => {
    await seedWorld();
    const { exportDb } = await import("@/lib/db/index.js");
    const payload = await exportDb({ redact: true });

    const conn = payload.providerConnections.find((c) => c.id === "conn-secret");
    expect(conn.apiKey).toBe("[REDACTED]");
    expect(conn.accessToken).toBe("[REDACTED]");
    expect(conn.refreshToken).toBe("[REDACTED]");
    expect(conn.idToken).toBe("[REDACTED]");
    expect(conn.providerSpecificData.clientSecret).toBe("[REDACTED]");
    expect(conn.providerSpecificData.copilotToken).toBe("[REDACTED]");
    expect(conn.providerSpecificData.machineId).toBe("[REDACTED]");
    expect(conn.providerSpecificData.firebaseIdToken).toBe("[REDACTED]");
    expect(conn.providerSpecificData.deep.token).toBe("[REDACTED]");

    // Completeness — non-secret fields survive untouched.
    expect(conn.name).toBe("Secret Conn");
    expect(conn.email).toBe("star@shores.eternal");
    expect(conn.priority).toBe(1);
    expect(conn.displayName).toBe("keep-me");
    expect(conn.providerSpecificData.authMethod).toBe("oauth");
    expect(conn.providerSpecificData.chatgptAccountId).toBe("acc-123");
    expect(conn.providerSpecificData.deep.harmless).toBe("keep");

    // The clean connection is untouched.
    const clean = payload.providerConnections.find((c) => c.id === "conn-clean");
    expect(clean.baseUrl).toBe("https://clean.example");

    // Proxy pools: userinfo credentials redact WHOLE; clean urls survive.
    const poolSecret = payload.proxyPools.find((p) => p.id === "pool-secret");
    expect(poolSecret.proxyUrl).toBe("[REDACTED]");
    expect(poolSecret.name).toBe("Credentialed Pool"); // identity survives
    const poolClean = payload.proxyPools.find((p) => p.id === "pool-clean");
    expect(poolClean.proxyUrl).toBe("socks5://10.0.0.1:1080");
  });

  it("apiKeys.key exports as NULL unconditionally; keyHash/keyPrefix survive", async () => {
    await seedWorld();
    const { exportDb } = await import("@/lib/db/index.js");
    const payload = await exportDb({ redact: true });

    for (const k of payload.apiKeys) {
      expect(k.key).toBeNull();
    }
    const legacy = payload.apiKeys.find((k) => k.id === "key-legacy");
    expect(legacy.keyHash).toBe("m0-legacy-hash");
    expect(legacy.keyPrefix).toBe("vela-legacy");
    expect(legacy.name).toBe("legacy survivor"); // identity survives
    const probe = payload.apiKeys.find((k) => k.name === "M0 Probe");
    expect(probe.keyHash).toBeTruthy();
  });

  it("the DEFAULT export stays full-fidelity (artifact + resync contract)", async () => {
    await seedWorld();
    const { exportDb } = await import("@/lib/db/index.js");
    const payload = await exportDb();

    // Connection credentials RIDE the full-fidelity export — runBackup and
    // mirrorSweep resync depend on it (they are not plaintext surfaces).
    const conn = payload.providerConnections.find((c) => c.id === "conn-secret");
    expect(conn.accessToken).toBe(FAKE.accessToken);
    expect(conn.refreshToken).toBe(FAKE.refreshToken);
    expect(conn.providerSpecificData.clientSecret).toBe(FAKE.clientSecret);
    const pool = payload.proxyPools.find((p) => p.id === "pool-secret");
    expect(pool.proxyUrl).toBe(FAKE.proxyCredUrl);

    // But the gateway key column is banned from EVERY export, redacted or not.
    for (const k of payload.apiKeys) expect(k.key).toBeNull();
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(FAKE.gatewayKey);
  });

  it("importDb accepts a redacted export without throwing", async () => {
    const { key } = await seedWorld();
    const { exportDb, importDb } = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");

    const payload = await exportDb({ redact: true });
    await expect(importDb(payload)).resolves.toBeTruthy();

    // Redacted fields restored AS redacted — sentinel rides the data blob;
    // the key still resolves through its hash (identity preserved).
    const db = await getAdapter();
    const conn = db.get(`SELECT data FROM providerConnections WHERE id = 'conn-secret'`);
    expect(conn.data).toContain("[REDACTED]");
    expect(conn.data).not.toContain(FAKE.accessToken);
    const { resolveKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    expect((await resolveKey(key))?.name).toBe("M0 Probe");
  });
});

describe("M0 Tag 2 — the pure redactor (redactSecretConnectionData)", () => {
  it("never mutates its input; walks arrays; passes empties through", async () => {
    const { redactSecretConnectionData } = await import("@/lib/db/repos/backupSecurity.js");
    const input = {
      apiKey: "s", providerSpecificData: { machineId: "m", keep: "k" },
      list: [{ token: "t", ok: 1 }], empty: "", nothing: null,
    };
    const frozen = JSON.stringify(input);
    const out = redactSecretConnectionData(input);
    expect(JSON.stringify(input)).toBe(frozen); // input untouched
    expect(out.apiKey).toBe("[REDACTED]");
    expect(out.providerSpecificData.machineId).toBe("[REDACTED]");
    expect(out.providerSpecificData.keep).toBe("k");
    expect(out.list[0].token).toBe("[REDACTED]");
    expect(out.list[0].ok).toBe(1);
    expect(out.empty).toBe(""); // empties pass through — no sentinel noise
    expect(out.nothing).toBeNull();
    // A bare userinfo URL string redacts whole.
    expect(redactSecretConnectionData("http://u:p@h:1")).toBe("[REDACTED]");
    expect(redactSecretConnectionData("https://h:1/path")).toBe("https://h:1/path");
  });
});
