"use client";

// Routed-by-Combo subview — closes the loop between Combos,
// Fallback Rules, and Proxy Pools, which today live in three different
// dashboard pages. One row per combo shows what rule governs it and
// which pool is currently riding it.
//
// New menu #3 (Prism Build D, 2026-09-07).
//
// The subview does NOT mutate any state. It is a read-only observation
// surface, on the principle that *the loop is information, not action*.
// Editing happens on the source pages (combos / fallback-rules / proxy-pools),
// where the form affordances and validation already live.
//
// Anti-slop:
//   R-04 — every column earns its place: combo name, fallback rule, pool.
//          The four join cells (rule sourceModel, rule targetModel,
//          pool name, pool testStatus) are the operator's actual questions.
//   R-12 — empty states are honest. "No active combos" is not the same
//          as "0 results in 0.3s"; the page waits for the fetch and shows
//          what is actually there.
//   R-18 — colors read from --color-* tokens; the only literal is the
//          pool's testStatus, which the API returns as a plain string.

import { useEffect, useState, useMemo } from "react";
import { Card } from "@/shared/components";
import { cn } from "@/shared/utils/cn";

function StatusPill({ testStatus }) {
  // Pool.testStatus is one of: "untested" | "healthy" | "degraded" | "exhausted" | "down".
  // We render with semantic colors that map onto the design tokens.
  const map = {
    healthy: { color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30", label: "Healthy" },
    degraded: { color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30", label: "Degraded" },
    exhausted: { color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30", label: "Exhausted" },
    down: { color: "text-red-500 dark:text-red-400", bg: "bg-red-500/10", border: "border-red-500/30", label: "Down" },
    untested: { color: "text-text-muted", bg: "bg-surface-2/50", border: "border-border-subtle", label: "Untested" },
  };
  const meta = map[testStatus] || map.untested;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border",
        meta.color,
        meta.bg,
        meta.border
      )}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden="true" />
      {meta.label}
    </span>
  );
}

export default function RoutedByComboPage() {
  const [combos, setCombos] = useState(null);
  const [rules, setRules] = useState(null);
  const [pools, setPools] = useState(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);

    const fetchAll = async () => {
      const results = await Promise.allSettled([
        fetch("/api/combos", { cache: "no-store" }).then((r) => r.ok ? r.json() : Promise.reject(new Error(`combos ${r.status}`))),
        fetch("/api/fallback-rules", { cache: "no-store" }).then((r) => r.ok ? r.json() : Promise.reject(new Error(`rules ${r.status}`))),
        fetch("/api/proxy-pools", { cache: "no-store" }).then((r) => r.ok ? r.json() : Promise.reject(new Error(`pools ${r.status}`))),
      ]);

      if (cancelled) return;

      if (results[0].status === "fulfilled") setCombos(results[0].value?.combos || []);
      else { setCombos([]); setLoadError("Could not load combos."); }
      if (results[1].status === "fulfilled") setRules(Array.isArray(results[1].value) ? results[1].value : (results[1].value?.rules || []));
      else { setRules([]); setLoadError((prev) => prev || "Could not load fallback rules."); }
      if (results[2].status === "fulfilled") setPools(Array.isArray(results[2].value) ? results[2].value : (results[2].value?.pools || []));
      else { setPools([]); setLoadError((prev) => prev || "Could not load proxy pools."); }
    };

    fetchAll();
    return () => { cancelled = true; };
  }, []);

  // Join the three streams. For each combo, find the fallback rule whose
  // sourceModel matches the combo name, and the proxy pool whose
  // `data.combo` (best-effort) matches the combo name. Pools that don't
  // carry a combo binding are visible in the right column as the
  // unassigned pool list.
  const rows = useMemo(() => {
    if (!combos || !rules || !pools) return [];
    return combos.map((combo) => {
      const matchingRule = rules.find((r) => r.sourceModel === combo.name);
      const matchingPool = pools.find((p) => {
        const data = p.data || {};
        return data.combo === combo.name || data.comboName === combo.name;
      });
      return {
        combo,
        rule: matchingRule || null,
        pool: matchingPool || null,
      };
    });
  }, [combos, rules, pools]);

  const unassignedPools = useMemo(() => {
    if (!pools || !combos) return [];
    const assignedNames = new Set(combos.map((c) => c.name));
    return pools.filter((p) => {
      const data = p.data || {};
      const cn = data.combo || data.comboName;
      return !cn || !assignedNames.has(cn);
    });
  }, [pools, combos]);

  const isLoading = combos === null || rules === null || pools === null;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-text-main">Routed by Combo</h1>
          <p className="text-sm text-text-muted mt-1">
            The loop between Combos, Fallback Rules, and Proxy Pools. One row per combo.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-text-muted">
          <span className="font-mono">/api/combos</span>
          <span>·</span>
          <span className="font-mono">/api/fallback-rules</span>
          <span>·</span>
          <span className="font-mono">/api/proxy-pools</span>
        </div>
      </header>

      {loadError && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          {loadError} Showing what is available.
        </div>
      )}

      <Card className="p-0 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-text-muted text-sm">
            <span className="material-symbols-outlined mr-2 animate-spin" style={{ fontSize: "16px" }} aria-hidden="true">progress_activity</span>
            Loading routes…
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-12">
            <span className="material-symbols-outlined text-3xl block mb-2 opacity-50" aria-hidden="true">route</span>
            <p className="text-sm text-text-main font-medium">No active combos</p>
            <p className="text-xs text-text-muted mt-1">Create a combo on the Combos page to see the routing loop here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] font-semibold text-text-muted uppercase tracking-wider border-b border-border-subtle">
                  <th className="px-4 py-2.5 w-2/5">Combo</th>
                  <th className="px-4 py-2.5 w-1/4">Fallback rule</th>
                  <th className="px-4 py-2.5 w-1/4">Proxy pool</th>
                  <th className="px-4 py-2.5 w-1/12 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ combo, rule, pool }) => (
                  <tr key={combo.id || combo.name} className="border-b border-border-subtle last:border-b-0 hover:bg-primary/5 transition-colors">
                    <td className="px-4 py-3 align-top">
                      <div className="font-mono text-text-main">{combo.name}</div>
                      {combo.models && (
                        <div className="text-[10px] text-text-muted mt-0.5">
                          {Array.isArray(combo.models) ? combo.models.length : 0} {Array.isArray(combo.models) && combo.models.length === 1 ? "model" : "models"}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      {rule ? (
                        <div>
                          <div className="font-mono text-xs text-text-main">
                            {rule.sourceModel} <span className="text-text-muted">→</span> {rule.targetModel || (Array.isArray(rule.targetModels) ? rule.targetModels.join(" → ") : "—")}
                          </div>
                          {rule.triggerType && (
                            <div className="text-[10px] text-text-muted mt-0.5">{rule.triggerType}</div>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-text-muted">No rule</span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      {pool ? (
                        <div>
                          <div className="font-mono text-xs text-text-main">{pool.name || pool.id}</div>
                          <div className="text-[10px] text-text-muted mt-0.5">
                            {pool.data?.proxyUrl || pool.data?.scheme || "—"}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-text-muted">No pool</span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top text-right">
                      {pool ? (
                        <StatusPill testStatus={pool.testStatus} />
                      ) : (
                        <span className="text-xs text-text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {!isLoading && unassignedPools.length > 0 && (
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-border-subtle flex items-center gap-2">
            <span className="material-symbols-outlined text-text-muted" style={{ fontSize: "14px" }} aria-hidden="true">inventory_2</span>
            <h2 className="text-sm font-medium text-text-main">Unassigned pools</h2>
            <span className="text-[10px] text-text-muted">({unassignedPools.length})</span>
          </div>
          <ul className="divide-y divide-border-subtle">
            {unassignedPools.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="font-mono text-xs text-text-main flex-1 truncate">{p.name || p.id}</span>
                <span className="text-[10px] text-text-muted font-mono">
                  {p.data?.proxyUrl || p.data?.scheme || "—"}
                </span>
                <StatusPill testStatus={p.testStatus} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
