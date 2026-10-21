/**
 * Migration 021: the credential vault's sealed columns.
 * (Ported from 9router-go `internal/db/vault.go` — envelope encryption for
 *  provider credentials, F-5.)
 *
 * WHY THESE COLUMNS EXIST: until now every provider credential — apiKey,
 * accessToken, refreshToken, idToken, clientSecret — lived in the plaintext
 * `data` JSON blob. Anyone who could copy data.sqlite (or its backup, or its
 * WAL sidecar) held every upstream account in the clear. The vault does not
 * invent a new store; it lifts those fields OUT of `data` and leaves an
 * AES-256-GCM ciphertext behind, wrapped by a random per-row DEK, itself
 * wrapped by the operator's master key.
 *
 * WHY SIX COLUMNS, NOT ONE: three slots (secret / token / refresh) are sealed
 * independently, so a token refresh rewrites only the token pair. A single
 * blob would force a decrypt/merge/re-encrypt of every credential on every
 * refresh — and a bad row would take the others with it.
 *
 * The columns default to '' rather than NULL so a plaintext install (no
 * VELA_MASTER_KEY) reads exactly as before: empty wrappedDEK means "never
 * sealed", and Open returns the ciphertext unchanged.
 *
 * Pure addition — the inverse drops the six columns.
 */

const TABLE = "providerConnections";
const COLUMNS = [
  "secretWrappedDEK",
  "secretCiphertext",
  "tokenWrappedDEK",
  "tokenCiphertext",
  "refreshWrappedDEK",
  "refreshCiphertext",
];

const up = (db) => {
  // PRAGMA-guarded so a database that already received the columns through a
  // restored schema (TABLES-based restore) does not fail the migration.
  const existing = new Set(db.all(`PRAGMA table_info(${TABLE})`).map((r) => r.name));
  for (const name of COLUMNS) {
    if (existing.has(name)) continue;
    db.exec(`ALTER TABLE ${TABLE} ADD COLUMN ${name} TEXT NOT NULL DEFAULT ''`);
  }
};

const down = () => {
  // Deliberately a no-op: dropping the sealed columns would destroy the only
  // copy of every credential, and SQLite before 3.35 cannot DROP COLUMN at
  // all. A rollback that loses secrets is not a rollback.
};

const migration = { version: 21, name: "credential-vault", up, down };
export default migration;
export { up, down };
