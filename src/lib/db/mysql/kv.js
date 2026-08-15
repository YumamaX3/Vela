// Storage Covenant Wave A7 — the mysql twin of helpers/kvStore.js
// (plan line 272: "alias (+mysql/kv.js)").
//
// Same makeKv(scope) shape, native async, MySQL upsert syntax. `key` is a
// MySQL reserved word — every reference is backticked. ON DUPLICATE KEY
// UPDATE rides the kv PRIMARY KEY (scope, key); VALUES(col) is used for
// maximum compatibility (MariaDB does not support the 8.0.20 alias syntax).
import { getMysqlAdapter } from "./adapter.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

export function makeKvMysql(scope) {
  return {
    async get(key, fallback = null) {
      const db = await getMysqlAdapter();
      const row = await db.get("SELECT value FROM kv WHERE scope = ? AND `key` = ?", [scope, key]);
      return row ? parseJson(row.value, fallback) : fallback;
    },
    async getAll() {
      const db = await getMysqlAdapter();
      const rows = await db.all("SELECT `key`, value FROM kv WHERE scope = ?", [scope]);
      const out = {};
      for (const r of rows) out[r.key] = parseJson(r.value);
      return out;
    },
    async set(key, value) {
      const db = await getMysqlAdapter();
      await db.run(
        "INSERT INTO kv(scope, `key`, value) VALUES(?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
        [scope, key, stringifyJson(value)]
      );
    },
    async setMany(obj) {
      const db = await getMysqlAdapter();
      await db.transaction(async (tx) => {
        for (const [k, v] of Object.entries(obj)) {
          await tx.run(
            "INSERT INTO kv(scope, `key`, value) VALUES(?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
            [scope, k, stringifyJson(v)]
          );
        }
      });
    },
    async remove(key) {
      const db = await getMysqlAdapter();
      await db.run("DELETE FROM kv WHERE scope = ? AND `key` = ?", [scope, key]);
    },
    async clear() {
      const db = await getMysqlAdapter();
      await db.run("DELETE FROM kv WHERE scope = ?", [scope]);
    },
  };
}
