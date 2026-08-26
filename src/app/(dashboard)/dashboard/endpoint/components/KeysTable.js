"use client";

import { useMemo, useState } from "react";
import { Card, Button, Toggle } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { UNCATEGORIZED, categoryOf } from "../lib/keyFormat";
import KeyRow from "./KeyRow";
import KeysBulkBar from "./KeysBulkBar";
import SecurityWarning from "./SecurityWarning";

const USAGE_WINDOWS = [
  ["24h", "24h"],
  ["7d", "7d"],
  ["30d", "30d"],
  ["all", "All time"],
];

/**
 * The management table: usage window pills, Create / Sweep actions, the
 * require-api-key toggle, search, category chips, the bulk bar, and the
 * key rows. Presentational — every handler and datum comes from props.
 */
export default function KeysTable({
  keys,
  filteredKeys,
  categories,
  usagePeriod,
  onUsagePeriod,
  activeCategoryFilter,
  onCategoryFilter,
  requireApiKey,
  onRequireApiKey,
  isRemoteHost,
  loading,
  // row actions
  onOpenDrawer,
  onPause,
  onResume,
  onRotate,
  onDuplicate,
  onTest,
  onDelete,
  onEdit,
  onRevive,
  // vault + copy
  hasKeyOnDevice,
  onCopy,
  copied,
  onForget,
  busyId,
  // usage + health
  keyUsage,
  health,
  // bulk
  selected,
  onToggleAll,
  onToggleSelect,
  onBulkPause,
  onBulkResume,
  onBulkExport,
  onBulkDelete,
  onBulkClear,
  bulkCategory,
  onBulkCategory,
  showBulkCategoryModal,
  onShowBulkCategoryModal,
  onBulkApplyCategory,
  bulkNotice,
  onClearBulkNotice,
  // sweep
  onSweep,
  sweepOpen,
  onSweepOpen,
  sweepList,
  onSweepClose,
  sweepNotice,
  onSweepRevoke,
  onSweepRevokeAll,
  // empty states
  onOpenCreate,
}) {
  const [localSearch, setLocalSearch] = useState("");

  // Search + category filter compose client-side (the hook's filteredKeys
  // only applies the category; search narrows the rendered rows further).
  const searchTerm = localSearch.trim().toLowerCase();
  const rows = useMemo(() => {
    let list = filteredKeys;
    if (searchTerm) {
      list = list.filter((k) =>
        (k.name || "").toLowerCase().includes(searchTerm) ||
        (k.keyPrefix || "").toLowerCase().includes(searchTerm) ||
        (k.category || "").toLowerCase().includes(searchTerm)
      );
    }
    return list;
  }, [filteredKeys, searchTerm]);

  const totalCount = keys.length;

  // Select-all operates on the FILTERED rows, not every key in the system —
  // otherwise search + select-all would pause/delete keys hidden behind the
  // filter. The visible ids ride up through onToggleAll.
  const visibleIds = rows.map((k) => k.id);
  const allVisibleSelected = rows.length > 0 && selected.length === visibleIds.length &&
    visibleIds.every((id) => selected.includes(id));
  const toggleVisibleAll = (checked) => onToggleAll(checked ? visibleIds : []);

  return (
    <Card id="require-api-key">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">vpn_key</span>
          {translate("API Keys")}
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Usage window — filters the per-key stats strips below */}
          <div className="flex items-center rounded-[10px] bg-surface-2 border border-border-subtle p-0.5">
            {USAGE_WINDOWS.map(([value, label]) => (
              <button
                key={value}
                onClick={() => onUsagePeriod(value)}
                title={translate("Usage window")}
                className={`text-[11px] px-2 py-1 rounded-lg transition-colors ${
                  usagePeriod === value
                    ? "bg-primary/15 text-primary font-semibold"
                    : "text-text-muted hover:text-text-main"
                }`}
              >
                {translate(label)}
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" icon="cleaning_services" onClick={onSweep}>
            {translate("Sweep")}
          </Button>
          <Button icon="add" onClick={onOpenCreate}>
            {translate("Create Key")}
          </Button>
        </div>
      </div>

      {/* Require API key toggle */}
      <div className="flex items-center justify-between pb-4 mb-4 border-b border-border">
        <div>
          <p className="font-medium">{translate("Require API key")}</p>
          <p className="text-sm text-text-muted">
            {translate("Requests without a valid key will be rejected")}
          </p>
        </div>
        <Toggle checked={requireApiKey} onChange={onRequireApiKey} />
      </div>

      {isRemoteHost && !requireApiKey && (
        <div className="mb-4 -mt-2">
          <SecurityWarning message="Endpoint is exposed without an API key." />
        </div>
      )}

      {/* Search */}
      {totalCount > 0 && (
        <div className="mb-3">
          <input
            type="text"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            placeholder={translate("Search keys by name, prefix, category…")}
            className="w-full py-2 px-3 text-sm text-text-main bg-surface-2 rounded-[10px] border border-transparent placeholder-text-muted/70 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/40 transition-all"
          />
        </div>
      )}

      {/* Category filter chips — derived from the categories keys carry */}
      {totalCount > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap mb-4">
          <button
            onClick={() => onCategoryFilter("all")}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              activeCategoryFilter === "all"
                ? "bg-primary/15 text-primary border-primary/40 font-semibold"
                : "bg-surface-2 text-text-muted border-border-subtle hover:text-text-main"
            }`}
          >
            {translate("All")} · {totalCount}
          </button>
          {categories.map((cat) => {
            const count = keys.filter((k) => k.category === cat).length;
            return (
              <button
                key={cat}
                onClick={() => onCategoryFilter(cat)}
                title={cat}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  activeCategoryFilter === cat
                    ? "bg-primary/15 text-primary border-primary/40 font-semibold"
                    : "bg-surface-2 text-text-muted border-border-subtle hover:text-text-main"
                }`}
              >
                {cat} · {count}
              </button>
            );
          })}
          {keys.some((k) => !k.category) && (
            <button
              onClick={() => onCategoryFilter(UNCATEGORIZED)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                activeCategoryFilter === UNCATEGORIZED
                  ? "bg-primary/15 text-primary border-primary/40 font-semibold"
                  : "bg-surface-2 text-text-muted border-border-subtle hover:text-text-main"
              }`}
            >
              {translate("Uncategorized")} · {keys.filter((k) => !k.category).length}
            </button>
          )}
        </div>
      )}

      {/* Bulk bar */}
      <KeysBulkBar
        count={selected.length}
        onPause={onBulkPause}
        onResume={onBulkResume}
        onExport={onBulkExport}
        onDelete={onBulkDelete}
        onClear={onBulkClear}
        onSetCategory={() => onShowBulkCategoryModal(true)}
        showCategoryModal={showBulkCategoryModal}
        setShowCategoryModal={onShowBulkCategoryModal}
        category={bulkCategory}
        setCategory={onBulkCategory}
        onApplyCategory={() => onBulkApplyCategory(bulkCategory)}
      />

      {bulkNotice && (
        <div className="mb-3 flex items-center justify-between gap-2 text-xs text-primary bg-primary/5 border border-primary/20 rounded-lg px-3 py-2">
          <span>{bulkNotice}</span>
          <button onClick={onClearBulkNotice} className="text-text-muted hover:text-text-main" aria-label={translate("Dismiss")}>
            <span className="material-symbols-outlined text-[14px]">close</span>
          </button>
        </div>
      )}

      {/* Sweep review panel */}
      {sweepOpen && (
        <div className="mb-4 rounded-[10px] border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">cleaning_services</span>
              {translate("Stale keys")}
            </p>
            <button onClick={onSweepClose} className="text-text-muted hover:text-text-main" aria-label={translate("Close")}>
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
          {sweepNotice && (
            <div className="mb-2 flex items-center justify-between gap-2 text-xs text-primary bg-primary/5 border border-primary/20 rounded-lg px-3 py-1.5">
              <span>{sweepNotice}</span>
            </div>
          )}
          {sweepList.length === 0 ? (
            <p className="text-xs text-text-muted">{translate("No stale keys found")}</p>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                {sweepList.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-text-main truncate">{s.name}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-text-muted">
                        {s.reason === "expired" ? translate("Expired") : translate("No traffic in 30 days")}
                      </span>
                      <button
                        onClick={() => onSweepRevoke(s)}
                        className="text-red-600 dark:text-red-400 hover:underline font-medium"
                      >
                        {translate("Revoke")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-2 pt-2 border-t border-amber-500/20 flex justify-end">
                <Button size="sm" variant="danger" icon="cleaning_services" onClick={onSweepRevokeAll}>
                  {translate("Revoke all")}
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-text-muted">
          <span className="material-symbols-outlined animate-spin text-[24px] inline-block">progress_activity</span>
        </div>
      ) : totalCount === 0 ? (
        <div className="text-center py-12">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
            <span className="material-symbols-outlined text-[32px]">vpn_key</span>
          </div>
          <p className="text-text-main font-medium mb-1">{translate("No API keys yet")}</p>
          <p className="text-sm text-text-muted mb-4">{translate("Create your first API key to get started")}</p>
          <Button icon="add" onClick={onOpenCreate}>
            {translate("Create Key")}
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-text-main font-medium mb-1">{translate("No matching keys")}</p>
          <p className="text-sm text-text-muted">{translate("Try a different search or category")}</p>
        </div>
      ) : (
        <div className="flex flex-col">
          <div className="flex items-center gap-2 px-3 pb-1.5 border-b border-border-subtle">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={(e) => toggleVisibleAll(e.target.checked)}
              className="accent-primary w-3.5 h-3.5 cursor-pointer"
              title={translate("Select all")}
            />
            <span className="text-[10px] text-text-muted uppercase tracking-wide">
              {translate("Select all")} ({rows.length})
            </span>
          </div>
          {rows.map((key) => (
            <KeyRow
              key={key.id}
              rowKey={key}
              usage={keyUsage[key.id]}
              health={health?.keys?.[key.id]}
              selected={selected.includes(key.id)}
              onToggleSelect={onToggleSelect}
              onOpenDrawer={onOpenDrawer}
              onPause={onPause}
              onResume={onResume}
              onRotate={onRotate}
              onDuplicate={onDuplicate}
              onTest={onTest}
              onDelete={onDelete}
              onEdit={onEdit}
              onRevive={onRevive}
              copied={copied}
              onCopy={onCopy}
              onForget={onForget}
              hasKeyOnDevice={hasKeyOnDevice(key.id)}
              busy={busyId === key.id}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
