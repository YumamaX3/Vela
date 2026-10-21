/**
 * Migration 022: the semantic cache's disk shelf.
 * (Ported from 9router-go `semanticCacheEntries` — the persistent half of
 *  `internal/semanticcache`.)
 *
 * The cache's hot path is an in-memory LRU; this table is what survives a
 * restart, so a gateway that boots mid-day does not re-buy answers it already
 * holds. It is SQLITE-ONLY by the same law as `outbox`: a cache is a local
 * artifact of this process, not replicated state, so it is deliberately absent
 * from TABLES (which drives the MariaDB twin bootstrap).
 *
 * storedAtMs is the range-queried integer (TTL expiry); storedAt is the
 * human-facing ISO stamp. responseBody carries the complete client-format body,
 * never a stream frame — streams are not cached by construction.
 */

const TABLE = "semanticCacheEntries";

const up = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      key TEXT PRIMARY KEY,
      model TEXT,
      responseBody TEXT NOT NULL,
      contentType TEXT NOT NULL DEFAULT 'application/json',
      storedAt TEXT NOT NULL,
      storedAtMs INTEGER NOT NULL,
      hitCount INTEGER NOT NULL DEFAULT 0,
      tokensSaved INTEGER NOT NULL DEFAULT 0
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sce_stored ON ${TABLE}(storedAtMs)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sce_model ON ${TABLE}(model)`);
};

const down = (db) => {
  db.exec(`DROP INDEX IF EXISTS idx_sce_stored`);
  db.exec(`DROP INDEX IF EXISTS idx_sce_model`);
  db.exec(`DROP TABLE IF EXISTS ${TABLE}`);
};

const migration = { version: 22, name: "semantic-cache", up, down };
export default migration;
export { up, down };
