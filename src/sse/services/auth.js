import { getProviderConnections, validateApiKey, updateProviderConnection, getSettings, getProxyPools } from "@/lib/localDb";
import { resolveConnectionProxyConfig, pickProxyPoolId } from "@/lib/network/connectionProxy";
import fleet from "@/lib/network/proxyFleet.js"; // Fleet Captain for fitness recording
import { formatRetryAfter, checkFallbackError, isModelLockActive, buildModelLockUpdate, getEarliestModelLockUntil } from "open-sse/services/accountFallback.js";
import { MAX_RATE_LIMIT_COOLDOWN_MS } from "open-sse/config/errorConfig.js";
import { FREEBUFF_MODEL_LOCK_MS, FREEBUFF_COOLDOWNS, FREEBUFF_MAX_COOLDOWN_MS } from "open-sse/config/freebuff.js";
import { resolveProviderId, FREE_PROVIDERS, FREE_TIER_PROVIDERS } from "@/shared/constants/providers.js";
import * as log from "../utils/logger.js";

// Mutex to prevent race conditions during account selection
let selectionMutex = Promise.resolve();

const GITHUB_MONTHLY_USAGE_LIMIT = "you've reached your additional usage limit for your plan";

function githubMonthlyResetMs(status, errorText, provider) {
  if (resolveProviderId(provider) !== "github" || Number(status) !== 402) return null;
  if (!String(errorText || "").toLowerCase().includes(GITHUB_MONTHLY_USAGE_LIMIT)) return null;
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
}

// Freebuff daily quota: 429 with a validated resetAt (the executor's parseError
// verifies Number.isFinite + clamps to next Pacific midnight — an untrusted
// upstream body can never extend the lock past one quota window). Both freebuff
// branches run BEFORE the capped generic resetsAtMs path below, whose
// MAX_RATE_LIMIT_COOLDOWN_MS (30 min) would truncate a Pacific-midnight wait
// (up to ~24h) into 30-minute retry churn against a dead quota.
function freebuffDailyResetMs(status, errorText, provider, resetsAtMs) {
  if (resolveProviderId(provider) !== "freebuff" || Number(status) !== 429) return null;
  if (resetsAtMs && Number.isFinite(resetsAtMs) && resetsAtMs > Date.now()) return resetsAtMs;
  const m = String(errorText || "").match(/resets at (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/);
  if (m) {
    const t = Date.parse(m[1]);
    if (Number.isFinite(t) && t > Date.now()) return t;
  }
  return null;
}

// Freebuff model_locked: the account's ONE session is locked to another model.
// 65-minute per-model lock (one session TTL) instead of the generic 2-min, so
// selection steers to other accounts instead of churning against the lock.
function freebuffModelLockedMs(status, errorText, provider) {
  if (resolveProviderId(provider) !== "freebuff" || Number(status) !== 409) return null;
  if (!String(errorText || "").includes("model_locked")) return null;
  return FREEBUFF_MODEL_LOCK_MS;
}

// Freebuff bounded cooldowns (reference freebuff-proxy ratelimit.go): minutes-
// scale refusals that must rotate accounts for their window — never the capped
// generic path (which truncates at 30min and loses the code), never the daily-
// quota midnight lock. Most are account-wide (the upstream counter is per
// account/IP); invalid_agent_model is the (egress, model) pairing only.
const FREEBUFF_BOUNDED_CODES = [
  { marker: "free_mode_run_fanout", ms: FREEBUFF_COOLDOWNS.RUN_FANOUT_MS, accountWide: true },
  { marker: "free_mode_invalid_agent_model", ms: FREEBUFF_COOLDOWNS.INVALID_AGENT_MODEL_MS, accountWide: false },
  { marker: "load_shedding", ms: FREEBUFF_COOLDOWNS.LOAD_SHED_MS, accountWide: true },
  { marker: "peak_hours", ms: FREEBUFF_COOLDOWNS.PEAK_HOURS_MS, accountWide: true },
  { marker: "ip_capped", ms: FREEBUFF_COOLDOWNS.IP_CAPPED_DEFAULT_MS, accountWide: true },
  { marker: "waiting_room_required", ms: FREEBUFF_COOLDOWNS.WAITING_ROOM_RETRY_MS, accountWide: true },
  { marker: "waiting_room_queued", ms: FREEBUFF_COOLDOWNS.WAITING_ROOM_RETRY_MS, accountWide: true },
  { marker: "session_limit_reached", ms: FREEBUFF_COOLDOWNS.WAITING_ROOM_RETRY_MS, accountWide: true },
];
function freebuffBoundedCooldown(status, errorText, provider) {
  if (resolveProviderId(provider) !== "freebuff") return null;
  // The executor surfaces the bounded family as 429 (rate codes), 428
  // (waiting_room_required) and 503 (waiting_room_queued) — all three ride
  // this branch instead of the capped generic path.
  if (![428, 429, 503].includes(Number(status))) return null;
  const text = String(errorText || "");
  for (const entry of FREEBUFF_BOUNDED_CODES) {
    if (text.includes(entry.marker)) return { cooldownMs: entry.ms, accountWide: entry.accountWide };
  }
  return null;
}

// Freebuff ban: 403 {"status":"banned"} / {"error":"account_suspended"} —
// terminal account fate. 24h default lock (no resumes_at upstream) or until
// the body's resumes_at, ceiling-clamped. Account-wide, and it MUST precede
// the capped generic resetsAtMs branch (30min cap would release a ban early).
function freebuffBanCooldownMs(status, errorText, provider) {
  if (resolveProviderId(provider) !== "freebuff" || Number(status) !== 403) return null;
  const text = String(errorText || "");
  if (!text.includes("banned") && !text.includes("account_suspended")) return null;
  // Two shapes carry the resume moment: the executor's synthesized message
  // ("…resumes at <ISO>…") and a raw upstream body ("resumes_at":"<ISO>").
  let m = text.match(/resumes? at (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/i);
  if (!m) m = text.match(/"resumes_at"\s*:\s*"(\d{4}-\d{2}-\d{2}T[\d:.]+Z)"/i);
  if (m) {
    const t = Date.parse(m[1]);
    if (Number.isFinite(t) && t > Date.now()) {
      return Math.min(t - Date.now(), FREEBUFF_MAX_COOLDOWN_MS);
    }
  }
  return FREEBUFF_COOLDOWNS.BAN_MS;
}

/**
 * The virtual "Public" connection for no-auth free lanes — with the optional
 * proxy pool from per-provider settings. Shared by the category:"free"
 * providers and the hybrid freeTier lane below.
 */
async function buildVirtualNoAuthConnection(providerId) {
  const settings = await getSettings();
  const override = (settings.providerStrategies || {})[providerId] || {};
  const strategy = override.rotateStrategy || "none";
  let pickedId = override.proxyPoolId || null;
  if (strategy !== "none") {
    const allPools = await getProxyPools({ isActive: true });
    const poolIds = allPools.filter(p => p.proxyUrl).map(p => p.id);
    pickedId = pickProxyPoolId(poolIds, strategy, providerId);
  }
  const resolvedProxy = await resolveConnectionProxyConfig({ proxyPoolId: pickedId || "" });
  return {
    id: "noauth",
    connectionName: "Public",
    isActive: true,
    accessToken: "public",
    providerSpecificData: {
      connectionProxyEnabled: resolvedProxy.connectionProxyEnabled,
      connectionProxyUrl: resolvedProxy.connectionProxyUrl,
      connectionNoProxy: resolvedProxy.connectionNoProxy,
      connectionProxyPoolId: resolvedProxy.proxyPoolId || null,
      vercelRelayUrl: resolvedProxy.vercelRelayUrl || "",
    },
  };
}

/**
 * Get provider credentials from localDb
 * Filters out unavailable accounts and returns the selected account based on strategy
 * @param {string} provider - Provider name
 * @param {Set<string>|string|null} excludeConnectionIds - Connection ID(s) to exclude (for retry with next account)
 * @param {string|null} model - Model name for per-model rate limit filtering
 */
export async function getProviderCredentials(provider, excludeConnectionIds = null, model = null, options = {}) {
  // Normalize to Set for consistent handling
  const excludeSet = excludeConnectionIds instanceof Set
    ? excludeConnectionIds
    : (excludeConnectionIds ? new Set([excludeConnectionIds]) : new Set());
  const preferredConnectionId = options?.preferredConnectionId || null;
  // Acquire mutex to prevent race conditions
  const currentMutex = selectionMutex;
  let resolveMutex;
  selectionMutex = new Promise(resolve => { resolveMutex = resolve; });

  try {
    await currentMutex;

    // Resolve alias to provider ID (e.g., "kc" -> "kilocode")
    const providerId = resolveProviderId(provider);

    // Inject a virtual connection for no-auth free providers (with optional proxy pool from settings)
    if (FREE_PROVIDERS[providerId]?.noAuth) {
      return buildVirtualNoAuthConnection(providerId);
    }

    // Hybrid noAuth freeTier lane (e.g. OpenCode Zen): real apikey connections
    // ALWAYS take precedence — the virtual "Public" connection is injected only
    // when the provider has no active connections at all. Fall-through with
    // existing connections lets the normal selection below handle strategy,
    // model locks and preferred pins exactly as for any keyed provider.
    if (FREE_TIER_PROVIDERS[providerId]?.noAuth) {
      const existing = await getProviderConnections({ provider: providerId, isActive: true });
      if (existing.length === 0) {
        return buildVirtualNoAuthConnection(providerId);
      }
    }

    const connections = await getProviderConnections({ provider: providerId, isActive: true });
    log.debug("AUTH", `${provider} | total connections: ${connections.length}, excludeIds: ${excludeSet.size > 0 ? [...excludeSet].join(",") : "none"}, model: ${model || "any"}`);

    if (connections.length === 0) {
      log.warn("AUTH", `No credentials for ${provider}`);
      return null;
    }

    // Filter out model-locked and excluded connections
    const availableConnections = connections.filter(c => {
      if (excludeSet.has(c.id)) return false;
      if (isModelLockActive(c, model)) return false;
      return true;
    });

    log.debug("AUTH", `${provider} | available: ${availableConnections.length}/${connections.length}`);
    connections.forEach(c => {
      const excluded = excludeSet.has(c.id);
      const locked = isModelLockActive(c, model);
      if (excluded || locked) {
        const lockUntil = getEarliestModelLockUntil(c);
        log.debug("AUTH", `  → ${c.id?.slice(0, 8)} | ${excluded ? "excluded" : ""} ${locked ? `modelLocked(${model}) until ${lockUntil}` : ""}`);
      }
    });

    if (availableConnections.length === 0) {
      // Find earliest lock expiry across all connections for retry timing
      const lockedConns = connections.filter(c => isModelLockActive(c, model));
      const expiries = lockedConns.map(c => getEarliestModelLockUntil(c)).filter(Boolean);
      const earliest = expiries.sort()[0] || null;
      if (earliest) {
        const earliestConn = lockedConns[0];
        log.warn("AUTH", `${provider} | all ${connections.length} accounts locked for ${model || "all"} (${formatRetryAfter(earliest)}) | lastError=${earliestConn?.lastError?.slice(0, 50)}`);
        return {
          allRateLimited: true,
          retryAfter: earliest,
          retryAfterHuman: formatRetryAfter(earliest),
          lastError: earliestConn?.lastError || null,
          lastErrorCode: earliestConn?.errorCode || null
        };
      }
      log.warn("AUTH", `${provider} | all ${connections.length} accounts unavailable`);
      return null;
    }

    const settings = await getSettings();
    // Per-provider strategy overrides global setting
    const providerOverride = (settings.providerStrategies || {})[providerId] || {};
    const strategy = providerOverride.fallbackStrategy || settings.fallbackStrategy || "fill-first";

    let connection;
    // Pin to preferred connection if specified and available
    if (preferredConnectionId) {
      connection = availableConnections.find((c) => c.id === preferredConnectionId);
      if (connection) {
        log.info("AUTH", `${provider} | pinned to ${connection.id?.slice(0, 8)} (${connection.name || connection.email || "unnamed"})`);
      }
    }
    if (connection) {
      // skip strategy
    } else if (strategy === "round-robin") {
      const stickyLimit = providerOverride.stickyRoundRobinLimit || settings.stickyRoundRobinLimit || 3;

      // Sort by lastUsed (most recent first) to find current candidate
      const byRecency = [...availableConnections].sort((a, b) => {
        if (!a.lastUsedAt && !b.lastUsedAt) return (a.priority || 999) - (b.priority || 999);
        if (!a.lastUsedAt) return 1;
        if (!b.lastUsedAt) return -1;
        return new Date(b.lastUsedAt) - new Date(a.lastUsedAt);
      });

      const current = byRecency[0];
      const currentCount = current?.consecutiveUseCount || 0;

      if (current && current.lastUsedAt && currentCount < stickyLimit) {
        // Stay with current account
        connection = current;
        // Update lastUsedAt and increment count (await to ensure persistence)
        await updateProviderConnection(connection.id, {
          lastUsedAt: new Date().toISOString(),
          consecutiveUseCount: (connection.consecutiveUseCount || 0) + 1
        });
      } else {
        // Pick the least recently used (excluding current if possible)
        const sortedByOldest = [...availableConnections].sort((a, b) => {
          if (!a.lastUsedAt && !b.lastUsedAt) return (a.priority || 999) - (b.priority || 999);
          if (!a.lastUsedAt) return -1;
          if (!b.lastUsedAt) return 1;
          return new Date(a.lastUsedAt) - new Date(b.lastUsedAt);
        });

        connection = sortedByOldest[0];

        // Update lastUsedAt and reset count to 1 (await to ensure persistence)
        await updateProviderConnection(connection.id, {
          lastUsedAt: new Date().toISOString(),
          consecutiveUseCount: 1
        });
      }
    } else {
      // Default: fill-first (already sorted by priority in getProviderConnections)
      connection = availableConnections[0];
    }

    const resolvedProxy = await resolveConnectionProxyConfig(connection.providerSpecificData || {});

    return {
      authType: connection.authType,
      apiKey: connection.apiKey,
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken,
      idToken: connection.idToken,
      expiresAt: connection.expiresAt,
      expiresIn: connection.expiresIn,
      lastRefreshAt: connection.lastRefreshAt,
      projectId: connection.projectId,
      connectionName: connection.displayName || connection.name || connection.email || connection.id,
      copilotToken: connection.providerSpecificData?.copilotToken,
      providerSpecificData: {
        ...(connection.providerSpecificData || {}),
        connectionProxyEnabled: resolvedProxy.connectionProxyEnabled,
        connectionProxyUrl: resolvedProxy.connectionProxyUrl,
        connectionNoProxy: resolvedProxy.connectionNoProxy,
        connectionProxyPoolId: resolvedProxy.proxyPoolId || null,
        vercelRelayUrl: resolvedProxy.vercelRelayUrl || "",
      },
      connectionId: connection.id,
      // Include current status for optimization check
      testStatus: connection.testStatus,
      lastError: connection.lastError,
      // Pass full connection for clearAccountError to read modelLock_* keys
      _connection: connection
    };
  } finally {
    if (resolveMutex) resolveMutex();
  }
}

/**
 * Mark account+model as unavailable — locks modelLock_${model} in DB.
 * All errors (429, 401, 5xx, etc.) lock per model, not per account.
 * @param {string} connectionId
 * @param {number} status - HTTP status code from upstream
 * @param {string} errorText
 * @param {string|null} provider
 * @param {string|null} model - The specific model that triggered the error
 * @returns {{ shouldFallback: boolean, cooldownMs: number }}
 */
export async function markAccountUnavailable(connectionId, status, errorText, provider = null, model = null, resetsAtMs = null) {
  if (!connectionId || connectionId === "noauth") return { shouldFallback: false, cooldownMs: 0 };

  // Fleet outcome signal — poolId derivable from DB (pool ID → provider-specific data stored per connection)
  const connections = await getProviderConnections({ provider });
  const conn = connections.find(c => c.id === connectionId);
  const poolId = conn?.providerSpecificData?.connectionProxyPoolId;
  try {
    await fleet.recordOutcome(poolId || "", provider || "", { ok: false, latencyMs: undefined });
  } catch { /* fire-and-forget: never break login */ }

  const backoffLevel = conn?.backoffLevel || 0;

  // GitHub premium-request exhaustion is account-wide until the next UTC month.
  const githubResetAtMs = githubMonthlyResetMs(status, errorText, provider);
  // Freebuff taxonomy: ban (24h account-wide) → bounded cooldowns (rotating
  // windows; per-model ONLY for invalid_agent_model) → daily-quota reset
  // (Pacific midnight, account-wide) → model_locked (per-model 65min). Bounded
  // PRECEDES daily-quota because chatCore hands over a resetsAtMs even for
  // bounded kinds (parseError projects now+window) — the daily branch would
  // capture it and flatten the accountWide distinction. Genuine daily-quota
  // text carries no bounded marker, so the order is unambiguous. All precede
  // the capped generic resetsAtMs branch below, whose MAX_RATE_LIMIT_COOLDOWN_MS
  // (30 min) would truncate a Pacific-midnight wait (up to ~24h) into
  // 30-minute retry churn.
  const freebuffBanMs = freebuffBanCooldownMs(status, errorText, provider);
  const freebuffBounded = freebuffBoundedCooldown(status, errorText, provider);
  const freebuffResetAtMs = freebuffBounded ? null : freebuffDailyResetMs(status, errorText, provider, resetsAtMs);
  const freebuffLockMs = freebuffModelLockedMs(status, errorText, provider);

  // Provider-specific precise cooldown (e.g. codex usage_limit_reached resets_at) overrides backoff
  let shouldFallback, cooldownMs, newBackoffLevel;
  if (githubResetAtMs) {
    shouldFallback = true;
    cooldownMs = githubResetAtMs - Date.now();
    newBackoffLevel = 0;
  } else if (freebuffBanMs) {
    shouldFallback = true;
    cooldownMs = freebuffBanMs;
    newBackoffLevel = 0;
  } else if (freebuffResetAtMs) {
    shouldFallback = true;
    cooldownMs = freebuffResetAtMs - Date.now();
    newBackoffLevel = 0;
  } else if (freebuffBounded) {
    shouldFallback = true;
    cooldownMs = freebuffBounded.cooldownMs;
    newBackoffLevel = 0;
  } else if (freebuffLockMs) {
    shouldFallback = true;
    cooldownMs = freebuffLockMs;
    newBackoffLevel = 0;
  } else if (resetsAtMs && resetsAtMs > Date.now()) {
    shouldFallback = true;
    cooldownMs = Math.min(resetsAtMs - Date.now(), MAX_RATE_LIMIT_COOLDOWN_MS);
    newBackoffLevel = 0;
  } else {
    ({ shouldFallback, cooldownMs, newBackoffLevel } = checkFallbackError(status, errorText, backoffLevel));
  }
  if (!shouldFallback) return { shouldFallback: false, cooldownMs: 0 };

  const reason = typeof errorText === "string" ? errorText.slice(0, 100) : "Provider error";
  // GitHub + freebuff ban + freebuff daily quota are account-wide; freebuff
  // bounded codes rotate accounts (account-wide) except invalid_agent_model
  // (the (egress, model) pairing); everything else is per-model.
  const accountWide = !!(githubResetAtMs || freebuffBanMs || freebuffResetAtMs || (freebuffBounded && freebuffBounded.accountWide));
  const lockModel = accountWide ? null : model;
  const lockUpdate = buildModelLockUpdate(lockModel, cooldownMs);

  await updateProviderConnection(connectionId, {
    ...lockUpdate,
    testStatus: "unavailable",
    lastError: reason,
    errorCode: status,
    lastErrorAt: new Date().toISOString(),
    backoffLevel: newBackoffLevel ?? backoffLevel
  });

  const lockKey = Object.keys(lockUpdate)[0];
  const connName = conn?.displayName || conn?.name || conn?.email || connectionId.slice(0, 8);
  log.warn("AUTH", `${connName} locked ${lockKey} for ${Math.round(cooldownMs / 1000)}s [${status}]`);

  if (provider && status && reason) {
    console.error(`❌ ${provider} [${status}]: ${reason}`);
  }

  return { shouldFallback: true, cooldownMs };
}

/**
 * Clear account error status on successful request.
 * - Clears modelLock_${model} (the model that just succeeded)
 * - Lazy-cleans any other expired modelLock_* keys
 * - Resets error state only if no active locks remain
 * @param {string} connectionId
 * @param {object} currentConnection - credentials object (has _connection) or raw connection
 * @param {string|null} model - model that succeeded
 */
export async function clearAccountError(connectionId, currentConnection, model = null) {
  if (!connectionId || connectionId === "noauth") return;

  // Fleet outcome signal — poolId derivable from connection provider-specific data
  const conn = currentConnection._connection || currentConnection;
  const poolId = conn?.providerSpecificData?.connectionProxyPoolId;
  try {
    await (async () => {
      const fleet = await import("@/lib/network/proxyFleet.js");
      await fleet.recordOutcome(poolId || "", "freebuff", { ok: true, latencyMs: undefined });
    })();
  } catch { /* fire-and-forget: never break login */ }

  const now = Date.now();
  const allLockKeys = Object.keys(conn).filter(k => k.startsWith("modelLock_"));

  if (!conn.testStatus && !conn.lastError && allLockKeys.length === 0) return;

  // Keys to clear: current model's lock + all expired locks
  const keysToClear = allLockKeys.filter(k => {
    if (model && k === `modelLock_${model}`) return true; // succeeded model
    if (model && k === "modelLock___all") return true;    // account-level lock
    const expiry = conn[k];
    return expiry && new Date(expiry).getTime() <= now;   // expired
  });

  if (keysToClear.length === 0 && conn.testStatus !== "unavailable" && !conn.lastError) return;

  // Check if any active locks remain after clearing
  const remainingActiveLocks = allLockKeys.filter(k => {
    if (keysToClear.includes(k)) return false;
    const expiry = conn[k];
    return expiry && new Date(expiry).getTime() > now;
  });

  const clearObj = Object.fromEntries(keysToClear.map(k => [k, null]));

  // Only reset error state if no active locks remain
  if (remainingActiveLocks.length === 0) {
    Object.assign(clearObj, {
      testStatus: "active",
      lastError: null,
      errorCode: null,
      lastErrorAt: null,
      backoffLevel: 0
    });
  }

  await updateProviderConnection(connectionId, clearObj);
}

/**
 * Extract API key from request headers
 */
export function extractApiKey(request) {
  // Check Authorization header first
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  // Check Anthropic x-api-key header
  const xApiKey = request.headers.get("x-api-key");
  if (xApiKey) {
    return xApiKey;
  }

  return null;
}

/**
 * Validate API key (optional - for local use can skip)
 */
export async function isValidApiKey(apiKey) {
  if (!apiKey) return false;
  return await validateApiKey(apiKey);
}
