/**
 * Migration 027: the policy `kind` switch — system (default) vs script.
 *
 * 026 taught a policy to carry a system prompt (`prompt`, `promptPosition`).
 * This migration lets a policy carry a SCRIPT instead: an ordered list of turns
 * `[{ role: "user"|"assistant", content }]` inserted as fake history into the
 * translated request body just before dispatch — Port Pro's chat-script shape.
 *
 *   kind  — TEXT, NULL = "system". The nullable default is additive: every row
 *           written before this column existed reads as a system policy, i.e.
 *           exactly today's behavior, with no backfill to run. "script" is the
 *           only other value; anything unknown also reads as "system"
 *           (injectorScripts.normalizeKind's fail-safe).
 *   turns — TEXT (JSON), NULL = no script. Read through parseTurnsJson, which
 *           treats malformed JSON as "no turns" — the policy then behaves as a
 *           system policy with no prompt, i.e. a scanner only. Never a CHECK
 *           constraint: the turn shape belongs to the injector machine, and
 *           growing it must not cost a migration (020's law).
 *
 * Scripts are not scanners. They add text; they never produce findings and
 * never trigger a guardrail refusal. The inbound tap still scans the body a
 * script lands in, because it scans the FINAL body — a script cannot smuggle
 * PII past a masking policy.
 *
 * Additive only. Both columns are declared in schema.js's TABLES mirror so
 * fresh installs receive them through the 001 TABLES path and upgrades heal
 * through sqlite auto-sync / the mysql information_schema diff; this migration
 * exists for the version-gated path (and its pre-change backup).
 *
 * ADAPTER CONTRACT (the 013 lesson): run/get/all/exec only — no raw prepare().
 */

const POLICIES = "guardrailPolicies";

const COLUMNS = [
  ["kind", "TEXT"],  // NULL = "system"
  ["turns", "TEXT"], // JSON array of {role, content}; NULL = no script
];

const up = (db) => {
  const cols = new Set(db.all(`PRAGMA table_info(${POLICIES})`).map((c) => c.name));
  for (const [name, type] of COLUMNS) {
    if (!cols.has(name)) {
      db.exec(`ALTER TABLE ${POLICIES} ADD COLUMN ${name} ${type}`);
    }
  }
};

const down = (db) => {
  // SQLite cannot DROP COLUMN on older versions; leaving the columns is the
  // documented rollback path (same as 002/013/024/025/026). They are NULL
  // everywhere after an upgrade, so a rollback changes no behavior.
};

const migration = { version: 27, name: "policy-kinds", up, down };
export default migration;
export { up, down };
