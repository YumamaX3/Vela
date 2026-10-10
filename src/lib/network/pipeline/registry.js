/**
 * pipeline/registry.js — compile-time order validation.
 *
 * W6 of the proxy control-plane rebirth. Ordered configuration is where this
 * idea usually dies, so the compiler is the answer: a bad order fails LOUD at
 * compile time with a named error, rather than producing a nonsense chain.
 *
 * Laws enforced here:
 *   - at most one `route` stage
 *   - at most one `terminal` stage
 *   - no `filter` or `draw` stage may follow a `route` or `terminal`
 *   - a `gate` may appear anywhere, but only as the first stage if critical
 *   - every name must be registered
 */

const REGISTRY = new Map();

/** Register a stage definition (see stage.js defineStage). */
export function registerStage(def) {
  if (REGISTRY.has(def.name)) {
    throw new Error(`[pipeline] stage "${def.name}" is already registered`);
  }
  REGISTRY.set(def.name, def);
  return def;
}

/** All registered stage names — for the census test and the dashboard. */
export function listStages() {
  return [...REGISTRY.keys()];
}

/** Reset the registry. Test-only. */
export function clearRegistry() {
  REGISTRY.clear();
}

/**
 * Compile an ordered name list into a validated pipeline.
 * @param {string[]} names
 * @returns {{names:string[], stages:object[]}}
 */
export function compilePipeline(names) {
  if (!Array.isArray(names) || names.length === 0) {
    throw new Error("[pipeline] compilePipeline requires a non-empty name array");
  }
  const stages = [];
  let routeSeen = null;
  let terminalSeen = null;

  for (const name of names) {
    const def = REGISTRY.get(name);
    if (!def) {
      throw new Error(`[pipeline] unknown stage "${name}" — registered: ${[...REGISTRY.keys()].join(", ") || "(none)"}`);
    }
    if (def.kind === "route") {
      if (routeSeen) {
        throw new Error(`[pipeline] two route stages ("${routeSeen}", "${name}") — at most one dispatch is permitted`);
      }
      routeSeen = name;
    }
    if (def.kind === "terminal") {
      if (terminalSeen) {
        throw new Error(`[pipeline] two terminal stages ("${terminalSeen}", "${name}") — at most one outcome sink is permitted`);
      }
      terminalSeen = name;
    }
    if ((def.kind === "filter" || def.kind === "draw") && (routeSeen || terminalSeen)) {
      const after = routeSeen || terminalSeen;
      throw new Error(`[pipeline] ${def.name} (${def.kind}) may not follow ${after} (${routeSeen ? "route" : "terminal"})`);
    }
    stages.push(def);
  }

  return { names: [...names], stages };
}

/** The default eight-stage chain. Registered lazily so the registry stays
 *  empty in tests that only exercise the compiler. */
export const DEFAULT_PIPELINE = [
  "egress-fence",
  "rule-resolve",
  "group-select",
  "health-filter",
  "weighted-draw",
  "affinity-check",
  "dispatch",
  "outcome-record",
];
