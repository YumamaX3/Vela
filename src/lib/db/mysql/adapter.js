// Storage Covenant Wave A7 — the mysql adapter singleton for repos/mysql/*.
// Mirrors driver.js's global._dbAdapter pattern (survives Next.js dev
// hot-reload). First bind boots the pool AND runs bootstrapMysql — a foreign
// MariaDB is brought to TABLES parity (additive diff + security closures)
// BEFORE any repo reads or writes it.
if (!global._mysqlAdapter) global._mysqlAdapter = { instance: null, initPromise: null };
const state = global._mysqlAdapter;

export async function getMysqlAdapter() {
  if (state.instance) return state.instance;
  if (!state.initPromise) {
    state.initPromise = (async () => {
      const url = (process.env.VELA_MYSQL_URL || "").trim();
      if (!url) {
        throw new Error("[DB][mysql] VELA_MYSQL_URL is required for the mysql harbor (mysql://user:pass@host:3306/vela)");
      }
      const { createMysqlAdapter } = await import("./pool.js");
      const { bootstrapMysql } = await import("./bootstrap.js");
      const adapter = await createMysqlAdapter(url);
      await bootstrapMysql(adapter); // additive diff + security closures, idempotent
      state.instance = adapter;
      return adapter;
    })().catch((e) => {
      state.initPromise = null; // a transient failure must be retryable
      throw e;
    });
  }
  return state.initPromise;
}
