/**
 * Migration 016: auth sessions, durable login failures, auth audit log
 * (Auth Hardening W1 — the Star's decree of 2026-09-20)
 *
 * The dashboard's auth surface carried three holes, each measured rather than
 * assumed before this wave opened:
 *
 *  1. NO SESSION RECORD. The dashboard JWT is stateless (HS256, 24h, no jti),
 *     so there was nothing to list, nothing to revoke, and no
 *     logout-everywhere. authSessions gives every issued session a row keyed
 *     by its jti, plus a revokedAt the verifier can consult.
 *
 *  2. THE LOCKOUT LADDER LIVED ONLY IN PROCESS MEMORY. loginLimiter.js's own
 *     header called that an "accepted residual": a restart wiped every lockout
 *     and every fixed window. authFailures is that store made durable. The
 *     header's paragraph is corrected in the same wave — a comment that was
 *     true before this migration and false after it is worse than none.
 *
 *  3. NO AUDIT TRAIL. Nothing recorded a login outcome, a lockout, or a
 *     revocation. authAuditLog holds those events with ip + userAgent, and its
 *     `detail` column is constrained by contract to carry NO password, NO
 *     token and NO hash.
 *
 * WHY NEW TABLES AND NOT ALTERS: these are pure additions, so their inverse is
 * actually expressible — `down` drops them. Migrations 013/014/015 are
 * additive-COLUMN migrations whose rollback SQLite cannot express, and they
 * are no-ops for that reason. The house rule is "additive-only rollback where
 * the inverse is inexpressible", not "always a no-op"; this one can be
 * written, so it is.
 *
 * COLUMN NAMING: `event` is a MySQL reserved word (the same hazard the chart
 * records for `key`), so the audit column is `eventType`. The MariaDB twin
 * receives these tables through bootstrap.js's additive diff against TABLES,
 * and a reserved word there would have needed backticking in every repo path.
 *
 * ADAPTER CONTRACT: portable surface only — db.exec(CREATE TABLE/INDEX), all
 * IF NOT EXISTS, so a replay against a database that already holds them is a
 * no-op. NEVER db.prepare (the 0.9.19/0.9.22 boot storms). The column
 * definitions and index list live ONCE, in schema.js's TABLES, and this
 * migration builds from them — so the versioned chain, the additive auto-sync,
 * and the twin's bootstrap diff cannot drift into three dialects.
 */

import { TABLES, buildCreateTableSql } from "../schema.js";

const NEW_TABLES = ["authSessions", "authFailures", "authAuditLog"];

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

export default { version: 16, name: "auth-sessions-audit", up, down };
export { up, down };
