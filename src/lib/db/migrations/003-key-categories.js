// Key categories — free-form labels the Star assigns to keys (friend / hermes /
// others / whatever they forge). Additive TEXT column + index; keys without a
// category stay NULL and render under "Uncategorized" in the dashboard.
const APIKEY_COLUMNS = [
  ["category", "TEXT"],
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

export default {
  version: 3,
  name: "key-categories",
  up(db) {
    addColumns(db, "apiKeys", APIKEY_COLUMNS);
    // Partial index: only categorized rows (SQLite skips NULL entries), so the
    // index stays tiny and the "Uncategorized" scan never touches it.
    db.exec("CREATE INDEX IF NOT EXISTS idx_ak_category ON apiKeys(category) WHERE category IS NOT NULL");
  },
};
