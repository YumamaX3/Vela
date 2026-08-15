// Storage Covenant Wave A4 — the sqlite-vs-sqlite parity harness shakeout.
// Plan: plans/storage-covenant.md A4 exit gate ("harness green").
//
// The shakeout proves the harness machinery itself before Wave A6 points it at
// a real mysql twin: two independently seeded worlds — one forced onto sql.js
// (the fragile corner: pure-JS, SAVEPOINT transaction path), one onto
// better-sqlite3 — must export byte-equal normalized payloads. Any divergence
// here is a harness or adapter bug, not a data bug.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach, vi } from "vitest";
import { seedWorld, compareWorlds } from "./harness/runner.js";

let tempDirs = [];
const originalDataDir = process.env.DATA_DIR;
const originalDriver = process.env.VELA_DB_DRIVER;

function freshDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "vela-parity-"));
  tempDirs.push(d);
  return d;
}

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true });
  tempDirs = [];
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalDriver === undefined) delete process.env.VELA_DB_DRIVER;
  else process.env.VELA_DB_DRIVER = originalDriver;
});

/** Build one complete isolated world and return its exportDb() payload.
 *  The adapter singleton forces serial worlds: each world seeds AND exports
 *  (then closes) before the next begins — compareWorlds' contract. */
async function buildWorld({ driver = null } = {}) {
  process.env.DATA_DIR = freshDir();
  if (driver) process.env.VELA_DB_DRIVER = driver;
  else delete process.env.VELA_DB_DRIVER;
  delete global._dbAdapter;
  vi.resetModules();
  const api = await import("@/lib/db/index.js");
  await seedWorld(api);
  const payload = await api.exportDb();
  // Shape pins ride the payload of every world — returned for assertion.
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  return payload;
}

describe("Storage Covenant A4 — parity harness shakeout (sqlite vs sqlite)", () => {
  it("two identical sqlite worlds export equal normalized payloads", async () => {
    const { equal, normA, normB, payloadA } = await compareWorlds(
      () => buildWorld(),
      () => buildWorld()
    );
    if (!equal) {
      // Fail loudly with the first divergent top-level key
      for (const k of new Set([...Object.keys(normA), ...Object.keys(normB)])) {
        expect(JSON.stringify(normA[k]), `divergent key: ${k}`).toBe(JSON.stringify(normB[k]));
      }
    }
    expect(equal).toBe(true);
    // The world is non-trivial — the comparison guards real content
    expect(payloadA.providerConnections.length).toBe(1);
    expect(payloadA.providerNodes.length).toBe(1);
    expect(payloadA.proxyPools.length).toBe(1);
    expect(payloadA.apiKeys.length).toBe(1);
    expect(payloadA.combos.length).toBe(1);
    expect(payloadA.usageHistory.length).toBe(1);
    expect(payloadA.usageDaily.length).toBe(1);
    expect(Object.keys(payloadA.kvScopes)).toEqual(
      expect.arrayContaining(["modelAliases", "customModels", "disabledModels", "pricing"])
    );
  });

  it("sql.js world (forced) matches better-sqlite3 world — the fragile corner", async () => {
    const { equal, normA, normB } = await compareWorlds(
      () => buildWorld({ driver: "sql.js" }),
      () => buildWorld({ driver: "better-sqlite3" })
    );
    if (!equal) {
      for (const k of new Set([...Object.keys(normA), ...Object.keys(normB)])) {
        expect(JSON.stringify(normA[k]), `divergent key: ${k}`).toBe(JSON.stringify(normB[k]));
      }
    }
    expect(equal).toBe(true);
  });

  it("golden normalization pins — AUTOINCREMENT shape + boolean coercion", async () => {
    const payload = await buildWorld();
    // AUTOINCREMENT ids are numbers, deterministic from 1 (shape assertion)
    expect(typeof payload.usageHistory[0].id).toBe("number");
    expect(payload.usageHistory[0].id).toBe(1);
    // INTEGER columns surface as JS booleans through exportDb (boolean coercion)
    expect(payload.providerConnections[0].isActive).toBe(true);
    expect(payload.proxyPools[0].isActive).toBe(true);
    expect(payload.apiKeys[0].isInternal).toBe(false);
    // Provenance header rides every export
    expect(payload._meta.schemaVersion).toBe(4);
    expect(payload._meta.sourceMode).toBe("sqlite");
  });

  it("unknown VELA_DB_DRIVER fails LOUD (the matrix must force, never fall through)", async () => {
    process.env.DATA_DIR = freshDir();
    process.env.VELA_DB_DRIVER = "oracle";
    delete global._dbAdapter;
    vi.resetModules();
    const { getAdapter } = await import("@/lib/db/driver.js");
    await expect(getAdapter()).rejects.toThrow(/unknown VELA_DB_DRIVER/);
  });
});
