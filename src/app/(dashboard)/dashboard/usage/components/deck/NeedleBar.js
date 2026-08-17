// Usage Observatory W2-B — the Needle bar (sealed plan W2(b)).
//
// The sticky global filter bar under the tab rail. FACETS constancy: the
// shared facets (period → provider → model → key) render in the SAME
// order/position on every deck; status + q append after them. The `limits`
// deck drops the period + granularity facets entirely (honestly — limits
// don't respect time). Every control writes to the URL through setFacet.
"use client";

import { useState, useEffect } from "react";
import { t } from "../../lib/t";
import { statusClassOptions } from "../../lib/statusOptions";
import ViewsMenu from "./ViewsMenu";

const PERIOD_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
];

const GRANULARITY_OPTIONS = [
  { value: "", label: "Auto" },
  { value: "1h", label: "1h" },
  { value: "6h", label: "6h" },
  { value: "1d", label: "1d" },
];

const selectCls =
  "h-8 rounded-lg border border-border bg-surface px-2 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/50";

/** @param {object} compass — the full useCompassFilters() return value. */
export default function NeedleBar({ compass }) {
  const { period, provider, model, key, status, q, granParam, tab, setFacet, clearFilters, hasActiveFilters } = compass;
  const [providers, setProviders] = useState([]);
  const [keys, setKeys] = useState([]);
  const [models, setModels] = useState([]);

  const showPeriod = tab !== "limits"; // honesty — limits don't respect time

  useEffect(() => {
    let alive = true;
    fetch("/api/usage/providers").then((r) => r.ok ? r.json() : null).then((d) => {
      if (alive && d) setProviders(d.providers || []);
    }).catch(() => {});
    fetch("/api/keys").then((r) => r.ok ? r.json() : null).then((d) => {
      if (alive && d) setKeys(d.keys || []);
    }).catch(() => {});
    fetch("/api/models").then((r) => r.ok ? r.json() : null).then((d) => {
      if (alive && d) setModels(d.models || []);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-bg-subtle/60 px-3 py-2">
      {/* Shared facet 1 — period (dropped on the limits deck) */}
      {showPeriod && (
        <div className="grid grid-cols-5 items-center gap-1 rounded-md border border-border bg-bg-subtle p-0.5">
          {PERIOD_OPTIONS.map((p) => (
            <button
              key={p.value}
              onClick={() => setFacet("period", p.value)}
              className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                period === p.value
                  ? "bg-primary text-white shadow-sm"
                  : "text-text-muted hover:bg-bg-hover hover:text-text"
              }`}
            >
              {t(p.label)}
            </button>
          ))}
        </div>
      )}

      {/* Shared facets 2-4 — provider · model · key (constancy order) */}
      <select className={selectCls} value={provider} onChange={(e) => setFacet("provider", e.target.value)}>
        <option value="">{t("All providers")}</option>
        {providers.map((p) => (
          <option key={p.id || p.provider} value={p.id || p.provider}>{p.name || p.id || p.provider}</option>
        ))}
      </select>

      <select className={selectCls} value={model} onChange={(e) => setFacet("model", e.target.value)}>
        <option value="">{t("All models")}</option>
        {models.map((m) => (
          <option key={m.id || m} value={m.id || m}>{m.name || m.id || m}</option>
        ))}
      </select>

      <select className={selectCls} value={key} onChange={(e) => setFacet("key", e.target.value)}>
        <option value="">{t("All keys")}</option>
        {keys.map((k) => (
          <option key={k.id} value={k.id}>{k.name || k.id}</option>
        ))}
      </select>

      {/* Adaptive facets — status · q */}
      <select className={selectCls} value={status} onChange={(e) => setFacet("status", e.target.value)}>
        <option value="">{t("All statuses")}</option>
        {statusClassOptions.map((s) => (
          <option key={s.value} value={s.value}>{t(s.label)}</option>
        ))}
      </select>

      <input
        type="search"
        value={q}
        onChange={(e) => setFacet("q", e.target.value)}
        placeholder={t("Search model, provider, endpoint…")}
        className={`${selectCls} w-44 flex-1 sm:flex-none`}
      />

      {/* Granularity override (timeseries facet — dropped on limits deck) */}
      {showPeriod && (
        <select className={selectCls} value={granParam} onChange={(e) => setFacet("gran", e.target.value)}>
          {GRANULARITY_OPTIONS.map((g) => (
            <option key={g.value} value={g.value}>{t(g.label)}</option>
          ))}
        </select>
      )}

      {/* Right edge — clear filters + the W4-A saved-views menu */}
      <div className="ml-auto flex items-center gap-1">
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-text-muted hover:bg-bg-hover hover:text-text"
          >
            <span className="material-symbols-outlined text-[14px]">filter_alt_off</span>
            {t("Clear filters")}
          </button>
        )}
        <ViewsMenu compass={compass} />
      </div>
    </div>
  );
}
