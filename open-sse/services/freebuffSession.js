/**
 * Freebuff session layer — claim lifecycle, gate classification, persisted state.
 *
 * One account holds ONE session locked to ONE model (~1h server TTL). The
 * quota unit IS the session claim (~6/day, per egress IP, Pacific-midnight
 * reset), so this module is written around one invariant: NEVER POST to the
 * session endpoint unless we intend to burn a claim unit. Quota reads are
 * GET-only (see usage/freebuff.js).
 *
 * State of record: connection.providerSpecificData.freebuff.session, persisted
 * by the connections JSON column (survives restarts). An in-memory mirror
 * serves the affinity resolver's hot path; every mutation writes through both.
 *
 * This is open-sse's session helper, and the only new open-sse file that
 * imports @/lib (precedent: chatCore imports @/lib/usageDb.js). DB writes are
 * confined to this file — never scattered into the executor.
 */
import { getProviderConnections, updateProviderConnection } from "@/lib/localDb";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import {
  FREEBUFF_SESSION_URL,
  FREEBUFF_SESSION_TTL_MS,
  FREEBUFF_SESSION_FETCH_TIMEOUT_MS,
  FREEBUFF_SESSION_STALE_STATUSES,
  FREEBUFF_RECLAIMABLE_CODES,
  FREEBUFF_MODEL_LOCKED_CODE,
  FREEBUFF_CLAIM_BLOCKED_CODES,
  FREEBUFF_USER_AGENT,
  FREEBUFF_MODEL_AGENT_IDS,
  FREEBUFF_FALLBACK_AGENT_ID,
  FREEBUFF_PACIFIC_TZ,
} from "../config/freebuff.js";

// ── in-memory mirror (hot path for the affinity resolver) ──────────────────
// connectionId -> { model, instanceId, agentId, claimedAt, expiresAt }
const sessionMirror = new Map();
// claim mutex: `${connectionId}|${model}` -> promise chain
const claimChains = new Map();
const warnedDirectEgress = new Set();

function isLive(session, now = Date.now()) {
  return !!session && !!session.model && !!session.expiresAt && new Date(session.expiresAt).getTime() > now;
}

/** Read persisted claim state from a credentials object. */
export function getPersistedSession(credentials) {
  return credentials?.providerSpecificData?.freebuff?.session || null;
}

/** Mirror read — the resolver's first stop. */
export function readMirror(connectionId) {
  const s = sessionMirror.get(connectionId);
  return isLive(s) ? s : null;
}

/**
 * Find the connection holding a live session for `model` — mirror first,
 * then a persisted scan (small table; freebuff has few connections).
 * Returns connectionId or null. Never throws.
 */
export async function findWarmConnection(model) {
  if (!model) return null;
  const now = Date.now();
  for (const [connectionId, session] of sessionMirror) {
    if (session?.model === model && isLive(session, now)) return connectionId;
  }
  try {
    const connections = await getProviderConnections({ provider: "freebuff", isActive: true });
    for (const conn of connections) {
      const session = conn?.providerSpecificData?.freebuff?.session;
      if (session?.model === model && isLive(session, now)) return conn.id;
    }
  } catch { /* fail-open — affinity is advisory */ }
  return null;
}

/**
 * Write claim state through mirror + DB. The repo merge is shallow — spread
 * the existing providerSpecificData or proxy config keys are wiped.
 */
export async function writeSession(credentials, session) {
  const connectionId = credentials?.connectionId;
  if (!connectionId) return;
  if (session) sessionMirror.set(connectionId, session);
  else sessionMirror.delete(connectionId);
  try {
    const conn = credentials?._connection || null;
    const existingPsd = conn?.providerSpecificData || credentials?.providerSpecificData || {};
    const existingFb = existingPsd.freebuff || {};
    await updateProviderConnection(connectionId, {
      providerSpecificData: { ...existingPsd, freebuff: { ...existingFb, session } },
    });
    if (credentials.providerSpecificData) {
      credentials.providerSpecificData.freebuff = {
        ...(credentials.providerSpecificData.freebuff || {}),
        session,
      };
    }
  } catch { /* DB write failed — mirror still serves this process */ }
}

/** Clear claim state (401 / terminal supersede / connection removal). */
export async function clearSession(credentials, reason = null) {
  const connectionId = credentials?.connectionId;
  if (!connectionId) return;
  sessionMirror.delete(connectionId);
  try {
    const conn = credentials?._connection || null;
    const existingPsd = conn?.providerSpecificData || credentials?.providerSpecificData || {};
    const existingFb = existingPsd.freebuff || {};
    const patch = { providerSpecificData: { ...existingPsd, freebuff: { ...existingFb, session: null } } };
    if (reason) patch.providerSpecificData.freebuff.lastClaimError = { code: reason, at: new Date().toISOString() };
    await updateProviderConnection(connectionId, patch);
    if (credentials.providerSpecificData?.freebuff) {
      credentials.providerSpecificData.freebuff.session = null;
      if (reason) credentials.providerSpecificData.freebuff.lastClaimError = { code: reason, at: new Date().toISOString() };
    }
  } catch { /* best-effort */ }
}

// ── gate classification — status + structured code ONLY ────────────────────
// Never match upstream message text: it is untrusted data and must not drive
// reclaim logic. Extracts whitelisted scalars only (code, message, resetAt) —
// raw upstream JSON is never spread into stored objects.

function extractScalars(bodyText) {
  const out = { code: null, message: null, resetAt: null };
  if (typeof bodyText !== "string" || !bodyText) return out;
  try {
    const json = JSON.parse(bodyText);
    const src = json && typeof json === "object" && json.error && typeof json.error === "object" ? json.error : json;
    if (src && typeof src === "object") {
      if (typeof src.code === "string") out.code = src.code;
      else if (typeof src.status === "string") out.code = src.status;
      if (typeof src.message === "string") out.message = src.message;
      const raw = src.resetAt ?? src.reset_at ?? src.resets_at ?? src.resetAtMs;
      const parsed = typeof raw === "string" ? Date.parse(raw) : Number(raw);
      if (Number.isFinite(parsed)) out.resetAt = parsed;
    }
  } catch { /* body is not JSON — return empty scalars */ }
  return out;
}

/**
 * Classify a chat-error gate. Returns { kind, code, message, resetAt? } where
 * kind ∈ reclaimable | model_locked | stale_unknown | quota | auth | other.
 */
export function classifyGate(status, bodyText) {
  const { code, message, resetAt } = extractScalars(bodyText);
  if (FREEBUFF_SESSION_STALE_STATUSES.has(status)) {
    if (FREEBUFF_RECLAIMABLE_CODES.has(code)) return { kind: "reclaimable", code, message };
    if (code === FREEBUFF_MODEL_LOCKED_CODE) return { kind: "model_locked", code, message };
    return { kind: "stale_unknown", code, message };
  }
  if (status === 429) return { kind: "quota", code: code || "rate_limited", message, resetAt };
  if (status === 401) return { kind: "auth", code, message };
  return { kind: "other", code, message };
}

/**
 * Classify a claim-POST response body (2xx with a session-state payload).
 * kind ∈ active | model_locked | blocked | other.
 */
export function classifyClaimResponse(bodyText) {
  const { code, message } = extractScalars(bodyText);
  let instanceId = null;
  try {
    const json = JSON.parse(bodyText);
    const src = json && typeof json === "object" && json.error && typeof json.error === "object" ? json.error : json;
    if (src && typeof src.instanceId === "string") instanceId = src.instanceId;
  } catch { /* ignore */ }
  if (code === "active" && instanceId) return { kind: "active", code, message, instanceId };
  if (code === FREEBUFF_MODEL_LOCKED_CODE) return { kind: "model_locked", code, message };
  if (FREEBUFF_CLAIM_BLOCKED_CODES.has(code)) return { kind: "blocked", code, message };
  return { kind: "other", code, message, instanceId };
}

// ── Pacific-midnight clock ──────────────────────────────────────────────────
// Daily quota resets at Pacific midnight. Two-pass offset correction handles
// DST transitions (pinned test vectors: 2026-03-08 / 2026-11-01).

function pacificOffsetMs(ts) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: FREEBUFF_PACIFIC_TZ,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = {};
  for (const p of dtf.formatToParts(new Date(ts))) parts[p.type] = p.value;
  const asUTC = Date.UTC(parts.year, parts.month - 1, parts.day, Number(parts.hour) % 24, parts.minute, parts.second);
  return asUTC - ts;
}

/** Epoch ms of the NEXT Pacific midnight after `fromMs`. */
export function pacificMidnightMs(fromMs = Date.now()) {
  const off = pacificOffsetMs(fromMs);
  const wall = new Date(fromMs + off); // LA wall clock expressed as UTC
  const nextMidnightWall = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() + 1, 0, 0, 0, 0);
  const guess = nextMidnightWall - off;
  const offAtGuess = pacificOffsetMs(guess);
  return nextMidnightWall - offAtGuess;
}

/**
 * Validate + clamp an upstream resetAt. An untrusted body can never extend a
 * lock past the quota window: invalid → next Pacific midnight; finite values
 * are clamped to it.
 */
export function clampFreebuffResetMs(resetAtMs, now = Date.now()) {
  const midnight = pacificMidnightMs(now);
  if (!Number.isFinite(resetAtMs) || resetAtMs <= now) return midnight;
  return Math.min(resetAtMs, midnight);
}

// ── claim lifecycle ─────────────────────────────────────────────────────────

function buildSessionProxyOptions(credentials) {
  const psd = credentials?.providerSpecificData || {};
  // Freebuff quota is keyed to the session's egress IP. When the connection
  // routes through a proxy, session calls MUST use it too (strictProxy — the
  // standard usage route hard-forces strictProxy:false; we deliberately do not
  // inherit that) or we would claim/read against the wrong IP.
  return psd.connectionProxyUrl
    ? { ...psd, strictProxy: true }
    : psd;
}

function warnDirectEgressOnce(credentials) {
  const connectionId = credentials?.connectionId || "unknown";
  if (warnedDirectEgress.has(connectionId)) return;
  const psd = credentials?.providerSpecificData || {};
  const envProxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY || process.env.all_proxy;
  if (!psd.connectionProxyUrl && !envProxy) {
    warnedDirectEgress.add(connectionId);
    console.warn(
      `[freebuff] direct egress — free-tier quota is per egress IP and ToS bans are terminal; ` +
      `configure a connection proxy for IP isolation (connection ${connectionId}).`
    );
  }
}

function sessionHeaders(credentials) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${credentials.accessToken}`,
    "User-Agent": FREEBUFF_USER_AGENT,
  };
}

/**
 * Claim a session for (connection, model) — POST with x-freebuff-model. This
 * BURNS one quota unit; callers must only reach it when no warm session exists.
 * Serialized per (connection|model) by a promise-chain mutex that releases on
 * timeout/error.
 */
export async function claimSession(credentials, model, proxyOptions = null, signal = null) {
  const connectionId = credentials?.connectionId || "unknown";
  const key = `${connectionId}|${model}`;
  const prev = claimChains.get(key) || Promise.resolve();

  let releaseChain;
  const gate = new Promise((resolve) => { releaseChain = resolve; });
  claimChains.set(key, prev.then(() => gate));

  try {
    await prev;
    // Double-check after acquiring the chain — another request may have claimed.
    const fresh = getPersistedSession(credentials) || readMirror(connectionId);
    if (fresh?.model === model && isLive(fresh)) return fresh;

    warnDirectEgressOnce(credentials);
    const timeoutSignal = AbortSignal.timeout(FREEBUFF_SESSION_FETCH_TIMEOUT_MS);
    const merged = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    const response = await proxyAwareFetch(FREEBUFF_SESSION_URL, {
      method: "POST",
      headers: { ...sessionHeaders(credentials), "x-freebuff-model": model },
      body: JSON.stringify({}),
      signal: merged,
    }, buildSessionProxyOptions(credentials));

    const text = await response.text().catch(() => "");
    if (!response.ok) {
      // Claim-block statuses (country_blocked, banned, ip_capped, …) arrive as
      // non-2xx with a structured status field — classify them as claim gates,
      // not generic HTTP errors, so the executor surfaces them correctly.
      const claimCls = classifyClaimResponse(text);
      const gateInfo = claimCls.kind === "blocked" || claimCls.kind === "model_locked"
        ? { kind: claimCls.kind, code: claimCls.code, message: claimCls.message }
        : classifyGate(response.status, text);
      const err = new Error(`Freebuff session claim failed (${response.status}${gateInfo.code ? ` ${gateInfo.code}` : ""})${gateInfo.message ? `: ${gateInfo.message.slice(0, 160)}` : ""}`);
      err.freebuffGate = gateInfo;
      throw err;
    }

    const claim = classifyClaimResponse(text);
    if (claim.kind === "active") {
      const now = Date.now();
      const session = {
        model,
        instanceId: claim.instanceId,
        agentId: FREEBUFF_MODEL_AGENT_IDS[model] || FREEBUFF_FALLBACK_AGENT_ID,
        claimedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + FREEBUFF_SESSION_TTL_MS).toISOString(),
      };
      await writeSession(credentials, session);
      return session;
    }

    const err = new Error(`Freebuff session claim refused (${claim.code || "unknown"})${claim.message ? `: ${claim.message.slice(0, 160)}` : ""}`);
    err.freebuffGate = { kind: claim.kind === "blocked" ? "blocked" : claim.kind, code: claim.code, message: claim.message };
    await clearSession(credentials, claim.code || "claim_failed");
    throw err;
  } finally {
    releaseChain();
    if (claimChains.get(key) && prev === Promise.resolve()) claimChains.delete(key);
  }
}

/**
 * GET-only warm-session rediscovery (first use after boot). Costs no quota
 * unit. Best-effort: adopts an upstream-active session only when the response
 * carries a parseable model + instanceId; anything less falls through to claim.
 */
export async function discoverWarmSession(credentials, proxyOptions = null) {
  try {
    const timeoutSignal = AbortSignal.timeout(FREEBUFF_SESSION_FETCH_TIMEOUT_MS);
    const response = await proxyAwareFetch(FREEBUFF_SESSION_URL, {
      method: "GET",
      headers: sessionHeaders(credentials),
      signal: timeoutSignal,
    }, buildSessionProxyOptions(credentials));
    if (!response.ok) return null;
    const text = await response.text().catch(() => "");
    let json = null;
    try { json = JSON.parse(text); } catch { return null; }
    const src = json && typeof json === "object" && json.session && typeof json.session === "object" ? json.session : json;
    const status = typeof src?.status === "string" ? src.status : null;
    const model = typeof src?.model === "string" ? src.model : null;
    const instanceId = typeof src?.instanceId === "string" ? src.instanceId : null;
    if (status !== "active" || !model || !instanceId) return null;
    const now = Date.now();
    const session = {
      model,
      instanceId,
      agentId: FREEBUFF_MODEL_AGENT_IDS[model] || FREEBUFF_FALLBACK_AGENT_ID,
      claimedAt: new Date(now).toISOString(),
      // Upstream TTL is opaque here — keep the claimed session on our margin;
      // stale state self-heals through the executor's reclaim-once loop.
      expiresAt: new Date(now + FREEBUFF_SESSION_TTL_MS).toISOString(),
    };
    await writeSession(credentials, session);
    return session;
  } catch { return null; }
}

/**
 * Ensure a live session for (connection, model): warm state → boot rediscovery
 * (once per boot per connection) → claim under the mutex.
 */
export async function ensureSession(credentials, model, proxyOptions = null, signal = null, log = null) {
  const warm = getPersistedSession(credentials);
  if (warm?.model === model && isLive(warm)) return warm;

  const connectionId = credentials?.connectionId;
  const fb = credentials?.providerSpecificData?.freebuff || {};
  if (connectionId && !fb.bootedDiscoveryAt) {
    const discovered = await discoverWarmSession(credentials, proxyOptions);
    try {
      const existingPsd = credentials.providerSpecificData || {};
      await updateProviderConnection(connectionId, {
        providerSpecificData: {
          ...existingPsd,
          freebuff: { ...(existingPsd.freebuff || {}), bootedDiscoveryAt: new Date().toISOString() },
        },
      });
    } catch { /* best-effort stamp */ }
    if (discovered?.model === model) return discovered;
    log?.debug?.("FREEBUFF", `boot rediscovery: ${discovered ? `found ${discovered.model}` : "no warm session"}`);
  }

  return await claimSession(credentials, model, proxyOptions, signal);
}

/** Test hooks — module state must reset between unit tests. */
export const __test__ = {
  reset() {
    sessionMirror.clear();
    claimChains.clear();
    warnedDirectEgress.clear();
  },
  mirrorSize: () => sessionMirror.size,
};
