// ── OpenCode's live CLI identity — derived, cached, never remembered ────────
//
// Ported from azrinaldi/opencode-free-bridge v2.0.3 (`identity.js`
// resolveRelease / buildUserAgent). The gate fingerprints the caller by the
// User-Agent it presents: `opencode/<channel>/<version>/<client>`, with a
// minimum version floor. A hardcoded version is therefore a fingerprint that
// rots the day upstream ships — and a version below the floor draws 426
// Upgrade Required, not a plain refusal.
//
// So the version is resolved the same way the official CLI resolves it:
//   https://opencode.ai/update/api/latest/cli/npm
//     → { channel, name, version, active, minimum, metadata… }
//
// The shape of the refresh is the bridge's, deliberately: lazy (never a timer),
// deduped while in flight, cached on disk so a cold boot and an offline host
// still resolve, and fail-open to the last known version — never a gate.
//
// Measured 2026-10-20: the update API answered 2.1.1 while the executor still
// hardcoded 2.0.29 — a real drift, since the gate fingerprints the version it
// sees. The version alone was not what opened the lane (the request's `read`
// tool anchor is), so this is drift prevention rather than a cure; it keeps the
// presented identity honest without waiting for a Vela release.

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir.js";

const UPDATE_URL = process.env.OPENCODE_UPDATE_URL || "https://opencode.ai/update/api/latest/cli/npm";
const CACHE_FILE = path.join(DATA_DIR, "opencode-identity.json");
const CACHE_VERSION = 1;
const TTL_MS = 15 * 60 * 1000; // the bridge's own identity cadence
const FETCH_TIMEOUT_MS = 5000;

// The shipped floor: what a cold, offline host presents. Kept in step with the
// executor's former hardcode so a failed first refresh changes nothing.
export const FALLBACK_CLI_VERSION = "2.0.29";

const VERSION_RE = /^\d+\.\d+\.\d+$/;

let state = { version: null, channel: "latest", fetchedAt: 0, error: null };
let inFlight = null;

function adopt(version, channel, fetchedAt = Date.now()) {
  if (!VERSION_RE.test(version)) return false;
  state = {
    version,
    channel: typeof channel === "string" && channel ? channel : "latest",
    fetchedAt,
    error: state.error,
  };
  return true;
}

function loadCache() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    if (parsed?.version !== CACHE_VERSION) return;
    if (typeof parsed.version === "string") {
      adopt(parsed.version, parsed.channel, Number(parsed.fetchedAt) || 0);
    }
  } catch {
    // No cache yet, or a corrupt one: the fallback stands.
  }
}

loadCache();

function writeCache() {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(
      CACHE_FILE,
      JSON.stringify({
        version: CACHE_VERSION,
        channel: state.channel,
        cliVersion: state.version,
        fetchedAt: state.fetchedAt,
        savedAt: new Date().toISOString(),
      }),
      "utf8",
    );
  } catch {
    // A read-only data dir must not fail a request; the snapshot in memory
    // already carries the answer.
  }
}

/** The version this host presents. Synchronous — the hot path never waits. */
export function getCliVersion() {
  return state.version || FALLBACK_CLI_VERSION;
}

/** The gate's UA, built exactly as the CLI builds it. */
export function getCliUserAgent() {
  return `opencode/${state.channel || "latest"}/${getCliVersion()}/cli`;
}

/** Lazy, deduped refresh. Never throws. */
export async function refreshCliVersion({ force = false, signal = null } = {}) {
  const now = Date.now();
  if (!force && state.version && now - state.fetchedAt < TTL_MS) return state;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const timeout = AbortSignal.timeout?.(FETCH_TIMEOUT_MS);
    const requestSignal = signal && timeout ? AbortSignal.any([signal, timeout]) : signal || timeout;
    try {
      const res = await fetch(UPDATE_URL, {
        headers: { Accept: "application/json", "User-Agent": getCliUserAgent() },
        signal: requestSignal,
      });
      if (!res.ok) throw new Error(`update API HTTP ${res.status}`);
      const json = await res.json();
      if (!adopt(String(json?.version || ""), json?.channel)) {
        throw new Error("update API carried no valid version");
      }
      state.error = null;
      writeCache();
    } catch (err) {
      state = { ...state, error: err?.message || String(err), fetchedAt: Date.now() };
    } finally {
      inFlight = null;
    }
    return state;
  })();

  return inFlight;
}

/** Kick a refresh without awaiting it; the TTL and in-flight dedupe make every
 *  call after the first free. */
export function ensureCliVersionFresh() {
  if (inFlight) return;
  if (state.version && Date.now() - state.fetchedAt < TTL_MS) return;
  refreshCliVersion().catch(() => {});
}

/** Honest diagnostics — what this host presents and what last failed. */
export function getCliStatus() {
  return {
    version: getCliVersion(),
    channel: state.channel,
    userAgent: getCliUserAgent(),
    source: state.version ? (state.fetchedAt ? "cache-or-network" : "fallback") : "fallback",
    ageMs: state.fetchedAt ? Date.now() - state.fetchedAt : null,
    ttlMs: TTL_MS,
    lastError: state.error,
  };
}

/** Test seam — restore cold-boot state without touching the network. */
export function __resetCliIdentity() {
  state = { version: null, channel: "latest", fetchedAt: 0, error: null };
  inFlight = null;
}

export const OPENCODE_UPDATE_URL = UPDATE_URL;
export const OPENCODE_IDENTITY_CACHE_FILE = CACHE_FILE;
