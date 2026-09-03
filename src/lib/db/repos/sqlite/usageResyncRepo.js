// Storage Covenant Wave C4 — the usage-resync PRIMARY read seam (sqlite).
//
// saveRequestUsage is EXEMPT from outbox arg-replay (replayRegistry law):
// cost/keyId resolve against eventually-consistent shadows — engine-divergent
// by nature. Usage flows to the twin through THIS seam instead: an incremental
// watermark append (plan: "last-synced usageHistory.id, bounded batch,
// scheduled interval — NOT periodic full export"). usageDaily + the
// totalRequestsLifetime counter ride the same watermark (they are aggregates
// of the very rows the batch carries).
//
// The watermark lives in the sqlite `_meta` table (key mirrorUsageWatermark) —
// the designated home for operational cursors (schemaVersion,
// totalRequestsLifetime already live there). exportDb never exports `_meta`,
// so the cursor can never leak into an artifact or a resync payload.
//
// Census ratchet: the sweep/resync conductor never touches the driver — this
// repo is its only read path into the primary.

import { getAdapter } from "../../driver.js";
import { parseJson } from "../../helpers/jsonCol.js";

export const USAGE_WATERMARK_KEY = "mirrorUsageWatermark";

/** Local YYYY-MM-DD dateKey — mirrors usageRepo's getLocalDateKey exactly
 *  (both twins implement it identically; the resync must aggregate rows into
 *  the same day buckets the live writers use). */
function getLocalDateKey(timestamp) {
  const d = new Date(timestamp);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** The current watermark (last-synced usageHistory.id). 0 = never synced. */
export async function getUsageWatermark() {
  const db = await getAdapter();
  const row = db.get(`SELECT value FROM _meta WHERE key = ?`, [USAGE_WATERMARK_KEY]);
  const v = row ? parseInt(row.value, 10) : 0;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** Advance the watermark (only FORWARD — a stale call never regresses it). */
export async function setUsageWatermark(id) {
  const next = Number(id);
  if (!Number.isFinite(next) || next <= 0) return getUsageWatermark();
  const db = await getAdapter();
  const cur = await getUsageWatermark();
  if (next <= cur) return cur;
  db.run(
    `INSERT INTO _meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [USAGE_WATERMARK_KEY, String(next)]
  );
  return next;
}

/** One bounded batch of usageHistory rows BEYOND the watermark, id-ordered.
 *  S3: the legacy plaintext apiKey column is never selected — it cannot cross
 *  to the twin (the twin's writer writes NULL there by law).
 *
 *  v0.9.44 (milestone 0.6, LIVE-C): the Observatory telemetry columns and combo
 *  attribution ARE selected now. They were simply absent from this list while
 *  `apiKey` above is a DELIBERATE, documented exclusion — one exclusion is a
 *  designed law, five riding along unannounced was negligence. The live writer
 *  (usageRepo.js:396) inserts all nineteen; the twin's columns exist because
 *  migration 008/015 declared them in TABLES and mysql/bootstrap.js's additive
 *  diff heals the twin on every boot. With them missing here, the twin's five
 *  columns were permanently NULL — and because `usageHistory` is absent from
 *  FINGERPRINT_TABLES (the set holds exactly six keys), NO sweep could detect it.
 *
 *  Two column-specific laws, both honoured by the apply seam:
 *   - latencyMs / ttftMs / httpStatus keep NULL when the caller had no signal.
 *     NULL means "unmeasured"; 0 would mean "measured as instant" (usageRepo.js:12
 *     — "never 0-faked"). So these transfer as-is, never coalesced to 0.
 *   - statusClass is NEVER NULL: '' is the normalized unknown (migration 008:91
 *     seals it with `UPDATE … SET statusClass = '' WHERE statusClass IS NULL`,
 *     and deriveStatusClass returns '' on every path including its catch).
 */
export async function fetchUsageBatch(afterId, batchSize) {
  const db = await getAdapter();
  return db.all(
    `SELECT id, timestamp, provider, model, connectionId, keyId, keyPrefix,
            endpoint, promptTokens, completionTokens, cost, status, tokens, meta,
            latencyMs, ttftMs, httpStatus, statusClass, combo
     FROM usageHistory WHERE id > ? ORDER BY id ASC LIMIT ?`,
    [afterId, batchSize]
  );
}

/** The usageDaily aggregate rows for every day bucket a set of timestamps
 *  touches (the resync copies the primary's aggregates for touched days). */
export async function fetchUsageDailyForTimestamps(timestamps) {
  const dateKeys = [...new Set((timestamps || []).map(getLocalDateKey))].sort();
  if (!dateKeys.length) return [];
  const db = await getAdapter();
  const rows = [];
  for (const dateKey of dateKeys) {
    const row = db.get(`SELECT dateKey, data FROM usageDaily WHERE dateKey = ?`, [dateKey]);
    if (row) rows.push({ dateKey: row.dateKey, data: parseJson(row.data, {}) });
  }
  return rows;
}

/** The lifetime request counter (rides the watermark resync). */
export async function fetchTotalRequestsLifetime() {
  const db = await getAdapter();
  const row = db.get(`SELECT value FROM _meta WHERE key = 'totalRequestsLifetime'`);
  const v = row ? parseInt(row.value, 10) : 0;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** The highest usageHistory id on the primary. A full export→import resync
 *  bulk-copies usage with the primary's ids; the sweep advances the watermark
 *  to this so the routine incremental pass does not re-append what the resync
 *  already carried. */
export async function getMaxUsageId() {
  const db = await getAdapter();
  const row = db.get(`SELECT MAX(id) AS maxId FROM usageHistory`);
  const v = row?.maxId;
  return Number.isFinite(v) && v > 0 ? v : 0;
}
