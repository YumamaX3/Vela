/**
 * Connection preference registry — a generic, fail-open extension point for
 * provider-aware account pinning on the chat path.
 *
 * A provider registers a resolver (providerId, { provider, model } -> connectionId|null);
 * handleSingleModelChat consults it before account selection and forwards the
 * result as options.preferredConnectionId — an option getProviderCredentials
 * already honors (image/video handlers pass it today). The pin is ADVISORY:
 * when the pinned connection is excluded/locked, selection falls through to
 * the configured strategy, byte-identical to today's behavior.
 *
 * Fail-open is the permanent contract: resolver errors and timeouts collapse
 * to null (no pin), so no other provider can regress from this hook.
 */

const RESOLVERS = new Map();

// Injected for tests (wall-clock 500ms waits make the timeout branch flaky).
let timeoutMs = 500;

/** Register a resolver for a provider id. Overwrites any previous one. */
export function registerConnectionResolver(providerId, resolverFn) {
  if (!providerId || typeof resolverFn !== "function") return;
  RESOLVERS.set(providerId, resolverFn);
}

export function unregisterConnectionResolver(providerId) {
  RESOLVERS.delete(providerId);
}

function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    if (timer.unref) timer.unref();
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(null); },
    );
  });
}

/**
 * Resolve the preferred connection for (provider, model). Returns a
 * connectionId string or null. NEVER throws — the chat path must degrade to
 * default selection on any resolver failure or timeout.
 */
export async function resolvePreferredConnection(providerId, model) {
  const resolver = RESOLVERS.get(providerId);
  if (!resolver) return null;
  try {
    const result = await withTimeout(
      Promise.resolve().then(() => resolver({ provider: providerId, model })),
      timeoutMs,
    );
    return typeof result === "string" && result ? result : null;
  } catch {
    return null;
  }
}

export const __test__ = {
  setTimeoutMs(ms) { timeoutMs = ms; },
  reset() { RESOLVERS.clear(); timeoutMs = 500; },
  size: () => RESOLVERS.size,
};
