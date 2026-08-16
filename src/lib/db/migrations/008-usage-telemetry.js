// Migration 008 — usage telemetry + composite indexes (Usage Observatory W1).
//
// Sealed plan: plans/mirror-usage-observatory/SEALED-PLAN.md (W1.1), revised
// at Gate 14 (Tidebreaker SEALED-BROKEN → repairs applied).
//
// What this seals:
//   1. Four telemetry columns on usageHistory — latencyMs, ttftMs, httpStatus
//      (nullable INTEGER; NULL = pre-instrumentation, never 0-faked), and
//      statusClass (TEXT DEFAULT ''; the normalized, indexable slug from
//      src/lib/usageStatus.js).
//   2. Four composite indexes funding the Observatory's queries:
//        idx_uh_ts_provider (timestamp, provider)  — series/breakdown/halos
//        idx_uh_ts_keyId    (timestamp, keyId)     — per-key breakdowns
//        idx_uh_ts_status   (timestamp, statusClass) — error anatomy
//        idx_uh_ts_latency  (timestamp, latencyMs) — windowed percentile
//      skip-scan (Gate-14 correction: the COMPOSITE index, not a bare
//      latencyMs column — a bare index cannot serve a time-window-restricted
//      percentile without re-filtering).
//   3. Batched statusClass backfill of legacy `status` strings
//      (ok/success→ok, error→upstream_error) in 10k-row chunks — the lock
//      budget from phase12 risk W1-3. Only rows with empty/NULL statusClass
//      are touched, so re-runs and post-instrumentation rows are untouched.
//
// Gate-14 note: gateway_error is deliberately ABSENT — `rejectionReason` was
// a phantom (zero repo occurrences) and gateway rejections never reach
// saveRequestUsage. See src/lib/usageStatus.js header.
//
// MySQL twin: bootstrap.js brings the columns/indexes via the additive
// TABLES diff (schema.js is the single source of truth); the backfill is
// ported there as a _meta-tracked one-time closure (mysqlM008Backfill).
//
// Idempotent on any prior state.
import { LEGACY_STATUS_MAP } from "../../usageStatus.js";

function hasColumn(db, table, col) {
  const rows = db.all(`PRAGMA table_info(${table})`);
  return rows.some((r) => r.name === col);
}

const migration = {
  version: 8,
  name: "usage telemetry + composite indexes",
  up(db) {
    // 1. Telemetry columns — pragma-checked so re-runs never throw.
    if (!hasColumn(db, "usageHistory", "latencyMs")) {
      db.exec(`ALTER TABLE usageHistory ADD COLUMN latencyMs INTEGER`);
    }
    if (!hasColumn(db, "usageHistory", "ttftMs")) {
      db.exec(`ALTER TABLE usageHistory ADD COLUMN ttftMs INTEGER`);
    }
    if (!hasColumn(db, "usageHistory", "httpStatus")) {
      db.exec(`ALTER TABLE usageHistory ADD COLUMN httpStatus INTEGER`);
    }
    if (!hasColumn(db, "usageHistory", "statusClass")) {
      db.exec(`ALTER TABLE usageHistory ADD COLUMN statusClass TEXT DEFAULT ''`);
    }

    // 2. Composite indexes (IF NOT EXISTS — idempotent by construction).
    db.exec(`CREATE INDEX IF NOT EXISTS idx_uh_ts_provider ON usageHistory(timestamp, provider)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_uh_ts_keyId ON usageHistory(timestamp, keyId)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_uh_ts_status ON usageHistory(timestamp, statusClass)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_uh_ts_latency ON usageHistory(timestamp, latencyMs)`);

    // 3. Batched statusClass backfill — 10k chunks (phase12 W1-3 lock
    //    budget), only unclassified rows, capped loop as a safety rail.
    for (const [raw, cls] of Object.entries(LEGACY_STATUS_MAP)) {
      let updated = 0;
      let guard = 0;
      while (guard++ < 1000) {
        const res = db.run(
          `UPDATE usageHistory SET statusClass = ? WHERE id IN (
             SELECT id FROM usageHistory
             WHERE (statusClass IS NULL OR statusClass = '') AND status = ?
             LIMIT 10000
           )`,
          [cls, raw]
        );
        const n = Number(res?.changes ?? 0);
        updated += n;
        if (n === 0) break;
      }
      if (updated > 0) {
        console.log(`[DB][m008] backfilled statusClass='${cls}' on ${updated} rows (legacy status='${raw}')`);
      }
    }

    // 4. Normalize remaining NULL → '' (the m004 "unset" convention): the
    //    sealed plan's invariant is statusClass='' for unknown, never NULL —
    //    GROUP BY and comparisons treat '' identically in both engines.
    //    Only rows with unrecognized legacy status remain NULL here.
    db.run(`UPDATE usageHistory SET statusClass = '' WHERE statusClass IS NULL`);
  },
};

export default migration;
