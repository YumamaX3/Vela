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
import { clientPingUrl, clientPingAny } from "../lib/ping";
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

  // Tailscale state
  const [tsEnabled, setTsEnabled] = useState(false);
  const [tsReachable, setTsReachable] = useState(false);
  const [tsUrl, setTsUrl] = useState("");
  const [tsLoading, setTsLoading] = useState(false);
  const [tsProgress, setTsProgress] = useState("");
  const [tsStatus, setTsStatus] = useState(null);
  const [tsAuthUrl, setTsAuthUrl] = useState("");
  const [tsAuthLabel, setTsAuthLabel] = useState("");
  const [tsInstalled, setTsInstalled] = useState(null); // null=checking, true/false
  const [tsInstalling, setTsInstalling] = useState(false);
  const [tsInstallLog, setTsInstallLog] = useState([]);
  const [tsSudoPassword, setTsSudoPassword] = useState("");
  const [tsConnecting, setTsConnecting] = useState(false);
  const [showTsModal, setShowTsModal] = useState(false);
  const [showDisableTsModal, setShowDisableTsModal] = useState(false);
  const tsLogRef = useRef(null);

  // Debounce reachable=false: server may briefly return false during background refresh.
  // Only flip UI to "reconnecting" after N consecutive misses to avoid spinner flicker.
  const tunnelMissRef = useRef(0);
  const tsMissRef = useRef(0);
  // Browser-side reachable cache (independent of backend DNS quirks)
  const tunnelClientReachableRef = useRef(false);
  const tsClientReachableRef = useRef(false);
  // Track whether reachable=true was ever observed in this session.
  // Distinguishes "Checking..." (initial cold cache) from "Reconnecting..." (lost connection).
  const tunnelEverReachableRef = useRef(false);
  const tsEverReachableRef = useRef(false);
  const [tunnelEverReachable, setTunnelEverReachable] = useState(false);
  const [tsEverReachable, setTsEverReachable] = useState(false);


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

  // Auto-scroll install log
  useEffect(() => {
    if (tsLogRef.current) tsLogRef.current.scrollTop = tsLogRef.current.scrollHeight;
  }, [tsInstallLog]);

  useEffect(() => {
    fetchData();
    loadSettings();
  }, []);

  // Status poll: only while degraded (not yet reachable). Stop once healthy to avoid spam.
  // Visibility re-check: refresh once when tab becomes visible.
  useEffect(() => {
    const anyEnabled = tunnelEnabled || tsEnabled;
    if (!anyEnabled) return;
    const tunnelHealthy = !tunnelEnabled || tunnelReachable;
    const tsHealthy = !tsEnabled || tsReachable;
    const allHealthy = tunnelHealthy && tsHealthy;
    const onVisible = () => { if (!document.hidden) syncTunnelStatus(); };
    document.addEventListener("visibilitychange", onVisible);
    if (allHealthy) return () => document.removeEventListener("visibilitychange", onVisible);
    const timer = setInterval(() => { if (!document.hidden) syncTunnelStatus(); }, STATUS_POLL_FAST_MS);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tunnelEnabled, tsEnabled, tunnelReachable, tsReachable]);

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
      if (tsEnabled && tsUrl) {
        const ok = await clientPingUrl(tsUrl);
        tsClientReachableRef.current = ok;
        if (ok) { tsMissRef.current = 0; setTsReachable(true); if (!tsEverReachableRef.current) { tsEverReachableRef.current = true; setTsEverReachable(true); } }
        else { tsMissRef.current += 1; if (tsMissRef.current >= REACHABLE_MISS_THRESHOLD) setTsReachable(false); }
      } else {
        tsClientReachableRef.current = false;
      }
    };
    const anyEnabled = (tunnelEnabled && (tunnelUrl || tunnelPublicUrl)) || (tsEnabled && tsUrl);
    if (!anyEnabled) return;
    probeBoth();
    const tunnelHealthy = !tunnelEnabled || tunnelReachable;
    const tsHealthy = !tsEnabled || tsReachable;
    if (tunnelHealthy && tsHealthy) return;
    const id = setInterval(probeBoth, CLIENT_PING_FAST_MS);
    return () => clearInterval(id);
  }, [tunnelEnabled, tunnelUrl, tunnelPublicUrl, tsEnabled, tsUrl, tunnelReachable, tsReachable]);

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

      const tsEn = data.tailscale?.settingsEnabled ?? data.tailscale?.enabled ?? false;
      const tsUrlVal = data.tailscale?.tunnelUrl || "";
      setTsUrl(tsUrlVal);
      setTsEnabled(tsEn);
      updateReachable(null, tsClientReachableRef, tsMissRef, setTsReachable, tsEverReachableRef, setTsEverReachable);
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

        const tsEn = data.tailscale?.settingsEnabled ?? data.tailscale?.enabled ?? false;
        const tsUrlVal = data.tailscale?.tunnelUrl || "";
        setTsUrl(tsUrlVal);
        setTsEnabled(tsEn);
        updateReachable(null, tsClientReachableRef, tsMissRef, setTsReachable, tsEverReachableRef, setTsEverReachable);
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
      const fetchKeys = async () => {
        const res = await fetch("/api/keys");
        if (!res.ok) return [];
        const data = await res.json();
        return data.keys || [];
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

  // Keys under the active filter. Deleting the last key of a filtered category
  // would leave a chip with no rows — fall back to "all" so the list never
  // renders a confusing empty state for an existing chip.
  const filteredKeys = useMemo(() => {
    if (activeCategoryFilter === "all") return keys;
    const matched = keys.filter((k) => categoryOf(k) === activeCategoryFilter);
    return matched.length ? matched : keys;
  }, [keys, activeCategoryFilter]);

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
      const res = await fetch(`/api/keys/${editingKey.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setEditingKey(null);
        await fetchData();
      } else {
        setEditingKey((prev) => ({ ...prev, saving: false, error: data.error || "Failed to save key" }));
      }
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

  // u2500u2500u2500 Tailscale handlers
  const checkTailscaleInstalled = async () => {
    setTsInstalled(null);
    try {
      const res = await fetch("/api/tunnel/tailscale-check");
      if (res.ok) {
        const data = await res.json();
        setTsInstalled(data.installed);
        return data;
      }
    } catch { /* ignore */ }
    setTsInstalled(false);
    return { installed: false };
  };

  const handleInstallTailscale = async () => {
    setTsInstalling(true);
    setTsStatus(null);
    setTsInstallLog([]);
    try {
      const res = await fetch("/api/tunnel/tailscale-install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sudoPassword: tsSudoPassword }),
      });
      setTsSudoPassword("");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        for (const part of parts) {
          const lines = part.split("\n");
          let event = "progress";
          let data = null;
          for (const line of lines) {
            if (line.startsWith("event: ")) event = line.slice(7).trim();
            if (line.startsWith("data: ")) {
              try { data = JSON.parse(line.slice(6)); } catch { /* skip */ }
            }
          }
          if (!data) continue;
          if (event === "progress") {
            setTsInstallLog((prev) => [...prev.slice(-50), data.message]);
          } else if (event === "done") {
            setTsInstalled(true);
            setTsInstalling(false);
            setShowTsModal(false);
            handleConnectTailscale();
            return;
          } else if (event === "error") {
            setTsStatus({ type: "error", message: data.error || "Install failed" });
          }
        }
      }
    } catch (e) {
      setTsStatus({ type: "error", message: e.message });
    } finally {
      setTsInstalling(false);
    }
  };

  // Ping Tailscale health until reachable
  const pingTsHealth = async (url) => {
    setTsProgress("Waiting for Tailscale ready...");
    const healthUrl = `${url}/api/health`;
    const start = Date.now();
    while (Date.now() - start < TUNNEL_PING_MAX_MS) {
      await new Promise((r) => setTimeout(r, TUNNEL_PING_INTERVAL_MS));
      try {
        const ping = await fetch(healthUrl, { mode: "no-cors", cache: "no-store" });
        if (ping.ok || ping.type === "opaque") return true;
      } catch { /* not ready yet */ }
    }
    return false;
  };

  // Show inline login button instead of auto-opening popup (browsers block popups
  // opened after async work because the user gesture is lost).
  const requestUserAuth = (url, label) => {
    setTsAuthUrl(url);
    setTsAuthLabel(label);
  };

  const clearUserAuth = () => {
    setTsAuthUrl("");
    setTsAuthLabel("");
  };

  const handleConnectTailscale = async () => {
    setShowTsModal(false);
    setTsConnecting(true);
    setTsLoading(true);
    setTsStatus(null);
    setTsProgress("Connecting...");
    clearUserAuth();
    try {
      const res = await fetch("/api/tunnel/tailscale-enable", { method: "POST" });
      const data = await res.json();

      if (res.ok && data.success) {
        setTsUrl(data.tunnelUrl || "");
        const reachable = await pingTsHealth(data.tunnelUrl);
        setTsEnabled(true);
        setTsStatus(reachable ? null : { type: "warning", message: "Connected but not reachable yet." });
        return;
      }

      if (data.needsLogin && data.authUrl) {
        requestUserAuth(data.authUrl, "Open Login Page");
        setTsProgress("Login required — click \"Open Login Page\" to continue");
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          try {
            const r2 = await fetch("/api/tunnel/tailscale-check");
            if (r2.ok) {
              const check = await r2.json();
              if (check.loggedIn) {
                clearUserAuth();
                setTsProgress("Starting funnel...");
                const res2 = await fetch("/api/tunnel/tailscale-enable", { method: "POST" });
                const data2 = await res2.json();
                if (res2.ok && data2.success) {
                  setTsUrl(data2.tunnelUrl || "");
                  const ok2 = await pingTsHealth(data2.tunnelUrl);
                  setTsEnabled(true);
                  setTsStatus(ok2 ? null : { type: "warning", message: "Connected but not reachable yet." });
                } else if (data2.funnelNotEnabled && data2.enableUrl) {
                  await pollFunnelEnable(data2.enableUrl);
                } else {
                  setTsStatus({ type: "error", message: data2.error || "Failed to start funnel" });
                }
                return;
              }
            }
          } catch { /* retry */ }
        }
        clearUserAuth();
        setTsStatus({ type: "error", message: "Login timed out. Please try again." });
        return;
      }

      if (data.funnelNotEnabled && data.enableUrl) {
        await pollFunnelEnable(data.enableUrl);
        return;
      }

      setTsStatus({ type: "error", message: data.error || "Failed to connect" });
    } catch (error) {
      setTsStatus({ type: "error", message: error.message });
    } finally {
      setTsLoading(false);
      setTsConnecting(false);
      setTsProgress("");
      clearUserAuth();
    }
  };

  const pollFunnelEnable = async (enableUrl) => {
    requestUserAuth(enableUrl, "Open Funnel Settings");
    setTsProgress("Click \"Open Funnel Settings\" to enable Funnel...");
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const res = await fetch("/api/tunnel/tailscale-enable", { method: "POST" });
        const data = await res.json();
        if (res.ok && data.success) {
          clearUserAuth();
          setTsUrl(data.tunnelUrl || "");
          const ok3 = await pingTsHealth(data.tunnelUrl);
          setTsEnabled(true);
          setTsStatus(ok3 ? null : { type: "warning", message: "Connected but not reachable yet." });
          return;
        }
        if (data.funnelNotEnabled) continue;
        if (data.error) {
          clearUserAuth();
          setTsStatus({ type: "error", message: data.error });
          return;
        }
      } catch { /* retry */ }
    }
    clearUserAuth();
    setTsStatus({ type: "error", message: "Timed out waiting for Funnel to be enabled." });
  };

  const handleDisableTailscale = async () => {
    setTsLoading(true);
    setTsStatus(null);
    try {
      const res = await fetch("/api/tunnel/tailscale-disable", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setTsEnabled(false);
        setTsUrl("");
        setShowDisableTsModal(false);
        setTsStatus({ type: "success", message: "Tailscale disabled" });
      } else {
        setTsStatus({ type: "error", message: data.error || "Failed to disable Tailscale" });
      }
    } catch (e) {
      setTsStatus({ type: "error", message: e.message });
    } finally {
      setTsLoading(false);
    }
  };

  const handleOpenTsModal = async () => {
    setTsStatus(null);
    setTsInstallLog([]);
    const data = await checkTailscaleInstalled();
    if (data?.installed && data?.hasCachedPassword) {
      handleConnectTailscale();
    } else {
      setShowTsModal(true);
    }
  };

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;
    setCreateError("");

    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
        }),
      });
      const data = await res.json();

      if (res.status === 201) {
        // Capture-at-create: this 201 is the only plaintext copy the server ever yields.
        if (data.key && data.keyId) storeKey(data.keyId, data.key);
        setCreatedKey(data);
        setCreatedKeyAck(false);
        setShowAddModal(false);
        resetCreateForm();
        await fetchData();
      } else {
        setCreateError(data.error || "Failed to create key");
      }
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
          const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
          if (res.ok) {
            removeKey(id); // purge the captured copy alongside the server-side revoke
            setKeys(keys.filter((k) => k.id !== id));
          }
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
      const res = await fetch(`/api/keys/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (res.ok) {
        setKeys(prev => prev.map(k => k.id === id ? { ...k, isActive } : k));
      }
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
    tsEnabled,
    setTsEnabled,
    tsReachable,
    setTsReachable,
    tsUrl,
    setTsUrl,
    tsLoading,
    setTsLoading,
    tsProgress,
    setTsProgress,
    tsStatus,
    setTsStatus,
    tsAuthUrl,
    setTsAuthUrl,
    tsAuthLabel,
    setTsAuthLabel,
    tsInstalled,
    setTsInstalled,
    tsInstalling,
    setTsInstalling,
    tsInstallLog,
    setTsInstallLog,
    tsSudoPassword,
    setTsSudoPassword,
    tsConnecting,
    setTsConnecting,
    showTsModal,
    setShowTsModal,
    showDisableTsModal,
    setShowDisableTsModal,
    tunnelEverReachable,
    setTunnelEverReachable,
    tsEverReachable,
    setTsEverReachable,
    isRemoteHost,
    setIsRemoteHost,
    copied,
    copy,
    isLoginUnsafe,
    unsafeReason,
    categories,
    filteredKeys,
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
    handleInstallTailscale,
    handleConnectTailscale,
    handleDisableTailscale,
    handleOpenTsModal,
    handleCreateKey,
    handleDeleteKey,
    handleToggleKey,
    updateReachable,
    clearUserAuth,
    tsLogRef,
  };
}
