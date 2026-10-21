// Auto-generated combos — the free-tier rollup and the family fallbacks.
//
// Port of 9router-go `combos.go` (auto-free) and `combos_family.go`
// (auto-family). Both are EXPLICIT rebuilds, never background jobs: a rebuild
// replaces whatever the operator edited, so it must be a button, not a side
// effect of a connection change.
//
// A generated combo only names models the user can actually reach: providers
// with an active connection, chat-shaped models only, and nothing the operator
// disabled.
import { getProviderConnections } from "@/lib/db/repos/connectionsRepo.js";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { getCustomModels } from "@/lib/localDb";
import { getModelsByProviderId, PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";

export const AUTO_FREE_COMBO_ID = "auto-free-tier";
export const AUTO_FAMILY_COMBO_PREFIX = "auto-family-";
export const FREE_COMBO_KIND = "auto-free";
export const FAMILY_COMBO_KIND = "auto-family";

const FREE_MARKERS = [":free", "/free", "-free"];
const FAMILY_FLAGS = new Set(["preview", "exp", "experimental", "beta", "latest", "free", "auto"]);

export function isFreeTierModel(modelId) {
  return FREE_MARKERS.some((marker) => modelId.endsWith(marker));
}

function aliasOf(providerId) {
  return PROVIDER_ID_TO_ALIAS[providerId] || providerId;
}

function isEmbedding(modelId) {
  return modelId.toLowerCase().includes("embedding");
}

/** Chat-shaped and not disabled for this provider. */
function usableChatModel(providerId, entry, disabledByAlias) {
  const id = entry?.id;
  if (!id) return false;
  if (entry.type && entry.type !== "llm") return false;
  if (isEmbedding(id)) return false;
  const disabled = disabledByAlias[aliasOf(providerId)];
  return !(disabled && disabled.has(id));
}

function appendUnique(list, value) {
  if (!list.includes(value)) list.push(value);
  return list;
}

async function disabledMap() {
  try {
    const raw = await getDisabledModels();
    const out = {};
    for (const [alias, value] of Object.entries(raw || {})) {
      out[alias] = new Set(Array.isArray(value) ? value : [String(value)]);
    }
    return out;
  } catch {
    return {};
  }
}

/** "alias/model" for every free-tier chat model of a connected provider. */
export async function freeTierComboModels() {
  const [connections, disabled] = [await getProviderConnections({ isActive: true }), await disabledMap()];
  const providerIds = [...new Set(connections.map((c) => c.provider).filter(Boolean))];
  const out = [];
  for (const providerId of providerIds) {
    for (const entry of getModelsByProviderId(providerId)) {
      if (!entry?.id || !isFreeTierModel(entry.id)) continue;
      if (!usableChatModel(providerId, entry, disabled)) continue;
      out.push(`${aliasOf(providerId)}/${entry.id}`);
    }
  }
  return out.sort();
}

/** Normalize a model id to the family every version shares. */
export function modelFamily(modelId) {
  let lower = String(modelId).toLowerCase();
  if (lower.endsWith(":free")) lower = lower.slice(0, -":free".length);
  const parts = lower.split("-");
  const kept = [];
  parts.forEach((part, index) => {
    if (!part) return;
    if (/^v?\d+(\.\d+)*$/.test(part)) return;              // 4.6, 3.1, v2.5
    if (FAMILY_FLAGS.has(part)) return;                     // preview, beta, free…
    if (index > 0 && /^[a-z]\d+(\.\d+)*$/.test(part)) return; // k2.6, m3
    kept.push(part);
  });
  return kept.length ? kept.join("-") : lower;
}

export function autoFamilyComboId(family) {
  return AUTO_FAMILY_COMBO_PREFIX + family.replace(/[/:\s]+/g, "-");
}

/** family → sorted "alias/model" members across connected providers. */
export async function usableModelFamilies() {
  const [connections, disabled] = [await getProviderConnections({ isActive: true }), await disabledMap()];
  const providerIds = [...new Set(connections.map((c) => c.provider).filter(Boolean))];

  const groups = new Map();
  for (const providerId of providerIds) {
    const alias = aliasOf(providerId);
    for (const entry of getModelsByProviderId(providerId)) {
      if (!usableChatModel(providerId, entry, disabled)) continue;
      const family = modelFamily(entry.id);
      if (!groups.has(family)) groups.set(family, []);
      appendUnique(groups.get(family), `${alias}/${entry.id}`);
    }
  }

  // Custom models join their family too — a hand-added gateway model can
  // backstop the catalog.
  try {
    for (const custom of await getCustomModels()) {
      if (custom?.type !== "llm" || !custom?.providerAlias || !custom?.id) continue;
      const family = modelFamily(custom.id);
      if (!groups.has(family)) groups.set(family, []);
      appendUnique(groups.get(family), `${custom.providerAlias}/${custom.id}`);
    }
  } catch { /* custom models are an enhancement, never a reason to fail */ }

  for (const members of groups.values()) members.sort();
  return groups;
}
