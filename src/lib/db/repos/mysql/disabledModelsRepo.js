// Storage Covenant Wave A8 — the mysql twin of sqlite/disabledModelsRepo.js.
// Same kv scope ("disabledModels"), same atomic read-merge-write inside a
// transaction; the sqlite ON CONFLICT upsert rides the kv PRIMARY KEY as the
// MySQL ON DUPLICATE KEY UPDATE form. `key` is reserved — always backticked.
import { getMysqlAdapter } from "../../mysql/adapter.js";
import { parseJson, stringifyJson } from "../../helpers/jsonCol.js";

const SCOPE = "disabledModels";

export async function getDisabledModels() {
  const db = await getMysqlAdapter();
  const rows = await db.all(`SELECT \`key\`, value FROM kv WHERE scope = ?`, [SCOPE]);
  const out = {};
  for (const r of rows) out[r.key] = parseJson(r.value, []);
  return out;
}

export async function getDisabledByProvider(providerAlias) {
  const db = await getMysqlAdapter();
  const row = await db.get(`SELECT value FROM kv WHERE scope = ? AND \`key\` = ?`, [SCOPE, providerAlias]);
  return row ? (parseJson(row.value, []) || []) : [];
}

// Atomic read-merge-write inside a transaction (connection-bound — no yield
// between read and write can interleave another connection's merge).
export async function disableModels(providerAlias, ids) {
  if (!providerAlias || !Array.isArray(ids)) return;
  const db = await getMysqlAdapter();
  await db.transaction(async (tx) => {
    const row = await tx.get(`SELECT value FROM kv WHERE scope = ? AND \`key\` = ?`, [SCOPE, providerAlias]);
    const current = row ? (parseJson(row.value, []) || []) : [];
    const merged = [...new Set([...current, ...ids])];
    await tx.run(
      `INSERT INTO kv(scope, \`key\`, value) VALUES(?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)`,
      [SCOPE, providerAlias, stringifyJson(merged)]
    );
  });
}

export async function enableModels(providerAlias, ids) {
  if (!providerAlias) return;
  const db = await getMysqlAdapter();
  await db.transaction(async (tx) => {
    if (!Array.isArray(ids) || ids.length === 0) {
      await tx.run(`DELETE FROM kv WHERE scope = ? AND \`key\` = ?`, [SCOPE, providerAlias]);
      return;
    }
    const row = await tx.get(`SELECT value FROM kv WHERE scope = ? AND \`key\` = ?`, [SCOPE, providerAlias]);
    const current = row ? (parseJson(row.value, []) || []) : [];
    const removeSet = new Set(ids);
    const next = current.filter((id) => !removeSet.has(id));
    if (next.length === 0) {
      await tx.run(`DELETE FROM kv WHERE scope = ? AND \`key\` = ?`, [SCOPE, providerAlias]);
    } else {
      await tx.run(
        `INSERT INTO kv(scope, \`key\`, value) VALUES(?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)`,
        [SCOPE, providerAlias, stringifyJson(next)]
      );
    }
  });
}
