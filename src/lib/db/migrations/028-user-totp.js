/**
 * Migration 028: the users table's second lock — TOTP + backup codes.
 *
 * src/lib/auth/totp.js (RFC 6238 arithmetic on node:crypto) already stands;
 * this migration gives it somewhere to live. Three additive nullable columns:
 *
 *   totpSecret   — TEXT, NULL = no enrollment. Base32 (RFC 4648) secret, the
 *                  same string the otpauth:// URI carries, so an authenticator
 *                  app and this table never disagree about what the secret is.
 *   totpEnabled  — INTEGER (0/1), NULL = not enrolled. Enrollment is a
 *                  two-phase act: the secret is minted and stored first, the
 *                  flag flips only after the operator proves one valid code —
 *                  a half-enrolled row (secret, no flag) is inert, by design.
 *   backupCodes  — TEXT (JSON array of SHA-256 hex digests), NULL = none.
 *                  Codes are high-entropy (80-bit) random values, so they are
 *                  hashed with a single SHA-256, not a slow KDF — the second
 *                  login step must stay fast, and an 80-bit brute force is not
 *                  the threat model. Shown ONCE at enrollment.
 *
 * Additive only: a row written before this migration reads as "no 2FA", which
 * is exactly the behavior an un-enrolled install already has — the login path
 * therefore needs no backfill and no branch on schema version.
 *
 * Both columns are declared in schema.js's TABLES mirror so fresh installs
 * receive them through the 001 TABLES path and upgrades heal through sqlite
 * auto-sync / the mysql information_schema diff; this migration exists for
 * the version-gated path (and its pre-change backup).
 *
 * ADAPTER CONTRACT (the 013 lesson): run/get/all/exec only — no raw prepare().
 */

const USERS = "authUsers";

const COLUMNS = [
  ["totpSecret", "TEXT"],   // base32 secret; NULL = no enrollment
  ["totpEnabled", "INTEGER"], // 0/1; NULL = not enrolled
  ["backupCodes", "TEXT"],  // JSON array of sha256 hex digests; NULL = none
];

const up = (db) => {
  // Idempotent by construction: a column that already exists is skipped, so
  // a re-run (or a fresh install that received the columns through the 001
  // TABLES path) is a no-op rather than a duplicate-column error.
  const cols = new Set(db.all(`PRAGMA table_info(${USERS})`).map((c) => c.name));
  for (const [name, type] of COLUMNS) {
    if (!cols.has(name)) {
      db.exec(`ALTER TABLE ${USERS} ADD COLUMN ${name} ${type}`);
    }
  }
};

const down = (db) => {
  // SQLite cannot DROP COLUMN on older versions; leaving the columns is the
  // documented rollback path (same as 002/013/024/025/026/027). They are NULL
  // everywhere after an upgrade, so a rollback changes no behavior.
};

const migration = { version: 28, name: "user-totp", up, down };
export default migration;
export { up, down };
