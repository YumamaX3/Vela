// Jerouter catalog — the 2026-09-29 roster (24 general + 10 unrestricted), pinned.
//
// Why this test exists: jerouter's model list is a mirror of a vendor catalog
// that rotates hard (three left on this tide, eight joined). Without a pin, a
// silent divergence between the registry and the catalog is invisible — the
// models simply vanish from the picker and nobody notices until a request
// 404s. The catalog below is transcribed verbatim from the Star's export,
// including the per-model vision/text annotation AND the context window, and
// asserted against the live registry AND the live capability resolver so both
// halves of the update hold.
//
// The window column exists because the fact lives in two places by design: the
// registry's `contextLength` (dashboard chip + model-catalog opt-out) and the
// capability table's `contextWindow` (capacity adapter, fallback-rules'
// contextWindow trigger, /api/models). A drift between them would let the
// dashboard promise a depth the router refuses, so both are pinned here.
import { describe, it, expect } from "vitest";
import REGISTRY from "open-sse/providers/registry/index.js";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
// [model id, modality, context window] — verbatim from the Star's 2026-09-29
// export. The first 24 are the general lanes (256k), the last 10 the
// unrestricted (JB) lanes (512k).
const CATALOG = [
  ["step-3.7-flash", "vision", 262144],
  ["nemotron-3-ultra", "text", 262144],
  ["glm-5.3-flash", "vision", 262144],
  ["north-mini-code", "text", 262144],
  ["laguna-xs-2.1", "text", 262144],
  ["nemotron-3-super", "text", 262144],
  ["laguna-s-2.1", "text", 262144],
  ["grok-4.6", "vision", 262144],
  ["deepseek-v4.1-flash", "vision", 262144],
  ["dots-3-note-preview", "vision", 262144],
  ["big-pickle", "vision", 262144],
  ["mimo-v2.5", "vision", 262144],
  ["ling-3.0-flash-fin", "text", 262144],
  ["nemotron-3.5-lightning", "text", 262144],
  ["muse-spark-1.3-contributor", "text", 262144],
  ["ling-3.0-flash-sante", "text", 262144],
  ["grok-4.7", "vision", 262144],
  ["mimo-v2.6-flash", "vision", 262144],
  ["qwen3.8-27b", "vision", 262144],
  ["step-5-preview", "vision", 262144],
  ["space-bunny", "vision", 262144],
  ["qwen3.8-flash", "vision", 262144],
  ["mimo-v2.6-pro", "vision", 262144],
  ["longcat-2.5-preview", "text", 262144],
  // — the unrestricted (JB) lanes —
  ["qwen3.8-27b-unsencored", "vision", 524288],
  ["unrestricted", "vision", 524288],
  ["muse-unrestricted", "text", 524288],
  ["deepseek-unrestricted", "vision", 524288],
  ["big-pickle-unrestricted", "vision", 524288],
  ["ling-unrestricted", "text", 524288],
  ["mimo-pro-unrestricted", "vision", 524288],
  ["longcat-unrestricted", "text", 524288],
  ["step-5-unrestricted", "vision", 524288],
  ["step-3.7-unrestricted", "vision", 524288],
];
// Left on earlier tides — absent from this catalog, so absent here. The first
// block retired on 2026-09-26; the second is this tide's own departure (all
// three had arrived on 2026-09-26 and are gone from the 2026-09-29 export).
const RETIRED = [
  "gemini-3.1-pro", "gemini-3.6-flash", "gemini-3.7-flash",
  "gemini-3.8-flash", "gemini-3.8-flash-high", "gemini-3.8-flash-medium", "gemini-3.8-flash-low",
  "claude-opus-4-6", "claude-sonnet-4-6", "deepseek-v4-flash", "gemma4", "glm-5.2",
  "grok-4.5", "free", "ling-3.0-flash", "lfm-2.5-2.6b",
  "llama-4-maverick-17b-128e-instruct", "muse-spark-1.2-contributor",
  "nemotron-3-nano-omni", "nemotron-3.5", "nex-n2.5-pro", "nex-n2.5-mini",
  "union-alpha", "gpt-5.6-luna",
  "hy3", "hy4-preview", "jev-1.13",
];
const jerouter = REGISTRY.find((p) => p.id === "jerouter");
const ids = jerouter.models.map((m) => m.id);
describe("jerouter — the 2026-09-29 catalog", () => {
  it("serves exactly the catalog's 34 models", () => {
    expect([...ids].sort()).toEqual(CATALOG.map(([id]) => id).sort());
  });
  it("splits 24 general lanes + 10 unrestricted lanes", () => {
    expect(CATALOG.filter(([, , window]) => window === 262144).length).toBe(24);
    expect(CATALOG.filter(([, , window]) => window === 524288).length).toBe(10);
    expect(CATALOG.length).toBe(34);
  });
  it("carries no duplicate model ids", () => {
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("gives every model a display name and both transports' formats", () => {
    const incomplete = jerouter.models
      .filter((m) => !m.name || !Array.isArray(m.supportedFormats) || m.supportedFormats.length === 0)
      .map((m) => m.id);
    expect(incomplete).toEqual([]);
  });
  it("drops every retired model", () => {
    for (const gone of RETIRED) expect(ids).not.toContain(gone);
  });
  it("keeps the dual-endpoint shape (openai + claude transports)", () => {
    expect(jerouter.transports.map((t) => t.format).sort()).toEqual(["claude", "openai"]);
    expect(jerouter.alias).toBe("je");
  });
  it("resolves every model's modality exactly as the catalog annotates it", () => {
    const wrong = [];
    for (const [model, want] of CATALOG) {
      const got = getCapabilitiesForModel("jerouter", model).vision ? "vision" : "text";
      if (got !== want) wrong.push(`${model}: wanted ${want}, got ${got}`);
    }
    expect(wrong, `Modality drift:\n${wrong.join("\n")}`).toEqual([]);
  });
  it("declares every model's context window in the registry", () => {
    const wrong = [];
    for (const [model, , want] of CATALOG) {
      const entry = jerouter.models.find((m) => m.id === model);
      if (entry?.contextLength !== want) {
        wrong.push(`${model}: registry contextLength ${entry?.contextLength}, wanted ${want}`);
      }
    }
    expect(wrong, `Registry window drift:\n${wrong.join("\n")}`).toEqual([]);
  });
  it("resolves every model's context window exactly as the catalog declares it", () => {
    const wrong = [];
    for (const [model, , want] of CATALOG) {
      const got = getCapabilitiesForModel("jerouter", model).contextWindow;
      if (got !== want) wrong.push(`${model}: wanted ${want}, got ${got}`);
    }
    expect(wrong, `Capability window drift:\n${wrong.join("\n")}`).toEqual([]);
  });
  it("resolves identically through the 'je' alias (combo + capacity-adapter lanes)", () => {
    // Combo members are composed "<alias>/<model>" (ModelSelectModal.js) and the
    // alias is passed raw to getCapabilitiesForModel, so the alias lane must
    // agree with the id lane or provider overrides silently vanish on combos.
    const wrong = [];
    for (const [model, want] of CATALOG) {
      const viaId = getCapabilitiesForModel("jerouter", model);
      const viaAlias = getCapabilitiesForModel("je", model);
      const got = viaAlias.vision ? "vision" : "text";
      if (got !== want) wrong.push(`${model}: wanted ${want}, got ${got}`);
      if (JSON.stringify(viaId) !== JSON.stringify(viaAlias)) {
        wrong.push(`${model}: alias lane differs from id lane`);
      }
    }
    expect(wrong, `Alias-lane drift:\n${wrong.join("\n")}`).toEqual([]);
  });
});
