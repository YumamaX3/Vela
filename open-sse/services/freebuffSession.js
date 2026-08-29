/**
 * Freebuff session layer — claim lifecycle, gate classification, persisted state.
 *
 * One account holds ONE session locked to ONE model (GLM-5.2 1h upstream TTL,
 * everything else 24h — freebuffSessionTtlMs). The quota unit IS the session
 * claim, so this module is written around one invariant: NEVER POST to the
 * session endpoint unless we intend to burn a claim unit. Quota reads and
 * token-health probes are GET-only (see usage/freebuff.js, probeFreebuffToken).
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
  FREEBUFF_ME_URL,
  FREEBUFF_STREAK_URL,
  FREEBUFF_ADS_URL,
  FREEBUFF_SESSION_FETCH_TIMEOUT_MS,
  FREEBUFF_WAITING_ROOM_FETCH_TIMEOUT_MS,
  FREEBUFF_SESSION_STALE_STATUSES,
  FREEBUFF_RECLAIMABLE_CODES,
  FREEBUFF_MODEL_LOCKED_CODE,
  FREEBUFF_SUPERSEDED_CODE,
  FREEBUFF_CLAIM_BLOCKED_CODES,
  FREEBUFF_USER_AGENT,
  FREEBUFF_BUN_USER_AGENT,
  FREEBUFF_CLI_ADS_UA,
  FREEBUFF_AD_BROWSER_UAS,
  FREEBUFF_WAITING_ROOM_AD_PROVIDERS,
  FREEBUFF_MODEL_AGENT_IDS,
  FREEBUFF_FALLBACK_AGENT_ID,
  FREEBUFF_COOLDOWNS,
  FREEBUFF_MAX_COOLDOWN_MS,
  FREEBUFF_PACIFIC_TZ,
  freebuffSessionTtlMs,
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
// reclaim logic. Extracts whitelisted scalars only — raw upstream JSON is
// never spread into stored objects.

function parseEpochMs(raw) {
  if (raw == null) return null;
  let parsed = typeof raw === "string" ? Date.parse(raw) : Number(raw);
  // Unix seconds (< 1e12) → ms; upstream is free to emit either.
  if (Number.isFinite(parsed) && parsed > 0 && parsed < 1e12) parsed *= 1000;
  return Number.isFinite(parsed) ? parsed : null;
}

function extractScalars(bodyText) {
  const out = { code: null, message: null, resetAt: null, retryAfterMs: null, period: null, limit: null, recentCount: null, resumesAt: null };
  if (typeof bodyText !== "string" || !bodyText) return out;
  try {
    const json = JSON.parse(bodyText);
    const src = json && typeof json === "object" && json.error && typeof json.error === "object" ? json.error : json;
    if (src && typeof src === "object") {
      if (typeof src.code === "string") out.code = src.code;
      else if (typeof src.status === "string") out.code = src.status;
      if (typeof src.message === "string") out.message = src.message;
      out.resetAt = parseEpochMs(src.resetAt ?? src.reset_at ?? src.resets_at ?? src.resetAtMs);
      const rawRetry = src.retryAfterMs ?? src.retry_after_ms;
      if (rawRetry != null) {
        const n = Number(rawRetry);
        // retryAfterMs is a DURATION (ms), never an epoch — clamp to the ceiling.
        if (Number.isFinite(n) && n > 0) out.retryAfterMs = Math.min(n, FREEBUFF_MAX_COOLDOWN_MS);
      }
      if (typeof src.period === "string") out.period = src.period;
      if (Number.isFinite(Number(src.limit))) out.limit = Number(src.limit);
      if (Number.isFinite(Number(src.recentCount ?? src.recent_count))) out.recentCount = Number(src.recentCount ?? src.recent_count);
      out.resumesAt = parseEpochMs(src.resumes_at ?? src.resumesAt);
    }
  } catch { /* body is not JSON — return empty scalars */ }
  return out;
}

/** Clamp an upstream-sourced cooldown to the 7-day ceiling. */
export function clampFreebuffCooldownMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.min(ms, FREEBUFF_MAX_COOLDOWN_MS);
}

/**
 * True when a no-timestamp quota refusal is a genuine daily cap: the period is
 * pacific_day/pacific_week AND the recent counter sits at/over the limit (the
 * session-quota bodies the CLI serves on daily-cap refusals). Only these lock
 * until Pacific midnight; every other opaque 429 gets a bounded backoff.
 */
function isDailyCapScalars(s) {
  if (s.period !== "pacific_day" && s.period !== "pacific_week") return false;
  return s.limit > 0 && s.recentCount != null && s.recentCount >= s.limit;
}

/**
 * Classify a chat-error gate — the full ~20-code matrix (reference
 * freebuff-proxy ratelimit.go classifyError, re-verified 2026-08-30).
 * Returns { kind, code, message, resetAt?, retryAfterMs? } where kind ∈
 *   reclaimable | model_locked | superseded | session_limit | limited_ip
 *   | stale_unknown | banned | country_blocked | cli_required | run_fanout
 *   | invalid_agent_model | capacity_deferred | load_shedding | peak_hours
 *   | ip_capped | waiting_room_queued | waiting_room_required | auth
 *   | daily_quota | bounded_429 | other.
 *
 * Exact body-marker matching where upstream markers are exact (a 403 that
 * merely MENTIONS "banned" in its message stays a generic refusal — the
 * canonical ban bodies are {"status":"banned"} and {"error":"account_suspended"}).
 */
export function classifyGate(status, bodyText) {
  const s = extractScalars(bodyText);
  const lower = typeof bodyText === "string" ? bodyText.toLowerCase() : "";

  // ── terminal account fates (exact markers — ratelimit.go audit B5) ─────
  if (status === 403 && (lower.includes('"status":"banned"') || lower.includes('"error":"account_suspended"'))) {
    return {
      kind: "banned", code: s.code || "banned", message: s.message,
      ...(s.resumesAt ? { resetAt: s.resumesAt } : {}),
    };
  }
  if (status === 403 && lower.includes("country_blocked")) {
    return { kind: "country_blocked", code: "country_blocked", message: s.message };
  }
  // ── body-marker driven, status-agnostic ────────────────────────────────
  if (lower.includes("free_mode_run_fanout")) {
    return { kind: "run_fanout", code: "free_mode_run_fanout", message: s.message, retryAfterMs: FREEBUFF_COOLDOWNS.RUN_FANOUT_MS };
  }
  if (lower.includes("free_mode_capacity_deferred")) {
    // The free tier's transient capacity queue: "your request will be retried
    // automatically" — retry IN PLACE against the same session (executor).
    return { kind: "capacity_deferred", code: "free_mode_capacity_deferred", message: s.message, retryAfterMs: s.retryAfterMs };
  }
  if (lower.includes("free_mode_invalid_agent_model")) {
    return { kind: "invalid_agent_model", code: "free_mode_invalid_agent_model", message: s.message, retryAfterMs: FREEBUFF_COOLDOWNS.INVALID_AGENT_MODEL_MS };
  }
  if (lower.includes("waiting_room_queued")) {
    // Transient admission race — the session row is fine (endsTheSession:false).
    return { kind: "waiting_room_queued", code: "waiting_room_queued", message: s.message, retryAfterMs: FREEBUFF_COOLDOWNS.WAITING_ROOM_RETRY_MS };
  }
  if (lower.includes("waiting_room_required")) {
    // The account must walk the ad-chain + streak flow before the next session
    // create. Session row fine — nothing invalidated.
    return { kind: "waiting_room_required", code: "waiting_room_required", message: s.message, retryAfterMs: s.retryAfterMs };
  }
  if (lower.includes("ip_capped")) {
    // Admission-only: too many distinct users on the egress IP. NOT tied to a
    // quota reset — bounded retryAfterMs, never Pacific midnight.
    return {
      kind: "ip_capped", code: "ip_capped", message: s.message,
      retryAfterMs: clampFreebuffCooldownMs(s.retryAfterMs) || FREEBUFF_COOLDOWNS.IP_CAPPED_DEFAULT_MS,
    };
  }
  if (lower.includes("session_superseded")) {
    // TERMINAL gate (endsTheSession:true): another instance took the account.
    // Never auto-reacquire in-request — the next request re-joins fresh.
    return { kind: "superseded", code: FREEBUFF_SUPERSEDED_CODE, message: s.message };
  }
  if (lower.includes("session_model_mismatch") && lower.includes("limited")) {
    // The egress IP cannot serve the requested model — session stays bound to
    // its admitted model; cool the (egress, model) pairing, not the session.
    return { kind: "limited_ip", code: "session_model_mismatch", message: s.message };
  }

  // ── status-scoped session staleness (409/410/428) ──────────────────────
  if (FREEBUFF_SESSION_STALE_STATUSES.has(status)) {
    if (status === 409 && s.code === "session_limit_reached") {
      // Account over its concurrent-tab budget; this session row is fine.
      return { kind: "session_limit", code: "session_limit_reached", message: s.message, retryAfterMs: FREEBUFF_COOLDOWNS.WAITING_ROOM_RETRY_MS };
    }
    if (status === 403 || s.code === FREEBUFF_MODEL_LOCKED_CODE) {
      if (s.code === FREEBUFF_MODEL_LOCKED_CODE) return { kind: "model_locked", code: s.code, message: s.message };
    }
    if (FREEBUFF_RECLAIMABLE_CODES.has(s.code)) return { kind: "reclaimable", code: s.code, message: s.message };
    if (s.code === FREEBUFF_MODEL_LOCKED_CODE) return { kind: "model_locked", code: s.code, message: s.message };
    // Remaining staleness markers (reference ErrSessionInvalid family)
    if (["freebuff_update_required", "session_expired", "session_model_mismatch", "model_locked", "free_mode_legacy_luna_agent", "free_mode_legacy_luna"].includes(s.code)) {
      return { kind: "reclaimable", code: s.code, message: s.message };
    }
    return { kind: "stale_unknown", code: s.code, message: s.message };
  }

  // ── auth death ─────────────────────────────────────────────────────────
  if (status === 401) return { kind: "auth", code: s.code, message: s.message };

  // ── 403 CLI gate ───────────────────────────────────────────────────────
  if (status === 403 && lower.includes("free_mode_cli_required")) {
    return { kind: "cli_required", code: "free_mode_cli_required", message: s.message };
  }

  // ── quota family ───────────────────────────────────────────────────────
  if (status === 429 || s.code === "rate_limited" || s.code === "spend_limited") {
    if (lower.includes("insufficient_quota") || lower.includes("limit_burst_rate")) {
      // Upstream load saturation — minutes-scale, never a midnight lock.
      return { kind: "load_shedding", code: "load_shedding", message: s.message, retryAfterMs: FREEBUFF_COOLDOWNS.LOAD_SHED_MS };
    }
    if (lower.includes("peak hours")) {
      return { kind: "peak_hours", code: "peak_hours", message: s.message, retryAfterMs: FREEBUFF_COOLDOWNS.PEAK_HOURS_MS };
    }
    // Genuine daily cap: a validated resetAt, or a daily/weekly period at/over
    // the limit. Everything else is an opaque 429 → bounded backoff.
    if (s.resetAt || isDailyCapScalars(s)) {
      return { kind: "daily_quota", code: s.code || "quota_exhausted", message: s.message, ...(s.resetAt ? { resetAt: s.resetAt } : {}) };
    }
    return { kind: "bounded_429", code: s.code || "rate_limited", message: s.message, retryAfterMs: FREEBUFF_COOLDOWNS.OPAQUE_429_MS };
  }

  return { kind: "other", code: s.code, message: s.message };
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

// G5 UA scoping: session/claim/streak/agent-runs calls carry the plain Bun UA
// — the ai-sdk UA rides the chat POST ONLY.
function sessionHeaders(credentials) {
  return {
    Authorization: `Bearer ${credentials.accessToken}`,
    "User-Agent": FREEBUFF_BUN_USER_AGENT,
  };
}

// ── waiting-room chain (reference ads.go FireWaitingRoomChain) ─────────────
// When upstream stamps waiting_room_required (428), the account must walk the
// ad-chain + streak flow before the next session create. Strictly best-effort:
// every failure is swallowed — the chain never blocks or fails a claim.

function adsDeviceBlock() {
  const platform = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux";
  let timezone = "UTC";
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) timezone = tz;
  } catch { /* UTC fallback */ }
  let locale = "en-US";
  try {
    const raw = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG;
    if (raw) {
      const lang = raw.split(".")[0].replace(/_/g, "-");
      if (lang && lang !== "C" && lang !== "POSIX") locale = lang;
    }
  } catch { /* en-US fallback */ }
  return { os: platform, timezone, locale };
}

export async function fireWaitingRoomChain(credentials, proxyOptions = null, log = null) {
  const token = credentials?.accessToken;
  if (!token) return;
  const device = adsDeviceBlock();
  const browserUA = FREEBUFF_AD_BROWSER_UAS[device.os] || FREEBUFF_AD_BROWSER_UAS.linux;
  for (const provider of FREEBUFF_WAITING_ROOM_AD_PROVIDERS) {
    try {
      await proxyAwareFetch(FREEBUFF_ADS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "User-Agent": FREEBUFF_CLI_ADS_UA,
        },
        body: JSON.stringify({ provider, messages: [], device, userAgent: browserUA, surface: "waiting_room" }),
        signal: AbortSignal.timeout(FREEBUFF_WAITING_ROOM_FETCH_TIMEOUT_MS),
      }, buildSessionProxyOptions(credentials));
    } catch (err) {
      log?.debug?.("FREEBUFF", `waiting-room ads ${provider} failed: ${err?.message}`);
    }
  }
  try {
    await proxyAwareFetch(FREEBUFF_STREAK_URL, {
      method: "GET",
      headers: sessionHeaders(credentials),
      signal: AbortSignal.timeout(FREEBUFF_WAITING_ROOM_FETCH_TIMEOUT_MS),
    }, buildSessionProxyOptions(credentials));
  } catch (err) {
    log?.debug?.("FREEBUFF", `waiting-room streak failed: ${err?.message}`);
  }
}

/** Read + clear the waiting-room flag; returns true when the chain must fire. */
async function consumeWaitingRoomFlag(credentials) {
  const fb = credentials?.providerSpecificData?.freebuff;
  if (!fb?.waitingRoomRequiredAt) return false;
  const connectionId = credentials?.connectionId;
  if (connectionId) {
    try {
      const conn = credentials?._connection || null;
      const existingPsd = conn?.providerSpecificData || credentials?.providerSpecificData || {};
      const existingFb = { ...(existingPsd.freebuff || {}) };
      delete existingFb.waitingRoomRequiredAt;
      await updateProviderConnection(connectionId, {
        providerSpecificData: { ...existingPsd, freebuff: existingFb },
      });
    } catch { /* best-effort — the flag clears in-memory below */ }
  }
  if (credentials.providerSpecificData?.freebuff) {
    delete credentials.providerSpecificData.freebuff.waitingRoomRequiredAt;
  }
  return true;
}

/**
 * Stamp the waiting-room flag (a 428 waiting_room_required arrived). The NEXT
 * claim walks the ad chain before burning a unit. DB writes stay in this file.
 */
export async function stampWaitingRoomRequired(credentials) {
  const connectionId = credentials?.connectionId;
  if (!connectionId) return;
  try {
    const conn = credentials?._connection || null;
    const existingPsd = conn?.providerSpecificData || credentials?.providerSpecificData || {};
    const existingFb = existingPsd.freebuff || {};
    await updateProviderConnection(connectionId, {
      providerSpecificData: { ...existingPsd, freebuff: { ...existingFb, waitingRoomRequiredAt: new Date().toISOString() } },
    });
    if (credentials.providerSpecificData) {
      credentials.providerSpecificData.freebuff = {
        ...(credentials.providerSpecificData.freebuff || {}),
        waitingRoomRequiredAt: new Date().toISOString(),
      };
    }
  } catch { /* best-effort — the in-memory stamp below still serves this process */ }
  if (credentials.providerSpecificData) {
    credentials.providerSpecificData.freebuff = {
      ...(credentials.providerSpecificData.freebuff || {}),
      waitingRoomRequiredAt: new Date().toISOString(),
    };
  }
}

/**
 * Claim a session for (connection, model) — POST with x-freebuff-model. This
 * BURNS one quota unit; callers must only reach it when no warm session exists.
 * Serialized per (connection|model) by a promise-chain mutex that releases on
 * timeout/error.
 *
 * Wire ceremony (reference #120): the POST carries NO body and therefore NO
 * Content-Type — the CLI's session POST is a bare fetch with Authorization +
 * the x-freebuff-model header only.
 */
export async function claimSession(credentials, model, proxyOptions = null, signal = null, log = null) {
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

    // Waiting-room ceremony: a prior 428 stamped the flag — walk the ad chain
    // before burning the claim unit (best-effort, reference FireWaitingRoomChain).
    if (await consumeWaitingRoomFlag(credentials)) {
      await fireWaitingRoomChain(credentials, proxyOptions, log);
    }

    const timeoutSignal = AbortSignal.timeout(FREEBUFF_SESSION_FETCH_TIMEOUT_MS);
    const merged = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    const response = await proxyAwareFetch(FREEBUFF_SESSION_URL, {
      method: "POST",
      headers: { ...sessionHeaders(credentials), "x-freebuff-model": model },
      // #120: bodyless POST, no Content-Type.
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
        // Per-model TTL: GLM rows expire upstream in 1h; everything else in 24h.
        expiresAt: new Date(now + freebuffSessionTtlMs(model)).toISOString(),
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
      // Per-model margin — upstream TTL is otherwise opaque here; stale state
      // self-heals through the executor's reclaim-once loop.
      expiresAt: new Date(now + freebuffSessionTtlMs(model)).toISOString(),
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

  return await claimSession(credentials, model, proxyOptions, signal, log);
}

/**
 * Zero-cost token-health probe (reference ProbeAccount + tokenhealth.go):
 * GET session WITHOUT an instance-id header claims no slot and burns no quota;
 * GET /api/v1/me confirms the token still resolves an account. Returns
 * { ok, sessionStatus?, account? } — read-only, never throws.
 */
export async function probeFreebuffToken(credentials, proxyOptions = null) {
  const token = credentials?.accessToken;
  if (!token) return { ok: false, error: "missing token" };
  const opts = buildSessionProxyOptions(credentials);
  let sessionStatus = null;
  try {
    const res = await proxyAwareFetch(FREEBUFF_SESSION_URL, {
      method: "GET",
      headers: sessionHeaders(credentials),
      signal: AbortSignal.timeout(FREEBUFF_SESSION_FETCH_TIMEOUT_MS),
    }, opts);
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      const g = classifyGate(res.status, text);
      return { ok: false, sessionStatus: res.status, gate: g };
    }
    try {
      const json = JSON.parse(text);
      const src = json && typeof json === "object" && json.session && typeof json.session === "object" ? json.session : json;
      sessionStatus = typeof src?.status === "string" ? src.status : "unknown";
    } catch { sessionStatus = "unparseable"; }
  } catch (err) {
    return { ok: false, error: err?.message || "probe failed" };
  }
  try {
    const res = await proxyAwareFetch(FREEBUFF_ME_URL, {
      method: "GET",
      headers: sessionHeaders(credentials),
      signal: AbortSignal.timeout(FREEBUFF_SESSION_FETCH_TIMEOUT_MS),
    }, opts);
    if (!res.ok) return { ok: sessionStatus !== null, sessionStatus, account: null, error: `me ${res.status}` };
  } catch { /* account leg best-effort — the session leg already spoke */ }
  return { ok: true, sessionStatus };
}

/** Test hooks — module state must reset between unit tests. */
export const __test__ = {
  reset() {
    sessionMirror.clear();
    claimChains.clear();
    warnedDirectEgress.clear();
  },
  mirrorSize: () => sessionMirror.size,
  isDailyCapScalars,
};
