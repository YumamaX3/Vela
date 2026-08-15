// Storage Covenant Wave A6 — TABLES → MySQL/MariaDB DDL translator.
// Plan: plans/storage-covenant.md A6 (line 271):
//   "TABLES → MySQL DDL: TEXT PK→VARCHAR(191), AUTOINCREMENT→BIGINT
//    AUTO_INCREMENT, partial index→plain KEY, CHECK(id=1) preserved —
//    MariaDB ≥10.2"
//
// schema.js stays the single declarative source of truth (dialect-neutral
// TABLES, plan line 65); this module EMITS the MySQL dialect. The rules:
//   - TEXT columns that are PRIMARY KEY members or index members become
//     VARCHAR(191) — MySQL cannot index TEXT without a prefix, and 191 keeps
//     keys inside the utf8mb4 767-byte limit. All our TEXT keys are short
//     identifiers (ids, scopes, provider names, vela-v1-… keys).
//   - INTEGER PRIMARY KEY AUTOINCREMENT → BIGINT NOT NULL AUTO_INCREMENT.
//   - REAL → DECIMAL(12,6) — cost is money; the parity harness pins cost to
//     6dp (plan line 245), so DECIMAL(12,6) is the exact-width twin.
//   - CHECK constraints pass through verbatim — enforced by MariaDB ≥10.2
//     and MySQL 8.0.16+.
//   - Partial indexes (WHERE …) become plain KEYs — MySQL has no partial
//     indexes; the WHERE clause is a filter optimization, not a constraint.
//   - CREATE INDEX drops IF NOT EXISTS (unsupported in MySQL) — bootstrap.js
//     diffs information_schema before creating, so idempotence lives there.
//   - Every identifier is backticked: `key` is a reserved word in MySQL and
//     two of our tables use it as a column name (apiKeys, kv).
export const VARCHAR_INDEX_WIDTH = 191;

/** Columns that appear in any index or composite PRIMARY KEY of a table. */
export function indexedColumns(def) {
  const cols = new Set();
  for (const idx of def.indexes || []) {
    const m = idx.match(/ON\s+\w+\s*\(([^)]+)\)/i);
    if (m) for (const c of m[1].split(",")) cols.add(c.trim());
  }
  if (def.primaryKey) {
    const m = def.primaryKey.match(/\(([^)]+)\)/);
    if (m) for (const c of m[1].split(",")) cols.add(c.trim());
  }
  return cols;
}

/** Map one sqlite column definition to its MySQL twin.
 *  Returns { sql, pk } — sql is the "`col` TYPE …" fragment, pk marks the
 *  column as the table's PRIMARY KEY holder (emitted after all columns). */
export function mapColumnDef(col, colDef, isIndexed) {
  let def = colDef.trim();
  let check = "";
  const checkM = def.match(/CHECK\s*\(.+\)/i);
  if (checkM) { check = ` ${checkM[0]}`; def = def.replace(checkM[0], "").trim(); }

  const autoinc = /AUTOINCREMENT/i.test(def);
  const pk = /PRIMARY KEY/i.test(def);
  def = def.replace(/PRIMARY KEY AUTOINCREMENT/i, "").replace(/PRIMARY KEY/i, "").trim();

  let type;
  if (autoinc) {
    type = "BIGINT NOT NULL AUTO_INCREMENT";
  } else if (/^INTEGER\b/i.test(def)) {
    type = def.replace(/^INTEGER/i, "INT");
  } else if (/^TEXT\b/i.test(def)) {
    // PK members and indexed columns must be indexable → VARCHAR(191);
    // payload columns (data/tokens/meta/…) stay TEXT (64KB, no prefix limit).
    type = (pk || isIndexed) ? def.replace(/^TEXT/i, `VARCHAR(${VARCHAR_INDEX_WIDTH})`) : def;
  } else if (/^REAL\b/i.test(def)) {
    type = def.replace(/^REAL/i, "DECIMAL(12,6)");
  } else {
    type = def;
  }
  // PK columns are NOT NULL by definition; make it explicit for non-autoinc.
  if (pk && !autoinc && !/NOT NULL/i.test(type)) type += " NOT NULL";

  return { sql: `\`${col}\` ${type}${check}`, pk };
}

/** CREATE TABLE IF NOT EXISTS for one TABLES entry, in MySQL dialect. */
export function toMysqlTableSql(name, def) {
  const indexed = indexedColumns(def);
  const parts = [];
  let pk = null;
  for (const [col, colDef] of Object.entries(def.columns)) {
    const { sql, pk: isPk } = mapColumnDef(col, colDef, indexed.has(col));
    parts.push(sql);
    if (isPk && !pk) pk = `\`${col}\``;
  }
  if (def.primaryKey) {
    // Composite PK — backtick each member (`PRIMARY KEY (scope, key)`).
    parts.push(def.primaryKey.replace(/\(([^)]+)\)/, (_, cols) =>
      `(${cols.split(",").map((c) => `\`${c.trim()}\``).join(", ")})`));
  } else if (pk) {
    parts.push(`PRIMARY KEY (${pk})`);
  }
  return `CREATE TABLE IF NOT EXISTS \`${name}\` (${parts.join(", ")}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
}

/** CREATE INDEX statements for one TABLES entry, in MySQL dialect.
 *  IF NOT EXISTS is stripped (bootstrap diffs information_schema instead) and
 *  partial-index WHERE clauses become plain KEYs (plan line 271). */
export function toMysqlIndexSqls(name, def) {
  return (def.indexes || []).map((idx) => {
    let sql = idx.replace(/IF NOT EXISTS\s*/i, "");
    sql = sql.replace(/\s+WHERE\s+.+$/i, ""); // partial index → plain KEY
    sql = sql.replace(/ON\s+(\w+)\s*\(([^)]+)\)/i, (_, t, cols) =>
      `ON \`${t}\` (${cols.split(",").map((c) => `\`${c.trim()}\``).join(", ")})`);
    return sql;
  });
}

/** ADD COLUMN for the information_schema additive diff (bootstrap.js).
 *  Mirrors sqlite auto-sync's stripping: inline UNIQUE / AUTO_INCREMENT are
 *  create-time-only; NOT NULL without a DEFAULT would reject the ADD. */
export function toMysqlColumnAdd(table, col, colDef, isIndexed) {
  let { sql } = mapColumnDef(col, colDef, isIndexed);
  sql = sql.replace(/AUTO_INCREMENT/i, "").replace(/\bUNIQUE\b/i, "");
  if (!/DEFAULT/i.test(sql)) sql = sql.replace(/NOT NULL/i, "NULL");
  return `ALTER TABLE \`${table}\` ADD COLUMN ${sql.replace(/\s+/g, " ").trim()}`;
}

/** Extract the index name from an emitted CREATE INDEX statement. */
export function indexNameOf(createIndexSql) {
  const m = createIndexSql.match(/INDEX\s+`?(\w+)`?\s+ON/i);
  return m ? m[1] : null;
}
