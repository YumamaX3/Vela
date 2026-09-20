"use client";
// The proxy console's data current: one bootstrap load, one set of mutations.
// Components never fetch — they call these.
//
// The console is one fleet seen four ways (Fleet, Fitness, Egress, Relay), so the
// fleet listing, the fitness projection, the egress geo registry, and the geo-probe
// setting are loaded ONCE here and shared by every lens. A tab switch is a change of
// lens, not a refetch — and the Fitness tab's block ledger and the Fleet tab's pool
// rows always describe the same pools, because there is one copy.
import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "../lib/proxyApi";
import { isBlocked, isRelayPool, verdictFromTestStatus, VERDICT } from "../lib/proxyFormat";

export function useProxyFleet() {
  const [pools, setPools] = useState([]);
  const [records, setRecords] = useState([]);
  const [geo, setGeo] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [geoEnabled, setGeoEnabled] = useState(true);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [poolsRes, fitnessRes, settings] = await Promise.all([
        api.loadPools(),
        api.loadFitness(),
        api.loadSettings().catch(() => ({})),
      ]);
      if (!poolsRes.ok) setError(poolsRes.body?.error || "Could not read the fleet.");
      setPools(poolsRes.pools || []);
      setRecords(fitnessRes.fitness?.pools || []);
      setGeo(fitnessRes.geo || {});
      if (typeof settings?.poolGeoProbeEnabled === "boolean") setGeoEnabled(settings.poolGeoProbeEnabled);
    } catch (err) {
      setError(err?.message || "Could not reach the fleet.");
    } finally {
      setLoading(false);
    }
  }, []);

  // One bootstrap load on mount. setState lives in `reload`'s async continuation,
  // the same shape every sibling hook uses (react-hooks/set-state-in-effect).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
  }, [reload]);

  // ── mutations ─────────────────────────────────────────────────────────────
  const createPool = useCallback(async (payload) => {
    const res = await api.createPool(payload);
    if (res.ok) await reload();
    return res;
  }, [reload]);

  const updatePool = useCallback(async (id, payload) => {
    const res = await api.updatePool(id, payload);
    if (res.ok) await reload();
    return res;
  }, [reload]);

  const deletePool = useCallback(async (id) => {
    const res = await api.deletePool(id);
    if (res.ok) await reload();
    return res;
  }, [reload]);

  const testPool = useCallback(async (id) => {
    const res = await api.testPool(id);
    await reload();
    return res;
  }, [reload]);

  const bulkHealth = useCallback(async (options) => {
    const res = await api.runBulkHealth(options);
    await reload();
    return res;
  }, [reload]);

  const saveGeoToggle = useCallback(async (next) => {
    setGeoEnabled(next);
    const res = await api.saveGeoToggle(next);
    if (!res.ok) setGeoEnabled(!next);
    return res;
  }, []);

  const resetFitness = useCallback(async (poolId, providerId) => {
    const res = await api.resetFitness(poolId, providerId);
    if (res.ok) await reload();
    return res;
  }, [reload]);

  const clearAllFitness = useCallback(async (providerId) => {
    const res = await api.clearAllFitness(providerId);
    if (res.ok) await reload();
    return res;
  }, [reload]);

  const probeEgress = useCallback(async (id) => {
    const res = await api.probePoolEgress(id);
    await reload();
    return res;
  }, [reload]);

  const deploy = useCallback(async (platform, form) => {
    const fn = api.DEPLOYERS[platform];
    if (!fn) return { ok: false, body: { error: `Unknown platform ${platform}` } };
    const res = await fn(form);
    if (res.ok) await reload();
    return res;
  }, [reload]);

  // ── derived ───────────────────────────────────────────────────────────────
  const poolById = useMemo(() => new Map(pools.map((p) => [p.id, p])), [pools]);
  const relays = useMemo(() => pools.filter(isRelayPool), [pools]);

  // The census strip's numbers. Verdict counts use the same three-way vocabulary
  // the rest of the console does — a pool whose last test was indeterminate is
  // counted as indeterminate, never folded into dead.
  const census = useMemo(() => {
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
  }, [pools, records]);

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
