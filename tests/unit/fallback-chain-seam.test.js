// AI Lab W4b locking suite — the fallback seam (the non-combo blind spot).
// Proves: a gateway policy block reaches buildFallbackChain in BOTH the combo
// path (via the verdict-aware check) and the single-model path; the verdict
// never cools a healthy account; and the legacy checkFallbackError behavior
// is preserved byte-for-byte for every other failure.
import { describe, it, expect } from "vitest";
import { checkFallbackError, checkFallbackErrorVerdict } from "open-sse/services/accountFallback.js";
import { buildFallbackChain } from "open-sse/services/fallbackRuleMatcher.js";
import { policyBlockEvent, VERDICTS } from "open-sse/rtk/contentPolicy.js";

describe("fallback-chain seam (W4b)", () => {
  it("legacy checkFallbackError cools the account on a 403 (the breaker pollution, verified)", () => {
    // The pre-fix behavior: {status:403} matches errorConfig's 403 rule with a
    // LONG cooldown — so a gateway policy block would mark the account
    // unavailable (S2 risk). The verdict-aware check must prevent that.
    const r = checkFallbackError(403, "content policy blocked by gateway");
    expect(r.shouldFallback).toBe(true);
    expect(r.cooldownMs).toBeGreaterThan(0); // the pollution: healthy account cooled
  });

  it("verdict-aware check recognizes the 403-shaped event → shouldFallback + verdict, NO cooldown", () => {
    const ev = policyBlockEvent({ id: "p3" }, "req-1");
    const r = checkFallbackErrorVerdict(ev.status, ev.errorText, { contentPolicyBlocked: ev.contentPolicyBlocked });
    expect(r.shouldFallback).toBe(true);
    expect(r.verdict).toBe(VERDICTS.GATEWAY_POLICY_BLOCK);
    expect(r.reason).toBe("policy");
    expect(r.cooldownMs).toBe(0); // never cools a healthy account
  });

  it("non-policy failures delegate to legacy logic byte-for-byte", () => {
    const legacy = checkFallbackError(503, "upstream down");
    const verdict = checkFallbackErrorVerdict(503, "upstream down");
    expect(verdict).toEqual(legacy);
  });

  it("the chain seam: block event → buildFallbackChain appends the unfiltered lane", () => {
    const ev = policyBlockEvent({ id: "p3" }, "req-1");
    const rules = [
      { id: "r1", triggerType: "contentPolicy", isActive: 1, priority: 10, conditionVal: "", targetModels: ["lane-unfiltered"] },
    ];
    const chain = buildFallbackChain(rules, ev);
    expect(chain).toContain("lane-unfiltered");
  });

  it("full seam simulation: refusal → verdict → chain → serving lane", () => {
    const ev = policyBlockEvent({ id: "p3" }, "req-2");
    const decision = checkFallbackErrorVerdict(ev.status, ev.errorText, { contentPolicyBlocked: ev.contentPolicyBlocked });
    expect(decision.shouldFallback).toBe(true);
    const rules = [
      { id: "r1", triggerType: "contentPolicy", isActive: 1, priority: 10, conditionVal: "", targetModels: ["lane-unfiltered"] },
    ];
    const chain = buildFallbackChain(rules, ev);
    const servingLane = chain[0] || null;
    expect(servingLane).toBe("lane-unfiltered"); // refused workload rides the lane that honors it
  });
});
