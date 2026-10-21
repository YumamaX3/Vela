// MODEL DEPRECATIONS — sqlite harbor.
//
// Ported from 9router-go `internal/db/deprecations.go`. The set is small,
// entirely machine-written, and read as one map per dashboard load — so it
// rides the kv store (scope "modelDeprecations") rather than a new table, the
// same shape as budgets and the digest marker.
import { makeKv } from "../../helpers/kvStore.js";

const SCOPE = "modelDeprecations";
const kv = makeKv(SCOPE);

export const DEPRECATION_STATUSES = ["retired", "deprecated", "removed"];

export function deprecationKey(provider, model) {
  return `${provider}/${model}`;
}

export async function listModelDeprecations(provider = "") {
  const all = await kv.getAll();
  const out = {};
  for (const [key, dep] of Object.entries(all)) {
    if (!dep || typeof dep !== "object" || !dep.provider || !dep.model) continue;
    if (provider && dep.provider !== provider) continue;
    out[key] = dep;
  }
  return out;
}

export async function getModelDeprecation(provider, model) {
  if (!provider || !model) return null;
  return (await kv.get(deprecationKey(provider, model), null)) || null;
}

export async function recordModelDeprecation(dep = {}) {
  if (!dep.provider || !dep.model || !DEPRECATION_STATUSES.includes(dep.status)) {
    throw new Error("record model deprecation: provider, model and status are required");
  }
  const record = {
    ...dep,
    detectedAt: dep.detectedAt || new Date().toISOString(),
  };
  await kv.set(deprecationKey(dep.provider, dep.model), record);
  return record;
}

export async function clearModelDeprecation(provider, model) {
  if (!provider || !model) return false;
  await kv.remove(deprecationKey(provider, model));
  return true;
}

/** Drop records whose model appears in a freshly fetched catalogue. */
export async function retainLiveModels(provider, liveKeys) {
  const deps = await listModelDeprecations(provider);
  let cleared = 0;
  for (const key of Object.keys(deps)) {
    if (!liveKeys.has(key)) continue;
    await kv.remove(key);
    cleared++;
  }
  return cleared;
}
