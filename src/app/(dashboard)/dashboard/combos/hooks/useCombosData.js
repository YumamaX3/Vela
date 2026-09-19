"use client";

// The combos deck's data current: one bootstrap load, one hub, one set of
// mutations. Components never fetch — they call these.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  bulkCombo,
  createCombo as apiCreateCombo,
  deleteCombo as apiDeleteCombo,
  loadFleet,
  saveCapacityAdapter as apiSaveCapacityAdapter,
  updateCombo as apiUpdateCombo,
} from "../lib/comboApi";
import { normalizeCapacityAdapter } from "../lib/comboMeta";

export function useCombosData({ hours = 24 } = {}) {
  const [combos, setCombos] = useState([]);
  const [connections, setConnections] = useState([]);
  const [nodePrefixes, setNodePrefixes] = useState([]);
  const [comboStrategies, setComboStrategies] = useState({});
  const [capacityAdapter, setCapacityAdapter] = useState(() => normalizeCapacityAdapter({}));
  const [usageByName, setUsageByName] = useState({});
  const [usageWindow, setUsageWindow] = useState({ hours, buckets: 24, since: null });
  const [serverStats, setServerStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    try {
      const fleet = await loadFleet({ hours });
      setCombos(fleet.combos);
      setConnections(fleet.connections);
      setNodePrefixes(fleet.nodePrefixes);
      setComboStrategies(fleet.settings?.comboStrategies || {});
      setCapacityAdapter(normalizeCapacityAdapter(fleet.settings?.capacityAdapter || {}));
      setUsageByName(fleet.usageByName);
      setUsageWindow(fleet.usageWindow);
      setServerStats(fleet.serverStats);
      setError(fleet.ok ? null : "The fleet could not be read.");
    } catch (err) {
      console.log("Error fetching combos:", err);
      setError("The fleet could not be read.");
    } finally {
      setLoading(false);
    }
  }, [hours]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Which member providers are dialable right now (active connections + custom
  // provider-node prefixes). Rebuilt only when its sources change.
  const hub = useMemo(() => {
    const connected = new Set();
    for (const c of connections) {
      if (!c?.provider) continue;
      if (c.isActive === false) connected.delete(c.provider);
      else connected.add(c.provider);
    }
    return { connected, prefixes: new Set(nodePrefixes) };
  }, [connections, nodePrefixes]);

  const create = useCallback(
    async (payload) => {
      const res = await apiCreateCombo(payload);
      if (res.ok) await reload();
      return res;
    },
    [reload]
  );

  const update = useCallback(
    async (id, payload) => {
      const res = await apiUpdateCombo(id, payload);
      if (res.ok) await reload();
      return res;
    },
    [reload]
  );

  const remove = useCallback(
    async (id) => {
      const res = await apiDeleteCombo(id);
      // Optimistic removal — a failed delete reloads the truth back in.
      if (res.ok) setCombos((prev) => prev.filter((c) => c.id !== id));
      else await reload();
      return res;
    },
    [reload]
  );

  const duplicate = useCallback(
    async (combo) => {
      const res = await bulkCombo({ action: "duplicate", ids: [combo.id] });
      if (res.ok) await reload();
      return res;
    },
    [reload]
  );

  // Strategy writes go through the bulk seam — one backend law for one and for
  // many. The empty patch (back to "fallback") drops the entry, server-side.
  const setStrategy = useCallback(
    async (names, patch) => {
      const list = Array.isArray(names) ? names : [names];
      // The settings shape calls it fallbackStrategy; the bulk route calls it
      // strategy. Translate here — one place — so no caller has to know both.
      const body = { action: "setStrategy", names: list };
      if (patch?.fallbackStrategy !== undefined) body.strategy = patch.fallbackStrategy;
      if (patch?.judgeModel !== undefined) body.judgeModel = patch.judgeModel;
      const res = await bulkCombo(body);
      if (res.ok) {
        setComboStrategies((prev) => {
          const next = { ...prev };
          for (const name of list) {
            const merged = { ...(next[name] || {}), ...patch };
            for (const [key, value] of Object.entries(merged)) {
              if (value === "" || value === null || value === undefined) delete merged[key];
            }
            if (!merged.fallbackStrategy || merged.fallbackStrategy === "fallback") delete next[name];
            else next[name] = merged;
          }
          return next;
        });
      }
      return res;
    },
    []
  );

  const runBulk = useCallback(
    async (payload) => {
      const res = await bulkCombo(payload);
      if (res.ok) await reload();
      return res;
    },
    [reload]
  );

  const saveCapacityAdapter = useCallback(async (next) => {
    setCapacityAdapter(next);
    return apiSaveCapacityAdapter(next);
  }, []);

  return {
    combos,
    hub,
    connections,
    nodePrefixes,
    comboStrategies,
    capacityAdapter,
    usageByName,
    usageWindow,
    serverStats,
    loading,
    error,
    reload,
    create,
    update,
    remove,
    duplicate,
    setStrategy,
    runBulk,
    saveCapacityAdapter,
  };
}
