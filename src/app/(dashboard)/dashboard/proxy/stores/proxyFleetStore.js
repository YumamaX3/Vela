"use client";
// The Proxy console's shared fleet store — one load, one arithmetic, eight shores.
//
// Why a store and not eight fetches: the console used to be one page with four tabs
// over one hook (`useProxyFleet`). A tab switch was a state flip, so the fleet was
// read once. The separation makes every lens its own route — and a page switch is a
// NAVIGATION, which unmounts the hook and re-fetches. Eight pages fetching eight
// times is eight chances to disagree about the census, and the census strip's whole
// purpose is one arithmetic over one copy. So the data current moves up one level:
// `layout.js` mounts this store above all eight shores, and it outlives the route.
//
// What it holds (sealed plan §3.1): `pools`, `records`, `geo`, `census`, `loading`,
// `error` — plus `geoEnabled`, and every mutation the console performs today. The
// census is derived, never stored raw: `computeCensus` is the ONE arithmetic, and
// `useProxyFleet` memoizes its result per (pools, records) pair.
//
// The subscription rule is R3: pages subscribe with SELECTORS (or take the
// `useProxyFleet()` facade, which selects for them), never a bare `useProxyFleetStore()`
// call — a bare call re-renders on every field change.
import { create } from "zustand";
import * as api from "../lib/proxyApi";
import { isBlocked, isRelayPool, verdictFromTestStatus, VERDICT } from "../lib/proxyFormat";

/**
 * The census arithmetic — the one counting loop. Three verdicts, three tiles: a
 * pool whose last test was indeterminate is counted as indeterminate and NEVER
 * folded into dead. That collapse is the fleet's own self-liquidation wound, and
 * this function is exactly where a future "simplification" would re-earn it.
 */
export function computeCensus(pools = [], records = []) {
  let active = 0;
  let ok = 0;
  let dead = 0;
  let indeterminate = 0;
  let bound = 0;
  for (const pool of pools) {
    if (pool.isActive === true) active += 1;
    bound += pool.boundConnectionCount || 0;
    const v = verdictFromTestStatus(pool.testStatus);
    if (v === VERDICT.OK) ok += 1;
    else if (v === VERDICT.DEAD) dead += 1;
    else indeterminate += 1;
  }
  const blocked = records.filter((r) => isBlocked(r)).length;
  const relayCount = pools.filter(isRelayPool).length;
  return { total: pools.length, active, ok, dead, indeterminate, bound, blocked, relayCount };
}

export const useProxyFleetStore = create((set, get) => ({
  // ── state ────────────────────────────────────────────────────────────────
  pools: [],
  records: [],
  geo: {},
  geoEnabled: true,
  loading: true,
  error: null,
  // The bootstrap guard: true only after a SUCCESSFUL pools read. A failed read
  // leaves it false, so the next `load()` (a retry click, a remount) tries again
  // instead of presenting a silently empty fleet as the truth.
  loaded: false,
  // The in-flight load, shared so concurrent first mounts (Strict mode, a fast
  // navigation, two lenses mounting at once) join ONE request cycle, not several.
  inflight: null,

  // ── the one load ─────────────────────────────────────────────────────────
  // All three currents read together, because every lens renders beside the census
  // and the census needs pools AND records. A settings failure is tolerated: the
  // geo toggle has a safe default and must never take the fleet down with it.
  load: async ({ force = false } = {}) => {
    const state = get();
    if (!force && state.loaded) return;
    if (state.inflight) return state.inflight;

    set({ error: null });
    const run = (async () => {
      try {
        const [poolsRes, fitnessRes, settings] = await Promise.all([
          api.loadPools(),
          api.loadFitness(),
          api.loadSettings().catch(() => ({})),
        ]);
        set({
          // A failed pools read still lands the (empty) fleet, but with the error
          // named: the operator sees a strip and a Retry, never a false calm.
          error: poolsRes.ok ? null : poolsRes.body?.error || "Could not read the fleet.",
          pools: poolsRes.pools || [],
          records: fitnessRes.fitness?.pools || [],
          geo: fitnessRes.geo || {},
          ...(typeof settings?.poolGeoProbeEnabled === "boolean"
            ? { geoEnabled: settings.poolGeoProbeEnabled }
            : {}),
          loading: false,
          loaded: poolsRes.ok,
        });
      } catch (err) {
        set({ error: err?.message || "Could not reach the fleet.", loading: false, loaded: false });
      } finally {
        set({ inflight: null });
      }
    })();

    set({ inflight: run });
    return run;
  },

  /** Force a refetch — the Retry click, a post-mutation refresh. */
  reload: () => get().load({ force: true }),

  // ── mutations ────────────────────────────────────────────────────────────
  // Each delegates to its seam in `proxyApi` and refetches on the engine's own
  // success word — never optimistically, because the engine may clamp, mask, or
  // refuse (the masked-URL edit law: a pool's proxyUrl reads back masked, so the
  // store never writes a client guess into the row).

  createPool: async (payload) => {
    const res = await api.createPool(payload);
    if (res.ok) await get().load({ force: true });
    return res;
  },

  updatePool: async (id, payload) => {
    const res = await api.updatePool(id, payload);
    if (res.ok) await get().load({ force: true });
    return res;
  },

  deletePool: async (id) => {
    const res = await api.deletePool(id);
    if (res.ok) await get().load({ force: true });
    return res;
  },

  // A single test always refetches — success or not — because the route owns the
  // verdict and the isActive flip, and the fleet must show what it decided.
  testPool: async (id) => {
    const res = await api.testPool(id);
    await get().load({ force: true });
    return res;
  },

  // The sweep — ONE request to the engine (never N client `/test` calls), then a
  // refetch so the census reflects the engine's verdicts verbatim.
  bulkHealth: async (options) => {
    const res = await api.runBulkHealth(options);
    await get().load({ force: true });
    return res;
  },

  // The geo toggle is optimistic WITH a rollback: the switch must feel instant, and
  // a failed PATCH restores the prior truth rather than leaving a lie on screen.
  saveGeoToggle: async (next) => {
    const prev = get().geoEnabled;
    set({ geoEnabled: next });
    const res = await api.saveGeoToggle(next);
    if (!res.ok) set({ geoEnabled: prev });
    return res;
  },

  resetFitness: async (poolId, providerId) => {
    const res = await api.resetFitness(poolId, providerId);
    if (res.ok) await get().load({ force: true });
    return res;
  },

  clearAllFitness: async (providerId) => {
    const res = await api.clearAllFitness(providerId);
    if (res.ok) await get().load({ force: true });
    return res;
  },

  probeEgress: async (id) => {
    const res = await api.probePoolEgress(id);
    await get().load({ force: true });
    return res;
  },

  // Deploys succeed before the relay row exists, so the refetch is unconditional on
  // success: the new relay pool is the visible proof the deploy landed.
  deploy: async (platform, form) => {
    const fn = api.DEPLOYERS[platform];
    if (!fn) return { ok: false, body: { error: `Unknown platform ${platform}` } };
    const res = await fn(form);
    if (res.ok) await get().load({ force: true });
    return res;
  },
}));

// ── selectors ────────────────────────────────────────────────────────────────
// Subscribe with these. Each returns a stable reference or a pure slice; derived
// aggregates are memoized in the facade (`useProxyFleet`) per input identity.

export const selectPools = (s) => s.pools;
export const selectRecords = (s) => s.records;
export const selectGeo = (s) => s.geo;
export const selectLoading = (s) => s.loading;
export const selectError = (s) => s.error;
export const selectGeoEnabled = (s) => s.geoEnabled;
export const selectRelays = (s) => s.pools.filter(isRelayPool);

// ── test/reset seam ──────────────────────────────────────────────────────────
// The store is a module singleton, exactly like `providerStore`. A test suite that
// renders two consoles in one file would otherwise hand the second one the first
// one's fleet. `resetProxyFleetStore` restores the initial shape; nothing in
// production calls it.
export function resetProxyFleetStore() {
  useProxyFleetStore.setState({
    pools: [],
    records: [],
    geo: {},
    geoEnabled: true,
    loading: true,
    error: null,
    loaded: false,
    inflight: null,
  });
}
