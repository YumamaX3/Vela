// Pricing Covenant test suite (2026-08-15) — pins the seven-stratum resolver:
// free-model inheritance (R3), denylist negatives, UNPRICEABLE manifest,
// matchPattern compat, pattern precedence, five-field shape, dual-key alias
// resolution, bake-verification against the research harvest, and
// user/sync/static sovereignty order.
//
// NOTE on matchPattern: the glob is ANCHORED ("^...$") — "codex-*" matches
// models that START with codex-, not ones that END with it. Every assertion
// below is traced through getPricingForModel's actual stratum order:
// 3.0 UNPRICEABLE → 3.a/3.b lane (id, then alias) → 3.c exact → 3.d free
// inherit (map, then guarded suffix-strip; exact strata only) → 3.e
// vendor-stripped exact (+3.d-tail) → 3.f pre-compiled PATTERN_PRICING.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import {
  MODEL_PRICING,
  PROVIDER_PRICING,
  PATTERN_PRICING,
  FREE_ALIAS_MAP,
  FREE_DENYLIST,
  UNPRICEABLE,
  PRICING_SOURCES,
  SYNC_VENDOR_MAP,
  matchPattern,
  getPricingForModel,
  resolvePricingWithProvenance,
  calculateCostFromTokens,
} from "../../open-sse/providers/pricing.js";

const RATE_FIELDS = ["input", "output", "cached", "reasoning", "cache_creation"];

describe("Pricing Covenant — five-field shape lint", () => {
  it("every MODEL_PRICING entry has only valid non-negative rate fields", () => {
    for (const [model, rates] of Object.entries(MODEL_PRICING)) {
      for (const [field, value] of Object.entries(rates)) {
        expect(RATE_FIELDS, `unknown field '${field}' on ${model}`).toContain(field);
        expect(typeof value, `non-numeric '${field}' on ${model}`).toBe("number");
        expect(value, `negative '${field}' on ${model}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("every PROVIDER_PRICING lane entry obeys the same shape", () => {
    for (const [provider, models] of Object.entries(PROVIDER_PRICING)) {
      for (const [model, rates] of Object.entries(models)) {
        for (const [field, value] of Object.entries(rates)) {
          expect(RATE_FIELDS, `unknown field '${field}' on ${provider}/${model}`).toContain(field);
          expect(typeof value, `non-numeric on ${provider}/${model}`).toBe("number");
          expect(value, `negative on ${provider}/${model}`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("no pricing entry carries provenance fields (rates stay five-field)", () => {
    for (const rates of Object.values(MODEL_PRICING)) {
      expect(rates.source).toBeUndefined();
      expect(rates.captured).toBeUndefined();
    }
  });
});

describe("Pricing Covenant — free-model inheritance (R3)", () => {
  it("FREE_ALIAS_MAP keys never intersect MODEL_PRICING keys (explicit beats inheritance)", () => {
    for (const freeModel of Object.keys(FREE_ALIAS_MAP)) {
      expect(MODEL_PRICING[freeModel], `${freeModel} has its own canonical entry — remove it or drop the map entry`).toBeUndefined();
    }
  });

  it("every FREE_ALIAS_MAP entry resolves to its sibling's exact rates", () => {
    for (const [freeModel, sibling] of Object.entries(FREE_ALIAS_MAP)) {
      const inherited = getPricingForModel("openrouter", freeModel);
      // The sibling's exact rates — wherever the static chain finds them.
      // Passing 'openrouter' (not the free model's home provider) proves the
      // map works provider-agnostically; provider arg never gates inheritance.
      const siblingRates = getPricingForModel("openrouter", sibling);
      expect(siblingRates, `sibling ${sibling} itself does not resolve — map entry is broken`).toBeTruthy();
      expect(inherited, `${freeModel} → ${sibling} did not resolve`).toEqual(siblingRates);
    }
  });

  it("free models inherit in usage-cost math too (R3: everywhere)", () => {
    const sibling = getPricingForModel("deepseek", "deepseek-v4-flash");
    const free = getPricingForModel("codecrafters", "deepseek-v4-flash:free");
    expect(free).toEqual(sibling);
    const tokens = { prompt_tokens: 1000000, completion_tokens: 1000000 };
    expect(calculateCostFromTokens(tokens, free)).toBeCloseTo(0.14 + 0.28, 6);
  });

  it("guarded suffix-strip resolves exact siblings only, never globs", () => {
    // Explicit map entry: nesarouter/deepseek-v4-flash-free → its nesa lane sibling
    const viaMap = getPricingForModel("nesarouter", "nesarouter/deepseek-v4-flash-free");
    expect(viaMap).toEqual(PROVIDER_PRICING.nesarouter["nesarouter/deepseek-v4-flash"]);

    // Fallback strip (no map entry): nesarouter/glm-5.2-free → bare glm-5.2 exact
    const viaStrip = getPricingForModel("nesarouter", "nesarouter/glm-5.2-free");
    expect(viaStrip).toEqual(MODEL_PRICING["glm-5.2"]);
  });

  it("FREE_DENYLIST entries never inherit via suffix-strip", () => {
    // Infix marker: sibling would be goldeneye-auto — must NOT resolve to any rate
    expect(getPricingForModel("github", "goldeneye-free-auto")).toBeNull();
    // Router tier selector
    expect(getPricingForModel("kilo-gateway", "kilo-auto/free")).toBeNull();
    // Sibling-less router free models stay unresolved
    expect(getPricingForModel("nesarouter", "nesarouter/nesa-free")).toBeNull();
    expect(getPricingForModel("nesarouter", "nesarouter/big-pickle-free")).toBeNull();
  });
});

describe("Pricing Covenant — UNPRICEABLE manifest", () => {
  it("router pseudo-models resolve null with a manifest entry", () => {
    expect(getPricingForModel("openrouter", "best")).toBeNull();
    expect(getPricingForModel("openrouter", "default")).toBeNull();
    expect(getPricingForModel("bazaarlink", "universal-2")).toBeNull();
    expect(getPricingForModel("bazaarlink", "universal-3-pro")).toBeNull();
  });

  it("no-token-pricing lanes resolve null for any model", () => {
    expect(getPricingForModel("hyperbolic", "llama-4-scout-17b-16e-instruct")).toBeNull();
    expect(getPricingForModel("featherless", "any-model")).toBeNull();
  });

  it("manifest entries carry a reason enum", () => {
    for (const u of UNPRICEABLE) {
      expect(["router-pseudo-model", "dynamic-only", "media-deferred", "no-token-pricing"]).toContain(u.reason);
    }
  });
});

describe("Pricing Covenant — matchPattern compat + pattern precedence", () => {
  it("matchPattern keeps its anchored-glob semantics (capabilities/thinkingLevels depend on it)", () => {
    // Anchored prefix match
    expect(matchPattern("codex-*", "codex-mini-2027")).toBe(true);
    expect(matchPattern("claude-*", "claude-opus-4.6")).toBe(true);
    expect(matchPattern("gemini-*-flash", "gemini-3.6-flash")).toBe(true);
    // Anchored suffix match
    expect(matchPattern("*-codex", "gpt-5.3-codex")).toBe(true);
    // No substring match — the glob is anchored at both ends
    expect(matchPattern("codex-*", "gpt-5.3-codex")).toBe(false);
    expect(matchPattern("gpt-*", "claude-opus-5")).toBe(false);
  });

  it("overlapping codex globs keep specific-before-generic order", () => {
    const idx = p => PATTERN_PRICING.findIndex(e => e.pattern === p);
    expect(idx("*-codex-xhigh")).toBeLessThan(idx("*-codex-max"));
    expect(idx("*-codex-mini-*")).toBeLessThan(idx("codex-*"));
    expect(idx("codex-*")).toBeLessThan(idx("*-codex"));
  });

  it("claude and gpt families keep specific-before-generic order", () => {
    const idx = p => PATTERN_PRICING.findIndex(e => e.pattern === p);
    expect(idx("claude-opus-*")).toBeLessThan(idx("claude-*"));
    expect(idx("claude-haiku-*")).toBeLessThan(idx("claude-*"));
    expect(idx("gpt-5.6-*")).toBeLessThan(idx("gpt-5*"));
  });
});

describe("Pricing Covenant — dual-key alias resolution", () => {
  it("registry-id lookup reaches alias-keyed provider lanes (the gh lane)", () => {
    // usage rows record registry id 'github'; PROVIDER_PRICING keys the lane 'gh'
    const r = getPricingForModel("github", "gpt-5.3-codex");
    expect(r).toEqual(PROVIDER_PRICING.gh["gpt-5.3-codex"]);
  });

  it("registry-id lane tables win for namespaced router ids", () => {
    expect(getPricingForModel("cloudflare-ai", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"))
      .toEqual(PROVIDER_PRICING["cloudflare-ai"]["@cf/meta/llama-3.3-70b-instruct-fp8-fast"]);
    expect(getPricingForModel("nesarouter", "nesarouter/step-3.5-flash"))
      .toEqual(PROVIDER_PRICING.nesarouter["nesarouter/step-3.5-flash"]);
  });
});

describe("Pricing Covenant — provenance + sync map", () => {
  it("PRICING_SOURCES carries source + captured for every named vendor", () => {
    for (const [k, v] of Object.entries(PRICING_SOURCES)) {
      if (k === "_bulk") continue;
      expect(v.source, k).toBeTruthy();
      expect(v.captured, k).toBe("2026-08-15");
    }
  });

  it("SYNC_VENDOR_MAP hardcodes URLs (SSRF defense: body never supplies URLs)", () => {
    expect(SYNC_VENDOR_MAP.modelsdev.url).toBe("https://models.dev/api.json");
    expect(SYNC_VENDOR_MAP.openrouter.url).toBe("https://openrouter.ai/api/v1/models");
  });

  it("resolvePricingWithProvenance returns source, lane, and inheritance path", () => {
    const r = resolvePricingWithProvenance("deepseek", "deepseek-v4-flash");
    expect(r.pricing).toEqual(MODEL_PRICING["deepseek-v4-flash"]);
    expect(r.source).toContain("deepseek");

    // Free inheritance is flagged in the provenance record
    const f = resolvePricingWithProvenance("codecrafters", "deepseek-v4-flash:free");
    expect(f.via).toBe("free-inherit");
    expect(f.pricing).toEqual(MODEL_PRICING["deepseek-v4-flash"]);

    // Unpriced models resolve null — no fabricated provenance
    expect(resolvePricingWithProvenance("hyperbolic", "llama-4-scout")).toBeNull();
  });
});

describe("Pricing Covenant — bake verification against the harvest", () => {
  // Mechanical guard: researched harvest rates (plans/research/) must equal
  // what landed in pricing.js after field mapping. Covers transcription drift.
  const harvestPath = path.join(__dirname, "..", "..", "plans", "research", "models-dev-harvest-2026-08-15.json");
  let harvest;
  beforeAll(() => {
    harvest = JSON.parse(fs.readFileSync(harvestPath, "utf8"));
  });

  const mapCost = (c) => {
    const out = {};
    if (c.input !== undefined) out.input = c.input;
    if (c.output !== undefined) out.output = c.output;
    if (c.cache_read !== undefined) out.cached = c.cache_read;
    if (c.cache_write !== undefined) out.cache_creation = c.cache_write;
    if (c.reasoning !== undefined) out.reasoning = c.reasoning;
    return out;
  };

  it("canonical harvest entries match MODEL_PRICING", () => {
    const canonicalChecks = [
      ["deepseek", "deepseek-v4-flash"],
      ["moonshotai", "kimi-k3"],
      ["moonshotai", "kimi-k2.5"],
      ["zai", "glm-5.2"],
      ["minimax", "MiniMax-M2.7"],
      ["xai", "grok-4.5"],
      ["anthropic", "claude-opus-5"],
      ["google", "gemini-2.5-pro"],
      ["openai", "o3"],
      ["openai", "o4-mini"],
      ["openai", "gpt-5.6-luna"],
      ["cohere", "command-a-03-2025"],
      ["groq", "llama-3.3-70b-versatile"],
    ];
    for (const [vendor, model] of canonicalChecks) {
      const cost = harvest.providers?.[vendor]?.[model];
      expect(cost, `harvest missing ${vendor}/${model}`).toBeTruthy();
      const expected = mapCost(cost);
      for (const [field, value] of Object.entries(expected)) {
        expect(MODEL_PRICING[model]?.[field], `${model}.${field}`).toBe(value);
      }
    }
  });

  it("lane-table harvest entries match PROVIDER_PRICING by registry id", () => {
    const fw = harvest.providers?.fireworks?.["accounts/fireworks/models/llama-v3p3-70b-instruct"];
    expect(fw, "harvest missing the fireworks lane model").toBeTruthy();
    expect(PROVIDER_PRICING.fireworks["accounts/fireworks/models/llama-v3p3-70b-instruct"].input).toBe(fw.input);
  });
});

describe("Pricing Covenant — sovereignty order (user > sync > static)", () => {
  const originalDataDir = process.env.DATA_DIR;
  let tempDir;
  let db;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-pricing-cov-"));
    process.env.DATA_DIR = tempDir;
    vi.resetModules();
    db = await import("@/lib/db/index.js");
    await db.initDb();
  });

  afterAll(() => {
    // Release the SQLite handle before removing the temp dir (Windows EPERM).
    // Reset IN PLACE — the driver module holds a reference to this object;
    // replacing it would strand later getAdapter() calls on the closed handle.
    try { global._dbAdapter?.instance?.close?.(); } catch {}
    if (global._dbAdapter) {
      global._dbAdapter.instance = null;
      global._dbAdapter.initPromise = null;
    }
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("static chain resolves with no user/sync layers", async () => {
    const r = await db.getPricingForModel("deepseek", "deepseek-v4-flash");
    expect(r).toEqual(MODEL_PRICING["deepseek-v4-flash"]);
  });

  it("sync layer overrides static defaults", async () => {
    await db.replaceSyncedPricing(
      { deepseek: { "deepseek-v4-flash": { input: 0.5, output: 1.0 } } },
      { syncedAt: "2026-08-15T00:00:00.000Z", sources: [], entryCount: 1 }
    );
    const r = await db.getPricingForModel("deepseek", "deepseek-v4-flash");
    expect(r.input).toBe(0.5);
    expect(r.output).toBe(1.0);
  });

  it("user override beats the sync layer (R7 sovereignty)", async () => {
    await db.updatePricing({ deepseek: { "deepseek-v4-flash": { input: 9.9 } } });
    const r = await db.getPricingForModel("deepseek", "deepseek-v4-flash");
    expect(r.input).toBe(9.9);
  });

  it("user override under the registry id wins over alias-keyed lookup", async () => {
    // dual-key conflict fixture: id-keyed override must win for id-routed usage
    await db.updatePricing({ github: { "gpt-5.3-codex": { input: 1.0 } } });
    const r = await db.getPricingForModel("github", "gpt-5.3-codex");
    expect(r.input).toBe(1.0);
  });

  it("reset user overrides reveals the sync layer; clear sync reveals static", async () => {
    await db.resetAllPricing();
    let r = await db.getPricingForModel("deepseek", "deepseek-v4-flash");
    expect(r.input).toBe(0.5); // sync layer still standing

    await db.clearSyncedPricing();
    r = await db.getPricingForModel("deepseek", "deepseek-v4-flash");
    expect(r).toEqual(MODEL_PRICING["deepseek-v4-flash"]); // back to static
  });

  it("getPricing merged view exposes the canonical table under _canonical", async () => {
    const merged = await db.getPricing();
    expect(merged._canonical).toBeDefined();
    expect(merged._canonical["deepseek-v4-flash"]).toBeTruthy();
  });
});
