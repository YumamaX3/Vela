// The combo catalogue — every label, icon, tone and option the combos flight
// deck draws from. Kept out of the components so a strategy, a sort or a smart
// view is added in one place and every lens (cards, table, rail, drawer) picks
// it up together.

// ─── strategies ────────────────────────────────────────────────────────────
// tone maps into comboFormat's TONES; the hint is the one-line law of the mode.
export const STRATEGY_META = {
  fallback: {
    label: "Fallback",
    icon: "route",
    hint: "Tries models in order, next on failure",
    tone: "brand",
  },
  "round-robin": {
    label: "Round Robin",
    icon: "sync_alt",
    hint: "Rotates models across requests",
    tone: "emerald",
  },
  fusion: {
    label: "Fusion",
    icon: "hub",
    hint: "Panel + judge · N+1 calls",
    tone: "violet",
  },
};

export const DEFAULT_STRATEGY = "fallback";

export const STRATEGY_OPTIONS = [
  { value: "fallback", label: "Fallback" },
  { value: "round-robin", label: "Round Robin" },
  { value: "fusion", label: "Fusion" },
];

export const STRATEGY_FILTERS = [{ value: "all", label: "All strategies" }, ...STRATEGY_OPTIONS];

export function strategyMeta(strategy) {
  return STRATEGY_META[strategy] || STRATEGY_META[DEFAULT_STRATEGY];
}

// ─── sorts ─────────────────────────────────────────────────────────────────
export const SORTS = [
  { value: "name", label: "Name" },
  { value: "recent", label: "Recently used" },
  { value: "members", label: "Members" },
  { value: "requests", label: "24h requests" },
  { value: "cost", label: "24h cost" },
  { value: "health", label: "Health (worst first)" },
];

// ─── lenses ────────────────────────────────────────────────────────────────
export const VIEWS = [
  { value: "cards", label: "Cards", icon: "grid_view" },
  { value: "table", label: "Table", icon: "table_rows" },
];

export const VIEW_STORAGE_KEY = "vela.combos.view";

// ─── health filter ─────────────────────────────────────────────────────────
export const HEALTH_FILTERS = [
  { value: "all", label: "All health" },
  { value: "ok", label: "Fully connected" },
  { value: "degraded", label: "Partially connected" },
  { value: "down", label: "Offline members" },
];

// ─── smart views (the rail) ────────────────────────────────────────────────
export const SMART_VIEWS = [
  { value: "all", label: "All combos", icon: "layers" },
  { value: "attention", label: "Needs attention", icon: "warning" },
  { value: "idle", label: "Idle · 24h", icon: "bedtime" },
  { value: "empty", label: "No members", icon: "link_off" },
  { value: "fusion", label: "Fusion", icon: "hub" },
  { value: "round-robin", label: "Round robin", icon: "sync_alt" },
];

// ─── capacity adapter (carried forward from the pre-upgrade page) ──────────
// Global fallback pools of models per input-modality capability. A request
// needing a capability the target model/combo lacks switches straight to the
// first enabled model here instead of erroring or dropping the data.
export const CAPACITY_ADAPTER_CAPS = [
  { key: "vision", label: "Vision", icon: "visibility", desc: "Images" },
  // pdf, videoInput temporarily hidden — no translator support yet for those blocks.
  { key: "audioInput", label: "Audio", icon: "graphic_eq", desc: "Audio input" },
];

export const DEFAULT_FALLBACK_MODEL = "oc/mimo-v2.5-free";
export const EMPTY_CAP_ENTRY = { enabled: true, roundRobin: false, models: [] };
export const EMPTY_CAPACITY_ADAPTER = {
  vision: { ...EMPTY_CAP_ENTRY },
  pdf: { ...EMPTY_CAP_ENTRY },
  audioInput: { ...EMPTY_CAP_ENTRY },
  videoInput: { ...EMPTY_CAP_ENTRY },
};

// Backward-compat: the legacy stored form was an array of {model, enabled}.
export function normalizeCapEntry(entry) {
  if (Array.isArray(entry)) {
    return { enabled: true, roundRobin: false, models: entry.map((e) => e?.model || e).filter(Boolean) };
  }
  if (entry && typeof entry === "object") {
    return {
      enabled: entry.enabled !== false,
      roundRobin: !!entry.roundRobin,
      models: Array.isArray(entry.models) ? entry.models.filter(Boolean) : [],
    };
  }
  return { ...EMPTY_CAP_ENTRY };
}

export function normalizeCapacityAdapter(raw = {}) {
  const normalized = {};
  for (const cap of CAPACITY_ADAPTER_CAPS) normalized[cap.key] = normalizeCapEntry(raw[cap.key]);
  return normalized;
}
