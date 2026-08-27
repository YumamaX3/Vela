/**
 * facetRegistry — the validated URL-facet trust boundary (Endpoint
 * Observatory W1d, Shorekeeper-Sealed Plan §1.2 + Security clause S8).
 *
 * The URL is ATTACKER-CONTROLLABLE state crossing into the app — it gets the
 * same treatment as request bodies:
 *   • unknown facet keys   → dropped, collected into `rejected[]`, never
 *                            rendered into queries
 *   • enum violations      → fall back to default, counted as rejected
 *   • q/category over-length → truncated to cap, counted
 *   • sort allowlist       → only named columns
 *   • buildParams emits canonical form: defaults omitted, stable key order —
 *     round-trip idempotent: parse(build(parse(u))) == parse(u)
 *
 * Pure module — no React, no fetch. Components are render-only shells over it
 * (extraction covenant, T3).
 */

export const FACETS = Object.freeze({
  tab: {
    default: "overview",
    // The union of every consumer of the shared useEndpointFacets hook.
    // Endpoint Observatory: overview|keys|tools|audit. AI Lab (migration
    // 017): injectors|modes|policies|library|simulator|observe. Both live on
    // separate routes, so a stale ?tab= from one falls back to its own
    // default cleanly on the other — the enum is a safe union, never a
    // per-page lock.
    enum: ["overview", "keys", "tools", "audit", "injectors", "modes", "policies", "library", "simulator", "observe"],
    serialize: (v) => v,
  },
  status: {
    default: "all",
    enum: ["all", "active", "paused", "expired", "expiring", "revoked"],
    serialize: (v) => v,
  },
  q: {
    default: "",
    max: 120,
    serialize: (v) => String(v).trim(),
  },
  sort: {
    default: "lastUsedAt",
    enum: ["name", "createdAt", "lastUsedAt", "spend", "risk"],
    serialize: (v) => v,
  },
  dir: {
    default: "desc",
    enum: ["asc", "desc"],
    serialize: (v) => v,
  },
  category: {
    default: "",
    max: 64,
    serialize: (v) => String(v).trim(),
  },
  page: {
    default: 0,
    parse: (raw) => {
      const n = parseInt(raw, 10);
      if (!Number.isInteger(n)) return 0;
      return Math.min(Math.max(n, 0), 10000);
    },
    serialize: (v) => String(v),
  },
  sel: {
    default: [],
    cap: 5,
    parse: (raw) => {
      if (!Array.isArray(raw)) {
        try { raw = JSON.parse(raw); } catch { return []; }
      }
      if (!Array.isArray(raw)) return [];
      return raw.filter((x) => typeof x === "string" && /^[a-zA-Z0-9_-]{8,64}$/.test(x)).slice(0, 5);
    },
    serialize: (v) => JSON.stringify((v || []).slice(0, 5)),
  },
});

export const FACET_KEYS = Object.keys(FACETS);

/**
 * Parse a URLSearchParams (or plain object) into validated facet state.
 * @returns {{ state: object, rejected: string[] }}
 */
export function parseParams(raw) {
  const state = {};
  const rejected = [];
  const src = raw instanceof URLSearchParams ? raw : new URLSearchParams(raw || "");

  for (const key of FACET_KEYS) {
    if (!src.has(key)) {
      state[key] = FACETS[key].default;
      continue;
    }
    const rawVal = src.get(key);
    const def = FACETS[key];
    if (rawVal === null || rawVal === "") {
      state[key] = def.default;
      continue;
    }
    // Enum whitelist.
    if (def.enum) {
      if (def.enum.includes(rawVal)) state[key] = rawVal;
      else { state[key] = def.default; rejected.push(key); }
      continue;
    }
    // Custom parser (page/sel).
    if (def.parse) {
      const parsed = def.parse(rawVal);
      if (parsed === def.default && rawVal !== String(def.default) && !(Array.isArray(def.default) && parsed.length === 0 && rawVal === "[]")) {
        // Only count as rejected when the parse actually changed it.
        if (Array.isArray(def.default)) {
          if (JSON.stringify(parsed) !== JSON.stringify(def.default)) rejected.push(key);
        } else if (parsed !== rawVal && rawVal !== "0") rejected.push(key);
      }
      state[key] = parsed;
      continue;
    }
    // Length-cap strings (q/category).
    if (def.max != null) {
      const s = String(rawVal);
      state[key] = s.length > def.max ? s.slice(0, def.max) : s;
      if (s.length > def.max) rejected.push(key);
      continue;
    }
    state[key] = rawVal;
  }

  // Unknown keys are dropped + reported.
  for (const key of src.keys()) {
    if (!FACET_KEYS.includes(key)) rejected.push(key);
  }
  return { state, rejected };
}

/**
 * Build the canonical URL search string from facet state.
 * Defaults omitted; stable key order; idempotent round-trip.
 */
export function buildParams(state) {
  const parts = [];
  for (const key of FACET_KEYS) {
    const v = state?.[key];
    const def = FACETS[key].default;
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(def)) {
      if (Array.isArray(v) && v.length) parts.push(`${key}=${encodeURIComponent(def.serialize(v))}`);
      continue;
    }
    if (Array.isArray(v)) continue;
    if (String(v) === String(def)) continue;
    parts.push(`${key}=${encodeURIComponent(def.serialize ? def.serialize(v) : v)}`);
  }
  return parts.join("&");
}

/** Merge a partial facet update into existing state, returning new state. */
export function mergeFacets(prev, patch) {
  const next = { ...prev };
  for (const [k, v] of Object.entries(patch || {})) {
    if (k in FACETS) next[k] = v;
  }
  return next;
}
