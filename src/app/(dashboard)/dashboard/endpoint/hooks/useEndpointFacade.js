"use client";
// The endpoint fleet's consumer facade — the shape the shores already speak.
//
// This hook used to be the room's ONLY store: a thousand-line controller
// mounted inside the page client, so a tab switch kept the data and a route
// navigation threw it away. The data now lives in `stores/endpointStore`
// (mounted by `layout.js`, outliving every route); this hook is the thin reader
// on top of it, keeping the exact `c` surface the components were written
// against — so KeysCard, EndpointCard, SecurityTab and DiagnosticsTab did not
// need to change to ride the store.
//
// The React-only machine stays HERE: the install log's auto-scroll (a DOM node
// the store must never hold) and the two poll `useEffect`s (they read
// subscribed state and register a visibility listener). Everything else —
// including the whole Tailscale/Funnel domain — is store state now.
//
// The one load is idempotent (`loaded` guard + shared `inflight`), so five
// shores each mounting this hook still cost ONE bootstrap cycle per store
// lifetime — the plan's R3, "the bootstrap load runs once per store lifetime".
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import {
  STATUS_POLL_FAST_MS,
  REACHABLE_MISS_THRESHOLD,
  CLIENT_PING_FAST_MS,
} from "../lib/constants";
import { clientPingAny } from "../lib/ping";
import {
  useEndpointStore,
  computeMissingControls,
  computeExposed,
  computeCategories,
} from "../stores/endpointStore";

/**
 * Read the fleet and its mutations. Every shore calls this and mounts a
 * `.load()`; what it gets back is the same `c` object the room's components
 * have always consumed.
 */
export function useEndpointFacade() {
  // ── the store, read with selectors ─────────────────────────────────────────
  // A selector per subscribed field: this hook re-renders when the fields it
  // renders change, not on every store write. Derived aggregates are memoized
  // below per input identity.
  const keys = useEndpointStore((s) => s.keys);
  const loading = useEndpointStore((s) => s.loading);
  const error = useEndpointStore((s) => s.error);
  const keyUsage = useEndpointStore((s) => s.keyUsage);
  const requireApiKey = useEndpointStore((s) => s.requireApiKey);
  const requireLogin = useEndpointStore((s) => s.requireLogin);
  const hasPassword = useEndpointStore((s) => s.hasPassword);
  const tunnelDashboardAccess = useEndpointStore((s) => s.tunnelDashboardAccess);
  const tunnelChecking = useEndpointStore((s) => s.tunnelChecking);
  const tunnelEnabled = useEndpointStore((s) => s.tunnelEnabled);
  const tunnelReachable = useEndpointStore((s) => s.tunnelReachable);
  const tunnelUrl = useEndpointStore((s) => s.tunnelUrl);
  const tunnelPublicUrl = useEndpointStore((s) => s.tunnelPublicUrl);
  const tunnelLoading = useEndpointStore((s) => s.tunnelLoading);
  const tunnelProgress = useEndpointStore((s) => s.tunnelProgress);
  const tunnelStatus = useEndpointStore((s) => s.tunnelStatus);
  const tunnelEverReachable = useEndpointStore((s) => s.tunnelEverReachable);
  const showEnableTunnelModal = useEndpointStore((s) => s.showEnableTunnelModal);
  const showDisableTunnelModal = useEndpointStore((s) => s.showDisableTunnelModal);
  const showAddModal = useEndpointStore((s) => s.showAddModal);
  const newKeyName = useEndpointStore((s) => s.newKeyName);
  const newKeyDescription = useEndpointStore((s) => s.newKeyDescription);
  const newKeyScopeOn = useEndpointStore((s) => s.newKeyScopeOn);
  const newKeyScope = useEndpointStore((s) => s.newKeyScope);
  const createdKey = useEndpointStore((s) => s.createdKey);
  const createdKeyAck = useEndpointStore((s) => s.createdKeyAck);
  const editingKey = useEndpointStore((s) => s.editingKey);
  const scopePickerFor = useEndpointStore((s) => s.scopePickerFor);
  const createLimits = useEndpointStore((s) => s.createLimits);
  const createError = useEndpointStore((s) => s.createError);
  const activeProviders = useEndpointStore((s) => s.activeProviders);
  const modelAliases = useEndpointStore((s) => s.modelAliases);
  const confirmState = useEndpointStore((s) => s.confirmState);
  const newKeyCategory = useEndpointStore((s) => s.newKeyCategory);
  const activeCategoryFilter = useEndpointStore((s) => s.activeCategoryFilter);
  const usagePeriod = useEndpointStore((s) => s.usagePeriod);
  const baseUrl = useEndpointStore((s) => s.baseUrl);
  // The Tailscale/Funnel domain — store state now, same flat names the
  // components have always read.
  const tsEnabled = useEndpointStore((s) => s.tsEnabled);
  const tsReachable = useEndpointStore((s) => s.tsReachable);
  const tsUrl = useEndpointStore((s) => s.tsUrl);
  const tsLoading = useEndpointStore((s) => s.tsLoading);
  const tsProgress = useEndpointStore((s) => s.tsProgress);
  const tsStatus = useEndpointStore((s) => s.tsStatus);
  const tsAuthUrl = useEndpointStore((s) => s.tsAuthUrl);
  const tsAuthLabel = useEndpointStore((s) => s.tsAuthLabel);
  const tsInstalled = useEndpointStore((s) => s.tsInstalled);
  const tsInstalling = useEndpointStore((s) => s.tsInstalling);
  const tsInstallLog = useEndpointStore((s) => s.tsInstallLog);
  const tsSudoPassword = useEndpointStore((s) => s.tsSudoPassword);
  const tsConnecting = useEndpointStore((s) => s.tsConnecting);
  const showTsModal = useEndpointStore((s) => s.showTsModal);
  const showDisableTsModal = useEndpointStore((s) => s.showDisableTsModal);
  const tsEverReachable = useEndpointStore((s) => s.tsEverReachable);

  // The install log's auto-scrolling DOM node — the ONE React-only piece the
  // store could not hold. The ref is attached by the modal's log element; the
  // scroll itself happens here, as it did in the hook.
  const tsLogRef = useRef(null);
  useEffect(() => {
    if (tsLogRef.current) tsLogRef.current.scrollTop = tsLogRef.current.scrollHeight;
  }, [tsInstallLog]);

  // Client-side local/remote detection (UI hint only, not a security gate).
  const isRemoteHost =
    typeof window !== "undefined"
    && !["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);

  const { copied, copy } = useCopyToClipboard();

  // ── actions, read at call time ──────────────────────────────────────────────
  // Selecting an action by identity would subscribe this hook to it; reading
  // through `getState()` at call time keeps the subscription to data only.
  const act = useCallback((name, ...args) => useEndpointStore.getState()[name](...args), []);

  // ── the bootstrap ────────────────────────────────────────────────────────────
  // The store's `load()` is idempotent, so five shores each mounting this effect
  // still cost one network cycle. `setState` lives inside the store's async
  // continuation, never in this effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    act("load");
    act("initBaseUrl");
  }, [act]);

  // Per-key usage rollup — refetched when the window changes or the key set
  // does (create/delete). Keys absent from byKey had no traffic in the window.
  useEffect(() => {
    act("loadKeyUsage");
  }, [act, usagePeriod, keys]);

  // ── the two poll machines (the controller's `useEffect`s, verbatim) ────────────

  // Status poll: only while degraded (not yet reachable). Stop once healthy to
  // avoid spam. Visibility re-check: refresh once when tab becomes visible.
  useEffect(() => {
    const anyEnabled = tunnelEnabled || tsEnabled;
    if (!anyEnabled) return;
    const tunnelHealthy = !tunnelEnabled || tunnelReachable;
    const tsHealthy = !tsEnabled || tsReachable;
    const allHealthy = tunnelHealthy && tsHealthy;
    const onVisible = () => { if (!document.hidden) act("syncTunnelStatus"); };
    document.addEventListener("visibilitychange", onVisible);
    if (allHealthy) return () => document.removeEventListener("visibilitychange", onVisible);
    const timer = setInterval(() => { if (!document.hidden) act("syncTunnelStatus"); }, STATUS_POLL_FAST_MS);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tunnelEnabled, tunnelReachable, tsEnabled, tsReachable, act]);

  // Browser-side periodic ping: probes tunnel/tailscale URLs directly so UI
  // stays "reachable" even when backend DNS (1.1.1.1) hiccups on *.ts.net or
  // *.trycloudflare.com. Adaptive: slow when healthy, fast when degraded; pause
  // when tab hidden.
  useEffect(() => {
    const probeBoth = async () => {
      if (document.hidden) return;
      if (tunnelEnabled && (tunnelUrl || tunnelPublicUrl)) {
        const ok = await clientPingAny(tunnelPublicUrl, tunnelUrl);
        useEndpointStore.setState({ tunnelClientReachable: ok });
        if (ok) {
          useEndpointStore.setState({ tunnelMiss: 0, tunnelReachable: true });
          if (!useEndpointStore.getState().tunnelEverReachable) useEndpointStore.setState({ tunnelEverReachable: true });
        } else {
          const miss = useEndpointStore.getState().tunnelMiss + 1;
          useEndpointStore.setState({ tunnelMiss: miss });
          if (miss >= REACHABLE_MISS_THRESHOLD) useEndpointStore.setState({ tunnelReachable: false });
        }
      } else {
        useEndpointStore.setState({ tunnelClientReachable: false });
      }
      await act("probeTsClient");
    };
    const anyEnabled = (tunnelEnabled && (tunnelUrl || tunnelPublicUrl)) || (tsEnabled && tsUrl);
    if (!anyEnabled) return;
    probeBoth();
    const tunnelHealthy = !tunnelEnabled || tunnelReachable;
    const tsHealthy = !tsEnabled || tsReachable;
    if (tunnelHealthy && tsHealthy) return;
    const id = setInterval(probeBoth, CLIENT_PING_FAST_MS);
    return () => clearInterval(id);
  }, [tunnelEnabled, tunnelUrl, tunnelPublicUrl, tunnelReachable, tsEnabled, tsUrl, tsReachable, act]);

  // ── derived — memoized per input identity, in ONE place ─────────────────────
  const missingControls = useMemo(
    () => computeMissingControls({ requireApiKey, requireLogin, hasPassword }),
    [requireApiKey, requireLogin, hasPassword]
  );
  const exposed = useMemo(
    () => computeExposed({ tunnelEnabled, tsEnabled }),
    [tunnelEnabled, tsEnabled]
  );
  const categories = useMemo(() => computeCategories(keys), [keys]);

  // Security gate: block remote exposure while dashboard uses default password
  // or login is off.
  const isLoginUnsafe = !requireLogin || !hasPassword;
  const unsafeReason = !requireLogin
    ? "Enable \"Require login\" and set a custom password before activating the tunnel."
    : "Change the default dashboard password before activating the tunnel.";

  return {
    // ── the store's own fields, same names the components read ──────────────
    keys,
    loading,
    error,
    keyUsage,
    baseUrl,
    requireApiKey,
    requireLogin,
    hasPassword,
    tunnelDashboardAccess,
    tunnelChecking,
    tunnelEnabled,
    tunnelReachable,
    tunnelUrl,
    tunnelPublicUrl,
    tunnelLoading,
    tunnelProgress,
    tunnelStatus,
    tunnelEverReachable,
    showEnableTunnelModal,
    showDisableTunnelModal,
    showAddModal,
    newKeyName,
    newKeyDescription,
    newKeyScopeOn,
    newKeyScope,
    createdKey,
    createdKeyAck,
    editingKey,
    scopePickerFor,
    createLimits,
    createError,
    activeProviders,
    modelAliases,
    confirmState,
    newKeyCategory,
    activeCategoryFilter,
    usagePeriod,
    // ── the Tailscale domain, same flat names ───────────────────────────────
    tsEnabled,
    tsReachable,
    tsUrl,
    tsLoading,
    tsProgress,
    tsStatus,
    tsAuthUrl,
    tsAuthLabel,
    tsInstalled,
    tsInstalling,
    tsInstallLog,
    tsSudoPassword,
    tsConnecting,
    showTsModal,
    showDisableTsModal,
    tsEverReachable,
    tsLogRef,
    // ── the React-only readings ──────────────────────────────────────────────
    isRemoteHost,
    copied,
    copy,
    isLoginUnsafe,
    unsafeReason,
    // ── derived ──────────────────────────────────────────────────────────────
    missingControls,
    exposed,
    categories,
    // ── the bootstrap and the refresh ────────────────────────────────────────
    load: useCallback(() => act("load"), [act]),
    reload: useCallback(() => act("reload"), [act]),
    fetchData: useCallback(() => act("fetchData"), [act]),
    loadSettings: useCallback(() => act("loadSettings"), [act]),
    syncTunnelStatus: useCallback(() => act("syncTunnelStatus"), [act]),
    // ── the named mutations, same names as the controller's return ────────────
    handleTunnelDashboardAccess: useCallback((v) => act("handleTunnelDashboardAccess", v), [act]),
    handleRequireApiKey: useCallback((v) => act("handleRequireApiKey", v), [act]),
    resetCreateForm: useCallback(() => act("resetCreateForm"), [act]),
    openCreateModal: useCallback(() => act("openCreateModal"), [act]),
    closeCreatedKeyModal: useCallback(() => act("closeCreatedKeyModal"), [act]),
    handleScopeSelect: useCallback((m) => act("handleScopeSelect", m), [act]),
    handleScopeDeselect: useCallback((m) => act("handleScopeDeselect", m), [act]),
    openEditKey: useCallback((k) => act("openEditKey", k), [act]),
    handleSaveKey: useCallback(() => act("handleSaveKey"), [act]),
    handleCreateKey: useCallback(() => act("handleCreateKey"), [act]),
    handleDeleteKey: useCallback((id) => act("handleDeleteKey", id), [act]),
    handleToggleKey: useCallback((id, isActive, opts) => act("handleToggleKey", id, isActive, opts), [act]),
    handleEnableTunnel: useCallback(() => act("handleEnableTunnel"), [act]),
    handleDisableTunnel: useCallback(() => act("handleDisableTunnel"), [act]),
    // ── the Tailscale mutations, same names ───────────────────────────────────
    requestUserAuth: useCallback((url, label) => act("requestUserAuth", url, label), [act]),
    clearUserAuth: useCallback(() => act("clearUserAuth"), [act]),
    checkTailscaleInstalled: useCallback(() => act("checkTailscaleInstalled"), [act]),
    handleInstallTailscale: useCallback(() => act("handleInstallTailscale"), [act]),
    handleConnectTailscale: useCallback(() => act("handleConnectTailscale"), [act]),
    handleDisableTailscale: useCallback(() => act("handleDisableTailscale"), [act]),
    handleOpenTsModal: useCallback(() => act("handleOpenTsModal"), [act]),
    applyTailscaleStatus: useCallback((t) => act("applyTailscaleStatus", t), [act]),
    probeClient: useCallback(() => act("probeTsClient"), [act]),
    updateReachable: useCallback(() => act("applyTunnelReachable"), [act]),
    // ── the setters, called directly by EndpointCard and the modals ───────────
    setKeys: useCallback((v) => useEndpointStore.setState({ keys: typeof v === "function" ? v(useEndpointStore.getState().keys) : v }), []),
    setLoading: useCallback((v) => useEndpointStore.setState({ loading: v }), []),
    setShowAddModal: useCallback((v) => useEndpointStore.setState({ showAddModal: v }), []),
    setNewKeyName: useCallback((v) => useEndpointStore.setState({ newKeyName: v }), []),
    setNewKeyDescription: useCallback((v) => useEndpointStore.setState({ newKeyDescription: v }), []),
    setNewKeyScopeOn: useCallback((v) => useEndpointStore.setState({ newKeyScopeOn: v }), []),
    setNewKeyScope: useCallback((v) => useEndpointStore.setState({ newKeyScope: v }), []),
    setCreatedKey: useCallback((v) => useEndpointStore.setState({ createdKey: v }), []),
    setCreatedKeyAck: useCallback((v) => useEndpointStore.setState({ createdKeyAck: v }), []),
    setEditingKey: useCallback((v) => useEndpointStore.setState({ editingKey: v }), []),
    setScopePickerFor: useCallback((v) => useEndpointStore.setState({ scopePickerFor: v }), []),
    setCreateLimits: useCallback((v) => useEndpointStore.setState({ createLimits: v }), []),
    setCreateError: useCallback((v) => useEndpointStore.setState({ createError: v }), []),
    setActiveProviders: useCallback((v) => useEndpointStore.setState({ activeProviders: v }), []),
    setModelAliases: useCallback((v) => useEndpointStore.setState({ modelAliases: v }), []),
    setConfirmState: useCallback((v) => useEndpointStore.setState({ confirmState: v }), []),
    setNewKeyCategory: useCallback((v) => useEndpointStore.setState({ newKeyCategory: v }), []),
    setActiveCategoryFilter: useCallback((v) => useEndpointStore.setState({ activeCategoryFilter: v }), []),
    setUsagePeriod: useCallback((v) => useEndpointStore.setState({ usagePeriod: v }), []),
    setKeyUsage: useCallback((v) => useEndpointStore.setState({ keyUsage: v }), []),
    setRequireApiKey: useCallback((v) => useEndpointStore.setState({ requireApiKey: v }), []),
    setRequireLogin: useCallback((v) => useEndpointStore.setState({ requireLogin: v }), []),
    setHasPassword: useCallback((v) => useEndpointStore.setState({ hasPassword: v }), []),
    setTunnelDashboardAccess: useCallback((v) => useEndpointStore.setState({ tunnelDashboardAccess: v }), []),
    setTunnelChecking: useCallback((v) => useEndpointStore.setState({ tunnelChecking: v }), []),
    setTunnelEnabled: useCallback((v) => useEndpointStore.setState({ tunnelEnabled: v }), []),
    setTunnelReachable: useCallback((v) => useEndpointStore.setState({ tunnelReachable: v }), []),
    setTunnelUrl: useCallback((v) => useEndpointStore.setState({ tunnelUrl: v }), []),
    setTunnelPublicUrl: useCallback((v) => useEndpointStore.setState({ tunnelPublicUrl: v }), []),
    setTunnelLoading: useCallback((v) => useEndpointStore.setState({ tunnelLoading: v }), []),
    setTunnelProgress: useCallback((v) => useEndpointStore.setState({ tunnelProgress: v }), []),
    setTunnelStatus: useCallback((v) => useEndpointStore.setState({ tunnelStatus: v }), []),
    setShowEnableTunnelModal: useCallback((v) => useEndpointStore.setState({ showEnableTunnelModal: v }), []),
    setShowDisableTunnelModal: useCallback((v) => useEndpointStore.setState({ showDisableTunnelModal: v }), []),
    setTunnelEverReachable: useCallback((v) => useEndpointStore.setState({ tunnelEverReachable: v }), []),
    // ── the Tailscale setters, same names ─────────────────────────────────────
    setTsEnabled: useCallback((v) => useEndpointStore.setState({ tsEnabled: v }), []),
    setTsReachable: useCallback((v) => useEndpointStore.setState({ tsReachable: v }), []),
    setTsUrl: useCallback((v) => useEndpointStore.setState({ tsUrl: v }), []),
    setTsLoading: useCallback((v) => useEndpointStore.setState({ tsLoading: v }), []),
    setTsProgress: useCallback((v) => useEndpointStore.setState({ tsProgress: v }), []),
    setTsStatus: useCallback((v) => useEndpointStore.setState({ tsStatus: v }), []),
    setTsAuthUrl: useCallback((v) => useEndpointStore.setState({ tsAuthUrl: v }), []),
    setTsAuthLabel: useCallback((v) => useEndpointStore.setState({ tsAuthLabel: v }), []),
    setTsInstalled: useCallback((v) => useEndpointStore.setState({ tsInstalled: v }), []),
    setTsInstalling: useCallback((v) => useEndpointStore.setState({ tsInstalling: v }), []),
    setTsInstallLog: useCallback((v) => useEndpointStore.setState({ tsInstallLog: v }), []),
    setTsSudoPassword: useCallback((v) => useEndpointStore.setState({ tsSudoPassword: v }), []),
    setTsConnecting: useCallback((v) => useEndpointStore.setState({ tsConnecting: v }), []),
    setShowTsModal: useCallback((v) => useEndpointStore.setState({ showTsModal: v }), []),
    setShowDisableTsModal: useCallback((v) => useEndpointStore.setState({ showDisableTsModal: v }), []),
    setTsEverReachable: useCallback((v) => useEndpointStore.setState({ tsEverReachable: v }), []),
    setIsRemoteHost: useCallback(() => { /* a reading, not a setting — kept for the controller's shape */ }, []),
  };
}

export default useEndpointFacade;
