/**
 * Migration 025: five-dimension per-key rate limits.
 *
 * Wave-1 shipped exactly ONE rate dimension (rateLimitRpm, migration 002) and
 * enforced it in a single in-memory 60s window. Pro's key slots carry five —
 * requests/tokens per minute, requests per hour, requests per day, and the
 * count of in-flight requests — and Vela ports that shape natively:
 *
 *   rateLimitTpm           — tokens per minute (INTEGER, NULL = unlimited)
 *   rateLimitRph           — requests per hour (INTEGER, NULL = unlimited)
 *   rateLimitRpd           — requests per day  (INTEGER, NULL = unlimited)
 *   maxConcurrentRequests  — in-flight requests per key (INTEGER, NULL = unlimited)
 *
 * Every column is nullable with NO default: NULL is the additive default and
 * reads as "this dimension is off" — the gate fails open on a missing ceiling,
 * so an upgraded database behaves exactly as it did the moment before the
 * ALTER. 0 is rejected by validation (a ceiling of zero would deny every
 * request forever) and, if it ever slipped in, the gate treats it as off too.
 *
 * Additive only. All four columns are declared in schema.js's TABLES mirror so
 * fresh installs receive them through 001 and upgrades heal through sqlite
 * auto-sync / the mysql information_schema diff — this migration exists for
 * the version-gated path (and its backup).
 *
 * ADAPTER CONTRACT (the 013 lesson): the adapter exposes run/get/all/exec/
 * transaction — NO raw prepare(). Use db.all(...) + db.exec(...). The mysql
 * twin reaches the same shape through the additive TABLES diff in bootstrap.
 */

const COLUMNS = [
  ["rateLimitTpm", "INTEGER"], // NULL = unlimited
  ["rateLimitRph", "INTEGER"], // NULL = unlimited
  ["rateLimitRpd", "INTEGER"], // NULL = unlimited
  ["maxConcurrentRequests", "INTEGER"], // NULL = unlimited
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
  // documented rollback path (same as 002/013/024). They are NULL everywhere
  // after an upgrade, so a rollback changes no behavior.
};

export default { version: 25, name: "key-rate-dimensions", up, down };
export { up, down };
