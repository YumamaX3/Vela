/**
 * Kiro control plane (M3 · C3) — `ListAvailableModels` asked per account.
 *
 * The sealed plan's headline: Vela's static roster is the union; what one
 * ACCOUNT may actually call is the upstream's answer, and only the upstream's
 * answer gates selection for that account. This module is the client half:
 *
 *   buildKiroControlPlaneRequest(credentials)  → { url, headers }  (pure, pinned)
 *   fetchKiroControlPlaneModels(credentials)   → { entries, host } | throws
 *   deriveKiroCatalog(sources)                 → { models, rawModels } | null
 *   getKiroAccountModelCatalog(credentials)    → memoized, 30-min TTL
 *   selectKiroModelForAccount(model, available) → the id to ship, or a 400
 *
 * Laws this file keeps:
 *   • DEFAULT OFF. `getKiroAccountModelCatalog` is a no-op unless
 *     KIRO_CONTROL_PLANE=on (env) or { enabled: true } is passed. The shipped
 *     request shape is pinned by tests/unit/kiro-control-plane.test.js, so the
 *     flag can be flipped without a shape surprise.
 *   • Mapping-before-suffix-strip: an available-list entry is matched against
 *     `resolveKiroWireModel(id)` — the same resolver the translators use — never
 *     against a hand-rolled suffix strip.
 *   • Account order is the merge order. Stable, deduped, first sighting wins.
 */

import {
  KIRO_CONTROL_PLANE_TARGET,
  resolveKiroModel,
} from "../config/kiroConstants.js";
import { resolveKiroWireModel } from "../providers/registry/kiroModelAliases.js";

// sha256 hex via WebCrypto — this module rides the dashboard's webpack graph
// (modelsList → kiroConstants → here), where `node:crypto` is an unhandled
// scheme (the v1.2.35 image-build failure). runtimeAvailable in every runtime
// Vela ships on (Node 22 ≥20, Bun, worker threads); async only.
async function sha256Hex(seed) {
  const data = new TextEncoder().encode(String(seed));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// uuid via WebCrypto — the invocation id is a correlation tag, not a security
// boundary; randomness quality requirements are the platform's default.
const uuidv4 = () => crypto.randomUUID();

export const KIRO_CONTROL_PLANE_TTL_MS = 30 * 60 * 1000; // 30 minutes — the plan's number
const CONTROL_PLANE_TIMEOUT_MS = 30_000;
const DEFAULT_REGION = "us-east-1";

// Same host ladder the streaming surface uses (registry transport.baseUrls), in
// the same order — plus kirogo's regional runtime host as the last leg (C7's
// leg is only ever reached when the other two answer with a transport error).
const DEFAULT_HOSTS = [
  "https://runtime.us-east-1.kiro.dev",
  "https://codewhisperer.us-east-1.amazonaws.com",
  "https://q.us-east-1.amazonaws.com",
];

const KIRO_CLIENT_VERSION = "0.10.32";

/** The flag. Default OFF — anything but an explicit on stays off. */
export function isKiroControlPlaneEnabled(env = process.env) {
  const raw = String(env?.KIRO_CONTROL_PLANE ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}

function regionOf(credentials) {
  const arn = credentials?.providerSpecificData?.profileArn;
  if (typeof arn === "string") {
    const parts = arn.split(":");
    if (parts.length >= 4 && parts[3]) return parts[3];
  }
  const explicit = credentials?.providerSpecificData?.region;
  return typeof explicit === "string" && explicit.trim() ? explicit.trim() : DEFAULT_REGION;
}

function hostsFor(credentials) {
  const region = regionOf(credentials);
  if (!region || region === DEFAULT_REGION) return [...DEFAULT_HOSTS];
  // Non-default region: the AWS surfaces move with the token's region; the
  // kiro.dev runtime does too (C7's runtime.{region}.kiro.dev).
  return [
    `https://runtime.${region}.kiro.dev`,
    `https://codewhisperer.${region}.amazonaws.com`,
    `https://q.${region}.amazonaws.com`,
  ];
}

async function machineIdOf(credentials) {
  const seed =
    credentials?.providerSpecificData?.clientId
    || credentials?.refreshToken
    || credentials?.providerSpecificData?.profileArn
    || credentials?.accessToken
    || "kiro-anonymous";
  return sha256Hex(seed);
}

/**
 * Attach the account's availability to a credentials record, so the translator
 * (which only ever receives the record) can gate selection. Flag-off or no
 * evidence → the property is absent and nothing is gated.
 */
export async function attachKiroAvailability(credentials, options = {}) {
  if (!credentials || typeof credentials !== "object") return credentials;
  const catalog = await getKiroAccountModelCatalog(credentials, options);
  if (catalog?.available instanceof Set && catalog.available.size > 0) {
    credentials.kiroAvailableModels = catalog.available;
  } else {
    delete credentials.kiroAvailableModels;
  }
  return credentials;
}

/** The allow-list in public spellings, for the 400 body a caller may build. */
export function kiroAvailablePublicIds(available) {
  if (!available) return [];
  const list = available instanceof Set ? [...available] : Array.from(available);
  return list.map((id) => resolveKiroWireModel(String(id)).base);
}

/**
 * THE PINNED SHAPE. Every host is asked with the SAME request: a POST to the
 * host root carrying the control-plane identity in `x-amz-target` (the plan's
 * headline fact) — never a path like /ListAvailableModels, and never the
 * streaming target.
 */
export async function buildKiroControlPlaneRequest(credentials, { hostIndex = 0, invocationId } = {}) {
  const hosts = hostsFor(credentials);
  const host = hosts[Math.max(0, Math.min(hostIndex, hosts.length - 1))];
  const machineId = await machineIdOf(credentials);

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-Amz-Target": KIRO_CONTROL_PLANE_TARGET,
    "Authorization": `Bearer ${credentials?.accessToken || credentials?.apiKey || ""}`,
    "User-Agent":
      `aws-sdk-js/1.0.0 ua/2.1 os/windows#10.0.26200 lang/js md/nodejs#22.21.1 ` +
      `api/codewhispererruntime#1.0.0 m/N,E KiroIDE-${KIRO_CLIENT_VERSION}-${machineId}`,
    "x-amz-user-agent": `aws-sdk-js/1.0.0 KiroIDE-${KIRO_CLIENT_VERSION}-${machineId}`,
    "x-amzn-kiro-agent-mode": "vibe",
    "amz-sdk-request": "attempt=1; max=1",
    "amz-sdk-invocation-id": invocationId || uuidv4(),
  };
  const authMethod = credentials?.providerSpecificData?.authMethod;
  if (authMethod === "api_key") headers["TokenType"] = "API_KEY";
  if (authMethod === "external_idp") headers["TokenType"] = "EXTERNAL_IDP";

  return { url: `${host}/`, headers };
}

/**
 * One GET-equivalent round trip to the first host that answers 2xx.
 * Throws the last error (with `.status`) when every host fails.
 */
export async function fetchKiroControlPlaneModels(credentials, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const hosts = hostsFor(credentials);
  let lastError = null;
  for (let index = 0; index < hosts.length; index += 1) {
    const { url, headers } = await buildKiroControlPlaneRequest(credentials, { hostIndex: index });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("timeout"), CONTROL_PLANE_TIMEOUT_MS);
    if (options.signal && typeof options.signal.addEventListener === "function") {
      options.signal.addEventListener("abort", () => controller.abort(options.signal.reason), { once: true });
    }
    try {
      const response = await fetchImpl(url, { method: "POST", headers, body: "{}", signal: controller.signal });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        const error = new Error(`Kiro ListAvailableModels ${response.status}: ${text || response.statusText}`);
        error.status = response.status;
        lastError = error;
        continue; // next host — the identity lives in the header, so the shape carries over
      }
      const data = await response.json();
      const entries = normalizeControlPlaneEntries(data);
      return { entries, host: hosts[index] };
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error("Kiro ListAvailableModels: no host answered");
}

/** Tolerate the two shapes the surfaces have been seen to answer with. */
function normalizeControlPlaneEntries(data) {
  const raw = Array.isArray(data) ? data
    : Array.isArray(data?.models) ? data.models
      : Array.isArray(data?.availableModels) ? data.availableModels
        : [];
  return raw
    .map((m) => (typeof m === "string" ? { modelId: m } : m))
    .filter((m) => m && (m.modelId || m.id))
    .map((m) => ({ modelId: String(m.modelId || m.id), modelName: m.modelName || m.name || "" }));
}

/**
 * Merge per-account catalogs in ACCOUNT ORDER (stable): the first account's
 * models come first, later accounts only append an upstream id that is new.
 * Pure — the pin test drives it with fixtures.
 */
export function deriveKiroCatalog(sources) {
  const lists = (Array.isArray(sources) ? sources : [])
    .map((s) => (Array.isArray(s) ? s : s?.entries))
    .filter((entries) => Array.isArray(entries) && entries.length > 0);
  if (lists.length === 0) return null;

  const seen = new Set();
  const rawModels = [];
  for (const entries of lists) {
    for (const entry of entries) {
      const modelId = typeof entry === "string" ? entry : entry?.modelId || entry?.id;
      if (!modelId || seen.has(modelId)) continue;
      seen.add(modelId);
      rawModels.push({ modelId, modelName: entry?.modelName || entry?.name || "" });
    }
  }
  if (rawModels.length === 0) return null;

  const models = [];
  for (const raw of rawModels) {
    const { base } = resolveKiroWireModel(raw.modelId);
    const isAuto = base === "auto";
    models.push({ id: base, name: raw.modelName || `Kiro ${base}`, capabilities: { thinking: false, agentic: false }, upstreamModelId: raw.modelId });
    models.push({ id: `${base}-thinking`, name: `${raw.modelName || base} (Thinking)`, capabilities: { thinking: true, agentic: false }, upstreamModelId: raw.modelId });
    if (!isAuto) {
      models.push({ id: `${base}-agentic`, name: `${raw.modelName || base} (Agentic)`, capabilities: { thinking: false, agentic: true }, upstreamModelId: raw.modelId });
      models.push({ id: `${base}-thinking-agentic`, name: `${raw.modelName || base} (Thinking + Agentic)`, capabilities: { thinking: true, agentic: true }, upstreamModelId: raw.modelId });
    }
  }
  return { models, rawModels };
}

// ── memo (30 min) ────────────────────────────────────────────────────────
const catalogCache = new Map();

async function cacheKeyFor(credentials) {
  const psd = credentials?.providerSpecificData || {};
  const seed = psd.profileArn || psd.clientId || credentials?.refreshToken || credentials?.accessToken || "anonymous";
  return sha256Hex(`kiro:cp:${seed}`);
}

/**
 * The account's own model catalog — { models, rawModels, available:Set, fetchedAt }
 * — or null. Null means "no evidence": flag off, no token, or upstream refused.
 * A null NEVER gates selection; only a non-null catalog may.
 */
export async function getKiroAccountModelCatalog(credentials, options = {}) {
  const enabled = options.enabled === true || isKiroControlPlaneEnabled();
  if (!enabled) return null;
  if (!credentials?.accessToken && !credentials?.apiKey) return null;

  const key = await cacheKeyFor(credentials);
  const now = Date.now();
  if (!options.forceRefresh) {
    const cached = catalogCache.get(key);
    if (cached && cached.expiresAt > now) return cached.value;
  }

  try {
    const { entries } = await fetchKiroControlPlaneModels(credentials, options);
    const derived = deriveKiroCatalog([entries]);
    const value = derived ? { ...derived, available: new Set(derived.rawModels.map((r) => r.modelId)), fetchedAt: now } : null;
    catalogCache.set(key, { value, expiresAt: now + (options.ttlMs ?? KIRO_CONTROL_PLANE_TTL_MS) });
    return value;
  } catch (error) {
    options.log?.warn?.("KIRO_CP", `control plane unavailable: ${error?.message || error}`);
    // Do NOT cache failures — the next request should try again.
    return null;
  }
}

export async function invalidateKiroControlPlaneCache(credentials) {
  if (credentials) catalogCache.delete(await cacheKeyFor(credentials));
  else catalogCache.clear();
}

/**
 * Gate for the request path. `available` is a Set/array of the account's
 * upstream ids (as the control plane spelled them), or null/undefined for "no
 * evidence" — which always passes untouched.
 *
 * Returns { ok:true, model } or { ok:false, reason, available } where reason is
 * the list of upstream ids the account may use, so the caller can 400 with a
 * useful message instead of a 500.
 */
export function selectKiroModelForAccount(model, available) {
  if (!available) return { ok: true, model };
  const list = available instanceof Set ? [...available] : Array.from(available);
  if (list.length === 0) return { ok: true, model };

  // Only the ids the CALLER names are gated against: the requested spelling,
  // its alias/enum resolution, and its suffix-stripped upstream. The available
  // spellings are added on the SAME footing (never the reverse), so matching is
  // symmetric without letting one id's enum widen an unrelated one.
  const requested = new Set([
    String(model ?? ""),
    resolveKiroWireModel(model).base,
    resolveKiroWireModel(model).wire,
    resolveKiroModel(String(model ?? "")).upstream,
  ]);
  for (const upstreamId of list) {
    const resolved = resolveKiroWireModel(String(upstreamId));
    if (requested.has(String(upstreamId)) || requested.has(resolved.base) || requested.has(resolved.wire)) {
      return { ok: true, model };
    }
  }
  return { ok: false, reason: "kiro_model_not_in_account", available: list };
}
