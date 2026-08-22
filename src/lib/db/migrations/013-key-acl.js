/**
 * Migration 013: key ACL columns (Per-key ACL — v0.9.17)
 *
 * Extends the key-governance model with the full tri-state access-control
 * surface (VansRouter §1 pattern, seam-native):
 *   allowedKinds     — JSON array of service kinds: "llm","embedding","image",
 *                      "tts","stt","web" ... NULL = all kinds allowed
 *   allowedProviders — JSON array of provider IDs/aliases; NULL = all providers
 *   allowedCombos    — JSON array of combo names (without "combo/" prefix)
 *
 * All three follow the tri-state semantics of allowedModels:
 *   NULL             → unrestricted
 *   []               → deny everything of that dimension
 *   ["x","y"]        → whitelist
 *
 * Uses ALTER TABLE ADD COLUMN with PRAGMA table_info guard so both fresh
 * installs (001's TABLES mirror) and v2 upgrades survive.
 *
 * ADAPTER CONTRACT (learned the hard way, 0.9.19 boot storm): the adapter
 * interface exposes run/get/all/exec/transaction — NO raw prepare(). On the
 * mysql/mirror harbors the adapter is the MariaDB twin (or the mirror's
 * decorated adapter); `db.prepare(...)` throws "a.prepare is not a function"
 * and kills every DB-backed API at boot. Use db.all(...) + db.exec(...)
 * exactly like migration 002.
 */

const COLUMNS = [
  ["allowedKinds", "TEXT"], // JSON array; NULL = unrestricted
  ["allowedProviders", "TEXT"], // JSON array; NULL = unrestricted
  ["allowedCombos", "TEXT"], // JSON array (combo names); NULL = unrestricted
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
  // documented rollback path (same as 002's W2/W3 columns).
  // no-op
};

export default { version: 13, name: "key-acl", up, down };
export { up, down };
