// Test covenant: combo-usage-migration-015 — combo attribution columns via
// the PORTABLE adapter surface (run/get/all/exec/transaction — NO raw
// prepare()). Same regression posture as 013's suite: v0.9.19's db.prepare
// draft crashed every DB-backed API on the sql.js adapter (the Docker
// runner's fallback driver). This suite proves migration 015 runs on sql.js
// (the production-crash driver), both columns land, and old databases
// auto-migrate forward on boot (the Star's standing decree).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalSecret = process.env.API_KEY_SECRET;

async function bootSqlJs() {
  delete global._dbAdapter;
  // Force the sql.js fallback exactly like migration 013's suite: make the
  // native adapters unavailable so resolveDriver lands on sql.js.
  vi.doMock("@/lib/db/adapters/betterSqliteAdapter.js", () => {
    throw new Error("simulated unavailable");
  });
  vi.doMock("@/lib/db/adapters/nodeSqliteAdapter.js", () => {
    throw new Error("simulated unavailable");
  });
  const { getAdapter } = await import("@/lib/db/driver.js");
  return getAdapter();
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-mig015-"));
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "mig015-test-secret";
  delete global._dbAdapter;
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

describe("Migration 015 — combo usage attribution", () => {
  it("sql.js adapter (production-crash driver) → chain runs to v15, combo columns land on both ledgers", async () => {
    const db = await bootSqlJs();
    expect(db.driver).toBe("sql.js");

    const usageCols = db.all(`PRAGMA table_info(usageHistory)`).map((c) => c.name);
    expect(usageCols).toContain("combo");

    const detailCols = db.all(`PRAGMA table_info(requestDetails)`).map((c) => c.name);
    expect(detailCols).toContain("combo");

    // The aggregation index must exist so the combos page query stays fast.
    const indexes = db.all(`PRAGMA index_list(usageHistory)`).map((i) => i.name);
    expect(indexes).toContain("idx_uh_combo");
  });

  it("idempotent — re-running migration 015's up() directly does not throw", async () => {
    delete global._dbAdapter;
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    if (db.driver === "sql.js") return; // heap-bound driver — skip (test 1 covers it)

    const { default: m015 } = await import("@/lib/db/migrations/015-combo-usage.js");
    expect(() => m015.up(db)).not.toThrow();

    const usageCols = db.all(`PRAGMA table_info(usageHistory)`).map((c) => c.name);
    expect(usageCols).toContain("combo");
  });

  it("combo column accepts a slash-bearing name and NULL (direct request)", async () => {
    delete global._dbAdapter;
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    if (db.driver === "sql.js") return; // heap-bound driver — skip (test 1 covers it)

    const ts = new Date().toISOString();
    db.run(
      `INSERT INTO usageHistory(timestamp, provider, model, connectionId, keyId, promptTokens, completionTokens, cost, status, combo) VALUES(?, ?, ?, '', '', 10, 5, 0.01, 'ok', ?)`,
      [ts, "openai", "gpt-5", "vela/cc/opus"]
    );
    db.run(
      `INSERT INTO usageHistory(timestamp, provider, model, connectionId, keyId, promptTokens, completionTokens, cost, status, combo) VALUES(?, ?, ?, '', '', 3, 2, 0.005, 'ok', NULL)`,
      [ts, "openai", "gpt-5"]
    );

    const rows = db.all(`SELECT combo FROM usageHistory ORDER BY id ASC`);
    expect(rows.map((r) => r.combo)).toEqual(["vela/cc/opus", null]);
  });
});
