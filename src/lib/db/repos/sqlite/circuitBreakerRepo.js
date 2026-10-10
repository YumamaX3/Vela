// SQLite harbor for circuitBreakerKeys — the breaker's own ledger (W9).
// All operations are sync, same adapter contract as proxyFitnessRepo:
// { run, get, all, exec, transaction, close, raw } — no db.prepare.
// The mysql twin mirrors every export; bind.js routes by posture.
//
// GRAIN LAW: this table's key is (poolId, provider, model) — the breaker's
// own three-part key, verbatim. proxyFitness is (poolId, provider). The
// breaker flushes HERE; the weighted draw reads THERE. One writer per table,
// never a dual store.

/**
 * Get breaker rows, optionally filtered by providerId.
 * @param {DbClient} db - sqlite3 database client
 * @param {string|null} providerId - optional filter, null returns all rows
 * @returns {Array} breaker rows
 */
export function getBreakerRows(db, providerId = null) {
  if (providerId === null || providerId === '') {
    return db.all('SELECT * FROM circuitBreakerKeys ORDER BY poolId');
  }
  return db.all('SELECT * FROM circuitBreakerKeys WHERE provider = ? OR provider = ? ORDER BY poolId', [providerId, '']);
}

/**
 * Upsert batched breaker rows in one transaction.
 * Names EVERY column the breaker owns — this is the breaker's full-state
 * writer, unlike the six-column fitness narrowing. ON CONFLICT updates all
 * state columns; the key columns are the conflict target itself.
 * @param {DbClient} db
 * @param {Array} rows - [{poolId, provider, model, state, failureCount, lastFailureAt, cooldownUntil, retryAfterMs, updatedAt}]
 */
export function upsertBreakerBatch(db, rows) {
  if (!rows || rows.length === 0) return;
  db.transaction(() => {
    for (const row of rows) {
      db.run(
        `INSERT INTO circuitBreakerKeys (
          poolId, provider, model, state, failureCount,
          lastFailureAt, cooldownUntil, retryAfterMs, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(poolId, provider, model) DO UPDATE SET
          state = excluded.state,
          failureCount = excluded.failureCount,
          lastFailureAt = excluded.lastFailureAt,
          cooldownUntil = excluded.cooldownUntil,
          retryAfterMs = excluded.retryAfterMs,
          updatedAt = excluded.updatedAt`,
        [
          row.poolId, row.provider, row.model ?? '', row.state ?? 'healthy',
          row.failureCount ?? 0, row.lastFailureAt ?? null,
          row.cooldownUntil ?? null, row.retryAfterMs ?? null, row.updatedAt,
        ]
      );
    }
  });
}

/**
 * Clear one key back to healthy — the persisted form of resetKey().
 * DELETE, not an UPDATE to healthy: a healthy row is the absence of a
 * cooldown, and an empty ledger is the honest default.
 * @param {DbClient} db
 * @param {string} poolId
 * @param {string} providerId
 * @param {string} model
 */
export function deleteBreakerRow(db, poolId, providerId, model = '') {
  db.run('DELETE FROM circuitBreakerKeys WHERE poolId = ? AND provider = ? AND model = ?', [poolId, providerId, model ?? '']);
}

/**
 * Clear ALL rows for one pool (pool delete cascade).
 * @param {DbClient} db
 * @param {string} poolId
 */
export function deleteBreakerRowsByPool(db, poolId) {
  db.run('DELETE FROM circuitBreakerKeys WHERE poolId = ?', [poolId]);
}

/**
 * Clear the whole ledger (the breaker's clearAll()).
 * @param {DbClient} db
 */
export function clearBreakerRows(db) {
  db.run('DELETE FROM circuitBreakerKeys');
}
