"use client";

// The combos flight deck. One fetch, one filter state, one place where every
// mutation is named — the components below never fetch and never decide what
// the fleet means. Lenses (cards, table), the category rail, the detail drawer
// and the bulk bar all read the same selection, so nothing disagrees.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, CardSkeleton, ConfirmModal, Select } from "@/shared/components";
import ComboFormModal from "@/shared/components/ComboFormModal";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import { useCombosData } from "./hooks/useCombosData";
import { useComboFilters } from "./hooks/useComboFilters";
import { applyImport, previewImport } from "./lib/comboApi";
import { comboHealth, providerOf, strategyFor } from "./lib/comboGroups";
import {
  BulkActionBar,
  CapacityAdapterSection,
  ComboDetailDrawer,
  ComboGrid,
  ComboRail,
  ComboTable,
  ComboToolbar,
  CombosEmptyState,
  CombosMasthead,
  FleetPulse,
} from "./components";

const CONFLICT_OPTIONS = [
  { value: "skip", label: "Skip existing" },
  { value: "overwrite", label: "Overwrite existing" },
  { value: "rename", label: "Import as a copy" },
];

const NOTICE_TONES = {
  ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warn: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  red: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
};

export default function CombosPage() {
  const data = useCombosData({ hours: 24 });
  const filters = useComboFilters(data.combos, {
    comboStrategies: data.comboStrategies,
    usageByName: data.usageByName,
    hub: data.hub,
  });
  const { getCaps } = useModelCaps();
  const { copied, copy } = useCopyToClipboard();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingCombo, setEditingCombo] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [confirmState, setConfirmState] = useState(null);
  const [importState, setImportState] = useState(null);
  const [notice, setNotice] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);
  const fileRef = useRef(null);

  const combos = data.combos;
  const selectedIds = useMemo(() => new Set(filters.selected), [filters.selected]);

  // The drawer follows the fleet, not a stale snapshot: edit a combo while its
  // drawer is open and the drawer shows the new truth.
  const detailCombo = useMemo(
    () => (detailId ? combos.find((c) => c.id === detailId) || null : null),
    [detailId, combos]
  );

  // Escape closes what is open, innermost first: the drawer, then a selection.
  // "n" opens a new combo — but only when no field, modal or drawer owns the
  // keyboard, so it can never steal a keystroke from the operator's typing.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        if (detailId) setDetailId(null);
        else filters.clearSelection();
        return;
      }
      if (e.key !== "n" || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      setShowCreateModal(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detailId, filters.clearSelection]);

  // The pulse: the server's census when it answered, this arithmetic otherwise.
  const pulse = useMemo(() => {
    const members = combos.reduce((n, c) => n + (c.models?.length || 0), 0);
    const uniqueModels = new Set(combos.flatMap((c) => c.models || [])).size;
    const providers = new Set(
      combos.flatMap((c) => (c.models || []).map((m) => providerOf(m))).filter(Boolean)
    ).size;
    const fusionCombos = combos.filter((c) => strategyFor(data.comboStrategies, c.name) === "fusion").length;
    const activeCombos = combos.filter((c) => (data.usageByName?.[c.name]?.requests || 0) > 0).length;
    let unreachableMembers = 0;
    for (const combo of combos) {
      const health = comboHealth(combo, data.hub);
      unreachableMembers += health.total - health.reachable;
    }
    return {
      combos: combos.length,
      members,
      uniqueModels,
      providers,
      fusionCombos,
      activeCombos,
      idleCombos: combos.length - activeCombos,
      unreachableMembers,
    };
  }, [combos, data.comboStrategies, data.usageByName, data.hub]);

  // ── mutations ────────────────────────────────────────────────────────────

  const handleCreate = async (payload) => {
    const res = await data.create(payload);
    if (!res.ok) {
      setNotice({ tone: "red", text: res.body?.error || "The combo could not be created." });
      return;
    }
    setShowCreateModal(false);
    setNotice({ tone: "ok", text: `Created ${payload.name}.` });
  };

  const handleUpdate = async (id, payload) => {
    const res = await data.update(id, payload);
    if (!res.ok) {
      setNotice({ tone: "red", text: res.body?.error || "The combo could not be saved." });
      return;
    }
    setEditingCombo(null);
    setNotice({ tone: "ok", text: `Saved ${payload.name || "the combo"}.` });
  };

  const handleDuplicate = async (combo) => {
    const res = await data.duplicate(combo);
    const newName = res.body?.results?.find((r) => r.ok)?.newName;
    if (!res.ok || !newName) {
      setNotice({ tone: "red", text: res.body?.results?.[0]?.error || `Could not copy ${combo.name}.` });
      return;
    }
    setNotice({ tone: "ok", text: `Copied to ${newName}.` });
  };

  const handleDelete = (combo) => {
    setConfirmState({
      title: "Delete combo",
      message: `Delete "${combo.name}"? Requests already routed through it are unaffected, but the name stops resolving immediately.`,
      confirmText: "Delete",
      onConfirm: async () => {
        setConfirmState(null);
        const res = await data.remove(combo.id);
        if (!res.ok) setNotice({ tone: "red", text: res.body?.error || `Could not delete ${combo.name}.` });
        else setNotice({ tone: "ok", text: `Deleted ${combo.name}.` });
      },
    });
  };

  const handleSetStrategy = useCallback(
    async (name, patch) => {
      const res = await data.setStrategy(name, patch);
      if (!res.ok) setNotice({ tone: "red", text: res.body?.error || "The strategy could not be saved." });
      return res;
    },
    [data]
  );

  const handleUpdateModels = async (models) => {
    if (!detailCombo) return;
    const res = await data.update(detailCombo.id, { models });
    if (!res.ok) setNotice({ tone: "red", text: res.body?.error || "The member list could not be saved." });
  };

  // ── bulk ─────────────────────────────────────────────────────────────────

  const summarize = (body, label) => {
    const failed = (body?.results || []).filter((r) => !r.ok);
    setBulkResult({
      changed: body?.changed ?? 0,
      skipped: failed.length,
      detail: failed.length ? `${label}: ${failed[0].error}` : label,
    });
  };

  const bulkAction = async (payload, label) => {
    setBulkBusy(true);
    setBulkResult(null);
    setNotice(null);
    try {
      const res = await data.runBulk(payload);
      if (!res.ok) {
        setNotice({ tone: "red", text: res.body?.error || `${label} failed.` });
        return;
      }
      summarize(res.body, label);
      filters.clearSelection();
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkSetStrategy = async (patch) => {
    const names = filters.selectedCombos.map((c) => c.name);
    setBulkBusy(true);
    setBulkResult(null);
    try {
      const res = await data.setStrategy(names, patch);
      if (!res.ok) {
        setNotice({ tone: "red", text: res.body?.error || "The strategy could not be saved." });
        return;
      }
      setBulkResult({ changed: names.length, skipped: 0, detail: "strategy applied" });
      filters.clearSelection();
    } finally {
      setBulkBusy(false);
    }
  };

  // ── import / export ──────────────────────────────────────────────────────

  const runPreview = async (payload, onConflict) => {
    const res = await previewImport(payload, { onConflict });
    if (!res.ok) {
      setNotice({ tone: "red", text: res.body?.error || "That file could not be read." });
      setImportState(null);
      return;
    }
    setImportState({ payload, onConflict, preview: res.body, busy: false });
  };

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setNotice(null);
    let payload;
    try {
      payload = JSON.parse(await file.text());
    } catch {
      setNotice({ tone: "red", text: `${file.name} is not valid JSON.` });
      return;
    }
    await runPreview(payload, "skip");
  };

  const handleApplyImport = async () => {
    if (!importState) return;
    setImportState({ ...importState, busy: true });
    const res = await applyImport(importState.payload, { onConflict: importState.onConflict });
    if (!res.ok) {
      setNotice({ tone: "red", text: res.body?.error || "The import failed." });
      setImportState({ ...importState, busy: false });
      return;
    }
    const applied = res.body?.applied || { changed: 0, strategies: 0 };
    await data.reload();
    setImportState(null);
    setNotice({
      tone: applied.changed ? "ok" : "warn",
      text: applied.changed
        ? `Imported ${applied.changed} combo${applied.changed === 1 ? "" : "s"}${applied.strategies ? ` and ${applied.strategies} strateg${applied.strategies === 1 ? "y" : "ies"}` : ""}.`
        : "Nothing was imported — every combo in the file was skipped.",
    });
  };

  const importSummary = importState?.preview?.summary;

  // ── states ───────────────────────────────────────────────────────────────

  if (data.loading) {
    return (
      <div className="flex flex-col gap-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  const hasAny = combos.length > 0;

  return (
    <div className="flex flex-col gap-5">
      <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={handleFile} />

      <CombosMasthead
        hasAny={hasAny}
        loading={data.loading}
        onNew={() => setShowCreateModal(true)}
        onReload={data.reload}
        onImportClick={() => fileRef.current?.click()}
      />

      {notice && (
        <div className={`rounded-[12px] border px-3 py-2 text-xs ${NOTICE_TONES[notice.tone] || NOTICE_TONES.warn}`}>
          {notice.text}
        </div>
      )}

      {data.error && !notice && (
        <div className={`flex flex-wrap items-center gap-2 rounded-[12px] border px-3 py-2 text-xs ${NOTICE_TONES.red}`}>
          <span>{data.error}</span>
          <button
            type="button"
            onClick={data.reload}
            className="font-medium underline decoration-dotted underline-offset-2"
          >
            Retry
          </button>
        </div>
      )}

      {importState && (
        <Card padding="sm">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">Import preview</p>
                <p className="mt-0.5 text-xs text-text-muted">
                  {importSummary
                    ? `${importSummary.incoming} in the file · ${importSummary.add} add · ${importSummary.overwrite} overwrite · ${importSummary.skip} skip · ${importSummary.invalid} invalid`
                    : "Reading the file…"}
                </p>
              </div>
              <Select
                options={CONFLICT_OPTIONS}
                value={importState.onConflict}
                onChange={(e) => runPreview(importState.payload, e.target.value)}
                selectClassName="py-1.5 text-xs"
              />
            </div>

            {importState.preview?.invalid?.length > 0 && (
              <p className="text-[11px] text-amber-700 dark:text-amber-300">
                Refused by name: {importState.preview.invalid.slice(0, 6).map((i) => `${i.name} (${i.error})`).join(" · ")}
                {importState.preview.invalid.length > 6 && ` · +${importState.preview.invalid.length - 6} more`}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                icon="download_done"
                size="sm"
                onClick={handleApplyImport}
                disabled={importState.busy || !importState.preview || !(importSummary?.add || importSummary?.overwrite)}
              >
                {importState.busy ? "Importing…" : "Apply import"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setImportState(null)} disabled={importState.busy}>
                Cancel
              </Button>
              <span className="text-[11px] text-text-muted">
                Nothing has been written yet — the dry run is the only thing that has run.
              </span>
            </div>
          </div>
        </Card>
      )}

      {hasAny && <FleetPulse pulse={pulse} server={data.serverStats} />}

      {hasAny && (
        <ComboToolbar
          query={filters.query}
          onQuery={filters.setQuery}
          strategyFilter={filters.strategyFilter}
          onStrategy={filters.setStrategyFilter}
          healthFilter={filters.healthFilter}
          onHealth={filters.setHealthFilter}
          sortKey={filters.sortKey}
          onSort={filters.setSortKey}
          view={filters.view}
          onView={filters.setView}
          onReload={data.reload}
          filtersActive={filters.filtersActive}
          onReset={filters.resetFilters}
          resultCount={filters.filtered.length}
          totalCount={combos.length}
          onCollapseAll={filters.collapseAll}
          onExpandAll={filters.expandAll}
        />
      )}

      {!hasAny ? (
        <CombosEmptyState variant="empty" onCreate={() => setShowCreateModal(true)} />
      ) : (
        <div className="flex min-w-0 flex-col gap-5 lg:flex-row lg:items-start">
          {/* Below lg the rail becomes a wrapping chip row; above it, the
              master column — so smart views and namespaces stay reachable on a
              phone without eating the first screen. */}
          <aside className="min-w-0 lg:sticky lg:top-4 lg:w-56 lg:shrink-0">
            <div className="lg:hidden">
              <ComboRail
                compact
                counts={filters.counts}
                tree={filters.tree}
                category={filters.category}
                onSelect={filters.selectCategory}
                totalCombos={combos.length}
              />
            </div>
            <div className="hidden lg:block">
              <ComboRail
                counts={filters.counts}
                tree={filters.tree}
                category={filters.category}
                onSelect={filters.selectCategory}
                totalCombos={combos.length}
              />
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col gap-4">
            {filters.filtered.length === 0 ? (
              <CombosEmptyState variant="no-match" onReset={filters.resetFilters} />
            ) : filters.view === "table" ? (
              <ComboTable
                combos={filters.filtered}
                comboStrategies={data.comboStrategies}
                usageByName={data.usageByName}
                hubHealth={(combo) => comboHealth(combo, data.hub)}
                getCaps={getCaps}
                copied={copied}
                selectedIds={selectedIds}
                onToggleSelect={filters.toggleSelect}
                onSelectAll={filters.selectAll}
                onCopy={copy}
                onOpen={(combo) => setDetailId(combo.id)}
                onEdit={setEditingCombo}
                onDuplicate={handleDuplicate}
                onDelete={handleDelete}
                sortKey={filters.sortKey}
                onSort={filters.setSortKey}
              />
            ) : (
              <ComboGrid
                harbors={filters.harbors}
                comboStrategies={data.comboStrategies}
                usageByName={data.usageByName}
                hub={data.hub}
                getCaps={getCaps}
                copied={copied}
                selectedIds={selectedIds}
                onToggleSelect={filters.toggleSelect}
                onToggle={filters.toggleHarbor}
                collapsed={filters.collapsed}
                onCopy={copy}
                onOpen={(combo) => setDetailId(combo.id)}
                onEdit={setEditingCombo}
                onDuplicate={handleDuplicate}
                onDelete={handleDelete}
                onSetStrategy={handleSetStrategy}
              />
            )}
          </div>
        </div>
      )}

      <CapacityAdapterSection
        capacityAdapter={data.capacityAdapter}
        onChange={data.saveCapacityAdapter}
        activeProviders={data.connections}
        getCaps={getCaps}
      />

      <BulkActionBar
        selected={filters.selectedCombos}
        busy={bulkBusy}
        result={bulkResult}
        onClear={filters.clearSelection}
        onSetStrategy={bulkSetStrategy}
        onDuplicate={() => bulkAction({ action: "duplicate", ids: filters.selected }, "duplicate")}
        onRename={(prefix, nextPrefix) =>
          bulkAction({ action: "renameNamespace", ids: filters.selected, prefix, nextPrefix }, "rename")
        }
        onDelete={() =>
          setConfirmState({
            title: `Delete ${filters.selected.length} combo${filters.selected.length === 1 ? "" : "s"}`,
            message: `Delete ${filters.selected.length} selected combo${filters.selected.length === 1 ? "" : "s"}? The names stop resolving immediately — this cannot be undone.`,
            confirmText: "Delete all",
            onConfirm: () => {
              setConfirmState(null);
              bulkAction({ action: "delete", ids: filters.selected }, "delete");
            },
          })
        }
        onCopy={(text) => copy(text, "bulk")}
      />

      {detailCombo && (
        <ComboDetailDrawer
          combo={detailCombo}
          strategy={data.comboStrategies[detailCombo.name] || {}}
          usage={data.usageByName[detailCombo.name] || null}
          getCaps={getCaps}
          hub={data.hub}
          copied={copied}
          activeProviders={data.connections}
          onCopy={copy}
          onClose={() => setDetailId(null)}
          onEdit={(combo) => {
            setDetailId(null);
            setEditingCombo(combo);
          }}
          onDuplicate={handleDuplicate}
          onDelete={(combo) => {
            setDetailId(null);
            handleDelete(combo);
          }}
          onSetStrategy={(patch) => handleSetStrategy(detailCombo.name, patch)}
          onUpdateModels={handleUpdateModels}
        />
      )}

      {showCreateModal && (
        <ComboFormModal
          key="create"
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSave={handleCreate}
          activeProviders={data.connections}
        />
      )}

      {editingCombo && (
        <ComboFormModal
          key={editingCombo.id}
          isOpen={!!editingCombo}
          combo={editingCombo}
          onClose={() => setEditingCombo(null)}
          onSave={(payload) => handleUpdate(editingCombo.id, payload)}
          activeProviders={data.connections}
        />
      )}

      <ConfirmModal
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={confirmState?.onConfirm}
        title={confirmState?.title || "Confirm"}
        message={confirmState?.message}
        confirmText={confirmState?.confirmText}
        variant="danger"
      />
    </div>
  );
}
