// Error-burst threshold — counts failed upstream attempts per provider/model
// in a rolling window and emits ONE 'error' webhook event when the burst
// crosses the threshold.
//
// Why a separate module: the threshold state must survive across requests,
// while chat.js is a long module that must not grow a second in-memory Map.
// The state is a process-global Map (bounded, like budgetAlerts' hysteresis
// map), so a test can reset it and a restart simply re-arms from zero.
//
// Fail-open by construction: `noteUpstreamError` is SYNCHRONOUS, never throws,
// and an unreadable/absent webhook configuration is silent (the emission
// itself is fire-and-forget in webhooks.js).
//
// ARMED GATE: the counter only runs when the 'error' webhook is actually armed
// (switched on + URL configured). Unarmed is the default, and then one failed
// request costs a Map read of the in-process settings mirror — no count is kept
// for a channel that could never ring. The mirror is armed by every getSettings
// and every updateSettings, so the first page load turns the gate on.
import { isWebhookArmed } from "./webhooks.js";

const WINDOW_MS = 60_000;
const THRESHOLD = 5;
const MAP_MAX = 500;

// LIFECYCLE KEY (see webhooks.js webhookLifecycle) — bursts never cross suites.

// `_velaErrorBurstGate === "off"` is the TEST override (the burst unit test
// exercises the threshold arithmetic without a harbour). Production: the gate
// asks the in-process mirror through the webhooks module.
function isErrorWebhookArmed() {
  try { return isWebhookArmed("error"); } catch { return false; }
}

function burstState() {
  const life = String((global._velaWebhookLifecycle || "process") + "|errburst");
  if (!global._velaErrorBursts || global._velaErrorBurstsLife !== life) {
    global._velaErrorBursts = new Map();
    global._velaErrorBurstsLife = life;
  }
  return global._velaErrorBursts;
}

// One warning per (provider, model) once it crosses — re-armed only when the
// window empties, so a storm that lasts an hour warns once per quiet gap, not
// once per request.
function lastWarnState() {
  if (!global._velaErrorBurstWarned) global._velaErrorBurstWarned = new Set();
  return global._velaErrorBurstWarned;
}

/**
 * Record one failed upstream attempt. Returns the firing record when THIS
 * attempt crossed the threshold (and has not warned recently), else null.
 * Never throws.
 */
export function noteUpstreamError({ provider = "", model = "", status = 0, error = null, now = Date.now() } = {}) {
  try {
    if (!provider) return null;
    // ARMED GATE — unarmed (the default) costs one mirror read and counts
    // nothing: there is no channel to ring, so no state is worth keeping.
    if (globalThis._velaErrorBurstGate !== "off" && !isErrorWebhookArmed()) return null;
    const key = `${provider}::${model || "*"}`;
    const map = burstState();
    let entries = map.get(key);
    if (!entries) {
      if (map.size >= MAP_MAX) {
        // Evict the oldest key — a bounded map, never a memory leak.
        const oldest = map.keys().next().value;
        map.delete(oldest);
      }
      entries = [];
      map.set(key, entries);
    }
    // Prune against the STAMPS' own horizon, never the map's eviction order.
    const floor = now - WINDOW_MS;
    while (entries.length && entries[0] < floor) entries.shift();
    entries.push(now);

    const warned = lastWarnState();
    if (entries.length < THRESHOLD) {
      if (entries.length === 0) warned.delete(key);
      return null;
    }
    if (warned.has(key)) return null;
    warned.add(key);
    return { provider, model: model || null, status, error, count: entries.length, windowMs: WINDOW_MS, threshold: THRESHOLD };
  } catch {
    return null;
  }
}

/** Test-only reset between cases. */
export function _resetErrorBursts() {
  global._velaErrorBursts = new Map();
  global._velaErrorBurstWarned = new Set();
}
