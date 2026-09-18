// Jerouter catalog — the 2026-09-18 V2 roster, pinned.
//
// Why this test exists: jerouter's model list is a mirror of a vendor catalog
// that rotates (five retired on this tide, eleven joined). Without a pin, a
// silent divergence between the registry and the catalog is invisible — the
// models simply vanish from the picker and nobody notices until a request 404s.
// The catalog below is transcribed verbatim from the Star's export, including
// the per-model vision/text annotation, and asserted against the live registry
// AND the live capability resolver so both halves of the update are held.
import { describe, it, expect } from "vitest";
import REGISTRY from "open-sse/providers/registry/index.js";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";

// [model id, modality] — verbatim from the Star's Jerouter V2 export.
const CATALOG = [
  ["step-3.7-flash", "vision"],
  ["glm-5.3-flash", "text"],
  ["gemini-3.7-flash", "vision"],
  ["gemini-3.1-pro", "vision"],
  ["gemini-3.6-flash", "vision"],
  ["north-mini-code", "text"],
  ["laguna-xs-2.1", "text"],
  ["deepseek-v4-flash", "text"],
  ["qwen3.8-27b", "text"],
  ["nemotron-3-nano-omni", "vision"],
  ["nemotron-3-super", "text"],
  ["nemotron-3.5", "text"],
  ["laguna-s-2.1", "text"],
  ["lfm-2.5-2.6b", "text"],
  ["gemini-3.8-flash", "vision"],
  ["claude-opus-4-6", "vision"],
  ["claude-sonnet-4-6", "vision"],
  ["nex-n2.5-pro", "vision"],
  ["nex-n2.5-mini", "text"],
  ["glm-5.2", "text"],
  ["llama-4-maverick-17b-128e-instruct", "text"],
  ["grok-4.5", "vision"],
  ["grok-4.6", "vision"],
  ["free", "vision"],
  ["deepseek-v4.1-flash", "vision"],
  ["dots-3-note-preview", "vision"],
  ["gemma4", "vision"],
  ["big-pickle", "text"],
  ["mimo-v2.5", "text"],
  ["ling-3.0-flash", "text"],
  ["nemotron-3.5-lightning", "text"],
  ["muse-spark-1.2-contributor", "text"],
  ["muse-spark-1.3-contributor", "text"],
  ["union-alpha", "text"],
  ["gemini-3.8-flash-high", "vision"],
  ["gemini-3.8-flash-medium", "vision"],
  ["gemini-3.8-flash-low", "vision"],
  ["gpt-5.6-luna", "text"],
];

// Retired on the 2026-09-18 tide — absent from the catalog, so absent here.
const RETIRED = ["nemotron-3-ultra", "qwen3.8-flash", "hy3", "deepseek-v4-pro-0813", "glm-5.3"];

const jerouter = REGISTRY.find((p) => p.id === "jerouter");
const ids = jerouter.models.map((m) => m.id);

describe("jerouter — the 2026-09-18 V2 catalog", () => {
  it("serves exactly the catalog's 38 models", () => {
    expect([...ids].sort()).toEqual(CATALOG.map(([id]) => id).sort());
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
