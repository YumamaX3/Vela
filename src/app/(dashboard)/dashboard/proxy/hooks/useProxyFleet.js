"use client";
// The proxy fleet's consumer facade — the shape the lenses already speak.
//
// This hook used to be the console's ONLY store: four `useState`s and ten
// `useCallback`s, all mounted inside the console page, so a lens switch kept the data
// and a route navigation threw it away. The data now lives in `stores/proxyFleetStore`
// (mounted by `layout.js`, outliving every route); this hook is the thin reader on
// top of it, keeping the exact `c` surface the four lens components were written
// against — so Fleet/Fitness/Egress/Relay did not need to change to ride the store.
//
// The one load is `ensureLoaded`, called from an effect on first mount of ANY lens.
// Because the store's `load()` is idempotent (`loaded` guard + shared `inflight`),
// navigating between eight shores still issues ONE bootstrap fetch cycle per store
// lifetime — the plan's R3, "the bootstrap load runs once per store lifetime".
import { useCallback, useEffect, useMemo } from "react";
import {
  useProxyFleetStore,
  selectError,
  selectGeo,
  selectGeoEnabled,
  selectLoading,
  selectPools,
  selectRecords,
  computeCensus,
} from "../stores/proxyFleetStore";
import { isRelayPool } from "../lib/proxyFormat";

/**
 * Read the fleet and its mutations. Every lens calls this and mounts a `.load()`;
 * what it gets back is the same `c` object the console's tabs have always consumed.
 */
export function useProxyFleet() {
  const pools = useProxyFleetStore(selectPools);
  const records = useProxyFleetStore(selectRecords);
  const geo = useProxyFleetStore(selectGeo);
  const loading = useProxyFleetStore(selectLoading);
  const error = useProxyFleetStore(selectError);
  const geoEnabled = useProxyFleetStore(selectGeoEnabled);

  // Actions are stable references on a zustand store — selecting them one by one
  // keeps this hook subscribed to data only, so a mutation never re-renders a lens
  // that only reads. `getState().load` reads the action at call time, not at
  // subscribe time, so this memo is genuinely empty-dependency.
  const load = useCallback(() => useProxyFleetStore.getState().load(), []);
  const reload = useCallback(() => useProxyFleetStore.getState().reload(), []);
  const createPool = useCallback((p) => useProxyFleetStore.getState().createPool(p), []);
  const updatePool = useCallback((id, p) => useProxyFleetStore.getState().updatePool(id, p), []);
  const deletePool = useCallback((id) => useProxyFleetStore.getState().deletePool(id), []);
  const testPool = useCallback((id) => useProxyFleetStore.getState().testPool(id), []);
  const bulkHealth = useCallback((o) => useProxyFleetStore.getState().bulkHealth(o), []);
  const saveGeoToggle = useCallback((n) => useProxyFleetStore.getState().saveGeoToggle(n), []);
  const resetFitness = useCallback((poolId, providerId) => useProxyFleetStore.getState().resetFitness(poolId, providerId), []);
  const clearAllFitness = useCallback((providerId) => useProxyFleetStore.getState().clearAllFitness(providerId), []);
  const probeEgress = useCallback((id) => useProxyFleetStore.getState().probeEgress(id), []);
  const deploy = useCallback((platform, form) => useProxyFleetStore.getState().deploy(platform, form), []);

  // The bootstrap. The store's `load()` is idempotent, so eight lenses each mounting
  // this effect still cost one network cycle; after the first, every call short-
  // circuits on `loaded`. `setState` lives inside the store's async continuation,
  // never in this effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    load();
  }, [load]);

  // ── derived — memoized per input identity, in ONE place ──────────────────
  const poolById = useMemo(() => new Map(pools.map((p) => [p.id, p])), [pools]);
  const relays = useMemo(() => pools.filter(isRelayPool), [pools]);
  const census = useMemo(() => computeCensus(pools, records), [pools, records]);

  return {
    pools,
    records,
    geo,
    loading,
    error,
    geoEnabled,
    poolById,
    relays,
    census,
    reload,
    createPool,
    updatePool,
    deletePool,
    testPool,
    bulkHealth,
    saveGeoToggle,
    resetFitness,
    clearAllFitness,
    probeEgress,
    deploy,
  };
}
