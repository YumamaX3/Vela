// MySQL twin for proxyFitness table
// All operations are sync — no await needed at the call site (bound by facade)

/**
 * Get fitness rows, optionally filtered by providerId
 * @param {DbClient} db - mysql2 database client
 * @param {string|null} providerId - optional filter, null returns all rows
 * @returns {Array} array of fitness rows
 */
export function getFitnessRows(db, providerId = null) {
  if (providerId === null || providerId === '') {
    return db.query('SELECT * FROM proxyFitness ORDER BY poolId');
  }
  return db.query('SELECT * FROM proxyFitness WHERE provider = ? OR provider = ? ORDER BY poolId', [providerId, '']);
}

/**
 * Upsert batched fitness rows in a single transaction
 * Uses ON DUPLICATE KEY UPDATE for idempotent updates
 * @param {DbClient} db - mysql2 database client
 * @param {Array} rows - array of {poolId, provider, successCount, failureCount, successEwma, latencyEwmaMs, lastOutcomeAt, unfit, unfitReason, unfitUntil, egressIp, egressCountry, updatedAt}
 */
export function upsertFitnessBatch(db, rows) {
  const tx = db.transaction((data) => {
    const stmt = db.prepare(`
      INSERT INTO proxyFitness (
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
        updatedAt = VALUES(updatedAt)
    `);

    for (const row of data) {
      stmt.execute([
        row.poolId, row.provider, row.successCount, row.failureCount, row.successEwma,
        row.latencyEwmaMs, row.lastOutcomeAt, row.unfit, row.unfitReason, row.unfitUntil,
        row.egressIp, row.egressCountry, row.updatedAt
      ]);
    }
  });

  tx(rows);
}

/**
 * Reset fitness for a pool (optionally filtered by provider)
 * @param {DbClient} db - mysql2 database client
 * @param {string} poolId - pool ID to reset
 * @param {string|null} providerId - optional provider filter, null resets all providers for this pool
 */
export function resetFitness(db, poolId, providerId = null) {
  if (providerId === null || providerId === '') {
    db.query('DELETE FROM proxyFitness WHERE poolId = ?', [poolId]);
  } else {
    db.query('DELETE FROM proxyFitness WHERE poolId = ? AND provider = ?', [poolId, providerId]);
  }
}
