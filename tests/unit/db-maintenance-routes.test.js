// DATABASE MAINTENANCE surface — stats, integrity probe, prune, vacuum.
//
// These routes exist because the live failure ("database disk image is
// malformed" on every usage write) had no cockpit: no stats, no retention
// control, and no way to repair from inside the running gateway. A route that
// is never exercised is a route that breaks silently, so each action is driven
// here against a real adapter on a sandboxed DATA_DIR.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "Vela-db-maint-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

/** Minimal Next-like request: JSON body + headers + nextUrl searchParams. */
function makeRequest({ body, headers = {}, search = "" } = {}) {
  return {
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    json: async () => body ?? {},
    nextUrl: { searchParams: new URLSearchParams(search) },
  };
}

const CLI = { "x-vela-cli-token": "test-cli-token" };

describe("GET /api/settings/database/maintenance (stats)", () => {
  it("reports driver, file sizes, page accounting and per-table counts", async () => {
    const { GET } = await import("@/app/api/settings/database/maintenance/route.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run("INSERT INTO usageHistory(timestamp, provider, model, connectionId, cost, status, tokens) VALUES(?,?,?,?,?,?,?)",
      [new Date().toISOString(), "openai", "gpt-4o", "c1", 0, "success", "{}"]);

    const res = await GET(makeRequest({ headers: CLI }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.driver).toBeTruthy();
    expect(json.file.bytes).toBeGreaterThan(0);
    expect(json.pages.size).toBeGreaterThan(0);
    expect(Array.isArray(json.tables)).toBe(true);
    const usage = json.tables.find((t) => t.name === "usageHistory");
    expect(usage.rows).toBeGreaterThanOrEqual(1);
    // integrity verdict is carried, and a fresh boot left it healthy
    expect(json.integrity).toHaveProperty("healthy");
  });

  it("refuses without a password or CLI token", async () => {
    const { GET } = await import("@/app/api/settings/database/maintenance/route.js");
    const res = await GET(makeRequest({ headers: {} }));
    expect(res.status).toBe(401);
  });
});

describe("POST integrity", () => {
  it("returns ok:true for a healthy image and records the check", async () => {
    const { POST } = await import("@/app/api/settings/database/maintenance/route.js");
    const res = await POST(makeRequest({ headers: CLI, body: { action: "integrity" } }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.pragma).toMatch(/check/);
  });

  it("supports a full integrity_check on request", async () => {
    const { POST } = await import("@/app/api/settings/database/maintenance/route.js");
    const res = await POST(makeRequest({ headers: CLI, body: { action: "integrity", full: true } }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.pragma).toBe("integrity_check");
    expect(json.ok).toBe(true);
  });
});

describe("POST prune-usage", () => {
  async function seed(n, ageDays) {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const ts = new Date(Date.now() - ageDays * 86400000).toISOString();
    for (let i = 0; i < n; i++) {
      db.run("INSERT INTO usageHistory(timestamp, provider, model, connectionId, cost, status, tokens) VALUES(?,?,?,?,?,?,?)",
        [ts, "openai", "gpt-4o", `c${i}`, 0, "success", "{}"]);
    }
    return db.get("SELECT COUNT(*) c FROM usageHistory").c;
  }

  it("dryRun reports matches and deletes nothing", async () => {
    const { POST } = await import("@/app/api/settings/database/maintenance/route.js");
    await seed(5, 40);
    const before = (await seed(0, 0));
    const res = await POST(makeRequest({ headers: CLI, body: { action: "prune-usage", days: 30, dryRun: true } }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.dryRun).toBe(true);
    expect(json.matched).toBeGreaterThanOrEqual(5);
    expect(json.after).toBe(before); // nothing actually removed
  });

  it("deletes only rows older than the window", async () => {
    const { POST } = await import("@/app/api/settings/database/maintenance/route.js");
    await seed(5, 40);   // old — should go
    await seed(3, 1);    // recent — must survive
    const res = await POST(makeRequest({ headers: CLI, body: { action: "prune-usage", days: 30 } }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.matched).toBe(5);
    expect(json.after).toBe(3);
  });

  it("rejects a negative day count", async () => {
    const { POST } = await import("@/app/api/settings/database/maintenance/route.js");
    const res = await POST(makeRequest({ headers: CLI, body: { action: "prune-usage", days: -5 } }));
    expect(res.status).toBe(400);
  });
});

describe("POST vacuum", () => {
  it("runs and reports byte accounting", async () => {
    const { POST } = await import("@/app/api/settings/database/maintenance/route.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    // usageHistory carries a unique index over (timestamp, provider, model,
    // connectionId, ...) — the dedupe law. Distinct connectionIds keep the seed
    // legal; a duplicate here is a real constraint, not a test artefact.
    for (let i = 0; i < 50; i++) {
      db.run("INSERT INTO usageHistory(timestamp, provider, model, connectionId, cost, status, tokens) VALUES(?,?,?,?,?,?,?)",
        [new Date().toISOString(), "openai", "gpt-4o", `vac-${i}`, 0, "success", "{}"]);
    }
    db.run("DELETE FROM usageHistory");

    const res = await POST(makeRequest({ headers: CLI, body: { action: "vacuum" } }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(typeof json.reclaimedBytes).toBe("number");
  });
});

describe("POST unknown action", () => {
  it("answers 400 and names the valid actions", async () => {
    const { POST } = await import("@/app/api/settings/database/maintenance/route.js");
    const res = await POST(makeRequest({ headers: CLI, body: { action: "nonsense" } }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/integrity|prune-usage|vacuum|repair/);
  });
});
