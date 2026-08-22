// SQLite harbor for proxyFitness table
// All operations are sync — no await needed at the call site.
//
// The adapter contract is { run, get, all, exec, transaction, close, raw } —
// there is NO db.prepare. db.transaction(fn) invokes fn() immediately inside a
// SAVEPOINT and returns fn's result. (The old db.prepare()/tx(rows) shape here
// threw "db.prepare is not a function" at boot and broke proxy-fleet fitness.)

/**
 * Get fitness rows, optionally filtered by providerId
 * @param {DbClient} db - sqlite3 database client
 * @param {string|null} providerId - optional filter, null returns all rows
 * @returns {Array} array of fitness rows
 */
export function getFitnessRows(db, providerId = null) {
  if (providerId === null || providerId === '') {
    return db.all('SELECT * FROM proxyFitness ORDER BY poolId');
  }
  return db.all('SELECT * FROM proxyFitness WHERE provider = ? OR provider = ? ORDER BY poolId', [providerId, '']);
}

/**
 * Upsert batched fitness rows in a single transaction
 * Uses ON CONFLICT DO UPDATE for idempotent updates
 * @param {DbClient} db - sqlite3 database client
 * @param {Array} rows - array of {poolId, provider, successCount, failureCount, successEwma, latencyEwmaMs, lastOutcomeAt, unfit, unfitReason, unfitUntil, egressIp, egressCountry, updatedAt}
 */
export function upsertFitnessBatch(db, rows) {
  if (!rows || rows.length === 0) return;

  db.transaction(() => {
    for (const row of rows) {
      db.run(
        `INSERT INTO proxyFitness (
          poolId, provider, successCount, failureCount, successEwma,
          latencyEwmaMs, lastOutcomeAt, unfit, unfitReason, unfitUntil,
          egressIp, egressCountry, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(poolId, provider) DO UPDATE SET
          successCount = excluded.successCount,
          failureCount = excluded.failureCount,
          successEwma = excluded.successEwma,
          latencyEwmaMs = excluded.latencyEwmaMs,
          lastOutcomeAt = excluded.lastOutcomeAt,
          unfit = excluded.unfit,
          unfitReason = excluded.unfitReason,
          unfitUntil = excluded.unfitUntil,
          egressIp = excluded.egressIp,
          egressCountry = excluded.egressCountry,
          updatedAt = excluded.updatedAt`,
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
 * @param {DbClient} db - sqlite3 database client
 * @param {string} poolId - pool ID to reset
 * @param {string|null} providerId - optional provider filter, null resets all providers for this pool
 */
export function resetFitness(db, poolId, providerId = null) {
  if (providerId === null || providerId === '') {
    db.run('DELETE FROM proxyFitness WHERE poolId = ?', [poolId]);
  } else {
    db.run('DELETE FROM proxyFitness WHERE poolId = ? AND provider = ?', [poolId, providerId]);
  }
}
