/**
 * Migration 012: fallbackRules table
 *
 * Creates operator-configurable fallback rules DB for combo expansion.
 * Allows operators to define "when model X returns 429/503, try Y before Z"
 * without editing hardcoded combo.js logic.
 *
 * Schema (per spec):
 *   id INTEGER PK AUTOINCREMENT
 *   sourceModel TEXT NOT NULL        -- "provider/model" or "model" (glob allowed)
 *   targetModel TEXT NOT NULL        -- "provider/model"
 *   priority INTEGER DEFAULT 100     -- lower runs first
 *   triggerOnStatus TEXT DEFAULT '429,503'  -- comma-separated HTTP statuses
 *   maxRetries INTEGER DEFAULT 1
 *   isActive INTEGER DEFAULT 1
 *   createdAt / updatedAt TEXT
 */

const up = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fallbackRules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sourceModel TEXT NOT NULL,
      targetModel TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 100,
      triggerOnStatus TEXT NOT NULL DEFAULT '429,503',
      maxRetries INTEGER NOT NULL DEFAULT 1,
      isActive INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);
  
  db.exec(`CREATE INDEX IF NOT EXISTS idx_fr_source ON fallbackRules(sourceModel)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_fr_active ON fallbackRules(isActive)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_fr_priority ON fallbackRules(priority)`);
};

const down = (db) => {
  db.exec('DROP TABLE IF EXISTS fallbackRules');
};

// Export named functions AND default object matching migration contract
export default { version: 12, name: 'fallback-rules', up, down };
export { up, down };
