// MySQL twin for proxyFitness table
// Mirrors the sqlite harbor's contract but is ASYNC — the mysql2 adapter is
// network-bound and its shape is { run, get, all, exec, transaction, close,
// raw }, all promise-returning, with transaction(fn) invoking fn(tx) inside a
// connection-bound transaction (tx is a conn-scoped adapter). There is NO
// db.query / db.prepare / stmt.execute here — the old shape threw at call time.

/**
 * Get fitness rows, optionally filtered by providerId
 * @param {DbClient} db - mysql2 adapter (wrapMysqlPool)
 * @param {string|null} providerId - optional filter, null returns all rows
 * @returns {Promise<Array>} array of fitness rows
 */
export async function getFitnessRows(db, providerId = null) {
  if (providerId === null || providerId === '') {
    return db.all('SELECT * FROM proxyFitness ORDER BY poolId');
  }
  return db.all('SELECT * FROM proxyFitness WHERE provider = ? OR provider = ? ORDER BY poolId', [providerId, '']);
}

/**
 * Upsert batched fitness rows in a single transaction
 * Uses ON DUPLICATE KEY UPDATE for idempotent updates
 * @param {DbClient} db - mysql2 adapter (wrapMysqlPool)
 * @param {Array} rows - array of {poolId, provider, successCount, failureCount, successEwma, latencyEwmaMs, lastOutcomeAt, unfit, unfitReason, unfitUntil, egressIp, egressCountry, updatedAt}
 */
export async function upsertFitnessBatch(db, rows) {
  if (!rows || rows.length === 0) return;

  await db.transaction(async (tx) => {
    for (const row of rows) {
      await tx.run(
        `INSERT INTO proxyFitness (
          poolId, provider, successCount, failureCount, successEwma,
          latencyEwmaMs, lastOutcomeAt, unfit, unfitReason, unfitUntil,
          egressIp, egressCountry, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          successCount = VALUES(successCount),
          failureCount = VALUES(failureCount),
          successEwma = VALUES(successEwma),
          latencyEwmaMs = VALUES(latencyEwmaMs),
          lastOutcomeAt = VALUES(lastOutcomeAt),
          unfit = VALUES(unfit),
          unfitReason = VALUES(unfitReason),
          unfitUntil = VALUES(unfitUntil),
          egressIp = VALUES(egressIp),
          egressCountry = VALUES(egressCountry),
          updatedAt = VALUES(updatedAt)`,
        [
          row.poolId, row.provider, row.successCount, row.failureCount, row.successEwma,
          row.latencyEwmaMs, row.lastOutcomeAt, row.unfit, row.unfitReason, row.unfitUntil,
          row.egressIp, row.egressCountry, row.updatedAt,
        ]
      );
    }
  });
}

/**
 * Reset fitness for a pool (optionally filtered by provider)
 * @param {DbClient} db - mysql2 adapter (wrapMysqlPool)
 * @param {string} poolId - pool ID to reset
 * @param {string|null} providerId - optional provider filter, null resets all providers for this pool
 */
export async function resetFitness(db, poolId, providerId = null) {
  if (providerId === null || providerId === '') {
    await db.run('DELETE FROM proxyFitness WHERE poolId = ?', [poolId]);
  } else {
    await db.run('DELETE FROM proxyFitness WHERE poolId = ? AND provider = ?', [poolId, providerId]);
  }
}
