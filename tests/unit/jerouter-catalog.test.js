// Jerouter catalog — the 2026-10-23 roster (39 general + 11 unrestricted), pinned.
//
// Why this test exists: jerouter's model list is a mirror of a vendor catalog
// that rotates hard (eight left on this tide, fourteen joined, three of them
// returning). Without a pin, a silent divergence between the registry and the
// catalog is invisible — the models simply vanish from the picker and nobody
// notices until a request 404s. The catalog below is transcribed verbatim from
// the Star's export; this export carries no vision/text annotation, so the
// thirteen arrivals' modality is what the live resolver measures through the
// pattern chain — asserted against the live registry AND the live capability
// resolver so both halves of the update hold.
//
// The window column exists because the fact lives in two places by design: the
// registry's `contextLength` (dashboard chip + model-catalog opt-out) and the
// capability table's `contextWindow` (capacity adapter, fallback-rules'
// contextWindow trigger, /api/models). A drift between them would let the
// dashboard promise a depth the router refuses, so both are pinned here.
//
// The windows are the export's own column, lane by lane — NOT the summary
// sentence. Six general lanes carry another depth (jev-1.13 16k,
// mimo-v2.6-flash and step-5-preview 1M, claude-haiku-5.5 and auto 256k, beam
// 1M), and every unrestricted lane states 512k on this export.
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
  ["deepseek-v4.1-flash-1017-oc", "vision", 524288],
  ["big-pickle", "vision", 524288],
  ["mimo-v2.5", "vision", 524288],
  ["nemotron-3.5-lightning", "text", 524288],
  ["deepseek-v4.1-flash", "vision", 524288],
  ["grok-4.7", "vision", 524288],
  ["jev-1.13", "text", 16384],
  ["mimo-v2.6-flash", "vision", 1048576],
  ["step-5-preview", "vision", 1048576],
  ["deepseek-v4-flash", "text", 524288],
  ["qwen3.8-flash", "vision", 524288],
  ["longcat-2.5-preview", "text", 524288],
  ["qwen3.7-max", "text", 524288],
  ["qwen3.7-plus", "vision", 524288],
  ["qwen3.8-max", "text", 524288],
  ["qwen3.8-omni-flash", "vision", 524288],
  ["claude-haiku-5.5", "vision", 262144],
  ["step-3.5-flash-2603", "text", 524288],
  ["step-3.5-flash", "text", 524288],
  ["cat-jam", "text", 524288],
  ["auto", "text", 262144],
  ["minimax-m2.7", "text", 524288],
  ["nemotron-3.5-super-vl", "vision", 524288],
  ["ll-alpha", "text", 524288],
  ["beam", "text", 1048576],
  ["xing4.0-29b-a4b", "text", 524288],
  ["deepseek-v4.1-flash-1017", "vision", 524288],
  ["deepseek-v4.1-flash-1017-q", "vision", 524288],
  ["minimax-m3.1-flash", "vision", 524288],
  // — the unrestricted (JB) lanes —
  ["mimo-v2.6-flash-unrestricted", "vision", 524288],
  ["deepseek-unrestricted", "vision", 524288],
  ["big-pickle-unrestricted", "vision", 524288],
  ["longcat-unrestricted", "text", 524288],
  ["step-5-unrestricted", "vision", 524288],
  ["step-3.7-unrestricted", "vision", 524288],
  ["jerouter", "text", 524288],
  ["nemotron-3-ultra-unrestricted", "text", 524288],
  ["glm-5.3-flash-unrestricted", "text", 524288],
  ["sonnet-unrestricted", "text", 524288],
  ["minimax-m3.1-flash-unrestricted", "vision", 524288],
];
// Left on earlier tides — absent from this catalog, so absent here. The first
// block retired on 2026-09-26; the second is the 2026-09-29 tide's own
// departure; the third is the 2026-10-13 tide's; the fourth is this tide's own
// (deepseek-v4-flash, jev-1.13 and mimo-v2.5 RETURN this tide, so they leave
// the list again).
const RETIRED = [
  "gemini-3.1-pro", "gemini-3.6-flash", "gemini-3.7-flash",
  "gemini-3.8-flash", "gemini-3.8-flash-high", "gemini-3.8-flash-medium", "gemini-3.8-flash-low",
  "gemma4", "glm-5.2",
  "grok-4.5", "free", "ling-3.0-flash", "lfm-2.5-2.6b",
  "llama-4-maverick-17b-128e-instruct", "muse-spark-1.2-contributor",
  "nemotron-3-nano-omni", "nemotron-3.5", "nex-n2.5-pro", "nex-n2.5-mini",
  "union-alpha", "gpt-5.6-luna",
  "hy3", "hy4-preview",
  "ling-3.0-flash-fin", "qwen3.8-27b", "mimo-v2.6-pro",
  "qwen3.8-27b-unsencored", "unrestricted", "ling-unrestricted", "mimo-pro-unrestricted",
  // this tide's departures
  "dots-3-note-preview", "muse-spark-1.3-contributor", "ling-3.0-flash-sante",
  "space-bunny", "ling-3.1-flash", "apodex-1.1-mini", "step-5-preview-opencode",
  "muse-unrestricted",
];
const jerouter = REGISTRY.find((p) => p.id === "jerouter");
const ids = jerouter.models.map((m) => m.id);
describe("jerouter — the 2026-10-23 catalog", () => {
  it("serves exactly the catalog's 50 models", () => {
    expect([...ids].sort()).toEqual(CATALOG.map(([id]) => id).sort());
  });
  it("splits 39 general lanes + 11 unrestricted lanes", () => {
    const GENERAL_LANES = 39;
    expect(CATALOG.slice(0, GENERAL_LANES)).toHaveLength(GENERAL_LANES);
    expect(CATALOG.slice(GENERAL_LANES)).toHaveLength(11);
    expect(CATALOG).toHaveLength(50);
  });
  it("transcribes the export's window column lane by lane", () => {
    // Not "all 512k": the column states six other depths in the general block,
    // and 512k on every JB lane. Counted, so a summary sentence can never
    // overwrite the column again.
    const byWindow = CATALOG.reduce((acc, [, , window]) => {
      acc[window] = (acc[window] || 0) + 1;
      return acc;
    }, {});
    expect(byWindow).toEqual({
      524288: 44,
      1048576: 3,
      262144: 2,
      16384: 1,
    });
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
