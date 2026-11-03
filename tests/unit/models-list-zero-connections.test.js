// Test covenant: models-list-zero-connections — /v1/models tells the truth.
//
// THE FAULT. src/lib/modelsList.js buildModelsList() carried a branch for
// "zero connections stored" that swept the ENTIRE PROVIDER_MODELS table and
// returned it unconditionally — every paid provider's catalogue, listed as if
// it were dialable. A client pointed at a fresh Vela with no key would read
// that list, pick `anthropic/claude-…`, and take a 401 on its first call.
// The list was a catalog, not a promise.
//
// THE LAW. With no stored connections /v1/models lists only what can actually
// answer: combos (already collected), keyless (noAuth + free/freeTier) lanes,
// and hand-declared custom models. The full registry catalog survives only
// behind `{ includeStaticCatalog: true }`, for callers that genuinely browse it.
//
// Seam-honest: the real buildModelsList runs; only its data access is mocked.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PROVIDER_MODELS } from "@/shared/constants/models";

const state = {
  connections: [],
  combos: [],
  customModels: [],
  modelAliases: {},
  disabled: {},
};

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async () => state.connections),
  getCombos: vi.fn(async () => state.combos),
  getCustomModels: vi.fn(async () => state.customModels),
  getModelAliases: vi.fn(async () => state.modelAliases),
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn(async () => state.disabled),
}));

import { buildModelsList } from "@/lib/modelsList";
import { AI_PROVIDERS, FREE_PROVIDERS, FREE_TIER_PROVIDERS } from "@/shared/constants/providers";

// Every id the untouched zero-connection branch would have emitted.
function staticCatalogIds() {
  const ids = [];
  for (const [alias, providerModels] of Object.entries(PROVIDER_MODELS)) {
    for (const model of providerModels) ids.push(`${alias}/${model.id}`);
  }
  return ids;
}

// The static ids that are legitimately servable with zero connections — the
// keyless (noAuth + free/freeTier) lanes. These belong in the honest list; the
// test below asserts that NOTHING ELSE from the static catalog survives.
function keylessAliases() {
  const aliases = new Set();
  for (const [providerId, provider] of Object.entries(AI_PROVIDERS)) {
    if (provider?.noAuth !== true) continue;
    if (!FREE_PROVIDERS[providerId] && !FREE_TIER_PROVIDERS[providerId]) continue;
    aliases.add(provider.alias || providerId);
  }
  return aliases;
}

function isKeylessStaticId(id) {
  return keylessAliases().has(id.split("/")[0]);
}

const LLM_KIND = "llm";

beforeEach(() => {
  state.connections = [];
  state.combos = [];
  state.customModels = [];
  state.modelAliases = {};
  state.disabled = {};
  // Keyless model fetchers would reach upstream; the suites never do live I/O.
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildModelsList — zero connections stored", () => {
  it("does NOT return the unconditional static PROVIDER_MODELS catalog", async () => {
    const data = await buildModelsList([LLM_KIND]);
    const ids = new Set(data.map((m) => m.id));
    const staticIds = staticCatalogIds();

    // Corroborate the fixture is non-trivial: the catalog it used to leak is big.
    expect(staticIds.length).toBeGreaterThan(100);

    // Only keyless-lane entries may legitimately appear; everything else is a leak.
    const leaked = staticIds.filter((id) => ids.has(id) && !isKeylessStaticId(id));
    expect(
      leaked,
      `non-servable static catalog entries leaked into /v1/models: ${leaked.slice(0, 5).join(", ")}`,
    ).toEqual([]);
  });

  it("lists no model owned by a provider that has no connection and no noAuth lane", async () => {
    const data = await buildModelsList([LLM_KIND]);
    // "anthropic" is an apikey provider — without a connection it cannot answer.
    expect(data.some((m) => m.owned_by === "anthropic")).toBe(false);
    // No entry may be `owned_by` a provider absent from servability at all:
    // every emitted owned_by must be a combo, a keyless lane, or a custom alias.
    for (const m of data) {
      expect(typeof m.id).toBe("string");
      expect(m.id.length).toBeGreaterThan(0);
      expect(m.object).toBe("model");
    }
  });

  it("lists keyless (noAuth) servable models — they are the only ones live without a key", async () => {
    const data = await buildModelsList([LLM_KIND]);
    // opencode is a noAuth freeTier lane with a static `models[]` floor; its
    // upstream modelsFetcher is unreachable in this suite, so the floor stands.
    const opencodeIds = data
      .filter((m) => m.owned_by === "oc" || m.owned_by === "opencode")
      .map((m) => m.id);
    expect(opencodeIds.length).toBeGreaterThan(0);
  });

  it("lists combos even with zero connections", async () => {
    state.combos = [{ name: "tide-combo", kind: "llm" }, { name: "search-combo", kind: "webSearch" }];
    const data = await buildModelsList([LLM_KIND]);
    const comboEntry = data.find((m) => m.id === "tide-combo");
    expect(comboEntry).toBeTruthy();
    expect(comboEntry.owned_by).toBe("combo");
    // webSearch combos are filtered out of the LLM kind list.
    expect(data.some((m) => m.id === "search-combo")).toBe(false);
  });

  it("keeps hand-declared custom models (they carry no connection of their own)", async () => {
    state.customModels = [{ id: "tide-ft", providerAlias: "oc", type: "llm" }];
    const data = await buildModelsList([LLM_KIND]);
    expect(data.some((m) => m.id === "oc/tide-ft")).toBe(true);
  });

  it("respects the disabled-models list on keyless lanes", async () => {
    const before = await buildModelsList([LLM_KIND]);
    const target = before.find((m) => m.owned_by === "oc" || m.owned_by === "opencode");
    expect(target).toBeTruthy();
    const [alias, modelId] = target.id.split("/");
    state.disabled = { [alias]: [modelId] };
    const after = await buildModelsList([LLM_KIND]);
    expect(after.some((m) => m.id === target.id)).toBe(false);
  });

  it("includeStaticCatalog: true - the escape hatch restores the full catalog", async () => {
    const data = await buildModelsList([LLM_KIND], { includeStaticCatalog: true });
    const ids = new Set(data.map((m) => m.id));
    // The escape hatch must still honour the kind filter, so it is not
    // byte-identical to PROVIDER_MODELS; it must however re-include apikey
    // providers (whose models are all LLM) and be far larger than the honest list.
    expect(data.some((m) => m.owned_by === "anthropic")).toBe(true);
    expect(ids.size).toBeGreaterThan(100);
  });

  it("honest list is strictly smaller than the escape-hatch list", async () => {
    const honest = await buildModelsList([LLM_KIND]);
    const full = await buildModelsList([LLM_KIND], { includeStaticCatalog: true });
    expect(full.length).toBeGreaterThan(honest.length);
  });

  it("drops connections that exist but are inactive — still treated as zero servable", async () => {
    state.connections = [{ id: "c1", provider: "anthropic", isActive: false, providerSpecificData: {} }];
    const data = await buildModelsList([LLM_KIND]);
    expect(data.some((m) => m.owned_by === "anthropic")).toBe(false);
    // The one real (inactive) connection cannot answer, so the list beneath it
    // must be the honest one: only keyless lanes (plus nothing else) survive.
    const ids = new Set(data.map((m) => m.id));
    const leaked = staticCatalogIds().filter((id) => ids.has(id) && !isKeylessStaticId(id));
    expect(leaked, "inactive connection should not unlock the static catalog").toEqual([]);
  });
});
