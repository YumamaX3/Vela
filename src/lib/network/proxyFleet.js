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
 * - global.dbClient hallucination killed — the harbour's lazy adapter seam
 *   (the one doorway that hands out the handle; precedent: the sync helpers)
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
import { getFitnessRows, upsertFitnessBatch, resetFitness as resetFitnessRows, clearAllFitnessRows } from "../db/repos/proxyFitnessRepo.js";
import { getProxyPools, getProxyPoolById, updateProxyPool } from "../db/repos/proxyPoolsRepo.js";
import { openStoreAdapter } from "../db/index.js";
import { resolveConnectionProxyConfig } from "./connectionProxy.js";
import { isAvailable, recordFailure, recordSuccess, onRetryAfter, flushNow as flushBreakerNow, hydrate as hydrateBreaker } from "./circuitBreaker.js";
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
// W8 — the pipeline's synchronous selection face. The pipeline never imports
// this module (verified: no cycle), so a static import is safe and sync.
import { runSelection } from "./pipeline/runner.js";
import { buildRouteContext } from "./pipeline/wire.js";
import { STAGE_NAMES } from "./pipeline/stages.js";

const RE_PICK_CODES = new Set(["country_blocked", "ip_capped"]); // C16 LOCKED
// W8 cutover: MAX_REPICKS / REPICK_BUDGET_MS deleted with repick() — the
// freebuff executor now passes its own caps to repickPool (pipeline/selection.js).
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

// Start as an empty Map, NOT null: recordOutcome / recordClaimGate can fire
// before init()'s loadFitness() resolves (the facade deliberately lets auth
// signal early), and every .set/.has/.get on a null store throws — the
// "Cannot read properties of null (reading 'set')" boot-window wound. An
// empty store is safe: every reader guards on !loaded and creates neutral
// entries; loadFitness() replaces the store wholesale once the rows arrive.
//
// v0.9.65: BOTH anchors ride globalThis. Next.js standalone bundles each API
// route as its own server chunk, so a module-level Map is per-route state —
// instrumentation hydrates one copy while every route reads another (the
// fitness API returned an empty sea over a fleet that was on fire). The
// globalThis anchor is process-wide: one store, one dirty set, every bundle.
// MIBP anchored its fitness on globalThis.__9routerPoolFitness__ for exactly
// this reason; poolGeo.js already carries the same precedent
// (globalThis[GEO_STATE_KEY]). Keys keep the proxyFleet brand.
const FLEET_STATE_KEY = "__velaProxyFleetState";
globalThis[FLEET_STATE_KEY] ??= { fitnessStore: new Map(), dirtyKeys: new Set() };
const fleetState = globalThis[FLEET_STATE_KEY];
let fitnessStore = fleetState.fitnessStore;
let dirtyKeys = fleetState.dirtyKeys;
let loaded = false;
let flushTimer = null;
let flushArmed = false;
const probeCache = new Map(); // poolId -> { ip, country, observedAt } — sliding window

/**
 * Load persisted fitness rows into memory
 */
async function loadFitness() {
  try {
    // Wrap in try/catch — boot failure defaults to neutral/legacy behavior
    // The adapter rides the harbour's own doorway (census law: the driver is
    // never named outside src/lib/db/).
    const db = await openStoreAdapter();
    const rows = await getFitnessRows(db);
    // Refill IN PLACE — the store is anchored on globalThis (per-route bundle
    // dedup). Reassigning the binding here would orphan every other chunk's
    // reference to the shared Map.
    fitnessStore.clear();

    for (const row of rows) {
      const key = `${row.poolId}|${row.provider}`;
      fitnessStore.set(key, {
        ...row,
        // Convert to mutable structure
        unreadiedAt: row.lastOutcomeAt ? Date.parse(row.lastOutcomeAt) : Date.now(),
      });
    }

    loaded = true;
    // W9 — feed the breaker's own ledger through the hydrate law: widen
    // only. One extra SELECT on the adapter this function already holds;
    // the breaker's per-model counts round-trip across restarts. The hydrate
    // import rides the static binding above (same module, same instance —
    // never a second specifier, the v0.9.65 two-instance wound).
    const { getBreakerRows } = await import('../db/repos/circuitBreakerRepo.js');
    const breakerRows = await getBreakerRows(db);
    hydrateBreaker(breakerRows);
    // W10 (F1) — stash the route-rules snapshot on the fleet anchor. The
    // pipeline's selection seam is SYNC and reads THIS snapshot; the async
    // settings read belongs at boot, not on the hot path.
    try {
      const { getSettings } = await import('../localDb.js');
      const settings = await getSettings();
      fleetState.proxyRoutingRules = Array.isArray(settings?.proxyRoutingRules)
        ? settings.proxyRoutingRules
        : [];
    } catch {
      fleetState.proxyRoutingRules = []; // no settings yet — rules match nothing
    }
  } catch (err) {
    // Boot fail-open: empty store = neutral fitness = legacy behavior (C15)
    console.warn("[proxyFleet] boot failed — defaulting to neutral fitness:", err.message);
    fitnessStore.clear();
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
    const db = await openStoreAdapter();
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
  const db = await openStoreAdapter();
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

/**
 * Clear ALL fitness state — memory and DB rows alike (v0.9.65, the MIBP
 * proxy-fitness deck's "clear all" action). Optionally scoped to one provider:
 * the deck's provider filter passes it through so an operator can sweep only
 * the provider's blocks. Returns the number of in-memory keys purged.
 * @param {string|null} providerId - null/"" clears every provider
 */
export async function clearAllFitness(providerId = null) {
  const db = await openStoreAdapter();
  // The DELETE lives in the harbour (proxyFitnessRepo) — the Storage Covenant's
  // census forbids raw SQL out here.
  await clearAllFitnessRows(db, providerId);

  const matches = (key) => {
    if (providerId === null || providerId === "") return true;
    const sep = key.indexOf("|");
    return sep >= 0 && key.slice(sep + 1) === providerId;
  };

  let cleared = 0;
  if (fitnessStore) {
    for (const key of [...fitnessStore.keys()]) {
      if (matches(key)) { fitnessStore.delete(key); cleared++; }
    }
  }
  for (const key of [...dirtyKeys]) {
    if (matches(key)) dirtyKeys.delete(key);
  }
  return cleared;
}

/**
 * Prune expired unfit marks from memory (v0.9.65, the unified state sweeper —
 * MIBP parity). A fitness entry whose unfitUntil has passed is no longer
 * blocking: pick()'s own unfit filter already ignores it (self-recovering by
 * design), so this only reclaims the entry's active state — it drops the unfit
 * flag back to neutral in memory. The DB row keeps its history until a flush
 * overwrites it or the operator clears it; nothing here deletes history.
 * Returns how many entries were relaxed.
 */
export function pruneExpiredBlocks(now = Date.now()) {
  if (!fitnessStore) return 0;
  let relaxed = 0;
  for (const fitness of fitnessStore.values()) {
    if (!fitness?.unfit || !fitness.unfitUntil) continue;
    const until = Date.parse(fitness.unfitUntil);
    if (Number.isNaN(until) || now < until) continue;
    fitness.unfit = 0;
    fitness.unfitReason = null;
    fitness.unfitUntil = null;
    relaxed++;
    if (fitness.poolId && fitness.provider) markDirty(fitness.poolId, fitness.provider);
  }
  return relaxed;
}

// ───────────────────────────────────────────────────────────────────────────
// Selection Family (hot path — sync where possible)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Pick pool ID using strategy — W8 CUTOVER SHELL.
 *
 * The legacy pickSmart/pickRoundRobin bodies are DELETED. Every strategy now
 * answers through the pipeline's selection stages (pipeline/selection.js):
 * its health-filter IS the breaker pre-filter, its weighted draw IS the EWMA
 * scoring with hysteresis, and its affinity check IS consistent hashing.
 *
 * This shell exists for exactly two remaining references — the freebuff
 * executor's `repick` (re-pointed to repickPool in this same tide) and the
 * globalThis facade's `pick` property. The shell maps the old policy onto
 * the pipeline: `pinnedPoolId` becomes the draw's incumbent (hysteresis),
 * and `none`/`random` keep their pre-cutover semantics.
 *
 * Fail-open by construction: a pipeline throw or empty choice returns null
 * and the CALLER's stated fallback answers.
 *
 * @param {Array} poolIds
 * @param {{strategy: string, pinnedPoolId?: string|null, providerId: string}} policy
 * @returns {string|null}
 */
export function pick(poolIds, policy) {
  try {
    const { strategy, pinnedPoolId, providerId } = policy;
    if (!poolIds || poolIds.length === 0) return null;
    if (poolIds.length === 1) return poolIds[0];
    const ctx = buildRouteContext({
      providerId, model: "", target: "https://selection.local/",
      candidates: poolIds, strategy: "smart",
      incumbentPoolId: pinnedPoolId ?? null,
    });
    const chosen = runSelection(ctx, STAGE_NAMES);
    if (chosen) return chosen;
    if (strategy === "random") {
      // C17: return a poolId (the string), not an index that leaks into
      // callers expecting an id — the weighted draw's `id` is used downstream.
      return poolIds[Math.floor(Math.random() * poolIds.length)];
    }
    return null;
  } catch (err) {
    // Fail-open: fall back to first pool
    console.warn("[proxyFleet] pick failed:", err.message);
    return poolIds[0];
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

let healthSchedulerTimer = null;
export function startHealthScheduler() {
  if (healthSchedulerTimer) return;
  // W3: retain the interval HANDLE so stop can cancel it.

  healthSchedulerTimer = setInterval(async () => {
  
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
  if (healthSchedulerTimer) {
    clearInterval(healthSchedulerTimer);
    healthSchedulerTimer = null;
  }
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
      // v0.9.44 (milestone 0.6, LIVE-B): the per-pool detail this array already
      // held at :794 but never returned. Returning it is what lets
      // `bulk-health/route.js` delegate instead of carrying a second copy of
      // this loop — the copy that had drifted into deactivating pools on
      // `!result.ok` (no indeterminate bucket, plus an N+1 re-fetch of a row the
      // caller already held). The defect class was duplication, so the repair
      // removes the second copy rather than fixing it. The scheduler at :716
      // discards this return value entirely, so widening the shape is inert
      // there.
      results,
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
    // Expose all public APIs — W8 cutover: pick/resolveForConnection/
    // resolveVirtualConnection/repick deleted; selection lives at
    // pipeline/selection.js (pickPool/repickPool).
    recordOutcome,
    recordClaimGate,
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
  // W8 cutover: pick/repick/resolveForConnection/resolveVirtualConnection are
  // DELETED from the facade — pool selection lives at pipeline/selection.js
  // (pickPool/repickPool), and the resolve family had zero callers.
  get recordOutcome() { return recordOutcome; },
  get recordClaimGate() { return recordClaimGate; },
  get flushNow() { return flushNow; },
  get getFitnessSummary() { return getFitnessSummary; },
  get resetFitness() { return resetFitness; },
  get clearAllFitness() { return clearAllFitness; },
  get pruneExpiredBlocks() { return pruneExpiredBlocks; },
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