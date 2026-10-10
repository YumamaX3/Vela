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
 * Upsert ONLY the breaker-owned columns of proxyFitness.
 *
 * Why this exists beside upsertFitnessBatch: the breaker's flush row carries
 * six fields (poolId, provider, unfit, unfitReason, unfitUntil, updatedAt).
 * Routing it through the 13-column batch binds eight `undefined` values into
 * NOT NULL columns — node:sqlite throws "cannot be bound to parameter 3",
 * better-sqlite3 throws "NOT NULL constraint failed", and mysql2's escaper
 * coerces `undefined` to NULL (which would poison computeScore into NaN and
 * pin the weighted draw to the last pool). The batch wraps its loop in one
 * transaction, so a single bad row rolled back every row and the breaker's
 * cooldown never reached the DB at all.
 *
 * This writer names exactly the four columns the breaker owns, so no binding
 * semantic can supply a value the breaker did not. A sibling fitness row's
 * counters are untouched by construction.
 *
 * @param {DbClient} db - sqlite3 database client
 * @param {Array} rows - array of {poolId, provider, unfit, unfitReason, unfitUntil, updatedAt}
 */
export function upsertFitnessUnfit(db, rows) {
  if (!rows || rows.length === 0) return;
  db.transaction(() => {
    for (const row of rows) {
      db.run(
        `INSERT INTO proxyFitness (
          poolId, provider, successCount, failureCount, successEwma,
          latencyEwmaMs, lastOutcomeAt, unfit, unfitReason, unfitUntil,
          egressIp, egressCountry, updatedAt
        ) VALUES (?, ?, 0, 0, 0, 0, NULL, ?, ?, ?, '', '', ?)
        ON CONFLICT(poolId, provider) DO UPDATE SET
          unfit = excluded.unfit,
          unfitReason = excluded.unfitReason,
          unfitUntil = excluded.unfitUntil,
          updatedAt = excluded.updatedAt`,
        [
          row.poolId, row.provider,
          row.unfit, row.unfitReason, row.unfitUntil, row.updatedAt,
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

/**
 * Clear fitness rows across EVERY pool (optionally one provider across all
 * pools). Lives here rather than in a caller because the Storage Covenant's
 * census puts every persistence statement inside the harbour — proxyFleet.js
 * used to run this DELETE itself, outside src/lib/db/.
 */
export function clearAllFitnessRows(db, providerId = null) {
  if (providerId === null || providerId === '') {
    db.run('DELETE FROM proxyFitness');
  } else {
    db.run('DELETE FROM proxyFitness WHERE provider = ?', [providerId]);
  }
}
