/**
 * Provider resilience profiles.
 *
 * Per-auth-category thresholds and windows, so that large account pools (500+)
 * do not trip a provider-level circuit breaker (or a per-account block) too
 * quickly. Categories are the three Vela already distinguishes:
 *
 *   oauth   — session-based providers; flaky but recoverable, so more headroom.
 *   apikey  — key providers; recover fast, but can spam many accounts at once.
 *   local   — local runtimes; either up or down, so fail fast.
 *
 * ── Port notes (W6, sibling-harbor-ports §3.1 row 9) ─────────────────────────
 * Ported from VansRouter's `open-sse/config/providerProfiles.js`. Two Vela
 * adjustments, both mechanical:
 *
 *  1. Category source. The fork reads `OAUTH_PROVIDERS`/`APIKEY_PROVIDERS` from
 *     `src/shared/constants/providers.js`. Those two sets are themselves built
 *     by grouping `open-sse/providers/registry/*` on `entry.category`, so this
 *     port reads the registry directly — the same source, one derivation
 *     instead of two, and no `open-sse → src` import hop.
 *  2. Env prefix. The fork's knobs are `VANSROUTER_PROVIDER_FAILURE_*`; here
 *     they are `VELA_PROVIDER_FAILURE_*`, matching Vela's environment naming.
 *
 * The consumer in the fork is `accountFallback.js#recordProviderFailure` (a
 * per-provider, proxy-aware circuit breaker). Vela has no provider-level
 * breaker — it carries `src/lib/network/circuitBreaker.js`, a *pool*-scoped
 * design (plan §3.0), and `accountFallback.js` is owned by W2. So that call
 * site is deliberately not taken here; instead this module's live consumer in
 * Vela is the account semaphore's per-category block duration
 * (`services/accountSemaphore.js#markBlocked` with no explicit duration).
 *
 * @module open-sse/config/providerProfiles
 */
import REGISTRY from "../providers/registry/index.js";

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const PROFILES = {
  oauth: {
    // OAuth sessions can be flaky and recover; give them more headroom.
    providerFailureThreshold: envInt("VELA_PROVIDER_FAILURE_OAUTH_THRESHOLD", 10),
    providerFailureWindowMs: envInt("VELA_PROVIDER_FAILURE_OAUTH_WINDOW_MS", 15 * 60 * 1000),
    providerCooldownMs: envInt("VELA_PROVIDER_FAILURE_OAUTH_COOLDOWN_MS", 5 * 60 * 1000),
  },
  apikey: {
    // API key providers recover faster but can spam many accounts at once.
    // Defaults are intentionally kept backward-compatible with the previous
    // hardcoded values (threshold 5, window 30s, cooldown 30s). Operators with
    // large account pools can raise these via env vars.
    providerFailureThreshold: envInt("VELA_PROVIDER_FAILURE_APIKEY_THRESHOLD", 5),
    providerFailureWindowMs: envInt("VELA_PROVIDER_FAILURE_APIKEY_WINDOW_MS", 30 * 1000),
    providerCooldownMs: envInt("VELA_PROVIDER_FAILURE_APIKEY_COOLDOWN_MS", 30 * 1000),
  },
  local: {
    // Local providers are either up or down; fail fast.
    providerFailureThreshold: envInt("VELA_PROVIDER_FAILURE_LOCAL_THRESHOLD", 2),
    providerFailureWindowMs: envInt("VELA_PROVIDER_FAILURE_LOCAL_WINDOW_MS", 5 * 60 * 1000),
    providerCooldownMs: envInt("VELA_PROVIDER_FAILURE_LOCAL_COOLDOWN_MS", 60 * 1000),
  },
};

/** Registry category → resilience category (anything not oauth/local is apikey-shaped). */
const CATEGORY_BY_ID = new Map(
  REGISTRY.map((entry) => [String(entry.id).toLowerCase(), entry.category]),
);

/** Local runtimes are named, not categorised, in the registry (ollama is freeTier). */
const LOCAL_PROVIDER_IDS = new Set(["ollama", "local", "lmstudio", "kobold"]);

const _categoryCache = new Map();

/**
 * Resolve a provider id to its resilience category.
 * Unknown providers default to "apikey" (the fork's behaviour).
 * @param {string} provider
 * @returns {"oauth"|"apikey"|"local"}
 */
export function resolveProviderCategory(provider) {
  if (!provider) return "apikey";
  if (_categoryCache.has(provider)) return _categoryCache.get(provider);
  const id = String(provider).toLowerCase();
  let category = "apikey";
  if (LOCAL_PROVIDER_IDS.has(id)) {
    category = "local";
  } else if (CATEGORY_BY_ID.get(id) === "oauth") {
    category = "oauth";
  }
  _categoryCache.set(provider, category);
  return category;
}

/**
 * Return the resilience profile for a provider.
 * @param {string} provider
 * @returns {{ providerFailureThreshold: number, providerFailureWindowMs: number, providerCooldownMs: number }}
 */
export function getProviderResilienceProfile(provider) {
  if (provider === "a6api" || provider === "a6api-cli") {
    return {
      providerFailureThreshold: envInt("VELA_PROVIDER_FAILURE_A6API_THRESHOLD", 5),
      providerFailureWindowMs: envInt("VELA_PROVIDER_FAILURE_A6API_WINDOW_MS", 30 * 1000),
      providerCooldownMs: 3000, // 3 seconds cooldown specifically for a6api
    };
  }
  return PROFILES[resolveProviderCategory(provider)] ?? PROFILES.apikey;
}

/**
 * Clear the provider-category cache. Useful in tests.
 */
export function clearProviderResilienceCache() {
  _categoryCache.clear();
}
