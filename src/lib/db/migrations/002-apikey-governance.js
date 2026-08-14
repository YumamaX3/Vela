// API key governance schema (plan: plans/vela-key-governance.md).
// Adds ALL governance waves' columns at once (W1 core, W2 lifecycle, W3 governance),
// the UNIQUE keyHash index (auto-sync strips UNIQUE from additive ADD COLUMN),
// tombstones every legacy sk- row (plaintext wiped), and scrubs plaintext keys
// from usageHistory. PRAGMA-guarded so fresh installs (which already receive the
// new columns from 001's TABLES mirror) and v1 upgrades both survive.
const APIKEY_COLUMNS = [
  // --- W1 core ---
  ["keyVersion", "TEXT"],
  ["keyHash", "TEXT"],
  ["keyPrefix", "TEXT"],
  ["description", "TEXT"],
  ["allowedModels", "TEXT"], // JSON array; NULL = unrestricted
  ["isInternal", "INTEGER DEFAULT 0"],
  ["deletedAt", "TEXT"],
  // --- W2 lifecycle ---
  ["expiresAt", "TEXT"],
  ["lastUsedAt", "TEXT"],
  ["rotatedFrom", "TEXT"],
  ["rotationPrevHash", "TEXT"],
  ["rotationPrevKeyId", "TEXT"],
  ["rotationGraceUntil", "TEXT"],
  // --- W3 governance ---
  ["tokenBudgetDaily", "INTEGER"],
  ["spendCapDailyCents", "INTEGER"],
  ["budgetScope", "TEXT"],
  ["rateLimitRpm", "INTEGER"],
  ["ipAllowlist", "TEXT"], // JSON array of CIDRs
];

const USAGE_COLUMNS = [
  ["keyId", "TEXT"],
  ["keyPrefix", "TEXT"],
];

function existingColumns(db, table) {
  // Adapter interface exposes run/get/all/exec/transaction — no raw prepare().
  return new Set(db.all(`PRAGMA table_info(${table})`).map((r) => r.name));
}

function addColumns(db, table, columns) {
  const have = existingColumns(db, table);
  for (const [col, def] of columns) {
    if (!have.has(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  }
}

// Tombstone legacy rows + scrub plaintext usage. Exported so migrate.js can
// re-run the same closure AFTER the legacy JSON import (which runs after
// versioned migrations and would otherwise re-insert plaintext sk- keys).
export function tombstoneLegacyKeys(db) {
  db.exec(`
    UPDATE apiKeys
    SET isActive = 0,
        key = 'revoked-' || id,
        name = COALESCE(name, 'Key') || ' [legacy]',
        keyVersion = 'legacy'
    WHERE keyHash IS NULL AND key IS NOT NULL AND key != '' AND key NOT LIKE 'revoked-%'
  `);
}

export function scrubPlaintextUsage(db) {
  db.exec(`UPDATE usageHistory SET apiKey = NULL WHERE apiKey IS NOT NULL`);
}

export default {
  version: 2,
  name: "apikey-governance",
  up(db) {
    addColumns(db, "apiKeys", APIKEY_COLUMNS);
    addColumns(db, "usageHistory", USAGE_COLUMNS);
    // UNIQUE index lives here (not just in TABLES) because auto-sync strips
    // UNIQUE from additive columns on the upgrade path. SQLite treats multiple
    // NULLs as distinct, so soft-revoked rows (keyHash NULL) stay safe.
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS uq_ak_key_hash ON apiKeys(keyHash)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_uh_keyId ON usageHistory(keyId)");
    tombstoneLegacyKeys(db);
    scrubPlaintextUsage(db);
  },
};
