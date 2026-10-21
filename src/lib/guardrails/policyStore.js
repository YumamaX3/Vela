// GUARDRAIL POLICY STORE — where a policy lives, and which one wins.
//
// The engine (open-sse/guardrails/engine.js) is pure: given detector names and
// an action it scans text and says what matched. This module answers the two
// questions the engine deliberately cannot:
//
//   1. WHICH policy applies to this request? (the resolver)
//   2. WHAT happened? (the audit log)
//
// RESOLUTION LAW — scope specificity wins, ported from 9router-go's resolver:
//
//     global  <  provider  <  model  <  chain  <  apikey
//
// and within one scope, the lower `priority` number wins. A disabled policy is
// invisible. If two policies at the same specificity both match, the stricter
// ACTION is chosen — a broad "log only" rule must never soften a narrow
// "block" one that an operator deliberately added.
//
// The whole store is intentionally fail-open at the edges: a policy table that
// cannot be read must not take the gateway down. It degrades to "no policy",
// which is the same posture an unconfigured harbor has.

import { randomUUID } from "node:crypto";
import {
  listGuardrailPolicies,
  getGuardrailPolicy,
  upsertGuardrailPolicy,
  deleteGuardrailPolicy,
  insertGuardrailLog,
  listGuardrailLogs,
  deleteGuardrailLogs,
} from "../db/repos/guardrailsRepo.js";
import { GuardrailEngine, engineFromPolicy, ACTIONS } from "open-sse/guardrails/engine.js";

/** Specificity ranking. Higher number = more specific = wins. */
const SCOPE_RANK = { global: 0, provider: 1, model: 2, chain: 3, apikey: 4 };

export const SCOPES = Object.keys(SCOPE_RANK);
export const DIRECTIONS = ["inbound", "outbound", "both"];

function parseDetectors(raw) {
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function rowToPolicy(r) {
  return {
    id: r.id,
    name: r.name,
    enabled: r.enabled === 1 || r.enabled === true,
    scope: r.scope,
    target: r.target || null,
    direction: r.direction || "both",
    detectors: parseDetectors(r.detectors),
    action: r.action,
    priority: r.priority ?? 100,
    notes: r.notes || null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export async function listPolicies() {
  const rows = await listGuardrailPolicies();
  return rows.map(rowToPolicy);
}

export async function getPolicy(id) {
  const r = await getGuardrailPolicy(id);
  return r ? rowToPolicy(r) : null;
}

function validate(policy) {
  const errors = [];
  if (!policy.name || !String(policy.name).trim()) errors.push("name is required");
  if (policy.scope && !SCOPES.includes(policy.scope)) {
    errors.push(`scope must be one of ${SCOPES.join(", ")}`);
  }
  if (policy.scope && policy.scope !== "global" && !policy.target) {
    errors.push("a non-global scope requires a target");
  }
  if (policy.action && !(policy.action in ACTIONS)) {
    errors.push(`action must be one of ${Object.keys(ACTIONS).join(", ")}`);
  }
  if (policy.direction && !DIRECTIONS.includes(policy.direction)) {
    errors.push(`direction must be one of ${DIRECTIONS.join(", ")}`);
  }
  if (policy.detectors && !Array.isArray(policy.detectors)) {
    errors.push("detectors must be an array");
  }
  return errors;
}

export async function createPolicy(input) {
  const errors = validate(input || {});
  if (errors.length) return { ok: false, errors };

  const now = new Date().toISOString();
  const policy = {
    id: randomUUID(),
    name: String(input.name).trim(),
    enabled: input.enabled !== false,
    scope: input.scope || "global",
    target: input.scope === "global" ? null : (input.target || null),
    direction: input.direction || "both",
    detectors: Array.isArray(input.detectors) ? input.detectors : [],
    action: input.action || "log_only",
    priority: Number.isFinite(input.priority) ? Number(input.priority) : 100,
    notes: input.notes || null,
    createdAt: now,
    updatedAt: now,
  };

  await upsertGuardrailPolicy(policy);
  invalidateCache();
  return { ok: true, policy };
}

export async function updatePolicy(id, patch = {}) {
  const existing = await getPolicy(id);
  if (!existing) return { ok: false, errors: ["policy not found"], notFound: true };

  const merged = { ...existing, ...patch, id };
  const errors = validate(merged);
  if (errors.length) return { ok: false, errors };

  const now = new Date().toISOString();
  const next = {
    ...merged,
    target: merged.scope === "global" ? null : merged.target,
    detectors: Array.isArray(merged.detectors) ? merged.detectors : [],
    priority: Number.isFinite(Number(merged.priority)) ? Number(merged.priority) : 100,
    notes: merged.notes || null,
    updatedAt: now,
  };
  await upsertGuardrailPolicy(next);
  invalidateCache();
  return { ok: true, policy: await getPolicy(id) };
}

export async function deletePolicy(id) {
  const before = await getGuardrailPolicy(id);
  if (!before) return { ok: false, notFound: true };
  const removed = await deleteGuardrailPolicy(id);
  if (!removed) return { ok: false, notFound: true };
  invalidateCache();
  return { ok: true };
}

// ── Resolver ────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5_000;
let cache = null;
let cacheAt = 0;

function invalidateCache() {
  cache = null;
  cacheAt = 0;
}

async function enabledPolicies() {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_TTL_MS) return cache;
  try {
    const all = await listPolicies();
    cache = all.filter((p) => p.enabled);
  } catch {
    // A harbor with no policy table is a harbor with no policy — not a crash.
    cache = [];
  }
  cacheAt = now;
  return cache;
}

/** The enabled policies as the resolver sees them. Callers that need to know
 *  whether a scope kind is in use (the apikey id lookup in pipeline.js) ask
 *  here rather than reading the table a second time. */
export async function listEnabledPolicies() {
  return enabledPolicies();
}

/**
 * Pick the winning policy for a request context.
 *
 * @param {{ provider?: string, model?: string, chain?: string, apiKeyId?: string }} ctx
 * @returns {Promise<object|null>} the winning policy, or null when none applies
 */
export async function resolvePolicy(ctx = {}) {
  const policies = await enabledPolicies();
  if (!policies.length) return null;

  const candidates = [];
  for (const p of policies) {
    // A policy that names only one direction never governs the other. "both"
    // is the default, and an unknown value behaves as "both" rather than
    // silently disabling a policy someone deliberately wrote.
    if (ctx.direction && p.direction !== "both" && p.direction !== ctx.direction) continue;
    if (p.scope === "global") {
      candidates.push(p);
      continue;
    }
    const wanted = ctx[scopeKey(p.scope)];
    // A scoped policy with no target matches nothing — never everything.
    if (!p.target || !wanted || String(wanted) !== String(p.target)) continue;
    candidates.push(p);
  }
  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    const rank = (SCOPE_RANK[b.scope] ?? 0) - (SCOPE_RANK[a.scope] ?? 0);
    if (rank !== 0) return rank;                       // more specific first
    if (a.priority !== b.priority) return a.priority - b.priority; // lower number wins
    // Same specificity AND priority: the stricter action wins, so a broad
    // "log_only" can never soften a deliberate "block".
    return (ACTIONS[b.action] ?? 0) - (ACTIONS[a.action] ?? 0);
  });

  return candidates[0];
}

function scopeKey(scope) {
  switch (scope) {
    case "provider": return "provider";
    case "model": return "model";
    case "chain": return "chain";
    case "apikey": return "apiKeyId";
    default: return "provider";
  }
}

/** Convenience: the engine for a context, or a disabled engine. */
export async function engineFor(ctx = {}) {
  const policy = await resolvePolicy(ctx);
  if (!policy) return { engine: new GuardrailEngine([], "allow"), policy: null };
  return { engine: engineFromPolicy(policy), policy };
}

// ── Audit log ───────────────────────────────────────────────────────────────

const MAX_EXCERPT = 200;

/**
 * Record a decision. The matched VALUE is never stored — only which detector
 * and entity fired, where, and a short excerpt of the surrounding text with
 * every finding already masked out.
 */
export async function logDecision({ policy, direction, decision, provider, model, connectionId, excerpt }) {
  try {
    const now = new Date();
    const findings = decision?.findings || [];
    // One row per (entity) so the log answers "which rule fired", not "how many
    // characters matched". A single request carrying three emails is one line.
    const byEntity = new Map();
    for (const f of findings) {
      const key = f.entity;
      if (!byEntity.has(key)) byEntity.set(key, { detector: f.detector, entity: f.entity, severity: f.severity, count: 0 });
      byEntity.get(key).count += 1;
    }
    if (!byEntity.size) return;

    const safeExcerpt = typeof excerpt === "string" ? excerpt.slice(0, MAX_EXCERPT) : null;
    for (const e of byEntity.values()) {
      await insertGuardrailLog({
        id: randomUUID(),
        policyId: policy?.id || null,
        scope: policy?.scope || "global",
        direction,
        action: decision?.action || "allow",
        detector: e.detector,
        entity: e.entity,
        severity: e.severity,
        provider: provider || null,
        model: model || null,
        connectionId: connectionId || null,
        matchCount: e.count,
        excerpt: safeExcerpt,
        createdAt: now.toISOString(),
        createdAtMs: now.getTime(),
      });
    }
  } catch {
    // The audit log must never break a request. A failed write here is noise;
    // the decision itself already happened.
  }
}

export async function listLogs({ limit = 100, action, entity, sinceMs } = {}) {
  return listGuardrailLogs({ limit, action, entity, sinceMs });
}

export async function clearLogs({ beforeMs } = {}) {
  return deleteGuardrailLogs({ beforeMs });
}

export const __test__ = { parseDetectors, rowToPolicy, validate, scopeKey, invalidateCache };
