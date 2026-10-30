/**
 * Migration 024: per-key access columns (restricted keys — d8c585fb's shape).
 *
 * The per-key access-control feature (d8c585fb) names two columns that the
 * schema never actually grew — `accessRestricted` and `accessAllow`. The
 * commit's diff is still the law for their SHAPE, so this migration simply
 * carries that law into the harbor it never reached:
 *
 *   accessRestricted — INTEGER DEFAULT 0. The restricted flag lives in its own
 *                      column ON PURPOSE: `keyAccessFromColumns()` reads it
 *                      first, so a corrupt or unparsable allow list can only
 *                      ever shrink what a restricted key may call (to nothing).
 *                      It can never repair itself into "unrestricted".
 *   accessAllow      — TEXT, a JSON array of allowed combos/models/providers.
 *                      NULL or "" both read as the empty allow list.
 *
 * Additive only. Both columns are declared in schema.js's TABLES mirror so
 * fresh installs get them through 001 and upgrades heal through auto-sync —
 * this migration exists for the version-gated path (and its backup) on
 * databases minted between 013 and 023.
 *
 * ADAPTER CONTRACT (the 013 lesson): the adapter exposes run/get/all/exec/
 * transaction — NO raw prepare(). Use db.all(...) + db.exec(...). The mysql
 * twin reaches the same shape through the additive TABLES diff in bootstrap.
 */

const COLUMNS = [
  ["accessRestricted", "INTEGER DEFAULT 0"], // 1 = restricted; 0/NULL = unrestricted
  ["accessAllow", "TEXT"], // JSON array; NULL = empty allow list
];

const up = (db) => {
  const cols = new Set(db.all(`PRAGMA table_info(apiKeys)`).map((c) => c.name));
  for (const [name, type] of COLUMNS) {
    if (!cols.has(name)) {
      db.exec(`ALTER TABLE apiKeys ADD COLUMN ${name} ${type}`);
    }
  }
};

const down = (db) => {
  // SQLite cannot DROP COLUMN on older versions; leaving the columns is the
  // documented rollback path (same as 002's W2/W3 columns and 013's ACL).
};

export default { version: 24, name: "key-access", up, down };
export { up, down };
