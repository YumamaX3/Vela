// ── The OpenCode catalog — the free tier derived, never enumerated ──────────
//
// Ported from azrinaldi/opencode-free-bridge v2.0.3 (`identity.js`
// parseCatalogData / extractCatalog). The sibling bridge's central lesson is
// that the free tier is a CATALOG FACT, not a naming convention: upstream
// publishes `models.opencode.ai/api.json`, and a model is free when
// `cost.input === 0 && cost.output === 0 && status !== "deprecated"` — the same
// rule the OpenCode CLI's own models-dev reader applies.
//
// Why this replaced the hand-curated list — measured against the live catalog
// on 2026-10-20, not remembered. `models.opencode.ai/api.json` carried 128 ids,
// 10 of them zero-cost and non-deprecated. Of the 10 ids the curated set named:
//   • 4 were still free   (mimo-v2.6-flash-free, nemotron-3.5-lightning-free,
//                          longcat-2.5-preview-free, deepseek-v4.1-flash-free)
//   • 5 were deprecated   (muse-spark-1.2/1.3-contributor-free, cat-jam-free,
//                          step-5-preview-free, space-bunny-free)
//   • 1 was absent        (jev-1.13-free → 400 ModelProtocolUnsupported)
// and 6 ids the catalog called free could not be named by the curated set at all
// (big-pickle, glm-5.3-flash-free, minimax-m3.1-flash-free, beam-free,
// nemotron-3.5-super-vl-free, nemotron-3-ultra-free). Stale in BOTH directions,
// and no suffix heuristic can fix it: half the ids it would keep are retired and
// half the live ones it would drop carry no suffix worth trusting.
//
// The shape:
//   • a synchronous snapshot the hot path reads (the predicate runs per request),
//   • an async refresh that is LAZY — never a timer (the bridge's own rule),
//   • a disk cache so a cold boot or an offline host still resolves,
//   • and a shipped fallback so the very first request is never empty.
//
// Fail-open is honest here, not silent: `getStatus()` reports which source
// answered and the last error, exactly as the bridge's `/health` does.

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir.js";
import { OPENCODE_FREE_TIER_MODELS, MUSE_SPARK_FREE_RE } from "../providers/registry/opencode.js";

const CATALOG_URL = process.env.OPENCODE_CATALOG_URL || "https://models.opencode.ai/api.json";
const CACHE_FILE = path.join(DATA_DIR, "opencode-catalog.json");
const CATALOG_CACHE_VERSION = 1;
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6h — the bridge's own cadence
const FETCH_TIMEOUT_MS = 8000;

// The base a catalog must name before its endpoints are trusted. Anything else
// is a malformed or hostile answer, and a wrong base would silently send every
// free request to a stranger's door.
const TRUSTED_CATALOG_HOST_RE = /^https:\/\/([a-z0-9-]+\.)*opencode\.ai(\/|$)/i;

// The shipped floor: what a cold, offline start resolves to. Kept as the
// registry's curated set so there is exactly ONE definition of the fallback.
const FALLBACK_FREE = new Set(OPENCODE_FREE_TIER_MODELS);

const FALLBACK_ENDPOINTS = Object.freeze({
  chatUrl: "https://opencode.ai/inference/v1/chat/completions",
  responsesUrl: "https://opencode.ai/inference/v1/responses",
  modelsUrl: "https://opencode.ai/inference/v1/models",
});

// ── The snapshot ────────────────────────────────────────────────────────────
// `freeModels` is null until a real catalog (network or disk) is parsed, so the
// predicate can tell "no catalog yet" apart from "the catalog says none".
let snapshot = {
  freeModels: null,      // Set<string> | null
  verdicts: null,        // Map<string, "free"|"paid"|"deprecated"> | null
  facts: null,           // Map<string, {reasoning, maxOutput}> | null
  endpoints: FALLBACK_ENDPOINTS,
  loadedAt: 0,
  source: "fallback",    // fallback | cache | network
  error: null,
};

let inFlight = null;
let lastRefreshAt = 0;

function baseId(model) {
  if (!model) return "";
  const trimmed = String(model).trim();
  const withoutVariant = trimmed.replace(/\([^()]*\)\s*$/, "").trim();
  return (withoutVariant.includes("/") ? withoutVariant.split("/").pop() : withoutVariant).toLowerCase();
}

function isTrustedBase(url) {
  return typeof url === "string" && TRUSTED_CATALOG_HOST_RE.test(url);
}

// ── Parsing — the one place a catalog becomes truth ─────────────────────────

export function parseCatalog(json) {
  const oc = json?.opencode;
  if (!oc || typeof oc !== "object") return null;

  const models = oc.models && typeof oc.models === "object" ? oc.models : null;
  if (!models) return null;

  const freeModels = new Set();
  const verdicts = new Map();
  const facts = new Map();

  for (const [id, m] of Object.entries(models)) {
    if (!m || typeof m !== "object") continue;
    const key = id.toLowerCase();
    const cost = m.cost || {};
    const zeroCost = Number(cost.input) === 0 && Number(cost.output) === 0;
    const deprecated = m.status === "deprecated";
    // `tool_call: false` means the model cannot carry a tool schema. The free
    // gate's whole anchor is a tool named `read`, so such a model could never
    // pass it — upstream's own reader drops it, and so does this one.
    const usable = m.tool_call !== false;

    const verdict = deprecated ? "deprecated" : zeroCost && usable ? "free" : "paid";
    verdicts.set(key, verdict);
    if (verdict === "free") freeModels.add(key);

    if (typeof m.reasoning === "boolean") {
      const out = Number(m?.limit?.output);
      facts.set(key, {
        reasoning: m.reasoning,
        maxOutput: Number.isFinite(out) && out > 0 ? out : null,
      });
    }

  }

  let endpoints = FALLBACK_ENDPOINTS;
  const api = typeof oc.api === "string" ? oc.api.replace(/\/+$/, "") : null;
  if (api && isTrustedBase(api)) {
    endpoints = {
      chatUrl: `${api}/chat/completions`,
      // The Responses lane is the same base with /responses — how the real
      // CLI's @ai-sdk/openai route is built. A malformed base that lacks the
      // /v1 tail leaves the fallback standing rather than inventing a path.
      responsesUrl: api.endsWith("/v1") ? `${api}/responses` : FALLBACK_ENDPOINTS.responsesUrl,
      modelsUrl: api.endsWith("/v1") ? `${api}/models` : FALLBACK_ENDPOINTS.modelsUrl,
    };
  }

  return { freeModels, verdicts, facts, endpoints };
}

// ── Disk cache — so a cold boot and an offline host still resolve ───────────

function readCache() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    if (parsed?.version !== CATALOG_CACHE_VERSION || !parsed?.catalog) return null;
    const cat = parsed.catalog;
    if (!Array.isArray(cat.freeModels)) return null;
    return {
      freeModels: new Set(cat.freeModels),
      verdicts: new Map(Object.entries(cat.verdicts || {})),
      facts: new Map(Object.entries(cat.facts || {})),
      endpoints: cat.endpoints && isTrustedBase(cat.endpoints.chatUrl) ? cat.endpoints : FALLBACK_ENDPOINTS,
    };
  } catch {
    return null;
  }
}

function writeCache(catalog) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    const serializable = {
      version: CATALOG_CACHE_VERSION,
      savedAt: new Date().toISOString(),
      catalog: {
        freeModels: [...catalog.freeModels],
        verdicts: Object.fromEntries(catalog.verdicts),
        facts: Object.fromEntries(catalog.facts),
        endpoints: catalog.endpoints,
      },
    };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(serializable), "utf8");
  } catch {
    // A read-only or full data dir must not fail a request. The snapshot in
    // memory already carries the answer; only the next cold boot loses it.
  }
}

function adopt(catalog, source) {
  snapshot = {
    ...catalog,
    loadedAt: Date.now(),
    source,
    error: source === "cache" ? snapshot.error : null,
  };
}

// ── Refresh — lazy, deduped, never a timer ─────────────────────────────────

export async function refreshOpenCodeCatalog({ force = false, signal = null } = {}) {
  const now = Date.now();
  if (!force && snapshot.freeModels && now - lastRefreshAt < DEFAULT_TTL_MS) {
    return snapshot;
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const timeout = AbortSignal.timeout?.(FETCH_TIMEOUT_MS);
    const requestSignal = signal && timeout ? AbortSignal.any([signal, timeout]) : signal || timeout;
    try {
      const res = await fetch(CATALOG_URL, {
        headers: { Accept: "application/json" },
        signal: requestSignal,
      });
      if (!res.ok) throw new Error(`catalog HTTP ${res.status}`);
      const parsed = parseCatalog(await res.json());
      if (!parsed) throw new Error("catalog carried no opencode.models");
      adopt(parsed, "network");
      writeCache(parsed);
    } catch (err) {
      snapshot = { ...snapshot, error: err?.message || String(err) };
      // First failure on a cold start: fall back to the last catalog this host
      // saw, so aliases and the free list keep working offline.
      if (!snapshot.freeModels) {
        const cached = readCache();
        if (cached) adopt(cached, "cache");
      }
    } finally {
      lastRefreshAt = Date.now();
      inFlight = null;
    }
    return snapshot;
  })();

  return inFlight;
}

/** Kick a refresh without awaiting it. Called once per free-lane request; the
 *  TTL and the in-flight dedupe make every call after the first free. */
export function ensureFresh() {
  if (inFlight) return;
  if (snapshot.freeModels && Date.now() - lastRefreshAt < DEFAULT_TTL_MS) return;
  refreshOpenCodeCatalog().catch(() => {});
}

// ── The hot path — synchronous, snapshot-only ──────────────────────────────

/**
 * Is this model a free-tier id? Catalog first, curated set second, the Muse
 * Spark family regex last (it covers ids the catalog has not enumerates yet).
 * Never a bare `*-free` suffix: upstream retires ids without renaming them.
 */
export function isFreeTierModel(model) {
  const base = baseId(model);
  if (!base) return false;
  if (snapshot.freeModels) {
    if (snapshot.freeModels.has(base)) return true;
    // A catalog that explicitly knows this id as paid/deprecated is final —
    // the curated set must not resurrect a retired lane.
    if (snapshot.verdicts?.has(base)) return false;
  }
  return FALLBACK_FREE.has(base) || MUSE_SPARK_FREE_RE.test(base);
}

/** The catalog's own verdict for an id: "free" | "paid" | "deprecated" | null
 *  (null means the catalog does not describe it at all — distinct from paid). */
export function getCatalogVerdict(model) {
  const base = baseId(model);
  if (!base) return null;
  return snapshot.verdicts?.get(base) ?? null;
}

/** Catalog facts the wire depends on: reasoning flag and output ceiling. */
export function getModelFacts(model) {
  const base = baseId(model);
  if (!base) return null;
  return snapshot.facts?.get(base) ?? null;
}

/** Wire endpoints, from the catalog's `opencode.api` when it was trusted. */
export function getEndpoints() {
  return snapshot.endpoints || FALLBACK_ENDPOINTS;
}

/** Honest diagnostics — which source answered, when, and what last failed. */
export function getStatus() {
  return {
    source: snapshot.source,
    loadedAt: snapshot.loadedAt || null,
    ageMs: snapshot.loadedAt ? Date.now() - snapshot.loadedAt : null,
    ttlMs: DEFAULT_TTL_MS,
    freeModelCount: snapshot.freeModels ? snapshot.freeModels.size : 0,
    endpoints: snapshot.endpoints,
    lastError: snapshot.error,
  };
}

/** Test seam — restore the cold-boot state without touching the network. */
export function __resetOpenCodeCatalog() {
  snapshot = {
    freeModels: null,
    verdicts: null,
    facts: null,
    endpoints: FALLBACK_ENDPOINTS,
    loadedAt: 0,
    source: "fallback",
    error: null,
  };
  inFlight = null;
  lastRefreshAt = 0;
}

export const OPENCODE_CATALOG_URL = CATALOG_URL;
export const OPENCODE_CATALOG_CACHE_FILE = CACHE_FILE;
