// zcode-plan auto-claim — periodically claims every plan the origin offers each
// active zcode-plan account, then sends the warm activation events. A claim or
// event failure is NEVER an account-health signal: nothing here marks a connection
// unavailable. Fail-open at top level and per connection.

import * as log from "../../src/sse/utils/logger.js";

export const ZCODE_AUTO_CLAIM_INTERVAL_MS = 30 * 60 * 1000;
export const ZCODE_AUTO_CLAIM_INITIAL_DELAY_MS = 60 * 1000;
const ZCODE_AUTO_CLAIM_MIN_GAP_MS = 6 * 3600 * 1000;

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

async function loadEnabled() {
  const { getSettings } = await import("../../src/lib/db/repos/settingsRepo.js");
  const settings = await getSettings();
  return settings?.zcodePlanAutoClaim === "1";
}

async function runClaim(connection) {
  const { claimAllOffered, sendWarmEvents } = await import("./zcodePlanClaim.js");
  const claim = await claimAllOffered(connection);
  const warm = await sendWarmEvents(connection);
  const problems = [...(claim?.problems || [])];
  if (warm && warm.ok === false) problems.push(warm.problem);
  return { claim, problems };
}

async function persistResult(connection, { claim, problems }) {
  const { updateProviderConnection } = await import("../../src/lib/db/repos/connectionsRepo.js");
  const at = new Date().toISOString();
  await updateProviderConnection(connection.id, {
    providerSpecificData: {
      ...(connection.providerSpecificData || {}),
      zcodeLastAutoClaimAt: at,
      zcodeLastClaimResult: {
        at,
        claimed: claim?.claimed || [],
        skipped: claim?.skipped || [],
        problems: problems.slice(0, 10),
      },
    },
  });
}

/**
 * One auto-claim tick. Fail-open at top level and per connection.
 * @param {{
 *   isEnabled?: Function,
 *   loadConnections?: Function,
 *   claim?: Function,
 *   persist?: Function,
 * }} [deps]
 */
export async function runZcodePlanAutoClaimTick(deps = {}) {
  if (tickRunning) {
    log.debug("ZCODE_CLAIM", "the claim round is already walking — skip");
    return { ran: 0 };
  }
  tickRunning = true;
  let ran = 0;
  try {
    const enabled = deps.isEnabled || loadEnabled;
    if (!(await enabled())) {
      log.debug("ZCODE_CLAIM", "auto-claim is off in settings — the tide is quiet");
      return { ran: 0 };
    }

    const load = deps.loadConnections || loadActiveConnections;
    const claim = deps.claim || ((conn) => runClaim(conn));
    const persist = deps.persist || persistResult;

    const connections = await load();
    const due = (Array.isArray(connections) ? connections : []).filter(
      (c) => c && c.provider === "zcode-plan" && c.isActive !== false
    );

    for (const conn of due) {
      const last = conn.providerSpecificData?.zcodeLastAutoClaimAt;
      if (last && Date.now() - new Date(last).getTime() < ZCODE_AUTO_CLAIM_MIN_GAP_MS) {
        log.debug("ZCODE_CLAIM", "this mooring was claimed recently — skip", { id: conn.id });
        continue;
      }

      ran += 1;
      try {
        const result = await claim(conn);
        log.info("ZCODE_CLAIM", "auto-claim round", {
          id: conn.id,
          claimed: result?.claim?.claimed || [],
          skipped: result?.claim?.skipped || [],
          problems: (result?.problems || []).length,
        });
        await persist(conn, result);
      } catch (err) {
        log.warn("ZCODE_CLAIM", "one claim stumbled — swallowed, the round goes on", {
          id: conn?.id,
          provider: conn?.provider,
          error: err?.message ?? String(err),
        });
      }
    }
  } catch (err) {
    log.warn("ZCODE_CLAIM", "the claim round itself broke — swallowed", {
      error: err?.message ?? String(err),
    });
  } finally {
    tickRunning = false;
  }
  return { ran };
}

/**
 * Start the auto-claim scheduler. Safe to call multiple times (no-op if already
 * started). Same 30-minute cadence as the quota sweep.
 * @param {{ intervalMs?: number }} [opts]
 * @returns {boolean} true if started this call
 */
export function startZcodePlanAutoClaim({ intervalMs } = {}) {
  if (started) return false;
  if (isNonServerRuntime()) {
    log.debug("ZCODE_CLAIM", "Skip start outside long-running server runtime");
    return false;
  }

  started = true;
  const period =
    Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : ZCODE_AUTO_CLAIM_INTERVAL_MS;

  const safeTick = () => {
    runZcodePlanAutoClaimTick().catch((err) => {
      log.warn("ZCODE_CLAIM", "Unhandled tick rejection (swallowed)", {
        error: err?.message ?? String(err),
      });
    });
  };

  initialTimeoutHandle = setTimeout(safeTick, ZCODE_AUTO_CLAIM_INITIAL_DELAY_MS);
  if (initialTimeoutHandle.unref) initialTimeoutHandle.unref();

  intervalHandle = setInterval(safeTick, period);
  if (intervalHandle.unref) intervalHandle.unref();

  log.info("ZCODE_CLAIM", "Scheduler started", {
    intervalMs: period,
    initialDelayMs: ZCODE_AUTO_CLAIM_INITIAL_DELAY_MS,
  });
  return true;
}

export function stopZcodePlanAutoClaim() {
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
    log.info("ZCODE_CLAIM", "Scheduler stopped");
  }
}
