// Storage Covenant Wave C4 — the usage-resync TWIN apply seam (mysql).
//
// The primary read seam (repos/sqlite/usageResyncRepo.js) yields bounded
// id-ordered batches beyond the watermark; THIS seam applies them VERBATIM to
// the twin. Verbatim is the law: the rows are ALREADY costed + key-resolved on
// the primary (saveRequestUsage did the engine-divergent work), so the resync
// must NOT re-run calculateCost/resolveUsageKeyIdentity here — re-resolving
// against the twin's eventually-consistent shadows is exactly the hazard that
// made saveRequestUsage exempt from arg-replay in the first place.
//
// Idempotence: batches are id-ordered and the watermark advances only after a
// successful apply, so re-delivery of an applied id must be a no-op. INSERT
// ... ON DUPLICATE KEY UPDATE id=id absorbs any redelivery without mutating
// the row. (INSERT IGNORE would also work, but the explicit no-op update keeps
// the "row unchanged" intent legible.)
//
// Census ratchet: reaches the twin only through getMysqlAdapter().

import { getMysqlAdapter } from "../../mysql/adapter.js";
import { stringifyJson } from "../../helpers/jsonCol.js";

/** Append one batch of usageHistory rows to the twin, carrying the primary's
 *  own ids (so the watermark and the twin's ids stay in lockstep). Returns the
 *  number of rows applied. */
export async function applyUsageBatch(rows) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  const db = await getMysqlAdapter();
  await db.transaction(async (tx) => {
    for (const r of rows) {
      await tx.run(
        `INSERT INTO usageHistory(id, timestamp, provider, model, connectionId, apiKey, keyId, keyPrefix, endpoint, promptTokens, completionTokens, cost, status, tokens, meta)
         VALUES(?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE id = id`,
        [
          r.id, r.timestamp, r.provider || "", r.model || "",
          r.connectionId || "", r.keyId || "", r.keyPrefix ?? null,
          r.endpoint ?? null, r.promptTokens ?? 0, r.completionTokens ?? 0,
          r.cost ?? 0, r.status ?? null,
          stringifyJson(r.tokens ?? null), stringifyJson(r.meta ?? null),
        ]
      );
    }
  });
  return rows.length;
}

/** Upsert the usageDaily day-aggregates for the touched day buckets (the
 *  primary's own aggregate objects — copied verbatim, not recomputed). */
export async function applyUsageDaily(rows) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  const db = await getMysqlAdapter();
  await db.transaction(async (tx) => {
    for (const d of rows) {
      await tx.run(
        `INSERT INTO usageDaily(dateKey, data) VALUES(?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)`,
        [d.dateKey, stringifyJson(d.data ?? {})]
      );
    }
  });
  return rows.length;
}

/** Set the lifetime request counter on the twin (rides the watermark). */
export async function applyLifetimeCounter(value) {
  const db = await getMysqlAdapter();
  await db.run(
    `INSERT INTO _meta(\`key\`, value) VALUES('totalRequestsLifetime', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [String(value ?? 0)]
  );
}
