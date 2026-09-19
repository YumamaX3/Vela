// Grouping, reachability and category laws. Pure functions over a fetched
// fleet — nothing here fetches or renders, so the cards, the table, the rail
// and the drawer all ask the same questions of the same data.

import { DEFAULT_STRATEGY } from "./comboMeta";

// Split a slash-bearing combo name into (harbor, leaf): the leading namespace
// segments are the harbor, the last segment is the display leaf.
// "vela/cc/opus" → ("vela/cc", "opus"); "opus" → ("", "opus").
export function splitHarbor(name = "") {
  const idx = name.lastIndexOf("/");
  if (idx === -1) return { harbor: "", leaf: name };
  return { harbor: name.slice(0, idx), leaf: name.slice(idx + 1) };
}

export function harborOf(name) {
  return splitHarbor(name).harbor;
}

// The provider segment of a member model id: "openai/gpt-5" → "openai".
export function providerOf(member) {
  const value = String(member ?? "");
  const idx = value.indexOf("/");
  return idx === -1 ? null : value.slice(0, idx);
}

export function strategyFor(comboStrategies, name) {
  return comboStrategies?.[name]?.fallbackStrategy || DEFAULT_STRATEGY;
}

// A member's provider counts as dialable when an ACTIVE connection exists or a
// user-defined provider node carries the prefix.
export function memberReachable(member, hub) {
  const provider = providerOf(member);
  if (!provider || !hub) return null;
  return hub.connected.has(provider) || hub.prefixes.has(provider);
}

export function comboHealth(combo, hub) {
  let total = 0;
  let reachable = 0;
  for (const member of combo?.models || []) {
    const verdict = memberReachable(member, hub);
    if (verdict === null) continue;
    total += 1;
    if (verdict) reachable += 1;
  }
  return { total, reachable };
}

export function membersOf(combo) {
  return Array.isArray(combo?.models) ? combo.models : [];
}

// ─── filtering ─────────────────────────────────────────────────────────────

export function matchesQuery(combo, query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return true;
  return (
    combo.name.toLowerCase().includes(q) ||
    combo.models?.some((m) => String(m).toLowerCase().includes(q))
  );
}

export function matchesStrategy(strategyFilter, strategy) {
  return !strategyFilter || strategyFilter === "all" || strategy === strategyFilter;
}

export function matchesHealth(healthFilter, { total, reachable }) {
  if (!healthFilter || healthFilter === "all") return true;
  // A combo with no provider-carrying members has nothing to judge — it rides
  // along rather than being hidden by a health filter it cannot satisfy.
  if (!total) return true;
  if (healthFilter === "ok") return reachable === total;
  if (healthFilter === "degraded") return reachable > 0 && reachable < total;
  if (healthFilter === "down") return reachable === 0;
  return true;
}

export function matchesSmartView(view, ctx) {
  const { combo, strategy, usage, health } = ctx;
  switch (view) {
    case "attention":
      return (
        membersOf(combo).length === 0 ||
        (health.total > 0 && health.reachable < health.total) ||
        (usage?.requests >= 5 && (usage.ok || 0) / usage.requests < 0.9)
      );
    case "idle":
      return !(usage?.requests > 0);
    case "empty":
      return membersOf(combo).length === 0;
    case "fusion":
      return strategy === "fusion";
    case "round-robin":
      return strategy === "round-robin";
    default:
      return true;
  }
}

// ─── sorting ───────────────────────────────────────────────────────────────

export function sortCombos(list, sortKey, { usageByName, comboStrategies } = {}) {
  const usageOf = (c) => usageByName?.[c.name] || null;
  const sorted = [...list];

  switch (sortKey) {
    case "recent":
      sorted.sort((a, b) => {
        const la = usageOf(a)?.lastAt || "";
        const lb = usageOf(b)?.lastAt || "";
        return lb.localeCompare(la) || a.name.localeCompare(b.name);
      });
      break;
    case "members":
      sorted.sort((a, b) => membersOf(b).length - membersOf(a).length || a.name.localeCompare(b.name));
      break;
    case "requests":
      sorted.sort((a, b) => (usageOf(b)?.requests || 0) - (usageOf(a)?.requests || 0) || a.name.localeCompare(b.name));
      break;
    case "cost":
      sorted.sort((a, b) => (usageOf(b)?.cost || 0) - (usageOf(a)?.cost || 0) || a.name.localeCompare(b.name));
      break;
    case "health":
      // Worst first: unattended first (unknown), then offline members.
      sorted.sort((a, b) => {
        const rank = (c) => {
          const u = usageOf(c);
          const ratio = u?.requests ? (u.ok || 0) / u.requests : 1;
          return ratio;
        };
        return rank(a) - rank(b) || a.name.localeCompare(b.name);
      });
      break;
    default:
      sorted.sort((a, b) => a.name.localeCompare(b.name));
  }
  return sorted;
}

// ─── grouping ──────────────────────────────────────────────────────────────

// Harbors in stable order: alphabetical namespaces, un-namespaced last (or
// first when the fleet has no namespaces at all).
export function buildHarbors(list, hub) {
  const groups = new Map();
  for (const combo of list) {
    const { harbor } = splitHarbor(combo.name);
    if (!groups.has(harbor)) groups.set(harbor, []);
    groups.get(harbor).push(combo);
  }
  return [...groups.entries()].map(([harbor, combos]) => {
    let members = 0;
    let reachable = 0;
    let judged = 0;
    for (const combo of combos) {
      members += membersOf(combo).length;
      const health = comboHealth(combo, hub);
      judged += health.total;
      reachable += health.reachable;
    }
    return { harbor, combos, members, judged, reachable };
  });
}

// The namespace tree the rail renders: every distinct prefix with its depth
// and how many combos live beneath it ("vela", "vela/cc", "vela/deepseek").
export function namespaceTree(combos) {
  const counts = new Map();
  for (const combo of combos) {
    const { harbor } = splitHarbor(combo.name);
    if (!harbor) continue;
    const segments = harbor.split("/");
    for (let i = 1; i <= segments.length; i += 1) {
      const prefix = segments.slice(0, i).join("/");
      counts.set(prefix, (counts.get(prefix) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([prefix, count]) => ({ prefix, count, depth: prefix.split("/").length, leaf: prefix.split("/").pop() }))
    .sort((a, b) => a.prefix.localeCompare(b.prefix));
}

// ─── rail counts ───────────────────────────────────────────────────────────

export function railCounts(combos, { comboStrategies, usageByName, hub } = {}) {
  const counts = { all: combos.length, attention: 0, idle: 0, empty: 0, fusion: 0, "round-robin": 0 };
  for (const combo of combos) {
    const ctx = {
      combo,
      strategy: strategyFor(comboStrategies, combo.name),
      usage: usageByName?.[combo.name] || null,
      health: comboHealth(combo, hub),
    };
    for (const view of ["attention", "idle", "empty", "fusion", "round-robin"]) {
      if (matchesSmartView(view, ctx)) counts[view] += 1;
    }
  }
  return counts;
}
