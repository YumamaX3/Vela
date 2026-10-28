// M4 — the CodeBuddy family's breaker survives a restart, bound at boot.
//
// The gate's in-memory Map is the truth the request path reads; the bound store
// is where its open windows persist across a process restart. The store's real
// API is per-key: fail(key, {until, reason}) writes a window, succeed(key) clears
// one, save() flushes — and its own laws clamp every deadline to a ceiling, bound
// the table, and refuse a half-understood snapshot at load. Nothing here invents
// a second store; everything writes through the one bound seam.
//
// Binding happens lazily, on the first family request — a harbour that never dials
// these shores pays nothing, and a harbour that does pays one construction per
// process. A binding failure degrades to memory-only: the breaker still guards,
// it simply forgets across a restart, which is what it did before M4.

import { bindBreakerPersistence } from "./gate.js";
import { PersistentBreakerStore } from "./breakerStore.js";
import { createLedgerStorage } from "./breakerLedger.js";

/** Set true once the binding has succeeded in this process. */
let bound = false;

/**
 * Bind the family's breaker to the persistent ledger. Safe to call on every
 * CodeBuddy-family request; only the first successful call constructs the store.
 *
 * @param {object} db - the sqlite/mysql client the circuit-breaker repo expects.
 */
export function bindCodeBuddyBreaker(db) {
  if (bound) return;
  try {
    const storage = createLedgerStorage(db);
    const store = new PersistentBreakerStore({ storage });
    bindBreakerPersistence(store);
    bound = true;
  } catch {
    // Leave `bound` false so a later request can retry the binding once the
    // transient cause (a locked db, a missing table mid-migration) is gone.
  }
}