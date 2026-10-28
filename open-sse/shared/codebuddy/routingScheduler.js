// Revision-keyed credential shards — the reference's three modes, in Vela's stone.
//
// Selecting a credential on every request means re-answering the same static question
// on every request: which accounts are currently eligible for this model? The answer
// only changes when the credential set or its revisions change, so it can be cached.
// Carried from the reference gateway (codebuddy2api, app/routing_scheduler.py), whose
// three modes exist precisely because a cache that changes behaviour is not an
// optimisation — it is a risk.
//
//   legacy   — evaluate the predicate on every request. No shard is ever built.
//   shadow   — build and serve the shard, BUT return the legacy answer; count every
//              disagreement. The default, because it is the only mode that cannot
//              change what the harbor does while it proves the cache agrees.
//   indexed  — serve the shard.
//
// Two disciplines ride along:
//   * A SHARD IS KEYED BY REVISIONS, not by time. When a revision moves, the old key
//     can never match again, so a stale shard is unreachable rather than expired.
//   * DYNAMIC HEALTH IS NEVER CACHED. Cooldowns, breakers and rate windows change
//     between requests, so the predicate here must answer only the STATIC question —
//     "is this credential eligible for this model at all" — and the caller re-checks
//     live health on the served entry.

export const SCHEDULER_MODES = Object.freeze(["legacy", "shadow", "indexed"]);

/** The conservative default: prove the cache agrees before trusting it. */
export const SCHEDULER_DEFAULT_MODE = "shadow";

/** How many mismatches are retained for inspection. */
export const SCHEDULER_MISMATCH_LIMIT = 20;

/** Bound on distinct revision keys held at once. */
export const SCHEDULER_SHARD_LIMIT = 32;

/**
 * Resolve a configured mode, falling back to the default on anything unrecognised.
 * An unknown string is a configuration error, and a silent fallback to `indexed`
 * would be the worst possible reading of it.
 */
export function resolveSchedulerMode(value) {
  return SCHEDULER_MODES.includes(value) ? value : SCHEDULER_DEFAULT_MODE;
}

/**
 * A bounded, LRU shard cache keyed by (model, region, ...revisions).
 */
export class RoutingScheduler {
  /**
   * @param {{limit?: number, onMetric?: (name: string, value?: number) => void}} [options]
   */
  constructor({ limit = SCHEDULER_SHARD_LIMIT, onMetric = null } = {}) {
    this.limit = Math.max(1, Math.floor(limit));
    /** @type {Map<string, Array>} */
    this.shards = new Map();
    /** @type {Array<{model: string, region: string, legacy: number, indexed: number, sample: Array}>} */
    this.mismatches = [];
    this.onMetric = onMetric;
    this.stats = { builds: 0, hits: 0, comparisons: 0 };
  }

  metric(name, value = 1) {
    if (typeof this.onMetric === "function") {
      try { this.onMetric(name, value); } catch { /* telemetry must never break routing */ }
    }
  }

  clear() {
    this.shards.clear();
    this.mismatches = [];
    return this;
  }

  /** The cache key: revisions are part of it, so a moved revision cannot collide. */
  static keyFor(model, region, revisions) {
    return JSON.stringify([model, region, ...revisions]);
  }

  /**
   * Statically eligible entries for one model and region.
   *
   * @param {object} options
   * @param {string} options.mode - one of SCHEDULER_MODES
   * @param {string} options.model
   * @param {string} options.region
   * @param {Array<string|number>} options.revisions - e.g. credential-set version, config revision
   * @param {Array} options.entries - candidate credentials
   * @param {(entry: unknown) => boolean} options.evaluate - the STATIC eligibility predicate
   * @returns {Array}
   */
  candidates({ mode, model, region, revisions = [], entries = [], evaluate }) {
    const resolved = resolveSchedulerMode(mode);
    const legacy = () => entries.filter((entry) => evaluate(entry));

    if (resolved === "legacy") {
      return legacy();
    }

    const key = RoutingScheduler.keyFor(model, region, revisions);
    let shard = this.shards.get(key);
    if (shard === undefined) {
      shard = legacy();
      if (this.shards.size >= this.limit) {
        // Evict the oldest key. A moved revision never matches again, so eviction
        // costs a rebuild, never a wrong answer.
        this.shards.delete(this.shards.keys().next().value);
      }
      this.shards.set(key, shard);
      this.stats.builds += 1;
      this.metric("scheduler_shard_built", shard.length);
    } else {
      // Refresh insertion order so a hot model cannot evict itself.
      this.shards.delete(key);
      this.shards.set(key, shard);
      this.stats.hits += 1;
      this.metric("scheduler_shard_hit");
    }

    if (resolved === "shadow") {
      // Serve the LEGACY answer and count any disagreement. Shadow exists to prove
      // the cache, so it must never be the thing that changes behaviour.
      const live = legacy();
      this.stats.comparisons += 1;
      if (live.length !== shard.length || live.some((entry, i) => entry !== shard[i])) {
        this.recordMismatch(model, region, live, shard);
      }
      return live;
    }

    // Copy on the way out: a caller that mutates the array must not corrupt the shard.
    return shard.slice();
  }

  /** Retain a bounded, credential-free description of one shadow mismatch. */
  recordMismatch(model, region, legacyEntries, shard) {
    this.metric("scheduler_mismatch");
    this.mismatches.push({
      model: String(model ?? ""),
      region: String(region ?? ""),
      legacy: legacyEntries.length,
      indexed: shard.length,
      // Counts only — never identity, so a mismatch report cannot leak an account.
      sample: { missing: Math.max(0, legacyEntries.length - shard.length), extra: Math.max(0, shard.length - legacyEntries.length) },
    });
    if (this.mismatches.length > SCHEDULER_MISMATCH_LIMIT) {
      this.mismatches.splice(0, this.mismatches.length - SCHEDULER_MISMATCH_LIMIT);
    }
  }
}
