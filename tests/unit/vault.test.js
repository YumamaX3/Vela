// Credential vault (F-5) — envelope encryption, ported from 9router-go.
//
// Pinned here:
//   1. seal/open round-trips and every seal differs (fresh DEK + nonce).
//   2. Tampering fails authentication instead of returning garbage.
//   3. Rotation re-wraps the DEK only; ciphertext is byte-identical, the
//      retired key still opens rows, and a fresh process with only the new key
//      reads rows whose DEKs were re-wrapped.
//   4. A missing/malformed VELA_MASTER_KEY degrades to a disabled vault
//      (plaintext passthrough), never a boot refusal.
//   5. providerConnections no longer holds whitelisted credentials in `data`;
//      reads re-inject them; an unrelated update keeps the sealed pair; a null
//      patch clears its slot.
//   6. The boot migration seals rows written before the key existed.
//
// Every credential below is EXAMPLE fixture text, not a live key.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const KEY1 = Buffer.alloc(32, 7).toString("base64");
const KEY2 = Buffer.alloc(32, 9).toString("base64");
let tempDir;
const saved = {};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-vault-"));
  saved.DATA_DIR = process.env.DATA_DIR;
  saved.MODE = process.env.VELA_DB_MODE;
  saved.KEY = process.env.VELA_MASTER_KEY;
  saved.PREV = process.env.VELA_MASTER_KEY_PREVIOUS;
  process.env.DATA_DIR = tempDir;
  delete process.env.VELA_DB_MODE;
  process.env.VELA_MASTER_KEY = KEY1;
  delete process.env.VELA_MASTER_KEY_PREVIOUS;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(async () => {
  try {
    const { resetVault } = await import("@/lib/vault.js");
    resetVault();
  } catch { /* module may not have loaded */ }
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

describe("vault crypto", () => {
  it("round-trips, and two seals of the same plaintext differ", async () => {
    const { Vault } = await import("@/lib/vault.js");
    const v = new Vault(Buffer.from(KEY1, "base64"));
    const a = v.seal("EXAMPLE_SECRET_VALUE");
    const b = v.seal("EXAMPLE_SECRET_VALUE");
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.wrappedDEK).not.toBe(b.wrappedDEK);
    expect(v.open(a.wrappedDEK, a.ciphertext)).toBe("EXAMPLE_SECRET_VALUE");
    expect(v.open(b.wrappedDEK, b.ciphertext)).toBe("EXAMPLE_SECRET_VALUE");
  });

  it("rejects tampered ciphertext", async () => {
    const { Vault } = await import("@/lib/vault.js");
    const v = new Vault(Buffer.from(KEY1, "base64"));
    const { wrappedDEK, ciphertext } = v.seal("EXAMPLE_TOP_SECRET");
    const raw = Buffer.from(ciphertext, "base64");
    raw[raw.length - 1] ^= 0xff;
    expect(() => v.open(wrappedDEK, raw.toString("base64"))).toThrow(/authentication|tampered/i);
  });

  it("rotates without touching ciphertext, and the retired key stays readable", async () => {
    const { Vault } = await import("@/lib/vault.js");
    const v = new Vault(Buffer.from(KEY1, "base64"));
    const sealed = v.seal("EXAMPLE_ROTATE_ME");

    const rewrapped = v.rewrap(sealed.wrappedDEK, Buffer.from(KEY2, "base64"));
    expect(sealed.ciphertext).toBeTruthy();
    v.rotate(Buffer.from(KEY2, "base64"));

    // Same ciphertext, new wrapped DEK; the in-process vault reads it.
    expect(v.open(rewrapped, sealed.ciphertext)).toBe("EXAMPLE_ROTATE_ME");
    // A fresh process holding only the new key reads the re-wrapped row.
    const fresh = new Vault(Buffer.from(KEY2, "base64"));
    expect(fresh.open(rewrapped, sealed.ciphertext)).toBe("EXAMPLE_ROTATE_ME");
    // The retired key is still on this instance for rows not yet re-wrapped.
    expect(v.open(sealed.wrappedDEK, sealed.ciphertext)).toBe("EXAMPLE_ROTATE_ME");
  });

  it("degrades to disabled on a missing or malformed key", async () => {
    const { Vault } = await import("@/lib/vault.js");
    expect(Vault.fromEnv({}).enabled).toBe(false);
    expect(Vault.fromEnv({ VELA_MASTER_KEY: "not-base64" }).enabled).toBe(false);
    expect(Vault.fromEnv({ VELA_MASTER_KEY: Buffer.alloc(16, 1).toString("base64") }).enabled).toBe(false);
    const off = Vault.disabled();
    expect(off.open("", "plaintext")).toBe("plaintext");
  });
});

describe("providerConnections sealing", () => {
  it("keeps credentials out of data and re-injects them on read", async () => {
    await freshDb();
    const repo = await import("@/lib/db/repos/sqlite/connectionsRepo.js");
    const { getAdapter } = await import("@/lib/db/driver.js");

    const created = await repo.createProviderConnection({
      provider: "openai",
      authType: "apikey",
      name: "vault-proof",
      apiKey: "EXAMPLE_PLAINTEXT_API_KEY",
      accessToken: "EXAMPLE_PLAINTEXT_ACCESS_TOKEN",
      refreshToken: "EXAMPLE_PLAINTEXT_REFRESH_TOKEN",
      providerSpecificData: { idToken: "EXAMPLE_PLAINTEXT_ID_TOKEN", region: "eu" },
      baseUrl: "https://example.invalid",
    });

    const row = (await getAdapter()).get(`SELECT * FROM providerConnections WHERE id = ?`, [created.id]);
    expect(row.data).not.toContain("EXAMPLE_PLAINTEXT");
    expect(row.data).toContain("eu"); // config stays plaintext
    expect(row.secretCiphertext).not.toBe("");
    expect(row.tokenCiphertext).not.toBe("");
    expect(row.refreshCiphertext).not.toBe("");

    const read = await repo.getProviderConnectionById(created.id);
    expect(read.apiKey).toBe("EXAMPLE_PLAINTEXT_API_KEY");
    expect(read.accessToken).toBe("EXAMPLE_PLAINTEXT_ACCESS_TOKEN");
    expect(read.refreshToken).toBe("EXAMPLE_PLAINTEXT_REFRESH_TOKEN");
    expect(read.providerSpecificData.idToken).toBe("EXAMPLE_PLAINTEXT_ID_TOKEN");
    expect(read.providerSpecificData.region).toBe("eu");
  });

  it("an unrelated update leaves the sealed pairs untouched", async () => {
    await freshDb();
    const repo = await import("@/lib/db/repos/sqlite/connectionsRepo.js");
    const { getAdapter } = await import("@/lib/db/driver.js");

    const created = await repo.createProviderConnection({
      provider: "openai", authType: "apikey", name: "stable", apiKey: "EXAMPLE_STABLE_KEY",
    });
    const before = (await getAdapter()).get(`SELECT * FROM providerConnections WHERE id = ?`, [created.id]);

    await repo.updateProviderConnection(created.id, { name: "renamed" });

    const after = (await getAdapter()).get(`SELECT * FROM providerConnections WHERE id = ?`, [created.id]);
    expect(after.secretCiphertext).toBe(before.secretCiphertext);
    expect((await repo.getProviderConnectionById(created.id)).apiKey).toBe("EXAMPLE_STABLE_KEY");
  });

  it("an explicit null clears its slot instead of resurrecting the old token", async () => {
    await freshDb();
    const repo = await import("@/lib/db/repos/sqlite/connectionsRepo.js");
    const { getAdapter } = await import("@/lib/db/driver.js");

    const created = await repo.createProviderConnection({
      provider: "openai", authType: "oauth", apiKey: "EXAMPLE_OLD_API_KEY", accessToken: "EXAMPLE_OLD_TOKEN",
    });
    await repo.updateProviderConnection(created.id, { accessToken: null });

    const row = (await getAdapter()).get(`SELECT * FROM providerConnections WHERE id = ?`, [created.id]);
    expect(row.tokenCiphertext).toBe("");
    const read = await repo.getProviderConnectionById(created.id);
    expect(read.accessToken).toBeUndefined();
    expect(read.apiKey).toBe("EXAMPLE_OLD_API_KEY");
  });

  it("with no master key, the row stays plaintext and readable", async () => {
    delete process.env.VELA_MASTER_KEY;
    vi.resetModules();
    await freshDb();
    const repo = await import("@/lib/db/repos/sqlite/connectionsRepo.js");
    const { getAdapter } = await import("@/lib/db/driver.js");

    const created = await repo.createProviderConnection({
      provider: "anthropic", authType: "apikey", name: "plain", apiKey: "EXAMPLE_PLAIN_KEY",
    });
    const row = (await getAdapter()).get(`SELECT * FROM providerConnections WHERE id = ?`, [created.id]);
    expect(row.data).toContain("EXAMPLE_PLAIN_KEY");
    expect(row.secretCiphertext).toBe("");
    expect((await repo.getProviderConnectionById(created.id)).apiKey).toBe("EXAMPLE_PLAIN_KEY");
  });

  it("the boot migration seals rows written before the key existed", async () => {
    // Seed a plaintext row through a vault-less import path, then boot with the key.
    delete process.env.VELA_MASTER_KEY;
    vi.resetModules();
    await freshDb();
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["pre-vault", "openai", "apikey", "legacy", null, 1, 1, JSON.stringify({ apiKey: "EXAMPLE_LEGACY_KEY" }), now, now]
    );

    process.env.VELA_MASTER_KEY = KEY1;
    vi.resetModules();
    const { resetVault } = await import("@/lib/vault.js");
    resetVault();
    const { getVaultCounts, migratePlaintextCredentials } =
      await import("@/lib/db/repos/sqlite/vaultRepo.js");
    expect((await getVaultCounts()).plaintext).toBe(1);

    const result = await migratePlaintextCredentials();
    expect(result.sealed).toBe(1);
    expect(result.skipped).toEqual([]);

    const row = db.get(`SELECT * FROM providerConnections WHERE id = ?`, ["pre-vault"]);
    expect(row.data).not.toContain("EXAMPLE_LEGACY_KEY");
    expect(row.secretCiphertext).not.toBe("");

    const connRepo = await import("@/lib/db/repos/sqlite/connectionsRepo.js");
    expect((await connRepo.getProviderConnectionById("pre-vault")).apiKey).toBe("EXAMPLE_LEGACY_KEY");
  });
});
