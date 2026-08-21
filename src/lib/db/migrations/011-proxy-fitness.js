/**
 * Migration 011: proxyFitness table
 *
 * Creates the fitness persistence layer for proxy fleet intelligence.
 * PK = (poolId, provider) — per-(pool, provider) granularity per decree C14.
 * unfitUntil TTL enables temporary geo-blocks that self-heal.
 * egressCountry seeded by geo-probes and stamped on country_blocked events.
 */

const up = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS proxyFitness (
      poolId TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT '',
      successCount INTEGER NOT NULL DEFAULT 0,
      failureCount INTEGER NOT NULL DEFAULT 0,
      successEwma REAL NOT NULL DEFAULT 0.5,
      latencyEwmaMs INTEGER NOT NULL DEFAULT 0,
      lastOutcomeAt TEXT,
      unfit INTEGER NOT NULL DEFAULT 0,
      unfitReason TEXT,
      unfitUntil TEXT,
      egressIp TEXT,
      egressCountry TEXT,
      updatedAt TEXT NOT NULL,
      PRIMARY KEY (poolId, provider)
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_pf_pool ON proxyFitness(poolId)`);
};

const down = (db) => {
  db.exec('DROP TABLE IF EXISTS proxyFitness');
};

// Export named functions AND default object matching migration contract (001-initial pattern)
export default { version: 11, name: 'proxy-fitness', up, down };
export { up, down };
