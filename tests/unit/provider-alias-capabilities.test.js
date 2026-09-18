// Provider alias resolution in the capability lookup.
//
// Why this test exists: combo members and capacity-adapter pools are composed as
// "<alias>/<model>" — ModelSelectModal.js builds them with getProviderAlias —
// and both combo.js and capacityAdapter.js slice that prefix off and pass it to
// getCapabilitiesForModel WITHOUT resolving it (parseModel only runs on the
// direct request path). Any provider whose alias differs from its id therefore
// missed its PROVIDER_CAPABILITIES override on every combo/capacity lane.
//
// Rather than pin one provider, this test derives the pairs from the registry
// itself: for every provider that has BOTH an alias != id AND a capability
// override, the alias lane must resolve byte-identically to the id lane. A new
// aliased provider with overrides is covered automatically.
import { describe, it, expect } from "vitest";
import REGISTRY from "open-sse/providers/registry/index.js";
import { PROVIDER_CAPABILITIES, getCapabilitiesForModel } from "open-sse/providers/capabilities.js";

// Providers with an alias distinct from their id AND a capability override.
const PAIRS = REGISTRY
  .filter((e) => e?.id && e.alias && e.alias !== e.id && PROVIDER_CAPABILITIES[e.id])
  .map((e) => ({ id: e.id, alias: e.alias, models: Object.keys(PROVIDER_CAPABILITIES[e.id]) }));

describe("capability lookup — provider aliases resolve to the same override", () => {
  it("finds at least the known aliased override providers", () => {
    const ids = PAIRS.map((p) => p.id);
    // jerouter/je is the one this guard was written for; kiro/kr and qoder/qd
    // are the pre-existing cases the same defect silently affected.
    expect(ids).toContain("jerouter");
    expect(ids).toContain("kiro");
    expect(ids).toContain("qoder");
  });

  it("resolves the alias lane byte-identically to the id lane", () => {
    const mismatches = [];
    for (const { id, alias, models } of PAIRS) {
      for (const model of models) {
        const viaId = getCapabilitiesForModel(id, model);
        const viaAlias = getCapabilitiesForModel(alias, model);
        if (JSON.stringify(viaId) !== JSON.stringify(viaAlias)) {
          mismatches.push(`${id} (${alias}) / ${model}`);
        }
      }
    }
    expect(mismatches, `Alias lanes diverging from id lanes:\n${mismatches.join("\n")}`).toEqual([]);
  });

  it("leaves an unknown provider token on the normal fallback chain", () => {
    // An unrecognized token must NOT throw and must still resolve via patterns.
    const caps = getCapabilitiesForModel("not-a-real-provider", "gemini-3.8-flash");
    expect(caps.vision).toBe(true);
  });
});
