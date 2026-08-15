// Migration 004 — usage-history dedupe UNIQUE (Storage Covenant Wave A5).
//
// Root cause this seals: saveRequestUsage deduped via SELECT-then-INSERT — a
// check-then-act race that both collapsed same-millisecond writes beyond
// intention (100 parallel identical entries → 1 row, the db-concurrent
// known-fails) and was race-prone across processes. The covenant
// (plans/storage-covenant.md, line 270) replaces it with a UNIQUE index on
// the dedupe identity so BOTH target engines enforce it atomically:
//
//   uq_uh_dedupe(timestamp, provider, model, connectionId, keyId,
//                promptTokens, completionTokens)
//
// The four text columns are backfilled NULL → '' because NULLs are DISTINCT
// in UNIQUE indexes in both SQLite and MySQL — with NULLs the index could
// never dedupe keyless/unattributed rows. From A5 onward saveRequestUsage
// and importDb write '' as the normalized form of "unset" (plan line 270);
// schema.js mirrors NOT NULL DEFAULT '' for fresh installs. Auto-sync never
// alters existing columns, so upgraded DBs keep nullable columns and rely on
// the backfill + '' writes. Readers normalize '' → null at their edge, so
// API and artifact shapes are unchanged.
//
// Idempotent and safe on any prior state:
//   1. Backfill NULL → '' on the four dedupe columns.
//   2. Carry each collapsed group's endpoint onto its survivor (the old
//      SELECT-then-INSERT path used to backfill endpoint on duplicates).
//   3. Collapse pre-existing duplicate groups keeping the lowest id —
//      a UNIQUE index cannot be created over duplicates.
//   4. CREATE UNIQUE INDEX IF NOT EXISTS.
export default {
  version: 4,
  name: "usage-history dedupe UNIQUE",
  up(db) {
    // 1. Normalize "unset" to '' — writer, importDb, and the UNIQUE index
    //    all treat '' identically from this migration onward.
    for (const col of ["provider", "model", "connectionId", "keyId"]) {
      db.run(`UPDATE usageHistory SET ${col} = '' WHERE ${col} IS NULL`);
    }

    // 2. Preserve endpoint across the collapse: a group's endpoint may live
    //    on a non-surviving row, so copy the first non-empty one onto every
    //    group member before deleting (covers the survivors).
    db.run(`
      UPDATE usageHistory SET endpoint = (
        SELECT uh2.endpoint FROM usageHistory uh2
        WHERE uh2.timestamp = usageHistory.timestamp
          AND COALESCE(uh2.provider, '') = COALESCE(usageHistory.provider, '')
          AND COALESCE(uh2.model, '') = COALESCE(usageHistory.model, '')
          AND COALESCE(uh2.connectionId, '') = COALESCE(usageHistory.connectionId, '')
          AND COALESCE(uh2.keyId, '') = COALESCE(usageHistory.keyId, '')
          AND uh2.promptTokens = usageHistory.promptTokens
          AND uh2.completionTokens = usageHistory.completionTokens
          AND uh2.endpoint IS NOT NULL AND uh2.endpoint != ''
        ORDER BY uh2.id LIMIT 1
      )
      WHERE endpoint IS NULL OR endpoint = ''
    `);

    // 3. Collapse duplicates, keeping the lowest id per group.
    const before = db.get(`SELECT COUNT(*) AS c FROM usageHistory`)?.c ?? 0;
    db.run(`
      DELETE FROM usageHistory WHERE id NOT IN (
        SELECT MIN(id) FROM usageHistory
        GROUP BY timestamp, COALESCE(provider, ''), COALESCE(model, ''),
                 COALESCE(connectionId, ''), COALESCE(keyId, ''),
                 promptTokens, completionTokens
      )
    `);
    const after = db.get(`SELECT COUNT(*) AS c FROM usageHistory`)?.c ?? 0;
    if (before !== after) {
      console.log(`[DB][m004] collapsed ${before - after} duplicate usageHistory rows (kept lowest id per group)`);
    }

    // 4. The dedupe identity — enforced atomically by both engines from here
    //    (SQLite ON CONFLICT DO NOTHING ≡ MySQL ER_DUP_ENTRY semantics).
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_uh_dedupe ON usageHistory(timestamp, provider, model, connectionId, keyId, promptTokens, completionTokens)`);
  },
};
