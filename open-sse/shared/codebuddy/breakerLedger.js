// Bind the CodeBuddy breaker to Vela's OWN ledger — not a second store.
//
// The reference gateway persists its cooldowns in a bespoke file beside its state.
// Vela already owns the right seam: `circuitBreakerKeys` (migration 019), keyed
// (poolId, provider, model), holding `cooldownUntil`, written by the breaker and read
// by hydrate. A second store beside `data.sqlite` would be a second truth, competing
// for the same single-writer lock — so this adapter speaks to the existing repo and
// adds no table, no file, and no migration.
//
// It satisfies PersistentBreakerStore's `storage` contract exactly:
//   read()  -> string | null    (a serialized snapshot, or null when nothing is known)
//   write(text) -> void         (persist a serialized snapshot; throws on failure)
//
// and inherits every one of that store's four laws — ceiling clamping, whole-snapshot
// validation, degrade-to-memory on failure, and a bounded write that reports shedding.
// This file is the ADAPTER; the laws live in breakerStore.js so they stay provable
// without a database.

import { getBreakerRows, upsertBreakerBatch, deleteBreakerRow } from "@/lib/db/repos/circuitBreakerRepo.js";

/** The pool the CodeBuddy lanes write under. One ember for the whole family. */
export const CODEBUDDY_BREAKER_POOL = "codebuddy";

/** Provider ids whose breaker rows belong to this family. */
export const CODEBUDDY_BREAKER_PROVIDERS = Object.freeze([
  "codebuddy-cn",
  "codebuddy-intl",
  "workbuddy-cn",
  "workbuddy-intl",
]);

/**
 * Build a `storage` adapter over the breaker ledger.
 *
 * @param {object} db - The sqlite/mysql client the repos expect.
 * @returns {{read: () => string|null, write: (text: string) => void}}
 */
export function createLedgerStorage(db) {
  return {
    /**
     * Read the family's rows back as the snapshot shape the store validates.
     * Keys are the credential breaker key, carried in the `model` column — the
     * ledger's third key part, which the CodeBuddy lanes use for the credential
     * rather than for a model name.
     */
    read() {
      const rows = getBreakerRows(db, null).filter(
        (row) => row.poolId === CODEBUDDY_BREAKER_POOL
          && CODEBUDDY_BREAKER_PROVIDERS.includes(row.provider)
          && row.cooldownUntil !== null
          && row.cooldownUntil !== undefined,
      );
      if (rows.length === 0) return null;
      const accounts = {};
      for (const row of rows) {
        if (!row.model) continue;
        accounts[row.model] = {
          failUntil: Number(row.cooldownUntil),
          reason: row.state === "open" ? "breaker-open" : String(row.state || ""),
          failedAt: row.lastFailureAt ? Date.parse(row.lastFailureAt) || 0 : 0,
        };
      }
      return JSON.stringify({ version: 1, accounts });
    },

    /**
     * Persist a snapshot. Every row is rewritten in one transaction, so a partial
     * write cannot leave the family's ledger half-updated.
     */
    write(text) {
      const parsed = JSON.parse(text);
      const accounts = parsed?.accounts;
      if (!accounts || typeof accounts !== "object") {
        throw new Error("codebuddy breaker: refusing to write a snapshot with no accounts map");
      }
      const nowIso = new Date().toISOString();
      // Rows the snapshot no longer names are cleared first — an expired cooldown
      // that lingers in the ledger would resurrect on the next boot.
      const existing = new Set(
        getBreakerRows(db, null)
          .filter((row) => row.poolId === CODEBUDDY_BREAKER_POOL
            && CODEBUDDY_BREAKER_PROVIDERS.includes(row.provider))
          .map((row) => `${row.provider}\u0000${row.model}`),
      );
      const rows = [];
      for (const [key, row] of Object.entries(accounts)) {
        // The provider is unknown at this layer; every family provider shares the
        // credential key, so the first one carries the row and the rest are cleared.
        const provider = CODEBUDDY_BREAKER_PROVIDERS[0];
        existing.delete(`${provider}\u0000${key}`);
        rows.push({
          poolId: CODEBUDDY_BREAKER_POOL,
          provider,
          model: key,
          state: "open",
          failureCount: 1,
          lastFailureAt: row.failedAt ? new Date(row.failedAt).toISOString() : nowIso,
          cooldownUntil: Math.trunc(Number(row.failUntil)) || null,
          retryAfterMs: null,
          updatedAt: nowIso,
        });
      }
      for (const stale of existing) {
        const [provider, model] = stale.split("\u0000");
        deleteBreakerRow(db, CODEBUDDY_BREAKER_POOL, provider, model);
      }
      if (rows.length > 0) upsertBreakerBatch(db, rows);
    },
  };
}
