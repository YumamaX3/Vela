// SQLite harbor for proxyPoolEgressHistory (migration 030, W2a).
//
// The persisted twin of poolGeo's in-memory ring (max 8, TTL 1h, erased by a
// restart). Written ONLY by the egress probe — the one place in the system a
// fresh country is learned (proxyFleet's setPoolGeo call carries an IP with no
// country and deliberately does not write here).
//
// Adapter contract: { run, get, all, exec, transaction } — no db.prepare.

/** Append one observed egress sample. Deduped against the pool's LAST known
 *  IP: re-probing the same pool through the same egress every 30 minutes is
 *  one fact observed twice, not two facts. Returns true when a row landed. */
export function appendEgressHistoryRow(db, { poolId, ip, country = "", createdAt = null } = {}) {
  if (!poolId || !ip) return false;
  const last = db.get(
    `SELECT ip FROM proxyPoolEgressHistory WHERE poolId = ? ORDER BY createdAt DESC, id DESC LIMIT 1`,
    [poolId]
  );
  if (last && last.ip === ip) return false;
  db.run(
    `INSERT INTO proxyPoolEgressHistory(poolId, ip, country, createdAt) VALUES (?, ?, ?, ?)`,
    [poolId, ip, country || "", createdAt || new Date().toISOString()]
  );
  return true;
}

/** Retention (plan R4): drop egress samples older than `days`. */
export function pruneEgressHistory(db, days = 30) {
  const d = Number(days);
  if (!Number.isFinite(d) || d <= 0) return 0;
  const cutoff = new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();
  const res = db.run(`DELETE FROM proxyPoolEgressHistory WHERE createdAt < ?`, [cutoff]);
  return Number(res?.changes ?? 0);
}
