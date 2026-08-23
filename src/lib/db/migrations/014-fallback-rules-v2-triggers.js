/**
 * Migration 014: fallback-rules v2 — trigger condition model (v0.9.23)
 *
 * Extends the fallback-rules table with the full trigger-condition surface
 * (condition builder):
 *   triggerType   — "status" (default, existing behavior) | "contentPolicy" |
 *                   "contextWindow" | "timeout" | "anyError"
 *   conditionOp   — operator for value comparison: "in" (status list),
 *                   "gte" (e.g. contextWindow ratio, latency ms)
 *   conditionVal  — the operand (comma list or number)
 *   targetModels  — JSON array: multi-hop ordered fallback chain [A, B, C]
 *                   (supersedes single targetModel; kept for back-compat)
 *   cooldownSkip  — INTEGER 1 when circuit-breaker-cooldown awareness is on
 *
 * The old `triggerOnStatus` column is KEPT and still honored (status rules
 * map onto triggerType="status" + conditionOp="in"); migration is additive.
 *
 * ADAPTER CONTRACT: portable surface only — db.all(...) PRAGMA guard +
 * db.exec(...) ALTER. Never db.prepare (the 0.9.19/0.9.22 boot storms).
 */

const COLUMNS = [
  ["triggerType", "TEXT NOT NULL DEFAULT 'status'"],
  ["conditionOp", "TEXT NOT NULL DEFAULT 'in'"],
  ["conditionVal", "TEXT"],
  ["targetModels", "TEXT"], // JSON array fallback chain; NULL = use targetModel
  ["cooldownSkip", "INTEGER NOT NULL DEFAULT 0"],
];

const up = (db) => {
  const cols = new Set(db.all(`PRAGMA table_info(fallbackRules)`).map((c) => c.name));
  for (const [name, type] of COLUMNS) {
    if (!cols.has(name)) {
      db.exec(`ALTER TABLE fallbackRules ADD COLUMN ${name} ${type}`);
    }
  }
};

const down = (db) => {
  // SQLite cannot DROP COLUMN on older versions; additive-only rollback path
  // (same documented stance as 002/013).
  // no-op
};

export default { version: 14, name: "fallback-rules-v2-triggers", up, down };
export { up, down };
