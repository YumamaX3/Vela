// Jerouter catalog — the 2026-09-26 roster (25 general + 4 unrestricted), pinned.
//
// Why this test exists: jerouter's model list is a mirror of a vendor catalog
// that rotates hard (twenty-four left on this tide, fifteen joined). Without a
// pin, a silent divergence between the registry and the catalog is invisible —
// the models simply vanish from the picker and nobody notices until a request
// 404s. The catalog below is transcribed verbatim from the Star's export,
// including the per-model vision/text annotation, and asserted against the live
// registry AND the live capability resolver so both halves of the update hold.
import { describe, it, expect } from "vitest";
import REGISTRY from "open-sse/providers/registry/index.js";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";

// [model id, modality] — verbatim from the Star's 2026-09-26 export.
// The first 25 are the general lanes, the last 4 the unrestricted (JB) lanes.
const CATALOG = [
  ["step-3.7-flash", "vision"],
  ["nemotron-3-ultra", "text"],
  ["glm-5.3-flash", "vision"],
  ["north-mini-code", "text"],
  ["hy3", "vision"],
  ["laguna-xs-2.1", "text"],
  ["nemotron-3-super", "text"],
  ["laguna-s-2.1", "text"],
  ["grok-4.6", "vision"],
  ["deepseek-v4.1-flash", "vision"],
  ["hy4-preview", "vision"],
  ["dots-3-note-preview", "vision"],
  ["big-pickle", "vision"],
  ["mimo-v2.5", "vision"],
  ["ling-3.0-flash-fin", "text"],
  ["nemotron-3.5-lightning", "text"],
  ["muse-spark-1.3-contributor", "text"],
  ["ling-3.0-flash-sante", "text"],
  ["grok-4.7", "vision"],
  ["jev-1.13", "text"],
  ["mimo-v2.6-flash", "vision"],
  ["qwen3.8-27b", "vision"],
  ["step-5-preview", "vision"],
  ["space-bunny", "vision"],
  ["qwen3.8-flash", "vision"],
  // — the unrestricted (JB) lanes —
  ["qwen3.8-27b-unsencored", "vision"],
  ["unrestricted", "vision"],
  ["muse-unrestricted", "text"],
  ["deepseek-unrestricted", "vision"],
];

// Left on the 2026-09-26 tide — absent from the catalog, so absent here.
const RETIRED = [
  "gemini-3.1-pro", "gemini-3.6-flash", "gemini-3.7-flash",
  "gemini-3.8-flash", "gemini-3.8-flash-high", "gemini-3.8-flash-medium", "gemini-3.8-flash-low",
  "claude-opus-4-6", "claude-sonnet-4-6", "deepseek-v4-flash", "gemma4", "glm-5.2",
  "grok-4.5", "free", "ling-3.0-flash", "lfm-2.5-2.6b",
  "llama-4-maverick-17b-128e-instruct", "muse-spark-1.2-contributor",
  "nemotron-3-nano-omni", "nemotron-3.5", "nex-n2.5-pro", "nex-n2.5-mini",
  "union-alpha", "gpt-5.6-luna",
];
const jerouter = REGISTRY.find((p) => p.id === "jerouter");
const ids = jerouter.models.map((m) => m.id);

describe("jerouter — the 2026-09-26 catalog", () => {
  it("serves exactly the catalog's 29 models", () => {
    expect([...ids].sort()).toEqual(CATALOG.map(([id]) => id).sort());
  });

  it("splits 25 general lanes + 4 unrestricted lanes", () => {
    expect(CATALOG.filter(([id]) => !id.includes("unrestricted") && !id.endsWith("-unsencored")).length).toBe(25);
    expect(CATALOG.length).toBe(29);
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
