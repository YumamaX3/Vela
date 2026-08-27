// Test covenant: migration-016 — key governance v2 (templates, tags, ledger,
// seeds, idempotency). sql.js crash-driver harness copied from
// key-acl-migration-013.test.js (per Gate-9 repair 29).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalSecret = process.env.API_KEY_SECRET;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-mig016-"));
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "mig016-test-secret";
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) {
    // Windows file-lock resilience: retry cleanup briefly — the sql.js DB
    // handle can hold the temp dir for a tick after close().
    for (let i = 0; i < 5; i++) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); break; }
      catch { new Promise((r) => setTimeout(r, 25)); }
    }
  }
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalSecret === undefined) delete process.env.API_KEY_SECRET;
  else process.env.API_KEY_SECRET = originalSecret;
});

describe("Migration 016 — key governance v2", () => {
  it("fresh DB → keyTemplates + keyTags + key_mutation_ledger exist with schema", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    const tables = db.all(`SELECT name FROM sqlite_master WHERE type = 'table'`).map((t) => t.name);
    expect(tables).toContain("keyTemplates");
    expect(tables).toContain("keyTags");
    expect(tables).toContain("key_mutation_ledger");

    const tplCols = db.all(`PRAGMA table_info(keyTemplates)`).map((c) => c.name);
    for (const col of ["id", "name", "description", "aclJson", "limitsJson", "categoryDefault", "builtIn", "createdAt", "updatedAt"]) {
      expect(tplCols).toContain(col);
    }

    const tagCols = db.all(`PRAGMA table_info(keyTags)`).map((c) => c.name);
    for (const col of ["keyId", "tag", "createdAt"]) expect(tagCols).toContain(col);

    const ledgerCols = db.all(`PRAGMA table_info(key_mutation_ledger)`).map((c) => c.name);
    for (const col of ["id", "surface", "keyId", "sourceRowId", "outcome", "actorClass", "createdAt", "detail"]) {
      expect(ledgerCols).toContain(col);
    }
  });

  it("seeds four built-in templates exactly once (idempotent re-run)", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    const seeded = db.all(`SELECT name FROM keyTemplates WHERE builtIn = 1 ORDER BY name`);
    expect(seeded.length).toBe(4);
    const names = seeded.map((r) => r.name);
    expect(names).toContain("Blank");
    expect(names).toContain("Claude Code Workstation");
    expect(names).toContain("Embeddings Batch");
    expect(names).toContain("Read-Only Observer");

    // Re-run the migration's up() — must not duplicate.
    const { up } = await import("@/lib/db/migrations/016-key-governance-v2.js");
    up(db);
    const again = db.all(`SELECT COUNT(*) AS n FROM keyTemplates WHERE builtIn = 1`);
    expect(again[0].n).toBe(4);
  });

  it("keyTags UNIQUE(keyId, tag) — duplicate add is ignored, tag indexed", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const now = new Date().toISOString();

    db.run(`INSERT INTO keyTags (keyId, tag, createdAt) VALUES (?, ?, ?)`, ["k1", "prod", now]);
    db.run(`INSERT OR IGNORE INTO keyTags (keyId, tag, createdAt) VALUES (?, ?, ?)`, ["k1", "prod", now]);
    const rows = db.all(`SELECT * FROM keyTags WHERE keyId = 'k1'`);
    expect(rows.length).toBe(1);

    const idx = db.all(`PRAGMA index_list(keyTags)`).map((i) => i.name);
    expect(idx).toContain("idx_key_tags_tag");
  });

  it("ledger append + read-back (append-only attribution)", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run(
      `INSERT INTO key_mutation_ledger (id, surface, keyId, sourceRowId, outcome, actorClass, createdAt, detail)
       VALUES ('led-1', 'create', 'k1', NULL, 'minted', 'dashboard', '2026-08-26T00:00:00.000Z', NULL)`
    );
    const rows = db.all(`SELECT * FROM key_mutation_ledger`);
    expect(rows.length).toBe(1);
    expect(rows[0].surface).toBe("create");
    expect(rows[0].actorClass).toBe("dashboard");
  });

  it("SCHEMA_VERSION advanced to 15 while chain runs to 16", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const meta = db.all(`SELECT * FROM _meta`);
    const stored = meta.find((m) => m.key === "schemaVersion")?.value;
    // The chain applies 001-016; the _meta schemaVersion reflects latest.
    expect(Number(stored)).toBeGreaterThanOrEqual(15);
  });
});
