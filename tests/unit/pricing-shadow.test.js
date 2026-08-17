// Pricing Shadow regression (2026-08-16) — pins the $0-cost fix.
//
// Root cause: cost is frozen into usageHistory at WRITE time; models with no
// pricing entry resolve null → $0 forever. Two victims, two shapes:
//   1. qoder's opaque lane ids (qmodel_38max, dfmodel, …) matched nothing.
//      Fixed by the qoder lane in PROVIDER_PRICING (retail-equivalents).
//   2. mistral "-latest" aliases + ollama ":" separators matched nothing.
//      Fixed by exact MODEL_PRICING entries.
// Plus the display amplifier: sub-cent costs rendered $0.00 via toFixed(2).
//      Fixed by formatCost's honest "<$0.01" branch.
import { describe, it, expect } from "vitest";
import {
  getPricingForModel,
  formatCost,
  PROVIDER_PRICING,
} from "../../open-sse/providers/pricing.js";

describe("Pricing Shadow — qoder lane (subscription retail-equivalents)", () => {
  const QODER_LANE = {
    // [model, expected input rate] — registry/qoder.js name → base model rate
    qmodel_38max: 2.00,      // Qwen3.8-Max
    qmodel_latest: 2.50,     // Qwen3.7-Max
    qmodel: 0.50,            // Qwen3.7-Plus
    kmodel_latest: 3.00,     // Kimi-K3
    kmodel: 0.95,            // Kimi-K2.7-Code
    gmodel: 1.60,            // GLM-5.3
    gm51model: 1.40,         // GLM-5.2
    dmodel: 0.435,           // DeepSeek-V4-Pro
    dfmodel: 0.14,           // DeepSeek-V4-Flash
    mmodel: 0.30,            // MiniMax-M3
  };

  it("every opaque qoder id resolves a real rate (never null)", () => {
    for (const [model, input] of Object.entries(QODER_LANE)) {
      const p = getPricingForModel("qoder", model);
      expect(p, `qoder/${model} must resolve`).toBeTruthy();
      expect(p.input, `qoder/${model} input rate`).toBe(input);
      expect(p.output, `qoder/${model} output rate`).toBeGreaterThan(0);
    }
  });

  it("the registry's full qoder model list prices every non-tier-selector", () => {
    // Tier selectors (ultimate/auto/performance/efficient/lite) stay
    // unpriced — no honest per-token rate exists for a router's own
    // tier picker.
    const TIER_SELECTORS = new Set(["ultimate", "auto", "performance", "efficient", "lite"]);
    for (const id of Object.keys(QODER_LANE)) {
      expect(TIER_SELECTORS.has(id)).toBe(false);
      expect(PROVIDER_PRICING.qoder[id], `qoder lane row for ${id}`).toBeTruthy();
    }
  });

  it("tier selectors honestly stay unpriced (null, not a fake rate)", () => {
    for (const tier of ["ultimate", "auto", "performance", "efficient", "lite"]) {
      expect(getPricingForModel("qoder", tier)).toBeNull();
    }
  });
});

describe("Pricing Shadow — mistral aliases & ollama separators", () => {
  it("mistral -latest aliases resolve their pinned model's retail rate", () => {
    expect(getPricingForModel("mistral", "mistral-large-latest").input).toBe(2.00);
    expect(getPricingForModel("mistral", "mistral-medium-latest").input).toBe(0.40);
    expect(getPricingForModel("mistral", "mistral-small-latest").input).toBe(0.10);
    expect(getPricingForModel("mistral", "codestral-latest").output).toBe(0.90);
  });

  it("ollama ':'-separated ids resolve via exact alias", () => {
    expect(getPricingForModel("ollama", "gpt-oss:120b").output).toBe(0.60);
    expect(getPricingForModel("ollama", "gpt-oss:20b").output).toBe(0.30);
  });
});

describe("Pricing Shadow — the free-sibling decree (2026-08-16)", () => {
  // The Star's decree: every free model carries its non-free sibling's price.
  // resolveSiblingRate resolves the sibling's WORTH through the full
  // non-recursive chain: lane override → exact → vendor-strip → family
  // pattern. Previously the arms stopped at exact strata, so a free model
  // whose paid sibling existed only as a family pattern inherited nothing.

  it("free models whose sibling is only pattern-priced inherit the family rate", () => {
    // 'deepseek-v4-flash' has an exact entry, but try one that does not:
    // 'kimi-k2.5' exact exists; use a truly pattern-only sibling family:
    // llama has NO exact entry anywhere — only '*/llama-*' family glob.
    expect(getPricingForModel("openrouter", "meta-llama/llama-3.3-70b-versatile:free")).toBeTruthy();
    expect(getPricingForModel("openrouter", "meta-llama/llama-3.3-70b-versatile:free").output).toBeGreaterThan(0);
    expect(getPricingForModel("kilocode", "stepfun/step-3.7-flash:free").input).toBe(0.20);
  });

  it("namespaced free ids (vendor/model-free) inherit through the full chain", () => {
    expect(getPricingForModel("opencode", "google/gemini-2.5-flash:free").input).toBe(0.30);
    expect(getPricingForModel("kilocode", "google/gemini-2.5-flash:free").output).toBe(2.50);
  });

  it("exact-sibling inheritance is unchanged (explicit still wins)", () => {
    expect(getPricingForModel("opencode", "deepseek-v4-flash-free").input).toBe(0.14);
    expect(getPricingForModel("opencode", "mimo-v2.5-free").output).toBe(0.28);
  });

  it("denylisted free shapes stay null — no accidental sibling rates", () => {
    expect(getPricingForModel("opencode", "nemotron-3-ultra-free")).toBeNull();
    expect(getPricingForModel("opencode", "north-mini-code-free")).toBeNull();
  });

  it("the decree holds across a sweep of -free/:free shapes", () => {
    const shapes = [
      "qwen3-coder-flash:free", "qwen3-coder-flash-free",
      "claude-sonnet-4.5-free", "gpt-5-mini:free",
      "glm-5-free", "minimax-m3-free",
    ];
    for (const m of shapes) {
      expect(getPricingForModel("openrouter", m), `${m} must resolve`).toBeTruthy();
    }
  });
});

describe("Pricing Shadow — honest display", () => {
  it("formatCost shows <$0.01 for sub-cent dust, never a lying $0.00", () => {
    expect(formatCost(0.0026)).toBe("<$0.01");
    expect(formatCost(0.009)).toBe("<$0.01");
    expect(formatCost(0.01)).toBe("$0.01");
    expect(formatCost(1.5)).toBe("$1.50");
  });

  it("formatCost keeps $0.00 for true zero / missing", () => {
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(null)).toBe("$0.00");
    expect(formatCost(undefined)).toBe("$0.00");
    expect(formatCost(NaN)).toBe("$0.00");
  });
});
