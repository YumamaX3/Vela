// Storage Covenant Wave C3 — the mirror apply-cursor table (sqlite side).
// The outbox (migration 006) records WHAT must be mirrored; mirrorSeq records
// WHERE the pump has reached — {lastAppliedSeq, lastFailedSeq} as one row.
// Like outbox, mirrorSeq is sqlite-ONLY: it never enters TABLES, so the mysql
// bootstrap never replicates it, and S3 excludes it from every export artifact
// by name. The mysql twin of this state is the seq-dedupe table
// (mirror/mirrorPump.js ensureMirrorSeqTable) — at-least-once delivery is
// deduped at APPLY there, and the two sides converge as the pump drains.
const migration = {
  version: 7,
  name: "mirror-seq",
  up(db) {
    db.exec(
      `CREATE TABLE IF NOT EXISTS mirrorSeq (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        lastAppliedSeq INTEGER NOT NULL DEFAULT 0,
        lastFailedSeq INTEGER NOT NULL DEFAULT 0
      )`
    );
    db.exec(`INSERT OR IGNORE INTO mirrorSeq(id, lastAppliedSeq, lastFailedSeq) VALUES(1, 0, 0)`);
  },
};

export default migration;
