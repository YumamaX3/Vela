// SEMANTIC CACHE × HARBOR — the wiring between the pure engine and SQLite.
//
// The engine (src/lib/semanticCache.js) knows nothing about the database; this
// module attaches the persistence adapter and restores the shelf once per
// process. Hydration is lazy and fail-open: a cache that cannot read its disk
// still serves its memory instead of taking chat down.
import { semanticCache } from "./semanticCache.js";
import {
  hydrateSemanticCache,
  upsertSemanticCacheEntry,
  recordSemanticCacheHit,
  deleteSemanticCacheEntry,
  invalidateSemanticCacheByModel,
  invalidateSemanticCacheOlderThan,
  clearSemanticCache,
  countSemanticCacheEntries,
} from "./db/repos/sqlite/semanticCacheRepo.js";

semanticCache.persist = {
  upsert: upsertSemanticCacheEntry,
  recordHit: recordSemanticCacheHit,
  delete: deleteSemanticCacheEntry,
  invalidateByModel: invalidateSemanticCacheByModel,
  invalidateOlderThan: invalidateSemanticCacheOlderThan,
  clear: clearSemanticCache,
};

let hydration = null;

/** Restore unexpired rows into the LRU exactly once per process. */
export function ensureSemanticCacheHydrated() {
  if (!hydration) {
    const ttl = semanticCache.config.ttlMs;
    const cutoff = ttl > 0 ? Date.now() - ttl : 0;
    hydration = hydrateSemanticCache(cutoff)
      .then((rows) => {
        for (const entry of rows) semanticCache.store.put(entry.key, entry);
        return rows.length;
      })
      .catch((e) => {
        console.warn(`[semantic-cache] hydration skipped: ${e.message}`);
        return 0;
      });
  }
  return hydration;
}

export async function semanticCacheDbCount() {
  try {
    return await countSemanticCacheEntries();
  } catch {
    return 0;
  }
}
