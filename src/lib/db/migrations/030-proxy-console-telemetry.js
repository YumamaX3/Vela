/**
 * Migration 030 — Proxy Console Separation, the telemetry seams (W2a).
 *
 * Sealed plan: plans/2026-11-04-proxy-console-separation.md §3.2.
 *
 * Three telemetry acts, each an expand-migrate-contract addition:
 *
 *  1. usageHistory.poolId — the request→pool wire. Before this column the
 *     usage ledger could not name the pool a request rode: only
 *     connectionId/keyId/reqId travelled on the row (plan §2 wound 1), so a
 *     per-pool usage page had nothing to read but emptiness. Additive TEXT,
 *     NULL default: NULL is "unattributed" — every pre-030 row, every
 *     local/no-proxy request — and the analytics seam EXCLUDES it by
 *     construction rather than folding it into a '' bucket that would claim
 *     those requests belonged to a pool named "". (This is the one place the
 *     PLAN's "DEFAULT ''" differs from the LANDED shape, deliberately: '' is
 *     the A5 convention only where '' participates in a dedupe identity; this
 *     column does not, and '' would fabricate a pool. See the CHANGELOG note.)
 *
 *  2. proxyPoolHealthHistory — the append-only outcome ledger. proxyFitness
 *     (migration 011) is an OVERWRITTEN snapshot: lastOutcomeAt / successEwma
 *     / latencyEwmaMs are current-state fields, so there has never been a
 *     health series to chart (plan §2 wound 2). One row per outcome, written
 *     from the fleet's fitness flush — the SAME batched path that feeds
 *     proxyFitness, so the two can never disagree about how many outcomes
 *     happened. Reads ride healthHistoryImpl's exact tier (≤3d, bucketed to
 *     the local minute); there is NO rollup tier yet, and the read reports
 *     that honestly instead of faking peaks.
 *
 *     RETENTION (plan R4): pruned to 30 days by the same purge path that
 *     prunes usageHistory (purgeOldUsage), by pruneUsage's sweep, and by
 *     migration 031's cleanup on upgrade. The 30d window sits above the
 *     read tier's practical span, so the chart never shows a cliff the user
 *     cannot explain.
 *
 *  3. proxyPoolEgressHistory — the persisted egress IP ledger (plan §2 wound
 *     4: today's poolGeo ring is in-memory, max 8, erased by a restart). The
 *     append-only twin of the ring, written ONLY by the egress probe — the one
 *     place a fresh country is learned (proxyFleet's setPoolGeo call carries an
 *     IP with no country and is deliberately not a writer).
 *
 * Twin parity: every column + index here is declared in schema.js's TABLES, so
 * fresh installs receive them through 001's mirror and the MariaDB harbor
 * heals through mysql/bootstrap.js's information_schema diff. This migration
 * exists for the version-gated SQLite path (and its pre-change backup).
 *
 * ADAPTER CONTRACT (the 013 lesson): the adapter exposes run/get/all/exec/
 * transaction — NO raw prepare(). Column presence is probed through the
 * adapter itself (PRAGMA on SQLite), so re-application is idempotent.
 */

const HEALTH_TABLE = "proxyPoolHealthHistory";
const EGRESS_TABLE = "proxyPoolEgressHistory";

/** Retention note, stamped where an operator will look for it. */
export const HEALTH_HISTORY_RETENTION_DAYS = 30;

function hasColumn(db, table, column) {
  try {
    return (db.all(`PRAGMA table_info(${table})`) || []).some((c) => c.name === column);
  } catch {
    return false;
  }
}

const up = (db) => {
  // ── 1 · usageHistory.poolId ───────────────────────────────────────────────
  if (!hasColumn(db, "usageHistory", "poolId")) {
    db.exec(`ALTER TABLE usageHistory ADD COLUMN poolId TEXT`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_uh_poolId ON usageHistory(poolId)`);
  // The analytics scan is "poolId + window" — the composite keeps the per-pool
  // sum on the index instead of a table walk per bucket.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_uh_pool_ts ON usageHistory(poolId, timestamp)`);

  // ── 2 · proxyPoolHealthHistory — append-only outcomes ─────────────────────
  // `id INTEGER PRIMARY KEY AUTOINCREMENT` is the append key (BIGINT
  // AUTO_INCREMENT on the twin). verdict is the normalized slug the fleet's
  // own series uses ('ok' | 'fail' — never a free-form error string); latencyMs
  // is NULL when the outcome carried no measurement (recordOutcome's own
  // latency gate), never 0-faked. egressIp/egressCountry copy the fitness row's
  // stamp at outcome time so the health lens can answer "did this pool fail on
  // the IP it was egressing from".
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${HEALTH_TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      poolId TEXT NOT NULL,
      providerId TEXT NOT NULL DEFAULT '',
      verdict TEXT NOT NULL,
      latencyMs INTEGER,
      egressIp TEXT,
      egressCountry TEXT,
      createdAt TEXT NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pphh_pool_ts ON ${HEALTH_TABLE}(poolId, createdAt)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pphh_ts ON ${HEALTH_TABLE}(createdAt)`);

  // ── 3 · proxyPoolEgressHistory — append-only egress IPs ───────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${EGRESS_TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      poolId TEXT NOT NULL,
      ip TEXT NOT NULL,
      country TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ppeh_pool_ts ON ${EGRESS_TABLE}(poolId, createdAt)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ppeh_ts ON ${EGRESS_TABLE}(createdAt)`);

  // ── retention cleanup on upgrade (plan R4) ────────────────────────────────
  // A one-time sweep at the ALTER's own moment: an operator upgrading across
  // this version should never inherit an unbounded pair of tables from an
  // earlier partial landing.
  const cutoff = new Date(Date.now() - HEALTH_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  try { db.run(`DELETE FROM ${HEALTH_TABLE} WHERE createdAt < ?`, [cutoff]); } catch { /* fresh table */ }
  try { db.run(`DELETE FROM ${EGRESS_TABLE} WHERE createdAt < ?`, [cutoff]); } catch { /* fresh table */ }
};

const down = (db) => {
  // SQLite cannot DROP COLUMN on older versions; leaving poolId in place is the
  // documented rollback path (same as 002/013/024/025). NULL/absent-pool rows
  // read exactly as they did before the ALTER, so a rollback changes no
  // behavior. The two new tables are additive — dropping them is safe and
  // leaves the fleet's own proxyFitness snapshot untouched.
  db.exec(`DROP TABLE IF EXISTS ${EGRESS_TABLE}`);
  db.exec(`DROP TABLE IF EXISTS ${HEALTH_TABLE}`);
};

export default { version: 30, name: "proxy-console-telemetry-seams", up, down };
export { up, down };
