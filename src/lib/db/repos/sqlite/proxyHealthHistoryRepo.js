// SQLite harbor for proxyPoolHealthHistory (migration 030, W2a).
//
// The append-only sibling of proxyFitness. proxyFitness is the snapshot (one
// row per (pool, provider), OVERWRITTEN every flush); this table is the series
// (one row per outcome, never updated). Both are written from the SAME batched
// flush (proxyFleet.flushNow) so the snapshot and the series can never
// disagree about how many outcomes happened.
//
// Adapter contract: { run, get, all, exec, transaction } — there is NO
// db.prepare. All statements ride one transaction so a 5000-row backfill after
// an outage is one atomic append, never a half-written series.

/** Append outcome rows. Each row: { poolId, providerId, verdict, latencyMs,
 *  egressIp, egressCountry, createdAt }. Rows missing poolId/verdict are
 *  skipped — an outcome that cannot name its pool or its verdict is not a
 *  fact about anything, and writing it would fabricate a series. */
export function appendHealthHistoryRows(db, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  let written = 0;
  db.transaction(() => {
    for (const r of rows) {
      if (!r || !r.poolId || !r.verdict) continue;
      db.run(
        `INSERT INTO proxyPoolHealthHistory(poolId, providerId, verdict, latencyMs, egressIp, egressCountry, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          r.poolId,
          r.providerId || "",
          r.verdict,
          Number.isFinite(Number(r.latencyMs)) && r.latencyMs !== null ? Math.round(Number(r.latencyMs)) : null,
          r.egressIp || null,
          r.egressCountry || null,
          r.createdAt || new Date().toISOString(),
        ]
      );
      written++;
    }
  });
  return written;
}

/** Retention (plan R4): drop outcomes older than `days`. Returns the count. */
export function pruneHealthHistory(db, days = 30) {
  const d = Number(days);
  if (!Number.isFinite(d) || d <= 0) return 0;
  const cutoff = new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();
  const res = db.run(`DELETE FROM proxyPoolHealthHistory WHERE createdAt < ?`, [cutoff]);
  return Number(res?.changes ?? 0);
}
