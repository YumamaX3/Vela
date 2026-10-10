/**
 * Migration 019: the breaker's own ledger — circuitBreakerKeys.
 * (Proxy control-plane rebirth, W9 — "The Break Table")
 *
 * Before this table the breaker's state machine had no durable home of its
 * own. Its per-model counts (failureCount, consecutive cooldowns, the
 * retryAfterMs a Retry-After header demanded) were squeezed into six columns
 * of `proxyFitness` — a table whose grain is (poolId, provider), one row per
 * pool-pair. The breaker's grain is (poolId, provider, model). Writing a
 * three-part key into a two-part table meant the model dimension was
 * flattened on every flush: one 429 on one model cooled every model on the
 * provider, and the counts the breaker needed at boot were not there.
 *
 * The plan's law for this wave: take the table, not a module split. One
 * table, one row per breaker key, so model-granular counts round-trip:
 *
 *   poolId / provider / model — the key, verbatim, PK all three. `model`
 *       keeps its '' default: the live call sites still scope to the pool
 *       pair (W1's explicit decision — the vestigial dimension is retained
 *       in the schema so a future caller can thread a real model without a
 *       second migration).
 *   state          — 'healthy' | 'cooldown' | 'exhausted', the machine's own
 *                    vocabulary, stored as declared (no CHECK: the states
 *                    belong to the breaker, and growing the machine must not
 *                    cost a migration).
 *   failureCount   — cumulative failures on this key (drives backoff 2^(n-3)).
 *   lastFailureAt  — ISO timestamp of the most recent failure.
 *   cooldownUntil  — epoch-ms INTEGER: when the current cooldown lifts.
 *                    authFailures (016) and logEvents (018) set the integer
 *                    precedent for range-queried time.
 *   retryAfterMs   — the Retry-After the upstream demanded, ms.
 *   updatedAt      — ISO, the flush stamp.
 *
 * The proxyFitness.unfit columns REMAIN — they are the UI's fitness view and
 * the weighted draw's input, written by the W1 narrow writer exactly as
 * before. This table is the breaker's own memory, not a second copy of
 * fitness: the breaker flushes HERE, the draw reads THERE.
 */

const TABLE = "circuitBreakerKeys";

const up = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      poolId TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT 'healthy',
      failureCount INTEGER NOT NULL DEFAULT 0,
      lastFailureAt TEXT,
      cooldownUntil INTEGER,
      retryAfterMs INTEGER,
      updatedAt TEXT NOT NULL,
      PRIMARY KEY (poolId, provider, model)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cbk_pool ON ${TABLE}(poolId)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cbk_state ON ${TABLE}(state)`);
}

const down = (db) => {
  // Pure addition — the inverse is expressible, so it is written, the same
  // call 016/017/018 make. No columns were added to any existing table.
  db.exec(`DROP INDEX IF EXISTS idx_cbk_pool`);
  db.exec(`DROP INDEX IF EXISTS idx_cbk_state`);
  db.exec(`DROP TABLE IF EXISTS ${TABLE}`);
};

const migration = { version: 19, name: "circuit-breaker-keys", up, down };
export default migration;
export { up, down };
