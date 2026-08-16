// Per-key usage rollup — getKeyUsageStats() groups the ledger by keyId and
// the /api/keys/usage route exposes it for the Endpoints page. Attribution
// is keyId-based (hash-at-rest), so totals survive rotation; local-no-key
// traffic is not a key's story and stays excluded.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalSecret = process.env.API_KEY_SECRET;
const SECRET = "key-usage-test-secret";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-keyusage-"));
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = SECRET;
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

async function load() {
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  const usageRepo = await import("@/lib/db/repos/usageRepo.js");
  return { db, usageRepo };
}

function insertUsage(db, { keyId, ts, prompt = 0, completion = 0, cost = 0 }) {
  // Migration 004 made connectionId/keyId NOT NULL DEFAULT '' ('' = the
  // normalized "unset" form so the dedupe UNIQUE treats keyless rows the same
  // in both harbors) — fixtures write '' exactly as the live writer does.
  db.run(
    `INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, keyId, keyPrefix, endpoint, promptTokens, completionTokens, cost, status, tokens, meta)
     VALUES(?, ?, ?, '', NULL, ?, NULL, NULL, ?, ?, ?, 'ok', '{}', '{}')`,
    [ts, "openai", "gpt-test", keyId ?? "", prompt, completion, cost]
  );
}

describe("getKeyUsageStats — the ledger's per-key rollup", () => {
  it("groups requests/tokens/cost by keyId and reports lastUsed", async () => {
    const { db, usageRepo } = await load();
    insertUsage(db, { keyId: "key-a", ts: "2026-08-10T10:00:00.000Z", prompt: 100, completion: 50, cost: 0.01 });
    insertUsage(db, { keyId: "key-a", ts: "2026-08-12T10:00:00.000Z", prompt: 200, completion: 100, cost: 0.02 });
    insertUsage(db, { keyId: "key-b", ts: "2026-08-12T11:00:00.000Z", prompt: 5, completion: 5, cost: 0 });

    const all = await usageRepo.getKeyUsageStats("all");
    expect(Object.keys(all).sort()).toEqual(["key-a", "key-b"]);
    expect(all["key-a"]).toMatchObject({
      requests: 2, promptTokens: 300, completionTokens: 150, totalTokens: 450, cost: 0.03,
    });
    expect(all["key-a"].lastUsed).toBe("2026-08-12T10:00:00.000Z");
    expect(all["key-b"].requests).toBe(1);
  });

  it("excludes local-no-key traffic (keyId NULL)", async () => {
    const { db, usageRepo } = await load();
    insertUsage(db, { keyId: null, ts: "2026-08-12T10:00:00.000Z", prompt: 999, completion: 999 });
    insertUsage(db, { keyId: "key-a", ts: "2026-08-12T10:00:00.000Z", prompt: 1, completion: 1 });

    const all = await usageRepo.getKeyUsageStats("all");
    expect(Object.keys(all)).toEqual(["key-a"]);
  });

  it("respects the period window — 7d drops older rows", async () => {
    const { db, usageRepo } = await load();
    const old = new Date(Date.now() - 10 * 86400000).toISOString();
    const fresh = new Date(Date.now() - 1 * 86400000).toISOString();
    insertUsage(db, { keyId: "key-a", ts: old, prompt: 1000, completion: 0, cost: 5 });
    insertUsage(db, { keyId: "key-a", ts: fresh, prompt: 10, completion: 5, cost: 0.1 });

    const week = await usageRepo.getKeyUsageStats("7d");
    expect(week["key-a"]).toMatchObject({ requests: 1, promptTokens: 10, completionTokens: 5, cost: 0.1 });

    const all = await usageRepo.getKeyUsageStats("all");
    expect(all["key-a"].requests).toBe(2);
  });

  it("unknown periods fall back to all-time", async () => {
    const { db, usageRepo } = await load();
    insertUsage(db, { keyId: "key-a", ts: new Date(Date.now() - 100 * 86400000).toISOString(), prompt: 1 });
    const all = await usageRepo.getKeyUsageStats("bogus");
    expect(all["key-a"]?.requests).toBe(1);
  });

  it("empty ledger → empty map", async () => {
    const { usageRepo } = await load();
    expect(await usageRepo.getKeyUsageStats("all")).toEqual({});
  });
});

describe("/api/keys/usage route", () => {
  it("GET returns { period, byKey }", async () => {
    const { db } = await load();
    insertUsage(db, { keyId: "key-a", ts: new Date().toISOString(), prompt: 42, completion: 24, cost: 0.05 });
    const route = await import("@/app/api/keys/usage/route.js");
    const res = await route.GET(new Request("http://localhost/api/keys/usage?period=all"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.period).toBe("all");
    expect(body.byKey["key-a"].totalTokens).toBe(66);
  });

  it("GET rejects invalid period with 400", async () => {
    await load();
    const route = await import("@/app/api/keys/usage/route.js");
    const res = await route.GET(new Request("http://localhost/api/keys/usage?period=999d"));
    expect(res.status).toBe(400);
  });
});

describe("lastUsedAt — awakened by the gate", () => {
  it("resolveKey stamps lastUsedAt on real keys", async () => {
    const { db } = await load();
    const listRoutes = await import("@/app/api/keys/route.js");
    const created = await (await listRoutes.POST(new Request("http://localhost/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Usage Probe" }),
    }))).json();

    const before = db.get(`SELECT lastUsedAt FROM apiKeys WHERE id = ?`, [created.keyId]).lastUsedAt;
    expect(before).toBeNull();

    const { resolveKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    const row = await resolveKey(created.key);
    expect(row?.id).toBe(created.keyId);

    const after = db.get(`SELECT lastUsedAt FROM apiKeys WHERE id = ?`, [created.keyId]).lastUsedAt;
    expect(after).toBeTruthy();
    expect(new Date(after).getTime()).toBeGreaterThan(Date.now() - 5000);
  });
});
