/**
 * Migration 026: prompt CONTENT on guardrail policies — Pro's grouped pass.
 *
 * Pro resolves prompt injections stacked global → user(key) → model as ONE
 * grouped pass per position: every matching enabled policy's prompt applies,
 * not just the most specific one. Vela's policies carried detectors and an
 * action, but no place to put a prompt — so this migration adds the two
 * columns that make the pass expressible:
 *
 *   prompt          — the system-prompt text (NULL = none)
 *   promptPosition  — "prepend" | "append" (NULL when there is no prompt)
 *
 * Both are nullable with NO default: NULL is the additive default and reads
 * as "this policy carries no prompt", so an upgraded database's scan behavior
 * is byte-identical to the moment before the ALTER. Only prompt CONTENT
 * stacks; the scan decision keeps its single-winner, stricter-action-wins law
 * (policyStore.resolvePolicy — untouched).
 *
 * Additive only. Both columns are declared in schema.js's TABLES mirror so
 * fresh installs receive them through 001 and upgrades heal through sqlite
 * auto-sync / the mysql information_schema diff; this migration exists for
 * the version-gated path (and its pre-change backup).
 *
 * ADAPTER CONTRACT (the 013 lesson): run/get/all/exec — no raw prepare().
 */

const COLUMNS = [
  ["prompt", "TEXT"],         // NULL = no prompt
  ["promptPosition", "TEXT"], // "prepend" | "append" | NULL
];

const up = (db) => {
  const cols = new Set(db.all(`PRAGMA table_info(guardrailPolicies)`).map((c) => c.name));
  for (const [name, type] of COLUMNS) {
    if (!cols.has(name)) {
      db.exec(`ALTER TABLE guardrailPolicies ADD COLUMN ${name} ${type}`);
    }
  }
};

const down = (db) => {
  // SQLite cannot DROP COLUMN on older versions; leaving the columns is the
  // documented rollback path (same as 002/013/024/025). They are NULL
  // everywhere after an upgrade, so a rollback changes no behavior.
};

const migration = { version: 26, name: "guardrail-prompts", up, down };
export default migration;
export { up, down };
