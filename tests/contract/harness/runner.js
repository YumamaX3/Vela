// Storage Covenant Wave A4 — the parity-harness runner.
// Plan: plans/storage-covenant.md A4 (fixtures, golden normalization,
// sqlite-vs-sqlite shakeout). From Wave A6 the same runner drives
// sqlite-vs-mysql parity behind VELA_TEST_MYSQL_URL.
//
// Shape of a parity check:
//   1. Seed an identical world into TWO adapters (two temp DATA_DIRs).
//   2. Run the same writer scenario against each.
//   3. exportDb() both, normalize away engine-divergent fields, deep-equal.
//
// Normalization is the honest part of the harness: it strips exactly the
// engine-divergent surfaces the plan names (ids, timestamps, REAL-vs-DECIMAL
// cost), never the data itself — so a genuine divergence fails loudly.

/** Volatile / engine-divergent fields stripped before comparison.
 *  Mirrors the divergence-sweep checksum spec (plan line 245) and A4's golden
 *  normalization ("strip ids/timestamps; shape assertions for AUTOINCREMENT;
 *  boolean coercion", plan line 269). Generated identity (uuids, wall-clock
 *  createdAt) differs between two independent worlds by construction — it is
 *  stripped, never compared; row CONTENT is what the parity law guards. */
export const VOLATILE_BY_TABLE = {
  // apiKeys identity (id, key sentinel, keyPrefix, keyHash) is ALL derived from
  // a generated uuid → differs between two independent worlds by construction.
  // Strip identity, keep content (name/description/category/governance fields).
  apiKeys: ["id", "key", "keyPrefix", "keyHash", "createdAt", "lastUsedAt"],
  // providerConnections + combos mint uuids in-body → id is volatile.
  providerConnections: ["id", "createdAt", "updatedAt"],
  combos: ["id", "createdAt", "updatedAt"],
  // providerNodes + proxyPools respect an explicit id passed in seedWorld.
  providerNodes: ["createdAt", "updatedAt"],
  proxyPools: ["createdAt", "updatedAt"],
  usageHistory: [],                            // AUTOINCREMENT id — deterministic, shape-asserted
  usageDaily: [],
};

/** Normalize an exportDb() payload into a canonical comparable form. */
export function normalizePayload(payload) {
  const out = { ...payload };
  // Strip provenance (exportedAt differs by definition)
  delete out._meta;
  // Strip per-table volatile/generated fields
  for (const [table, fields] of Object.entries(VOLATILE_BY_TABLE)) {
    if (!Array.isArray(out[table]) || !fields.length) continue;
    out[table] = out[table].map((row) => {
      const copy = { ...row };
      for (const f of fields) delete copy[f];
      return copy;
    });
  }
  // Normalize REAL cost to a fixed-precision number across engines
  // (SQLite REAL vs MySQL DECIMAL both serialize through JSON; pin 6dp).
  if (Array.isArray(out.usageHistory)) {
    out.usageHistory = out.usageHistory.map((h) => ({
      ...h,
      cost: h.cost == null ? null : Number(h.cost.toFixed(6)),
    }));
  }
  return out;
}

/** Seed one adapter's world. `api` = the barrel bound to that adapter.
 *  The caller is responsible for pointing DATA_DIR at a fresh temp dir and
 *  resetting global._dbAdapter BEFORE calling, so a fresh import of the barrel
 *  resolves to the intended adapter.
 *
 *  All seed values are DETERMINISTIC — two independently seeded worlds must be
 *  byte-equal after normalization, so no wall-clock or uuid may leak into the
 *  seed itself (generated identity in the REPOS is fine — normalization strips
 *  it; a seed timestamp is not). */
const SEED_TIMESTAMP = "2026-08-15T00:00:00.000Z";

export async function seedWorld(api, { seedUsage = true } = {}) {
  const now = SEED_TIMESTAMP;
  // Config tables through the repos — the parity contract is the repos, so we
  // drive them, not raw SQL.
  await api.updateSettings({ requireApiKey: true, comboStrategy: "fallback" });
  await api.createProviderConnection({
    provider: "openai", authType: "apikey", name: "Seed Conn", apiKey: "seed", priority: 1, isActive: true,
  });
  await api.createProviderNode({ id: "node-1", type: "worker", name: "Seed Node", region: "local" });
  await api.createProxyPool({ id: "pool-1", name: "Seed Pool", proxyUrl: "socks5://seed", proxies: [] });
  await api.createApiKey("Parity Probe", { description: "parity", category: "seed-cat" });
  await api.createCombo({ name: "Seed Combo", kind: "fallback", models: ["openai/gpt-4o"] });
  await api.setModelAlias("gpt-fast", "openai/gpt-4o");
  await api.addCustomModel({ providerAlias: "seed", id: "custom-1", type: "llm", name: "Seed Custom" });
  await api.disableModels("openai", ["gpt-4.1"]);
  await api.updatePricing({ openai: { "gpt-4o": { input: 2.5, output: 10 } } });

  if (seedUsage) {
    // Usage is seeded via raw SQL on the underlying adapter — the usage repos
    // are Wave A9 and their write path is what we are proving, not consuming.
    // keyId writes '' (not NULL): migration 004 normalized '' as the dedupe
    // "unset" form — a NULL keyId here would violate the post-A5 write contract.
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run(
      `INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, keyId, keyPrefix, endpoint, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [now, "openai", "gpt-4o", "conn-1", "", "vela-v1-seed", "/v1/chat", 100, 50, 0.0012, "success", JSON.stringify({ cached: 10 }), JSON.stringify({ seed: true })]
    );
    db.run(
      `INSERT INTO usageDaily(dateKey, data) VALUES(?, ?)`,
      ["2026-08-15", JSON.stringify({ totalRequests: 1, byApiKey: { probe: { requests: 1 } } })]
    );
  }
}

/** Run a parity comparison between two isolated adapter worlds.
 *  IMPORTANT — the adapter is a process-global singleton: each buildWorld MUST
 *  seed AND exportDb() (returning the payload) before the next world is built,
 *  or the second world's adapter silently replaces the first. buildWorldA and
 *  buildWorldB therefore each return a complete exportDb() payload, having
 *  already closed their adapter. */
export async function compareWorlds(buildWorldA, buildWorldB) {
  const payloadA = await buildWorldA();
  const payloadB = await buildWorldB();
  const normA = normalizePayload(payloadA);
  const normB = normalizePayload(payloadB);
  return { payloadA, payloadB, normA, normB, equal: JSON.stringify(normA) === JSON.stringify(normB) };
}
