// MySQL twin for circuitBreakerKeys — the breaker's own ledger (W9).
// Mirrors the sqlite harbor's contract but is ASYNC — the mysql2 adapter is
// network-bound and its shape is { run, get, all, exec, transaction, close,
// raw }, all promise-returning, with transaction(fn) invoking fn(tx) inside a
// connection-bound transaction (tx is a conn-scoped adapter). No db.prepare.
//
// GRAIN LAW: (poolId, provider, model) — the breaker's three-part key. The
// table itself is created by mysql/bootstrap.js's additive TABLES diff (the
// proxyFitness precedent), so no DDL lives here.

/**
 * Get breaker rows, optionally filtered by providerId.
 * @param {DbClient} db - mysql2 adapter (wrapMysqlPool)
 * @param {string|null} providerId
 * @returns {Promise<Array>}
 */
export async function getBreakerRows(db, providerId = null) {
  if (providerId === null || providerId === '') {
    return db.all('SELECT * FROM circuitBreakerKeys ORDER BY poolId');
  }
  return db.all('SELECT * FROM circuitBreakerKeys WHERE provider = ? OR provider = ? ORDER BY poolId', [providerId, '']);
}

/**
 * Upsert batched breaker rows in one transaction. Full-state writer.
 * @param {DbClient} db
 * @param {Array} rows
 */
export async function upsertBreakerBatch(db, rows) {
  if (!rows || rows.length === 0) return;
  await db.transaction(async (tx) => {
    for (const row of rows) {
      await tx.run(
        `INSERT INTO circuitBreakerKeys (
          poolId, provider, model, state, failureCount,
          lastFailureAt, cooldownUntil, retryAfterMs, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) AS new
        ON DUPLICATE KEY UPDATE
          state = new.state,
          failureCount = new.failureCount,
          lastFailureAt = new.lastFailureAt,
          cooldownUntil = new.cooldownUntil,
          retryAfterMs = new.retryAfterMs,
          updatedAt = new.updatedAt`,
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
 * Clear one key back to healthy (persisted resetKey).
 * @param {DbClient} db
 * @param {string} poolId
 * @param {string} providerId
 * @param {string} model
 */
export async function deleteBreakerRow(db, poolId, providerId, model = '') {
  await db.run('DELETE FROM circuitBreakerKeys WHERE poolId = ? AND provider = ? AND model = ?', [poolId, providerId, model ?? '']);
}

/**
 * Clear ALL rows for one pool (pool delete cascade).
 * @param {DbClient} db
 * @param {string} poolId
 */
export async function deleteBreakerRowsByPool(db, poolId) {
  await db.run('DELETE FROM circuitBreakerKeys WHERE poolId = ?', [poolId]);
}

/**
 * Clear the whole ledger (the breaker's clearAll()).
 * @param {DbClient} db
 */
export async function clearBreakerRows(db) {
  await db.run('DELETE FROM circuitBreakerKeys');
}
