// Storage Covenant Wave C1 — the replay-class registry (BINDING LAW).
//
// plans/storage-covenant.md Phase 10 taxonomy: every barrel writer maps to
// exactly one replay class. The mirror pump (Wave C3) applies outbox rows
// through these shapes; the decorator (Wave C2) captures per class:
//
//   idempotent-upsert  {fnName, args} — replay any number of times, same
//     terminal state (kv upserts, deletes-by-id, toggles, full-scope replaces).
//   identity-carrying  {fnName, args, identity} — the GENERATED uuid/hash/
//     timestamp captured from the sqlite execution; replay inserts the SAME
//     identity. Without capture, createCombo re-mints a uuid on the twin and
//     combos.name UNIQUE turns every retry into a poison loop.
//   rmw-stale-hazard   read-modify-write — applied cursor-monotonically; the
//     seq-dedupe row rides the SAME mysql transaction (at-least-once delivery
//     deduped at apply).
//   exempt             never mirrored via arg-replay: usage rows flow through
//     the divergence sweep + watermark resync (saveRequestUsage), buffered
//     flush writes are uncaptureable at facade return (saveRequestDetail),
//     appendRequestLog is a no-op stub kept for contract stability.
//
// The registry is pure data + a lookup — no adapter access — so it sits in
// src/lib/db/mirror/ (the orchestration layer) without tripping the census
// ratchet. ensureInternalKey's identity is DETERMINISTIC only when
// API_KEY_SECRET matches across stores (the stated precondition).
export const REPLAY_CLASS = {
  IDEMPOTENT_UPSERT: "idempotent-upsert",
  IDENTITY_CARRYING: "identity-carrying",
  RMW_STALE_HAZARD: "rmw-stale-hazard",
  EXEMPT: "exempt",
};

export const REPLAY_CLASSES = {
  // ─── idempotent-upsert ─────────────────────────────────────────────────
  deleteProviderConnection: REPLAY_CLASS.IDEMPOTENT_UPSERT,
  deleteProviderConnectionsByProvider: REPLAY_CLASS.IDEMPOTENT_UPSERT,
  reorderProviderConnections: REPLAY_CLASS.IDEMPOTENT_UPSERT,
  deleteProviderNode: REPLAY_CLASS.IDEMPOTENT_UPSERT,
  deleteProxyPool: REPLAY_CLASS.IDEMPOTENT_UPSERT,
  deleteCombo: REPLAY_CLASS.IDEMPOTENT_UPSERT,
  deleteApiKey: REPLAY_CLASS.IDEMPOTENT_UPSERT,
  touchKeyLastUsed: REPLAY_CLASS.IDEMPOTENT_UPSERT, // 60s throttle lives INSIDE the repo (plan: outbox sizing depends on it)
  setModelAlias: REPLAY_CLASS.IDEMPOTENT_UPSERT,
  deleteModelAlias: REPLAY_CLASS.IDEMPOTENT_UPSERT,
  addCustomModel: REPLAY_CLASS.IDEMPOTENT_UPSERT,
  deleteCustomModel: REPLAY_CLASS.IDEMPOTENT_UPSERT,
  setMitmAliasAll: REPLAY_CLASS.IDEMPOTENT_UPSERT,
  // updatePricing merges model keys into the provider's kv row — the merge is
  // monotonic per key and the kv write is ON CONFLICT DO UPDATE with the fully
  // merged value, so replay converges (never removes; deletes ride reset/clear).
  updatePricing: REPLAY_CLASS.IDEMPOTENT_UPSERT,
  resetPricing: REPLAY_CLASS.IDEMPOTENT_UPSERT,
  resetAllPricing: REPLAY_CLASS.IDEMPOTENT_UPSERT,
  replaceSyncedPricing: REPLAY_CLASS.IDEMPOTENT_UPSERT,
  clearSyncedPricing: REPLAY_CLASS.IDEMPOTENT_UPSERT,
  disableModels: REPLAY_CLASS.IDEMPOTENT_UPSERT,
  enableModels: REPLAY_CLASS.IDEMPOTENT_UPSERT,

  // ─── identity-carrying ─────────────────────────────────────────────────
  createCombo: REPLAY_CLASS.IDENTITY_CARRYING, // mints uuid + createdAt/updatedAt
  createApiKey: REPLAY_CLASS.IDENTITY_CARRYING, // mints key/hash/prefix/id/createdAt
  createProviderConnection: REPLAY_CLASS.IDENTITY_CARRYING, // access_token/oauth path mints id + timestamps
  createProviderNode: REPLAY_CLASS.IDENTITY_CARRYING,
  createProxyPool: REPLAY_CLASS.IDENTITY_CARRYING,
  ensureInternalKey: REPLAY_CLASS.IDENTITY_CARRYING, // deterministic iff API_KEY_SECRET matches across stores

  // ─── rmw-stale-hazard ──────────────────────────────────────────────────
  updateSettings: REPLAY_CLASS.RMW_STALE_HAZARD,
  updateProviderConnection: REPLAY_CLASS.RMW_STALE_HAZARD,
  updateApiKey: REPLAY_CLASS.RMW_STALE_HAZARD,
  updateCombo: REPLAY_CLASS.RMW_STALE_HAZARD,
  updateProviderNode: REPLAY_CLASS.RMW_STALE_HAZARD,
  updateProxyPool: REPLAY_CLASS.RMW_STALE_HAZARD,
  cleanupProviderConnections: REPLAY_CLASS.RMW_STALE_HAZARD,

  // ─── exempt ────────────────────────────────────────────────────────────
  saveRequestUsage: REPLAY_CLASS.EXEMPT, // divergence sweep + usage watermark resync
  saveRequestDetail: REPLAY_CLASS.EXEMPT, // writeBuffer → flush mints ids at flush time — uncaptureable (Phase 10)
  appendRequestLog: REPLAY_CLASS.EXEMPT, // no-op stub kept for contract stability
};

/** Classify a barrel writer by name. Returns null for reads/unknown names. */
export function classifyWriter(fnName) {
  return REPLAY_CLASSES[fnName] ?? null;
}
