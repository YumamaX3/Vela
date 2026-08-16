// Storage Covenant Wave A9 — the usage-wave PARITY GATE.
// Plan: plans/storage-covenant.md line 274: "dedupe via UNIQUE + ON DUPLICATE
// KEY UPDATE; day-aggregate upsert; GROUP BY parity; concurrent-write
// scenario (both engines converge to one row)".
//
// Method (the A7/A8 convention): one deterministic scenario runs blind in
// both harbors — pinned timestamps, fixed connection ids, minted keys for
// attribution — then the worlds are normalized and compared canonically.
// The dedupe identity (uq_uh_dedupe) is exercised three ways: unique rows
// stay unique, an 8-way concurrent burst of IDENTICAL entries converges to
// exactly ONE row on BOTH engines (sqlite ON CONFLICT DO NOTHING ≡ mysql
// ER_DUP_ENTRY), and the duplicate path backfills the endpoint. Costs ride
// the harness's 6dp normalization law (SQLite REAL vs MySQL DECIMAL(12,6)).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterAll, vi } from "vitest";

const MYSQL_URL = process.env.VELA_TEST_MYSQL_URL;
if (!MYSQL_URL) {
  console.warn("[A9 SKIP LOUD] VELA_TEST_MYSQL_URL unset — usage-wave parity vs real MariaDB skipped (no silent coverage)");
}

let tempDirs = [];
const saved = {};
for (const k of ["DATA_DIR", "VELA_DB_MODE", "VELA_MYSQL_URL"]) saved[k] = process.env[k];

function freshDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "vela-a9-"));
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

/** The harness's cost law (runner.js): pin every number to 6dp — SQLite REAL
 *  vs MySQL DECIMAL(12,6) must not fake a divergence beyond precision 6. */
function round6(v) {
  if (Array.isArray(v)) return v.map(round6);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round6(x)]));
  }
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v * 1e6) / 1e6;
  return v;
}

/** Sort an array of objects canonically (order-insensitive world comparison). */
const canonSort = (arr) => [...arr].sort((a, b) =>
  JSON.stringify(canon(a)).localeCompare(JSON.stringify(canon(b)))
);

const T0 = "2026-08-10T12:00:00.000Z"; // noon UTC — stable local dateKey in both legs

/** Volatile key identity leaks into byApiKey KEYS, keyName ("vela-v1-<8>…"),
 *  and apiKeyMasked (keyPrefix). Replace each world's OWN generated tokens
 *  with canonical markers so the two worlds compare value-shape, not uuids. */
function normalizeKeyIdentity(world, keyA, keyB) {
  const tokens = [
    [keyA.keyId, "«KA»"], [keyB.keyId, "«KB»"],
    [keyA.keyId.slice(0, 8), "«KA8»"], [keyB.keyId.slice(0, 8), "«KB8»"],
    [keyA.keyPrefix, "«PA»"], [keyB.keyPrefix, "«PB»"],
  ];
  let s = JSON.stringify(world);
  for (const [token, repl] of tokens) s = s.split(token).join(repl);
  return JSON.parse(s);
}

/** One deterministic scenario — the full usage surface. */
async function usageScenario(api) {
  // Minted keys for the GROUP BY attribution leg (uuid identity is volatile;
  // the world compares VALUE shapes, never key ids).
  const keyA = await api.createApiKey("Usage Key A", {});
  const keyB = await api.createApiKey("Usage Key B", {});

  // Four unique rows — each differs on the dedupe identity.
  await api.saveRequestUsage({ timestamp: T0, provider: "openai", model: "gpt-4o", connectionId: "conn-parity-1", endpoint: "/v1/chat/completions", status: "ok", tokens: { prompt_tokens: 100, completion_tokens: 40 } });
  await api.saveRequestUsage({ timestamp: T0, provider: "openai", model: "gpt-4o-mini", connectionId: "conn-parity-1", status: "ok", tokens: { prompt_tokens: 50, completion_tokens: 20 } });
  await api.saveRequestUsage({ timestamp: T0, provider: "anthropic", model: "claude-sonnet-4", connectionId: "", status: "error", tokens: { prompt_tokens: 200, completion_tokens: 80 } });
  await api.saveRequestUsage({ timestamp: T0, provider: "", model: "custom-x", connectionId: "", status: "ok", tokens: { prompt_tokens: 5, completion_tokens: 5 } });

  // Key-attributed rows: three under keyA, two under keyB.
  await api.saveRequestUsage({ timestamp: T0, provider: "openai", model: "gpt-4o", connectionId: "conn-parity-2", apiKey: keyA.key, status: "ok", tokens: { prompt_tokens: 11, completion_tokens: 21 } });
  await api.saveRequestUsage({ timestamp: T0, provider: "openai", model: "gpt-4o", connectionId: "conn-parity-2", apiKey: keyA.key, status: "ok", tokens: { prompt_tokens: 12, completion_tokens: 22 } });
  await api.saveRequestUsage({ timestamp: T0, provider: "anthropic", model: "claude-sonnet-4", connectionId: "conn-parity-2", apiKey: keyA.key, status: "ok", tokens: { prompt_tokens: 13, completion_tokens: 23 } });
  await api.saveRequestUsage({ timestamp: T0, provider: "openai", model: "gpt-4o", connectionId: "conn-parity-3", apiKey: keyB.key, status: "ok", tokens: { prompt_tokens: 31, completion_tokens: 41 } });
  await api.saveRequestUsage({ timestamp: T0, provider: "anthropic", model: "claude-sonnet-4", connectionId: "conn-parity-3", apiKey: keyB.key, status: "ok", tokens: { prompt_tokens: 32, completion_tokens: 42 } });

  // THE CONVERGENCE LAW — 8-way concurrent burst of IDENTICAL dedupe
  // identities. The UNIQUE index uq_uh_dedupe arbitrates: exactly ONE row
  // survives on each engine (sqlite ON CONFLICT DO NOTHING ≡ mysql
  // ER_DUP_ENTRY). A loser that silently double-writes fails this gate.
  await Promise.all(Array.from({ length: 8 }, () =>
    api.saveRequestUsage({ timestamp: T0, provider: "dup", model: "dup-model", connectionId: "", status: "ok", tokens: { prompt_tokens: 9, completion_tokens: 9 } })
  ));
  // Duplicate path: endpoint backfill (idempotent, endpoint-only).
  await api.saveRequestUsage({ timestamp: T0, provider: "dup", model: "dup-model", connectionId: "", status: "ok", endpoint: "/v1/dup", tokens: { prompt_tokens: 9, completion_tokens: 9 } });

  const history = round6(await api.getUsageHistory({}));
  const dupRows = round6(await api.getUsageHistory({ provider: "dup" }));
  const keyUsageRaw = await api.getKeyUsageStats("all");
  // Volatile keyId identity → compare sorted VALUE shapes (requests 3 vs 2).
  const keyUsage = canonSort(Object.values(round6(keyUsageRaw)));
  const daily = round6(await api.getUsageDailySince("2026-08-01"));
  const chart7d = round6(await api.getChartData("7d"));

  const stats = await api.getUsageStats("7d");
  delete stats.pending;        // shared global live-state — not harbor data
  delete stats.errorProvider;  // same — wall-clock window
  // byApiKey values carry volatile key identity (apiKeyKey/keyName/masked) —
  // canonicalize identity FIRST (normalizeKeyIdentity below), THEN sort.
  // Sorting raw-uuid strings here would bake world-dependent order into the
  // comparison.
  stats.byApiKey = Object.values(round6(stats.byApiKey));
  stats.byModel = round6(stats.byModel);
  stats.byProvider = round6(stats.byProvider);
  stats.byAccount = round6(stats.byAccount);
  stats.byEndpoint = round6(stats.byEndpoint);
  stats.last10Minutes = round6(stats.last10Minutes);
  stats.recentRequests = canonSort(round6(stats.recentRequests));
  stats.totalPromptTokens = round6(stats.totalPromptTokens);
  stats.totalCompletionTokens = round6(stats.totalCompletionTokens);
  stats.totalCachedTokens = round6(stats.totalCachedTokens);
  stats.totalCost = round6(stats.totalCost);
  stats.activeRequests = canonSort(stats.activeRequests);

  const recentLogs = canonSort(await api.getRecentLogs(200));

  // ─── W1-C aggregation layer — the 7 twin-parity fns ride one world ──────
  // Both tiers (exact ≤3d + rollup 7d+), the identifier maps' OUTPUTS, the
  // KPI double-range, keyset ledger, and the export cursor. A `now` anchored
  // on the scenario's T0 keeps both legs' windows identical.
  const NOW = new Date(T0).getTime() + 2 * 3_600_000; // 14:00 on T0's day
  const agg = {
    seriesExact: await api.getFilteredSeries({ period: "24h", granularity: "1h", metric: "requests", now: NOW }),
    seriesCached: await api.getFilteredSeries({ period: "24h", granularity: "1d", metric: "cachedTokens", now: NOW }),
    seriesRollup: await api.getFilteredSeries({ period: "7d", granularity: "1d", metric: "requests", now: NOW }),
    breakdownProvider: await api.getBreakdown({ dimension: "provider", metric: "requests", period: "24h", now: NOW }),
    breakdownKeyRollup: await api.getBreakdown({ dimension: "keyId", metric: "requests", period: "7d", now: NOW }),
    percentilesExact: await api.getPercentiles({ period: "24h", now: NOW }),
    percentilesRollup: await api.getPercentiles({ period: "7d", now: NOW }),
    healthFrame: await api.getProviderHealthFrame({ windowMs: 4 * 3_600_000, now: NOW }),
    kpis: await api.getKpis({ period: "24h", now: NOW }),
    ledger: await api.getLedgerRows({ period: "24h", now: NOW, limit: 3, sort: "timestamp", order: "desc" }),
    ledgerNullSort: await api.getLedgerRows({ period: "24h", now: NOW, limit: 4, sort: "latencyMs", order: "desc" }),
  };
  // The cursor is an identity, not data — walk it and compare COUNT + ORDER,
  // never the ids themselves (AUTOINCREMENT counters are per-engine).
  const cursorIds = [];
  for await (const row of await api.getExportCursor({ period: "24h", now: NOW, cap: 50 })) {
    cursorIds.push(row.id);
  }
  agg.exportCount = cursorIds.length;
  agg.exportDistinct = new Set(cursorIds).size;
  // Cost parity at 5dp: cost is the ONLY REAL(sqlite) vs DECIMAL(12,6)(mysql)
  // aggregate in the layer — their sums can straddle a 1e-6 rounding boundary
  // (this seed's total lands exactly on .5), so cost compares at 1e-5. Token
  // and request counts are integers — exact on both engines, no softening.
  const round5 = (v) => Math.round(v * 1e5) / 1e5;
  for (const k of ["value", "previous", "delta"]) agg.kpis.cost[k] = round5(agg.kpis.cost[k]);
  for (const item of agg.ledger.items) item.cost = round5(item.cost);
  for (const item of agg.ledgerNullSort.items) item.cost = round5(item.cost);

  const world = { history, dupRows, keyUsage, daily, chart7d, stats, recentLogs, agg };
  // Canonicalize volatile key identity BEFORE any ordering-sensitive step —
  // see the byApiKey note above. The ledger rows carry keyId identity too.
  const normalized = normalizeKeyIdentity(world, keyA, keyB);
  normalized.stats.byApiKey = canonSort(normalized.stats.byApiKey);
  // Row ids + cursor ids are per-engine identities — strip them BEFORE the
  // order-sensitive sorts so value shapes compare, never counters.
  for (const k of ["ledger", "ledgerNullSort"]) {
    normalized.agg[k].items = normalized.agg[k].items.map(({ id, ...rest }) => rest);
    normalized.agg[k].nextCursor = normalized.agg[k].nextCursor ? "«CURSOR»" : null;
  }
  normalized.agg.breakdownProvider.items = canonSort(normalized.agg.breakdownProvider.items);
  normalized.agg.breakdownKeyRollup.items = canonSort(normalized.agg.breakdownKeyRollup.items);
  normalized.agg.ledger.items = canonSort(normalized.agg.ledger.items);
  normalized.agg.ledgerNullSort.items = canonSort(normalized.agg.ledgerNullSort.items);
  return normalized;
}

async function buildSqliteWorld() {
  process.env.DATA_DIR = freshDir();
  process.env.VELA_DB_MODE = "sqlite";
  delete process.env.VELA_MYSQL_URL;
  delete global._dbAdapter;
  // Shared globals persist across vi.resetModules — reset the ring/conn-cache
  // so each leg initializes its own view from its own harbor.
  global._recentRing = { items: [], initialized: false };
  global._connectionMapCache = { map: {}, ts: 0 };
  vi.resetModules();
  const api = {
    ...(await import("@/lib/db/repos/sqlite/apiKeysRepo.js")),
    ...(await import("@/lib/db/repos/sqlite/usageRepo.js")),
  };
  return usageScenario(api);
}

async function buildMysqlWorld() {
  process.env.VELA_MYSQL_URL = MYSQL_URL;
  delete global._mysqlAdapter;
  global._recentRing = { items: [], initialized: false };
  global._connectionMapCache = { map: {}, ts: 0 };
  vi.resetModules();
  const { getMysqlAdapter } = await import("@/lib/db/mysql/adapter.js");
  const db = await getMysqlAdapter(); // boots pool + bootstrap (additive, idempotent)
  // Clean the usage tables + the keys/pricing the scenario mints/reads so the
  // world seeds deterministically. (The twin is disposable by covenant.)
  await db.exec("DELETE FROM usageHistory");
  await db.exec("DELETE FROM usageDaily");
  await db.exec("DELETE FROM _meta WHERE `key` = 'totalRequestsLifetime'");
  await db.exec("DELETE FROM apiKeys");
  await db.exec("DELETE FROM kv WHERE scope IN ('pricing','pricing_sync')");
  const api = {
    ...(await import("@/lib/db/repos/mysql/apiKeysRepo.js")),
    ...(await import("@/lib/db/repos/mysql/usageRepo.js")),
  };
  return usageScenario(api);
}

describe.skipIf(!MYSQL_URL)("Storage Covenant A9 — usage-wave parity vs real MariaDB", () => {
  it("sqlite harbor ≡ mysql twin — dedupe, day-aggregate, GROUP BY all converge", async () => {
    const sqliteWorld = await buildSqliteWorld();
    const mysqlWorld = await buildMysqlWorld();

    const keys = Object.keys(sqliteWorld);
    expect(keys.length).toBeGreaterThanOrEqual(8);
    for (const k of keys) {
      expect(
        JSON.stringify(canon(mysqlWorld[k])),
        `divergent world key: ${k}`
      ).toBe(JSON.stringify(canon(sqliteWorld[k])));
    }

    // Spot-checks that prove the comparison guards real content
    expect(sqliteWorld.history.length).toBe(10);          // 4 unique + 5 keyed + 1 dup survivor
    expect(sqliteWorld.dupRows.length).toBe(1);           // THE convergence law
    expect(sqliteWorld.dupRows[0].endpoint).toBe("/v1/dup"); // backfill survived
    expect(sqliteWorld.keyUsage.length).toBe(2);
    expect(sqliteWorld.keyUsage[0].requests).toBe(3);     // keyA
    expect(sqliteWorld.keyUsage[1].requests).toBe(2);     // keyB
    expect(sqliteWorld.daily.length).toBe(1);             // one dayKey
    expect(sqliteWorld.daily[0].requests).toBe(10);
    expect(sqliteWorld.stats.totalRequests).toBe(9);      // totalRequests sums
    // byProvider — the provider-less row (provider: "") never attributes one
    expect(sqliteWorld.stats.byProvider.openai.requests).toBe(5);
    expect(sqliteWorld.stats.byProvider.anthropic.requests).toBe(3);
    expect(sqliteWorld.stats.byProvider.dup.requests).toBe(1);
    expect(sqliteWorld.recentLogs.length).toBe(10);

    // W1-C aggregation spot-checks — the world holds real data, not zeros.
    const agg = sqliteWorld.agg;
    expect(agg.seriesExact.points.reduce((a, p) => a + p.value, 0)).toBe(10); // all rows in-window
    expect(agg.seriesRollup.meta.source).toBe("usageDaily");
    expect(agg.breakdownProvider.items.find((i) => i.provider === "openai").value).toBe(5);
    expect(agg.percentilesExact.meta.approximate).toBe(false);
    expect(agg.percentilesExact.latency.count ?? agg.percentilesExact.meta.count).toBe(0); // no latencyMs seeded → honest empty
    expect(agg.percentilesRollup.meta.approximate).toBe(true);
    expect(agg.healthFrame.perProvider.openai.requests).toBe(5);
    expect(agg.kpis.requests.value).toBe(10);
    expect(agg.ledger.items.length).toBe(3);
    expect(agg.ledgerNullSort.items.length).toBe(4);
    expect(agg.exportCount).toBe(10);
    expect(agg.exportDistinct).toBe(10); // the cursor walks every row exactly once
  }, 90000);

  it("the FACADE seam dispatches usage symbols to the mysql twin under VELA_DB_MODE=mysql", async () => {
    process.env.DATA_DIR = freshDir();
    process.env.VELA_DB_MODE = "mysql";
    process.env.VELA_MYSQL_URL = MYSQL_URL;
    delete global._mysqlAdapter;
    vi.resetModules();

    const usage = await import("@/lib/db/repos/usageRepo.js");
    const apiKeys = await import("@/lib/db/repos/apiKeysRepo.js");

    // Reads must hit the mysql twin (the parity world left data there)
    const history = await usage.getUsageHistory({ provider: "dup" });
    expect(history.length).toBe(1);
    const keyUsage = await usage.getKeyUsageStats("all");
    expect(Object.keys(keyUsage).length).toBe(2);

    // A write through the facade must land in the mysql twin, verifiable
    const before = (await usage.getUsageHistory({})).length;
    await usage.saveRequestUsage({ timestamp: "2026-08-11T12:00:00.000Z", provider: "facade-probe", model: "probe-m", connectionId: "", status: "ok", tokens: { prompt_tokens: 1, completion_tokens: 1 } });
    const after = (await usage.getUsageHistory({})).length;
    expect(after).toBe(before + 1);
    // keep the twin tidy for the next tide
    const { getMysqlAdapter } = await import("@/lib/db/mysql/adapter.js");
    const db = await getMysqlAdapter();
    await db.exec("DELETE FROM usageHistory WHERE provider = 'facade-probe'");
    expect((await apiKeys.getApiKeys()).length).toBe(2); // parity world's keys visible
  }, 90000);
});
