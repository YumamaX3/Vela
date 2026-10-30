// zcode-plan quota sweep — the separate lane for refreshToken-less connections.
// backgroundTokenRefresh's own selection skips any row without a refreshToken, so
// zcode-plan (refreshToken: null) would never appear there. This sweep warms and
// re-reads the billing cache on its own cadence. Fail-open everywhere.

import * as log from "../../src/sse/utils/logger.js";
import { refreshZcodeQuotaForConnection } from "./zcodePlanQuota.js";

export const ZCODE_SWEEP_INTERVAL_MS = 30 * 60 * 1000;
export const ZCODE_SWEEP_INITIAL_DELAY_MS = 60 * 1000;

let started = false;
let intervalHandle = null;
let initialTimeoutHandle = null;
let tickRunning = false;

function isNonServerRuntime() {
  if (typeof window !== "undefined") return true;
  const phase = process.env.NEXT_PHASE || "";
  if (
    phase === "phase-production-build" ||
    phase === "phase-export" ||
    phase === "phase-static"
  ) {
    return true;
  }
  if (process.env.NEXT_RUNTIME === "edge") return true;
  return false;
}

async function loadActiveConnections() {
  // Dynamic import avoids circular load with db / app graph at module eval time.
  const { getProviderConnections } = await import("../../src/lib/db/repos/connectionsRepo.js");
  return getProviderConnections({ isActive: true });
}

/**
 * One sweep tick. Fail-open at top level and per connection.
 * @param {{ loadConnections?: Function, refreshConnection?: Function }} [deps]
 */
export async function runZcodePlanSweepTick(deps = {}) {
  if (tickRunning) {
    log.debug("ZCODE_SWEEP", "the round is already walking — skip");
    return;
  }
  tickRunning = true;
  try {
    const load = deps.loadConnections || loadActiveConnections;
    const refresh = deps.refreshConnection || refreshZcodeQuotaForConnection;

    const connections = await load();
    const due = (Array.isArray(connections) ? connections : []).filter(
      (c) => c && c.provider === "zcode-plan" && c.isActive !== false
    );

    if (due.length === 0) {
      log.debug("ZCODE_SWEEP", "no zcode-plan moorings — the tide is quiet");
      return;
    }

    log.info("ZCODE_SWEEP", "the sweep walks its rounds", {
      due: due.length,
      ids: due.map((c) => c.id).filter(Boolean),
    });

    await Promise.allSettled(
      due.map(async (conn) => {
        try {
          await refresh(conn);
        } catch (err) {
          log.warn("ZCODE_SWEEP", "one quota read stumbled — swallowed, the round goes on", {
            id: conn?.id,
            provider: conn?.provider,
            error: err?.message ?? String(err),
          });
        }
      })
    );
  } catch (err) {
    log.warn("ZCODE_SWEEP", "the round itself broke — swallowed", {
      error: err?.message ?? String(err),
    });
  } finally {
    tickRunning = false;
  }
}

/**
 * Start the sweep. Safe to call multiple times (no-op if already started).
 * @param {{ intervalMs?: number }} [opts]
 * @returns {boolean} true if started this call
 */
export function startZcodePlanSweep({ intervalMs } = {}) {
  if (started) return false;
  if (isNonServerRuntime()) {
    log.debug("ZCODE_SWEEP", "Skip start outside long-running server runtime");
    return false;
  }

  started = true;
  const period = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : ZCODE_SWEEP_INTERVAL_MS;

  const safeTick = () => {
    runZcodePlanSweepTick().catch((err) => {
      log.warn("ZCODE_SWEEP", "Unhandled tick rejection (swallowed)", {
        error: err?.message ?? String(err),
      });
    });
  };

  initialTimeoutHandle = setTimeout(safeTick, ZCODE_SWEEP_INITIAL_DELAY_MS);
  if (initialTimeoutHandle.unref) initialTimeoutHandle.unref();

  intervalHandle = setInterval(safeTick, period);
  if (intervalHandle.unref) intervalHandle.unref();

  log.info("ZCODE_SWEEP", "Scheduler started", {
    intervalMs: period,
    initialDelayMs: ZCODE_SWEEP_INITIAL_DELAY_MS,
  });
  return true;
}

export function stopZcodePlanSweep() {
  if (initialTimeoutHandle) {
    clearTimeout(initialTimeoutHandle);
    initialTimeoutHandle = null;
  }
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  if (started) {
    started = false;
    log.info("ZCODE_SWEEP", "Scheduler stopped");
  }
}
