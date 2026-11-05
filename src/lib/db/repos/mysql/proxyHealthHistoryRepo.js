// MySQL twin for proxyPoolHealthHistory (migration 030, W2a).
//
// Mirrors the sqlite harbor's contract but is ASYNC — the mysql2 adapter is
// network-bound and its shape is { run, get, all, exec, transaction }, all
// promise-returning, with transaction(fn) invoking fn(tx) inside a
// connection-bound transaction.
//
// Row laws are identical to the SQLite harbor: a row missing poolId/verdict is
// not a fact and is skipped; latencyMs rides `null` when unmeasured (never 0).

export async function appendHealthHistoryRows(db, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  let written = 0;
  await db.transaction(async (tx) => {
    for (const r of rows) {
      if (!r || !r.poolId || !r.verdict) continue;
      await tx.run(
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

export async function pruneHealthHistory(db, days = 30) {
  const d = Number(days);
  if (!Number.isFinite(d) || d <= 0) return 0;
  const cutoff = new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();
  const res = await db.run(`DELETE FROM proxyPoolHealthHistory WHERE createdAt < ?`, [cutoff]);
  return Number(res?.changes ?? 0);
}
