"use client";
// FitnessTab — the block ledger: every (pool, provider) pair whose unfit window is
// still open, one row each, with a per-row Clear and a Clear All. A block means
// "this provider is refusing this pool's egress right now" (a region gate, a per-IP
// cap, an idle mark); smart rotation skips the pair while the window is open and
// picking re-admits it when the window closes.
//
// The geo-probe toggle lives here rather than on the Fleet lens because it is a
// fleet-wide probe setting, not a per-pool control — and it is the switch that makes
// the Egress lens' numbers appear at all. Turning it off is stated as costing
// nothing: the ledger keeps working, it just stops refreshing egress.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, CardSkeleton, ConfirmModal, Input, Toggle } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";
import { fmtTime, isBlocked, maskProxyUrl } from "../lib/proxyFormat";

export default function FitnessTab({ c }) {
  const notify = useNotificationStore();
  const [providerFilter, setProviderFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [clearingKey, setClearingKey] = useState(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);

  const recordsList = useMemo(() => c.records.filter((rec) => isBlocked(rec)), [c.records]);

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
      const pool = c.poolById.get(rec.poolId);
      const hay = [pool?.proxyUrl, pool?.name, rec.egressIp, rec.egressCountry].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [recordsList, providerFilter, search, c.poolById]);

  // Reset the provider filter when its provider vanishes from the ledger. Same
  // deliberate setState-in-effect shape as the Fleet lens (react-hooks/set-state-in-effect).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (providerFilter !== "all" && !providerOptions.includes(providerFilter)) setProviderFilter("all");
  }, [providerFilter, providerOptions]);

  const handleClear = useCallback(async (rec) => {
    setClearingKey(`${rec.poolId}|${rec.provider}`);
    try {
      const res = await c.resetFitness(rec.poolId, rec.provider);
      if (!res.ok) {
        notify.error(`Clear failed: HTTP ${res.status}`);
        return;
      }
      notify.success(`Cleared ${rec.provider} on ${c.poolById.get(rec.poolId)?.name || rec.poolId.slice(0, 8)}`);
    } catch (err) {
      notify.error(`Clear failed: ${err.message}`);
    } finally {
      setClearingKey(null);
    }
  }, [c, notify]);

  const handleClearAll = async () => {
    setClearingAll(true);
    try {
      const res = await c.clearAllFitness(providerFilter !== "all" ? providerFilter : null);
      if (!res.ok) {
        notify.error(`Clear all failed: HTTP ${res.status}`);
        return;
      }
      notify.success(providerFilter !== "all" ? `Cleared all ${providerFilter} blocks` : "Cleared all blocks");
      setConfirmClearAll(false);
    } catch (err) {
      notify.error(`Clear all failed: ${err.message}`);
    } finally {
      setClearingAll(false);
    }
  };

  if (c.loading) return <CardSkeleton />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-text-main">Block ledger</h2>
          <Badge variant={recordsList.length > 0 ? "error" : "default"} size="sm">
            {recordsList.length} active block{recordsList.length === 1 ? "" : "s"}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {recordsList.length > 0 && (
            <Button variant="danger" size="sm" onClick={() => setConfirmClearAll(true)} disabled={clearingAll}>
              Clear All{providerFilter !== "all" ? ` (${providerFilter})` : ""}
            </Button>
          )}
          <Toggle
            size="sm"
            checked={c.geoEnabled}
            onChange={c.saveGeoToggle}
            disabled={false}
            label="Geo probe"
            description="Probe egress IP/country per pool every ~30 min (uses geo-API quota)"
          />
          <Button variant="secondary" size="sm" icon="refresh" onClick={c.reload}>
            Refresh
          </Button>
        </div>
      </div>
      <p className="text-sm text-text-muted">
        Shows which provider is blocked on which proxy egress (region gates, per-IP limits, or idle
        marks). Smart rotation skips these pools while the block is active; blocks self-recover when
        their window closes.
      </p>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border-subtle bg-surface p-3">
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
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. 104.28, vercel-relay…" />
        </div>
      </div>

      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-left text-xs uppercase tracking-wider text-text-muted">
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
                  const pool = c.poolById.get(rec.poolId);
                  const key = `${rec.poolId}|${rec.provider}`;
                  return (
                    <tr key={key} className="border-b border-border-subtle align-top last:border-0 hover:bg-surface-2/40">
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
                              <span className="truncate">
                                egress {rec.egressIp}
                                {rec.egressCountry ? ` · ${rec.egressCountry}` : ""}
                              </span>
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
                            disabled={clearingKey === key}
                            title="Clear this block"
                          >
                            {clearingKey === key ? "Clearing…" : "Clear"}
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
        message={
          providerFilter !== "all"
            ? `Clear all active blocks for provider "${providerFilter}"? Those pools become selectable again immediately.`
            : "Clear all active proxy blocks? All pools become selectable again immediately."
        }
        confirmText={clearingAll ? "Clearing…" : "Clear All"}
        cancelText="Cancel"
        variant="danger"
      />
    </div>
  );
}
