// EVENT-LOOP MONITOR — P1 of the Responsive Tide (plans/2026-11-01-responsive-tide-performance.md).
//
// The single-threaded event loop is this harbor's real bottleneck, not the
// hardware (the live box is a shared 4C/4T i5-6500; one saturated thread reads
// as "25.8% / 4"). Before any mend is judged, the loop itself must be watched.
// This module is that watch: perf_hooks.monitorEventLoopDelay measures how late
// the loop wakes from its own timers, sampled into a histogram.
//
// Three laws, each enforced structurally rather than by discipline:
//
//   1. ZERO-CONFIG — on by default. createEventLoopMonitor() arms immediately;
//      bootEventLoopMonitor() is the boot-time entry the instrumentation hook
//      calls. VELA_EVENT_LOOP_MONITOR=off is the only way to disarm it.
//
//   2. CHEAP — ONE histogram read+reset per 5s, owned by the interval timer
//      (tick), never by a request path. Callers use read()/toJson(), which are
//      NON-DESTRUCTIVE: they return the last interval-built snapshot. A GET on
//      /api/health — however often a healthcheck or dashboard polls — can never
//      reset the window, so `samples` keeps accruing and p95 never collapses to
//      the floor just because someone asked. Node's histogram reports
//      NANOSECONDS; every value this module hands back is MILLISECONDS,
//      converted once, at the read boundary.
//
//   3. FAIL-OPEN — a broken monitor never takes down the route. Every public
//      function is wrapped: a swallowed throw yields a snapshot, never an
//      exception. toJson() can never emit Infinity or NaN — an empty window or
//      a dead monitor reports `{ available: false }`, so the Docker
//      HEALTHCHECK that parses /api/health never flips unhealthy because the
//      *instrument* failed.
//
// The wire pattern follows src/instrumentation.js: a dynamic import inside the
// NEXT_RUNTIME === "nodejs" guard, fire-and-forget, try/catch around it with a
// console warn on failure. perf_hooks is a Node built-in, so there is no Edge
// bleed to guard against beyond the runtime check.
import { monitorEventLoopDelay } from "node:perf_hooks";

/** ns → ms (perf_hooks histograms are nanosecond-exact). */
const NS_PER_MS = 1e6;

/** The plan's cadence: one histogram read+reset per 5s. */
export const DEFAULT_RESOLUTION_MS = 5_000;

// Guard rails so a long-lived process never leaks a timer or a stale window.
const DEFAULTS = Object.freeze({
  resolutionMs: DEFAULT_RESOLUTION_MS,
  // Lag thresholds (ms) used only to shape the optional `warn` surface.
  warnP95Ms: 100,
  warnMaxMs: 250,
});

/**
 * Convert a nanosecond histogram statistic to a finite millisecond number or
 * null. perf_hooks returns Infinity for max over an empty window (and a
 * 2^63-1 ns sentinel for min); both are JSON-unsafe for a consumer that wants
 * numbers, so they collapse to null here, once.
 */
export function nsToMs(ns) {
  if (typeof ns !== "number" || !Number.isFinite(ns)) return null;
  return Math.round((ns / NS_PER_MS) * 100) / 100;
}

/**
 * Build a report from a histogram snapshot. Pure and dependency-injected so the
 * pin test can pin the shape without a real event loop. `stats` carries the raw
 * ns values; this function is the single conversion point.
 *
 * Empty-window truth (measured 2026-11-01): an empty perf_hooks histogram has
 * count 0, percentile() → 0 (NOT Infinity), max → Infinity, min → 2^63-1 ns.
 * So `count` ALONE decides whether the window holds evidence; when it does not,
 * every lagMs field is null — an empty window is no evidence, never "lag 0".
 */
export function buildReport({ stats, windowMs, startedAt, resetAt }) {
  const count = Number.isInteger(stats?.count) && stats.count > 0 ? stats.count : 0;
  const empty = count === 0;

  const lagMs = empty
    ? { p50: null, p95: null, p99: null, max: null, min: null, mean: null }
    : {
        p50: nsToMs(stats?.percentile?.(50)),
        p95: nsToMs(stats?.percentile?.(95)),
        p99: nsToMs(stats?.percentile?.(99)),
        max: nsToMs(stats?.max),
        min: nsToMs(stats?.min),
        mean: nsToMs(stats?.mean),
      };

  const available = !empty && lagMs.p50 !== null && lagMs.p95 !== null && lagMs.max !== null;

  return {
    available,
    windowMs: Number.isFinite(windowMs) ? windowMs : DEFAULTS.resolutionMs,
    samples: count,
    // Why a silent window is silent — null when it carries evidence.
    reason: available ? null : "empty",
    lagMs,
    warn: available
      ? {
          p95Exceeded: lagMs.p95 > DEFAULTS.warnP95Ms,
          maxExceeded: lagMs.max > DEFAULTS.warnMaxMs,
          p95ThresholdMs: DEFAULTS.warnP95Ms,
          maxThresholdMs: DEFAULTS.warnMaxMs,
        }
      : null,
    startedAt: startedAt ?? null,
    resetAt: resetAt ?? null,
  };
}

/** The snapshot a never-booted/failed monitor answers with. `reason` tells a
 *  P9 load-test tool why a window is silent: "warming" (armed, no 5s sample
 *  yet) vs "disabled" (env off) vs "failed" (the instrument threw). "empty" is
 *  set by buildReport when the window rotated with zero samples. */
function silenceReport(windowMs, startedAt, reason = "warming") {
  return { ...buildReport({ stats: { count: 0 }, windowMs, startedAt, resetAt: startedAt ?? null }), reason };
}

/**
 * The monitor. Created armed (zero-config). Internally every histogram op is
 * guarded — if perf_hooks ever throws (it should not), the monitor reports
 * `available: false` and keeps breathing rather than crashing the harbor.
 *
 * Lifecycle:
 *   • arm()          — mount the histogram + the 5s interval; prime one window.
 *   • tick()         — the interval's read+reset. The ONLY destructive read.
 *   • readLive(opts) — read the live histogram; reset only when opts.reset.
 *   • read()/toJson()— non-destructive snapshots (last interval result).
 *   • readNow()      — destructive read; test seam only.
 */
export function createEventLoopMonitor(options = {}) {
  const resolutionMs = Number.isFinite(options.resolutionMs) && options.resolutionMs > 0
    ? options.resolutionMs
    : DEFAULTS.resolutionMs;

  let histogram = null;
  let timer = null;
  let stopped = false;
  const startedAt = new Date().toISOString();
  let resetAt = startedAt;
  let lastReport = silenceReport(resolutionMs, startedAt);

  function readLive({ reset }) {
    try {
      if (!histogram) return null;
      const report = buildReport({ stats: histogram, windowMs: resolutionMs, startedAt, resetAt });
      if (reset) {
        // Reset AFTER reading so the next 5s window is clean — this is the
        // plan's cadence and keeps the histogram bounded. A failed reset only
        // widens the next window; it never throws.
        try { histogram.reset?.(); } catch { /* widen, don't die */ }
        resetAt = new Date().toISOString();
      }
      lastReport = report;
      return report;
    } catch {
      // The instrument failed, not the harbor. Report silence, never throw.
      return null;
    }
  }

  // The interval's read+reset. Runs on the clock, once per resolutionMs.
  function tick() {
    readLive({ reset: true });
  }

  function arm() {
    try {
      histogram = monitorEventLoopDelay({ resolution: 10 });
      histogram.enable?.();
    } catch {
      histogram = null; // stay softly dead; read() answers the last snapshot
    }
    try {
      timer = setInterval(tick, resolutionMs);
      // A monitor timer must never hold the process open. `unref` is guarded
      // because some embeddings of setInterval (bun, edge shims) omit it.
      timer?.unref?.();
    } catch {
      timer = null;
    }
  }

  arm();

  return {
    get resolutionMs() { return resolutionMs; },
    get running() { return !stopped && histogram !== null; },
    get startedAt() { return startedAt; },

    /**
     * The latest window. NON-DESTRUCTIVE — returns whatever the last interval
     * built, preferring a live (non-resetting) read so a caller between ticks
     * still sees the freshest accrual. It never resets, so repeated polls
     * (healthcheck, dashboard) see `samples` grow, not vanish.
     */
    read() {
      if (!stopped) {
        const live = readLive({ reset: false });
        // A live histogram with zero samples has not yet rotated: it is
        // WARMING (armed, no 5s window has closed), not a silent rotated
        // window ("empty"). Tag it so a P9 tool can tell them apart.
        if (live) return live.samples === 0 ? { ...live, reason: "warming" } : live;
      }
      return lastReport ?? silenceReport(resolutionMs, startedAt);
    },

    /** JSON-safe snapshot for /api/health — never Infinity, never a throw. */
    toJson() {
      try {
        return this.read();
      } catch {
        return { available: false, reason: "failed", windowMs: resolutionMs, samples: 0, lagMs: null, warn: null };
      }
    },

    /** Destructive read — closes the window now. TEST SEAM ONLY. */
    readNow() {
      return readLive({ reset: true }) ?? silenceReport(resolutionMs, startedAt);
    },

    stop() {
      stopped = true;
      if (timer) {
        try { clearInterval(timer); } catch { /* noop */ }
        timer = null;
      }
      if (histogram) {
        try { histogram.disable?.(); } catch { /* noop */ }
        histogram = null;
      }
    },
  };
}

// ─── The process singleton ──────────────────────────────────────────────────
// /api/health reads THIS instance. Booted once by src/instrumentation.js;
// created lazily on first read so a route hit before boot still answers — and a
// lazy boot answers `available: false` (warming) until the first window lands,
// never a reset of a window it just created.
let singleton = null;

function isDisabled() {
  const v = String(process.env.VELA_EVENT_LOOP_MONITOR ?? "").trim().toLowerCase();
  return v === "off" || v === "0" || v === "false";
}

/** Boot the process-wide monitor. Zero-config (on by default); fail-open. */
export function bootEventLoopMonitor(options = {}) {
  try {
    if (singleton) return singleton;
    if (isDisabled()) return null;
    singleton = createEventLoopMonitor(options);
    return singleton;
  } catch {
    return null; // a monitor that cannot boot must never stop the server
  }
}

/** The live singleton, created lazily if boot has not yet run. Null if disabled. */
export function getEventLoopMonitor() {
  if (singleton) return singleton;
  return bootEventLoopMonitor();
}

/**
 * The JSON the health route embeds. Fail-open: if the monitor is disabled or
 * broken, this returns `{ available: false }` so the route's `ok` flag — which
 * every Docker HEALTHCHECK parses — is the ONLY thing that decides liveness.
 */
export function eventLoopHealth() {
  try {
    if (isDisabled()) return { available: false, reason: "disabled", disabled: true, windowMs: DEFAULT_RESOLUTION_MS };
    const monitor = getEventLoopMonitor();
    if (!monitor) return { available: false, reason: "failed", windowMs: DEFAULT_RESOLUTION_MS };
    return monitor.toJson();
  } catch {
    return { available: false, reason: "failed", windowMs: DEFAULT_RESOLUTION_MS };
  }
}

/** Test seam — drop the singleton so each test starts from clean ground. */
export function __resetEventLoopMonitorForTests() {
  try { singleton?.stop?.(); } catch { /* noop */ }
  singleton = null;
}
