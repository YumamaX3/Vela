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
  const report = { tables: 0, columns: 0, indexes: 0, closures: "already-applied" };

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

  return report;
}
