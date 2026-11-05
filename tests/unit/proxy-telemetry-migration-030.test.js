/**
 * W2a — the proxy telemetry DB seams: migration 030's shape.
 *
 * Sealed plan: plans/2026-11-04-proxy-console-separation.md §3.2 + §7.3
 * ("new tests for the analytics/health-history impls against fixture rows" —
 * the schema half lands here, the impl half in proxy-telemetry-seams-w2a).
 *
 * What this suite pins, all against a REAL temp DB through the real driver:
 *   • a fresh boot reaches schema 30 and carries every column/table/index the
 *     plan asked for (no mock can prove a DDL);
 *   • the twin-parity law: every column + index the migration creates is
 *     DECLARED in schema.js's TABLES — because that declaration is the ONLY
 *     thing mysql/bootstrap.js heals the MariaDB harbor from (and what
 *     fresh installs receive through 001). A column that existed only in the
 *     migration would be invisible to the twin; this suite fails if so.
 *   • re-application is idempotent (the ghost-repair path re-runs up()).
 *   • usageHistory.poolId is NULL-defaulted and NOT part of uq_uh_dedupe.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const saved = {};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-m030-"));
  for (const k of ["DATA_DIR", "VELA_DB_MODE", "VELA_MYSQL_URL", "API_KEY_SECRET"]) saved[k] = process.env[k];
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "m030-secret";
  delete process.env.VELA_MYSQL_URL;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const cols = (db, table) => db.all(`PRAGMA table_info(${table})`).map((c) => c.name);
const indexes = (db, table) => db.all(`PRAGMA index_list(${table})`).map((i) => i.name);

describe("migration 030 — the telemetry seams land on a fresh DB", () => {
  it("boots to schema 30 and carries poolId + both append tables", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    const db = await getAdapter();

    expect(latestVersion()).toBe(30);

    expect(cols(db, "usageHistory")).toContain("poolId");
    expect(cols(db, "proxyPoolHealthHistory")).toEqual(
      expect.arrayContaining(["id", "poolId", "providerId", "verdict", "latencyMs", "egressIp", "egressCountry", "createdAt"])
    );
    expect(cols(db, "proxyPoolEgressHistory")).toEqual(
      expect.arrayContaining(["id", "poolId", "ip", "country", "createdAt"])
    );

    expect(indexes(db, "usageHistory")).toEqual(expect.arrayContaining(["idx_uh_poolId", "idx_uh_pool_ts"]));
    expect(indexes(db, "proxyPoolHealthHistory")).toEqual(
      expect.arrayContaining(["idx_pphh_pool_ts", "idx_pphh_ts"])
    );
    expect(indexes(db, "proxyPoolEgressHistory")).toEqual(
      expect.arrayContaining(["idx_ppeh_pool_ts", "idx_ppeh_ts"])
    );
  });

  it("poolId is NULL-defaulted — 'unattributed' is a reading, never a ''-bucket", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run(
      `INSERT INTO usageHistory(timestamp, provider, model) VALUES(?, ?, ?)`,
      [new Date().toISOString(), "openai", "gpt-4o"]
    );
    const row = db.get(`SELECT poolId FROM usageHistory ORDER BY id DESC LIMIT 1`);
    expect(row.poolId).toBeNull();
  });

  it("poolId is NOT part of uq_uh_dedupe — the event identity is untouched", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const row = db.get(`SELECT sql FROM sqlite_master WHERE name = 'uq_uh_dedupe'`);
    expect(row.sql).not.toMatch(/poolId/);
  });
});

describe("migration 030 — the twin-parity law (TABLES is the only healer)", () => {
  it("declares every migration-created column and index in schema.js TABLES", async () => {
    const { TABLES } = await import("@/lib/db/schema.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    for (const table of ["proxyPoolHealthHistory", "proxyPoolEgressHistory"]) {
      expect(TABLES[table], `${table} must be declared in TABLES for the mysql twin`).toBeTruthy();
      const live = cols(db, table);
      const declared = Object.keys(TABLES[table].columns);
      for (const c of live) {
        expect(declared, `${table}.${c} exists live but is not declared for the twin`).toContain(c);
      }
      const liveIdx = indexes(db, table).filter((n) => !String(n).startsWith("sqlite_autoindex"));
      const declaredIdxSql = (TABLES[table].indexes || []).join(" ");
      for (const name of liveIdx) {
        expect(declaredIdxSql, `${table} index ${name} is not declared for the twin`).toContain(name);
      }
    }

    // usageHistory.poolId — same law for the column AND its two indexes.
    expect(Object.keys(TABLES.usageHistory.columns)).toContain("poolId");
    const uhIdxSql = (TABLES.usageHistory.indexes || []).join(" ");
    expect(uhIdxSql).toContain("idx_uh_poolId");
    expect(uhIdxSql).toContain("idx_uh_pool_ts");
  });
});

describe("migration 030 — re-application is idempotent", () => {
  it("runs up() twice on a migrated DB without throwing or duplicating", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const m030 = (await import("@/lib/db/migrations/030-proxy-console-telemetry.js")).default;
    const db = await getAdapter();
    const before = indexes(db, "proxyPoolHealthHistory");
    expect(() => m030.up(db)).not.toThrow();
    expect(indexes(db, "proxyPoolHealthHistory")).toEqual(before);
    expect(cols(db, "usageHistory").filter((c) => c === "poolId")).toHaveLength(1);
  });
});
