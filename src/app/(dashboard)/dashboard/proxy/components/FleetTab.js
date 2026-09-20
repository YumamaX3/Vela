"use client";
// FleetTab — the pool CRUD lens: create, edit, test, toggle, delete, batch import,
// and the bulk sweep. It reads and mutates through the shared controller (`c`), so
// a change here is visible to every other lens on the next render.
//
// ── DEFECT 1 (fixed here): the sweep is ONE request ───────────────────────────
// `handleHealthCheck` used to fan out N client calls to `/api/proxy-pools/[id]/test`
// with its own concurrency queue and its own alive/dead tally. That is a second
// health loop living in the browser — and the fleet's own history is the argument
// against a second loop: bulk-health's route carried a copy of `checkAllPools`, the
// copy drifted, and it disabled pools on `!result.ok`. The console now POSTs
// `/api/proxy-pools/bulk-health` once and reads the engine's answer.
//
// ── DEFECT 2 (fixed here): three verdicts, and only PROVEN death is offered ────
// The response carries `alive`, `dead`, `indeterminate` and a per-pool `results[]`.
// The summary reports all three, and the confirm dialog offers to disable ONLY the
// `dead` subset — the pools the probe proved dead. Indeterminate pools are reported
// as "unknown, left active" and no control on this page can disable them.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Card, Input, Modal, Toggle, ConfirmModal } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";
import { formatDateTime, maskProxyUrl, normalizePoolForm, parseProxyLine, verdictFromTestStatus, verdictFromResult } from "../lib/proxyFormat";
import { PoolVerdictBadge } from "./HealthVerdict";

export default function FleetTab({ c }) {
  const notify = useNotificationStore();
  const [showFormModal, setShowFormModal] = useState(false);
  const [showBatchImportModal, setShowBatchImportModal] = useState(false);
  const [editingProxyPool, setEditingProxyPool] = useState(null);
  const [formData, setFormData] = useState(normalizePoolForm());
  const [batchImportText, setBatchImportText] = useState("");
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [testingId, setTestingId] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [healthChecking, setHealthChecking] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  const [lastSweep, setLastSweep] = useState(null);
  const [resultById, setResultById] = useState({});
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const pools = c.pools;

  // Cleanup selection when pools change (a deleted pool must not stay selected).
  // setState in the effect body is deliberate and matches the sibling pages'
  // pattern (react-hooks/set-state-in-effect): the selection is UI state that must
  // follow the fleet, and pruning it during render would mutate during render.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedIds((prev) => prev.filter((id) => pools.some((p) => p.id === id)));
  }, [pools]);

  const allSelected = pools.length > 0 && selectedIds.length === pools.length;
  const toggleSelect = (id) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleSelectAll = () => setSelectedIds(allSelected ? [] : pools.map((p) => p.id));
  const clearSelection = () => setSelectedIds([]);

  const resetForm = useCallback(() => {
    setEditingProxyPool(null);
    setFormData(normalizePoolForm());
  }, []);
  const openCreateModal = () => {
    resetForm();
    setShowFormModal(true);
  };
  const openEditModal = (proxyPool) => {
    setEditingProxyPool(proxyPool);
    setFormData(normalizePoolForm(proxyPool, { isEdit: true }));
    setShowFormModal(true);
  };
  const closeFormModal = () => {
    setShowFormModal(false);
    resetForm();
  };

  // ── create / edit ─────────────────────────────────────────────────────────
  const handleSave = async () => {
    const isEdit = !!editingProxyPool;
    const payload = {
      name: formData.name.trim(),
      noProxy: formData.noProxy.trim(),
      isActive: formData.isActive === true,
      strictProxy: formData.strictProxy === true,
    };
    // §5.4 — proxyUrl rides the payload ONLY when the operator typed one. On edit the
    // field starts blank and means "keep what is stored"; the route's
    // normalizeProxyPoolUpdate is hasOwnProperty-guarded, so an absent key never enters
    // `updates` and the repo's merge preserves the real credential.
    const typedProxyUrl = formData.proxyUrl.trim();
    if (typedProxyUrl) payload.proxyUrl = typedProxyUrl;
    if (!payload.name) return;
    if (!isEdit && !payload.proxyUrl) return;
    setSaving(true);
    try {
      const res = isEdit ? await c.updatePool(editingProxyPool.id, payload) : await c.createPool(payload);
      if (res.ok) {
        closeFormModal();
        notify.success(isEdit ? "Proxy pool updated" : "Proxy pool created");
      } else {
        notify.error(res.body?.error || "Failed to save proxy pool");
      }
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  // ── delete ────────────────────────────────────────────────────────────────
  const handleDelete = (proxyPool) => {
    setConfirmState({
      title: "Delete Proxy Pool",
      message: `Delete proxy pool "${proxyPool.name}"?`,
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await c.deletePool(proxyPool.id);
          if (res.ok) {
            notify.success("Proxy pool deleted");
            return;
          }
          if (res.status === 409) {
            notify.warning(`Cannot delete: ${res.body?.boundConnectionCount || 0} connection(s) are still using this pool.`);
          } else {
            notify.error(res.body?.error || "Failed to delete proxy pool");
          }
        } catch {
          notify.error("Failed to delete proxy pool");
        }
      },
    });
  };

  // ── single test / toggle ──────────────────────────────────────────────────
  const handleTest = async (proxyPoolId) => {
    setTestingId(proxyPoolId);
    try {
      const res = await c.testPool(proxyPoolId);
      if (!res.ok) {
        notify.error(res.body?.error || "Failed to test proxy");
        return;
      }
      const verdict = res.body?.verdict;
      if (verdict === "alive") notify.success("Proxy test passed");
      else if (verdict === "dead") notify.error("Proxy test failed: pool is dead");
      // The third state gets its own honest copy; it is not a pass and not a death.
      else notify.warning("Proxy test indeterminate: unknown, pool left active");
    } catch {
      notify.error("Failed to test proxy");
    } finally {
      if (mountedRef.current) setTestingId(null);
    }
  };

  const handleToggleActive = async (pool) => {
    const next = !pool.isActive;
    try {
      const res = await c.updatePool(pool.id, { isActive: next });
      if (!res.ok) notify.error("Failed to update active state");
    } catch {
      notify.error("Failed to update active state");
    }
  };

  // ── bulk activate / deactivate / delete ───────────────────────────────────
  const bulkSetActive = async (isActive) => {
    const targets = selectedIds.length > 0 ? selectedIds : pools.map((p) => p.id);
    if (targets.length === 0) return;
    setBulkBusy(true);
    try {
      let ok = 0;
      let failed = 0;
      for (const id of targets) {
        try {
          const res = await c.updatePool(id, { isActive });
          if (res.ok) ok += 1;
          else failed += 1;
        } catch {
          failed += 1;
        }
      }
      notify.success(`${isActive ? "Activated" : "Deactivated"} ${ok}${failed ? `, failed ${failed}` : ""}`);
    } finally {
      if (mountedRef.current) setBulkBusy(false);
    }
  };

  const bulkDelete = () => {
    if (selectedIds.length === 0) return;
    setConfirmState({
      title: "Delete Proxy Pools",
      message: `Delete ${selectedIds.length} proxy pool(s)?`,
      onConfirm: async () => {
        setConfirmState(null);
        setBulkBusy(true);
        try {
          let ok = 0;
          let blocked = 0;
          let failed = 0;
          for (const id of selectedIds) {
            try {
              const res = await c.deletePool(id);
              if (res.ok) ok += 1;
              else if (res.status === 409) blocked += 1;
              else failed += 1;
            } catch {
              failed += 1;
            }
          }
          clearSelection();
          notify.success(`Deleted ${ok}${blocked ? `, ${blocked} bound` : ""}${failed ? `, ${failed} failed` : ""}`);
        } finally {
          if (mountedRef.current) setBulkBusy(false);
        }
      },
    });
  };

  // ── the sweep (Defect 1 + Defect 2) ───────────────────────────────────────
  const handleHealthCheck = async () => {
    if (pools.length === 0) return;
    setHealthChecking(true);
    setLastSweep(null);
    try {
      // ONE request. The engine holds the loop and the verdicts; the browser holds
      // neither. `autoDisable` stays FALSE here — this sweep reports, it does not
      // mutate. Disabling is a separate, explicit operator decision below, and it is
      // scoped to the proven-dead subset.
      //
      // The endpoint sweeps the whole active fleet: `/api/proxy-pools/bulk-health`
      // takes no pool list, and that is the point — the old client fan-out is exactly
      // what let the browser hold a second, divergent health loop. So the button is
      // fleet-wide regardless of the selection, and the summary reports the engine's
      // own `total`.
      const res = await c.bulkHealth({ autoDisable: false });
      if (!res.ok) {
        notify.error(res.body?.error || "Health check failed");
        return;
      }
      const body = res.body || {};
      const results = Array.isArray(body.results) ? body.results : [];
      const byId = {};
      for (const r of results) byId[r.poolId] = r;
      setResultById(byId);
      const summary = {
        total: body.total ?? 0,
        alive: body.alive ?? 0,
        dead: body.dead ?? 0,
        indeterminate: body.indeterminate ?? 0,
      };
      setLastSweep(summary);
      // The dead set is drawn from the ENGINE's verdicts, never from a client-side
      // "not ok": an indeterminate result has `ok: false` too, and offering to
      // disable it would reintroduce the exact defect this console closes.
      const deadIds = results.filter((r) => r.verdict === "dead").map((r) => r.poolId);
      if (deadIds.length > 0) {
        setConfirmState({
          title: "Disable Proven-Dead Proxies",
          message:
            `Alive: ${summary.alive}, Dead: ${summary.dead}, Indeterminate: ${summary.indeterminate}.\n\n` +
            `Disable ${deadIds.length} PROVEN-dead ${deadIds.length === 1 ? "proxy" : "proxies"}? ` +
            `The ${summary.indeterminate} indeterminate ${summary.indeterminate === 1 ? "pool is" : "pools are"} unknown and will be left active.`,
          onConfirm: async () => {
            setConfirmState(null);
            setBulkBusy(true);
            try {
              let ok = 0;
              for (const id of deadIds) {
                try {
                  const put = await c.updatePool(id, { isActive: false });
                  if (put.ok) ok += 1;
                } catch {
                  /* counted by omission */
                }
              }
              notify.success(`Disabled ${ok} proven-dead ${ok === 1 ? "proxy" : "proxies"}`);
            } finally {
              if (mountedRef.current) setBulkBusy(false);
            }
          },
        });
      } else {
        notify.success(
          `Health check done. Alive: ${summary.alive}, Dead: ${summary.dead}, Indeterminate: ${summary.indeterminate} (left active).`
        );
      }
    } catch {
      notify.error("Health check failed");
    } finally {
      if (mountedRef.current) setHealthChecking(false);
    }
  };

  // ── batch import ──────────────────────────────────────────────────────────
  const openBatchImportModal = () => {
    setBatchImportText("");
    setShowBatchImportModal(true);
  };
  const closeBatchImportModal = () => {
    if (importing) return;
    setShowBatchImportModal(false);
  };
  const handleBatchImport = async () => {
    const lines = batchImportText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      notify.warning("Please paste at least one proxy line.");
      return;
    }
    const parsedEntries = [];
    const invalidLines = [];
    lines.forEach((line, index) => {
      try {
        const parsed = parseProxyLine(line);
        if (parsed) parsedEntries.push({ ...parsed, lineNumber: index + 1 });
      } catch (error) {
        invalidLines.push(`Line ${index + 1}: ${error.message}`);
      }
    });
    if (invalidLines.length > 0) {
      notify.error(`Invalid proxy format:\n${invalidLines.join("\n")}`);
      return;
    }
    setImporting(true);
    try {
      // §5.4 — duplicate detection is SERVER-SIDE. Reads are masked, so a client-side
      // Set seeded from `pool.proxyUrl` could never match the plaintext the operator
      // pasted; the route answers 409 PROXY_POOL_ALREADY_EXISTS instead. Intra-batch
      // duplicates are covered too — once the first line lands, the second 409s.
      let created = 0;
      let skipped = 0;
      let failed = 0;
      for (const entry of parsedEntries) {
        const res = await c.createPool({
          name: entry.name,
          proxyUrl: entry.proxyUrl,
          noProxy: "",
          isActive: true,
        });
        if (res.ok) created += 1;
        else if (res.status === 409) skipped += 1;
        else failed += 1;
      }
      setShowBatchImportModal(false);
      notify.success(`Batch import completed: Created ${created}, Skipped ${skipped}, Failed ${failed}`);
    } catch {
      notify.error("Batch import failed");
    } finally {
      if (mountedRef.current) setImporting(false);
    }
  };

  const sweepLabel = useMemo(() => {
    if (!lastSweep) return null;
    return `Alive ${lastSweep.alive} · Dead ${lastSweep.dead} · Indeterminate ${lastSweep.indeterminate}`;
  }, [lastSweep]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="default">Total: {pools.length}</Badge>
          <Badge variant="success">Active: {c.census.active}</Badge>
          <Badge variant="error">Dead: {c.census.dead}</Badge>
          <Badge variant="warning">{c.census.indeterminate} unknown, left active</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={healthChecking ? "progress_activity" : "health_and_safety"}
            onClick={handleHealthCheck}
            disabled={healthChecking || bulkBusy || pools.length === 0}
            title="Sweep the whole active fleet once, through the engine"
          >
            {healthChecking ? "Checking…" : "Health Check"}
          </Button>
          <Button size="sm" variant="secondary" icon="upload" onClick={openBatchImportModal}>
            Batch Import
          </Button>
          <Button size="sm" icon="add" onClick={openCreateModal}>
            Add Proxy Pool
          </Button>
        </div>
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {pools.length > 0 && (
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-text-muted">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                className="size-4 rounded border-black/20 dark:border-white/20"
              />
              {allSelected ? "Unselect all" : "Select all"}
            </label>
          )}
          {sweepLabel && (
            <Badge variant={lastSweep.dead > 0 ? "error" : "default"} size="sm" title="Last bulk health sweep">
              {sweepLabel}
            </Badge>
          )}
        </div>

        {selectedIds.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
            <span className="material-symbols-outlined text-[18px] text-primary">checklist</span>
            <span className="text-xs font-medium text-primary">
              {selectedIds.length} selected
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {selectedIds.length > 0 && (
                <>
                  <Button size="sm" variant="secondary" icon="toggle_on" onClick={() => bulkSetActive(true)} disabled={bulkBusy || healthChecking}>
                    Activate
                  </Button>
                  <Button size="sm" variant="secondary" icon="toggle_off" onClick={() => bulkSetActive(false)} disabled={bulkBusy || healthChecking}>
                    Deactivate
                  </Button>
                  <Button size="sm" variant="secondary" icon="delete" onClick={bulkDelete} disabled={bulkBusy || healthChecking}>
                    Delete
                  </Button>
                  <Button size="sm" variant="ghost" onClick={clearSelection} disabled={bulkBusy || healthChecking}>
                    Clear
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {pools.length === 0 ? (
          <div className="py-10 text-center">
            <p className="mb-1 font-medium text-text-main">No proxy pool entries yet</p>
            <p className="mb-4 text-sm text-text-muted">Create a proxy pool entry, then assign it to connections.</p>
            <Button icon="add" onClick={openCreateModal}>Add Proxy Pool</Button>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-black/[0.04] dark:divide-white/[0.05]">
            {pools.map((pool) => {
              const geo = c.geo[pool.id];
              const probe = resultById[pool.id];
              return (
                <div key={pool.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(pool.id)}
                      onChange={() => toggleSelect(pool.id)}
                      className="mt-1 size-4 shrink-0 rounded border-black/20 dark:border-white/20"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="min-w-0 max-w-full truncate text-sm font-medium sm:max-w-[18rem]">{pool.name}</p>
                        <PoolVerdictBadge pool={pool} />
                        {probe && verdictFromResult(probe) !== verdictFromTestStatus(pool.testStatus) && (
                          <span className="text-[10px] text-text-muted" title="This sweep's fresh verdict">
                            now: {probe.verdict}
                          </span>
                        )}
                        <Badge variant={pool.isActive ? "success" : "default"} size="sm">
                          {pool.isActive ? "active" : "inactive"}
                        </Badge>
                        {pool.type === "vercel" && <Badge variant="default" size="sm">vercel relay</Badge>}
                        {pool.type === "cloudflare" && <Badge variant="default" size="sm">cloudflare relay</Badge>}
                        {pool.type === "deno" && <Badge variant="default" size="sm">deno relay</Badge>}
                        {pool.type === "socks5" && <Badge variant="default" size="sm">socks5</Badge>}
                        <Badge variant="default" size="sm">{pool.boundConnectionCount || 0} bound</Badge>
                      </div>
                      <p className="mt-1 truncate text-xs text-text-muted">{maskProxyUrl(pool.proxyUrl)}</p>
                      {geo && (
                        <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-text-muted">
                          <span className="material-symbols-outlined text-[13px]">travel_explore</span>
                          <span className="font-mono">{geo.ip}</span>
                          {geo.country ? <span>· {geo.country}</span> : null}
                          {geo.isUnstable ? (
                            <Badge variant="warning" size="sm" title={`${geo.ipCount} distinct egress IPs observed`}>
                              flapping
                            </Badge>
                          ) : null}
                          <span className="opacity-70">· {formatDateTime(geo.ts)}</span>
                        </p>
                      )}
                      {pool.noProxy ? <p className="truncate text-xs text-text-muted">No proxy: {pool.noProxy}</p> : null}
                      <p className="mt-1 text-[11px] text-text-muted">
                        Last tested: {formatDateTime(pool.lastTestedAt)}
                        {pool.lastError ? ` · ${pool.lastError}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-1">
                    <Toggle
                      size="sm"
                      checked={pool.isActive === true}
                      onChange={() => handleToggleActive(pool)}
                      title={pool.isActive ? "Disable" : "Enable"}
                    />
                    <button
                      onClick={() => handleTest(pool.id)}
                      className="rounded p-2 text-text-muted hover:bg-black/5 hover:text-primary dark:hover:bg-white/5"
                      title="Test proxy"
                      disabled={testingId === pool.id}
                    >
                      <span
                        className="material-symbols-outlined text-[18px]"
                        style={testingId === pool.id ? { animation: "spin 1s linear infinite" } : undefined}
                      >
                        {testingId === pool.id ? "progress_activity" : "science"}
                      </span>
                    </button>
                    <button
                      onClick={() => openEditModal(pool)}
                      className="rounded p-2 text-text-muted hover:bg-black/5 hover:text-primary dark:hover:bg-white/5"
                      title="Edit"
                    >
                      <span className="material-symbols-outlined text-[18px]">edit</span>
                    </button>
                    <button
                      onClick={() => handleDelete(pool)}
                      className="rounded p-2 text-red-500 hover:bg-red-500/10"
                      title="Delete"
                    >
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Modal isOpen={showBatchImportModal} title="Batch Import Proxies" onClose={closeBatchImportModal}>
        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-text-main">Paste Proxy List (One per line)</label>
            <textarea
              value={batchImportText}
              onChange={(e) => setBatchImportText(e.target.value)}
              placeholder={"http://user:pass@127.0.0.1:7897\n127.0.0.1:7897:user:pass"}
              className="min-h-[180px] w-full rounded-md border border-black/10 bg-white px-3 py-2 text-sm text-text-main transition-all focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 dark:border-white/10 dark:bg-white/5"
            />
            <p className="mt-1 text-xs text-text-muted">
              Supported formats: protocol://user:pass@host:port, host:port:user:pass
            </p>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button fullWidth onClick={handleBatchImport} disabled={!batchImportText.trim() || importing}>
              {importing ? "Importing..." : "Import"}
            </Button>
            <Button fullWidth variant="ghost" onClick={closeBatchImportModal} disabled={importing}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showFormModal}
        title={editingProxyPool ? "Edit Proxy Pool" : "Add Proxy Pool"}
        onClose={closeFormModal}
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Name"
            value={formData.name}
            onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="Office Proxy"
          />
          <Input
            label="Proxy URL"
            value={formData.proxyUrl}
            onChange={(e) => setFormData((prev) => ({ ...prev, proxyUrl: e.target.value }))}
            placeholder={editingProxyPool ? "Stored. Leave blank to keep current" : "http://127.0.0.1:7897"}
            hint={
              editingProxyPool
                ? "Credentials are never sent back to the browser. Enter a new full URL to replace the stored one; leave blank to keep it."
                : undefined
            }
          />
          <Input
            label="No Proxy"
            value={formData.noProxy}
            onChange={(e) => setFormData((prev) => ({ ...prev, noProxy: e.target.value }))}
            placeholder="localhost,127.0.0.1,.internal"
            hint="Comma-separated hosts/domains to bypass proxy"
          />
          <div className="flex flex-col gap-3 rounded-lg border border-border/50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">Active</p>
              <p className="text-xs text-text-muted">Inactive pools are ignored by runtime resolution.</p>
            </div>
            <Toggle
              checked={formData.isActive === true}
              onChange={() => setFormData((prev) => ({ ...prev, isActive: !prev.isActive }))}
              disabled={saving}
            />
          </div>
          <div className="flex flex-col gap-3 rounded-lg border border-border/50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">Strict Proxy</p>
              <p className="text-xs text-text-muted">Fail request if proxy is unreachable instead of falling back to direct.</p>
            </div>
            <Toggle
              checked={formData.strictProxy === true}
              onChange={() => setFormData((prev) => ({ ...prev, strictProxy: !prev.strictProxy }))}
              disabled={saving}
            />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              fullWidth
              onClick={handleSave}
              // §5.4 — proxyUrl is required on CREATE only. On edit the field starts
              // blank to mean "keep the stored credential", so requiring it would make
              // every existing pool unsaveable without retyping a secret the browser
              // no longer holds.
              disabled={!formData.name.trim() || (!editingProxyPool && !formData.proxyUrl.trim()) || saving}
            >
              {saving ? "Saving..." : "Save"}
            </Button>
            <Button fullWidth variant="ghost" onClick={closeFormModal} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

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
