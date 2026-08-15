// Session-scarce providers — model-test must soft-skip them.
//
// freebuff's quota unit IS the session claim (~6/day per egress IP): every
// chat-path request claims a session, so a dashboard "test all" click would
// incinerate the entire daily budget. pingModelByKind soft-fails these targets
// BEFORE any fetch (a fetch would traverse the full chat path and claim).
//
// Pure predicate, unit-tested in tests/unit/freebuff-ping-guard.test.js.

/** Providers whose quota is burned by a test request through the chat path. */
export const SESSION_SCARCE_PROVIDERS = new Set(["freebuff", "fb"]);

/**
 * True when a model test for `modelId` (optionally `provider`) must soft-skip
 * to protect scarce session quota. Accepts prefixed ("freebuff/<model>") and
 * bare ("<model>") ids — ping may receive either.
 */
export function isSessionScarceTestTarget(modelId, provider = null) {
  if (provider && SESSION_SCARCE_PROVIDERS.has(String(provider))) return true;
  const id = String(modelId || "");
  const prefix = id.split("/")[0];
  return SESSION_SCARCE_PROVIDERS.has(prefix);
}
