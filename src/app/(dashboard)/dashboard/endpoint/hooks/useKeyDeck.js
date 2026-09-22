"use client";

// The key deck's data current and its one selection.
//
// Everything the deck shows is either controller state (`c.keys`, `c.keyUsage`)
// or the census the stats route computes; nothing here holds a second copy of
// the fleet. Mutations are named once, here, and every view calls them — so the
// cards, the table, the drawer and the bulk bar cannot disagree about what a
// pause did, and a new lens cannot invent its own fetch.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  bulkKeys,
  exportKeysFile,
  fetchStats,
  importKeys,
} from "../lib/keyApi";
import { categoryOf, filterKeys, postureOf, sortKeys, UNCATEGORIZED } from "../lib/keyFormat";
import { removeKey, storeKey } from "@/shared/utils/keyVault";

export const LENSES = [
  { value: "cards", label: "Cards", icon: "grid_view" },
  { value: "table", label: "Table", icon: "table_rows" },
];

export const PERIODS = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "60d", label: "60d" },
  { value: "all", label: "All time" },
];

export const IMPORT_CONFLICT_OPTIONS = [
  { value: "skip", label: "Skip existing names" },
  { value: "overwrite", label: "Overwrite existing (re-issues the key)" },
  { value: "rename", label: "Import as copies" },
];

export default function useKeyDeck(c) {
  const {
    keys,
    keyUsage,
    usagePeriod,
    setUsagePeriod,
    activeCategoryFilter,
    setActiveCategoryFilter,
    categories,
    fetchData,
    handleToggleKey,
    handleDeleteKey,
    openCreateModal,
    openEditKey,
    setConfirmState,
    copy,
    copied,
  } = c;

  // The census the route computes. Null until it answers — the deck renders
  // from the client's own derivation meanwhile rather than showing nothing.
  const [stats, setStats] = useState(null);
  const [statsError, setStatsError] = useState(null);

  const [lens, setLens] = useState("cards");
  const [query, setQuery] = useState("");
  // The posture lens the pulse tiles toggle. Null = every posture.
  const [posture, setPosture] = useState(null);
  const [sortKey, setSortKey] = useState("created");
  const [sortDir, setSortDir] = useState("desc");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [detailId, setDetailId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [importState, setImportState] = useState(null);

  const reloadStats = useCallback(async () => {
    try {
      const next = await fetchStats(usagePeriod);
      setStats(next);
      setStatsError(null);
    } catch (error) {
      // A census the harbor could not compute must not be faked. The deck keeps
      // rendering, and the masthead says the count is the client's own.
      setStats(null);
      setStatsError(error.message);
    }
  }, [usagePeriod]);

  // Refetched when the window changes or the key set does (create / revoke) —
  // the same dependency shape the usage rollup in the controller already uses.
  useEffect(() => {
    reloadStats();
  }, [reloadStats, keys]);

  /** One refresh after any mutation: the fleet AND its census, together. */
  const refresh = useCallback(async () => {
    await fetchData();
    await reloadStats();
  }, [fetchData, reloadStats]);

  // ── selection ─────────────────────────────────────────────────────────────

  // A selection is pruned against the live fleet, so a revoked key can never
  // linger in a bulk target list and be acted on twice.
  const selected = useMemo(() => {
    const live = new Set(keys.map((k) => k.id));
    return new Set([...selectedIds].filter((id) => live.has(id)));
  }, [selectedIds, keys]);

  const toggleSelect = useCallback((id, next) => {
    setSelectedIds((prev) => {
      const copySet = new Set(prev);
      const wanted = next === undefined ? !copySet.has(id) : next;
      if (wanted) copySet.add(id);
      else copySet.delete(id);
      return copySet;
    });
  }, []);

  const selectMany = useCallback((ids, next = true) => {
    setSelectedIds((prev) => {
      const copySet = new Set(prev);
      for (const id of ids) {
        if (next) copySet.add(id);
        else copySet.delete(id);
      }
      return copySet;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // ── the derived list ──────────────────────────────────────────────────────

  const visibleKeys = useMemo(
    () => sortKeys(filterKeys(keys, { query, category: activeCategoryFilter, posture }), sortKey, sortDir, keyUsage),
    [keys, query, activeCategoryFilter, posture, sortKey, sortDir, keyUsage]
  );

  /** Per-key posture, computed once per render pass so the pulse, the rail and
   *  every row paint the same verdict rather than recomputing it four times. */
  const postureById = useMemo(() => {
    const map = {};
    for (const key of keys) map[key.id] = postureOf(key);
    return map;
  }, [keys]);

  /** Client-side posture counts — the fallback when the census is unavailable,
   *  and the honest secondary reading when it is (the server counts over its
   *  own window, this counts the rows in hand). */
  const postureCounts = useMemo(() => {
    const counts = { active: 0, paused: 0, expiring: 0, expired: 0 };
    for (const key of keys) {
      const p = postureById[key.id] || "active";
      counts[p] = (counts[p] || 0) + 1;
    }
    return counts;
  }, [keys, postureById]);

  /** Rail counts. The server's census is preferred (it agrees with the API);
   *  the client derivation fills the gap while the census is loading. */
  const railCounts = useMemo(() => {
    if (stats?.byCategory) {
      const map = new Map(stats.byCategory.map((b) => [b.category ?? UNCATEGORIZED, b]));
      return {
        total: stats.totals?.keys ?? keys.length,
        of: (label) => map.get(label)?.keys ?? 0,
      };
    }
    const counts = new Map();
    for (const key of keys) {
      const label = categoryOf(key);
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    return { total: keys.length, of: (label) => counts.get(label) || 0 };
  }, [stats, keys]);

  const detailKey = useMemo(
    () => keys.find((k) => k.id === detailId) || null,
    [keys, detailId]
  );

  // ── mutations ─────────────────────────────────────────────────────────────
  // Every one takes a LIST, so the row actions and the bulk bar run the same
  // code path — a single key is simply a list of one. That is what keeps the
  // bulk bar from drifting into a second dialect of the same operation.

  const announce = useCallback((tone, message) => setNotice({ tone, message }), []);

  const runBulk = useCallback(
    async (action, payload, { confirm, done, after } = {}) => {
      const ids = payload?.ids || [];
      if (ids.length === 0) return;
      const execute = async () => {
        setBusy(true);
        setNotice(null);
        try {
          const result = await bulkKeys(action, { ...payload, ids });
          await refresh();
          if (typeof after === "function") await after(result);
          const failed = result?.failed || 0;
          const changed = result?.changed || 0;
          if (failed > 0) {
            const first = result.results.find((r) => !r.ok);
            announce("warn", `${changed} applied, ${failed} refused — ${first?.name || "one key"}: ${first?.error || "see the results"}`);
          } else if (done) {
            announce("ok", done(changed));
          }
          return result;
        } catch (error) {
          announce("red", error.message);
          return null;
        } finally {
          setBusy(false);
        }
      };

      if (confirm) {
        setConfirmState({
          title: confirm.title,
          message: confirm.message,
          onConfirm: async () => {
            setConfirmState(null);
            await execute();
          },
        });
        return;
      }
      return execute();
    },
    [announce, refresh, setConfirmState]
  );

  /** Pause / resume. A single key rides the controller's gated handler so the
   *  tighten-confirm law is never bypassed; a batch asks ONCE for N keys. */
  const setActive = useCallback(
    async (ids, isActive) => {
      if (ids.length === 1 && !isActive) {
        const key = keys.find((k) => k.id === ids[0]);
        await handleToggleKey(ids[0], false);
        if (key) setDetailId(null);
        return;
      }
      if (ids.length === 1) {
        await handleToggleKey(ids[0], true);
        return;
      }
      await runBulk(isActive ? "resume" : "pause", { ids }, {
        confirm: isActive
          ? undefined
          : {
              title: `Pause ${ids.length} keys`,
              message: `Pause ${ids.length} API keys?\n\nEach stops working immediately and can be resumed later. No key string changes.`,
            },
        done: (n) => (isActive ? `${n} key${n === 1 ? "" : "s"} resumed` : `${n} key${n === 1 ? "" : "s"} paused`),
      });
    },
    [keys, handleToggleKey, runBulk]
  );

  const revoke = useCallback(
    async (ids) => {
      if (ids.length === 1) {
        // The controller's own confirm + vault purge stay single-sourced.
        await handleDeleteKey(ids[0]);
        setDetailId(null);
        return;
      }
      await runBulk("delete", { ids }, {
        confirm: {
          title: `Revoke ${ids.length} keys`,
          message: `Revoke ${ids.length} API keys?\n\nEvery request carrying them is refused immediately. The audit rows remain, but the keys can never be recovered.`,
        },
        after: async () => {
          // Purge the browser vault's captured copies alongside the revoke —
          // the same pairing the single-key path performs.
          for (const id of ids) removeKey(id);
          clearSelection();
        },
        done: (n) => `${n} key${n === 1 ? "" : "s"} revoked`,
      });
    },
    [handleDeleteKey, runBulk, clearSelection]
  );

  const setCategory = useCallback(
    async (ids, category) => {
      await runBulk("setCategory", { ids, category: category || null }, {
        done: (n) => (category ? `${n} key${n === 1 ? "" : "s"} filed under "${category}"` : `${n} key${n === 1 ? "" : "s"} unfiled`),
      });
    },
    [runBulk]
  );

  const applyLimits = useCallback(
    async (ids, limits) => {
      await runBulk("setLimits", { ids, limits }, {
        done: (n) => `limits applied to ${n} key${n === 1 ? "" : "s"}`,
      });
    },
    [runBulk]
  );

  // ── the file pair ─────────────────────────────────────────────────────────

  const exportFleet = useCallback(() => {
    exportKeysFile();
    announce("ok", "The fleet's shape is downloading — key strings are not in it and cannot be.");
  }, [announce]);

  const openImport = useCallback(() => {
    setImportState({ fileName: "", envelope: null, mode: "dry-run", onConflict: "skip", plan: null, applied: null, busy: false, error: "" });
  }, []);

  const closeImport = useCallback(() => setImportState(null), []);

  const loadImportFile = useCallback(async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const envelope = JSON.parse(text);
      setImportState((prev) => ({ ...(prev || {}), fileName: file.name, envelope, plan: null, applied: null, error: "" }));
    } catch (error) {
      setImportState((prev) => ({ ...(prev || {}), fileName: file.name, envelope: null, plan: null, applied: null, error: `That file is not readable JSON — ${error.message}` }));
    }
  }, []);

  /** Load the current file into localStorage's import buffer — used by the
   *  dashboard's own export, so a round trip needs no file picker. */
  const loadImportFromUrl = useCallback(async () => {
    try {
      const res = await fetch("/api/keys/export", { cache: "no-store" });
      const envelope = await res.json();
      setImportState((prev) => ({ ...(prev || {}), fileName: "current fleet export", envelope, plan: null, applied: null, error: "" }));
    } catch (error) {
      setImportState((prev) => ({ ...(prev || {}), error: error.message }));
    }
  }, []);

  const previewImport = useCallback(async () => {
    setImportState((prev) => (prev ? { ...prev, busy: true, error: "" } : prev));
    try {
      const plan = await importKeys(
        importState.envelope,
        { mode: "dry-run", onConflict: importState.onConflict }
      );
      setImportState((prev) => ({ ...prev, plan, applied: null, busy: false }));
    } catch (error) {
      setImportState((prev) => ({ ...prev, plan: null, busy: false, error: error.message }));
    }
  }, [importState]);

  const applyImport = useCallback(async () => {
    setImportState((prev) => (prev ? { ...prev, busy: true, error: "" } : prev));
    try {
      const applied = await importKeys(
        importState.envelope,
        { mode: "apply", onConflict: importState.onConflict }
      );
      // The show-once ceremony, N times: every key this import minted carries
      // its plaintext in THIS response and never again. Capturing them into the
      // browser vault here is the same act the single-key create path performs.
      for (const entry of applied?.applied?.created || []) {
        if (entry.keyId && entry.key) storeKey(entry.keyId, entry.key);
      }
      setImportState((prev) => ({ ...prev, applied, busy: false }));
      await refresh();
      const n = applied?.applied?.changed || 0;
      announce(n > 0 ? "ok" : "warn", n > 0 ? `${n} key${n === 1 ? "" : "s"} re-issued — save the new strings now` : "Nothing was imported");
    } catch (error) {
      setImportState((prev) => ({ ...prev, busy: false, error: error.message }));
    }
  }, [importState, refresh, announce]);

  return {
    // data
    stats,
    statsError,
    detailKey,
    // view state
    lens,
    setLens,
    query,
    setQuery,
    posture,
    setPosture,
    sortKey,
    setSortKey,
    sortDir,
    setSortDir,
    // derived
    visibleKeys,
    postureById,
    postureCounts,
    railCounts,
    categories,
    activeCategoryFilter,
    setActiveCategoryFilter,
    // selection
    selected,
    toggleSelect,
    selectMany,
    clearSelection,
    selectAllVisible: () => selectMany(visibleKeys.map((k) => k.id), true),
    // detail
    detailId,
    openDetail: setDetailId,
    closeDetail: () => setDetailId(null),
    // mutations
    busy,
    setActive,
    revoke,
    setCategory,
    applyLimits,
    // create / edit stay single-sourced in the controller's modals
    openCreateModal,
    openEditKey,
    // the file pair
    exportFleet,
    importState,
    openImport,
    closeImport,
    loadImportFile,
    loadImportFromUrl,
    previewImport,
    applyImport,
    setImportState,
    // shared plumbing
    usagePeriod,
    setUsagePeriod,
    keyUsage,
    copy,
    copied,
    notice,
    setNotice,
    refresh,
  };
}
