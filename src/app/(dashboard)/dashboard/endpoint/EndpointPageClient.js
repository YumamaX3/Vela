"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  CardSkeleton,
  ConfirmModal,
  ModelSelectModal,
} from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { getKey, hasKey, removeKey } from "@/shared/utils/keyVault";
import { fetchPendingReveals } from "./lib/keyApi";
import { translate } from "@/i18n/runtime";
import { useKeys } from "./hooks/useKeys";
import { useSettings } from "./hooks/useSettings";
import { useTunnel } from "./hooks/useTunnel";
import { useTailscale } from "./hooks/useTailscale";
import { useEndpointFacets } from "@/shared/hooks/useEndpointFacets";
import { serverNowMs } from "@/lib/endpoint/serverNow.js";
import {
  KpiBand,
  EndpointHero,
  KeysTable,
  GovernanceDrawer,
  KeyEditModal,
  KeyCreateModal,
  RemoteAccessPanel,
  InsightsCard,
  ShowOnceModal,
  TabBar,
  CommandPalette,
  MintWizard,
  AuditLedger,
  ImportModal,
} from "./components";

/**
 * The thin orchestrator — composes the modular Observatory tree. All keys /
 * tunnel / tailscale / settings state lives in the hooks; this file only
 * wires their contracts, owns the page-level chrome (copy, stats, share
 * link, show-once reveals), and composes the sections.
 */
export default function APIPageClient() {
  const keysApi = useKeys();
  const settings = useSettings();
  const tailscale = useTailscale();
  // URL facets (tab/status/q/sort) — the one shared hook (Covenant P5).
  const facets = useEndpointFacets();
  const activeTab = facets.state.tab;
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Shared status surface — the tunnel gate and tailscale gate write errors
  // here so the row shows them without duplicating state machines.
  const [remoteStatus, setRemoteStatus] = useState(null);
  const tunnel = useTunnel({
    isLoginUnsafe: settings.isLoginUnsafe,
    unsafeReason: settings.unsafeReason,
    requireApiKey: settings.requireApiKey,
    setStatus: setRemoteStatus,
  });

  const { copied, copy } = useCopyToClipboard();

  // Client-side local/remote detection (UI hint only, not a security gate)
  const [isRemoteHost, setIsRemoteHost] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined")
      setIsRemoteHost(!["localhost", "127.0.0.1", "::1"].includes(window.location.hostname));
  }, []);

  // Hydration fix: only access window on the client side.
  const [baseUrl, setBaseUrl] = useState("/v1");
  useEffect(() => {
    if (typeof window !== "undefined") setBaseUrl(`${window.location.origin}/v1`);
  }, []);

  // Migration-015 revival surfacing — the boot that applied the migration
  // wrote the fresh secrets to a one-time pending-reveal file. Fetch it once
  // on mount; the server deletes the file after serving, so a reload yields
  // nothing (show-once covenant). The reveals play sequentially in the
  // show-once modal.
  const [pendingReveals, setPendingReveals] = useState(null);
  const [pendingRevealIndex, setPendingRevealIndex] = useState(0);
  const [pendingRevealAcked, setPendingRevealAcked] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchPendingReveals()
      .then((reveals) => {
        if (!cancelled && reveals.length) setPendingReveals(reveals);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Endpoint self-test — proves the gateway /v1 surface answers via the
  // health probe (a real provider call is never fired). The result lands in
  // the shared remote-status surface so the failure is actually visible.
  const [testing, setTesting] = useState(false);
  const testingRef = useRef(false);
  const handleEndpointTest = useCallback(async () => {
    if (testingRef.current) return;
    testingRef.current = true;
    setTesting(true);
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Health check failed (${res.status})`);
      }
      setRemoteStatus({ type: "success", message: translate("Gateway endpoint is healthy") });
    } catch (error) {
      setRemoteStatus({ type: "error", message: translate(error.message) });
    } finally {
      testingRef.current = false;
      setTesting(false);
    }
  }, []);

  // 24h usage stats for the KPI band.
  const [stats, setStats] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/usage/stats?period=24h")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .catch(() => {
        if (!cancelled) setStats(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Per-category key counts for the category dropdown chips.
  const keyCategoryCounts = useMemo(() => {
    const counts = {};
    for (const k of keysApi.keys) {
      if (k.category) counts[k.category] = (counts[k.category] || 0) + 1;
    }
    return counts;
  }, [keysApi.keys]);

  // Derived nudges for the Insights card — quota near reset, stale keys.
  const insights = useMemo(() => {
    const items = [];
    for (const k of keysApi.keys) {
      const health = keysApi.health?.keys?.[k.id];
      const ratio = health?.budgetRatio ?? null;
      if (ratio != null && ratio >= 0.8 && k.isActive !== false) {
        items.push({
          tone: "warn",
          icon: "monitoring",
          text: translate(`Key "${k.name}" is near its daily budget limit`),
        });
      }
    }
    const stale = keysApi.health?.sweep || [];
    if (stale.length > 0) {
      items.push({
        tone: "danger",
        icon: "cleaning_services",
        text: translate(`${stale.length} stale key(s) found — run a sweep to clean up`),
      });
    }
    return items;
  }, [keysApi.keys, keysApi.health]);

  // Sweep review state (stale-key candidates).
  const [sweepOpen, setSweepOpen] = useState(false);
  const handleSweep = useCallback(() => {
    setSweepOpen(true);
  }, []);

  // ── Key Domain Ascension — share link (one-time fragment token) ─────────
  const [shareUrl, setShareUrl] = useState("");
  const handleShare = useCallback(
    async (key) => {
      const res = await keysApi.handleShareReveal(key);
      if (!res.ok) {
        setRemoteStatus({ type: "error", message: translate(res.error || "Failed to create share link") });
        return;
      }
      const base = (tunnel.tunnelEnabled && (tunnel.tunnelPublicUrl || tunnel.tunnelUrl))
        || (tailscale.tsEnabled && tailscale.tsUrl)
        || baseUrl;
      setShareUrl(`${base}/share#k=${encodeURIComponent(res.token)}`);
    },
    [keysApi, tunnel.tunnelEnabled, tunnel.tunnelPublicUrl, tunnel.tunnelUrl, tailscale.tsEnabled, tailscale.tsUrl, baseUrl],
  );

  // Load the selected key's recent-request feed when its drawer opens.
  // (keysApi is a fresh object per render — listing it would re-run the
  // effect every render. The stable loadKeyActivity + string activeKeyId
  // are the true deps.)
  useEffect(() => {
    if (keysApi.activeKeyId) {
      keysApi.loadKeyActivity(keysApi.activeKeyId);
      keysApi.loadKeyGovernance(keysApi.activeKeyId);
    }
    // keysApi is a fresh object per render — listing it would re-fire every
    // render. activeKeyId + loadKeyActivity/loadKeyGovernance (stable refs)
    // are the true deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keysApi.activeKeyId, keysApi.loadKeyActivity, keysApi.loadKeyGovernance]);

  // Actionable sweep: confirm, then revoke one or all stale keys.
  const [sweepNotice, setSweepNotice] = useState("");
  const requestSweepRevoke = useCallback((s) => {
    keysApi.setConfirmState({
      title: "Revoke stale key",
      message: `Revoke key "${s.name || s.id}"?\n\nRequests using it will be rejected. The audit row remains, but the key can never be recovered.`,
      onConfirm: async () => {
        keysApi.setConfirmState(null);
        const ok = await keysApi.handleSweepRevoke(s.id);
        setSweepNotice(ok ? `Revoked "${s.name || s.id}"` : "Revoke failed");
      },
    });
  }, [keysApi]);

  const requestSweepRevokeAll = useCallback(() => {
    const list = keysApi.health?.sweep || [];
    if (!list.length) return;
    keysApi.setConfirmState({
      title: "Revoke all stale keys",
      message: `Revoke ${list.length} stale key(s)?\n\nRequests using them will be rejected. The audit rows remain, but the keys can never be recovered.`,
      onConfirm: async () => {
        keysApi.setConfirmState(null);
        const n = await keysApi.handleSweepRevokeAll(list);
        setSweepNotice(`Revoked ${n} stale key(s)`);
      },
    });
  }, [keysApi]);

  // ── W3a: command palette ────────────────────────────────────────────────
  const commandList = useMemo(() => [
    { id: "tab-overview", icon: "space_dashboard", label: translate("Go to Overview"), kbd: "tab", run: () => facets.setFacets({ tab: "overview" }) },
    { id: "tab-keys", icon: "vpn_key", label: translate("Go to Keys"), run: () => facets.setFacets({ tab: "keys" }) },
    { id: "tab-tools", icon: "construction", label: translate("Go to Tools"), run: () => facets.setFacets({ tab: "tools" }) },
    { id: "tab-audit", icon: "receipt_long", label: translate("Go to Audit"), run: () => facets.setFacets({ tab: "audit" }) },
    { id: "import-keys", icon: "upload_file", label: translate("Import keys"), hint: translate("Bulk-mint from JSON or CSV"), run: () => { facets.setFacets({ tab: "keys" }); keysApi.setImportOpen(true); } },
    { id: "status-active", icon: "check_circle", label: translate("Filter: active keys"), run: () => facets.setFacets({ tab: "keys", status: "active" }) },
    { id: "status-revoked", icon: "block", label: translate("Filter: revoked keys"), run: () => facets.setFacets({ tab: "keys", status: "revoked" }) },
    { id: "create-key", icon: "add", label: translate("Create a key"), hint: translate("Opens the create form"), run: () => { facets.setFacets({ tab: "keys" }); keysApi.openCreateModal(); } },
    { id: "mint-template", icon: "auto_awesome", label: translate("Mint from a template"), hint: translate("Template-driven create"), run: () => keysApi.setMintWizardOpen(true) },
    { id: "sweep", icon: "cleaning_services", label: translate("Run a stale-key sweep"), run: () => { facets.setFacets({ tab: "keys" }); handleSweep(); } },
    { id: "export", icon: "download", label: translate("Export key settings"), run: () => keysApi.bulkExport() },
    { id: "audit-ledger", icon: "receipt_long", label: translate("View the mutation ledger"), run: () => facets.setFacets({ tab: "audit" }) },
    { id: "reset-facets", icon: "restart_alt", label: translate("Reset filters"), run: () => facets.resetFacets() },
  ], [facets, keysApi, handleSweep]);

  // ⌘K / ctrl+K toggles the palette.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (keysApi.loading) {
    return (
      <div className="flex flex-col gap-8">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* W3a — the tab bar drives the deck (URL facets) */}
      <TabBar active={activeTab} onSelect={(tab) => facets.setFacets({ tab })} />

      {/* Overview tab — hero, KPIs, remote access, insights */}
      {activeTab === "overview" && (
        <>
          {/* Gateway hero + KPI band */}
          <KpiBand stats={stats} keys={keysApi.keys} loading={keysApi.loading} />

          <EndpointHero
            baseUrl={baseUrl}
            copied={copied}
            onCopy={copy}
            tunnelUrl={tunnel.tunnelUrl}
            tunnelEnabled={tunnel.tunnelEnabled}
            tsUrl={tailscale.tsUrl}
            tsEnabled={tailscale.tsEnabled}
            onTest={handleEndpointTest}
            testing={testing}
          />

          {/* Remote access — tunnel + tailscale + security gates */}
          {remoteStatus && (
            <div
              className={`flex items-center gap-2 px-3 py-2 rounded-[10px] border text-sm ${
                remoteStatus.type === "error"
                  ? "border-red-300 dark:border-red-800 bg-red-500/5 text-red-600 dark:text-red-400"
                  : remoteStatus.type === "success"
                    ? "border-green-300 dark:border-green-800 bg-green-500/5 text-green-600 dark:text-green-400"
                    : "border-amber-300 dark:border-amber-800 bg-amber-500/5 text-amber-600 dark:text-amber-400"
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">
                {remoteStatus.type === "error" ? "error" : remoteStatus.type === "success" ? "check_circle" : "warning"}
              </span>
              <span className="min-w-0">{remoteStatus.message}</span>
              <button
                onClick={() => setRemoteStatus(null)}
                className="ml-auto p-1 rounded text-text-muted hover:text-text-main transition-colors"
                aria-label={translate("Dismiss")}
              >
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            </div>
          )}
          <RemoteAccessPanel
            tunnel={tunnel}
            tailscale={tailscale}
            settings={settings}
            copied={copied}
            onCopy={copy}
            baseUrl={baseUrl}
          />

          {/* Insights — computed nudges from the health snapshot */}
          <InsightsCard items={insights} />
        </>
      )}

      {/* Keys tab — the management table */}
      {activeTab === "keys" && (
        <KeysTable
        keys={keysApi.keys}
        filteredKeys={keysApi.filteredKeys}
        categories={keysApi.categories}
        usagePeriod={keysApi.usagePeriod}
        onUsagePeriod={keysApi.setUsagePeriod}
        activeCategoryFilter={keysApi.activeCategoryFilter}
        onCategoryFilter={keysApi.setActiveCategoryFilter}
        requireApiKey={settings.requireApiKey}
        onRequireApiKey={settings.handleRequireApiKey}
        isRemoteHost={isRemoteHost}
        loading={keysApi.loading}
        // row actions
        onOpenDrawer={keysApi.setActiveKeyId}
        onPause={keysApi.requestPauseKey}
        onResume={(k) => keysApi.handleToggleKey(k.id, true)}
        onRotate={keysApi.requestRotateKey}
        onDuplicate={keysApi.handleDuplicateKey}
        onRevive={keysApi.handleReviveKey}
        onTest={keysApi.handleTestKey}
        onDelete={keysApi.requestDeleteKey}
        onEdit={keysApi.openEditKey}
        onExpire={keysApi.handleExpireKey}
        // vault + copy
        hasKeyOnDevice={hasKey}
        onCopy={copy}
        copied={copied}
        onForget={removeKey}
        busyId={keysApi.busyId}
        // usage + health
        keyUsage={keysApi.keyUsage}
        health={keysApi.health}
        // bulk
        selected={keysApi.selected}
        allSelected={keysApi.allSelected}
        onToggleAll={keysApi.setAllSelected}
        onToggleSelect={keysApi.toggleSelected}
        onBulkPause={keysApi.bulkPause}
        onBulkResume={keysApi.bulkResume}
        onBulkExport={keysApi.bulkExport}
        onBulkDelete={keysApi.bulkDelete}
        onBulkClear={() => keysApi.setSelected([])}
        bulkCategory={keysApi.bulkCategory}
        onBulkCategory={keysApi.setBulkCategory}
        showBulkCategoryModal={keysApi.showBulkCategoryModal}
        onShowBulkCategoryModal={keysApi.setShowBulkCategoryModal}
        onBulkApplyCategory={keysApi.bulkSetCategory}
        bulkNotice={keysApi.bulkNotice}
        onClearBulkNotice={keysApi.clearBulkNotice}
        // sweep
        onSweep={handleSweep}
        sweepOpen={sweepOpen}
        onSweepOpen={setSweepOpen}
        sweepList={keysApi.health?.sweep || []}
        onSweepClose={() => setSweepOpen(false)}
        sweepNotice={sweepNotice}
        onSweepRevoke={requestSweepRevoke}
        onSweepRevokeAll={requestSweepRevokeAll}
        // empty states
        onOpenCreate={keysApi.openCreateModal}
      />
      )}

      {/* Tools tab — remote access + security */}
      {activeTab === "tools" && (
        <>
          <EndpointHero
            baseUrl={baseUrl}
            copied={copied}
            onCopy={copy}
            tunnelUrl={tunnel.tunnelUrl}
            tunnelEnabled={tunnel.tunnelEnabled}
            tsUrl={tailscale.tsUrl}
            tsEnabled={tailscale.tsEnabled}
            onTest={handleEndpointTest}
            testing={testing}
          />
          {remoteStatus && (
            <div
              className={`flex items-center gap-2 px-3 py-2 rounded-[10px] border text-sm ${
                remoteStatus.type === "error"
                  ? "border-red-300 dark:border-red-800 bg-red-500/5 text-red-600 dark:text-red-400"
                  : remoteStatus.type === "success"
                    ? "border-green-300 dark:border-green-800 bg-green-500/5 text-green-600 dark:text-green-400"
                    : "border-amber-300 dark:border-amber-800 bg-amber-500/5 text-amber-600 dark:text-amber-400"
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">
                {remoteStatus.type === "error" ? "error" : remoteStatus.type === "success" ? "check_circle" : "warning"}
              </span>
              <span className="min-w-0">{remoteStatus.message}</span>
              <button
                onClick={() => setRemoteStatus(null)}
                className="ml-auto p-1 rounded text-text-muted hover:text-text-main transition-colors"
                aria-label={translate("Dismiss")}
              >
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            </div>
          )}
          <RemoteAccessPanel
            tunnel={tunnel}
            tailscale={tailscale}
            settings={settings}
            copied={copied}
            onCopy={copy}
            baseUrl={baseUrl}
          />
        </>
      )}

      {/* Audit tab — the mutation ledger */}
      {activeTab === "audit" && (
        <AuditLedger
          ledger={keysApi.fleetLedger}
          loading={false}
          onSelectKey={(id) => {
            facets.setFacets({ tab: "keys" });
            keysApi.setActiveKeyId(id);
          }}
        />
      )}

      {/* Import deck — the Key Domain Ascension surface. */}

      {/* Detail drawer — GovernanceDrawer v2 (tags + ledger + lifecycle) */}
      <GovernanceDrawer
        rowKey={keysApi.keys.find((k) => k.id === keysApi.activeKeyId)}
        usage={keysApi.activeKeyId ? keysApi.keyUsage[keysApi.activeKeyId] : null}
        health={keysApi.activeKeyId ? keysApi.health?.keys?.[keysApi.activeKeyId] : null}
        copied={copied}
        onCopy={copy}
        hasKeyOnDevice={keysApi.activeKeyId ? hasKey(keysApi.activeKeyId) : false}
        onPause={keysApi.requestPauseKey}
        onResume={(k) => keysApi.handleToggleKey(k.id, true)}
        onRotate={keysApi.requestRotateKey}
        onDuplicate={keysApi.handleDuplicateKey}
        onRevive={keysApi.handleReviveKey}
        onTest={keysApi.handleTestKey}
        testResult={keysApi.testResult}
        onEdit={keysApi.openEditKey}
        onExpire={keysApi.handleExpireKey}
        onRenew={keysApi.handleRenewKey}
        onDelete={keysApi.requestDeleteKey}
        onShare={handleShare}
        shareUrl={shareUrl}
        onClose={() => { keysApi.setActiveKeyId(null); setShareUrl(""); }}
        busy={!!keysApi.busyId}
        activity={keysApi.activeKeyId ? keysApi.keyActivity[keysApi.activeKeyId] : null}
        activityLoading={keysApi.activityLoading}
        // W3a governance surfaces
        tags={keysApi.activeKeyId ? (keysApi.keyTags[keysApi.activeKeyId] || []) : []}
        onAddTag={(tag) => keysApi.activeKeyId && keysApi.handleAddTag(keysApi.activeKeyId, tag)}
        onRemoveTag={(tag) => keysApi.activeKeyId && keysApi.handleRemoveTag(keysApi.activeKeyId, tag)}
        ledger={keysApi.activeKeyId ? (keysApi.keyLedger[keysApi.activeKeyId] || []) : []}
        ledgerLoading={false}
        serverNow={serverNowMs()}
      />

      {/* Create + edit modals */}
      <KeyCreateModal
        showAddModal={keysApi.showAddModal}
        onClose={() => {
          keysApi.setShowAddModal(false);
          keysApi.resetCreateForm();
        }}
        form={{
          name: keysApi.newKeyName,
          description: keysApi.newKeyDescription,
          category: keysApi.newKeyCategory,
          scopeOn: keysApi.newKeyScopeOn,
          scope: keysApi.newKeyScope,
          allowedKinds: keysApi.newKeyKinds,
          allowedProviders: keysApi.newKeyProviders,
          allowedCombos: keysApi.newKeyCombos,
          limits: keysApi.createLimits,
          modelAliases: keysApi.modelAliases,
          requestCapDaily: keysApi.newKeyRequestCap,
        }}
        setForm={(patch) => {
          if (patch.name !== undefined) keysApi.setNewKeyName(patch.name);
          if (patch.description !== undefined) keysApi.setNewKeyDescription(patch.description);
          if (patch.category !== undefined) keysApi.setNewKeyCategory(patch.category);
          if (patch.scopeOn !== undefined) keysApi.setNewKeyScopeOn(patch.scopeOn);
          if (patch.scope !== undefined) keysApi.setNewKeyScope(patch.scope);
          if (patch.allowedKinds !== undefined) keysApi.setNewKeyKinds(patch.allowedKinds);
          if (patch.allowedProviders !== undefined) keysApi.setNewKeyProviders(patch.allowedProviders);
          if (patch.allowedCombos !== undefined) keysApi.setNewKeyCombos(patch.allowedCombos);
          if (patch.limits !== undefined) keysApi.setCreateLimits(patch.limits);
          if (patch.requestCapDaily !== undefined) keysApi.setNewKeyRequestCap(patch.requestCapDaily);
        }}
        onScopeToggle={(checked) => {
          keysApi.setNewKeyScopeOn(checked);
          if (!checked) keysApi.setNewKeyScope([]);
        }}
        onAddModel={() => keysApi.setScopePickerFor("create")}
        onRemoveModel={(m) => keysApi.setNewKeyScope((prev) => prev.filter((x) => x !== m))}
        onCreate={keysApi.handleCreateKey}
        error={keysApi.createError}
        categories={keysApi.categories}
        keyCount={keyCategoryCounts}
        combos={keysApi.combos}
      />
      <KeyEditModal
        editingKey={keysApi.editingKey}
        onChange={keysApi.setEditingKey}
        onSave={keysApi.handleSaveKey}
        onClose={() => keysApi.setEditingKey(null)}
        onAddModel={() => keysApi.setScopePickerFor("edit")}
        onRemoveModel={(m) =>
          keysApi.setEditingKey((prev) =>
            prev ? { ...prev, allowedModels: (prev.allowedModels || []).filter((x) => x !== m) } : prev
          )
        }
        modelAliases={keysApi.modelAliases}
        combos={keysApi.combos}
        modeOptions={keysApi.labModes}
        injectorOptions={keysApi.labInjectors}
        categories={keysApi.categories}
        keyCount={keyCategoryCounts}
      />

      {/* Grouped model-scope picker — same ModelSelectModal the combos use.
          Combo names are hidden (showCombos=false): for combos the gate checks
          each MEMBER model against the scope, so scoping happens per model. */}
      {keysApi.scopePickerFor && (
        <ModelSelectModal
          isOpen
          onClose={() => keysApi.setScopePickerFor(null)}
          onSelect={keysApi.handleScopeSelect}
          onDeselect={keysApi.handleScopeDeselect}
          activeProviders={keysApi.activeProviders}
          modelAliases={keysApi.modelAliases}
          title={translate("Select models")}
          addedModelValues={keysApi.scopePickerFor === "create" ? keysApi.newKeyScope : (keysApi.editingKey?.allowedModels || [])}
          closeOnSelect={false}
          showCombos={false}
        />
      )}

      {/* Show-once reveal — freshly created or rotated key. The ack flag
          matches whichever flow is active (they are mutually exclusive). */}
      <ShowOnceModal
        title="API Key Created"
        secret={keysApi.createdKey?.key || keysApi.rotatedResult?.key || ""}
        copied={copied === "created_key"}
        onCopy={(secret) => copy(secret, "created_key")}
        acked={keysApi.createdKey ? keysApi.createdKeyAck : keysApi.rotatedAck}
        onAck={(checked) => {
          if (keysApi.createdKey) keysApi.setCreatedKeyAck(checked);
          else keysApi.setRotatedAck(checked);
        }}
        onClose={() => {
          if (keysApi.createdKey ? keysApi.createdKeyAck : keysApi.rotatedAck) {
            keysApi.closeCreatedKeyModal();
            keysApi.setRotatedAck(false);
            keysApi.setRotatedResult(null);
          }
        }}
      />

      {/* Show-once reveal — migration-015 revived keys (sequential paging) */}
      <ShowOnceModal
        title="Legacy Keys Revived"
        secret={pendingReveals ? (pendingReveals[pendingRevealIndex]?.key || "") : ""}
        copied={copied === "pending_reveal"}
        onCopy={(secret) => copy(secret, "pending_reveal")}
        acked={pendingRevealAcked}
        onAck={setPendingRevealAcked}
        onClose={() => {
          if (!pendingRevealAcked) return;
          if (pendingRevealIndex < (pendingReveals?.length || 1) - 1) {
            setPendingRevealIndex((i) => i + 1);
            setPendingRevealAcked(false);
          } else {
            setPendingReveals(null);
            setPendingRevealIndex(0);
            setPendingRevealAcked(false);
          }
        }}
      />

      {/* MintWizard — template-driven create (W3a) */}
      <MintWizard
        open={keysApi.mintWizardOpen}
        onClose={() => keysApi.setMintWizardOpen(false)}
        templates={keysApi.templates}
        templatesLoading={keysApi.templatesLoading}
        onMint={keysApi.handleMintFromTemplate}
        categories={keysApi.categories}
      />

      {/* CommandPalette — ⌘K quick navigation (W3a) */}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={commandList}
        onRunCommand={(cmd) => cmd?.run?.()}
      />

      {/* Key Domain Ascension modals — import */}
      <ImportModal
        open={keysApi.importOpen}
        onClose={() => keysApi.setImportOpen(false)}
        onImport={keysApi.handleImportKeys}
      />

      {/* Confirm Modal — pause/resume/rotate/delete + bulk flows */}
      <ConfirmModal
        isOpen={!!keysApi.confirmState}
        onClose={() => keysApi.setConfirmState(null)}
        onConfirm={keysApi.confirmState?.onConfirm}
        title={keysApi.confirmState?.title || translate("Confirm")}
        message={keysApi.confirmState?.message}
        confirmText={keysApi.confirmState?.confirmText || translate("Confirm")}
        variant={keysApi.confirmState?.variant || "danger"}
      />

      {/* Shared datalist for the category comboboxes — pick an existing
          category or type a brand-new one (friend, hermes, whatever). */}
      <datalist id="key-category-options">
        {keysApi.categories.map((cat) => (
          <option key={cat} value={cat} />
        ))}
      </datalist>
    </div>
  );
}
