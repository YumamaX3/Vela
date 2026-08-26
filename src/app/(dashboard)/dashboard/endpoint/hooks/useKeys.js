"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { storeKey, getKey, hasKey, removeKey } from "@/shared/utils/keyVault";
import {
  listKeys,
  createKey,
  updateKey,
  deleteKey,
  keyAction,
  duplicateKey,
  reviveKey,
  testKey,
  fetchKeyUsage,
  fetchKeyHealth,
  fetchKeyActivity,
  fetchCombosCatalog,
  exportKeySettings,
  importKeySettings,
} from "../lib/keyApi";
import { limitsFromRecord, DEFAULT_LIMITS, UNCATEGORIZED, categoryOf } from "../lib/keyFormat";
import { toggleIdInList } from "../lib/bulk";

// Dedup guard for auto-provisioning the first "Default Key". Module scope so it
// survives re-mounts within a session (StrictMode double-invoke). The flag is
// set synchronously before the first await, so of two concurrent callers only
// the first reaches the POST — the other sees the flag and waits.
let provisioningDefaultKey = false;

const AUTO_PROVISION_LIMITS = Object.freeze({
  rateLimitRpm: 60,
  tokenBudget: 1_000_000,
  budgetScope: "daily",
  spendCapCents: null,
  expiresAt: null,
  ipAllowlist: null,
});

// Build the full keyApi payload from the shared editor shape (limits) + the
// scope toggle — the exact wire contract the repo's whitelist expects.
// ACL arrays are tri-state: null = unrestricted, [] = deny, ["x"] = whitelist.
function keyPayload({ name, description, category, scopeOn, allowedModels, allowedKinds, allowedProviders, allowedCombos, limits, isActive, action }) {
  const L = limits || DEFAULT_LIMITS;
  const body = {
    name: name?.trim(),
    description: description || undefined,
    category: category?.trim() || null,
    allowedModels: scopeOn ? allowedModels : null,
    allowedKinds: allowedKinds ?? null,
    allowedProviders: allowedProviders ?? null,
    allowedCombos: allowedCombos ?? null,
    rateLimitRpm: L.rateLimitRpm,
    tokenBudgetDaily: L.tokenBudget,
    spendCapDailyCents: L.spendCapCents,
    budgetScope: (L.tokenBudget != null || L.spendCapCents != null) ? (L.budgetScope || "daily") : null,
    expiresAt: L.expiresAt,
    ipAllowlist: L.ipAllowlist?.length ? L.ipAllowlist : null,
  };
  if (isActive !== undefined) body.isActive = isActive;
  if (action) body.action = action;
  return body;
}

export function useKeys() {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [keyUsage, setKeyUsage] = useState({});
  const [health, setHealth] = useState({ keys: {}, sweep: [] });
  const [usagePeriod, setUsagePeriod] = useState("all");
  const [activeCategoryFilter, setActiveCategoryFilter] = useState("all");
  const [combos, setCombos] = useState([]);
  const [keyActivity, setKeyActivity] = useState({}); // { [keyId]: activity[] }
  const [activityLoading, setActivityLoading] = useState(false);

  // Create-form state
  const [showAddModal, setShowAddModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyDescription, setNewKeyDescription] = useState("");
  const [newKeyCategory, setNewKeyCategory] = useState("");
  const [newKeyScopeOn, setNewKeyScopeOn] = useState(false);
  const [newKeyScope, setNewKeyScope] = useState([]);
  // Tri-state ACL defaults: null = unrestricted. The gate treats an empty
  // array as deny-all, so the "no chips touched" state MUST be null — an
  // accidental [] would silently lock the key out of every kind/provider/combo.
  const [newKeyKinds, setNewKeyKinds] = useState(null);
  const [newKeyProviders, setNewKeyProviders] = useState(null);
  const [newKeyCombos, setNewKeyCombos] = useState(null);
  const [createLimits, setCreateLimits] = useState(DEFAULT_LIMITS);
  const [createError, setCreateError] = useState("");
  const [createdKey, setCreatedKey] = useState(null); // { key, keyId, keyPrefix, record } — one-time show
  const [createdKeyAck, setCreatedKeyAck] = useState(false);

  // Edit-form state
  const [editingKey, setEditingKey] = useState(null); // draft: { id, name, ..., limits, saving, error }
  const [scopePickerFor, setScopePickerFor] = useState(null); // "create" | "edit"

  // Drawer + actions
  const [activeKeyId, setActiveKeyId] = useState(null); // detail drawer
  const [confirmState, setConfirmState] = useState(null); // ConfirmModal
  const [rotatedResult, setRotatedResult] = useState(null); // one-time show for the new key
  const [rotatedAck, setRotatedAck] = useState(false);
  const [testResult, setTestResult] = useState(null); // { keyId, ok, message, status, duration }
  const [busyId, setBusyId] = useState(null); // which row is mid-action (rotate/test)

  // Bulk selection
  const [selected, setSelected] = useState([]);
  const [bulkCategory, setBulkCategory] = useState("");
  const [showBulkCategoryModal, setShowBulkCategoryModal] = useState(false);
  const [bulkNotice, setBulkNotice] = useState("");

  const [activeProviders, setActiveProviders] = useState([]);
  const [modelAliases, setModelAliases] = useState({});

  const fetchData = useCallback(async () => {
    try {
      let existing = await listKeys();
      // Auto-provision a default key for first-time users (show-once capture).
      if (existing.length === 0 && !provisioningDefaultKey) {
        provisioningDefaultKey = true;
        try {
          const res = await createKey({
            name: "Default Key",
            rateLimitRpm: AUTO_PROVISION_LIMITS.rateLimitRpm,
            tokenBudgetDaily: AUTO_PROVISION_LIMITS.tokenBudget,
            budgetScope: AUTO_PROVISION_LIMITS.budgetScope,
          });
          if (res.ok && res.created?.key && res.created?.keyId) {
            storeKey(res.created.keyId, res.created.key);
            setCreatedKey(res.created);
            setCreatedKeyAck(false);
            existing = await listKeys();
          }
        } catch {
          /* fall through to empty render */
        } finally {
          provisioningDefaultKey = false;
        }
      }
      setKeys(existing);
    } catch {
      /* fail-open: empty list */
    } finally {
      setLoading(false);
    }
  }, []);

  const loadUsage = useCallback(async (period) => {
    const byKey = await fetchKeyUsage(period);
    setKeyUsage(byKey);
  }, []);

  const loadHealth = useCallback(async () => {
    const h = await fetchKeyHealth();
    setHealth(h);
  }, []);

  const loadCatalog = useCallback(async () => {
    try {
      const res = await fetch("/api/providers");
      setActiveProviders(res.ok ? ((await res.json()).connections || []) : []);
    } catch {
      setActiveProviders([]);
    }
    try {
      const res = await fetch("/api/models/alias");
      setModelAliases(res.ok ? ((await res.json()).aliases || {}) : {});
    } catch {
      setModelAliases({});
    }
    try {
      const catalog = await fetchCombosCatalog();
      setCombos(catalog.map((c) => c.name).filter(Boolean));
    } catch {
      setCombos([]);
    }
  }, []);

  // Load one key's recent-request micro-history for the drawer. Fired lazily
  // when the drawer opens; results are cached per key for the session. The
  // cache check lives inside the functional setter so this callback has a
  // stable identity ([] deps) — a keyActivity dependency would re-fire every
  // time activity arrives.
  const loadKeyActivity = useCallback(async (id) => {
    if (!id) return;
    setActivityLoading(true);
    try {
      const activity = await fetchKeyActivity(id);
      setKeyActivity((prev) => (prev[id] ? prev : { ...prev, [id]: activity }));
    } catch {
      /* fail-open: empty activity */
    } finally {
      setActivityLoading(false);
    }
  }, []);

  // Initial load + per-key usage on window change + health snapshot.
  useEffect(() => {
    fetchData();
    loadCatalog();
  }, [fetchData, loadCatalog]);
  useEffect(() => {
    loadUsage(usagePeriod);
  }, [usagePeriod, keys, loadUsage]);
  useEffect(() => {
    loadHealth();
  }, [loadHealth]);

  const categories = useMemo(() => {
    const seen = new Set();
    for (const k of keys) if (k.category) seen.add(k.category);
    return [...seen];
  }, [keys]);

  // Keys under the active filter; falling back to "all" when a filtered
  // category's last key is deleted (never render a dead chip's empty list).
  const filteredKeys = useMemo(() => {
    if (activeCategoryFilter === "all") return keys;
    const matched = keys.filter((k) => categoryOf(k) === activeCategoryFilter);
    return matched.length ? matched : keys;
  }, [keys, activeCategoryFilter]);

  // ── Create flow ─────────────────────────────────────────────────────────
  const resetCreateForm = useCallback(() => {
    setNewKeyName("");
    setNewKeyDescription("");
    setNewKeyCategory("");
    setNewKeyScopeOn(false);
    setNewKeyScope([]);
    setNewKeyKinds(null);
    setNewKeyProviders(null);
    setNewKeyCombos(null);
    setCreateLimits(DEFAULT_LIMITS);
    setCreateError("");
  }, []);

  const openCreateModal = useCallback(() => {
    resetCreateForm();
    setShowAddModal(true);
  }, [resetCreateForm]);

  const closeCreatedKeyModal = useCallback(() => {
    setCreatedKey(null);
    setCreatedKeyAck(false);
  }, []);

  const handleCreateKey = useCallback(async () => {
    if (!newKeyName.trim()) return;
    setCreateError("");
    const res = await createKey(keyPayload({
      name: newKeyName,
      description: newKeyDescription,
      category: newKeyCategory,
      scopeOn: newKeyScopeOn,
      allowedModels: newKeyScope,
      allowedKinds: newKeyKinds,
      allowedProviders: newKeyProviders,
      allowedCombos: newKeyCombos,
      limits: createLimits,
    }));
    if (res.ok) {
      // Capture-at-create: this 201 is the only plaintext copy the server ever yields.
      if (res.created?.key && res.created?.keyId) storeKey(res.created.keyId, res.created.key);
      setCreatedKey(res.created);
      setCreatedKeyAck(false);
      setShowAddModal(false);
      resetCreateForm();
      await fetchData();
    } else {
      setCreateError(res.error);
    }
  }, [newKeyName, newKeyDescription, newKeyCategory, newKeyScopeOn, newKeyScope, newKeyKinds, newKeyProviders, newKeyCombos, createLimits, fetchData, resetCreateForm]);

  // ── Edit flow ───────────────────────────────────────────────────────────
  const openEditKey = useCallback((key) => {
    setEditingKey({
      id: key.id,
      name: key.name || "",
      description: key.description || "",
      category: key.category || "",
      allowedModels: Array.isArray(key.allowedModels) ? key.allowedModels : [],
      scopeOn: Array.isArray(key.allowedModels) && key.allowedModels.length > 0,
      // Tri-state ACL draft: null = unrestricted, [] = deny, ["x"] = whitelist.
      // A stored NULL means "no restriction set" — it must NOT seed an empty
      // array, which the gate reads as deny-all and would silently lock the
      // key out of every kind/provider/combo when re-saved.
      allowedKinds: Array.isArray(key.allowedKinds) ? key.allowedKinds : null,
      allowedProviders: Array.isArray(key.allowedProviders) ? key.allowedProviders : null,
      allowedCombos: Array.isArray(key.allowedCombos) ? key.allowedCombos : null,
      limits: limitsFromRecord(key),
      saving: false,
      error: "",
    });
  }, []);

  const handleSaveKey = useCallback(async () => {
    if (!editingKey) return;
    if (!editingKey.name.trim()) return;
    setEditingKey((prev) => ({ ...prev, saving: true, error: "" }));
    const res = await updateKey(editingKey.id, keyPayload({
      name: editingKey.name,
      description: editingKey.description,
      category: editingKey.category,
      scopeOn: editingKey.scopeOn,
      allowedModels: editingKey.allowedModels,
      allowedKinds: editingKey.allowedKinds,
      allowedProviders: editingKey.allowedProviders,
      allowedCombos: editingKey.allowedCombos,
      limits: editingKey.limits,
    }));
    if (res.ok) {
      setEditingKey(null);
      await fetchData();
    } else {
      setEditingKey((prev) => ({ ...prev, saving: false, error: res.error || "Failed to save key" }));
    }
  }, [editingKey, fetchData]);

  // ── Toggle / pause / resume ─────────────────────────────────────────────
  const handleToggleKey = useCallback(async (id, isActive) => {
    const res = await updateKey(id, { isActive });
    if (res.ok) {
      setKeys((prev) => prev.map((k) => (k.id === id ? { ...k, isActive } : k)));
    }
  }, []);

  const requestPauseKey = useCallback((key) => {
    setConfirmState({
      title: "Pause API Key",
      message: `Pause API key "${key.name}"?\n\nThis key will stop working immediately but can be resumed later.`,
      onConfirm: async () => {
        setConfirmState(null);
        await handleToggleKey(key.id, false);
      },
    });
  }, [handleToggleKey]);

  const handleRotateKey = useCallback(async (id) => {
    setBusyId(id);
    try {
      const res = await keyAction(id, "rotate");
      if (res.ok) {
        const fresh = res.key;
        if (fresh?.id && fresh?.key) {
          storeKey(fresh.id, fresh.key);
          setRotatedResult(fresh);
          setRotatedAck(false);
        }
        await fetchData();
        if (activeKeyId === id) setActiveKeyId(null); // the old id is gone
      } else {
        setConfirmState({
          title: "Rotate failed",
          message: res.error || "Failed to rotate key",
          confirmText: "OK",
          variant: "secondary",
          onConfirm: () => setConfirmState(null),
        });
      }
    } finally {
      setBusyId(null);
    }
  }, [activeKeyId, fetchData]);

  const requestRotateKey = useCallback((key) => {
    setConfirmState({
      title: "Rotate API Key",
      message: `Rotate API key "${key.name}"?\n\nThe current key will be revoked immediately and a new one minted in its place. Old tokens stop working now — the new key is shown once (and captured to this browser's vault).`,
      onConfirm: () => {
        setConfirmState(null);
        handleRotateKey(key.id);
      },
    });
  }, [handleRotateKey]);

  // ── Duplicate ───────────────────────────────────────────────────────────
  const handleDuplicateKey = useCallback(async (key) => {
    const res = await duplicateKey(key.id);
    if (res.ok) {
      if (res.created?.key && res.created?.keyId) storeKey(res.created.keyId, res.created.key);
      setCreatedKey(res.created);
      setCreatedKeyAck(false);
      await fetchData();
    } else {
      setConfirmState({
        title: "Duplicate failed",
        message: res.error || "Failed to duplicate key",
        confirmText: "OK",
        variant: "secondary",
        onConfirm: () => setConfirmState(null),
      });
    }
  }, [fetchData]);

  // ── Revive (tombstoned legacy key) ──────────────────────────────────────
  // A revoked row's secret was purged by governance — it can never come back.
  // Revive mints a FRESH working key under the same name (never a re-issue),
  // then deletes the tombstone. Same show-once flow as create/duplicate.
  const handleReviveKey = useCallback(async (key) => {
    setBusyId(key.id);
    const res = await reviveKey(key.id);
    setBusyId(null);
    if (res.ok) {
      if (res.created?.key && res.created?.keyId) storeKey(res.created.keyId, res.created.key);
      setCreatedKey(res.created);
      setCreatedKeyAck(false);
      await fetchData();
    } else {
      setConfirmState({
        title: "Revive failed",
        message: res.error || "Failed to revive key",
        confirmText: "OK",
        variant: "secondary",
        onConfirm: () => setConfirmState(null),
      });
    }
  }, [fetchData]);

  // ── Test ────────────────────────────────────────────────────────────────
  const handleTestKey = useCallback(async (key) => {
    setBusyId(key.id);
    setTestResult({ keyId: key.id, pending: true });
    const res = await testKey(key.id);
    setTestResult({ keyId: key.id, ...res });
    setBusyId(null);
  }, []);

  // ── Delete ──────────────────────────────────────────────────────────────
  const handleDeleteKey = useCallback(async (id) => {
    const res = await deleteKey(id);
    if (res) {
      removeKey(id); // purge the captured copy alongside the server-side revoke
      setKeys((prev) => prev.filter((k) => k.id !== id));
      setSelected((prev) => prev.filter((x) => x !== id));
      if (activeKeyId === id) setActiveKeyId(null);
    }
  }, [activeKeyId]);

  const requestDeleteKey = useCallback((key) => {
    setConfirmState({
      title: "Delete API Key",
      message: `Delete API key "${key.name}"?\n\nRequests using it will be rejected immediately. The audit row remains, but the key itself can never be recovered.`,
      onConfirm: async () => {
        setConfirmState(null);
        await handleDeleteKey(key.id);
      },
    });
  }, [handleDeleteKey]);

  // ── Expire / renew ──────────────────────────────────────────────────────
  const handleExpireKey = useCallback(async (key) => {
    const res = await updateKey(key.id, { expiresAt: new Date().toISOString() });
    if (res.ok) await fetchData();
  }, [fetchData]);

  const handleRenewKey = useCallback(async (key) => {
    const res = await updateKey(key.id, { expiresAt: null });
    if (res.ok) await fetchData();
  }, [fetchData]);

  // ── Sweep revoke (actionable stale-key cleanup) ─────────────────────────
  const handleSweepRevoke = useCallback(async (id) => {
    const res = await deleteKey(id);
    if (res) {
      removeKey(id);
      setKeys((prev) => prev.filter((k) => k.id !== id));
      setSelected((prev) => prev.filter((x) => x !== id));
      return true;
    }
    return false;
  }, []);

  const handleSweepRevokeAll = useCallback(async (sweepList) => {
    if (!Array.isArray(sweepList) || sweepList.length === 0) return 0;
    let revoked = 0;
    for (const s of sweepList) {
      const ok = await handleSweepRevoke(s.id);
      if (ok) revoked += 1;
    }
    return revoked;
  }, [handleSweepRevoke]);

  // ── Bulk ────────────────────────────────────────────────────────────────
  // NOTE: select-all is scoped to the FILTERED rows in KeysTable — the table
  // passes the visible ids up via setAllSelected. This full-list variant stays
  // for the no-filter case (KeysTable falls back to it through the same call).
  const allSelected = useMemo(() => keys.length > 0 && selected.length === keys.length, [keys, selected]);

  const setAllSelected = useCallback((ids) => {
    setSelected(Array.isArray(ids) ? ids : ids ? keys.map((k) => k.id) : []);
  }, [keys]);

  const toggleSelected = useCallback((id) => {
    setSelected((prev) => toggleIdInList(prev, id));
  }, []);

  const bulkPause = useCallback(async () => {
    for (const id of selected) await handleToggleKey(id, false);
    setBulkNotice(`Paused ${selected.length} key(s)`);
  }, [selected, handleToggleKey]);

  const bulkResume = useCallback(async () => {
    for (const id of selected) await handleToggleKey(id, true);
    setBulkNotice(`Resumed ${selected.length} key(s)`);
  }, [selected, handleToggleKey]);

  const bulkSetCategory = useCallback(async (category) => {
    const clean = category?.trim() || null;
    for (const id of selected) {
      const res = await updateKey(id, { category: clean });
      if (res.ok) {
        setKeys((prev) => prev.map((k) => (k.id === id ? { ...k, category: clean } : k)));
      }
    }
    setBulkNotice(clean ? `Categorized ${selected.length} key(s) as "${clean}"` : `Cleared category on ${selected.length} key(s)`);
    setShowBulkCategoryModal(false);
    setSelected([]);
  }, [selected]);

  const bulkExport = useCallback(async () => {
    const data = await exportKeySettings();
    if (!data || !Array.isArray(data.keys)) {
      setBulkNotice("Export failed — no key settings available");
      return;
    }
    const blob = new Blob([JSON.stringify({ app: "vela", version: 1, keys: data.keys }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vela-key-settings.json";
    a.click();
    URL.revokeObjectURL(url);
    setBulkNotice(`Exported ${data.keys.length} key setting(s) — no secrets included`);
  }, []);

  const bulkDelete = useCallback(() => {
    if (!selected.length) return;
    const count = selected.length;
    setConfirmState({
      title: "Delete selected keys",
      message: `Delete ${count} selected key(s)?\n\nRequests using them will be rejected immediately. The audit rows remain, but the keys themselves can never be recovered.`,
      onConfirm: async () => {
        setConfirmState(null);
        for (const id of selected) {
          const ok = await deleteKey(id);
          if (ok) removeKey(id);
        }
        setKeys((prev) => prev.filter((k) => !selected.includes(k.id)));
        setSelected([]);
        setBulkNotice(`Deleted ${count} key(s)`);
      },
    });
  }, [selected]);

  const clearBulkNotice = useCallback(() => setBulkNotice(""), []);

  // ── Grouped scope picker (shared by create + edit forms) ────────────────
  const scopeValue = useCallback((model) => model?.value || model?.name || model, []);
  const handleScopeSelect = useCallback((model) => {
    const value = scopeValue(model);
    if (!value) return;
    if (scopePickerFor === "create") {
      setNewKeyScope((prev) => (prev.includes(value) ? prev : [...prev, value]));
    } else {
      setEditingKey((prev) => (prev && !prev.allowedModels.includes(value)
        ? { ...prev, allowedModels: [...prev.allowedModels, value] }
        : prev));
    }
  }, [scopePickerFor, scopeValue]);

  const handleScopeDeselect = useCallback((model) => {
    const value = scopeValue(model);
    if (scopePickerFor === "create") {
      setNewKeyScope((prev) => prev.filter((x) => x !== value));
    } else {
      setEditingKey((prev) => (prev ? { ...prev, allowedModels: prev.allowedModels.filter((x) => x !== value) } : prev));
    }
  }, [scopePickerFor, scopeValue]);

  return {
    // data
    keys, loading, keyUsage, health, usagePeriod, setUsagePeriod,
    activeCategoryFilter, setActiveCategoryFilter, categories, filteredKeys,
    activeProviders, modelAliases, combos, keyActivity, activityLoading, loadKeyActivity,
    // create
    showAddModal, setShowAddModal, openCreateModal, resetCreateForm,
    newKeyName, setNewKeyName, newKeyDescription, setNewKeyDescription,
    newKeyCategory, setNewKeyCategory, newKeyScopeOn, setNewKeyScopeOn,
    newKeyScope, setNewKeyScope, newKeyKinds, setNewKeyKinds,
    newKeyProviders, setNewKeyProviders, newKeyCombos, setNewKeyCombos,
    createLimits, setCreateLimits, createError,
    createdKey, createdKeyAck, setCreatedKeyAck, closeCreatedKeyModal,
    handleCreateKey,
    // edit
    editingKey, setEditingKey, openEditKey, handleSaveKey,
    scopePickerFor, setScopePickerFor, handleScopeSelect, handleScopeDeselect,
    // drawer + actions
    activeKeyId, setActiveKeyId, requestPauseKey, requestRotateKey, requestDeleteKey,
    handleToggleKey, handleRotateKey, handleDuplicateKey, handleReviveKey, handleTestKey, handleExpireKey, handleRenewKey,
    rotatedResult, rotatedAck, setRotatedAck, setRotatedResult, testResult, setTestResult,
    busyId, confirmState, setConfirmState,
    // vault helpers for rows/drawer
    hasKey, getKey, forgetKey: removeKey,
    // bulk
    selected, setSelected, allSelected, setAllSelected, toggleSelected, bulkPause, bulkResume,
    bulkSetCategory, bulkExport, bulkDelete, bulkCategory, setBulkCategory,
    showBulkCategoryModal, setShowBulkCategoryModal, bulkNotice, clearBulkNotice,
    // sweep revoke (actionable stale-key cleanup)
    handleSweepRevoke, handleSweepRevokeAll,
    // shared fetchers
    fetchData, loadUsage,
  };
}
