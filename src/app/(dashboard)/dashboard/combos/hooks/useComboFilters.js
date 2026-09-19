"use client";

// The deck's view state: what the operator is looking at, how it is sorted,
// which category is selected, what is ticked for bulk action. Derived lists
// (filtered, harbors, counts) come out of here so every lens renders the same
// selection.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildHarbors,
  comboHealth,
  namespaceTree,
  matchesHealth,
  matchesQuery,
  matchesSmartView,
  matchesStrategy,
  railCounts,
  sortCombos,
  strategyFor,
} from "../lib/comboGroups";
import { VIEW_STORAGE_KEY } from "../lib/comboMeta";

const ALL = { type: "view", value: "all" };

export function useComboFilters(combos, { comboStrategies, usageByName, hub } = {}) {
  const [query, setQuery] = useState("");
  const [strategyFilter, setStrategyFilter] = useState("all");
  const [healthFilter, setHealthFilter] = useState("all");
  const [sortKey, setSortKey] = useState("name");
  const [view, setViewState] = useState("cards");
  const [category, setCategory] = useState(ALL);
  const [collapsed, setCollapsed] = useState({});
  const [selected, setSelected] = useState(() => new Set());

  // View choice is a preference, not session state — restored once, on mount,
  // so the server render and the first client paint agree.
  useEffect(() => {
    try {
      const stored = window.localStorage?.getItem(VIEW_STORAGE_KEY);
      if (stored === "cards" || stored === "table") setViewState(stored);
    } catch {
      /* private mode / no storage — the default stands */
    }
  }, []);

  const setView = useCallback((next) => {
    setViewState(next);
    try {
      window.localStorage?.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const ctxOf = useCallback(
    (combo) => ({
      combo,
      strategy: strategyFor(comboStrategies, combo.name),
      usage: usageByName?.[combo.name] || null,
      health: comboHealth(combo, hub),
    }),
    [comboStrategies, usageByName, hub]
  );

  const counts = useMemo(
    () => railCounts(combos, { comboStrategies, usageByName, hub }),
    [combos, comboStrategies, usageByName, hub]
  );

  // Nested namespace prefixes ("vela", "vela/cc", …) with live counts — the
  // rail's tree. Built over the whole fleet so navigation never shifts under
  // the operator's feet while a filter is applied.
  const tree = useMemo(() => namespaceTree(combos), [combos]);

  const filtered = useMemo(() => {
    const list = combos.filter((combo) => {
      const ctx = ctxOf(combo);
      if (!matchesQuery(combo, query)) return false;
      if (!matchesStrategy(strategyFilter, ctx.strategy)) return false;
      if (!matchesHealth(healthFilter, ctx.health)) return false;
      if (category.type === "view" && !matchesSmartView(category.value, ctx)) return false;
      if (category.type === "harbor") {
        const idx = combo.name.lastIndexOf("/");
        const harbor = idx === -1 ? "" : combo.name.slice(0, idx);
        if (harbor !== category.value && !harbor.startsWith(`${category.value}/`)) return false;
      }
      return true;
    });
    return sortCombos(list, sortKey, { usageByName, comboStrategies });
  }, [combos, query, strategyFilter, healthFilter, category, sortKey, ctxOf, usageByName, comboStrategies]);

  const harbors = useMemo(() => buildHarbors(filtered, hub), [filtered, hub]);

  const selection = useMemo(() => {
    const ids = new Set(combos.map((c) => c.id));
    return [...selected].filter((id) => ids.has(id));
  }, [selected, combos]);

  const selectedCombos = useMemo(
    () => combos.filter((c) => selection.includes(c.id)),
    [combos, selection]
  );

  const toggleSelect = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback((ids) => setSelected(new Set(ids)), []);
  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const toggleHarbor = useCallback((harbor) => {
    setCollapsed((prev) => ({ ...prev, [harbor]: !prev[harbor] }));
  }, []);

  const collapseAll = useCallback(() => {
    setCollapsed((prev) => {
      const next = { ...prev };
      for (const { harbor } of harbors) if (harbor) next[harbor] = true;
      return next;
    });
  }, [harbors]);

  const expandAll = useCallback(() => setCollapsed({}), []);

  const resetFilters = useCallback(() => {
    setQuery("");
    setStrategyFilter("all");
    setHealthFilter("all");
    setCategory(ALL);
  }, []);

  const selectCategory = useCallback((type, value) => {
    setCategory(type === "view" && value === "all" ? ALL : { type, value });
    clearSelection();
  }, [clearSelection]);

  const filtersActive = Boolean(query.trim()) || strategyFilter !== "all" || healthFilter !== "all" || category.value !== "all";

  return {
    query,
    setQuery,
    strategyFilter,
    setStrategyFilter,
    healthFilter,
    setHealthFilter,
    sortKey,
    setSortKey,
    view,
    setView,
    category,
    selectCategory,
    collapsed,
    toggleHarbor,
    collapseAll,
    expandAll,
    selected: selection,
    selectedCombos,
    toggleSelect,
    selectAll,
    clearSelection,
    filtered,
    harbors,
    counts,
    tree,
    filtersActive,
    resetFilters,
  };
}
