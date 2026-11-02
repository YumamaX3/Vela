/**
 * Migration 029: the security log and the trust inbox.
 *
 * Ported from 9router-pro's per-key security log + trust inbox (Vela had
 * neither). Two tables, one story:
 *
 *   securityLog — the LEDGER. Append-only, integer-timestamped, one row per
 *       security-relevant act (key minted, key revoked, gate denial, guardrail
 *       block). Range-queried on `createdAt`, filtered by `kind`/`keyId`,
 *       pruned past a 30-day window ON WRITE. `keyId` is nullable because not
 *       every act carries a key; the read surface masks it to keyPrefix form.
 *
 *   trustEvents — the INBOX. The handful of acts that deserve the operator's
 *       glance (a key revoked, a guardrail blocking). `read` is the 0/1
 *       dismissal flag; `createdAt` is epoch-ms so newest-first paging is an
 *       index scan.
 *
 * Shape notes, following 016/018/020/029:
 *   - epoch-ms INTEGER for anything range-queried hot (`authFailures`,
 *     `guardrailLogs.createdAtMs`, `logEvents.ts` all set this precedent).
 *   - No CHECK constraints on the `kind` vocabulary — the writer's machine
 *     grows, and 019's law is that vocabulary must never cost a migration.
 *   - `detail` is metadata-only JSON BY CONTRACT: no full key, no credential,
 *     no matched value ever reaches it.
 *
 * Both tables are declared in schema.js's TABLES mirror, so fresh installs
 * receive them through the additive path and upgrades heal through the sqlite
 * auto-sync / the MariaDB bootstrap diff. This migration exists for the
 * version-gated path (and its pre-change backup), and it declares `tables` so
 * migrate.js's ghost-repair re-applies an idempotent up() when the slot reads
 * current but the DDL is absent.
 *
 * ADAPTER CONTRACT (the 013 lesson): run/get/all/exec only — no raw prepare().
 */

const SECURITY_LOG = "securityLog";
const TRUST_EVENTS = "trustEvents";

const up = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${SECURITY_LOG} (
      id TEXT PRIMARY KEY,
      keyId TEXT,
      kind TEXT NOT NULL,
      detail TEXT,
      ip TEXT,
      createdAt INTEGER NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sl_created ON ${SECURITY_LOG}(createdAt)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sl_kind ON ${SECURITY_LOG}(kind, createdAt)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sl_key ON ${SECURITY_LOG}(keyId, createdAt)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TRUST_EVENTS} (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT,
      read INTEGER NOT NULL DEFAULT 0,
      createdAt INTEGER NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_te_created ON ${TRUST_EVENTS}(createdAt DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_te_read ON ${TRUST_EVENTS}(read, createdAt DESC)`);
};

export default {
  version: 29,
  name: "security-log-trust-inbox",
  tables: [SECURITY_LOG, TRUST_EVENTS],
  up,
};
