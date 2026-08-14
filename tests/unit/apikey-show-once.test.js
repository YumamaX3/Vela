// Test covenant: apikey-show-once — negative-leak assertions.
// Plan: plans/vela-key-governance.md §7. The full key exists ONLY in the 201
// creation response; every other surface must provably not contain it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalSecret = process.env.API_KEY_SECRET;
const SECRET = "show-once-test-secret";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-showonce-"));
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

async function loadRoutes() {
  const listRoutes = await import("@/app/api/keys/route.js");
  const idRoutes = await import("@/app/api/keys/[id]/route.js");
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  return { listRoutes, idRoutes, db };
}

function post(body) {
  return new Request("http://localhost/api/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("show-once contract — negative-leak assertions", () => {
  it("POST 201 carries the one-time key; GET rows and the DB never do", async () => {
    const { listRoutes, idRoutes, db } = await loadRoutes();

    const createRes = await listRoutes.POST(post({ name: "Leak Probe" }));
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.key).toMatch(/^vela-v1-[0-9a-f]{32}-[0-9a-f]{8}$/);
    expect(created.keyId).toBeTruthy();
    expect(created.record.keyPrefix).toBe(`vela-v1-${created.keyId.slice(0, 4)}…`);

    // The DB stores only the hash — never the plaintext
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [created.keyId]);
    expect(row.keyHash).toBe(crypto.createHash("sha256").update(created.key).digest("hex"));
    expect(row.key).not.toBe(created.key); // legacy column holds only a placeholder
    expect(row.key).toBe(`vela-minted-${created.keyId}`);
    expect(JSON.stringify(row)).not.toContain(created.key);

    // GET list: no field carries the full key or its hash
    const getRes = await listRoutes.GET(new Request("http://localhost/api/keys"));
    const listed = await getRes.json();
    expect(listed.keys).toHaveLength(1);
    const serialized = JSON.stringify(listed);
    expect(serialized).not.toContain(created.key);
    expect(serialized).not.toContain(row.keyHash);
    expect(listed.keys[0]).not.toHaveProperty("key");
    expect(listed.keys[0]).not.toHaveProperty("keyHash");

    // GET by id: same guarantees
    const oneRes = await idRoutes.GET(new Request(`http://localhost/api/keys/${created.keyId}`), { params: { id: created.keyId } });
    const one = await oneRes.json();
    expect(one.key).not.toHaveProperty("key");
    expect(JSON.stringify(one)).not.toContain(created.key);

    // resolveKey proves the hash is the identity: the one-time key still validates
    const { resolveKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    const resolved = await resolveKey(created.key);
    expect(resolved?.id).toBe(created.keyId);
  });

  it("POST rejects empty name with 400", async () => {
    const { listRoutes } = await loadRoutes();
    const res = await listRoutes.POST(post({ name: "   " }));
    expect(res.status).toBe(400);
  });

  it("POST rejects malformed allowedModels with 400", async () => {
    const { listRoutes } = await loadRoutes();
    const res = await listRoutes.POST(post({ name: "Bad Scope", allowedModels: "not-an-array" }));
    expect(res.status).toBe(400);
  });

  it("PUT whitelist: name/description/allowedModels/isActive only — security columns immutable", async () => {
    const { listRoutes, idRoutes, db } = await loadRoutes();
    const created = await (await listRoutes.POST(post({ name: "Whitelist Probe" }))).json();

    const putRes = await idRoutes.PUT(
      new Request(`http://localhost/api/keys/${created.keyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Renamed",
          description: "desc",
          allowedModels: ["openai/gpt-4o"],
          isActive: false,
          // smuggled security fields — must be silently ignored (repo whitelist)
          keyHash: "attacker-hash",
          keyVersion: "attacker",
          keyPrefix: "attacker-prefix",
          isInternal: 1,
          rotatedFrom: "attacker",
        }),
      }),
      { params: { id: created.keyId } }
    );
    expect(putRes.status).toBe(200);

    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [created.keyId]);
    expect(row.name).toBe("Renamed");
    expect(row.description).toBe("desc");
    expect(JSON.parse(row.allowedModels)).toEqual(["openai/gpt-4o"]);
    expect(row.isActive).toBe(0);
    // security columns untouched
    expect(row.keyHash).toBe(crypto.createHash("sha256").update(created.key).digest("hex"));
    expect(row.keyVersion).toBe("v1");
    expect(row.isInternal).toBe(0);
    expect(row.keyPrefix).toBe(created.keyPrefix);
    expect(row.rotatedFrom).toBeNull();
  });

  it("PUT allowedModels=null restores unrestricted scope", async () => {
    const { listRoutes, idRoutes } = await loadRoutes();
    const created = await (await listRoutes.POST(post({ name: "Scope Toggle", allowedModels: ["a/b"] }))).json();
    const res = await idRoutes.PUT(
      new Request(`http://localhost/api/keys/${created.keyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowedModels: null }),
      }),
      { params: { id: created.keyId } }
    );
    const body = await res.json();
    expect(body.key.allowedModels).toBeNull();
  });

  it("DELETE is a soft-revoke: audit row survives, hash NULLed, key no longer resolves", async () => {
    const { listRoutes, idRoutes, db } = await loadRoutes();
    const created = await (await listRoutes.POST(post({ name: "Revoke Me" }))).json();

    const delRes = await idRoutes.DELETE(new Request(`http://localhost/api/keys/${created.keyId}`, { method: "DELETE" }), { params: { id: created.keyId } });
    expect(delRes.status).toBe(200);

    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [created.keyId]);
    expect(row).toBeTruthy(); // audit row survives
    expect(row.keyHash).toBeNull(); // hash NULLed → key can never resolve again
    expect(row.deletedAt).toBeTruthy();
    expect(row.isActive).toBe(0);

    const { resolveKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    expect(await resolveKey(created.key)).toBeNull();

    // Gone from the list
    const listed = await (await listRoutes.GET(new Request("http://localhost/api/keys"))).json();
    expect(listed.keys.find((k) => k.id === created.keyId)).toBeUndefined();
  });
});
