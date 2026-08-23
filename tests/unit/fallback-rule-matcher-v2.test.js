/**
 * Fallback Rule Matcher v2 — trigger-condition engine (v0.9.23)
 *
 * Proves the typed trigger model:
 *   T1. status rules match by CSV (v2 conditionVal + legacy triggerOnStatus)
 *   T2. contentPolicy rules fire on policy refusals only
 *   T3. contextWindow rules fire pre-call by token ratio
 *   T4. timeout rules fire on timed-out events
 *   T5. anyError catches everything
 *   T6. multi-hop chains expand in priority order, deduped
 *   T7. disabled rules never fire; absent isActive stays active (v1 compat)
 */
import { describe, it, expect } from "vitest";
import { ruleMatches, buildFallbackChain } from "../../open-sse/services/fallbackRuleMatcher.js";

describe("T1: status rules", () => {
  it("matches v2 conditionVal CSV", () => {
    const rule = { triggerType: "status", conditionOp: "in", conditionVal: "429,503", targetModels: ["b"] };
    expect(ruleMatches(rule, { status: 429 })).toBe(true);
    expect(ruleMatches(rule, { status: 503 })).toBe(true);
    expect(ruleMatches(rule, { status: 500 })).toBe(false);
  });

  it("falls back to legacy triggerOnStatus when conditionVal is null", () => {
    const rule = { triggerOnStatus: "408,429", targetModel: "x" };
    expect(ruleMatches(rule, { status: 408 })).toBe(true);
    expect(ruleMatches(rule, { status: 200 })).toBe(false);
  });

  it("defaults bare legacy rules to 429,503", () => {
    const rule = { targetModel: "x" };
    expect(ruleMatches(rule, { status: 429 })).toBe(true);
    expect(ruleMatches(rule, { status: 503 })).toBe(true);
    expect(ruleMatches(rule, { status: 401 })).toBe(false);
  });
});

describe("T2: contentPolicy rules", () => {
  it("fires on 400/403 with policy language", () => {
    const rule = { triggerType: "contentPolicy", targetModels: ["safe-model"] };
    expect(ruleMatches(rule, { status: 403, errorText: "content policy violation" })).toBe(true);
    expect(ruleMatches(rule, { status: 400, errorText: "Our content filter refused this" })).toBe(true);
  });

  it("does not fire on plain 403 without policy language", () => {
    const rule = { triggerType: "contentPolicy", targetModels: ["safe-model"] };
    expect(ruleMatches(rule, { status: 403, errorText: "forbidden" })).toBe(false);
  });
});

describe("T3: contextWindow rules", () => {
  it("fires pre-call when the token ratio crosses the threshold", () => {
    const rule = { triggerType: "contextWindow", conditionOp: "gte", conditionVal: "0.9", targetModels: ["big-model"] };
    expect(ruleMatches(rule, { inputTokens: 95, contextLimit: 100 })).toBe(true);
    expect(ruleMatches(rule, { inputTokens: 80, contextLimit: 100 })).toBe(false);
  });

  it("lte operator inverts the comparison", () => {
    const rule = { triggerType: "contextWindow", conditionOp: "lte", conditionVal: "0.5", targetModels: ["small-model"] };
    expect(ruleMatches(rule, { inputTokens: 40, contextLimit: 100 })).toBe(true);
    expect(ruleMatches(rule, { inputTokens: 60, contextLimit: 100 })).toBe(false);
  });

  it("never fires when there is no context limit", () => {
    const rule = { triggerType: "contextWindow", targetModels: ["big-model"] };
    expect(ruleMatches(rule, { inputTokens: 999999 })).toBe(false);
  });
});

describe("T4/T5: timeout + anyError", () => {
  it("timeout fires only on timed-out events", () => {
    const rule = { triggerType: "timeout", targetModels: ["retry-model"] };
    expect(ruleMatches(rule, { timedOut: true })).toBe(true);
    expect(ruleMatches(rule, { status: 504 })).toBe(false);
  });

  it("anyError catches every failure", () => {
    const rule = { triggerType: "anyError", targetModels: ["catch-all"] };
    expect(ruleMatches(rule, { status: 500 })).toBe(true);
    expect(ruleMatches(rule, { status: 429 })).toBe(true);
    expect(ruleMatches(rule, { timedOut: true })).toBe(true);
    expect(ruleMatches(rule, {})).toBe(false);
  });
});

describe("T6/T7: chains + activation", () => {
  it("expands multi-hop chains in priority order, deduped", () => {
    const rules = [
      { sourceModel: "combo/x", priority: 10, triggerOnStatus: "429", targetModel: "provider/a", targetModels: ["provider/a", "provider/b"] },
      { sourceModel: "combo/x", priority: 20, triggerOnStatus: "429", targetModels: ["provider/b", "provider/c"] },
    ];
    expect(buildFallbackChain(rules, { status: 429 })).toEqual(["provider/a", "provider/b", "provider/c"]);
  });

  it("disabled rules never fire; absent isActive stays active (v1 compat)", () => {
    const disabled = { isActive: 0, triggerOnStatus: "429", targetModel: "x" };
    const legacy = { triggerOnStatus: "429", targetModel: "y" };
    expect(ruleMatches(disabled, { status: 429 })).toBe(false);
    expect(ruleMatches(legacy, { status: 429 })).toBe(true);
  });
});
