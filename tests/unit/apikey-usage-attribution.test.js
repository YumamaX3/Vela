// Test covenant: apikey-usage-attribution — keyId threading, masked-only writes.
// Plan: plans/vela-key-governance.md §7. The raw bearer token NEVER reaches
// usageHistory; attribution is keyed by keyId so it survives rotation.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalSecret = process.env.API_KEY_SECRET;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-usage-attr-"));
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "usage-attr-test-secret";
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

async function mintKey() {
  const { getAdapter } = await import("@/lib/db/driver.js");
  await getAdapter(); // ensure schema
  const { createApiKey } = await import("@/lib/db/repos/apiKeysRepo.js");
  return createApiKey("Usage Probe");
}

describe("usage attribution — keyId threading, never plaintext", () => {
  it("saveRequestUsage resolves keyId/keyPrefix and NEVER persists the raw bearer", async () => {
    const { key, keyId, keyPrefix } = await mintKey();
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { saveRequestUsage } = await import("@/lib/db/repos/usageRepo.js");

    await saveRequestUsage({
      apiKey: key, // raw bearer in — must never survive to disk
      provider: "openai",
      model: "gpt-4o",
      endpoint: "/v1/chat/completions",
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const db = await getAdapter();
    const rows = db.all(`SELECT * FROM usageHistory`);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.keyId).toBe(keyId);
    expect(row.keyPrefix).toBe(keyPrefix);
    expect(row.apiKey).toBeNull(); // masked-dual-write: plaintext column always NULL
    // belt-and-braces: the full key string appears nowhere in the row
    expect(JSON.stringify(row)).not.toContain(key);
  });

  it("daily aggregate attributes to keyId (byApiKey), not the raw key", async () => {
    const { key, keyId } = await mintKey();
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { saveRequestUsage } = await import("@/lib/db/repos/usageRepo.js");

    await saveRequestUsage({
      apiKey: key,
      provider: "openai",
      model: "gpt-4o",
      tokens: { prompt_tokens: 3, completion_tokens: 2 },
    });

    const db = await getAdapter();
    const day = db.get(`SELECT data FROM usageDaily`);
    const parsed = JSON.parse(day.data);
    const akKeys = Object.keys(parsed.byApiKey || {});
    expect(akKeys.length).toBe(1);
    expect(akKeys[0]).toContain(keyId); // keyed by keyId
    expect(JSON.stringify(parsed)).not.toContain(key); // raw bearer absent
  });

  it("unresolved key → null attribution, still masked (fail-open)", async () => {
    await mintKey();
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { saveRequestUsage } = await import("@/lib/db/repos/usageRepo.js");

    await saveRequestUsage({
      apiKey: "vela-v1-" + "a".repeat(32) + "-deadbeef", // valid shape, unknown + bad CRC
      provider: "openai",
      model: "gpt-4o",
      tokens: { prompt_tokens: 1, completion_tokens: 1 },
    });

    const db = await getAdapter();
    const row = db.get(`SELECT * FROM usageHistory`);
    // Migration 004 normalized '' as "unset" (NOT NULL DEFAULT '') — the
    // writer emits '' for unattributed rows; only keyPrefix stays NULL.
    expect(row.keyId).toBe("");
    expect(row.keyPrefix).toBeNull();
    expect(row.apiKey).toBeNull();
  });

  it("no key at all → local-no-key bucket in daily aggregate", async () => {
    await mintKey();
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { saveRequestUsage } = await import("@/lib/db/repos/usageRepo.js");

    await saveRequestUsage({
      provider: "openai",
      model: "gpt-4o",
      tokens: { prompt_tokens: 1, completion_tokens: 1 },
    });

    const db = await getAdapter();
    const day = db.get(`SELECT data FROM usageDaily`);
    const parsed = JSON.parse(day.data);
    expect(Object.keys(parsed.byApiKey)[0]).toContain("local-no-key");
  });

  it("getUsageHistory returns keyId + masked prefix, never the raw key", async () => {
    const { key, keyId, keyPrefix } = await mintKey();
    const { saveRequestUsage, getUsageHistory } = await import("@/lib/db/repos/usageRepo.js");

    await saveRequestUsage({
      apiKey: key,
      provider: "openai",
      model: "gpt-4o",
      tokens: { prompt_tokens: 2, completion_tokens: 2 },
    });

    const history = await getUsageHistory();
    expect(history).toHaveLength(1);
    expect(history[0].keyId).toBe(keyId);
    expect(history[0].apiKeyMasked).toBe(keyPrefix);
    expect(history[0]).not.toHaveProperty("apiKey");
    expect(JSON.stringify(history)).not.toContain(key);
  });
});
