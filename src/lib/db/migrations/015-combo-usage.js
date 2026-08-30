/**
 * Migration 015: combo usage attribution (v0.9.40)
 *
 * Threads the requested combo name into the usage ledger so the dashboard can
 * answer "which combo burns my tokens?" — a question the flat provider/model
 * columns could never answer. When a request arrives as a combo name (e.g.
 * vela/cc/opus, slash-bearing since v0.9.39), every member + judge usage row
 * written for that request now carries the combo's name.
 *
 *   usageHistory.combo      — TEXT, NULL for direct (non-combo) requests
 *   requestDetails.combo    — TEXT, NULL for direct requests
 *   idx_uh_combo            — (combo, timestamp DESC) for the per-combo
 *                             aggregation queries the combos page runs.
 *
 * NULL (not '') is the honest "not a combo" marker here — unlike the dedupe
 * columns, combo is NEVER part of a UNIQUE identity, so NULL's engine-safe.
 * Old rows stay NULL; aggregation treats NULL as "direct request".
 *
 * ADAPTER CONTRACT: portable surface only — db.all(...) PRAGMA guard +
 * db.exec(...) ALTER. Never db.prepare (the 0.9.19/0.9.22 boot storms).
 */

const HISTORY_COLS = [["combo", "TEXT"]];
const DETAILS_COLS = [["combo", "TEXT"]];

const up = (db) => {
  const historyCols = new Set(db.all(`PRAGMA table_info(usageHistory)`).map((c) => c.name));
  for (const [name, type] of HISTORY_COLS) {
    if (!historyCols.has(name)) {
      db.exec(`ALTER TABLE usageHistory ADD COLUMN ${name} ${type}`);
    }
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_uh_combo ON usageHistory(combo, timestamp DESC)`);

  const detailCols = new Set(db.all(`PRAGMA table_info(requestDetails)`).map((c) => c.name));
  for (const [name, type] of DETAILS_COLS) {
    if (!detailCols.has(name)) {
      db.exec(`ALTER TABLE requestDetails ADD COLUMN ${name} ${type}`);
    }
  }
};

const down = (db) => {
  // SQLite cannot DROP COLUMN on older versions; additive-only rollback path
  // (same documented stance as 002/013/014).
  // no-op
};

export default { version: 15, name: "combo-usage-attribution", up, down };
export { up, down };
