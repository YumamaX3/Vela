/**
 * Migration 020: guardrail policies and the audit log they write.
 * (Ported from 9router-go `internal/guardrails` + `guardrail_policies` /
 *  `guardrail_logs` tables — Vela had neither the engine nor the tables.)
 *
 * WHY THIS TABLE EXISTS: before it, a gateway could route a prompt to an
 * upstream carrying a customer's card number or a colleague's national ID, and
 * nothing anywhere recorded that it had happened. The engine that scans the
 * traffic is useless without two things this migration supplies:
 *
 *   guardrailPolicies — WHAT to scan and WHAT to do. One row per policy, with
 *       a scope so a stricter rule can target one provider or one model
 *       without silencing the global one. `detectors` is a JSON array of set
 *       names ("pii", "injection") — an empty array means the policy enables
 *       NOTHING, which is the safe default: silence is never "scan everything".
 *
 *   guardrailLogs — WHAT MATCHED. One row per decision, never containing the
 *       matched value itself (entity + detector + offsets only). This is the
 *       difference between "we blocked something" and "we can show you which
 *       rule fired on which request".
 *
 * Shape notes, following the house precedent set by 016/018/019:
 *   - ISO timestamps for human-facing times, epoch-ms INTEGER for anything
 *     range-queried hot.
 *   - No CHECK constraints on the action vocabulary: ACTIONS is the engine's
 *     own machine, and growing it must not cost a migration (019's law).
 *   - Scope is deliberately a TEXT column plus a `target` for the specific
 *     provider/model/key id, so a new scope kind needs no schema change.
 */

const POLICIES = "guardrailPolicies";
const LOGS = "guardrailLogs";

const up = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${POLICIES} (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      scope TEXT NOT NULL DEFAULT 'global',
      target TEXT,
      direction TEXT NOT NULL DEFAULT 'both',
      detectors TEXT NOT NULL DEFAULT '[]',
      action TEXT NOT NULL DEFAULT 'log_only',
      priority INTEGER NOT NULL DEFAULT 100,
      notes TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_gp_scope ON ${POLICIES}(scope, target)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_gp_enabled ON ${POLICIES}(enabled, priority)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS ${LOGS} (
      id TEXT PRIMARY KEY,
      policyId TEXT,
      scope TEXT,
      direction TEXT NOT NULL,
      action TEXT NOT NULL,
      detector TEXT,
      entity TEXT,
      severity TEXT,
      provider TEXT,
      model TEXT,
      connectionId TEXT,
      matchCount INTEGER NOT NULL DEFAULT 0,
      excerpt TEXT,
      createdAt TEXT NOT NULL,
      createdAtMs INTEGER NOT NULL
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_gl_created ON ${LOGS}(createdAtMs)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_gl_action ON ${LOGS}(action, createdAtMs)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_gl_entity ON ${LOGS}(entity, createdAtMs)`);
};

const down = (db) => {
  // Pure addition — the inverse is expressible, so it is written, the same
  // call 016/017/018/019 make.
  db.exec(`DROP INDEX IF EXISTS idx_gl_entity`);
  db.exec(`DROP INDEX IF EXISTS idx_gl_action`);
  db.exec(`DROP INDEX IF EXISTS idx_gl_created`);
  db.exec(`DROP TABLE IF EXISTS ${LOGS}`);
  db.exec(`DROP INDEX IF EXISTS idx_gp_enabled`);
  db.exec(`DROP INDEX IF EXISTS idx_gp_scope`);
  db.exec(`DROP TABLE IF EXISTS ${POLICIES}`);
};

const migration = { version: 20, name: "guardrails", tables: [POLICIES, LOGS], up, down };
export default migration;
export { up, down };
