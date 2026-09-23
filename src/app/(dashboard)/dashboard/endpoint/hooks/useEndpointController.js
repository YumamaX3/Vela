"use client";
// useEndpointController — every atom of the Endpoint room's behavior, lifted
// verbatim from the 2,063-line page client. The page had one job: hold state and
// render it. Splitting the two lets each tab READ this controller instead of
// co-owning it, and keeps the polling machine (tunnel + Tailscale reachability,
// fast/slow cadence, miss thresholds) in exactly one place.
//
// R-31: extracted for a reason, not for tidiness — the tab split is only honest
// if behavior is provably untouched. Not one expression below was rewritten;
// only its address changed.
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { storeKey, getKey, hasKey, removeKey, resolveKeyRef } from "@/shared/utils/keyVault";
import {
  TUNNEL_PING_INTERVAL_MS,
  TUNNEL_PING_MAX_MS,
  STATUS_POLL_FAST_MS,
  REACHABLE_MISS_THRESHOLD,
  CLIENT_PING_FAST_MS,
} from "../lib/constants";
import { clientPingAny } from "../lib/ping";
import { fetchAllKeys, createKey, updateKey, deleteKey, setKeyActive } from "../lib/keyApi";
import useTailscale from "./useTailscale";
import { DEFAULT_LIMITS, limitsFromRecord, categoryOf } from "../lib/keyLimits";

// Dedup guard for auto-provisioning the first "Default Key". Module scope so it
// survives re-mounts within a session. fetchData() can run concurrently (StrictMode
// double-invoke, fast re-mount); without this, two runs both see zero keys and both
// POST → duplicate keys. Single-threaded JS makes the check-then-set below atomic:
// the flag is set synchronously before the first await, so the second caller sees it.
// It stays HERE, beside its only reader, rather than in lib/ — it is a mutable
// module binding, and `import` bindings are read-only, so an extracted copy
// could not be assigned. One reader, one writer, one file.
let provisioningDefaultKey = false;

export default function useEndpointController() {
  // The Tailscale/Funnel domain, lifted whole into its own hook and composed
  // back here. The result is spread into this hook's return below, so every
  // view still reads the same flat names it always did (`tsEnabled`,
  // `handleConnectTailscale`, …) — composition, not fragmentation.
  const tailscale = useTailscale();
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyDescription, setNewKeyDescription] = useState("");
  const [newKeyScopeOn, setNewKeyScopeOn] = useState(false);
  const [newKeyScope, setNewKeyScope] = useState([]);
  const [createdKey, setCreatedKey] = useState(null); // { key, keyId, keyPrefix, record } — the one-time show
  const [createdKeyAck, setCreatedKeyAck] = useState(false);
  const [editingKey, setEditingKey] = useState(null); // draft state for the edit modal
  const [scopePickerFor, setScopePickerFor] = useState(null); // "create" | "edit" — which form's scope the grouped picker is editing
  const [createLimits, setCreateLimits] = useState(DEFAULT_LIMITS); // W3 limits for the create form
  const [createError, setCreateError] = useState("");
  const [activeProviders, setActiveProviders] = useState([]);
  const [modelAliases, setModelAliases] = useState({});
  const [confirmState, setConfirmState] = useState(null);

  // Key categories — filter chip + free-form combobox state
  const [newKeyCategory, setNewKeyCategory] = useState("");
  const [activeCategoryFilter, setActiveCategoryFilter] = useState("all");

  // Per-key usage stats — requests/tokens/spend under each key row
  const [usagePeriod, setUsagePeriod] = useState("all");
  const [keyUsage, setKeyUsage] = useState({});

  const [requireApiKey, setRequireApiKey] = useState(false);
  const [requireLogin, setRequireLogin] = useState(true);
  const [hasPassword, setHasPassword] = useState(true);
 const [tunnelDashboardAccess, setTunnelDashboardAccess] = useState(false);

 // Cloudflare Tunnel state
  const [tunnelChecking, setTunnelChecking] = useState(true);
  const [tunnelEnabled, setTunnelEnabled] = useState(false);
  const [tunnelReachable, setTunnelReachable] = useState(false);
  const [tunnelUrl, setTunnelUrl] = useState("");
  const [tunnelPublicUrl, setTunnelPublicUrl] = useState("");
  const [tunnelLoading, setTunnelLoading] = useState(false);
  const [tunnelProgress, setTunnelProgress] = useState("");
  const [tunnelStatus, setTunnelStatus] = useState(null);
  const [showEnableTunnelModal, setShowEnableTunnelModal] = useState(false);
  const [showDisableTunnelModal, setShowDisableTunnelModal] = useState(false);


  // Debounce reachable=false: server may briefly return false during background refresh.
  // Only flip UI to "reconnecting" after N consecutive misses to avoid spinner flicker.
  const tunnelMissRef = useRef(0);
  // Browser-side reachable cache (independent of backend DNS quirks)
  const tunnelClientReachableRef = useRef(false);
  // Track whether reachable=true was ever observed in this session.
  // Distinguishes "Checking..." (initial cold cache) from "Reconnecting..." (lost connection).
  const tunnelEverReachableRef = useRef(false);
  const [tunnelEverReachable, setTunnelEverReachable] = useState(false);


  // Client-side local/remote detection (UI hint only, not a security gate)
  const [isRemoteHost, setIsRemoteHost] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined")
      setIsRemoteHost(!["localhost", "127.0.0.1", "::1"].includes(window.location.hostname));
  }, []);

  const { copied, copy } = useCopyToClipboard();

  // Security gate: block remote exposure while dashboard uses default password or login is off.
  const isLoginUnsafe = !requireLogin || !hasPassword;
  const unsafeReason = !requireLogin
    ? "Enable \"Require login\" and set a custom password before activating the tunnel."
    : "Change the default dashboard password before activating the tunnel.";


  useEffect(() => {
    fetchData();
    loadSettings();
  }, []);

  // Status poll: only while degraded (not yet reachable). Stop once healthy to avoid spam.
  // Visibility re-check: refresh once when tab becomes visible.
  useEffect(() => {
    const anyEnabled = tunnelEnabled || tailscale.tsEnabled;
    if (!anyEnabled) return;
    const tunnelHealthy = !tunnelEnabled || tunnelReachable;
    const tsHealthy = !tailscale.tsEnabled || tailscale.tsReachable;
    const allHealthy = tunnelHealthy && tsHealthy;
    const onVisible = () => { if (!document.hidden) syncTunnelStatus(); };
    document.addEventListener("visibilitychange", onVisible);
    if (allHealthy) return () => document.removeEventListener("visibilitychange", onVisible);
    const timer = setInterval(() => { if (!document.hidden) syncTunnelStatus(); }, STATUS_POLL_FAST_MS);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tunnelEnabled, tailscale.tsEnabled, tunnelReachable, tailscale.tsReachable]);

  // Browser-side periodic ping: probes tunnel/tailscale URLs directly so UI stays
  // "reachable" even when backend DNS (1.1.1.1) hiccups on *.ts.net or *.trycloudflare.com.
  // Adaptive: slow when healthy, fast when degraded; pause when tab hidden.
  useEffect(() => {
    const probeBoth = async () => {
      if (document.hidden) return;
      if (tunnelEnabled && (tunnelUrl || tunnelPublicUrl)) {
        const ok = await clientPingAny(tunnelPublicUrl, tunnelUrl);
        tunnelClientReachableRef.current = ok;
        if (ok) { tunnelMissRef.current = 0; setTunnelReachable(true); if (!tunnelEverReachableRef.current) { tunnelEverReachableRef.current = true; setTunnelEverReachable(true); } }
        else { tunnelMissRef.current += 1; if (tunnelMissRef.current >= REACHABLE_MISS_THRESHOLD) setTunnelReachable(false); }
      } else {
        tunnelClientReachableRef.current = false;
      }
      await tailscale.probeClient();
    };
    const anyEnabled = (tunnelEnabled && (tunnelUrl || tunnelPublicUrl)) || (tailscale.tsEnabled && tailscale.tsUrl);
    if (!anyEnabled) return;
    probeBoth();
    const tunnelHealthy = !tunnelEnabled || tunnelReachable;
    const tsHealthy = !tailscale.tsEnabled || tailscale.tsReachable;
    if (tunnelHealthy && tsHealthy) return;
    const id = setInterval(probeBoth, CLIENT_PING_FAST_MS);
    return () => clearInterval(id);
  }, [tunnelEnabled, tunnelUrl, tunnelPublicUrl, tailscale.tsEnabled, tailscale.tsUrl, tunnelReachable, tailscale.tsReachable]);

  // Client-side reachable only (server no longer probes; watchdog handles backend health).
  // Miss-debounce: only flip to false after N consecutive misses.
  const updateReachable = useCallback((_unused, clientRef, missRef, setter, everRef, everSetter) => {
    const reachable = clientRef.current;
    if (reachable) {
      missRef.current = 0;
      setter(true);
      if (!everRef.current) {
        everRef.current = true;
        everSetter(true);
      }
    } else {
      missRef.current += 1;
      if (missRef.current >= REACHABLE_MISS_THRESHOLD) setter(false);
    }
  }, []);

  // Trust user intent (settingsEnabled): UI stays "enabled" while watchdog restarts process
  const syncTunnelStatus = async () => {
    try {
      const statusRes = await fetch("/api/tunnel/status", { cache: "no-store" });
      if (!statusRes.ok) return;
      const data = await statusRes.json();
      const tEnabled = data.tunnel?.settingsEnabled ?? data.tunnel?.enabled ?? false;
      const tUrl = data.tunnel?.tunnelUrl || "";
      setTunnelUrl(tUrl);
      setTunnelPublicUrl(data.tunnel?.publicUrl || "");
      setTunnelEnabled(tEnabled);
      updateReachable(null, tunnelClientReachableRef, tunnelMissRef, setTunnelReachable, tunnelEverReachableRef, setTunnelEverReachable);

      tailscale.applyTailscaleStatus(data.tailscale);
    } catch { /* ignore poll errors */ }
  };

  const loadSettings = async () => {
    setTunnelChecking(true);
    try {
      const [settingsRes, statusRes] = await Promise.all([
        fetch("/api/settings"),
        fetch("/api/tunnel/status", { cache: "no-store" })
      ]);
      if (settingsRes.ok) {
        const data = await settingsRes.json();
        setRequireApiKey(data.requireApiKey || false);
        setRequireLogin(data.requireLogin !== false);
        setHasPassword(data.hasPassword || false);
        setTunnelDashboardAccess(data.tunnelDashboardAccess || false);
      }
      if (statusRes.ok) {
        const data = await statusRes.json();
        const tEnabled = data.tunnel?.settingsEnabled ?? data.tunnel?.enabled ?? false;
        const tUrl = data.tunnel?.tunnelUrl || "";
        setTunnelUrl(tUrl);
        setTunnelPublicUrl(data.tunnel?.publicUrl || "");
        setTunnelEnabled(tEnabled);
        updateReachable(null, tunnelClientReachableRef, tunnelMissRef, setTunnelReachable, tunnelEverReachableRef, setTunnelEverReachable);

        tailscale.applyTailscaleStatus(data.tailscale);
      }
    } catch (error) {
      console.log("Error loading settings:", error);
    } finally {
      setTunnelChecking(false);
    }
  };

  const handleTunnelDashboardAccess = async (value) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tunnelDashboardAccess: value }),
      });
      if (res.ok) setTunnelDashboardAccess(value);
    } catch (error) {
      console.log("Error updating tunnelDashboardAccess:", error);
    }
  };

  const handleRequireApiKey = async (value) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requireApiKey: value }),
      });
      if (res.ok) setRequireApiKey(value);
    } catch (error) {
      console.log("Error updating requireApiKey:", error);
    }
  };

  const fetchData = async () => {
    try {
      // Read the WHOLE fleet through the seam, not the route's first page. A
      // bare `fetch("/api/keys")` returns `limit=100` and silently drops every
      // key past the hundredth — the truncation this page's own keyApi.fetchKeys
      // was written to prevent, ignored here. fetchAllKeys pages to the server's
      // reported total, so the room shows every key it claims to show.
      const fetchKeys = async () => {
        try {
          const { keys: rows } = await fetchAllKeys();
          return rows;
        } catch {
          return [];
        }
      };

      let existing = await fetchKeys();
      // Auto-provision a default key for first-time users so the endpoint works out of the box.
      // The 201 carries the one-time full key — capture it in the browser vault immediately,
      // and open the show-once ceremony so the user can save it too.
      // Race guard: the flag is set synchronously before the first await, so of two
      // concurrent callers (StrictMode double-invoke / fast remount) only the first
      // reaches the POST — the other sees the flag and waits for the server state.
      if (existing.length === 0 && !provisioningDefaultKey) {
        provisioningDefaultKey = true;
        try {
          const createRes = await fetch("/api/keys", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "Default Key" }),
          });
          if (createRes.status === 201) {
            const data = await createRes.json();
            if (data.key && data.keyId) {
              storeKey(data.keyId, data.key);
              setCreatedKey(data);
              setCreatedKeyAck(false);
            }
            existing = await fetchKeys();
          }
        } catch { /* fall through to empty render */ } finally {
          // Reset so a future load with zero keys can provision again (e.g. the
          // user deleted every key). Safe: once the POST lands, fetchKeys sees
          // ≥1 key and this branch is never entered again.
          provisioningDefaultKey = false;
        }
      }
      setKeys(existing);
    } catch (error) {
      console.log("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  // Connected providers + aliases for the grouped model-scope picker — the same
  // catalog the combo page feeds ModelSelectModal. Stored values are model.value
  // ("alias/model"), the canonical form the gate matches at request time.
  useEffect(() => {
    fetch("/api/providers")
      .then((res) => (res.ok ? res.json() : {}))
      .then((data) => setActiveProviders(data.connections || []))
      .catch(() => setActiveProviders([]));
    fetch("/api/models/alias")
      .then((res) => (res.ok ? res.json() : {}))
      .then((data) => setModelAliases(data.aliases || {}))
      .catch(() => setModelAliases({}));
  }, []);

  // Per-key usage rollup — refetched when the window changes or the key set
  // does (create/delete). Keys absent from byKey had no traffic in the window.
  useEffect(() => {
    fetch(`/api/keys/usage?period=${usagePeriod}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setKeyUsage(data?.byKey || {}))
      .catch(() => setKeyUsage({}));
  }, [usagePeriod, keys]);

  const resetCreateForm = () => {
    setNewKeyName("");
    setNewKeyDescription("");
    setNewKeyCategory("");
    setNewKeyScopeOn(false);
    setNewKeyScope([]);
    setCreateLimits(DEFAULT_LIMITS);
    setCreateError("");
  };

  // Distinct categories across all keys (case-sensitive, stable order by first
  // appearance) — feeds both the filter chips and the create-form datalist.
  const categories = useMemo(() => {
    const seen = new Set();
    for (const k of keys) if (k.category) seen.add(k.category);
    return [...seen];
  }, [keys]);


  const openCreateModal = () => {
    resetCreateForm();
    setShowAddModal(true);
  };

  const closeCreatedKeyModal = () => {
    setCreatedKey(null);
    setCreatedKeyAck(false);
  };

  // Grouped scope picker: add/remove a model value on whichever form opened it.
  // model.value is "alias/model" — the exact form the gate matches at request time.
  const scopeValue = (model) => model?.value || model?.name || model;
  const handleScopeSelect = (model) => {
    const value = scopeValue(model);
    if (!value) return;
    if (scopePickerFor === "create") {
      setNewKeyScope((prev) => (prev.includes(value) ? prev : [...prev, value]));
    } else {
      setEditingKey((prev) => (prev && !prev.allowedModels.includes(value)
        ? { ...prev, allowedModels: [...prev.allowedModels, value] }
        : prev));
    }
  };
  const handleScopeDeselect = (model) => {
    const value = scopeValue(model);
    if (scopePickerFor === "create") {
      setNewKeyScope((prev) => prev.filter((x) => x !== value));
    } else {
      setEditingKey((prev) => (prev ? { ...prev, allowedModels: prev.allowedModels.filter((x) => x !== value) } : prev));
    }
  };

  const openEditKey = (key) => {
    setEditingKey({
      id: key.id,
      name: key.name || "",
      description: key.description || "",
      category: key.category || "",
      allowedModels: Array.isArray(key.allowedModels) ? key.allowedModels : [],
      scopeOn: Array.isArray(key.allowedModels) && key.allowedModels.length > 0,
      limits: limitsFromRecord(key), // W3 draft — server record is source of truth
      saving: false,
      error: "",
    });
  };

  const handleSaveKey = async () => {
    if (!editingKey) return;
    if (!editingKey.name.trim()) return;
    setEditingKey((prev) => ({ ...prev, saving: true, error: "" }));
    try {
      const L = editingKey.limits;
      await updateKey(editingKey.id, {
        name: editingKey.name.trim(),
        description: editingKey.description,
        category: editingKey.category?.trim() || null,
        allowedModels: editingKey.scopeOn ? editingKey.allowedModels : null,
        // W3 limits — always sent in full so the record matches the form.
        rateLimitRpm: L.rateLimitRpm,
        tokenBudgetDaily: L.tokenBudget,
        spendCapDailyCents: L.spendCapCents,
        budgetScope: (L.tokenBudget != null || L.spendCapCents != null) ? (L.budgetScope || "daily") : null,
        expiresAt: L.expiresAt,
        ipAllowlist: L.ipAllowlist?.length ? L.ipAllowlist : null,
      });
      setEditingKey(null);
      await fetchData();
    } catch (error) {
      setEditingKey((prev) => ({ ...prev, saving: false, error: error.message }));
    }
  };

  // u2500u2500u2500 Cloudflare Tunnel handlers
  // Ping tunnel health until reachable. Race multiple URLs (shortlink + direct) — 1 OK is enough.
  const pingTunnelHealth = async (...urls) => {
    setTunnelLoading(true);
    setTunnelProgress("Waiting for tunnel ready...");
    const targets = urls.filter(Boolean).map((u) => `${u}/api/health`);
    const start = Date.now();
    while (Date.now() - start < TUNNEL_PING_MAX_MS) {
      await new Promise((r) => setTimeout(r, TUNNEL_PING_INTERVAL_MS));
      const ok = await Promise.any(targets.map(async (h) => {
        const p = await fetch(h, { mode: "cors", cache: "no-store" });
        if (p.ok) return true;
        throw new Error("not ready");
      })).catch(() => false);
      if (ok) {
        setTunnelEnabled(true);
        setTunnelLoading(false);
        setTunnelProgress("");
        return true;
      }
      // Every 5 pings (~10s), check if backend process still alive
      if ((Date.now() - start) % 10000 < TUNNEL_PING_INTERVAL_MS) {
        try {
          const statusRes = await fetch("/api/tunnel/status");
          if (statusRes.ok) {
            const status = await statusRes.json();
            if (!status.tunnel?.enabled) {
              setTunnelStatus({ type: "error", message: "Tunnel process stopped unexpectedly." });
              setTunnelLoading(false);
              setTunnelProgress("");
              return false;
            }
          }
        } catch { /* ignore */ }
      }
    }
    setTunnelStatus({ type: "error", message: "Tunnel created but not reachable. Please try again." });
    setTunnelLoading(false);
    setTunnelProgress("");
    return false;
  };

  const handleEnableTunnel = async () => {
    setShowEnableTunnelModal(false);
    setTunnelLoading(true);
    setTunnelStatus(null);
    setTunnelProgress("Creating tunnel...");

    // Poll download progress while enable request is pending
    let polling = true;
    const pollProgress = async () => {
      while (polling) {
        try {
          const r = await fetch("/api/tunnel/status");
          if (r.ok) {
            const s = await r.json();
            if (s.download?.downloading) {
              setTunnelProgress(`Downloading cloudflared... ${s.download.progress}%`);
            } else if (polling) {
              setTunnelProgress("Creating tunnel...");
            }
          }
        } catch { /* ignore */ }
        await new Promise((r) => setTimeout(r, 1000));
      }
    };
    pollProgress();

    try {
      const res = await fetch("/api/tunnel/enable", { method: "POST" });
      polling = false;
      const data = await res.json();
      if (!res.ok) {
        setTunnelStatus({ type: "error", message: data.error || "Failed to enable tunnel" });
        return;
      }

      const url = data.tunnelUrl;
      if (!url) {
        setTunnelStatus({ type: "error", message: "No tunnel URL returned" });
        return;
      }

      setTunnelUrl(url);
      setTunnelPublicUrl(data.publicUrl || "");
      await pingTunnelHealth(data.publicUrl, url);
    } catch (error) {
      setTunnelStatus({ type: "error", message: error.message });
    } finally {
      polling = false;
      setTunnelLoading(false);
      setTunnelProgress("");
    }
  };

  const handleDisableTunnel = async () => {
    setTunnelLoading(true);
    setTunnelStatus(null);
    try {
      const res = await fetch("/api/tunnel/disable", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setTunnelEnabled(false);
        setTunnelUrl("");
        setShowDisableTunnelModal(false);
        setTunnelStatus({ type: "success", message: "Tunnel disabled" });
      } else {
        setTunnelStatus({ type: "error", message: data.error || "Failed to disable tunnel" });
      }
    } catch (error) {
      setTunnelStatus({ type: "error", message: error.message });
    } finally {
      setTunnelLoading(false);
    }
  };

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;
    setCreateError("");

    try {
      // One seam. keyApi.createKey captures the show-once plaintext into the
      // browser vault itself, so this handler keeps no second copy of the
      // ceremony — or of the request shape — beside the API's own.
      const data = await createKey({
        name: newKeyName,
        description: newKeyDescription || undefined,
        category: newKeyCategory.trim() || undefined,
        allowedModels: newKeyScopeOn ? newKeyScope : undefined,
        // W3 limits — null fields stay null (unlimited / unrestricted).
        rateLimitRpm: createLimits.rateLimitRpm,
        tokenBudgetDaily: createLimits.tokenBudget,
        spendCapDailyCents: createLimits.spendCapCents,
        budgetScope: (createLimits.tokenBudget != null || createLimits.spendCapCents != null)
          ? (createLimits.budgetScope || "daily")
          : undefined,
        expiresAt: createLimits.expiresAt,
        ipAllowlist: createLimits.ipAllowlist?.length ? createLimits.ipAllowlist : undefined,
      });
      setCreatedKey(data);
      setCreatedKeyAck(false);
      setShowAddModal(false);
      resetCreateForm();
      await fetchData();
    } catch (error) {
      setCreateError(error.message);
    }
  };

  const handleDeleteKey = async (id) => {
    setConfirmState({
      title: "Delete API Key",
      message: "Delete this API key?\n\nRequests using it will be rejected immediately. The audit row remains, but the key itself can never be recovered.",
      onConfirm: async () => {
        setConfirmState(null);
        try {
          await deleteKey(id);
          removeKey(id); // purge the captured copy alongside the server-side revoke
          setKeys(keys.filter((k) => k.id !== id));
        } catch (error) {
          console.log("Error deleting key:", error);
        }
      }
    });
  };

  // ── The pause gate, hoisted from a view ─────────────────────────────────
  // Softening (resume) is harmless and immediate; TIGHTENING (pause) is not,
  // so it earns a confirm. That confirm used to live inside KeysCard's
  // onChange — which meant the gate existed exactly once, in one view. Every
  // other view that pauses a key (the table lens, the detail drawer, the bulk
  // action bar) would have shipped the pause unconfirmed with nothing to
  // notice, because a missing confirm looks identical to a working button.
  // The gate now sits at the mutation itself, where the delete gate already
  // sat, so no future view can forget it. `skipConfirm` exists for the batch
  // flows that own exactly one confirm for N keys.
  const applyKeyActive = async (id, isActive) => {
    try {
      await setKeyActive(id, isActive);
      setKeys(prev => prev.map(k => k.id === id ? { ...k, isActive } : k));
    } catch (error) {
      console.log("Error toggling key:", error);
    }
  };

  const handleToggleKey = async (id, isActive, { skipConfirm = false } = {}) => {
    const key = keys.find((k) => k.id === id);
    // Only a transition INTO the disabled state is a tightening, and only a
    // key we can see to be currently active may be tightened — a stale row
    // cannot be paused twice. Resuming is never gated.
    const tightening = !isActive && key?.isActive !== false;
    if (tightening && !skipConfirm) {
      setConfirmState({
        title: "Pause API Key",
        message: `Pause API key "${key?.name || "this key"}"?\n\nIt stops working immediately — every request carrying it is refused — but it can be resumed later. The key string itself is unchanged.`,
        onConfirm: async () => {
          setConfirmState(null);
          await applyKeyActive(id, false);
        },
      });
      return;
    }
    await applyKeyActive(id, isActive);
  };

  // The absolute /v1 address every tab prints. Declared here rather than in the
  // shell because it is controller state — the Overview address strip, the
  // Quick-connect snippets, and the Diagnostics readouts all read it, and a
  // second copy in the shell would be a second source of truth.
  const [baseUrl, setBaseUrl] = useState("/v1");

  // Hydration fix: Only access window on client side
  useEffect(() => {
    if (typeof window !== "undefined") {
      setBaseUrl(`${window.location.origin}/v1`);
    }
  }, []);
  return {
    ...tailscale,
    baseUrl,
    keys,
    setKeys,
    loading,
    setLoading,
    showAddModal,
    setShowAddModal,
    newKeyName,
    setNewKeyName,
    newKeyDescription,
    setNewKeyDescription,
    newKeyScopeOn,
    setNewKeyScopeOn,
    newKeyScope,
    setNewKeyScope,
    createdKey,
    setCreatedKey,
    createdKeyAck,
    setCreatedKeyAck,
    editingKey,
    setEditingKey,
    scopePickerFor,
    setScopePickerFor,
    createLimits,
    setCreateLimits,
    createError,
    setCreateError,
    activeProviders,
    setActiveProviders,
    modelAliases,
    setModelAliases,
    confirmState,
    setConfirmState,
    newKeyCategory,
    setNewKeyCategory,
    activeCategoryFilter,
    setActiveCategoryFilter,
    usagePeriod,
    setUsagePeriod,
    keyUsage,
    setKeyUsage,
    requireApiKey,
    setRequireApiKey,
    requireLogin,
    setRequireLogin,
    hasPassword,
    setHasPassword,
    tunnelDashboardAccess,
    setTunnelDashboardAccess,
    tunnelChecking,
    setTunnelChecking,
    tunnelEnabled,
    setTunnelEnabled,
    tunnelReachable,
    setTunnelReachable,
    tunnelUrl,
    setTunnelUrl,
    tunnelPublicUrl,
    setTunnelPublicUrl,
    tunnelLoading,
    setTunnelLoading,
    tunnelProgress,
    setTunnelProgress,
    tunnelStatus,
    setTunnelStatus,
    showEnableTunnelModal,
    setShowEnableTunnelModal,
    showDisableTunnelModal,
    setShowDisableTunnelModal,
    tunnelEverReachable,
    setTunnelEverReachable,
    isRemoteHost,
    setIsRemoteHost,
    copied,
    copy,
    isLoginUnsafe,
    unsafeReason,
    categories,
    loadSettings,
    handleTunnelDashboardAccess,
    handleRequireApiKey,
    fetchData,
    resetCreateForm,
    openCreateModal,
    closeCreatedKeyModal,
    handleScopeSelect,
    handleScopeDeselect,
    openEditKey,
    handleSaveKey,
    handleEnableTunnel,
    handleDisableTunnel,
    handleCreateKey,
    handleDeleteKey,
    handleToggleKey,
    updateReachable,
  };
}
