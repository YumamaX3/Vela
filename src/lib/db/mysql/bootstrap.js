// Storage Covenant Wave A6 — the mysql bootstrap.
// Plan: plans/storage-covenant.md A6 (line 271): "mysql/bootstrap.js
// (information_schema additive diff + security closures tombstone/scrub,
// tracked in _meta)".
//
// The mysql twin of migrate.js's versioned chain, adapted to a server the
// gateway did not create: TABLES is the single source of truth, and the
// schema is brought forward by ADDITIVE DIFF only — create missing tables,
// add missing columns, create missing indexes. Never drop, never alter.
//
// The security closures from migration 002 are ported here (tombstone
// legacy plaintext apiKeys, scrub usageHistory.apiKey) because a foreign
// database may carry pre-governance rows. They are idempotent by WHERE
// guard and run ONCE, tracked in _meta.mysqlSecurityClosures.
import { TABLES } from "../schema.js";
import { toMysqlTableSql, toMysqlIndexSqls, toMysqlColumnAdd, indexedColumns, indexNameOf } from "./ddlMap.js";
import { LEGACY_STATUS_MAP } from "../../usageStatus.js";

async function existingColumns(adapter, table) {
  const rows = await adapter.all(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return new Set(rows.map((r) => r.COLUMN_NAME ?? r.column_name));
}

async function existingIndexes(adapter, table) {
  const rows = await adapter.all(
    `SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return new Set(rows.map((r) => r.INDEX_NAME ?? r.index_name));
}

/** Bring one foreign MariaDB/MySQL schema to TABLES parity (additive only).
 *  Returns a small report for logging/test assertion. */
export async function bootstrapMysql(adapter) {
  const report = { tables: 0, columns: 0, indexes: 0, closures: "already-applied", backfillM008: "already-applied" };

  for (const [name, def] of Object.entries(TABLES)) {
    // CREATE TABLE IF NOT EXISTS is idempotent — safe on every boot.
    await adapter.exec(toMysqlTableSql(name, def));
    report.tables++;

    // Additive column diff via information_schema (auto-sync twin).
    const have = await existingColumns(adapter, name);
    const indexed = indexedColumns(def);
    for (const [col, colDef] of Object.entries(def.columns)) {
      if (have.has(col)) continue;
      await adapter.exec(toMysqlColumnAdd(name, col, colDef, indexed.has(col)));
      report.columns++;
    }

    // Additive index diff (CREATE INDEX has no IF NOT EXISTS in MySQL).
    const haveIdx = await existingIndexes(adapter, name);
    for (const sql of toMysqlIndexSqls(name, def)) {
      const idxName = indexNameOf(sql);
      if (!idxName || haveIdx.has(idxName)) continue;
      await adapter.exec(sql);
      report.indexes++;
    }
  }

  // Security closures — migration 002's tombstone + scrub, ported to MySQL
  // syntax (CONCAT instead of ||, backticked reserved word `key`). Tracked
  // in _meta so they run once per database, and so Wave B's backup artifacts
  // can prove the twin was sealed.
  const meta = await adapter.get(`SELECT value FROM _meta WHERE \`key\` = ?`, ["mysqlSecurityClosures"]);
  if (!meta) {
    await adapter.exec(`
      UPDATE apiKeys
      SET isActive = 0,
          \`key\` = CONCAT('revoked-', id),
          name = CONCAT(COALESCE(name, 'Key'), ' [legacy]'),
          keyVersion = 'legacy'
      WHERE keyHash IS NULL AND \`key\` IS NOT NULL AND \`key\` != '' AND \`key\` NOT LIKE 'revoked-%'
    `);
    await adapter.exec(`UPDATE usageHistory SET apiKey = NULL WHERE apiKey IS NOT NULL`);
    const stamped = new Date().toISOString();
    // VALUES(value) form — MariaDB does not support the 8.0.20 alias syntax.
    await adapter.run(
      `INSERT INTO _meta(\`key\`, value) VALUES(?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)`,
      ["mysqlSecurityClosures", JSON.stringify({ tombstoneLegacyKeys: stamped, scrubPlaintextUsage: stamped })]
    );
    report.closures = "applied";
  }

  // Migration-008 statusClass backfill — the mysql twin of the sqlite
  // batched backfill (008-usage-telemetry.js). Columns/indexes arrive via
  // the additive TABLES diff above; this DML closure is ported explicitly
  // and tracked in _meta so it runs once per database. Batched in 10k-row
  // chunks (phase12 W1-3 lock budget); only unclassified rows are touched.
  const m008Meta = await adapter.get(`SELECT value FROM _meta WHERE \`key\` = ?`, ["mysqlM008Backfill"]);
  if (!m008Meta) {
    const report008 = {};
    for (const [raw, cls] of Object.entries(LEGACY_STATUS_MAP)) {
      let updated = 0;
      let guard = 0;
      while (guard++ < 1000) {
        // Derived-table wrap: MariaDB rejects LIMIT inside an IN(...) subquery
        // ("LIMIT & IN/ALL/ANY/SOME subquery"), so the batch materializes in an
        // inner SELECT and the UPDATE matches the derived table. Portable to
        // both engines.
        const res = await adapter.run(
          `UPDATE usageHistory SET statusClass = ? WHERE id IN (
             SELECT id FROM (
               SELECT id FROM usageHistory
               WHERE (statusClass IS NULL OR statusClass = '') AND status = ?
               LIMIT 10000
             ) AS batch
           )`,
          [cls, raw]
        );
        const n = Number(res?.affectedRows ?? res?.changes ?? 0);
        updated += n;
        if (n === 0) break;
      }
      if (updated > 0) report008[cls] = updated;
    }
    // Same '' = unknown invariant as the sqlite twin (migration 008 step 4).
    await adapter.run(`UPDATE usageHistory SET statusClass = '' WHERE statusClass IS NULL`);
    await adapter.run(
      `INSERT INTO _meta(\`key\`, value) VALUES(?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)`,
      ["mysqlM008Backfill", JSON.stringify({ applied: new Date().toISOString(), updated: report008 })]
    );
    report.backfillM008 = "applied";
  } else {
    report.backfillM008 = "already-applied";
  }

  return report;
}
