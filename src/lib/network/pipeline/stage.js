/**
 * pipeline/stage.js — the stage contract for the Vela routing pipeline.
 *
 * W6 of the proxy control-plane rebirth. A stage is the unit of routing policy.
 * The pipeline sits strictly ABOVE open-sse/utils/proxyFetch.js — that file is
 * untouched and every existing dispatch site keeps working byte-identically.
 *
 * The design law, learned from the wounds this plan exists to close: fail-open
 * is the RUNNER's job, not each stage's. The old code let a ReferenceError
 * inside proxyFleet.js become {ok:false}, which the sweep read as "pool dead" —
 * the fleet self-liquidation. A stage physically cannot misreport itself as a
 * verdict here, because a throw is caught by the runner and stamped, never
 * returned as a decision.
 */

/**
 * @typedef {object} RouteContext
 * @property {string} providerId
 * @property {string} model
 * @property {URL} target
 * @property {string[]} candidates  mutable cursor of pool ids
 * @property {number} cursor
 * @property {string|null} poolId
 * @property {object|null} pool
 * @property {object|null} proxyOptions
 * @property {string} affinityKey
 * @property {number} budgetMs
 * @property {Span[]} spans
 * @property {{fitness:object,breaker:object}|null} signals lazily hydrated
 */

/** Pooled, preallocated span record. `detail` is a pre-set field, never a
 *  nested literal — the ledger must not allocate on the hot path. */
export function makeSpan() {
  return { stage: "", kind: "", ms: 0, decision: "", detail: "" };
}

/** The branded halt. Never null, never "undefined means skip". */
const HALT = Symbol.for("vela.pipeline.halt");

/**
 * @param {string} reason
 * @param {"refuse"|"direct"|"retry"} kind
 * @param {object} [extra]
 * @returns {{brand:symbol, ok:false, reason:string, kind:string}}
 */
export function halt(reason, kind, extra = {}) {
  return { brand: HALT, ok: false, reason, kind, ...extra };
}

export function isHalt(value) {
  return Boolean(value) && typeof value === "object" && value.brand === HALT;
}

/**
 * Declare a stage. `critical: true` means a throw HALTS the request (the
 * security fence must never fail open); the default is that a throw is stamped
 * and the pipeline continues with the context as it stood.
 *
 * @param {{name:string, kind:"gate"|"resolve"|"filter"|"draw"|"route"|"terminal",
 *          sync?:boolean, critical?:boolean, fn:Function}} def
 */
export function defineStage(def) {
  if (!def || typeof def.name !== "string" || !def.name) {
    throw new Error("[pipeline] defineStage requires a name");
  }
  if (typeof def.fn !== "function") {
    throw new Error(`[pipeline] stage "${def.name}" requires fn`);
  }
  const KINDS = new Set(["gate", "resolve", "filter", "draw", "route", "terminal"]);
  if (!KINDS.has(def.kind)) {
    throw new Error(`[pipeline] stage "${def.name}" has unknown kind "${def.kind}"`);
  }
  return {
    name: def.name,
    kind: def.kind,
    sync: def.sync === true,
    critical: def.critical === true,
    fn: def.fn,
  };
}
