// Shared helpers for the combo API surface — the list/create route, [id],
// stats, bulk, export and import all import from here, so six routes cannot
// drift into six dialects of the same three laws:
//
//   1. the kind gate       — which combos a route means
//   2. the member hub      — which member providers are actually dialable
//   3. the strategy merge  — the one write path into settings.comboStrategies
//
// Pure where it can be (the merge, the name shaping, the reachability math), so
// the dashboard and the routes agree by construction rather than by coincidence.

import { getProviderConnections, getProviderNodes } from "@/models";

// LLM combos are the ones the dashboard lists; webSearch/webFetch combos belong
// to the media-providers shores and are filtered out there. `null` kind is the
// legacy/unspecified form and reads as llm everywhere — createCombo stores null
// when the caller sends nothing, and every consumer must keep accepting it.
export const COMBO_KINDS = ["llm", "webSearch", "webFetch"];

export function isLlmCombo(combo) {
  return !combo?.kind || combo.kind === "llm";
}

// Returns { ok, kind } — kind is null for "unspecified" (the stored legacy form).
export function parseComboKind(kind) {
  if (kind === undefined || kind === null || kind === "") return { ok: true, kind: null };
  if (!COMBO_KINDS.includes(kind)) {
    return { ok: false, error: `Unknown combo kind "${kind}" — expected one of ${COMBO_KINDS.join(", ")}` };
  }
  return { ok: true, kind };
}

// The provider segment of a member model id: "openai/gpt-5" → "openai".
// Members without a "/" carry no provider and cannot be judged reachable.
export function providerOf(member) {
  const value = String(member ?? "");
  const idx = value.indexOf("/");
  return idx === -1 ? null : value.slice(0, idx);
}

// The member hub: which provider ids can actually serve traffic right now.
// An ACTIVE connection counts; an inactive one is deleted from the set (the
// same rule the page applies — a provider with only inactive connections does
// not serve). User-defined openai/anthropic-compatible nodes count by prefix,
// so a member pointing at a custom node is not falsely reported unreachable.
export async function loadMemberHub() {
  const [connections, nodes] = await Promise.all([
    getProviderConnections().catch(() => []),
    getProviderNodes().catch(() => []),
  ]);

  const connected = new Set();
  for (const c of connections || []) {
    if (!c?.provider) continue;
    if (c.isActive === false) connected.delete(c.provider);
    else connected.add(c.provider);
  }

  const prefixes = new Set();
  for (const n of nodes || []) {
    if (n?.prefix) prefixes.add(n.prefix);
  }

  return { connected, prefixes };
}

export function isMemberReachable(member, hub) {
  const provider = providerOf(member);
  if (!provider) return null;
  if (!hub) return null;
  return hub.connected.has(provider) || hub.prefixes.has(provider);
}

// { total, reachable } over the members that carry a provider segment.
export function reachabilityOf(models, hub) {
  let total = 0;
  let reachable = 0;
  for (const model of models || []) {
    const verdict = isMemberReachable(model, hub);
    if (verdict === null) continue;
    total += 1;
    if (verdict) reachable += 1;
  }
  return { total, reachable };
}

export function strategyOf(comboStrategies, name) {
  return comboStrategies?.[name]?.fallbackStrategy || "fallback";
}

// Merge a per-combo strategy patch into settings.comboStrategies. An empty
// patch — or a strategy back to the default "fallback" — drops the entry
// entirely, so the stored object stays the minimal truth. Pure: returns the
// next object, the caller persists it.
export function mergeComboStrategy(comboStrategies, name, patch = {}) {
  const next = { ...(comboStrategies || {}) };
  const merged = { ...(next[name] || {}), ...patch };
  for (const [key, value] of Object.entries(merged)) {
    if (value === "" || value === null || value === undefined) delete merged[key];
  }
  if (!merged.fallbackStrategy || merged.fallbackStrategy === "fallback") {
    delete next[name];
  } else {
    next[name] = merged;
  }
  return next;
}

// The next free "<base>-copy", "<base>-copy-2", … — the same shape the page's
// duplicate button has always produced, hoisted so bulk duplicate matches it.
export function uniqueCopyName(taken, base, limit = 100) {
  let candidate = `${base}-copy`;
  let i = 2;
  while (taken.has(candidate)) {
    if (i > limit) return null;
    candidate = `${base}-copy-${i}`;
    i += 1;
  }
  return candidate;
}

// Rewrite a combo name's namespace: "vela/cc/opus" with prefix "vela/cc" and
// next "harbor/x" → "harbor/x/opus"; a name outside the prefix is returned
// unchanged so callers can skip it honestly.
export function renamespaceName(name, prefix, nextPrefix) {
  if (!prefix) return name;
  if (name === prefix) return nextPrefix;
  if (!name.startsWith(`${prefix}/`)) return name;
  return `${nextPrefix}${name.slice(prefix.length)}`;
}

// Trim + drop empties from an incoming models array.
export function normalizeModels(models) {
  if (!Array.isArray(models)) return [];
  return models.map((m) => String(m ?? "").trim()).filter(Boolean);
}

export async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
