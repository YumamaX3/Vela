// Storage Covenant Wave C4 — the sweep's PRIMARY read seam (sqlite).
//
// The divergence sweep (mirror/mirrorSweep.js) fingerprints the sqlite primary
// and the mysql twin table-by-table and compares. This repo is the ONLY place
// the sweep reads the primary — the orchestration layer never touches the
// driver (census ratchet, same law as the pump → outboxRepo/mirrorApplyRepo).
//
// The sweep reads RAW rows (SELECT *), not repo-merged projections: the
// fingerprint (mirror/mirrorFingerprint.js) owns every normalization hazard
// (drop-list, JSON key-order, REAL-vs-DECIMAL epsilon, booleans). Reading raw
// keeps the seam honest — a repo transform that renames/nests a column would
// otherwise read as drift.

import { getAdapter } from "../../driver.js";
import { FINGERPRINT_TABLES } from "../../mirror/mirrorFingerprint.js";

/** Read the raw rows of one fingerprinted table from the sqlite primary.
 *  The table must be on the fingerprint whitelist — anything else refuses
 *  LOUD (the sweep never scans usage/ledger/outbox bookkeeping). */
export async function fetchSweepRows(table) {
  if (!FINGERPRINT_TABLES[table]) {
    throw new Error(`[mirror] sweep table "${table}" is not on the fingerprint whitelist`);
  }
  const db = await getAdapter();
  return db.all(`SELECT * FROM ${table}`);
}
