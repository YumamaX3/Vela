"use client";
// The Endpoint console's shared fleet store — one load, one polling machine,
// five shores.
//
// WHY A STORE AND NOT FIVE FETCHES: the room used to be one page client with
// five tabs over one hook (`useEndpointController`). A tab switch was a state
// flip, so the fleet, the settings and the two reachability machines were read
// once. The separation makes every lens its own route — and a page switch is a
// NAVIGATION, which unmounts the hook and re-fetches. Five pages fetching five
// times is five chances to disagree about the census, and the census strip's
// whole purpose is one arithmetic over one copy. So the data current moves up
// one level: `layout.js` mounts this store above all five shores, and it
// outlives the route.
//
// What it holds: everything `useEndpointController` held — keys, keyUsage,
// settings, the Cloudflare Tunnel machine, the WHOLE Tailscale/Funnel machine,
// every modal draft, and every mutation the room performs. The move is VERBATIM
// (plan §6): same expressions, same poll cadences (`STATUS_POLL_FAST_MS` 5s /
// `STATUS_POLL_SLOW_MS` 30s / `REACHABLE_MISS_THRESHOLD` 5 / `TUNNEL_PING_*`
// from `lib/constants.js`), same `provisioningDefaultKey` module-scope dedup
// guard.
//
// THE REACT-ONLY MACHINES AND WHERE THEY LIVE (plan §6, the fallback written
// down): the controller kept five reachability refs and an install log that
// auto-scrolls a DOM node. A store action can hold neither a ref nor a listener
// that depends on subscribed state, so the split is:
//   · every debounce's refs moved here as PLAIN FIELDS — they were values
//     (the last ping verdict, the consecutive-miss counter, the ever-seen
//     flag), never DOM, so the move loses nothing, and
//   · the install log's auto-scroll and the two poll `useEffect`s stay in the
//     facade, which composes them back over this store exactly as the
//     controller composed them over its own state.
// That is the proxy store's own law: the machine's React halves stay in the
// hook, and the hook never holds a second copy of the data.
//
// The subscription rule is R3: pages subscribe with SELECTORS (or take the
// `useEndpointFacade()` hook, which selects for them), never a bare
// `useEndpointStore()` call — a bare call re-renders on every field change.
import { create } from "zustand";
import { logger } from "@/lib/clientLogger";
import {
  TUNNEL_PING_INTERVAL_MS,
  TUNNEL_PING_MAX_MS,
  REACHABLE_MISS_THRESHOLD,
} from "../lib/constants";
import { clientPingUrl } from "../lib/ping";
import { fetchAllKeys, createKey, updateKey, deleteKey, setKeyActive } from "../lib/keyApi";
import { DEFAULT_LIMITS, limitsFromRecord } from "../lib/keyLimits";
import { storeKey, removeKey } from "@/shared/utils/keyVault";

// Dedup guard for auto-provisioning the first "Default Key". Module scope so it
// survives re-mounts within a session. `fetchData` can run concurrently
// (StrictMode double-invoke, fast re-mount); without this, two runs both see
// zero keys and both POST → duplicate keys. Single-threaded JS makes the
// check-then-set below atomic: the flag is set synchronously before the first
// await, so the second caller sees it.
// It stays HERE, beside its only reader, rather than in lib/ — it is a mutable
// module binding, and `import` bindings are read-only, so an extracted copy
// could not be assigned. One reader, one writer, one file.
let provisioningDefaultKey = false;

/**
 * The security verdict's arithmetic — the one counting loop.
 *
 * A control is "missing" objectively; whether it MATTERS depends on exposure.
 * This gateway runs at home with login off by choice, and the house's own gate
 * agrees that is legitimate — it blocks *enabling* a transport while unsafe
 * rather than demanding a password from someone who never exposes one. So the
 * count is always true, but only warns once something is actually reachable.
 */
export function computeMissingControls({ requireApiKey = false, requireLogin = true, hasPassword = true } = {}) {
  return (requireApiKey ? 0 : 1) + (requireLogin && hasPassword ? 0 : 1);
}

/** A key is "exposed" once any remote transport is switched on. */
export function computeExposed({ tunnelEnabled = false, tsEnabled = false } = {}) {
  return Boolean(tunnelEnabled || tsEnabled);
}

/** Distinct categories across all keys (case-sensitive, stable order by first
 *  appearance) — feeds both the filter chips and the create-form datalist. */
export function computeCategories(keys = []) {
  const seen = new Set();
  for (const k of keys) if (k.category) seen.add(k.category);
  return [...seen];
}

export const useEndpointStore = create((set, get) => ({
  // ── state ────────────────────────────────────────────────────────────────
  keys: [],
  loading: true,
  error: null,
  // The bootstrap guard: true only after a SUCCESSFUL read. A failed read
  // leaves it false, so the next `load()` (a retry click, a remount) tries again
  // instead of presenting a silently empty fleet as the truth.
  loaded: false,
  // The in-flight load, shared so concurrent first mounts (Strict mode, a fast
  // navigation, five shores mounting at once) join ONE request cycle.
  inflight: null,

  // ── the keys room ────────────────────────────────────────────────────────
  showAddModal: false,
  newKeyName: "",
  newKeyDescription: "",
  newKeyScopeOn: false,
  newKeyScope: [],
  createdKey: null, // { key, keyId, keyPrefix, record } — the one-time show
  createdKeyAck: false,
  editingKey: null, // draft state for the edit modal
  scopePickerFor: null, // "create" | "edit" — which form's scope the grouped picker is editing
  createLimits: DEFAULT_LIMITS, // W3 limits for the create form
  createError: "",
  activeProviders: [],
  modelAliases: {},
  confirmState: null,
  newKeyCategory: "",
  activeCategoryFilter: "all",
  usagePeriod: "all",
  keyUsage: {},

  // ── settings ─────────────────────────────────────────────────────────────
  requireApiKey: false,
  requireLogin: true,
  hasPassword: true,
  tunnelDashboardAccess: false,

  // ── Cloudflare Tunnel ────────────────────────────────────────────────────
  tunnelChecking: true,
  tunnelEnabled: false,
  tunnelReachable: false,
  tunnelUrl: "",
  tunnelPublicUrl: "",
  tunnelLoading: false,
  tunnelProgress: "",
  tunnelStatus: null,
  showEnableTunnelModal: false,
  showDisableTunnelModal: false,
  tunnelEverReachable: false,
  // The client ping's last verdict (browser-side, independent of backend DNS
  // quirks) and the consecutive-miss counter. These were `useRef`s in the
  // controller — they are values, not DOM, so they moved here as plain fields.
  // Nothing renders them; only the debounce reads them.
  tunnelClientReachable: false,
  tunnelMiss: 0,

  // ── Tailscale / Funnel ───────────────────────────────────────────────────
  // The whole domain, lifted from `useTailscale`. The one React-only piece —
  // the install log's auto-scrolling DOM node — stayed behind: the facade
  // scrolls it, and nothing else reads it.
  tsEnabled: false,
  tsReachable: false,
  tsUrl: "",
  tsLoading: false,
  tsProgress: "",
  tsStatus: null,
  tsAuthUrl: "",
  tsAuthLabel: "",
  tsInstalled: null, // null=checking, true/false
  tsInstalling: false,
  tsInstallLog: [],
  tsSudoPassword: "",
  tsConnecting: false,
  showTsModal: false,
  showDisableTsModal: false,
  tsEverReachable: false,
  tsClientReachable: false,
  tsMiss: 0,

  // ── the address every shore prints ───────────────────────────────────────
  // Declared here rather than in the shell because it is controller state — the
  // Keys address strip, the Quick-connect snippets, and the Diagnostics readouts
  // all read it, and a second copy in the shell would be a second source of
  // truth.
  baseUrl: "/v1",

  // ── the one load ─────────────────────────────────────────────────────────
  // All three currents read together: the fleet, the settings, and the tunnel
  // status (which carries Tailscale's slice). A settings failure is tolerated:
  // the toggles have safe defaults and must never take the fleet down with them.
  load: async ({ force = false } = {}) => {
    const state = get();
    if (!force && state.loaded) return;
    if (state.inflight) return state.inflight;

    set({ error: null });
    const run = (async () => {
      try {
        await get().fetchData();
        await get().loadSettings();
        await get().loadModelCatalog();
        set({ loaded: true });
      } catch (err) {
        set({ error: err?.message || "Could not reach the endpoint.", loaded: false });
      } finally {
        set({ inflight: null });
      }
    })();

    set({ inflight: run });
    return run;
  },

  /** Force a refetch — the Retry click, a post-mutation refresh. */
  reload: () => get().load({ force: true }),

  fetchData: async () => {
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
              set({ createdKey: data, createdKeyAck: false });
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
      set({ keys: existing });
    } catch (error) {
      logger.error("ENDPOINTSTORE", "Error fetching data:", "ENDPOINTSTORE", error);
    } finally {
      set({ loading: false });
    }
  },

  // ── the settings / status reads ────────────────────────────────────────────
  // Both reads land their fields AND finish the React-only halves here: the
  // debounces are plain store fields now, and Tailscale's slice applies inside
  // the same pass — so a bootstrap, a status poll and a retry all produce the
  // same verdict without the facade holding a second copy of the machine.

  loadSettings: async () => {
    set({ tunnelChecking: true });
    try {
      const [settingsRes, statusRes] = await Promise.all([
        fetch("/api/settings"),
        fetch("/api/tunnel/status", { cache: "no-store" })
      ]);
      const settings = settingsRes.ok ? await settingsRes.json() : null;
      const status = statusRes.ok ? await statusRes.json() : null;
      if (settings) {
        set({
          requireApiKey: settings.requireApiKey || false,
          requireLogin: settings.requireLogin !== false,
          hasPassword: settings.hasPassword || false,
          tunnelDashboardAccess: settings.tunnelDashboardAccess || false,
        });
      }
      if (status) {
        const tEnabled = status.tunnel?.settingsEnabled ?? status.tunnel?.enabled ?? false;
        set({
          tunnelUrl: status.tunnel?.tunnelUrl || "",
          tunnelPublicUrl: status.tunnel?.publicUrl || "",
          tunnelEnabled: tEnabled,
        });
        get().applyTunnelReachable();
        get().applyTailscaleStatus(status.tailscale);
      }
      return { settings, status };
    } catch (error) {
      logger.error("ENDPOINTSTORE", "Error loading settings:", "ENDPOINTSTORE", error);
      return { settings: null, status: null };
    } finally {
      set({ tunnelChecking: false });
    }
  },

  /** The status poll's tunnel half. Same split as `loadSettings`. */
  syncTunnelStatus: async () => {
    try {
      const statusRes = await fetch("/api/tunnel/status", { cache: "no-store" });
      if (!statusRes.ok) return null;
      const data = await statusRes.json();
      const tEnabled = data.tunnel?.settingsEnabled ?? data.tunnel?.enabled ?? false;
      set({
        tunnelUrl: data.tunnel?.tunnelUrl || "",
        tunnelPublicUrl: data.tunnel?.publicUrl || "",
        tunnelEnabled: tEnabled,
      });
      get().applyTunnelReachable();
      get().applyTailscaleStatus(data.tailscale);
      return data;
    } catch { /* ignore poll errors */ }
    return null;
  },

  // ── the reachability debounce (the controller's `updateReachable`) ─────────
  // Client-side reachable only (server no longer probes; watchdog handles
  // backend health). Miss-debounce: only flip to false after N consecutive
  // misses, so a background refresh's brief `false` never reads as an outage.
  applyTunnelReachable: () => {
    if (get().tunnelClientReachable) {
      set({ tunnelMiss: 0, tunnelReachable: true });
      if (!get().tunnelEverReachable) set({ tunnelEverReachable: true });
    } else {
      const miss = get().tunnelMiss + 1;
      set({ tunnelMiss: miss });
      if (miss >= REACHABLE_MISS_THRESHOLD) set({ tunnelReachable: false });
    }
  },

  // ── mutations — settings ──────────────────────────────────────────────────

  handleTunnelDashboardAccess: async (value) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tunnelDashboardAccess: value }),
      });
      if (res.ok) set({ tunnelDashboardAccess: value });
    } catch (error) {
      logger.error("ENDPOINTSTORE", "Error updating tunnelDashboardAccess:", "ENDPOINTSTORE", error);
    }
  },

  handleRequireApiKey: async (value) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requireApiKey: value }),
      });
      if (res.ok) set({ requireApiKey: value });
    } catch (error) {
      logger.error("ENDPOINTSTORE", "Error updating requireApiKey:", "ENDPOINTSTORE", error);
    }
  },

  // ── mutations — keys ─────────────────────────────────────────────────────

  resetCreateForm: () => {
    set({
      newKeyName: "",
      newKeyDescription: "",
      newKeyCategory: "",
      newKeyScopeOn: false,
      newKeyScope: [],
      createLimits: DEFAULT_LIMITS,
      createError: "",
    });
  },

  openCreateModal: () => {
    get().resetCreateForm();
    set({ showAddModal: true });
  },

  closeCreatedKeyModal: () => {
    set({ createdKey: null, createdKeyAck: false });
  },

  // Grouped scope picker: add/remove a model value on whichever form opened it.
  // model.value is "alias/model" — the exact form the gate matches at request time.
  scopeValue: (model) => model?.value || model?.name || model,

  handleScopeSelect: (model) => {
    const value = get().scopeValue(model);
    if (!value) return;
    if (get().scopePickerFor === "create") {
      set((prev) => ({
        newKeyScope: prev.newKeyScope.includes(value) ? prev.newKeyScope : [...prev.newKeyScope, value],
      }));
    } else {
      set((prev) => (prev.editingKey && !prev.editingKey.allowedModels.includes(value)
        ? { editingKey: { ...prev.editingKey, allowedModels: [...prev.editingKey.allowedModels, value] } }
        : prev));
    }
  },

  handleScopeDeselect: (model) => {
    const value = get().scopeValue(model);
    if (!value) return;
    if (get().scopePickerFor === "create") {
      set((prev) => ({ newKeyScope: prev.newKeyScope.filter((x) => x !== value) }));
    } else {
      set((prev) => (prev.editingKey
        ? { editingKey: { ...prev.editingKey, allowedModels: prev.editingKey.allowedModels.filter((x) => x !== value) } }
        : prev));
    }
  },

  openEditKey: (key) => {
    set({
      editingKey: {
        id: key.id,
        name: key.name || "",
        description: key.description || "",
        category: key.category || "",
        allowedModels: Array.isArray(key.allowedModels) ? key.allowedModels : [],
        scopeOn: Array.isArray(key.allowedModels) && key.allowedModels.length > 0,
        limits: limitsFromRecord(key), // W3 draft — server record is source of truth
        saving: false,
        error: "",
      },
    });
  },

  handleSaveKey: async () => {
    const editingKey = get().editingKey;
    if (!editingKey) return;
    if (!editingKey.name.trim()) return;
    set((prev) => ({ editingKey: { ...prev.editingKey, saving: true, error: "" } }));
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
      set({ editingKey: null });
      await get().fetchData();
    } catch (error) {
      set((prev) => ({ editingKey: { ...prev.editingKey, saving: false, error: error.message } }));
    }
  },

  handleCreateKey: async () => {
    const { newKeyName, newKeyDescription, newKeyCategory, newKeyScopeOn, newKeyScope, createLimits } = get();
    if (!newKeyName.trim()) return;
    set({ createError: "" });

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
      set({ createdKey: data, createdKeyAck: false, showAddModal: false });
      get().resetCreateForm();
      await get().fetchData();
    } catch (error) {
      set({ createError: error.message });
    }
  },

  handleDeleteKey: (id) => {
    set({
      confirmState: {
        title: "Delete API Key",
        message: "Delete this API key?\n\nRequests using it will be rejected immediately. The audit row remains, but the key itself can never be recovered.",
        onConfirm: async () => {
          set({ confirmState: null });
          try {
            await deleteKey(id);
            removeKey(id); // purge the captured copy alongside the server-side revoke
            set((prev) => ({ keys: prev.keys.filter((k) => k.id !== id) }));
          } catch (error) {
            logger.error("ENDPOINTSTORE", "Error deleting key:", "ENDPOINTSTORE", error);
          }
        }
      }
    });
  },

  // ── The pause gate, hoisted from a view ──────────────────────────────────
  // Softening (resume) is harmless and immediate; TIGHTENING (pause) is not,
  // so it earns a confirm. That confirm used to live inside KeysCard's
  // onChange — which meant the gate existed exactly once, in one view. Every
  // other view that pauses a key (the table lens, the detail drawer, the bulk
  // action bar) would have shipped the pause unconfirmed with nothing to
  // notice, because a missing confirm looks identical to a working button.
  // The gate now sits at the mutation itself, where the delete gate already
  // sat, so no future view can forget it. `skipConfirm` exists for the batch
  // flows that own exactly one confirm for N keys.
  applyKeyActive: async (id, isActive) => {
    try {
      await setKeyActive(id, isActive);
      set((prev) => ({ keys: prev.keys.map((k) => (k.id === id ? { ...k, isActive } : k)) }));
    } catch (error) {
      logger.error("ENDPOINTSTORE", "Error toggling key:", "ENDPOINTSTORE", error);
    }
  },

  handleToggleKey: async (id, isActive, { skipConfirm = false } = {}) => {
    const key = get().keys.find((k) => k.id === id);
    // Only a transition INTO the disabled state is a tightening, and only a
    // key we can see to be currently active may be tightened — a stale row
    // cannot be paused twice. Resuming is never gated.
    const tightening = !isActive && key?.isActive !== false;
    if (tightening && !skipConfirm) {
      set({
        confirmState: {
          title: "Pause API Key",
          message: `Pause API key "${key?.name || "this key"}"?\n\nIt stops working immediately — every request carrying it is refused — but it can be resumed later. The key string itself is unchanged.`,
          onConfirm: async () => {
            set({ confirmState: null });
            await get().applyKeyActive(id, false);
          },
        }
      });
      return;
    }
    await get().applyKeyActive(id, isActive);
  },

  // ── mutations — Cloudflare Tunnel ─────────────────────────────────────────
  // Ping tunnel health until reachable. Race multiple URLs (shortlink + direct) — 1 OK is enough.
  pingTunnelHealth: async (...urls) => {
    set({ tunnelLoading: true, tunnelProgress: "Waiting for tunnel ready..." });
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
        set({ tunnelEnabled: true, tunnelLoading: false, tunnelProgress: "" });
        return true;
      }
      // Every 5 pings (~10s), check if backend process still alive
      if ((Date.now() - start) % 10000 < TUNNEL_PING_INTERVAL_MS) {
        try {
          const statusRes = await fetch("/api/tunnel/status");
          if (statusRes.ok) {
            const status = await statusRes.json();
            if (!status.tunnel?.enabled) {
              set({
                tunnelStatus: { type: "error", message: "Tunnel process stopped unexpectedly." },
                tunnelLoading: false,
                tunnelProgress: "",
              });
              return false;
            }
          }
        } catch { /* ignore */ }
      }
    }
    set({
      tunnelStatus: { type: "error", message: "Tunnel created but not reachable. Please try again." },
      tunnelLoading: false,
      tunnelProgress: "",
    });
    return false;
  },

  handleEnableTunnel: async () => {
    set({ showEnableTunnelModal: false, tunnelLoading: true, tunnelStatus: null, tunnelProgress: "Creating tunnel..." });

    // Poll download progress while enable request is pending
    let polling = true;
    const pollProgress = async () => {
      while (polling) {
        try {
          const r = await fetch("/api/tunnel/status");
          if (r.ok) {
            const s = await r.json();
            if (s.download?.downloading) {
              set({ tunnelProgress: `Downloading cloudflared... ${s.download.progress}%` });
            } else if (polling) {
              set({ tunnelProgress: "Creating tunnel..." });
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
        set({ tunnelStatus: { type: "error", message: data.error || "Failed to enable tunnel" } });
        return;
      }

      const url = data.tunnelUrl;
      if (!url) {
        set({ tunnelStatus: { type: "error", message: "No tunnel URL returned" } });
        return;
      }

      set({ tunnelUrl: url, tunnelPublicUrl: data.publicUrl || "" });
      await get().pingTunnelHealth(data.publicUrl, url);
    } catch (error) {
      set({ tunnelStatus: { type: "error", message: error.message } });
    } finally {
      polling = false;
      set({ tunnelLoading: false, tunnelProgress: "" });
    }
  },

  handleDisableTunnel: async () => {
    set({ tunnelLoading: true, tunnelStatus: null });
    try {
      const res = await fetch("/api/tunnel/disable", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        set({
          tunnelEnabled: false,
          tunnelUrl: "",
          showDisableTunnelModal: false,
          tunnelStatus: { type: "success", message: "Tunnel disabled" },
        });
      } else {
        set({ tunnelStatus: { type: "error", message: data.error || "Failed to disable tunnel" } });
      }
    } catch (error) {
      set({ tunnelStatus: { type: "error", message: error.message } });
    } finally {
      set({ tunnelLoading: false });
    }
  },

  // ── the address ───────────────────────────────────────────────────────────
  // Hydration fix: only access window on client side.
  initBaseUrl: () => {
    if (typeof window !== "undefined") {
      set({ baseUrl: `${window.location.origin}/v1` });
    }
  },

  // ── the key usage rollup ───────────────────────────────────────────────────
  // Per-key usage stats — requests/tokens/spend under each key row. Keys absent
  // from byKey had no traffic in the window.
  loadKeyUsage: async () => {
    try {
      const res = await fetch(`/api/keys/usage?period=${get().usagePeriod}`);
      const data = res.ok ? await res.json() : null;
      set({ keyUsage: data?.byKey || {} });
    } catch {
      set({ keyUsage: {} });
    }
  },

  // ── the model-scope catalog ─────────────────────────────────────────────────
  // Connected providers + aliases for the grouped model-scope picker — the same
  // catalog the combo page feeds ModelSelectModal. Stored values are model.value
  // ("alias/model"), the canonical form the gate matches at request time.
  loadModelCatalog: async () => {
    try {
      const providersRes = await fetch("/api/providers");
      if (providersRes.ok) {
        const data = await providersRes.json();
        set({ activeProviders: data.connections || [] });
      }
    } catch {
      set({ activeProviders: [] });
    }
    try {
      const aliasRes = await fetch("/api/models/alias");
      if (aliasRes.ok) {
        const data = await aliasRes.json();
        set({ modelAliases: data.aliases || {} });
      }
    } catch {
      set({ modelAliases: {} });
    }
  },

  // ── the Tailscale / Funnel machine (lifted from useTailscale) ───────────────

  requestUserAuth: (url, label) => {
    set({ tsAuthUrl: url, tsAuthLabel: label });
  },

  clearUserAuth: () => {
    set({ tsAuthUrl: "", tsAuthLabel: "" });
  },

  // Ping Tailscale health until reachable.
  pingTsHealth: async (url) => {
    set({ tsProgress: "Waiting for Tailscale ready..." });
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
  },

  checkTailscaleInstalled: async () => {
    set({ tsInstalled: null });
    try {
      const res = await fetch("/api/tunnel/tailscale-check");
      if (res.ok) {
        const data = await res.json();
        set({ tsInstalled: data.installed });
        return data;
      }
    } catch { /* ignore */ }
    set({ tsInstalled: false });
    return { installed: false };
  },

  handleInstallTailscale: async () => {
    set({ tsInstalling: true, tsStatus: null, tsInstallLog: [] });
    try {
      const res = await fetch("/api/tunnel/tailscale-install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sudoPassword: get().tsSudoPassword }),
      });
      set({ tsSudoPassword: "" });
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
            set((prev) => ({ tsInstallLog: [...prev.tsInstallLog.slice(-50), data.message] }));
          } else if (event === "done") {
            set({ tsInstalled: true, tsInstalling: false, showTsModal: false });
            get().handleConnectTailscale();
            return;
          } else if (event === "error") {
            set({ tsStatus: { type: "error", message: data.error || "Install failed" } });
          }
        }
      }
    } catch (e) {
      set({ tsStatus: { type: "error", message: e.message } });
    } finally {
      set({ tsInstalling: false });
    }
  },

  pollFunnelEnable: async (enableUrl) => {
    get().requestUserAuth(enableUrl, "Open Funnel Settings");
    set({ tsProgress: "Click \"Open Funnel Settings\" to enable Funnel..." });
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const res = await fetch("/api/tunnel/tailscale-enable", { method: "POST" });
        const data = await res.json();
        if (res.ok && data.success) {
          get().clearUserAuth();
          set({ tsUrl: data.tunnelUrl || "" });
          const ok3 = await get().pingTsHealth(data.tunnelUrl);
          set({ tsEnabled: true, tsStatus: ok3 ? null : { type: "warning", message: "Connected but not reachable yet." } });
          return;
        }
        if (data.funnelNotEnabled) continue;
        if (data.error) {
          get().clearUserAuth();
          set({ tsStatus: { type: "error", message: data.error } });
          return;
        }
      } catch { /* retry */ }
    }
    get().clearUserAuth();
    set({ tsStatus: { type: "error", message: "Timed out waiting for Funnel to be enabled." } });
  },

  // Show an inline login button instead of auto-opening a popup (browsers block
  // popups opened after async work because the user gesture is lost).
  handleConnectTailscale: async () => {
    set({ showTsModal: false, tsConnecting: true, tsLoading: true, tsStatus: null, tsProgress: "Connecting..." });
    get().clearUserAuth();
    try {
      const res = await fetch("/api/tunnel/tailscale-enable", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.success) {
        set({ tsUrl: data.tunnelUrl || "" });
        const reachable = await get().pingTsHealth(data.tunnelUrl);
        set({ tsEnabled: true, tsStatus: reachable ? null : { type: "warning", message: "Connected but not reachable yet." } });
        return;
      }
      if (data.needsLogin && data.authUrl) {
        get().requestUserAuth(data.authUrl, "Open Login Page");
        set({ tsProgress: "Login required — click \"Open Login Page\" to continue" });
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          try {
            const r2 = await fetch("/api/tunnel/tailscale-check");
            if (r2.ok) {
              const check = await r2.json();
              if (check.loggedIn) {
                get().clearUserAuth();
                set({ tsProgress: "Starting funnel..." });
                const res2 = await fetch("/api/tunnel/tailscale-enable", { method: "POST" });
                const data2 = await res2.json();
                if (res2.ok && data2.success) {
                  set({ tsUrl: data2.tunnelUrl || "" });
                  const ok2 = await get().pingTsHealth(data2.tunnelUrl);
                  set({ tsEnabled: true, tsStatus: ok2 ? null : { type: "warning", message: "Connected but not reachable yet." } });
                } else if (data2.funnelNotEnabled && data2.enableUrl) {
                  await get().pollFunnelEnable(data2.enableUrl);
                } else {
                  set({ tsStatus: { type: "error", message: data2.error || "Failed to start funnel" } });
                }
                return;
              }
            }
          } catch { /* retry */ }
        }
        get().clearUserAuth();
        set({ tsStatus: { type: "error", message: "Login timed out. Please try again." } });
        return;
      }
      if (data.funnelNotEnabled && data.enableUrl) {
        await get().pollFunnelEnable(data.enableUrl);
        return;
      }
      set({ tsStatus: { type: "error", message: data.error || "Failed to connect" } });
    } catch (error) {
      set({ tsStatus: { type: "error", message: error.message } });
    } finally {
      set({ tsLoading: false, tsConnecting: false, tsProgress: "" });
      get().clearUserAuth();
    }
  },

  handleDisableTailscale: async () => {
    set({ tsLoading: true, tsStatus: null });
    try {
      const res = await fetch("/api/tunnel/tailscale-disable", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        set({
          tsEnabled: false,
          tsUrl: "",
          showDisableTsModal: false,
          tsStatus: { type: "success", message: "Tailscale disabled" },
        });
      } else {
        set({ tsStatus: { type: "error", message: data.error || "Failed to disable Tailscale" } });
      }
    } catch (e) {
      set({ tsStatus: { type: "error", message: e.message } });
    } finally {
      set({ tsLoading: false });
    }
  },

  handleOpenTsModal: async () => {
    set({ tsStatus: null, tsInstallLog: [] });
    const data = await get().checkTailscaleInstalled();
    if (data?.installed && data?.hasCachedPassword) {
      get().handleConnectTailscale();
    } else {
      set({ showTsModal: true });
    }
  },

  /** The room's status poll hands Tailscale's slice here instead of reaching
   *  into these refs from outside. Same reads, same debounce — the reachability
   *  verdict now lives beside the state it mutates. */
  applyTailscaleStatus: (tailscale) => {
    const enabled = tailscale?.settingsEnabled ?? tailscale?.enabled ?? false;
    set({ tsUrl: tailscale?.tunnelUrl || "", tsEnabled: enabled });
    if (get().tsClientReachable) {
      set({ tsMiss: 0, tsReachable: true });
      if (!get().tsEverReachable) set({ tsEverReachable: true });
    } else {
      const miss = get().tsMiss + 1;
      set({ tsMiss: miss });
      if (miss >= REACHABLE_MISS_THRESHOLD) set({ tsReachable: false });
    }
  },

  /** The browser-side probe, called by the room's ping loop. */
  probeTsClient: async () => {
    if (get().tsEnabled && get().tsUrl) {
      const ok = await clientPingUrl(get().tsUrl);
      set({ tsClientReachable: ok });
      if (ok) {
        set({ tsMiss: 0, tsReachable: true });
        if (!get().tsEverReachable) set({ tsEverReachable: true });
      } else {
        const miss = get().tsMiss + 1;
        set({ tsMiss: miss });
        if (miss >= REACHABLE_MISS_THRESHOLD) set({ tsReachable: false });
      }
    } else {
      set({ tsClientReachable: false });
    }
  },
}));

// ── selectors ────────────────────────────────────────────────────────────────
// Subscribe with these. Each returns a stable reference or a pure slice; derived
// aggregates are memoized in the facade (`useEndpointFacade`) per input identity.

export const selectKeys = (s) => s.keys;
export const selectLoading = (s) => s.loading;
export const selectError = (s) => s.error;
export const selectKeyUsage = (s) => s.keyUsage;
export const selectRequireApiKey = (s) => s.requireApiKey;
export const selectRequireLogin = (s) => s.requireLogin;
export const selectHasPassword = (s) => s.hasPassword;
export const selectTunnelEnabled = (s) => s.tunnelEnabled;
export const selectTunnelChecking = (s) => s.tunnelChecking;
export const selectBaseUrl = (s) => s.baseUrl;

// ── test/reset seam ──────────────────────────────────────────────────────────
// The store is a module singleton, exactly like `proxyFleetStore`. A test suite
// that renders two rooms in one file would otherwise hand the second one the
// first one's fleet. `resetEndpointStore` restores the initial shape; nothing in
// production calls it.
export function resetEndpointStore() {
  provisioningDefaultKey = false;
  useEndpointStore.setState({
    keys: [],
    loading: true,
    error: null,
    loaded: false,
    inflight: null,
    showAddModal: false,
    newKeyName: "",
    newKeyDescription: "",
    newKeyScopeOn: false,
    newKeyScope: [],
    createdKey: null,
    createdKeyAck: false,
    editingKey: null,
    scopePickerFor: null,
    createLimits: DEFAULT_LIMITS,
    createError: "",
    activeProviders: [],
    modelAliases: {},
    confirmState: null,
    newKeyCategory: "",
    activeCategoryFilter: "all",
    usagePeriod: "all",
    keyUsage: {},
    requireApiKey: false,
    requireLogin: true,
    hasPassword: true,
    tunnelDashboardAccess: false,
    tunnelChecking: true,
    tunnelEnabled: false,
    tunnelReachable: false,
    tunnelUrl: "",
    tunnelPublicUrl: "",
    tunnelLoading: false,
    tunnelProgress: "",
    tunnelStatus: null,
    showEnableTunnelModal: false,
    showDisableTunnelModal: false,
    tunnelEverReachable: false,
    tunnelClientReachable: false,
    tunnelMiss: 0,
    tsEnabled: false,
    tsReachable: false,
    tsUrl: "",
    tsLoading: false,
    tsProgress: "",
    tsStatus: null,
    tsAuthUrl: "",
    tsAuthLabel: "",
    tsInstalled: null,
    tsInstalling: false,
    tsInstallLog: [],
    tsSudoPassword: "",
    tsConnecting: false,
    showTsModal: false,
    showDisableTsModal: false,
    tsEverReachable: false,
    tsClientReachable: false,
    tsMiss: 0,
    baseUrl: "/v1",
  });
}
