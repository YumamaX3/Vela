"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, Button, ConfirmModal, CapacityBadges, Select, Toggle, CardSkeleton } from "@/shared/components";
import ComboFormModal from "@/shared/components/ComboFormModal";
import ModelSelectModal from "@/shared/components/ModelSelectModal";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import { validateComboName } from "@/shared/constants/comboValidation";

// Capacity adapter: global fallback pools of models per input-modality capability.
// A request needing a capability the target model/combo lacks switches straight
// to the first enabled model here instead of erroring or dropping the data.
const CAPACITY_ADAPTER_CAPS = [
  { key: "vision", label: "Vision", icon: "visibility", desc: "Images" },
  // pdf, videoInput temporarily hidden — no translator support yet for those blocks.
  { key: "audioInput", label: "Audio", icon: "graphic_eq", desc: "Audio input" },
];
const DEFAULT_FALLBACK_MODEL = "oc/mimo-v2.5-free";
const EMPTY_CAP_ENTRY = { enabled: true, roundRobin: false, models: [] };
const EMPTY_CAPACITY_ADAPTER = {
  vision: { ...EMPTY_CAP_ENTRY },
  pdf: { ...EMPTY_CAP_ENTRY },
  audioInput: { ...EMPTY_CAP_ENTRY },
  videoInput: { ...EMPTY_CAP_ENTRY },
};
// Backward-compat: legacy stored form was an array of {model, enabled}.
function normalizeCapEntry(entry) {
  if (Array.isArray(entry)) {
    return { enabled: true, roundRobin: false, models: entry.map((e) => e?.model || e).filter(Boolean) };
  }
  if (entry && typeof entry === "object") {
    return {
      enabled: entry.enabled !== false,
      roundRobin: !!entry.roundRobin,
      models: Array.isArray(entry.models) ? entry.models.filter(Boolean) : [],
    };
  }
  return { ...EMPTY_CAP_ENTRY };
}

const STRATEGY_META = {
  fallback: { label: "Fallback", icon: "route", tint: "text-primary", bg: "bg-primary/10", hint: "Tries models in order, next on failure" },
  "round-robin": { label: "Round Robin", icon: "sync_alt", tint: "text-emerald-500", bg: "bg-emerald-500/10", hint: "Rotates models across requests" },
  fusion: { label: "Fusion", icon: "hub", tint: "text-violet-500", bg: "bg-violet-500/10", hint: "Panel + judge · N+1 calls" },
};

const SORTS = [
  { value: "name", label: "Name" },
  { value: "recent", label: "Recently used" },
  { value: "members", label: "Members" },
];

// ─── helpers ────────────────────────────────────────────────────────────────

function fmt(n) {
  if (n == null) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return new Intl.NumberFormat().format(n);
}

function fmtCost(c) {
  if (!c) return "$0";
  if (c < 0.001) return `<$0.001`;
  return `$${c.toFixed(3)}`;
}

function timeAgo(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// Split a slash-bearing combo name into (harbor, leaf): the leading namespace
// segments become the group key, the last segment is the display leaf.
// "vela/cc/opus" → ("vela/cc", "opus"); "opus" → ("", "opus").
function splitHarbor(name) {
  const idx = name.lastIndexOf("/");
  if (idx === -1) return { harbor: "", leaf: name };
  return { harbor: name.slice(0, idx), leaf: name.slice(idx + 1) };
}

// Which provider does a member model reference? The segment before the first
// "/" — e.g. "openai/gpt-5" → "openai". Members without "/" can't be mapped.
function providerOf(member) {
  const idx = member.indexOf("/");
  return idx === -1 ? null : member.slice(0, idx);
}

// ─── the page ───────────────────────────────────────────────────────────────

export default function CombosPage() {
  const [combos, setCombos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingCombo, setEditingCombo] = useState(null);
  const [activeProviders, setActiveProviders] = useState([]);
  const [providerNodePrefixes, setProviderNodePrefixes] = useState(new Set());
  const [comboStrategies, setComboStrategies] = useState({});
  const [capacityAdapter, setCapacityAdapter] = useState(EMPTY_CAPACITY_ADAPTER);
  const [comboUsage, setComboUsage] = useState({});
  const [query, setQuery] = useState("");
  const [strategyFilter, setStrategyFilter] = useState("all");
  const [sortKey, setSortKey] = useState("name");
  const [collapsedHarbors, setCollapsedHarbors] = useState({});
  const { getCaps } = useModelCaps();
  const [confirmState, setConfirmState] = useState(null);
  const { copied, copy } = useCopyToClipboard();

  useEffect(() => {
    fetchData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchData = async () => {
    try {
      const [combosRes, providersRes, settingsRes, usageRes] = await Promise.all([
        fetch("/api/combos"),
        fetch("/api/providers"),
        fetch("/api/settings"),
        fetch("/api/combos/usage"),
      ]);
      const combosData = await combosRes.json();
      const providersData = await providersRes.json();
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};

      // Only LLM combos here - webSearch/webFetch combos belong to media-providers/web
      if (combosRes.ok) setCombos((combosData.combos || []).filter((c) => !c.kind || c.kind === "llm"));
      if (providersRes.ok) setActiveProviders(providersData.connections || []);
      setComboStrategies(settingsData.comboStrategies || {});

      const rawAdapter = settingsData.capacityAdapter || {};
      const normalized = {};
      for (const cap of CAPACITY_ADAPTER_CAPS) {
        normalized[cap.key] = normalizeCapEntry(rawAdapter[cap.key]);
      }
      setCapacityAdapter(normalized);

      // Per-combo usage attribution (migration 015) — keyed by combo name.
      if (usageRes.ok) {
        const usageData = await usageRes.json();
        const byName = {};
        for (const c of usageData.combos || []) byName[c.combo] = c;
        setComboUsage(byName);
      }

      // Provider-node prefixes so reachability counts members that point at
      // user-defined openai/anthropic-compatible nodes, not just built-ins.
      try {
        const nodesRes = await fetch("/api/provider-nodes");
        if (nodesRes.ok) {
          const nodesData = await nodesRes.json();
          setProviderNodePrefixes(new Set((nodesData.nodes || []).map((n) => n.prefix).filter(Boolean)));
        }
      } catch {}
    } catch (error) {
      console.log("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  // Set of connected provider ids — a member's provider segment counts as
  // reachable when an ACTIVE connection exists OR a user-defined node prefix
  // matches. (connections carry isActive; inactive ones don't serve traffic.)
  const connectedProviders = useMemo(() => {
    const set = new Set();
    for (const c of activeProviders) {
      if (!c.provider) continue;
      if (c.isActive === false) { set.delete(c.provider); continue; }
      set.add(c.provider);
    }
    return set;
  }, [activeProviders]);

  const memberReachable = (member) => {
    const p = providerOf(member);
    if (!p) return null; // no provider segment — unknown, don't judge
    return connectedProviders.has(p) || providerNodePrefixes.has(p);
  };

  const reachability = (combo) => {
    let total = 0;
    let reachable = 0;
    for (const m of combo.models) {
      const r = memberReachable(m);
      if (r === null) continue;
      total += 1;
      if (r) reachable += 1;
    }
    return { total, reachable };
  };

  // Merge a per-combo strategy patch into settings.comboStrategies. Passing an
  // empty patch (strategy back to default "fallback") drops the entry entirely.
  const handleSetComboStrategy = async (comboName, patch) => {
    try {
      const updated = { ...comboStrategies };
      const next = { ...(updated[comboName] || {}), ...patch };
      if (!next.fallbackStrategy || next.fallbackStrategy === "fallback") {
        delete updated[comboName];
      } else {
        updated[comboName] = next;
      }
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comboStrategies: updated }),
      });
      setComboStrategies(updated);
    } catch (error) {
      console.log("Error updating combo strategy:", error);
    }
  };

  const handleSetCapacityAdapter = async (next) => {
    setCapacityAdapter(next);
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capacityAdapter: next }),
      });
    } catch (error) {
      console.log("Error updating capacity adapter:", error);
    }
  };

  const handleCreate = async (data) => {
    try {
      const res = await fetch("/api/combos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        await fetchData();
        setShowCreateModal(false);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to create combo");
      }
    } catch (error) {
      console.log("Error creating combo:", error);
    }
  };

  const handleUpdate = async (id, data) => {
    try {
      const res = await fetch(`/api/combos/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        await fetchData();
        setEditingCombo(null);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to update combo");
      }
    } catch (error) {
      console.log("Error updating combo:", error);
    }
  };

  const handleDelete = (id) => {
    setConfirmState({
      title: "Delete combo",
      message: "This combo will be removed. Any keys or rules that reference it will stop resolving to it.",
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch(`/api/combos/${id}`, { method: "DELETE" });
          if (res.ok) setCombos((prev) => prev.filter((c) => c.id !== id));
        } catch (error) {
          console.log("Error deleting combo:", error);
        }
      },
    });
  };

  // Duplicate: POST a copy with the next free "<name>-copy" suffix.
  const handleDuplicate = async (combo) => {
    let candidate = `${combo.name}-copy`;
    let i = 2;
    while (combos.some((c) => c.name === candidate)) {
      candidate = `${combo.name}-copy-${i}`;
      i += 1;
      if (i > 100) return;
    }
    try {
      const res = await fetch("/api/combos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: candidate, models: combo.models }),
      });
      if (res.ok) await fetchData();
      else {
        const err = await res.json();
        alert(err.error || "Failed to duplicate combo");
      }
    } catch (error) {
      console.log("Error duplicating combo:", error);
    }
  };

  // JSON export — the full fleet, one downloadable file.
  const handleExport = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      combos: combos.map(({ id, name, models, kind, createdAt, updatedAt }) => ({ id, name, models, kind, createdAt, updatedAt })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vela-combos.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  // JSON import — merge by name (skip existing), report what landed.
  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const incoming = Array.isArray(parsed) ? parsed : parsed.combos;
      if (!Array.isArray(incoming)) {
        alert("That file is not a Vela combos export.");
        return;
      }
      let added = 0;
      let skipped = 0;
      for (const item of incoming) {
        const verdict = validateComboName(item.name);
        if (!verdict.ok) { skipped += 1; continue; }
        if (combos.some((c) => c.name === verdict.name)) { skipped += 1; continue; }
        const res = await fetch("/api/combos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: verdict.name, models: Array.isArray(item.models) ? item.models : [], kind: item.kind || null }),
        });
        if (res.ok) added += 1;
        else skipped += 1;
      }
      alert(`Imported ${added} combo${added === 1 ? "" : "s"}${skipped ? `, skipped ${skipped} (invalid or already exists)` : ""}.`);
      if (added) await fetchData();
    } catch {
      alert("Could not read that file as JSON.");
    }
  };

  const toggleHarbor = (harbor) => {
    setCollapsedHarbors((prev) => ({ ...prev, [harbor]: !prev[harbor] }));
  };

  // ─── filtering, sorting, grouping ────────────────────────────────────────
  const strategyOf = (name) => (comboStrategies[name]?.fallbackStrategy || "fallback");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = combos.filter((c) => {
      if (strategyFilter !== "all" && strategyOf(c.name) !== strategyFilter) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || c.models.some((m) => m.toLowerCase().includes(q));
    });
    if (sortKey === "recent") {
      list = [...list].sort((a, b) => {
        const la = comboUsage[a.name]?.lastAt || "";
        const lb = comboUsage[b.name]?.lastAt || "";
        return lb.localeCompare(la) || a.name.localeCompare(b.name);
      });
    } else if (sortKey === "members") {
      list = [...list].sort((a, b) => b.models.length - a.models.length || a.name.localeCompare(b.name));
    } else {
      list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    }
    return list;
  }, [combos, query, strategyFilter, sortKey, comboUsage, comboStrategies]); // eslint-disable-line react-hooks/exhaustive-deps

  // Group into harbors by slash prefix. Stable order: alphabetical harbor,
  // un-namespaced last (or first when no harbors exist).
  const harbors = useMemo(() => {
    const groups = new Map();
    for (const c of filtered) {
      const { harbor } = splitHarbor(c.name);
      if (!groups.has(harbor)) groups.set(harbor, []);
      groups.get(harbor).push(c);
    }
    const named = [...groups.keys()].filter((h) => h !== "").sort();
    const order = groups.has("") ? (named.length ? [...named, ""] : [""]) : named;
    return order.map((h) => ({ harbor: h, combos: groups.get(h) }));
  }, [filtered]);

  const fleetStats = useMemo(() => {
    const totalMembers = combos.reduce((n, c) => n + c.models.length, 0);
    const fusionCount = combos.filter((c) => strategyOf(c.name) === "fusion").length;
    const active24h = combos.filter((c) => (comboUsage[c.name]?.requests || 0) > 0).length;
    return { totalMembers, fusionCount, active24h };
  }, [combos, comboUsage, comboStrategies]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  const hasAny = combos.length > 0;

  return (
    <div className="flex min-w-0 flex-col gap-5 px-1 sm:px-0">
      {/* Masthead — title + fleet pulse */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight">Combos</h1>
            <p className="text-sm text-text-muted mt-0.5">Group models under one name, set a strategy per combo, then call it like any model.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="file"
              accept="application/json"
              onChange={handleImportFile}
              className="hidden"
              id="combos-import-input"
            />
            <Button icon="download" variant="ghost" size="sm" onClick={handleExport} disabled={!hasAny} title="Export all combos as JSON">
              Export
            </Button>
            <Button icon="upload" variant="ghost" size="sm" onClick={() => document.getElementById("combos-import-input")?.click()} title="Import combos from a JSON export">
              Import
            </Button>
            <Button icon="add" onClick={() => setShowCreateModal(true)} className="whitespace-nowrap">
              New combo
            </Button>
          </div>
        </div>

        {/* Fleet stats strip */}
        {hasAny && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatChip label="Combos" value={String(combos.length)} icon="layers" />
            <StatChip label="Models in fleet" value={fmt(fleetStats.totalMembers)} icon="deployed_code" />
            <StatChip label="Fusion combos" value={String(fleetStats.fusionCount)} icon="hub" />
            <StatChip label="Active · 24h" value={String(fleetStats.active24h)} icon="monitoring" />
          </div>
        )}
      </div>

      {/* Toolbar — search, strategy filter, sort */}
      {hasAny && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <span className="material-symbols-outlined pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-text-muted">search</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by combo name or member model…"
              className="w-full rounded-lg border border-black/10 bg-white py-1.5 pl-8 pr-3 text-sm outline-none placeholder:text-text-muted/60 focus:border-primary/50 dark:border-white/10 dark:bg-black/20"
            />
          </div>
          <div className="flex items-center gap-2">
            <div className="w-[150px]">
              <Select
                options={[
                  { value: "all", label: "All strategies" },
                  { value: "fallback", label: "Fallback" },
                  { value: "round-robin", label: "Round Robin" },
                  { value: "fusion", label: "Fusion" },
                ]}
                value={strategyFilter}
                onChange={(e) => setStrategyFilter(e.target.value)}
                selectClassName="py-1.5 text-xs"
              />
            </div>
            <div className="w-[130px]">
              <Select options={SORTS} value={sortKey} onChange={(e) => setSortKey(e.target.value)} selectClassName="py-1.5 text-xs" />
            </div>
          </div>
        </div>
      )}

      {/* The fleet — grouped into harbors */}
      {!hasAny ? (
        <Card>
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
              <span className="material-symbols-outlined text-[32px]">layers</span>
            </div>
            <p className="text-text-main font-medium mb-1">No combos yet</p>
            <p className="text-sm text-text-muted mb-4 max-w-md mx-auto">
              Create a combo to route one name across several models. Use <code className="font-mono">/</code> in the name to namespace, like <code className="font-mono">vela/cc/opus</code>.
            </p>
            <Button icon="add" onClick={() => setShowCreateModal(true)} className="w-full sm:w-auto">
              New combo
            </Button>
          </div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <div className="text-center py-10">
            <span className="material-symbols-outlined text-text-muted text-[28px]">search_off</span>
            <p className="text-sm text-text-muted mt-2">No combos match your filters.</p>
            <button onClick={() => { setQuery(""); setStrategyFilter("all"); }} className="mt-2 text-xs text-primary hover:underline">
              Clear filters
            </button>
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {harbors.map(({ harbor, combos: list }) => (
            <HarborSection
              key={harbor || "__unnamespaced__"}
              harbor={harbor}
              combos={list}
              collapsed={!!collapsedHarbors[harbor]}
              onToggle={() => toggleHarbor(harbor)}
              comboStrategies={comboStrategies}
              comboUsage={comboUsage}
              getCaps={getCaps}
              activeProviders={activeProviders}
              copied={copied}
              onCopy={copy}
              reachability={reachability}
              onEdit={setEditingCombo}
              onDelete={handleDelete}
              onDuplicate={handleDuplicate}
              onSetStrategy={handleSetComboStrategy}
            />
          ))}
        </div>
      )}

      {/* Capacity Adapter */}
      <CapacityAdapterSection
        capacityAdapter={capacityAdapter}
        onChange={handleSetCapacityAdapter}
        activeProviders={activeProviders}
        getCaps={getCaps}
      />

      {/* Create Modal — key forces remount so state resets */}
      {showCreateModal && (
        <ComboFormModal
          key="create"
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSave={handleCreate}
          activeProviders={activeProviders}
        />
      )}

      {editingCombo && (
        <ComboFormModal
          key={editingCombo.id}
          isOpen={!!editingCombo}
          combo={editingCombo}
          onClose={() => setEditingCombo(null)}
          onSave={(data) => handleUpdate(editingCombo.id, data)}
          activeProviders={activeProviders}
        />
      )}

      <ConfirmModal
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={confirmState?.onConfirm}
        title={confirmState?.title || "Confirm"}
        message={confirmState?.message}
        variant="danger"
      />
    </div>
  );
}

// ─── harbor section (a namespace group) ─────────────────────────────────────

function HarborSection({ harbor, combos, collapsed, onToggle, comboStrategies, comboUsage, getCaps, activeProviders, copied, onCopy, reachability, onEdit, onDelete, onDuplicate, onSetStrategy }) {
  const isRoot = harbor === "";
  const memberTotal = combos.reduce((n, c) => n + c.models.length, 0);
  return (
    <div className="min-w-0">
      {!isRoot && (
        <button
          onClick={onToggle}
          className="mb-2 flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
        >
          <span className="material-symbols-outlined text-[16px] text-primary">{collapsed ? "chevron_right" : "expand_more"}</span>
          <span className="font-mono text-xs font-medium text-text-main">{harbor}</span>
          <span className="text-[11px] text-text-muted">
            {combos.length} combo{combos.length === 1 ? "" : "s"} · {memberTotal} model{memberTotal === 1 ? "" : "s"}
          </span>
        </button>
      )}
      {!collapsed && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {combos.map((combo) => (
            <ComboCard
              key={combo.id}
              combo={combo}
              strategy={comboStrategies[combo.name] || {}}
              usage={comboUsage[combo.name] || null}
              getCaps={getCaps}
              activeProviders={activeProviders}
              copied={copied}
              onCopy={onCopy}
              reachability={reachability(combo)}
              onEdit={() => onEdit(combo)}
              onDelete={() => onDelete(combo.id)}
              onDuplicate={() => onDuplicate(combo)}
              onSetStrategy={(patch) => onSetStrategy(combo.name, patch)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── the combo card ─────────────────────────────────────────────────────────

function ComboCard({ combo, strategy, usage, getCaps, activeProviders, copied, onCopy, reachability, onEdit, onDelete, onDuplicate, onSetStrategy }) {
  const [showJudgeSelect, setShowJudgeSelect] = useState(false);
  const current = strategy.fallbackStrategy || "fallback";
  const judge = strategy.judgeModel || "";
  const meta = STRATEGY_META[current] || STRATEGY_META.fallback;
  const { leaf } = splitHarbor(combo.name);
  const spark = usage?.series || null;
  const okRatio = usage && usage.requests > 0 ? usage.ok / usage.requests : null;

  return (
    <Card padding="sm" className="group flex min-w-0 flex-col gap-3">
      {/* Row 1 — identity + actions */}
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${meta.bg}`}>
            <span className={`material-symbols-outlined text-[17px] ${meta.tint}`}>{meta.icon}</span>
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <code className="truncate font-mono text-sm font-medium" title={combo.name}>{leaf}</code>
              <span className="text-[10px] text-text-muted">{combo.models.length} model{combo.models.length === 1 ? "" : "s"}</span>
            </div>
            <p className="mt-0.5 truncate text-[10px] text-text-muted" title={meta.hint}>{meta.label} · {meta.hint}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <IconBtn icon="content_copy" label="Copy name" active={copied === `combo-${combo.id}`} onClick={(e) => { e.stopPropagation(); onCopy(combo.name, `combo-${combo.id}`); }} />
          <IconBtn icon="edit" label="Edit" onClick={onEdit} />
          <IconBtn icon="copy_all" label="Duplicate" onClick={onDuplicate} />
          <IconBtn icon="delete" label="Delete" danger onClick={onDelete} />
        </div>
      </div>

      {/* Row 2 — member chips (all of them, with capacity badges) */}
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {combo.models.length === 0 ? (
          <span className="text-xs italic text-text-muted">No models</span>
        ) : (
          combo.models.map((model, index) => (
            <span key={`${model}-${index}`} className="inline-flex max-w-full items-center gap-1 rounded bg-black/5 px-1.5 py-0.5 font-mono text-[11px] text-text-muted dark:bg-white/5" title={model}>
              <span className="truncate">{model}</span>
              <CapacityBadges caps={getCaps?.(model)} />
            </span>
          ))
        )}
      </div>

      {/* Row 3 — live signals: strategy select, usage spark, reachability, fusion judge */}
      <div className="mt-auto flex flex-col gap-2 border-t border-black/5 pt-2 dark:border-white/5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="w-[160px]">
            <Select
              options={[
                { value: "fallback", label: "Fallback" },
                { value: "round-robin", label: "Round Robin" },
                { value: "fusion", label: "Fusion" },
              ]}
              value={current}
              onChange={(e) => onSetStrategy({ fallbackStrategy: e.target.value })}
              selectClassName="py-1 text-xs"
            />
          </div>

          {current === "fusion" && (
            <button
              onClick={() => setShowJudgeSelect(true)}
              className="inline-flex max-w-[200px] items-center gap-1 rounded border border-dashed border-violet-400/50 px-1.5 py-1 font-mono text-[11px] text-violet-500 transition-colors hover:border-violet-400 hover:bg-violet-500/5"
              title="Pick the model that fuses panel answers"
            >
              <span className="material-symbols-outlined text-[13px]">gavel</span>
              <span className="truncate">{judge ? judge : `Auto · ${combo.models[0] || "first model"}`}</span>
            </button>
          )}
          {current === "fusion" && judge && (
            <button onClick={() => onSetStrategy({ judgeModel: "" })} className="rounded p-0.5 text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-500" title="Reset judge to Auto">
              <span className="material-symbols-outlined text-[13px]">close</span>
            </button>
          )}
        </div>

        {/* Usage + reachability row */}
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            {usage && usage.requests > 0 ? (
              <>
                <Sparkline series={spark} />
                <span className="text-[11px] text-text-muted">
                  {fmt(usage.requests)} req · {fmt((usage.promptTokens || 0) + (usage.completionTokens || 0))} tok · {fmtCost(usage.cost)}
                </span>
                {okRatio !== null && (
                  <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${okRatio >= 0.9 ? "bg-emerald-500/10 text-emerald-500" : okRatio >= 0.6 ? "bg-amber-500/10 text-amber-500" : "bg-red-500/10 text-red-500"}`}>
                    <span className="material-symbols-outlined text-[12px]">monitoring</span>
                    {Math.round(okRatio * 100)}% ok
                  </span>
                )}
                <span className="text-[10px] text-text-muted" title={usage.lastAt || ""}>{timeAgo(usage.lastAt)}</span>
              </>
            ) : (
              <span className="text-[11px] italic text-text-muted/70">No usage in the last 24h</span>
            )}
          </div>

          {reachability.total > 0 && (
            <span
              className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${reachability.reachable === reachability.total ? "bg-emerald-500/10 text-emerald-500" : reachability.reachable > 0 ? "bg-amber-500/10 text-amber-500" : "bg-red-500/10 text-red-500"}`}
              title={`${reachability.reachable} of ${reachability.total} member providers are connected`}
            >
              <span className="material-symbols-outlined text-[12px]">{reachability.reachable === reachability.total ? "check_circle" : reachability.reachable > 0 ? "warning" : "error"}</span>
              {reachability.reachable}/{reachability.total} connected
            </span>
          )}
        </div>
      </div>

      {showJudgeSelect && (
        <ModelSelectModal
          isOpen={showJudgeSelect}
          onClose={() => setShowJudgeSelect(false)}
          onSelect={(m) => { onSetStrategy({ judgeModel: m?.value || "" }); setShowJudgeSelect(false); }}
          activeProviders={activeProviders}
          title="Select Judge Model"
          addedModelValues={judge ? [judge] : []}
          closeOnSelect={true}
        />
      )}
    </Card>
  );
}

// A tiny icon action button for the card header.
function IconBtn({ icon, label, active, danger, onClick }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`rounded p-1 transition-colors ${active ? "text-primary" : danger ? "text-text-muted hover:bg-red-500/10 hover:text-red-500" : "text-text-muted hover:bg-black/5 hover:text-primary dark:hover:bg-white/5"}`}
    >
      <span className="material-symbols-outlined text-[16px]">{active ? "check" : icon}</span>
    </button>
  );
}

// The 24h usage sparkline — coral line, gradient fill, honest about empty data.
function Sparkline({ series }) {
  if (!series || series.length === 0) return null;
  const values = series.map((s) => s.requests || 0);
  const max = Math.max(...values, 1);
  const W = 72;
  const H = 20;
  const step = W / Math.max(values.length - 1, 1);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(H - (v / max) * (H - 2) - 1).toFixed(1)}`);
  const path = `M${points.join(" L")}`;
  const area = `${path} L${W},${H} L0,${H} Z`;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0" aria-hidden="true">
      <defs>
        <linearGradient id="combo-spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#E56A4A" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#E56A4A" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#combo-spark-fill)" />
      <path d={path} fill="none" stroke="#E56A4A" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ─── stats chip ─────────────────────────────────────────────────────────────

function StatChip({ label, value, icon }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-black/5 bg-white/60 px-3 py-2 dark:border-white/5 dark:bg-white/[0.03]">
      <span className="material-symbols-outlined text-[18px] text-primary/70">{icon}</span>
      <div className="min-w-0">
        <div className="text-sm font-semibold leading-tight">{value}</div>
        <div className="truncate text-[11px] text-text-muted">{label}</div>
      </div>
    </div>
  );
}

// ─── capacity adapter (carried forward) ─────────────────────────────────────

function CapacityAdapterSection({ capacityAdapter, onChange, activeProviders, getCaps }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium">Vision Adapter</p>
          <p className="text-xs text-text-muted mt-0.5">
            Your model can&apos;t read image/audio? Auto-switches to a model in the pool below.
          </p>
          <ul className="mt-1.5 text-[11px] text-text-muted flex flex-col gap-0.5">
            <li><span className="font-medium text-text-main">Vision</span> — images (png, jpg, webp, …)</li>
            <li><span className="font-medium text-text-main">Audio</span> — audio input</li>
          </ul>
        </div>
      </div>
      <div className="flex flex-col gap-4">
        {CAPACITY_ADAPTER_CAPS.map((cap) => (
          <CapacityAdapterCap
            key={cap.key}
            cap={cap}
            entry={capacityAdapter[cap.key] || EMPTY_CAP_ENTRY}
            onChange={(entry) => onChange({ ...capacityAdapter, [cap.key]: entry })}
            activeProviders={activeProviders}
            getCaps={getCaps}
          />
        ))}
      </div>
    </div>
  );
}

function CapacityAdapterCap({ cap, entry, onChange, activeProviders, getCaps }) {
  const [showModelSelect, setShowModelSelect] = useState(false);
  const { enabled, roundRobin, models } = entry;

  const patch = (p) => onChange({ ...entry, ...p });

  const handleAdd = (model) => {
    if (models.includes(model.value)) return;
    patch({ models: [...models, model.value] });
  };

  const handleRemove = (index) => {
    const next = models.filter((_, i) => i !== index);
    patch({ models: next.length === 0 ? [DEFAULT_FALLBACK_MODEL] : next });
  };

  const handleMove = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= models.length) return;
    const next = [...models];
    [next[index], next[target]] = [next[target], next[index]];
    patch({ models: next });
  };

  return (
    <Card padding="sm" className={`group ${!enabled ? "opacity-50" : ""}`}>
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Master toggle + icon + label + chips */}
        <div className="flex min-w-0 flex-1 items-start gap-2.5 sm:items-center">
          <Toggle
            checked={enabled}
            onChange={(v) => patch({ enabled: v })}
            aria-label={`Enable ${cap.label} adapter`}
          />
          <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-primary text-[18px]">{cap.icon}</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <code className="font-mono text-sm font-medium">{cap.label}</code>
              <span className="text-[10px] text-text-muted">— {cap.desc}</span>
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
              {models.length === 0 ? (
                <span className="text-xs text-text-muted italic">No models</span>
              ) : (
                models.slice(0, 3).map((model, index) => (
                  <code
                    key={`${model}-${index}`}
                    className="group/chip inline-flex items-center gap-1 rounded bg-black/5 px-1.5 py-0.5 font-mono text-xs text-text-muted dark:bg-white/5"
                  >
                    <span>{model}</span>
                    <CapacityBadges caps={getCaps?.(model)} />
                    <button onClick={() => handleMove(index, -1)} disabled={index === 0} className={`leading-none opacity-0 group-hover/chip:opacity-100 ${index === 0 ? "text-text-muted/20" : "text-text-muted hover:text-primary"}`}>
                      <span className="material-symbols-outlined text-[12px]">arrow_upward</span>
                    </button>
                    <button onClick={() => handleMove(index, 1)} disabled={index === models.length - 1} className={`leading-none opacity-0 group-hover/chip:opacity-100 ${index === models.length - 1 ? "text-text-muted/20" : "text-text-muted hover:text-primary"}`}>
                      <span className="material-symbols-outlined text-[12px]">arrow_downward</span>
                    </button>
                    <button onClick={() => handleRemove(index)} className="leading-none opacity-0 group-hover/chip:opacity-100 text-text-muted hover:text-red-500">
                      <span className="material-symbols-outlined text-[12px]">close</span>
                    </button>
                  </code>
                ))
              )}
              {models.length > 3 && (
                <span className="text-[10px] text-text-muted">+{models.length - 3} more</span>
              )}
            </div>
          </div>
        </div>

        {/* Actions: Round-robin toggle + Add Model */}
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3 sm:shrink-0">
          <label className="flex items-center gap-1.5 text-xs text-text-muted cursor-pointer select-none">
            <Toggle
              checked={roundRobin}
              onChange={(v) => patch({ roundRobin: v })}
              disabled={!enabled}
              aria-label={`Round-robin ${cap.label} adapter`}
            />
            <span>Round</span>
          </label>
          <Button
            icon="add"
            variant="ghost"
            size="sm"
            onClick={() => setShowModelSelect(true)}
            disabled={!enabled}
            title={`Add ${cap.label} model`}
          >
            Add Model
          </Button>
        </div>
      </div>

      {showModelSelect && (
        <ModelSelectModal
          isOpen={showModelSelect}
          onClose={() => setShowModelSelect(false)}
          onSelect={handleAdd}
          activeProviders={activeProviders}
          title={`Add ${cap.label} Model`}
          addedModelValues={models}
          capFilter={cap.key}
          closeOnSelect={false}
        />
      )}
    </Card>
  );
}
