// MySQL twin for proxyPoolEgressHistory (migration 030, W2a).
// ASYNC harbor — see sqlite/proxyEgressHistoryRepo.js for the row laws.

export async function appendEgressHistoryRow(db, { poolId, ip, country = "", createdAt = null } = {}) {
  if (!poolId || !ip) return false;
  const last = await db.get(
    `SELECT ip FROM proxyPoolEgressHistory WHERE poolId = ? ORDER BY createdAt DESC, id DESC LIMIT 1`,
    [poolId]
  );
  if (last && last.ip === ip) return false;
  await db.run(
    `INSERT INTO proxyPoolEgressHistory(poolId, ip, country, createdAt) VALUES (?, ?, ?, ?)`,
    [poolId, ip, country || "", createdAt || new Date().toISOString()]
  );
  return true;
}

export async function pruneEgressHistory(db, days = 30) {
  const d = Number(days);
  if (!Number.isFinite(d) || d <= 0) return 0;
  const cutoff = new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();
  const res = await db.run(`DELETE FROM proxyPoolEgressHistory WHERE createdAt < ?`, [cutoff]);
  return Number(res?.changes ?? 0);
}
