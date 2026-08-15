// Storage Covenant Wave C2 — the mirror decorator (outbox capture).
//
// Wraps the sqlite harbor modules behind their facades so every classified
// writer (mirror/replayRegistry.js — BINDING LAW) leaves one outbox row for
// the pump (Wave C3). Pure orchestration: all adapter access rides
// repos/sqlite/outboxRepo.js's withOutboxCapture, so this layer never touches
// the driver and the census ratchet holds.
//
// Two documented behaviors (plan, Wave C / Phase 10):
//   1. Atomic containment — the outbox INSERT rides the SAME savepoint as the
//      writer's mutation (withOutboxCapture): they commit together or not at
//      all. Proven across better-sqlite3 / node:sqlite / sql.js (a writer's
//      own nested db.transaction() rides inside the open savepoint).
//   2. Identity capture — identity-carrying writers capture the GENERATED
//      identity from the sqlite execution so replay inserts the SAME row.
//      Without it, createCombo re-mints a uuid on the twin and combos.name
//      UNIQUE turns every retry into a poison loop.
//
// S3 law shapes the capture:
//   - apiKeys ops capture the key HASH, never the keyId/plaintext key
//     (with API_KEY_SECRET the internal key is re-derivable from keyId).
//   - connection ops capture {id, createdAt, updatedAt} ONLY — never tokens.
//   - args may carry secrets (OAuth tokens); the pump redacts them after the
//     first apply attempt and ages rows out regardless of status (Wave C3 —
//     an outage window must not become an unbounded plaintext journal).
import { classifyWriter, REPLAY_CLASS } from "./replayRegistry.js";
import { withOutboxCapture } from "../repos/sqlite/outboxRepo.js";
import { getKeyHashForMirror } from "../repos/sqlite/apiKeysRepo.js";

/** Writers classified in the registry but deliberately NOT captured.
 *  touchKeyLastUsed: writes apiKeys.lastUsedAt — a sweep-excluded idempotent
 *  timestamp (Wave C4 divergence fingerprint ignores it); capture would be
 *  pure outbox noise (the 60s throttle already bounds write frequency). */
const NO_CAPTURE = new Set(["touchKeyLastUsed"]);

/** Identity extraction per identity-carrying writer — result → the GENERATED
 *  identity the replay must insert. null = replay re-executes (deterministic). */
const IDENTITY_EXTRACT = {
  createCombo: (r) => (r ? { id: r.id, createdAt: r.createdAt, updatedAt: r.updatedAt } : null),
  // S3: hash + prefix + createdAt ONLY — never the plaintext key, never the
  // keyId (the row id IS the keyId; a leaked keyId + API_KEY_SECRET re-derives
  // internal keys). record is a PUBLIC projection (keyHash hidden by design),
  // so the hash is fetched transiently via getKeyHashForMirror — it crosses
  // this threshold and rides the outbox identity column, but the keyId is
  // NEVER persisted. Replay dedupes on keyHash (uq_ak_key_hash), never the id.
  createApiKey: (r) =>
    r?.record
      ? { createdAt: r.record.createdAt, keyHash: getKeyHashForMirror(r.keyId), keyPrefix: r.record.keyPrefix }
      : null,
  // S3: row identity only — never accessToken/refreshToken/apiKey.
  createProviderConnection: (r) => (r ? { id: r.id, createdAt: r.createdAt, updatedAt: r.updatedAt } : null),
  createProviderNode: (r) => (r ? { id: r.id, createdAt: r.createdAt, updatedAt: r.updatedAt } : null),
  createProxyPool: (r) => (r ? { id: r.id, createdAt: r.createdAt } : null),
  // ensureInternalKey is DETERMINISTIC under a shared API_KEY_SECRET: replay
  // re-executes ensureInternalKey(purpose) on the twin. Capturing keyId would
  // violate S3 — the identity column stays null by design.
  ensureInternalKey: () => null,
};

/** No-op results that must NOT enqueue (nothing was written). */
function wasNoOp(fnName, result) {
  if (fnName.startsWith("delete")) return result === false || result === 0;
  if (fnName === "addCustomModel") return result === false; // row already existed
  return false;
}

/** Build the outbox entry for one completed writer call, or null to skip.
 *  SYNC — withOutboxCapture checks entry.replayClass inside the savepoint. */
function buildEntry(fnName, args, result) {
  const replayClass = classifyWriter(fnName);
  if (!replayClass) return null;
  if (wasNoOp(fnName, result)) return null;
  const identity =
    replayClass === REPLAY_CLASS.IDENTITY_CARRYING
      ? (IDENTITY_EXTRACT[fnName]?.(result) ?? null)
      : null;
  return { replayClass, fnName, args, identity };
}

/** Wrap one writer fn so its mutation and its outbox row commit atomically. */
function wrapWriter(fnName, fn) {
  return async (...args) => withOutboxCapture(
    (result) => buildEntry(fnName, args, result),
    () => fn(...args)
  );
}

/** Decorate a sqlite harbor module for mirror posture. Unclassified functions
 *  (reads) and non-function exports pass through VERBATIM. The returned module
 *  keeps the same export surface — facades see no shape change. */
export function decorateMirrorRepo(mod) {
  const out = {};
  for (const [name, value] of Object.entries(mod)) {
    const cls = classifyWriter(name);
    // Wrap only writers that mirror: EXEMPT (usage/detail/log) and NO_CAPTURE
    // pass through verbatim alongside reads + non-function exports.
    if (typeof value !== "function" || !cls || cls === REPLAY_CLASS.EXEMPT || NO_CAPTURE.has(name)) {
      out[name] = value;
      continue;
    }
    out[name] = wrapWriter(name, value);
  }
  return out;
}
