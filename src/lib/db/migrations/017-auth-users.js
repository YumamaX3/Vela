/**
 * Migration 017: auth users — the credential store.
 * (The Star's decree of 2026-09-26: one operator, username + password.)
 *
 * Before this wave the dashboard had exactly one credential shape — a bcrypt
 * hash parked in `settings.password`, a single JSON document with no unique
 * constraint and no per-field identity. It could hold a password; it could NOT
 * hold a username, and it had nowhere to stamp a lastLoginAt or a disabledAt.
 * This migration gives the operator a row of their own.
 *
 * WHY NEW A TABLE AND NOT AN ALTER: this is a pure addition, so its inverse is
 * actually expressible — `down` drops it. The house rule is "additive-only
 * rollback where the inverse is inexpressible", not "always a no-op"; this one
 * can be written, so it is.
 *
 * ONE USER BY DESIGN: no role column, no admin flag, no permission tier. The
 * Star asked for a single operator and the schema honours that literally —
 * `username` is UNIQUE so the table cannot silently grow a second seat through
 * a racing insert, and nothing else declares an occupant count.
 *
 * `username` carries its UNIQUE through a NAMED INDEX (uq_auth_users_username)
 * rather than an inline UNIQUE, matching apiKeys.keyHash: the additive auto-sync
 * strips inline UNIQUE, so the index is the self-healing declaration and this
 * migration issues it after the table.
 *
 * ADAPTER CONTRACT: portable surface only — db.exec(CREATE TABLE/INDEX), all
 * IF NOT EXISTS, so a replay against a database that already holds them is a
 * no-op. NEVER db.prepare (the 0.9.19/0.9.22 boot storms). The column
 * definitions and index list live ONCE, in schema.js's TABLES, and this
 * migration builds from them — so the versioned chain, the additive auto-sync,
 * and the twin's bootstrap diff cannot drift into three dialects.
 */

import { TABLES, buildCreateTableSql } from "../schema.js";

const NEW_TABLES = ["authUsers"];

const up = (db) => {
  for (const name of NEW_TABLES) {
    // buildCreateTableSql emits the table only — the indexes are ours to issue.
    db.exec(buildCreateTableSql(name, TABLES[name]));
    for (const idx of TABLES[name].indexes || []) db.exec(idx);
  }
};

const down = (db) => {
  // Reverse order, so a future foreign key between these would still unwind.
  for (const name of [...NEW_TABLES].reverse()) {
    db.exec(`DROP TABLE IF EXISTS ${name}`);
  }
};

export default { version: 17, name: "auth-users", up, down };
export { up, down };
