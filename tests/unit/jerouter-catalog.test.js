// Jerouter catalog — the 2026-10-13 roster (33 general + 11 unrestricted), pinned.
//
// Why this test exists: jerouter's model list is a mirror of a vendor catalog
// that rotates hard (eight left on this tide, eighteen joined). Without a pin,
// a silent divergence between the registry and the catalog is invisible — the
// models simply vanish from the picker and nobody notices until a request
// 404s. The catalog below is transcribed verbatim from the Star's export; this
// export dropped the vision/text annotation the earlier tides carried, so the
// eighteen arrivals' modality is what the live resolver measures through the
// pattern chain — asserted against the live registry AND the live capability
// resolver so both halves of the update hold.
//
// The window column exists because the fact lives in two places by design: the
// registry's `contextLength` (dashboard chip + model-catalog opt-out) and the
// capability table's `contextWindow` (capacity adapter, fallback-rules'
// contextWindow trigger, /api/models). A drift between them would let the
// dashboard promise a depth the router refuses, so both are pinned here.
import { describe, it, expect } from "vitest";
import REGISTRY from "open-sse/providers/registry/index.js";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
// [model id, modality, context window] — verbatim from the Star's 2026-10-13
// export, with modality resolved through the live pattern chain for the
// eighteen arrivals (this export dropped the vision/text column entirely).
// The first 33 are the general lanes (512k), the last 11 the
// unrestricted (JB) lanes (1M).
const CATALOG = [
  ["step-3.7-flash", "vision", 524288],
  ["nemotron-3-ultra", "text", 524288],
  ["glm-5.3-flash", "vision", 524288],
  ["north-mini-code", "text", 524288],
  ["laguna-xs-2.1", "text", 524288],
  ["nemotron-3-super", "text", 524288],
  ["laguna-s-2.1", "text", 524288],
  ["claude-opus-4-6", "vision", 524288],
  ["claude-sonnet-4-6", "vision", 524288],
  ["grok-4.6", "vision", 524288],
  ["deepseek-v4.1-flash", "vision", 524288],
  ["dots-3-note-preview", "vision", 524288],
  ["big-pickle", "vision", 524288],
  ["nemotron-3.5-lightning", "text", 524288],
  ["muse-spark-1.3-contributor", "text", 524288],
  ["ling-3.0-flash-sante", "text", 524288],
  ["grok-4.7", "vision", 524288],
  ["mimo-v2.6-flash", "vision", 524288],
  ["step-5-preview", "vision", 524288],
  ["space-bunny", "vision", 524288],
  ["qwen3.8-flash", "vision", 524288],
  ["longcat-2.5-preview", "text", 524288],
  ["ling-3.1-flash", "text", 524288],
  ["apodex-1.1-mini", "text", 524288],
  ["qwen3.7-max", "text", 524288],
  ["qwen3.7-plus", "vision", 524288],
  ["step-5-preview-opencode", "text", 524288],
  ["qwen3.8-omni-flash", "vision", 524288],
  ["claude-haiku-5.5", "vision", 524288],
  ["step-3.5-flash-2603", "text", 524288],
  ["step-3.5-flash", "text", 524288],
  ["cat-jam", "text", 524288],
  ["auto", "text", 524288],
  // — the unrestricted (JB) lanes —
  ["mimo-v2.6-flash-unrestricted", "vision", 1048576],
  ["muse-unrestricted", "text", 1048576],
  ["deepseek-unrestricted", "vision", 1048576],
  ["big-pickle-unrestricted", "vision", 1048576],
  ["longcat-unrestricted", "text", 1048576],
  ["step-5-unrestricted", "vision", 1048576],
  ["step-3.7-unrestricted", "vision", 1048576],
  ["jerouter", "text", 1048576],
  ["nemotron-3-ultra-unrestricted", "text", 1048576],
  ["glm-5.3-flash-unrestricted", "text", 1048576],
  ["sonnet-unrestricted", "text", 1048576],
];
// Left on earlier tides — absent from this catalog, so absent here. The first
// block retired on 2026-09-26; the second is the 2026-09-29 tide's own
// departure; the third is this tide's own (claude-opus-4-6 and
// claude-sonnet-4-6 RETURN this tide, so they leave the list again).
const RETIRED = [
  "gemini-3.1-pro", "gemini-3.6-flash", "gemini-3.7-flash",
  "gemini-3.8-flash", "gemini-3.8-flash-high", "gemini-3.8-flash-medium", "gemini-3.8-flash-low",
  "deepseek-v4-flash", "gemma4", "glm-5.2",
  "grok-4.5", "free", "ling-3.0-flash", "lfm-2.5-2.6b",
  "llama-4-maverick-17b-128e-instruct", "muse-spark-1.2-contributor",
  "nemotron-3-nano-omni", "nemotron-3.5", "nex-n2.5-pro", "nex-n2.5-mini",
  "union-alpha", "gpt-5.6-luna",
  "hy3", "hy4-preview", "jev-1.13",
  "mimo-v2.5", "ling-3.0-flash-fin", "qwen3.8-27b", "mimo-v2.6-pro",
  "qwen3.8-27b-unsencored", "unrestricted", "ling-unrestricted", "mimo-pro-unrestricted",
];
const jerouter = REGISTRY.find((p) => p.id === "jerouter");
const ids = jerouter.models.map((m) => m.id);
describe("jerouter — the 2026-10-13 catalog", () => {
  it("serves exactly the catalog's 44 models", () => {
    expect([...ids].sort()).toEqual(CATALOG.map(([id]) => id).sort());
  });
  it("splits 33 general lanes + 11 unrestricted lanes", () => {
    expect(CATALOG.filter(([, , window]) => window === 524288).length).toBe(33);
    expect(CATALOG.filter(([, , window]) => window === 1048576).length).toBe(11);
    expect(CATALOG.length).toBe(44);
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
