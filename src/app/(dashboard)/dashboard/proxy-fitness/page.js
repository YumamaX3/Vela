"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, CardSkeleton, ConfirmModal, Input, Toggle } from "@/shared/components";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { useNotificationStore } from "@/store/notificationStore";

function fmtTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function maskProxyUrl(url) {
  try {
    const parsed = new URL(url);
    const port = parsed.port ? `:${parsed.port}` : "";
    return `${parsed.protocol}//${parsed.hostname}${port}`;
  } catch {
    return String(url || "");
  }
}

// A fitness summary row becomes one "block" record when its unfit window is
// still open. Expired windows are filtered server-side of this page by
// picking's own self-recovery; here we also drop them client-side so the
// table never shows stale anger.
function isBlocked(rec, now = Date.now()) {
  if (!rec?.unfit) return false;
  const until = rec.unfitUntil ? Date.parse(rec.unfitUntil) : null;
  if (until === null || Number.isNaN(until)) return true; // open-ended block
  return now < until;
}

export default function ProxyFitnessPage() {
  const [pools, setPools] = useState([]);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [providerFilter, setProviderFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [clearingKey, setClearingKey] = useState(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
  const [geoEnabled, setGeoEnabled] = useState(true);
  const [geoUpdating, setGeoUpdating] = useState(false);
  const notify = useNotificationStore();

  const fetchAll = useCallback(async () => {
    try {
      const [poolRes, fitRes] = await Promise.all([
        fetch("/api/proxy-pools", { cache: "no-store" }),
        fetch("/api/proxy-pools/fitness", { cache: "no-store" }),
      ]);
      const poolData = await poolRes.json().catch(() => ({ proxyPools: [] }));
      setPools(poolData.proxyPools || []);
      if (fitRes.ok) {
        const fitData = await fitRes.json().catch(() => ({}));
        setRecords(fitData.fitness?.pools || []);
      } else {
        setRecords([]);
      }
    } catch (error) {
      console.log("Error fetching proxy fitness:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // setState happens inside the async continuation, not the effect body —
    // the same shape every sibling page uses (react-hooks/set-state-in-effect).
    let cancelled = false;
    const load = async () => {
      try {
        const [poolRes, fitRes] = await Promise.all([
          fetch("/api/proxy-pools", { cache: "no-store" }),
          fetch("/api/proxy-pools/fitness", { cache: "no-store" }),
        ]);
        if (cancelled) return;
        const poolData = await poolRes.json().catch(() => ({ proxyPools: [] }));
        setPools(poolData.proxyPools || []);
        if (fitRes.ok) {
          const fitData = await fitRes.json().catch(() => ({}));
          setRecords(fitData.fitness?.pools || []);
        } else {
          setRecords([]);
        }
      } catch (error) {
        console.log("Error fetching proxy fitness:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [fetchAll]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : {}))
      .then((s) => {
        if (cancelled) return;
        if (typeof s.poolGeoProbeEnabled === "boolean") setGeoEnabled(s.poolGeoProbeEnabled);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handleGeoToggle = async (next) => {
    setGeoUpdating(true);
    setGeoEnabled(next);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poolGeoProbeEnabled: next }),
      });
      if (!res.ok) {
        setGeoEnabled(!next);
        throw new Error(`HTTP ${res.status}`);
      }
      notify.success(next ? "Geo probe enabled" : "Geo probe disabled");
    } catch (err) {
      notify.error(`Update failed: ${err.message}`);
    } finally {
      setGeoUpdating(false);
    }
  };

  const poolById = useMemo(() => new Map(pools.map((p) => [p.id, p])), [pools]);

  const recordsList = useMemo(
    () => records.filter((rec) => isBlocked(rec)),
    [records]
  );

  const providerOptions = useMemo(() => {
    const set = new Set();
    for (const rec of recordsList) if (rec.provider) set.add(rec.provider);
    return Array.from(set).sort();
  }, [recordsList]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return recordsList.filter((rec) => {
      if (providerFilter !== "all" && rec.provider !== providerFilter) return false;
      if (!q) return true;
      const pool = poolById.get(rec.poolId);
      const hay = [
        pool?.proxyUrl,
        pool?.name,
        rec.egressIp,
        rec.egressCountry,
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [recordsList, providerFilter, search, poolById]);

  const handleClear = async (rec) => {
    setClearingKey(rec.poolId);
    try {
      const res = await fetch(`/api/proxy-pools/fitness/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poolId: rec.poolId, providerId: rec.provider }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      notify.success(`Cleared ${rec.provider} on ${poolById.get(rec.poolId)?.name || rec.poolId.slice(0, 8)}`);
      fetchAll();
    } catch (err) {
      notify.error(`Clear failed: ${err.message}`);
    } finally {
      setClearingKey(null);
    }
  };

  const handleClearAll = async () => {
    setClearingAll(true);
    try {
      const res = await fetch("/api/proxy-pools/fitness/clear-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(providerFilter !== "all" ? { provider: providerFilter } : {}),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      notify.success(providerFilter !== "all" ? `Cleared all ${providerFilter} blocks` : "Cleared all blocks");
      setConfirmClearAll(false);
      fetchAll();
    } catch (err) {
      notify.error(`Clear all failed: ${err.message}`);
    } finally {
      setClearingAll(false);
    }
  };

  const selectedLabel = providerFilter === "all" ? "All providers" : providerFilter;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4 sm:p-6">
      {loading ? (
        <CardSkeleton />
      ) : (
        <>
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-text-main">Proxy Fitness</h1>
              <Badge variant={recordsList.length > 0 ? "error" : "default"} size="sm">
                {recordsList.length} active block{recordsList.length === 1 ? "" : "s"}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              {recordsList.length > 0 && (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setConfirmClearAll(true)}
                  disabled={clearingAll}
                >
                  Clear All{providerFilter !== "all" ? ` (${providerFilter})` : ""}
                </Button>
              )}
              <Toggle
                size="sm"
                checked={geoEnabled}
                onChange={handleGeoToggle}
                disabled={geoUpdating}
                label="Geo probe"
                description="Probe egress IP/country per pool every ~30 min (uses geo-API quota)"
              />
              <Button variant="secondary" size="sm" onClick={fetchAll}>Refresh</Button>
            </div>
          </div>

          <p className="text-sm text-text-muted">
            Shows which provider is blocked on which proxy egress (region gates, per-IP
            limits, or idle marks). Smart rotation skips these pools while the block is
            active; blocks self-recover when their window closes.
          </p>

          {/* Filters */}
          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-subtle bg-surface p-3">
            <div className="flex min-w-48 flex-1 flex-col">
              <label className="mb-1 text-xs font-medium text-text-muted">Provider</label>
              <select
                value={providerFilter}
                onChange={(e) => setProviderFilter(e.target.value)}
                className="h-8 w-full rounded border border-black/10 bg-black/[0.02] px-2 text-xs text-text-main dark:border-white/10 dark:bg-white/[0.03]"
                title="Filter by provider"
              >
                <option value="all">All providers</option>
                {providerOptions.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div className="flex min-w-48 flex-1 flex-col">
              <label className="mb-1 text-xs font-medium text-text-muted">IP / Proxy / Pool</label>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="e.g. 104.28, vercel-relay…"
              />
            </div>
          </div>

          {/* Records table */}
          <Card className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-subtle text-left text-xs uppercase tracking-wider text-text-muted">
                    <th className="px-4 py-2 font-semibold">Provider</th>
                    <th className="px-4 py-2 font-semibold">Pool</th>
                    <th className="px-4 py-2 font-semibold">IP / Proxy</th>
                    <th className="px-4 py-2 font-semibold">Reason</th>
                    <th className="px-4 py-2 font-semibold">Until</th>
                    <th className="px-4 py-2 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-text-muted">
                        {recordsList.length === 0
                          ? "No active blocks. Blocks appear here when a provider region-gates a proxy IP."
                          : "No blocks match the current filters."}
                      </td>
                    </tr>
                  ) : (
                    filtered.map((rec) => {
                      const pool = poolById.get(rec.poolId);
                      const key = `${rec.poolId}|${rec.provider}`;
                      return (
                        <tr
                          key={key}
                          className="border-b border-subtle align-top last:border-0 hover:bg-surface-2/40"
                        >
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center gap-2 rounded bg-red-500/10 px-2 py-0.5 text-xs font-medium capitalize text-red-600 dark:text-red-400">
                              <span className="material-symbols-outlined text-[14px]">block</span>
                              {rec.provider}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-text-muted">{pool?.name || rec.poolId.slice(0, 8)}</td>
                          <td className="px-4 py-3">
                            <div className="flex min-w-0 flex-col gap-0.5">
                              <code className="truncate font-mono text-xs text-text-main">{maskProxyUrl(pool?.proxyUrl || "")}</code>
                              {rec.egressIp && (
                                <span className="flex items-center gap-1 text-[11px] text-text-muted">
                                  <span className="truncate">egress {rec.egressIp}{rec.egressCountry ? ` · ${rec.egressCountry}` : ""}</span>
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-text-muted">{rec.unfitReason || "blocked"}</td>
                          <td className="px-4 py-3 text-text-muted">{fmtTime(rec.unfitUntil)}</td>
                          <td className="px-4 py-3">
                            <div className="flex justify-end">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleClear(rec)}
                                disabled={clearingKey === rec.poolId}
                                title="Clear this block"
                              >
                                {clearingKey === rec.poolId ? "Clearing…" : "Clear"}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <ConfirmModal
            isOpen={confirmClearAll}
            onClose={() => setConfirmClearAll(false)}
            onConfirm={handleClearAll}
            title="Clear all blocks"
            message={providerFilter !== "all"
              ? `Clear all active blocks for provider "${providerFilter}"? Those pools become selectable again immediately.`
              : "Clear all active proxy blocks? All pools become selectable again immediately."}
            confirmText={clearingAll ? "Clearing…" : "Clear All"}
            cancelText="Cancel"
            variant="danger"
          />
        </>
      )}
    </div>
  );
}
