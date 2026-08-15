import { getAdapter } from "../../driver.js";
import { parseJson, stringifyJson } from "../../helpers/jsonCol.js";
import { makeKv } from "../../helpers/kvStore.js";
import { PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";

const pricingKv = makeKv("pricing");
const syncKv = makeKv("pricing_sync"); // Pricing Covenant — never mixed with user overrides
const CACHE_TTL_MS = 5000;

let cache = { value: null, expiresAt: 0 };
let syncCache = { value: null, expiresAt: 0 };

function invalidate() {
  cache = { value: null, expiresAt: 0 };
  syncCache = { value: null, expiresAt: 0 };
}

async function getUserPricing() {
  return await pricingKv.getAll();
}

async function getSyncedPricingRaw() {
  return await syncKv.getAll();
}

/**
 * Merge the full static picture (PROVIDER_PRICING + materialized canonical
 * MODEL_PRICING under the synthetic '_canonical' key), then overlay synced
 * rates, then user overrides LAST — the user is always sovereign (R7).
 */
export async function getPricing() {
  const now = Date.now();
  if (cache.value && cache.expiresAt > now) return cache.value;

  const userPricing = await getUserPricing();
  const syncedPricing = await getSyncedPricingRaw();
  const { PROVIDER_PRICING, MODEL_PRICING } = await import("open-sse/providers/pricing.js");
  const merged = {};

  for (const [provider, models] of Object.entries(PROVIDER_PRICING)) {
    merged[provider] = { ...models };
  }
  // Materialize the canonical table so models priced only via MODEL_PRICING
  // become visible/editable in the settings UI (the old getDefaultPricing()
  // view was blind to them).
  merged._canonical = { ...MODEL_PRICING };

  // Sync layer overlays defaults
  for (const [provider, models] of Object.entries(syncedPricing)) {
    if (provider === "__meta__") continue;
    if (!merged[provider]) {
      merged[provider] = { ...models };
    } else {
      for (const [model, pricing] of Object.entries(models)) {
        merged[provider][model] = merged[provider][model]
          ? { ...merged[provider][model], ...pricing }
          : pricing;
      }
    }
  }

  // User overrides overlay everything — sovereign
  for (const [provider, models] of Object.entries(userPricing)) {
    if (!merged[provider]) {
      merged[provider] = { ...models };
    } else {
      for (const [model, pricing] of Object.entries(models)) {
        merged[provider][model] = merged[provider][model]
          ? { ...merged[provider][model], ...pricing }
          : pricing;
      }
    }
  }

  cache = { value: merged, expiresAt: now + CACHE_TTL_MS };
  return merged;
}

/** Exact-match lookup across a pricing map, trying registry id then alias. */
function lookupDualKey(map, provider, model) {
  if (!provider || !model) return null;
  const byId = map?.[provider]?.[model];
  if (byId) return byId;
  const alias = PROVIDER_ID_TO_ALIAS?.[provider];
  if (alias && alias !== provider) return map?.[alias]?.[model] || null;
  return null;
}

export async function getPricingForModel(provider, model) {
  if (!model) return null;
  // Stratum 1 — user override (sovereign)
  const userPricing = await getUserPricing();
  const userMatch = lookupDualKey(userPricing, provider, model);
  if (userMatch) return userMatch;
  // Stratum 2 — synced rates (TTL-cached)
  const now = Date.now();
  if (!syncCache.value || syncCache.expiresAt <= now) {
    syncCache = { value: await getSyncedPricingRaw(), expiresAt: now + CACHE_TTL_MS };
  }
  const syncMatch = lookupDualKey(syncCache.value, provider, model);
  if (syncMatch) return syncMatch;
  // Stratum 3 — the seven-stratum static chain
  const { getPricingForModel: resolveStatic } = await import("open-sse/providers/pricing.js");
  return resolveStatic(provider, model);
}

// Atomic merge inside transaction (per-provider read-modify-write)
export async function updatePricing(pricingData) {
  const db = await getAdapter();
  db.transaction(() => {
    for (const [provider, models] of Object.entries(pricingData)) {
      const row = db.get(`SELECT value FROM kv WHERE scope = 'pricing' AND key = ?`, [provider]);
      const current = row ? (parseJson(row.value, {}) || {}) : {};
      const merged = { ...current };
      for (const [model, pricing] of Object.entries(models)) {
        merged[model] = pricing;
      }
      db.run(
        `INSERT INTO kv(scope, key, value) VALUES('pricing', ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
        [provider, stringifyJson(merged)]
      );
    }
  });
  invalidate();
  return await getUserPricing();
}

export async function resetPricing(provider, model) {
  if (!provider) return await getUserPricing();
  const db = await getAdapter();
  db.transaction(() => {
    if (!model) {
      db.run(`DELETE FROM kv WHERE scope = 'pricing' AND key = ?`, [provider]);
      return;
    }
    const row = db.get(`SELECT value FROM kv WHERE scope = 'pricing' AND key = ?`, [provider]);
    const current = row ? (parseJson(row.value, {}) || {}) : {};
    delete current[model];
    if (Object.keys(current).length === 0) {
      db.run(`DELETE FROM kv WHERE scope = 'pricing' AND key = ?`, [provider]);
    } else {
      db.run(
        `INSERT INTO kv(scope, key, value) VALUES('pricing', ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
        [provider, stringifyJson(current)]
      );
    }
  });
  invalidate();
  return await getUserPricing();
}

export async function resetAllPricing() {
  await pricingKv.clear();
  invalidate();
  return {};
}

// ── Sync namespace (Pricing Covenant C4) ────────────────────────────────
// Writes ONLY scope 'pricing_sync'; the user's 'pricing' scope is never
// touched here, so the two reset affordances stay independent (F2).

/** Replace the entire synced namespace in one transaction (setMany semantics). */
export async function replaceSyncedPricing(syncedData, meta) {
  await syncKv.clear();
  const payload = { ...syncedData };
  if (meta) payload.__meta__ = meta;
  await syncKv.setMany(payload);
  invalidate();
  return await getSyncedPricing();
}

/** Clear synced rates — the second reset affordance. Never touches user overrides. */
export async function clearSyncedPricing() {
  await syncKv.clear();
  invalidate();
  return {};
}

/** Last sync metadata ({syncedAt, sources, entryCount}) or null. */
export async function getSyncedPricing() {
  const raw = await getSyncedPricingRaw();
  const meta = raw.__meta__ || null;
  const providers = {};
  for (const [provider, models] of Object.entries(raw)) {
    if (provider !== "__meta__") providers[provider] = models;
  }
  return { meta, providers };
}
