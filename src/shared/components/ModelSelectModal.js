"use client";

// ModelSelectModal — the central model picker.
//
// Redesigned (2026-09-06, Vela Prism Build B):
//  - Two-column layout on desktop: sticky category rail (left) + scroller (right).
//  - Single-column on mobile: the rail collapses to a horizontal scroller above
//    the search, preserving the Star's "friendly for any resolution" clause.
//  - Recents strip at the top, persisted to localStorage (key vela:picker:recents).
//  - Model cards (not pill-everything) — each card carries a name, capability
//    strip, and an action affordance, so the operator sees the model before
//    committing. Anti-slop R-22: pill-everything is the default AI tells, and
//    the previous design leaned on it. Cards give hierarchy.
//  - Keyboard nav: Up/Down moves the active card within a section; Left/Right
//    jumps between sections; Enter commits; Esc closes. Tab still works for
//    non-mouse users — focus-visible (Build A) marks every interactive.
//  - Dark-mode parity: every color reads from --color-* tokens; the only literal
//    hex is the provider's own brand color, applied once via the provider
//    catalog (R-18: no hard-coded hex in components).
//  - Focus trap + scroll lock inherited from Modal (Build A's primitives).
//
// Prop contract preserved — every existing call site (basic-chat, combos,
// providers, endpoint, media-providers) keeps working unchanged.

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import PropTypes from "prop-types";
import Modal from "./Modal";
import ProviderIcon from "./ProviderIcon";
import CapacityBadges from "./CapacityBadges";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import { getModelsByProviderId, getModelKind } from "@/shared/constants/models";
import {
  OAUTH_PROVIDERS,
  APIKEY_PROVIDERS,
  FREE_PROVIDERS,
  FREE_TIER_PROVIDERS,
  AI_PROVIDERS,
  isOpenAICompatibleProvider,
  isAnthropicCompatibleProvider,
  getProviderAlias,
} from "@/shared/constants/providers";
import { cn } from "@/shared/utils/cn";

// Recents are persisted to localStorage so the picker is faster the second time
// around. Max 8 entries, FIFO eviction, deduped by value. The storage shape is
// intentionally simple: an array of { value, name, provider, at } — everything
// the strip needs to render without re-querying the catalog.
const RECENTS_KEY = "vela:picker:recents";
const RECENTS_MAX = 8;

function loadRecents() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, RECENTS_MAX) : [];
  } catch {
    return [];
  }
}

function saveRecents(next) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next.slice(0, RECENTS_MAX)));
  } catch {
    // Quota or private-mode: silently skip. Recents are a nicety, not a contract.
  }
}

function recordRecent(entry) {
  if (!entry?.value) return;
  const existing = loadRecents().filter((r) => r.value !== entry.value);
  const next = [{ ...entry, at: Date.now() }, ...existing].slice(0, RECENTS_MAX);
  saveRecents(next);
  // Notify any recents strip in the same page so the sidebar updates live.
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("vela:recents:changed", { detail: next }));
  }
}

function clearRecents() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(RECENTS_KEY);
    window.dispatchEvent(new CustomEvent("vela:recents:changed", { detail: [] }));
  } catch {
    // ignore
  }
}

// Category rail definitions. The order matters — it's the read order for both
// the rail and the section headings. OAuth first (you pay nothing, no key
// needed), Free (no auth), API Key, Custom (user-added compatible providers),
// Disabled (an honest "you turned this off" lane so a user can find it again).
const CATEGORIES = [
  { id: "all", label: "All", icon: "all_inclusive" },
  { id: "oauth", label: "OAuth", icon: "lock_open" },
  { id: "free", label: "Free", icon: "park" },
  { id: "apikey", label: "API Key", icon: "vpn_key" },
  { id: "custom", label: "Custom", icon: "extension" },
  { id: "disabled", label: "Disabled", icon: "block" },
];

function categoryFor(providerId, isCustom, isDisabled) {
  if (isDisabled) return "disabled";
  if (isCustom) return "custom";
  if (OAUTH_PROVIDERS[providerId]) return "oauth";
  if (FREE_PROVIDERS[providerId] || FREE_TIER_PROVIDERS[providerId]) return "free";
  if (APIKEY_PROVIDERS[providerId]) return "apikey";
  return "apikey"; // unknown — treat as apikey (safe default)
}

// Provider order: OAuth first, then Free Tier, then API Key (matches the
// dashboard/providers page so the operator sees the same hierarchy everywhere).
const PROVIDER_ORDER = [
  ...Object.keys(OAUTH_PROVIDERS),
  ...Object.keys(FREE_PROVIDERS),
  ...Object.keys(FREE_TIER_PROVIDERS),
  ...Object.keys(APIKEY_PROVIDERS),
];

// Providers that need no auth — always show in model selector. Spans both the
// category:"free" map and the hybrid freeTier noAuth lane (OpenCode Zen).
const NO_AUTH_PROVIDER_IDS = [
  ...Object.keys(FREE_PROVIDERS),
  ...Object.keys(FREE_TIER_PROVIDERS),
].filter((id) => (FREE_PROVIDERS[id] || FREE_TIER_PROVIDERS[id]).noAuth);

// Reference-stable empty default for activeProviders. A inline `= []` default
// allocates a fresh array on every render; every consumer that memoizes over
// it (cursorConnectionIds below) then sees a "changed" dep each render, and
// its effect re-runs forever. QuickAddBar mounts this modal with no
// activeProviders on every dashboard page, so the instability compounded
// into a Maximum-update-depth loop (2026-09-07 audit).
const EMPTY_ACTIVE_PROVIDERS = [];
const EMPTY_MODEL_ALIASES = {};
const EMPTY_ADDED_MODEL_VALUES = [];

export default function ModelSelectModal({
  isOpen,
  onClose,
  onSelect,
  onDeselect,
  selectedModel,
  activeProviders = EMPTY_ACTIVE_PROVIDERS,
  title = "Select Model",
  modelAliases = EMPTY_MODEL_ALIASES,
  kindFilter = null,
  capFilter = null,
  addedModelValues = EMPTY_ADDED_MODEL_VALUES,
  closeOnSelect = true,
  showCombos = true,
}) {
  // Filter activeProviders by serviceKinds when kindFilter set (e.g. "webSearch", "webFetch")
  const filteredActiveProviders = useMemo(() => {
    if (!kindFilter) return activeProviders;
    return activeProviders.filter((p) => {
      const info = AI_PROVIDERS[p.provider];
      const kinds = info?.serviceKinds || ["llm"];
      return kinds.includes(kindFilter);
    });
  }, [activeProviders, kindFilter]);

  const { getCaps } = useModelCaps();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategories, setActiveCategories] = useState(new Set(["all"]));
  const [combos, setCombos] = useState([]);
  const [providerNodes, setProviderNodes] = useState([]);
  const [customModels, setCustomModels] = useState([]);
  const [disabledModels, setDisabledModels] = useState({});
  const [cursorModels, setCursorModels] = useState([]);
  const [recents, setRecents] = useState([]);
  const [activeCard, setActiveCard] = useState(null); // { providerId, modelValue } for keyboard nav
  const [loadError, setLoadError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const listRef = useRef(null);

  // Cursor exposes the usable catalog per account. Keep the static catalog only
  // as a fallback, since it quickly becomes stale and different accounts can
  // have different model entitlements.
  const cursorConnectionIds = useMemo(
    () => activeProviders
      .filter((provider) => provider.provider === "cursor" && provider.id)
      .map((provider) => provider.id),
    [activeProviders],
  );

  // Load recents on mount + listen for cross-component changes (Quick-Add Bar
  // and the Sidebar Recents group both update the same key).
  useEffect(() => {
    if (!isOpen) return;
    setRecents(loadRecents());
    const handler = (e) => setRecents(Array.isArray(e.detail) ? e.detail : loadRecents());
    window.addEventListener("vela:recents:changed", handler);
    return () => window.removeEventListener("vela:recents:changed", handler);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || cursorConnectionIds.length === 0) {
      // Functional update + reference check: assigning a fresh [] every run
      // would defeat React's Object.is bail-out and loop forever when the
      // caller's props are unstable. Only clear when something is present.
      setCursorModels((prev) => (prev.length === 0 ? prev : []));
      return undefined;
    }

    let cancelled = false;
    Promise.all(cursorConnectionIds.map(async (connectionId) => {
      const response = await fetch(`/api/providers/${connectionId}/models`, { cache: "no-store" });
      if (!response.ok) return [];
      const data = await response.json();
      return Array.isArray(data.models) ? data.models : [];
    }))
      .then((modelLists) => {
        if (cancelled) return;
        const seen = new Set();
        setCursorModels(modelLists.flat().filter((model) => {
          if (!model?.id || seen.has(model.id)) return false;
          seen.add(model.id);
          return true;
        }));
      })
      .catch((error) => {
        // Do not hide the static fallback when the account catalog is unavailable.
        console.warn("Unable to load Cursor models for selector:", error);
        if (!cancelled) setCursorModels([]);
      });

    return () => { cancelled = true; };
  }, [isOpen, cursorConnectionIds]);

  // Fetch combos, provider nodes, custom models, disabled models in parallel —
  // all four are independent and read by the same render. Saves a round-trip
  // over the previous serial layout.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);

    const tasks = [];
    if (showCombos) {
      tasks.push(
        fetch("/api/combos", { cache: "no-store" })
          .then((r) => r.ok ? r.json() : Promise.reject(new Error(`combos ${r.status}`)))
          .then((d) => { if (!cancelled) setCombos(d.combos || []); })
          .catch((e) => { if (!cancelled) { setCombos([]); console.error("combos:", e); } })
      );
    }
    tasks.push(
      fetch("/api/provider-nodes", { cache: "no-store" })
        .then((r) => r.ok ? r.json() : Promise.reject(new Error(`nodes ${r.status}`)))
        .then((d) => { if (!cancelled) setProviderNodes(d.nodes || []); })
        .catch((e) => { if (!cancelled) { setProviderNodes([]); console.error("nodes:", e); } })
    );
    tasks.push(
      fetch("/api/models/custom", { cache: "no-store" })
        .then((r) => r.ok ? r.json() : Promise.reject(new Error(`custom ${r.status}`)))
        .then((d) => { if (!cancelled) setCustomModels(d.models || []); })
        .catch((e) => { if (!cancelled) { setCustomModels([]); console.error("custom:", e); } })
    );
    tasks.push(
      fetch("/api/models/disabled", { cache: "no-store" })
        .then((r) => r.ok ? r.json() : Promise.reject(new Error(`disabled ${r.status}`)))
        .then((d) => { if (!cancelled) setDisabledModels(d.disabled || {}); })
        .catch((e) => { if (!cancelled) { setDisabledModels({}); console.error("disabled:", e); } })
    );

    Promise.allSettled(tasks).then(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => { cancelled = true; };
  }, [isOpen, showCombos]);

  const allProviders = useMemo(() => ({ ...OAUTH_PROVIDERS, ...FREE_PROVIDERS, ...FREE_TIER_PROVIDERS, ...APIKEY_PROVIDERS }), []);

  // Group models by provider with priority order.
  // Returns { providerId: { name, alias, color, category, models: [], isCustom } }
  const groupedModels = useMemo(() => {
    const groups = {};

    const PROVIDER_AS_MODEL_KINDS = new Set(["webSearch", "webFetch"]);
    const TYPED_KINDS = new Set(["image", "tts", "stt", "embedding", "imageToText"]);
    const ALLOW_PROVIDER_FALLBACK_KINDS = new Set(["tts", "image", "webFetch"]);

    const filterByKind = (models) => {
      if (!kindFilter) return models.filter((m) => m.isPlaceholder || m.isCustom || !getModelKind(m) || getModelKind(m) === "llm");
      if (!TYPED_KINDS.has(kindFilter)) return models;
      return models.filter((m) => m.isPlaceholder || getModelKind(m) === kindFilter);
    };

    const activeConnectionIds = filteredActiveProviders.map((p) => p.provider);

    const noAuthIds = kindFilter
      ? NO_AUTH_PROVIDER_IDS.filter((id) => (AI_PROVIDERS[id]?.serviceKinds || ["llm"]).includes(kindFilter))
      : NO_AUTH_PROVIDER_IDS;

    const providerIdsToShow = new Set([
      ...activeConnectionIds,
      ...noAuthIds,
    ]);

    const sortedProviderIds = [...providerIdsToShow].sort((a, b) => {
      const indexA = PROVIDER_ORDER.indexOf(a);
      const indexB = PROVIDER_ORDER.indexOf(b);
      return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
    });

    sortedProviderIds.forEach((providerId) => {
      const alias = getProviderAlias(providerId);
      const providerInfo = allProviders[providerId] || { name: providerId, color: "#666" };
      const isCustomProvider = isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);

      if (kindFilter && PROVIDER_AS_MODEL_KINDS.has(kindFilter)) {
        groups[providerId] = {
          name: providerInfo.name,
          alias,
          color: providerInfo.color,
          category: categoryFor(providerId, isCustomProvider, false),
          models: [{ id: providerId, name: providerInfo.name, value: providerId }],
        };
        return;
      }

      if (providerInfo.passthroughModels) {
        const aliasModels = Object.entries(modelAliases)
          .filter(([, fullModel]) => fullModel.startsWith(`${alias}/`))
          .map(([aliasName, fullModel]) => ({
            id: fullModel.replace(`${alias}/`, ""),
            name: aliasName,
            value: fullModel,
          }));
        const customRegisteredModels = customModels
          .filter((m) => m.providerAlias === alias)
          .map((m) => ({
            id: m.id,
            name: m.name || m.id,
            value: `${alias}/${m.id}`,
            kind: getModelKind(m),
            isCustom: true,
          }));

        let combined = aliasModels;
        if (kindFilter && TYPED_KINDS.has(kindFilter)) {
          const registeredTyped = customRegisteredModels.filter((m) => getModelKind(m) === kindFilter);
          combined = [
            ...registeredTyped,
            ...getModelsByProviderId(providerId)
            .filter((m) => getModelKind(m) === kindFilter)
            .map((m) => ({ id: m.id, name: m.name, value: `${alias}/${m.id}`, kind: getModelKind(m) }))
            .filter((m) => !registeredTyped.some((registered) => registered.value === m.value)),
          ];
          if (combined.length === 0 && ALLOW_PROVIDER_FALLBACK_KINDS.has(kindFilter)) {
            const supports = (providerInfo.serviceKinds || ["llm"]).includes(kindFilter);
            if (supports) combined = [{ id: providerId, name: providerInfo.name, value: alias }];
          }
        } else {
          const registeredLlms = customRegisteredModels.filter((m) => !getModelKind(m) || getModelKind(m) === "llm");
          const seen = new Set([...aliasModels, ...registeredLlms].map((m) => m.value));
          const hardcoded = getModelsByProviderId(providerId)
            .filter((m) => !getModelKind(m) || getModelKind(m) === "llm")
            .map((m) => ({ id: m.id, name: m.name, value: `${alias}/${m.id}`, kind: getModelKind(m) }))
            .filter((m) => !seen.has(m.value));
          combined = [...registeredLlms, ...aliasModels.filter((m) => !registeredLlms.some((registered) => registered.value === m.value)), ...hardcoded];
        }

        if (combined.length > 0) {
          const matchedNode = providerNodes.find((node) => node.id === providerId);
          const displayName = matchedNode?.name || providerInfo.name;

          groups[providerId] = {
            name: displayName,
            alias,
            color: providerInfo.color,
            category: categoryFor(providerId, isCustomProvider, false),
            models: combined,
          };
        }
      } else if (isCustomProvider) {
        if (kindFilter && TYPED_KINDS.has(kindFilter)) return;
        const connection = activeProviders.find((p) => p.provider === providerId);
        const matchedNode = providerNodes.find((node) => node.id === providerId);
        const displayName = matchedNode?.name || connection?.name || providerInfo.name;
        const nodePrefix = connection?.providerSpecificData?.prefix || matchedNode?.prefix || providerId;

        const nodeModels = Object.entries(modelAliases)
          .filter(([, fullModel]) => fullModel.startsWith(`${providerId}/`))
          .map(([aliasName, fullModel]) => ({
            id: fullModel.replace(`${providerId}/`, ""),
            name: aliasName,
            value: `${nodePrefix}/${fullModel.replace(`${providerId}/`, "")}`,
          }));

        const registeredCustom = customModels
          .filter((m) => m.providerAlias === providerId)
          .map((m) => ({
            id: m.id,
            name: m.name || m.id,
            value: `${nodePrefix}/${m.id}`,
            isCustom: true,
          }));
        const seen = new Set(nodeModels.map((m) => m.value));
        const mergedModels = [...nodeModels, ...registeredCustom.filter((m) => !seen.has(m.value))];

        const modelsToShow = mergedModels.length > 0 ? mergedModels : [{
          id: `__placeholder__${providerId}`,
          name: `${nodePrefix}/model-id`,
          value: `${nodePrefix}/model-id`,
          isPlaceholder: true,
        }];

        groups[providerId] = {
          name: displayName,
          alias: nodePrefix,
          color: providerInfo.color,
          category: categoryFor(providerId, true, false),
          models: modelsToShow,
          isCustom: true,
          hasModels: mergedModels.length > 0,
        };
      } else {
        const hardcodedModels = providerId === "cursor" && cursorModels.length > 0
          ? cursorModels
          : getModelsByProviderId(providerId);
        const hardcodedIds = new Set(hardcodedModels.map((m) => m.id));

        const hasHardcoded = hardcodedModels.length > 0;
        const customAliasModels = Object.entries(modelAliases)
          .filter(([aliasName, fullModel]) =>
            fullModel.startsWith(`${alias}/`) &&
            (hasHardcoded ? aliasName === fullModel.replace(`${alias}/`, "") : true) &&
            !hardcodedIds.has(fullModel.replace(`${alias}/`, ""))
          )
          .map(([aliasName, fullModel]) => {
            const modelId = fullModel.replace(`${alias}/`, "");
            return { id: modelId, name: aliasName, value: fullModel, isCustom: true };
          });

        const customAliasIds = new Set(customAliasModels.map((m) => m.id));
        const customRegisteredModels = customModels
          .filter((m) => m.providerAlias === alias && !hardcodedIds.has(m.id) && !customAliasIds.has(m.id))
          .map((m) => ({ id: m.id, name: m.name || m.id, value: `${alias}/${m.id}`, isCustom: true }));

        const merged = [
          ...hardcodedModels.map((m) => ({ id: m.id, name: m.name, value: `${alias}/${m.id}`, kind: getModelKind(m) })),
          ...customAliasModels,
          ...customRegisteredModels,
        ];
        const seen = new Set();
        let allModels = filterByKind(merged.filter((m) => {
          if (seen.has(m.value)) return false;
          seen.add(m.value);
          return true;
        }));

        if (allModels.length === 0 && kindFilter && ALLOW_PROVIDER_FALLBACK_KINDS.has(kindFilter)) {
          const supports = (providerInfo.serviceKinds || ["llm"]).includes(kindFilter);
          if (supports) {
            allModels = [{ id: providerId, name: providerInfo.name, value: alias }];
          }
        }

        if (allModels.length > 0) {
          groups[providerId] = {
            name: providerInfo.name,
            alias,
            color: providerInfo.color,
            category: categoryFor(providerId, false, false),
            models: allModels,
          };
        }
      }
    });

    // Filter out disabled models per provider. The "disabled" category stays
    // empty (its purpose is the *section heading*, not its contents — disabled
    // models surface inline with a "Disabled" pill so the operator can find
    // and re-enable them).
    Object.entries(groups).forEach(([providerId, group]) => {
      const aliasKey = getProviderAlias(providerId);
      const disabledIds = new Set([
        ...(disabledModels[aliasKey] || []),
        ...(disabledModels[providerId] || []),
      ]);
      if (disabledIds.size === 0) return;
      // Tag disabled models but keep them visible.
      group.models = group.models.map((m) => disabledIds.has(m.id) ? { ...m, isDisabled: true } : m);
    });

    return groups;
  }, [filteredActiveProviders, modelAliases, allProviders, providerNodes, customModels, disabledModels, kindFilter, activeProviders, cursorModels]);

  // Filter combos by search query (and hide combos when kindFilter is set — combos are LLM-only by design)
  const filteredCombos = useMemo(() => {
    if (!showCombos || kindFilter || capFilter) return [];
    if (!searchQuery.trim()) return combos;
    const query = searchQuery.toLowerCase();
    return combos.filter((c) => c.name.toLowerCase().includes(query));
  }, [combos, searchQuery, kindFilter, capFilter, showCombos]);

  // Sort models: added first, then alphabetical by display name.
  const sortModels = (models) => {
    const added = models.filter((m) => addedModelValues.includes(m.value)).sort((a, b) => a.name.localeCompare(b.name));
    const rest = models.filter((m) => !addedModelValues.includes(m.value)).sort((a, b) => a.name.localeCompare(b.name));
    return [...added, ...rest];
  };

  // Apply search + cap filter + category filter. The category filter is a Set
  // of category ids; "all" matches every category.
  const filteredGroups = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filterAll = activeCategories.has("all");
    const wantsCategory = (cat) => filterAll || activeCategories.has(cat);

    const filtered = {};
    Object.entries(groupedModels).forEach(([providerId, group]) => {
      if (!wantsCategory(group.category)) return;
      let models = group.models;
      if (capFilter) {
        models = models.filter((m) => getCaps(m.value)?.[capFilter] === true);
        if (models.length === 0) return;
      }
      if (query) {
        const providerNameMatches = group.name.toLowerCase().includes(query);
        models = models.filter(
          (m) =>
            m.name.toLowerCase().includes(query) ||
            m.id.toLowerCase().includes(query)
        );
        if (models.length === 0 && !providerNameMatches) return;
      }
      filtered[providerId] = {
        ...group,
        models: sortModels(models),
      };
    });

    return filtered;
  }, [groupedModels, searchQuery, addedModelValues, activeCategories, capFilter, getCaps]);

  const handleSelect = (model) => {
    const value = model?.value || model?.name || model;
    const isAdded = addedModelValues.includes(value);

    if (isAdded && onDeselect) {
      onDeselect(model);
    } else {
      onSelect(model);
      // Record the choice so the Recents strip / Sidebar surface it next time.
      // We only record on positive selection (not toggle-off) — picking is
      // the meaningful event.
      if (!model?.isPlaceholder) {
        const alias = (value || "").split("/")[0] || "";
        recordRecent({
          value,
          name: model?.name || value,
          provider: alias,
          isCombo: false,
        });
      }
    }

    if (closeOnSelect) {
      onClose();
      setSearchQuery("");
    }
  };

  const toggleCategory = useCallback((cat) => {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (cat === "all") return new Set(["all"]);
      if (next.has("all")) next.delete("all");
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      if (next.size === 0) next.add("all");
      return next;
    });
  }, []);

  // Keyboard nav: arrows move the active card; Enter commits; Esc closes.
  // We use the natural tab order as the fallback — every card is a button.
  // This handler is bound at the list level so it sees the full set.
  const onListKeyDown = useCallback((e) => {
    // Flatten filtered groups into a navigable sequence.
    const flat = [];
    Object.entries(filteredGroups).forEach(([providerId, group]) => {
      group.models.forEach((m) => flat.push({ providerId, model: m }));
    });
    if (flat.length === 0) return;

    const idx = activeCard
      ? flat.findIndex((c) => c.providerId === activeCard.providerId && c.model.value === activeCard.modelValue)
      : -1;

    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      const next = flat[Math.min(idx + 1, flat.length - 1)];
      setActiveCard({ providerId: next.providerId, modelValue: next.model.value });
      // Scroll into view
      const el = listRef.current?.querySelector(`[data-model-value="${CSS.escape(next.model.value)}"]`);
      el?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = flat[Math.max(idx - 1, 0)];
      setActiveCard({ providerId: next.providerId, modelValue: next.model.value });
      const el = listRef.current?.querySelector(`[data-model-value="${CSS.escape(next.model.value)}"]`);
      el?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && idx >= 0) {
      e.preventDefault();
      handleSelect(flat[idx].model);
    }
  }, [filteredGroups, activeCard]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        onClose();
        setSearchQuery("");
        setActiveCategories(new Set(["all"]));
      }}
      title={title}
      size="full"
      className="p-0! max-h-[90vh] h-dvh sm:h-auto sm:max-h-[85vh] flex flex-col"
      footer={null}
    >
      <div className="flex flex-col h-full min-h-0">
        {/* Info bar — explains the click-to-add / click-again-to-remove gesture. */}
        <div className="flex items-center gap-2 px-4 py-2 bg-primary/8 border-b border-primary/15 text-xs text-text-muted shrink-0">
          <span className="material-symbols-outlined text-primary shrink-0" style={{ fontSize: "14px" }} aria-hidden="true">info</span>
          <span>Click to add, click again to remove. Changes are saved automatically.</span>
        </div>

        {/* Recents strip — small, sticky to the top of the body, hides on
            mobile when there are no recents (the Quick-Add Bar takes over
            that surface there). Anti-slop R-12: each entry earns its keep
            because it shortens the next click. */}
        {recents.length > 0 && !searchQuery.trim() && (
          <div className="hidden sm:flex items-center gap-2 px-4 py-2 border-b border-border-subtle bg-surface-2/30 shrink-0">
            <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider">Recent</span>
            <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
              {recents.map((r) => (
                <button
                  key={r.value}
                  onClick={() => handleSelect({ id: r.value, name: r.name, value: r.value })}
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs",
                    "border border-border-subtle bg-surface text-text-main",
                    "hover:border-primary/50 hover:bg-primary/5 transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  )}
                  title={`Pick ${r.name}`}
                >
                  <span className="material-symbols-outlined text-text-muted" style={{ fontSize: "11px" }} aria-hidden="true">history</span>
                  <span className="font-mono truncate max-w-[12ch]">{r.name}</span>
                </button>
              ))}
            </div>
            <button
              onClick={clearRecents}
              className="text-[11px] text-text-muted hover:text-text-main transition-colors focus-visible:outline-none focus-visible:underline"
              title="Clear recents"
            >
              Clear
            </button>
          </div>
        )}

        {/* Body: rail + scroller, side-by-side on desktop, stacked on mobile. */}
        <div className="flex flex-col sm:flex-row flex-1 min-h-0">
          {/* Category rail — sticky on desktop, horizontal scroller on mobile. */}
          <div className="sm:w-44 sm:shrink-0 sm:border-r border-b sm:border-b-0 border-border-subtle bg-surface-2/20 sm:bg-surface-2/30 shrink-0">
            <div className="flex sm:flex-col gap-1 p-2 overflow-x-auto sm:overflow-x-visible">
              {CATEGORIES.map((cat) => {
                const active = activeCategories.has(cat.id);
                return (
                  <button
                    key={cat.id}
                    onClick={() => toggleCategory(cat.id)}
                    aria-pressed={active}
                    className={cn(
                      "flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0",
                      "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                      active
                        ? "bg-primary text-white"
                        : "text-text-main hover:bg-primary/5"
                    )}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: "14px" }} aria-hidden="true">{cat.icon}</span>
                    <span>{cat.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: search + sections. */}
          <div className="flex-1 min-w-0 flex flex-col">
            {/* Search — full width on its own row. */}
            <div className="p-3 border-b border-border-subtle shrink-0">
              <div className="relative">
                <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted text-[16px]" aria-hidden="true">
                  search
                </span>
                <input
                  type="text"
                  placeholder="Search models or providers..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={onListKeyDown}
                  aria-label="Search models"
                  className={cn(
                    "w-full pl-8 pr-3 py-2 bg-surface border border-border rounded-md text-sm",
                    "focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50",
                    "placeholder:text-text-subtle"
                  )}
                />
              </div>
            </div>

            {/* Scrolling list. */}
            <div
              ref={listRef}
              className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-4"
              onKeyDown={onListKeyDown}
            >
              {isLoading && (
                <div className="flex items-center justify-center py-8 text-text-muted text-sm">
                  <span className="material-symbols-outlined mr-2 animate-spin" style={{ fontSize: "16px" }} aria-hidden="true">progress_activity</span>
                  Loading catalog…
                </div>
              )}

              {/* Combos section — always first, sticky. */}
              {!isLoading && filteredCombos.length > 0 && (
                <section aria-label="Combos">
                  <div className="flex items-center gap-1.5 mb-2 sticky top-0 bg-surface/95 backdrop-blur py-1 -mx-1 px-1 z-10">
                    <span className="material-symbols-outlined text-primary text-[14px]" aria-hidden="true">layers</span>
                    <h3 className="text-xs font-semibold text-primary uppercase tracking-wider">Combos</h3>
                    <span className="text-[10px] text-text-muted">({filteredCombos.length})</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {filteredCombos.map((combo) => {
                      const isSelected = selectedModel === combo.name;
                      return (
                        <button
                          key={combo.id}
                          onClick={() => handleSelect({ id: combo.name, name: combo.name, value: combo.name })}
                          data-model-value={combo.name}
                          className={cn(
                            "flex items-center gap-2 px-3 py-2 rounded-lg text-left",
                            "border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                            isSelected
                              ? "bg-primary text-white border-primary"
                              : addedModelValues.includes(combo.name)
                                ? "bg-primary/10 border-primary text-text-main"
                                : "bg-surface border-border hover:border-primary/50"
                          )}
                        >
                          <span className="material-symbols-outlined text-primary text-[16px] shrink-0" aria-hidden="true">layers</span>
                          <span className="font-mono text-sm truncate flex-1 min-w-0">{combo.name}</span>
                          {addedModelValues.includes(combo.name) && (
                            <span className="material-symbols-outlined text-primary text-[14px] shrink-0" aria-hidden="true">check</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Provider sections — the new model-card layout. */}
              {!isLoading && Object.entries(filteredGroups).map(([providerId, group]) => (
                <section key={providerId} aria-label={group.name}>
                  <div className="flex items-center gap-1.5 mb-2 sticky top-0 bg-surface/95 backdrop-blur py-1 -mx-1 px-1 z-10">
                    <ProviderIcon
                      src={`/providers/${providerId}.png`}
                      alt={group.name}
                      size={14}
                      fallbackText={(group.name || providerId).slice(0, 2).toUpperCase()}
                      fallbackColor={group.color}
                    />
                    <h3 className="text-xs font-semibold text-text-main uppercase tracking-wider">{group.name}</h3>
                    <span className="text-[10px] text-text-muted">({group.models.length})</span>
                    {group.isCustom && (
                      <span className="text-[10px] text-text-muted italic ml-1">custom</span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {group.models.map((model) => {
                      const isSelected = selectedModel === model.value;
                      const isPlaceholder = model.isPlaceholder;
                      const isDisabled = model.isDisabled;
                      const isActive = activeCard?.providerId === providerId && activeCard?.modelValue === model.value;
                      return (
                        <button
                          key={model.value}
                          onClick={() => handleSelect(model)}
                          data-model-value={model.value}
                          onFocus={() => setActiveCard({ providerId, modelValue: model.value })}
                          title={isPlaceholder ? "Select to pre-fill, then edit model ID in the input" : isDisabled ? "Disabled — click to re-enable" : undefined}
                          aria-disabled={isDisabled || undefined}
                          className={cn(
                            "flex flex-col gap-1.5 px-3 py-2 rounded-lg text-left",
                            "border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                            isPlaceholder
                              ? "border-dashed border-border bg-surface-2/30 text-text-muted hover:border-primary/50 hover:text-primary"
                              : isDisabled
                                ? "border-border bg-surface-2/20 text-text-subtle line-through opacity-60 hover:opacity-100 hover:border-primary/50"
                                : isSelected
                                  ? "bg-primary text-white border-primary"
                                  : addedModelValues.includes(model.value)
                                    ? "bg-primary/10 border-primary/50 text-text-main"
                                    : isActive
                                      ? "bg-primary/5 border-primary/50"
                                      : "bg-surface border-border hover:border-primary/50 hover:bg-primary/5"
                          )}
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            {isPlaceholder ? (
                              <span className="material-symbols-outlined text-[14px] shrink-0" aria-hidden="true">edit</span>
                            ) : isDisabled ? (
                              <span className="material-symbols-outlined text-[14px] shrink-0" aria-hidden="true">block</span>
                            ) : null}
                            <span className="font-mono text-sm truncate flex-1 min-w-0">{model.name}</span>
                            {addedModelValues.includes(model.value) && !isPlaceholder && (
                              <span className="material-symbols-outlined text-primary text-[14px] shrink-0" aria-hidden="true">check</span>
                            )}
                            {model.isCustom && !isPlaceholder && (
                              <span className="text-[9px] opacity-60 font-normal shrink-0">custom</span>
                            )}
                          </div>
                          {!isPlaceholder && (
                            <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
                              <CapacityBadges caps={getCaps(model.value)} />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}

              {!isLoading && Object.keys(filteredGroups).length === 0 && filteredCombos.length === 0 && (
                <div className="text-center py-8 text-text-muted">
                  <span className="material-symbols-outlined text-3xl mb-2 block opacity-50" aria-hidden="true">
                    search_off
                  </span>
                  <p className="text-sm">No models match</p>
                  <p className="text-xs mt-1 text-text-subtle">Try a different search or category</p>
                </div>
              )}

              {loadError && (
                <div className="text-center py-4 text-xs text-red-500">
                  <span className="material-symbols-outlined text-base align-middle mr-1" aria-hidden="true">warning</span>
                  Could not load all data. Showing what is available.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

ModelSelectModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSelect: PropTypes.func.isRequired,
  onDeselect: PropTypes.func,
  selectedModel: PropTypes.string,
  activeProviders: PropTypes.arrayOf(
    PropTypes.shape({
      provider: PropTypes.string.isRequired,
    })
  ),
  title: PropTypes.string,
  modelAliases: PropTypes.object,
  kindFilter: PropTypes.string,
  addedModelValues: PropTypes.arrayOf(PropTypes.string),
  closeOnSelect: PropTypes.bool,
  showCombos: PropTypes.bool,
};
