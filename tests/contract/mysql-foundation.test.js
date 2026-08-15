// Storage Covenant Wave A6 — the mysql foundation's falsifiable pins.
// Plan: plans/storage-covenant.md A6 exit gate ("boot refusal test") +
// boot matrix (line 364): mysql posture unreachable → "fail-loud boot
// refusal — never silent downgrade"; ddlMap rules (line 271).
//
// What this file pins:
//   1. The boot gate refuses mysql/mirror postures LOUD (missing URL,
//      malformed URL, unreachable server, and — until Waves A7–A9 land the
//      repos — even a reachable one), and passes sqlite verbatim.
//   2. The gate is WIRED at the barrel entry (exportDb/importDb refuse).
//   3. ddlMap golden rules: TEXT PK→VARCHAR(191), AUTOINCREMENT→BIGINT
//      AUTO_INCREMENT, partial index→plain KEY, CHECK(id=1) preserved,
//      composite PK + reserved word `key` backticked.
//   4. parseMysqlUrl golden shape + loud malformed rejection.
//   5. Opt-in real-MariaDB bootstrap leg behind VELA_TEST_MYSQL_URL
//      (LOUD skip banner when unset — the A7+ parity convention).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach, vi } from "vitest";
import { TABLES } from "@/lib/db/schema.js";
import { toMysqlTableSql, toMysqlIndexSqls, indexNameOf } from "@/lib/db/mysql/ddlMap.js";
import { parseMysqlUrl } from "@/lib/db/mysql/pool.js";

let tempDirs = [];
const saved = {};
for (const k of ["DATA_DIR", "VELA_DB_MODE", "VELA_MYSQL_URL"]) saved[k] = process.env[k];

function freshDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "vela-a6-"));
  tempDirs.push(d);
  return d;
}

afterEach(() => {
  vi.doUnmock("@/lib/db/mysql/pool.js");
  vi.resetModules();
  for (const k of Object.keys(saved)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true });
  tempDirs = [];
});

describe("Storage Covenant A6 — fail-loud boot refusal", () => {
  it("mysql mode without VELA_MYSQL_URL refuses LOUD", async () => {
    process.env.DATA_DIR = freshDir();
    process.env.VELA_DB_MODE = "mysql";
    delete process.env.VELA_MYSQL_URL;
    const { assertHarborBound } = await import("@/lib/db/repos/bind.js");
    await expect(assertHarborBound()).rejects.toThrow(/requires VELA_MYSQL_URL/);
  });

  it("mysql mode with a malformed URL refuses LOUD", async () => {
    process.env.DATA_DIR = freshDir();
    process.env.VELA_DB_MODE = "mysql";
    process.env.VELA_MYSQL_URL = "postgres://nope";
    const { assertHarborBound } = await import("@/lib/db/repos/bind.js");
    await expect(assertHarborBound()).rejects.toThrow(/must start with mysql:\/\//);
  });

  it("mysql mode with an UNREACHABLE server refuses LOUD (matrix row: never silent downgrade)", async () => {
    process.env.DATA_DIR = freshDir();
    process.env.VELA_DB_MODE = "mysql";
    // Port 1 on loopback is closed — ECONNREFUSED, fast and loud.
    process.env.VELA_MYSQL_URL = "mysql://vela:vela@127.0.0.1:1/vela";
    const { assertHarborBound } = await import("@/lib/db/repos/bind.js");
    await expect(assertHarborBound()).rejects.toThrow(); // any error = loud refusal
  }, 15000);

  it("mysql mode with a REACHABLE server: barrel export/import still refuse (await Wave B)", async () => {
    // A7 bound the config-wave repos, so the seam-level refusal now names the
    // barrel export/import functions (their harbor lands with the backup engine).
    process.env.DATA_DIR = freshDir();
    process.env.VELA_DB_MODE = "mysql";
    process.env.VELA_MYSQL_URL = "mysql://vela:vela@localhost:3306/vela";
    vi.doMock("@/lib/db/mysql/pool.js", () => ({ probeMysqlUrl: async () => {} }));
    vi.resetModules();
    const { assertHarborBound } = await import("@/lib/db/repos/bind.js");
    await expect(assertHarborBound()).rejects.toThrow(/Wave B/);
  });

  it("mirror mode refuses LOUD (binds in Wave C)", async () => {
    process.env.DATA_DIR = freshDir();
    process.env.VELA_DB_MODE = "mirror";
    const { assertHarborBound } = await import("@/lib/db/repos/bind.js");
    await expect(assertHarborBound()).rejects.toThrow(/Wave C/);
  });

  it("sqlite mode passes the gate verbatim (today's harbor)", async () => {
    process.env.DATA_DIR = freshDir();
    process.env.VELA_DB_MODE = "sqlite";
    const { assertHarborBound } = await import("@/lib/db/repos/bind.js");
    await expect(assertHarborBound()).resolves.toBeUndefined();
  });

  it("the gate is WIRED at the barrel — exportDb/importDb refuse a mysql posture", async () => {
    process.env.DATA_DIR = freshDir();
    process.env.VELA_DB_MODE = "mysql";
    delete process.env.VELA_MYSQL_URL;
    const api = await import("@/lib/db/index.js");
    await expect(api.exportDb()).rejects.toThrow(/requires VELA_MYSQL_URL/);
    await expect(api.importDb({ settings: {} })).rejects.toThrow(/requires VELA_MYSQL_URL/);
  });
});

describe("Storage Covenant A6 — ddlMap golden rules", () => {
  it("TEXT PRIMARY KEY → VARCHAR(191), AUTOINCREMENT → BIGINT AUTO_INCREMENT", () => {
    const ddl = toMysqlTableSql("usageHistory", TABLES.usageHistory);
    expect(ddl).toContain("`id` BIGINT NOT NULL AUTO_INCREMENT");
    // timestamp/provider/model are all index members → VARCHAR(191); the
    // payload columns (tokens/meta) are NOT indexed → stay TEXT.
    expect(ddl).toContain("`timestamp` VARCHAR(191) NOT NULL");
    expect(ddl).toContain("`provider` VARCHAR(191)");
    expect(ddl).toContain("`tokens` TEXT");
    expect(ddl).toContain("`meta` TEXT");
    const settings = toMysqlTableSql("settings", TABLES.settings);
    expect(settings).toContain("`id` INT NOT NULL CHECK (id = 1)"); // CHECK preserved
    expect(settings).toContain("PRIMARY KEY (`id`)");
  });

  it("composite PRIMARY KEY + reserved word `key` are backticked", () => {
    const kv = toMysqlTableSql("kv", TABLES.kv);
    expect(kv).toContain("PRIMARY KEY (`scope`, `key`)");
    expect(kv).toContain("`key` VARCHAR(191) NOT NULL");
  });

  it("partial indexes become plain KEYs, IF NOT EXISTS is stripped, names survive", () => {
    const idxs = toMysqlIndexSqls("apiKeys", TABLES.apiKeys);
    const partial = idxs.find((i) => i.includes("idx_ak_category"));
    expect(partial).toBeDefined();
    expect(partial).not.toMatch(/WHERE/i); // partial clause dropped
    for (const i of idxs) {
      expect(i).not.toMatch(/IF NOT EXISTS/i);
      expect(indexNameOf(i)).toBeTruthy();
    }
    // UNIQUE survives the translation (uq_uh_dedupe, uq_ak_key_hash)
    expect(idxs.some((i) => /CREATE UNIQUE INDEX/.test(i))).toBe(true);
  });

  it("DESC index columns map to the bare column (learned against real MariaDB)", () => {
    // idx_uh_ts ON usageHistory(timestamp DESC) — the sort suffix is NOT part
    // of the identifier; MySQL rejects "Key column 'timestamp DESC'".
    const idxs = toMysqlIndexSqls("usageHistory", TABLES.usageHistory);
    const ts = idxs.find((i) => i.includes("idx_uh_ts"));
    expect(ts).toContain("(`timestamp`)");
    expect(ts).not.toMatch(/DESC/i);
  });

  it("parseMysqlUrl extracts the full connection shape and refuses malformed URLs", () => {
    const cfg = parseMysqlUrl("mysql://us%40er:p%40ss@db.local:3307/vela");
    expect(cfg).toEqual({ host: "db.local", port: 3307, user: "us@er", password: "p@ss", database: "vela" });
    expect(() => parseMysqlUrl("postgres://x/y")).toThrow(/must start with mysql:\/\//);
    expect(() => parseMysqlUrl("mysql://user:pass@host:3306")).toThrow(/must name a database/);
    expect(() => parseMysqlUrl("not a url")).toThrow(/not a valid URL/);
  });
});

// ─── Opt-in real-MariaDB leg (LOUD skip banner when unset) ──────────────
// The A7+ parity convention: VELA_TEST_MYSQL_URL points at a disposable
// MariaDB; without it this leg skips LOUDLY so nobody mistakes silence for
// coverage.
if (!process.env.VELA_TEST_MYSQL_URL) {
  console.warn("[A6 SKIP LOUD] VELA_TEST_MYSQL_URL unset — real-MariaDB bootstrap leg skipped (no silent coverage)");
}
describe.skipIf(!process.env.VELA_TEST_MYSQL_URL)("Storage Covenant A6 — real MariaDB bootstrap (opt-in)", () => {
  it("bootstrapMysql brings a foreign schema to TABLES parity and seals the security closures", async () => {
    const { createMysqlAdapter } = await import("@/lib/db/mysql/pool.js");
    const { bootstrapMysql } = await import("@/lib/db/mysql/bootstrap.js");
    const adapter = await createMysqlAdapter(process.env.VELA_TEST_MYSQL_URL);
    try {
      const report = await bootstrapMysql(adapter);
      expect(report.tables).toBe(Object.keys(TABLES).length);
      // Re-run: idempotent — nothing left to add
      const second = await bootstrapMysql(adapter);
      expect(second.columns).toBe(0);
      expect(second.indexes).toBe(0);
      // Security closures tracked in _meta (migration 002's twin)
      const meta = await adapter.get("SELECT value FROM _meta WHERE `key` = 'mysqlSecurityClosures'");
      expect(meta).toBeTruthy();
      expect(JSON.parse(meta.value)).toHaveProperty("tombstoneLegacyKeys");
      // The dedupe identity exists on the twin
      const idx = await adapter.all("SHOW INDEX FROM usageHistory WHERE Key_name = 'uq_uh_dedupe'");
      expect(idx.length).toBe(7);
    } finally {
      await adapter.close();
    }
  }, 30000);
});
