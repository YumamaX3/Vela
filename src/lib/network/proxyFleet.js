/**
 * Fleet Captain — central intelligence for proxy fleet operations
 *
 * One module owns: selection policy, fitness store, health scheduling,
 * geo-probing, re-pick arbitration. Every other module becomes a thin client.
 *
 * Design Decisions:
 * - global.__velaProxyFleet singleton survives dev hot-reload (mirrorPump precedent)
 * - All public functions wrapped in try/catch (fail-open law)
 * - In-memory EWMA store; 30s flush timer (EXEMPT replay class)
 * - Selection = byte-identical legacy until first fitness signal (C15)
 *
 * Sealed Decrees Honored:
 * - Fitness key = per-(pool, provider) + wildcard row (C14)
 * - Block-override pin policy (pin respected until geo-block proves unfit)
 * - Egress codes locked {country_blocked, ip_capped} only (C16)
 *
 * Proxy Completion Covenant (v0.9.5, W1):
 * - global.dbClient hallucination killed — lazy getAdapter() house idiom
 *   (driver.js:116-120; precedent kvStore:7, metaStore:4, backupEngine:269)
 * - getProxyPools import gap fixed (was called but never imported — repick and
 *   resolveVirtualConnection silently no-op'd through fail-open)
 * - pickRandom index bug fixed (returned a poolId string, not an index)
 * - probeEgress/checkPoolHealth real (ipify + geo, socks-aware proxyTest)
 * - detectIdlePools() — zero-outcome + 30d age → unfit idle_ttl_exceeded (7d TTL)
 * - dynamic sweep concurrency min(16, max(4, ceil(N/50)))
 * - init() lifecycle replaces auto-run initCaptain() side effects
 *
 * v0.9.42 — The Live Wounds. The two claims above that this tide corrects:
 * "probeEgress/checkPoolHealth real" was false — both called symbols that were
 * never imported, so neither ever ran. The same class of wound getProxyPools
 * had, one function away, surviving a fix that claimed to have closed it.
 * And the fitness signal chain has never carried a production signal: auth.js
 * reads connectionProxyPoolId, a field that exists only in synthesized
 * credentials, so recordOutcome received "" and its guard returned every time.
 * pickSmart therefore returned poolIds[0] unconditionally. Both are repaired.
 */

// v0.9.42: renamed from `resetFitness` — the repo fn is db-FIRST
// (`resetFitness(db, poolId, providerId)`), and the facade re-exported it raw,
// so callers using the natural `(poolId, providerId)` arity shifted their args:
// `db` received the poolId string and `db.run` threw "is not a function" behind
// a generic 500. The module now owns a caller-facing wrapper of that name.
import { getFitnessRows, upsertFitnessBatch, resetFitness as resetFitnessRows } from "../db/repos/proxyFitnessRepo.js";
import { getProxyPools, getProxyPoolById, updateProxyPool } from "../db/repos/proxyPoolsRepo.js";
import { getAdapter } from "../db/driver.js";
import { resolveConnectionProxyConfig } from "./connectionProxy.js";
import { isAvailable, recordFailure, recordSuccess, onRetryAfter, flushNow as flushBreakerNow } from "./circuitBreaker.js";
import { setPoolGeo } from "./poolGeo.js"; // v0.9.18 — shared egress geo registry
// v0.9.42 — two symbols this module CALLED but never imported. Each threw a
// ReferenceError that its caller's fail-open catch swallowed into {ok:false},
// which is indistinguishable from "this pool is dead":
//   testProxyUrl (checkPoolHealth) — the unimported symbol behind the fleet
//     self-liquidation. Now the shared probe, which also routes relay pools
//     through their own envelope and classifies the verdict honestly.
//   proxyAwareFetch (probeEgress)  — the real fetch path; getDispatcher, which
//     probeEgress also called, is not exported by proxyFetch.js at all and its
//     result was never used.
import { testPoolReachability } from "./proxyTest.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";

const RE_PICK_CODES = new Set(["country_blocked", "ip_capped"]); // C16 LOCKED
const MAX_REPICKS = 3;
const REPICK_BUDGET_MS = 45_000;
const FLUSH_INTERVAL_MS = 30_000;
const ALPHA_EWMA = 0.3;
const HALF_LIFE_DAYS = 7;

// ── probe constants (real egress — Proxy Completion Covenant W1) ───────────
const IPIFY_URL = "https://api.ipify.org?format=json";
const GEO_URL = "http://ip-api.com/json/{ip}?fields=status,countryCode,country";
const PROBE_TIMEOUT_MS = 8000;
const PROBE_CACHE_TTL_MS = 30_000; // sliding window — never bucket-aligned
const IDLE_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30d zero-outcome quiet
const IDLE_UNFIT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7d self-recovering TTL
const AUTO_DISABLE_TIMEOUT_MS = 8_000;

// ───────────────────────────────────────────────────────────────────────────
// In-Memory Store (boot loads persisted rows)
// ───────────────────────────────────────────────────────────────────────────

let fitnessStore = null;
let loaded = false;
let dirtyKeys = new Set();
let flushTimer = null;
let flushArmed = false;
const probeCache = new Map(); // poolId -> { ip, country, observedAt } — sliding window
let healthSchedulerStarted = false;

/**
 * Load persisted fitness rows into memory
 */
async function loadFitness() {
  try {
    // Wrap in try/catch — boot failure defaults to neutral/legacy behavior
    const db = await getAdapter(); // lazy singleton — house idiom
    const rows = await getFitnessRows(db);
    fitnessStore = new Map();

    for (const row of rows) {
      const key = `${row.poolId}|${row.provider}`;
      fitnessStore.set(key, {
        ...row,
        // Convert to mutable structure
        unreadiedAt: row.lastOutcomeAt ? Date.parse(row.lastOutcomeAt) : Date.now(),
      });
    }

    loaded = true;
  } catch (err) {
    // Boot fail-open: empty store = neutral fitness = legacy behavior (C15)
    console.warn("[proxyFleet] boot failed — defaulting to neutral fitness:", err.message);
    fitnessStore = new Map();
    loaded = true;
  }
}

/**
 * Get or create fitness entry for a pool/provider pair
 * @param {string} poolId
 * @param {string} provider
 * @returns {object} fitness object
 */
function getOrCreateFitness(poolId, provider) {
  const key = `${poolId}|${provider}`;

  if (!loaded || !fitnessStore.has(key)) {
    // Create neutral entry if missing
    const nowIso = new Date().toISOString();
    fitnessStore.set(key, {
      poolId,
      provider,
      successCount: 0,
      failureCount: 0,
      successEwma: 0.5,
      latencyEwmaMs: 0,
      lastOutcomeAt: null,
      unfit: 0,
      unfitReason: null,
      unfitUntil: null,
      egressIp: null,
      egressCountry: null,
      updatedAt: nowIso,
      unreadiedAt: Date.now(),
    });
  }

  return fitnessStore.get(key);
}

/**
 * Decay fitness score based on age (read-time decay, no writes)
 * @param {object} fitness
 * @returns {number} weighted score
 */
function computeScore(fitness) {
  const successRate = fitness.successCount === 0 && fitness.failureCount === 0
    ? 0.5
    : fitness.successCount / (fitness.successCount + fitness.failureCount);

  const latenciesFactor = fitness.latencyEwmaMs > 0
    ? Math.max(0, 1 - fitness.latencyEwmaMs / 5000) // normalize to 0-1 over 5s
    : 1;

  // Age decay toward neutral 0.5 with 7d half-life
  const ageDays = (Date.now() - fitness.unreadiedAt) / (1000 * 60 * 60 * 24);
  const decay = 0.5 + (0.5 * Math.pow(0.5, ageDays / HALF_LIFE_DAYS));

  // Final weight: blend success rate with recency penalty
  return successRate * latenciesFactor * decay;
}

/**
 * Mark key as dirty (needs flush)
 */
function markDirty(poolId, provider) {
  dirtyKeys.add(`${poolId}|${provider}`);
  scheduleFlush();
}

/**
 * Schedule batched flush (if not already armed)
 */
function scheduleFlush() {
  if (flushArmed) return;

  flushArmed = true;

  // Immediate check in case we're mid-flush
  if (dirtyKeys.size >= 32) {
    flushNow();
    return;
  }

  flushTimer = setTimeout(() => {
    flushNow();
  }, FLUSH_INTERVAL_MS);

  flushTimer.unref();
}

/**
 * Execute flush now (exported for testing)
 */
export async function flushNow() {
  if (dirtyKeys.size === 0) return;

  const rowsToFlush = [];
  const nowIso = new Date().toISOString();

  for (const key of dirtyKeys) {
    const fitness = fitnessStore.get(key);
    if (fitness) {
      rowsToFlush.push({
        poolId: fitness.poolId,
        provider: fitness.provider,
        successCount: fitness.successCount,
        failureCount: fitness.failureCount,
        successEwma: fitness.successEwma,
        latencyEwmaMs: fitness.latencyEwmaMs,
        lastOutcomeAt: fitness.lastOutcomeAt || null,
        unfit: fitness.unfit,
        unfitReason: fitness.unfitReason || null,
        unfitUntil: fitness.unfitUntil || null,
        egressIp: fitness.egressIp || null,
        egressCountry: fitness.egressCountry || null,
        updatedAt: nowIso,
      });
    }
  }

  try {
    const db = await getAdapter();
    await upsertFitnessBatch(db, rowsToFlush);
  } catch (err) {
    console.warn("[proxyFleet] flush failed:", err.message);
  } finally {
    dirtyKeys.clear();
    flushArmed = false;
  }
}

/**
 * Commit changes after EWMA update (persist dirty)
 */
function commitUpdate(poolId, provider, updates) {
  const fitness = getOrCreateFitness(poolId, provider);
  Object.assign(fitness, updates);
  markDirty(poolId, provider);
}

/**
 * Reset fitness for a pool (optionally scoped to one provider).
 *
 * v0.9.42: this is the caller-facing wrapper the facade re-exported as
 * `resetFitness` — but the repo fn is db-first, so the natural (poolId,
 * providerId) call shifted args and threw behind a generic 500 (fitness/route
 * POST). The wrapper takes the adapter itself.
 *
 * It purges THREE places, not one, or the reset silently undoes itself:
 *   1. the persisted rows (resetFitnessRows — the repo DELETE),
 *   2. the in-memory fitnessStore entries (else the next getOrCreateFitness
 *      hands back stale counts), and
 *   3. any pending dirtyKeys for those entries (else the next 30s flushNow
 *      re-upserts exactly what was just deleted — the resurrection trap).
 *
 * @param {string} poolId
 * @param {string|null} providerId - null/"" resets every provider for the pool
 * @returns {number} rows cleared from the in-memory store
 */
export async function resetFitness(poolId, providerId = null) {
  const db = await getAdapter();
  await resetFitnessRows(db, poolId, providerId);

  // Purge memory + pending writes for the same scope. A providerId of null/""
  // matches every key for this pool; a specific providerId matches one key.
  const inScope = (key) => (providerId === null || providerId === "")
    ? key.startsWith(`${poolId}|`)
    : key === `${poolId}|${providerId}`;

  let cleared = 0;
  if (fitnessStore) {
    for (const key of [...fitnessStore.keys()]) {
      if (inScope(key)) { fitnessStore.delete(key); cleared++; }
    }
  }
  for (const key of [...dirtyKeys]) {
    if (inScope(key)) dirtyKeys.delete(key);
  }
  return cleared;
}

// ───────────────────────────────────────────────────────────────────────────
// Selection Family (hot path — sync where possible)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Pick pool ID using strategy
 * @param {Array} poolIds
 * @param {{strategy: string, pinnedPoolId?: string|null, providerId: string}} policy
 * @returns {string|null}
 */
export function pick(poolIds, policy) {
  try {
    const { strategy, pinnedPoolId, providerId } = policy;

    if (!poolIds || poolIds.length === 0) return null;
    if (poolIds.length === 1) return poolIds[0];

    switch (strategy) {
      case "smart":
        return pickSmart(poolIds, providerId, pinnedPoolId);
      case "round-robin":
        return pickRoundRobin(poolIds, providerId);

      case "random": {
        // C17: return a poolId (the string), not an index that leaks into
        // callers expecting an id — the weighted draw's `id` is used downstream.
        return poolIds[Math.floor(Math.random() * poolIds.length)];
      }

      case "none":
      default:
        return poolIds[0];
    }
  } catch (err) {
    // Fail-open: fall back to first pool
    console.warn("[proxyFleet] pick failed:", err.message);
    return poolIds[0];
  }
}

/**
 * Smart: fitness-weighted order (with fallback to legacy if no signals)
 * Circuit Breaker integration: pre-filter !isAvailable BEFORE unfit check (Seam 1)
 */
function pickSmart(poolIds, providerId, pinnedPoolId) {
  // Build fitness map for this provider
  const fitnessMap = new Map();
  let anySignal = false;
  
  // Circuit breaker pre-filter: exclude unavailable keys before fitness scoring
  const availableIds = [];
  for (const id of poolIds) {
    const fitness = getOrCreateFitness(id, providerId);
    fitnessMap.set(id, fitness);
    
    if (fitness.successCount > 0 || fitness.failureCount > 0) {
      anySignal = true;
    }
    
    // Circuit breaker check: isAvailable returns true for healthy OR cooldown passed
    if (isAvailable(id, providerId, "")) {
      availableIds.push(id);
    }
  }
  
  if (!anySignal) {
    // No signals yet: round-robin by pool ID order (byte-identical legacy)
    return poolIds[0];
  }
  
  // Score and filter out unfit pools from AVAILABLE pools only
  const scored = [];
  const now = Date.now();
  
  for (const id of availableIds) {
    const fitness = fitnessMap.get(id);
    
    // Check unfitness TTL — expiry IS the auto-reenable (Gate 11 verified)
    if (fitness.unfit && fitness.unfitUntil) {
      const unfitUntil = Date.parse(fitness.unfitUntil);
      if (now < unfitUntil) continue; // still unfit
    }
    
    const weight = computeScore(fitness);
    scored.push({ id, weight });
  }
  
  if (scored.length === 0) return poolIds[0]; // all unfit → first one
  
  // Weighted random draw among fit pools
  const totalWeight = scored.reduce((sum, s) => sum + s.weight, 0);
  let r = Math.random() * totalWeight;
  
  for (const { id, weight } of scored) {
    if (r < weight) return id;
    r -= weight;
  }
  
  return scored[scored.length - 1].id;
}

/**
 * Round-robin with per-provider state (legacy identity)
 */
function pickRoundRobin(poolIds, providerId) {
  const stateKey = `rr_${providerId}`;
  const state = global.__velaProxyState?.[stateKey] || { index: -1 };
  state.index = (state.index + 1) % poolIds.length;
  global.__velaProxyState = global.__velaProxyState || {};
  global.__velaProxyState[stateKey] = state;
  return poolIds[state.index];
}

/**
 * Resolve full proxy config for a connection
 */
export async function resolveForConnection(providerSpecificData, providerId) {
  try {
    const poolId = providerSpecificData?.connectionProxyPoolId;
    if (!poolId) return null;

    const resolved = await resolveConnectionProxyConfig({ proxyPoolId: poolId });
    return resolved;
  } catch (err) {
    console.warn("[proxyFleet] resolveForConnection failed:", err.message);
    return null;
  }
}

/**
 * Virtual connection resolution for noAuth lanes
 */
export async function resolveVirtualConnection(providerId) {
  try {
    const allPools = await getProxyPools({ isActive: true }); // self-binding facade
    const poolIds = allPools.filter(p => p.proxyUrl).map(p => p.id);
    const picked = pick(poolIds, { strategy: "smart", providerId });

    if (!picked) return null;

    const pool = await getProxyPoolById(picked);
    const resolved = await resolveConnectionProxyConfig({ proxyPoolId: picked });
    return {
      poolId: picked,
      pool,
      resolvedProxy: resolved,
    };
  } catch (err) {
    console.warn("[proxyFleet] resolveVirtualConnection failed:", err.message);
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Signal Family (write path — never throws, never blocks)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Record outcome signal (transport success/error)
 * Feeds circuit breaker: recordSuccess on ok, recordFailure on error
 */
export function recordOutcome(poolId, providerId, signal) {
  try {
    if (!poolId || !providerId || !signal) return;
    
    const fitness = getOrCreateFitness(poolId, providerId);
    
    if (signal.ok) {
      fitness.successCount++;
      fitness.successEwma = ALPHA_EWMA * 1 + (1 - ALPHA_EWMA) * fitness.successEwma;
      
      // Feed success to circuit breaker — resets consecutive failures
      recordSuccess(poolId, providerId, "");
    } else {
      fitness.failureCount++;
      fitness.successEwma = ALPHA_EWMA * 0 + (1 - ALPHA_EWMA) * fitness.successEwma;
      
      // Feed failure to circuit breaker — escalates state machine
      recordFailure(poolId, providerId, "", {});
    }
    
    if (signal.latencyMs !== undefined) {
      fitness.latencyEwmaMs = ALPHA_EWMA * signal.latencyMs + (1 - ALPHA_EWMA) * fitness.latencyEwmaMs;
    }
    
    fitness.lastOutcomeAt = new Date().toISOString();
    fitness.unreadiedAt = Date.now();
    
    markDirty(poolId, providerId);
  } catch (err) {
    // Fire-and-forget: never throw here
    console.debug("[proxyFleet] recordOutcome failed:", err.message);
  }
}

/**
 * Record claim gate (freeblock codes trigger unfit)
 * Maps country_blocked/ip_capped → onRetryAfter with TTL as ms (Seam 1 integration)
 */
export function recordClaimGate(poolId, providerId, code) {
  try {
    if (!RE_PICK_CODES.has(code)) return; // only egress-IP-scoped codes
    
    const fitness = getOrCreateFitness(poolId, providerId);
    
    if (code === "country_blocked" || code === "ip_capped") {
      fitness.blockCount = (fitness.blockCount || 0) + 1;
      fitness.lastBlockCode = code;
      
      const ttlMs = code === "country_blocked" ? 24 * 60 * 60 * 1000 : 1 * 60 * 60 * 1000; // 24h vs 1h
      fitness.unfit = 1;
      fitness.unfitReason = code;
      fitness.unfitUntil = new Date(Date.now() + ttlMs).toISOString();
      
      // Feed to circuit breaker: onRetryAfter honors the code's TTL as explicit Retry-After
      onRetryAfter(poolId, providerId, "", ttlMs);
      
      markDirty(poolId, providerId);
    }
  } catch (err) {
    console.debug("[proxyFleet] recordClaimGate failed:", err.message);
  }
}

/**
 * Instant re-pick loop (bounded attempt cap + latency budget)
 * Returns the picked poolId/providerId PLUS the rebuilt proxy options so the
 * executor never has to re-derive them (executor's local proxyOptions are a
 * snapshot — the covenant requires the fresh one returned, Gate 6 revision).
 */
export async function repick(model, excludePoolIds, maxAttempts = MAX_REPICKS, budgetMs = REPICK_BUDGET_MS, providerId = "freebuff") {
  try {
    const deadline = Date.now() + budgetMs;
    const excluded = new Set(excludePoolIds || []);
    let attempts = 0;

    while (attempts < maxAttempts) {
      if (Date.now() >= deadline) break;

      // v0.9.42: providerId was hardcoded "freebuff" inside the loop with a
      // "pass as param" TODO beside it. It is now a trailing parameter with
      // that same value as default — the lone caller (freebuff.js:367, four
      // positional args) is unchanged, and any future caller can name its own
      // provider instead of corrupting freebuff's fitness rows.
      const allPools = await getProxyPools({ isActive: true }); // self-binding facade
      const poolIds = allPools.filter(p => p.proxyUrl && !excluded.has(p.id)).map(p => p.id);

      if (poolIds.length === 0) break;

      const next = pick(poolIds, { strategy: "smart", providerId, pinnedPoolId: null });

      if (!next) break;

      // Rebuild the proxy options from the picked pool — the executor receives
      // this object to re-claim with (no header hacks, no second surface).
      const pool = await getProxyPoolById(next);
      const resolved = await resolveConnectionProxyConfig({ proxyPoolId: next });
      if (!resolved) {
        excluded.add(next); // unfit config — never pick it again this round
        attempts++;
        continue;
      }

      return { poolId: next, providerId, proxyOptions: resolved };
    }

    return null; // exhausted
  } catch (err) {
    console.error("[proxyFleet] repick failed:", err.message);
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Persistence Family
// ───────────────────────────────────────────────────────────────────────────

/**
 * Get fitness summary for UI/API consumption
 */
export function getFitnessSummary() {
  try {
    if (!fitnessStore) return { pools: [], count: 0 };

    const summary = [];
    for (const [key, fitness] of fitnessStore) {
      const [poolId, provider] = key.split("|");
      summary.push({
        poolId,
        provider,
        score: computeScore(fitness),
        successCount: fitness.successCount,
        failureCount: fitness.failureCount,
        lastOutcomeAt: fitness.lastOutcomeAt,
        unfit: fitness.unfit,
        unfitReason: fitness.unfitReason,
        unfitUntil: fitness.unfitUntil,
        egressIp: fitness.egressIp,
        egressCountry: fitness.egressCountry,
      });
    }
    return { pools: summary, count: summary.length };
  } catch (err) {
    console.warn("[proxyFleet] getFitnessSummary failed:", err.message);
    return { pools: [], count: 0 };
  }
}

// NOTE: resetFitness function removed - now uses imported version from proxyFitnessRepo.js
// This was causing duplicate declaration error during webpack bundling

// ───────────────────────────────────────────────────────────────────────────
// Probe Family (real egress — Proxy Completion Covenant W1)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Sliding-window probe cache — 30s per pool, keyed on observedAt (never
 * bucket-aligned: a probe 29s after the last hit is a HIT, a probe 31s after
 * is a MISS — no boundary races).
 */
function getCachedProbe(poolId) {
  const entry = probeCache.get(poolId);
  if (!entry) return null;
  if (Date.now() - entry.observedAt > PROBE_CACHE_TTL_MS) {
    probeCache.delete(poolId);
    return null;
  }
  return entry;
}

/**
 * Real IP-echo egress probe through the pool's dispatcher + geo lookup.
 * Fail-open contract: ipify/geo failures return {ok:false} with error — never
 * a crashed tick, never a stale "0.0.0.0" fib. The result is cached 30s.
 * @param {string} poolId
 * @param {object} pool - the pool row (has proxyUrl) — passed in to avoid an
 *   extra DB round-trip when the caller already holds it
 */
export async function probeEgress(poolId, pool = null) {
  try {
    const cached = getCachedProbe(poolId);
    if (cached) return { ok: true, ip: cached.ip, country: cached.country };

    const poolRow = pool || (await getProxyPoolById(poolId));
    if (!poolRow?.proxyUrl) return { ok: false, ip: null, country: null, error: "pool has no proxyUrl" };

    // v0.9.42: this used to build a dispatcher via getDispatcher — a symbol
    // proxyFetch.js never exported — and then never use it; both fetches below
    // already go through proxyAwareFetch, which builds its own dispatcher from
    // the same url. The dead call threw a ReferenceError on every probe, which
    // the catch turned into {ok:false}, so egress geo never populated.
    const urlOnly = poolRow.proxyUrl.startsWith("socks5://") || poolRow.proxyUrl.startsWith("http://")
      ? poolRow.proxyUrl
      : `http://${poolRow.proxyUrl}`;

    // Timing control: per-pool AbortController (timeout + caller signal)
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error("probe timeout")), PROBE_TIMEOUT_MS);

    let ip = null;
    let country = null;
    try {
      const res = await proxyAwareFetch(IPIFY_URL, { signal: ctrl.signal, headers: { "User-Agent": "Vela" } }, { enabled: true, url: urlOnly });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        ip = data?.ip || null;
      }
      const geoRes = ip && await proxyAwareFetch(GEO_URL.replace("{ip}", ip), { signal: ctrl.signal, headers: { "User-Agent": "Vela" } }, { enabled: true, url: urlOnly });
      if (geoRes?.ok) {
        const geo = await geoRes.json().catch(() => null);
        country = geo?.countryCode || geo?.country || null;
      }
    } finally {
      clearTimeout(timer);
    }

    // Persist egress into the fitness row (memory + dirty flush)
    if (ip) {
      const fitness = getOrCreateFitness(poolId, "freebuff");
      fitness.egressIp = ip;
      fitness.egressCountry = country;
      markDirty(poolId, "freebuff");
      // v0.9.18 — also feed the shared poolGeo registry (dashboard egress column).
      try {
        setPoolGeo(poolId, { ip, country });
      } catch { /* fail-open */ }
    }

    probeCache.set(poolId, { ip, country, observedAt: Date.now() });
    return { ok: true, ip, country };
  } catch (err) {
    return { ok: false, ip: null, country: null, error: err.message };
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Health Family (scheduler + bulk ops)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Start health scheduler (boot hook) — real 5-min sweep: idle detection,
 * bulk health check with dynamic concurrency, probe egress.
 *
 * v0.9.42: re-entrancy guard. A sweep over 1,000 pools can take far longer
 * than the 300s interval, so passes stacked on top of each other, each
 * re-disabling and re-probing the same rows. poolEgressProbe.js:96 already had
 * this guard (`if (probing) return`) — the health sweep lacked it.
 */
let sweepInFlight = false;

export function startHealthScheduler() {
  if (healthSchedulerStarted) return;
  healthSchedulerStarted = true;

  // Periodic bulk health check (concurrency-capped)
  setInterval(async () => {
    if (sweepInFlight) {
      console.warn("[proxyFleet] health sweep skipped — previous pass still in flight");
      return;
    }
    sweepInFlight = true;
    try {
      await detectIdlePools();
      await checkAllPools({ autoDisable: true });
    } catch (err) {
      console.warn("[proxyFleet] health scheduler failed:", err.message);
    } finally {
      sweepInFlight = false;
    }
  }, 300 * 1000); // every 5 minutes
}

/**
 * Stop health scheduler
 */
export function stopHealthScheduler() {
  healthSchedulerStarted = false;
}

/**
 * Check single pool health — shared type-aware probe (proxyTest.js).
 *
 * v0.9.42: was `testProxyUrl(...)`, never imported — every call threw a
 * ReferenceError that the catch below turned into {ok:false}, which the sweep
 * read as "dead" and disabled. This is the mechanism behind the fleet
 * self-liquidation, replicated to the mirror twin through updateProxyPool.
 *
 * Now returns a three-state `verdict`: "alive" | "dead" | "indeterminate".
 * Callers disable ONLY on "dead".
 *
 * @param {string} poolId
 * @param {object} [pool] - the pool row, when the caller already holds it
 *   (avoids the N+1 the bulk sweep was doing — probeEgress:559 is the
 *   in-file precedent for exactly this row-passing shape)
 */
export async function checkPoolHealth(poolId, pool = null) {
  try {
    const poolRow = pool || (await getProxyPoolById(poolId));
    if (!poolRow?.proxyUrl) {
      return { ok: false, verdict: "dead", elapsedMs: 0, error: "pool not found" };
    }

    const result = await testPoolReachability(poolRow, { timeoutMs: AUTO_DISABLE_TIMEOUT_MS });
    return {
      ok: result.verdict === "alive",
      verdict: result.verdict,
      elapsedMs: result.elapsedMs || 0,
      error: result.error || null,
      status: result.status ?? null,
    };
  } catch (err) {
    // A throw is INDETERMINATE, never death — the probe's own path may have
    // faltered (an unimported symbol did exactly that for months).
    return { ok: false, verdict: "indeterminate", elapsedMs: 0, error: err.message };
  }
}

/**
 * Bulk check all pools (capped concurrency — dynamic: min(16, max(4, ceil(N/50))))
 *
 * v0.9.42: two repairs.
 *  - autoDisable now fires ONLY on verdict === "dead". An indeterminate result
 *    (timeout, 5xx, rate-limited probe target, a throw) leaves the pool active
 *    and counts separately, so a probe-path outage can no longer empty the fleet.
 *  - the row is passed into checkPoolHealth instead of re-fetched per pool.
 *    The sweep already held every row at :670 and then did N+1 lookups anyway.
 */
export async function checkAllPools({ autoDisable = false, concurrency = null } = {}) {
  try {
    const allPools = await getProxyPools({ isActive: true });
    const results = [];

    // Dynamic concurrency — 1,000 pools must not take ~250s at a fixed 4
    const total = allPools.length;
    const dynamicConcurrency = concurrency ?? Math.min(16, Math.max(4, Math.ceil(total / 50)));

    // Concurrency-limited execution
    for (let i = 0; i < total; i += dynamicConcurrency) {
      const batch = allPools.slice(i, i + dynamicConcurrency);
      await Promise.all(batch.map(async (pool) => {
        const result = await checkPoolHealth(pool.id, pool);
        results.push({ poolId: pool.id, ...result });

        if (autoDisable && result.verdict === "dead") {
          // Auto-disable a PROVEN-dead pool only (timeout on the disable so a
          // hung DB write never stalls the sweep)
          await Promise.race([
            disablePool(pool.id),
            new Promise(r => setTimeout(r, AUTO_DISABLE_TIMEOUT_MS)),
          ]);
        }
      }));
    }

    return {
      total,
      alive: results.filter(r => r.verdict === "alive").length,
      dead: results.filter(r => r.verdict === "dead").length,
      indeterminate: results.filter(r => r.verdict === "indeterminate").length,
    };
  } catch (err) {
    console.warn("[proxyFleet] checkAllPools failed:", err.message);
    return null;
  }
}

/**
 * MIBP adoption: idle detection — pools with ZERO outcomes and age > 30d are
 * marked unfit idle_ttl_exceeded (7d TTL, self-recovering: pick() re-admits
 * when now >= unfitUntil — verified at the unfit filter).
 */
export async function detectIdlePools(unfitTtlMs = IDLE_UNFIT_TTL_MS) {
  try {
    if (!fitnessStore) return 0;
    const now = Date.now();
    let marked = 0;

    for (const [key, fitness] of fitnessStore) {
      const totalOutcomes = (fitness.successCount || 0) + (fitness.failureCount || 0);
      if (totalOutcomes > 0) continue; // active pairs are never idle
      const ageMs = now - (fitness.unreadiedAt || now);
      if (ageMs < IDLE_AGE_MS) continue; // only 30d+ quiet zero-outcome pairs
      if (fitness.unfit && fitness.unfitReason === "idle_ttl_exceeded") continue; // already tagged

      fitness.unfit = 1;
      fitness.unfitReason = "idle_ttl_exceeded";
      fitness.unfitUntil = new Date(now + unfitTtlMs).toISOString();
      markDirty(key.split("|")[0], key.split("|")[1]);
      marked++;
    }

    if (marked > 0) console.log(`[proxyFleet] idle detection marked ${marked} pool(s) unfit`);
    return marked;
  } catch (err) {
    console.warn("[proxyFleet] detectIdlePools failed:", err.message);
    return 0;
  }
}

/**
 * Disable a pool via the self-binding facade (no db needed — repo binds itself)
 */
async function disablePool(poolId) {
  try {
    await updateProxyPool(poolId, { isActive: false }); // self-binding facade
  } catch (err) {
    console.warn("[proxyFleet] disablePool failed:", err.message);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Startup & Singleton (survives dev hot-reload)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Explicit init — replaces auto-run initCaptain() side effects (Covenant W1):
 * the module now exports a caller-driven lifecycle. loadFitness + scheduler
 * fire only when the server boot path (instrumentation register) calls init().
 */
export async function init() {
  if (global.__velaProxyFleet) {
    return global.__velaProxyFleet; // Already initialized
  }

  global.__velaProxyFleet = {
    // Expose all public APIs
    pick,
    resolveForConnection,
    resolveVirtualConnection,
    recordOutcome,
    recordClaimGate,
    repick,
    flushNow,
    getFitnessSummary,
    resetFitness,
    checkPoolHealth,
    checkAllPools,
    probeEgress,
    detectIdlePools,
    startHealthScheduler,
    stopHealthScheduler,
    init,
    __test__: { loadFitness, flushNow, detectIdlePools, probeCache },
  };

  try {
    await loadFitness(); // never throws (fail-open inside)
    startHealthScheduler();
    scheduleFlush();
  } catch (err) {
    // fire-and-forget boot — server starts regardless (defaults to legacy)
    console.warn("[proxyFleet] init() failed — fleet running in legacy mode:", err.message);
  }

  return global.__velaProxyFleet;
}

/**
 * v0.9.42: the default export WAS `export default global.__velaProxyFleet ||
 * null` — a value frozen at module-eval time. That is the root cause of the
 * fleet's silence across four routes (probe, fitness, export, bulk-health) and
 * the severed failure signal in auth.js: the module body MUST run before init()
 * can be called, since init is defined in it, so the global is always unset at
 * that instant and the default always evaluated to null. Every `fleet.X()`
 * then threw "Cannot read properties of null" into a catch that reported a
 * generic 500 — "probe failed", "fitness query failed", "export failed",
 * "health check failed" — so the wound looked like four unrelated flaky
 * endpoints instead of one binding.
 *
 * Dev masked it: hot-reload re-evaluates this module while the global survives
 * (the very property the header brags about), so `fleet` became real after the
 * first edit and everything appeared to work.
 *
 * The facade below is LAZY — each property resolves through the named export at
 * ACCESS time, not at import time. Callers keep their `fleet.X()` shape and get
 * the real function whether init() has run or not. `__test__` stays reachable
 * for the same reason fleetStartup.js needed it.
 */
const fleetFacade = {
  get pick() { return pick; },
  get resolveForConnection() { return resolveForConnection; },
  get resolveVirtualConnection() { return resolveVirtualConnection; },
  get recordOutcome() { return recordOutcome; },
  get recordClaimGate() { return recordClaimGate; },
  get repick() { return repick; },
  get flushNow() { return flushNow; },
  get getFitnessSummary() { return getFitnessSummary; },
  get resetFitness() { return resetFitness; },
  get checkPoolHealth() { return checkPoolHealth; },
  get checkAllPools() { return checkAllPools; },
  get probeEgress() { return probeEgress; },
  get detectIdlePools() { return detectIdlePools; },
  get startHealthScheduler() { return startHealthScheduler; },
  get stopHealthScheduler() { return stopHealthScheduler; },
  get init() { return init; },
  get __test__() { return { loadFitness, flushNow, detectIdlePools, probeCache }; },
};

export default fleetFacade;