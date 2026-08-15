// Storage Covenant Wave A8 — the security-wave PARITY GATE.
// Plan: plans/storage-covenant.md line 273: "apiKeys (hash-at-rest, rotation,
// soft-delete), disabledModels, pricing, requestDetails; ER_DUP_ENTRY =
// 'existing row' in dedupe paths | parity green".
//
// Method (the A7 convention): the SAME deterministic scenario runs blind in
// both harbors — every security-wave symbol exercised — then the two worlds
// are normalized (A4 volatile-field contract) and compared canonically. The
// requestDetails leg additionally pins the upsert-as-dedupe law: re-saving an
// id UPDATES the existing row on both engines (ON CONFLICT DO UPDATE ≡
// ON DUPLICATE KEY UPDATE) — one id, one row, never a duplicate.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterAll, vi } from "vitest";
import { VOLATILE_BY_TABLE } from "./harness/runner.js";

const MYSQL_URL = process.env.VELA_TEST_MYSQL_URL;
if (!MYSQL_URL) {
  console.warn("[A8 SKIP LOUD] VELA_TEST_MYSQL_URL unset — security-wave parity vs real MariaDB skipped (no silent coverage)");
}

let tempDirs = [];
const saved = {};
for (const k of ["DATA_DIR", "VELA_DB_MODE", "VELA_MYSQL_URL", "ENABLE_REQUEST_LOGS", "OBSERVABILITY_BATCH_SIZE"]) {
  saved[k] = process.env[k];
}

function freshDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "vela-a8-"));
  tempDirs.push(d);
  return d;
}

afterAll(async () => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  try { await global._mysqlAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  delete global._mysqlAdapter;
  vi.resetModules();
  for (const k of Object.keys(saved)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true });
  tempDirs = [];
});

/** Canonical JSON — recursively sort object keys so key-order never fakes a divergence. */
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  }
  return v;
}

/** Strip volatile/generated fields per the A4 normalization contract. */
function stripRows(rows, table) {
  const fields = VOLATILE_BY_TABLE[table] || [];
  return rows.map((r) => {
    const c = { ...r };
    for (const f of fields) delete c[f];
    return c;
  });
}
const stripRow = (r, table) => (r ? stripRows([r], table)[0] : null);

/** Poll until the buffered requestDetails flush lands (batchSize=1 fires the
 *  flush async; the read loop waits for the write to settle). */
async function untilFlushed(api, expectTotal, tries = 80) {
  for (let i = 0; i < tries; i++) {
    const res = await api.getRequestDetails({});
    if (res.pagination.totalItems >= expectTotal) return res;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`[A8] requestDetails flush never landed (expected ${expectTotal} rows)`);
}

/** One deterministic scenario — exercises the whole A8 security surface. */
async function securityScenario(api) {
  // ── apiKeysRepo: hash-at-rest, mint-once, whitelist update, soft-delete ──
  const keyA = await api.createApiKey("Parity Key A", {
    category: "  parity   fleet ", // sanitizeCategory collapses whitespace
    allowedModels: ["openai/gpt-4o"],
    rateLimitRpm: 60,
    ipAllowlist: ["10.0.0.1/32"],
  });
  const keyB = await api.createApiKey("Parity Key B", {});
  const updatedA = await api.updateApiKey(keyA.keyId, { name: "Parity Key A2", category: "parity-fleet" });
  const resolvedA = await api.resolveKey(keyA.key); // minted key resolves
  const validA = await api.validateApiKey(keyA.key);
  const deletedB = await api.deleteApiKey(keyB.keyId); // soft-revoke
  const validBAfter = await api.validateApiKey(keyB.key); // dead key → false
  const resolvedBAfter = await api.resolveKey(keyB.key); // dead key → null
  const internal1 = await api.ensureInternalKey("parity"); // find-or-create
  const internal2 = await api.ensureInternalKey("parity"); // idempotent
  const keys = await api.getApiKeys();
  const keyAById = await api.getApiKeyById(keyA.keyId);

  // ── disabledModelsRepo: atomic merge + partial/full enable ──
  await api.disableModels("openai", ["m-1", "m-2"]);
  await api.disableModels("openai", ["m-2", "m-3"]); // merge, Set-dedupe
  await api.disableModels("anthropic", ["m-x"]);
  const disabledOpenai = await api.getDisabledByProvider("openai");
  await api.enableModels("openai", ["m-2"]); // partial removal
  await api.enableModels("anthropic", []); // full removal deletes the kv row
  const disabledFinal = await api.getDisabledModels();

  // ── pricingRepo: user-sovereign overlay + sync namespace (C4) ──
  await api.updatePricing({ openai: { "gpt-4o-parity": { input: 1.5, output: 6 } } });
  const priceUser = await api.getPricingForModel("openai", "gpt-4o-parity"); // stratum 1
  await api.replaceSyncedPricing(
    { openai: { "gpt-sync-parity": { input: 0.4 } } },
    { syncedAt: "2026-08-15T00:00:00.000Z", sources: ["parity"], entryCount: 1 }
  );
  const priceSync = await api.getPricingForModel("openai", "gpt-sync-parity"); // stratum 2
  const synced = await api.getSyncedPricing();
  const pricingMerged = await api.getPricing(); // static + sync + user overlay
  const userAfterReset = await api.resetPricing("openai", "gpt-4o-parity");
  const syncAfterClear = await api.clearSyncedPricing();
  const allAfterReset = await api.resetAllPricing();

  // ── requestDetailsRepo: buffered writes, upsert-as-dedupe, retention ──
  // Explicit id + timestamp on every detail → fully deterministic rows.
  await api.saveRequestDetail({
    id: "a8-parity-1", timestamp: "2026-08-15T00:00:00.000Z",
    provider: "openai", model: "gpt-4o", status: "ok",
    request: { headers: { authorization: "Bearer never-persisted", "content-type": "application/json" } },
    tokens: { in: 10 },
  });
  await api.saveRequestDetail({
    id: "a8-parity-2", timestamp: "2026-08-15T00:00:01.000Z",
    provider: "anthropic", model: "claude-parity", status: "error",
  });
  // Upsert-as-dedupe: same id again → UPDATE the existing row (both engines),
  // never a second row. The plan's ER_DUP_ENTRY = "existing row" law. The
  // replacement carries its OWN headers — proving the overwrite AND the
  // sanitization in one save.
  await api.saveRequestDetail({
    id: "a8-parity-1", timestamp: "2026-08-15T00:00:02.000Z",
    provider: "openai", model: "gpt-4o", status: "retried",
    request: { headers: { authorization: "Bearer never-persisted", "x-api-key": "k", "content-type": "application/json" } },
  });
  await untilFlushed(api, 2);
  const rdFiltered = await api.getRequestDetails({ provider: "openai" });
  const rdById = await api.getRequestDetailById("a8-parity-1");
  const rdProviders = await api.getDistinctProviders();
  const rdAll = await api.getRequestDetails({});

  return {
    // apiKeys
    keys: stripRows(keys, "apiKeys").sort((a, b) => String(a.name).localeCompare(String(b.name))),
    keyAById: stripRow(keyAById, "apiKeys"),
    updatedA: stripRow(updatedA, "apiKeys"),
    resolvedA: stripRow(resolvedA, "apiKeys"),
    validA,
    deletedB,
    validBAfter,
    resolvedBAfter,
    // deterministic: derived from API_KEY_SECRET + purpose, identical in both legs
    internal1,
    internalSameAgain: internal1.id === internal2.id && internal1.key === internal2.key,
    category: api.sanitizeCategory("  parity   fleet "),
    // disabledModels
    disabledOpenai,
    disabledFinal,
    // pricing
    priceUser,
    priceSync,
    synced,
    pricingMerged,
    userAfterReset,
    syncAfterClear,
    allAfterReset,
    // requestDetails
    rdFiltered,
    rdById,
    rdProviders,
    rdAll,
  };
}

async function buildSqliteWorld() {
  process.env.DATA_DIR = freshDir();
  process.env.VELA_DB_MODE = "sqlite";
  delete process.env.VELA_MYSQL_URL;
  process.env.ENABLE_REQUEST_LOGS = "true";
  process.env.OBSERVABILITY_BATCH_SIZE = "1"; // every save flushes immediately
  delete global._dbAdapter;
  vi.resetModules();
  const api = {
    ...(await import("@/lib/db/repos/sqlite/apiKeysRepo.js")),
    ...(await import("@/lib/db/repos/sqlite/disabledModelsRepo.js")),
    ...(await import("@/lib/db/repos/sqlite/pricingRepo.js")),
    ...(await import("@/lib/db/repos/sqlite/requestDetailsRepo.js")),
  };
  return securityScenario(api);
}

async function buildMysqlWorld() {
  process.env.VELA_MYSQL_URL = MYSQL_URL;
  process.env.ENABLE_REQUEST_LOGS = "true";
  process.env.OBSERVABILITY_BATCH_SIZE = "1";
  delete global._mysqlAdapter;
  vi.resetModules();
  const { getMysqlAdapter } = await import("@/lib/db/mysql/adapter.js");
  const db = await getMysqlAdapter(); // boots pool + bootstrap (additive, idempotent)
  // Clean the security tables so the scenario seeds a deterministic world.
  // (The twin is disposable by covenant — plans/storage-covenant.md A7/A8.)
  await db.exec("DELETE FROM apiKeys");
  await db.exec("DELETE FROM requestDetails");
  await db.exec("DELETE FROM kv WHERE scope IN ('disabledModels','pricing','pricing_sync')");
  const api = {
    ...(await import("@/lib/db/repos/mysql/apiKeysRepo.js")),
    ...(await import("@/lib/db/repos/mysql/disabledModelsRepo.js")),
    ...(await import("@/lib/db/repos/mysql/pricingRepo.js")),
    ...(await import("@/lib/db/repos/mysql/requestDetailsRepo.js")),
  };
  return securityScenario(api);
}

describe.skipIf(!MYSQL_URL)("Storage Covenant A8 — security-wave parity vs real MariaDB", () => {
  it("sqlite harbor ≡ mysql twin — the full security surface converges", async () => {
    const sqliteWorld = await buildSqliteWorld();
    const mysqlWorld = await buildMysqlWorld();

    const keys = Object.keys(sqliteWorld);
    expect(keys.length).toBeGreaterThanOrEqual(20); // the world is non-trivial
    for (const k of keys) {
      expect(
        JSON.stringify(canon(mysqlWorld[k])),
        `divergent world key: ${k}`
      ).toBe(JSON.stringify(canon(sqliteWorld[k])));
    }

    // Spot-checks that prove the comparison guards real content
    // keyA visible; keyB soft-deleted (revoked rows hide) + internal key hidden
    expect(sqliteWorld.keys.length).toBe(1);
    expect(sqliteWorld.keys[0].name).toBe("Parity Key A2");
    expect(sqliteWorld.validA).toBe(true);
    expect(sqliteWorld.deletedB).toBe(true);
    expect(sqliteWorld.validBAfter).toBe(false);         // soft-deleted key is dead
    expect(sqliteWorld.resolvedBAfter).toBe(null);
    expect(sqliteWorld.internalSameAgain).toBe(true);    // ensureInternalKey idempotent
    expect(sqliteWorld.category).toBe("parity fleet");
    expect(sqliteWorld.disabledOpenai).toEqual(["m-1", "m-2", "m-3"]);
    expect(sqliteWorld.disabledFinal).toEqual({ openai: ["m-1", "m-3"] }); // anthropic key deleted
    expect(sqliteWorld.priceUser).toEqual({ input: 1.5, output: 6 });
    expect(sqliteWorld.priceSync).toEqual({ input: 0.4 });
    expect(sqliteWorld.synced.meta).toEqual({ syncedAt: "2026-08-15T00:00:00.000Z", sources: ["parity"], entryCount: 1 });
    expect(sqliteWorld.pricingMerged.openai["gpt-4o-parity"]).toEqual({ input: 1.5, output: 6 });
    expect(sqliteWorld.userAfterReset).toEqual({});
    expect(sqliteWorld.syncAfterClear).toEqual({});
    expect(sqliteWorld.allAfterReset).toEqual({});
    // Upsert-as-dedupe: 3 saves, 2 distinct ids → exactly 2 rows on BOTH engines
    expect(sqliteWorld.rdAll.pagination.totalItems).toBe(2);
    expect(sqliteWorld.rdById.status).toBe("retried");   // the upsert overwrote "ok"
    expect(sqliteWorld.rdById.request.headers.authorization).toBeUndefined(); // sanitized
    expect(sqliteWorld.rdById.request.headers["x-api-key"]).toBeUndefined(); // sanitized
    expect(sqliteWorld.rdById.request.headers["content-type"]).toBe("application/json");
    expect(sqliteWorld.rdProviders).toEqual(["anthropic", "openai"]);
    expect(sqliteWorld.rdFiltered.pagination.totalItems).toBe(1);
  }, 60000);

  it("the FACADE seam dispatches security symbols to the mysql twin under VELA_DB_MODE=mysql", async () => {
    // The parity leg above drives the twins directly. THIS leg proves the
    // bindFacade seam: with VELA_DB_MODE=mysql, importing the FACADES routes
    // every security-wave call into repos/mysql/* — reads hit the twin's
    // seeded world, writes land in the twin.
    process.env.DATA_DIR = freshDir();
    process.env.VELA_DB_MODE = "mysql";
    process.env.VELA_MYSQL_URL = MYSQL_URL;
    process.env.ENABLE_REQUEST_LOGS = "true";
    process.env.OBSERVABILITY_BATCH_SIZE = "1";
    delete global._mysqlAdapter;
    vi.resetModules();

    const apiKeys = await import("@/lib/db/repos/apiKeysRepo.js");
    const disabled = await import("@/lib/db/repos/disabledModelsRepo.js");
    const pricing = await import("@/lib/db/repos/pricingRepo.js");
    const rd = await import("@/lib/db/repos/requestDetailsRepo.js");

    // Reads must hit the mysql twin (the parity world left data there)
    const keys = await apiKeys.getApiKeys();
    expect(keys.some((k) => k.name === "Parity Key A2")).toBe(true);
    const dis = await disabled.getDisabledModels();
    expect(dis.openai).toEqual(["m-1", "m-3"]);
    const providers = await rd.getDistinctProviders();
    expect(providers).toEqual(["anthropic", "openai"]);
    const merged = await pricing.getPricing();
    expect(merged).toHaveProperty("_canonical");

    // A write through the facade must land in the mysql twin, verifiable
    await disabled.disableModels("a8-facade-probe", ["p1"]);
    expect(await disabled.getDisabledByProvider("a8-facade-probe")).toEqual(["p1"]);
    await disabled.enableModels("a8-facade-probe", []); // clean up the probe
    expect(await disabled.getDisabledByProvider("a8-facade-probe")).toEqual([]);
  }, 60000);
});
