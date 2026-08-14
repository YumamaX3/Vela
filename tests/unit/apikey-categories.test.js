// Key categories — free-form labels on API keys (friend / hermes / others…).
// Migration 003 adds apiKeys.category; the repo exposes sanitizeCategory
// (trim, whitespace-collapse, 48-char cap) on both create and update paths;
// the routes validate at the gate and 400 on bad shapes.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalSecret = process.env.API_KEY_SECRET;
const SECRET = "category-test-secret";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-category-"));
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

describe("sanitizeCategory — the repo's normalization rule", () => {
  it("null/undefined/whitespace-only → null", async () => {
    const { sanitizeCategory } = await import("@/lib/db/repos/apiKeysRepo.js");
    expect(sanitizeCategory(null)).toBeNull();
    expect(sanitizeCategory(undefined)).toBeNull();
    expect(sanitizeCategory("")).toBeNull();
    expect(sanitizeCategory("   ")).toBeNull();
  });

  it("trims and collapses inner whitespace", async () => {
    const { sanitizeCategory } = await import("@/lib/db/repos/apiKeysRepo.js");
    expect(sanitizeCategory("  friend  keys ")).toBe("friend keys");
    expect(sanitizeCategory("hermes")).toBe("hermes");
  });

  it("throws on non-string input", async () => {
    const { sanitizeCategory } = await import("@/lib/db/repos/apiKeysRepo.js");
    expect(() => sanitizeCategory(42)).toThrow();
    expect(() => sanitizeCategory(["friend"])).toThrow();
  });

  it("throws on more than 48 characters", async () => {
    const { sanitizeCategory } = await import("@/lib/db/repos/apiKeysRepo.js");
    expect(() => sanitizeCategory("x".repeat(49))).toThrow(/48/);
    expect(sanitizeCategory("x".repeat(48))).toBe("x".repeat(48));
  });
});

describe("category on the create path", () => {
  it("POST with category stores it normalized; GET surfaces it", async () => {
    const { listRoutes, db } = await loadRoutes();
    const res = await listRoutes.POST(post({ name: "Friend Key", category: "  friend  " }));
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.record.category).toBe("friend");

    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [created.keyId]);
    expect(row.category).toBe("friend");

    const listed = await (await listRoutes.GET(new Request("http://localhost/api/keys"))).json();
    expect(listed.keys.find((k) => k.id === created.keyId)?.category).toBe("friend");
  });

  it("POST without category stores NULL", async () => {
    const { listRoutes, db } = await loadRoutes();
    const created = await (await listRoutes.POST(post({ name: "No Category" }))).json();
    expect(created.record.category).toBeNull();
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [created.keyId]);
    expect(row.category).toBeNull();
  });

  it("POST rejects oversized category with 400", async () => {
    const { listRoutes } = await loadRoutes();
    const res = await listRoutes.POST(post({ name: "Long Cat", category: "x".repeat(49) }));
    expect(res.status).toBe(400);
  });

  it("POST rejects non-string category with 400", async () => {
    const { listRoutes } = await loadRoutes();
    const res = await listRoutes.POST(post({ name: "Bad Cat", category: 42 }));
    expect(res.status).toBe(400);
  });
});

describe("category on the update path", () => {
  it("PUT sets a new category", async () => {
    const { listRoutes, idRoutes } = await loadRoutes();
    const created = await (await listRoutes.POST(post({ name: "Key" }))).json();
    const res = await idRoutes.PUT(
      new Request(`http://localhost/api/keys/${created.keyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: "hermes" }),
      }),
      { params: { id: created.keyId } }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.key.category).toBe("hermes");
  });

  it("PUT empty-string category clears back to uncategorized", async () => {
    const { listRoutes, idRoutes } = await loadRoutes();
    const created = await (await listRoutes.POST(post({ name: "Key", category: "friend" }))).json();
    const res = await idRoutes.PUT(
      new Request(`http://localhost/api/keys/${created.keyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: "   " }),
      }),
      { params: { id: created.keyId } }
    );
    const body = await res.json();
    expect(body.key.category).toBeNull();
  });

  it("PUT without category leaves it untouched", async () => {
    const { listRoutes, idRoutes } = await loadRoutes();
    const created = await (await listRoutes.POST(post({ name: "Key", category: "friend" }))).json();
    const res = await idRoutes.PUT(
      new Request(`http://localhost/api/keys/${created.keyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Renamed" }),
      }),
      { params: { id: created.keyId } }
    );
    const body = await res.json();
    expect(body.key.category).toBe("friend");
    expect(body.key.name).toBe("Renamed");
  });

  it("PUT oversized category → 400, row unchanged", async () => {
    const { listRoutes, idRoutes, db } = await loadRoutes();
    const created = await (await listRoutes.POST(post({ name: "Key", category: "friend" }))).json();
    const res = await idRoutes.PUT(
      new Request(`http://localhost/api/keys/${created.keyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: "x".repeat(49) }),
      }),
      { params: { id: created.keyId } }
    );
    expect(res.status).toBe(400);
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [created.keyId]);
    expect(row.category).toBe("friend");
  });
});
