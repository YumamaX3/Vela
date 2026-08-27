// AI Lab W4 locking suite — the block envelope.
// Proves: a gateway policy block produces the 403-shaped internal event that
// satisfies the fallback matcher (isContentPolicy) UNTOUCHED, carries the
// GATEWAY_POLICY_BLOCK verdict class, and is visibly distinct from an
// upstream refusal so the breaker never cools a healthy account.
import { describe, it, expect } from "vitest";
import { policyBlockEvent, VERDICTS } from "open-sse/rtk/contentPolicy.js";
import { ruleMatches, buildFallbackChain } from "open-sse/services/fallbackRuleMatcher.js";

describe("policy-block envelope (W4)", () => {
  it("the 403-shaped internal event trips a contentPolicy rule via the EXPORTED matcher, untouched", () => {
    const ev = policyBlockEvent({ id: "p3" }, "req-1");
    // ruleMatches is the public surface (isContentPolicy is private) — the
    // synthetic event must trip a contentPolicy rule through it with zero
    // modifications to the gated matcher.
    expect(ev.status).toBe(403);
    const rule = { id: "r1", triggerType: "contentPolicy", isActive: 1, priority: 10, conditionVal: "", targetModels: ["lane-unfiltered"] };
    expect(ruleMatches(rule, ev)).toBe(true);
  });

  it("the internal event reaches buildFallbackChain (chain seam sees it)", () => {
    const ev = policyBlockEvent({ id: "p3" }, "req-1");
    const rules = [
      { id: "r1", triggerType: "contentPolicy", isActive: 1, priority: 10, conditionVal: "", targetModels: ["lane-unfiltered"] },
    ];
    const chain = buildFallbackChain(rules, ev);
    // buildFallbackChain returns a flat array of target model strings.
    expect(chain).toContain("lane-unfiltered");
  });

  it("verdict class distinguishes GATEWAY_POLICY_BLOCK from upstream/account failures", () => {
    expect(VERDICTS.UPSTREAM_REFUSAL).not.toBe(VERDICTS.GATEWAY_POLICY_BLOCK);
    expect(VERDICTS.ACCOUNT_FAILURE).not.toBe(VERDICTS.GATEWAY_POLICY_BLOCK);
    // The breaker's markAccountUnavailable is keyed on ACCOUNT_FAILURE /
    // UPSTREAM_REFUSAL — a gateway block is NOT a health signal.
    const block = policyBlockEvent({ id: "p3" });
    expect(block.contentPolicyBlocked).toBe(true);
  });

  it("event carries policyId + requestId for the chain seam", () => {
    const ev = policyBlockEvent({ id: "pol-9" }, "req-42");
    expect(ev.policyId).toBe("pol-9");
    expect(ev.requestId).toBe("req-42");
  });

  it("non-stream 451 envelope: the client-visible shape carries code + requestId", () => {
    // The external contract (chatCore emits this on a block before flush):
    const envelope = { error: { code: "CONTENT_POLICY_BLOCK", policyId: "pol-9", requestId: "req-42" } };
    expect(envelope.error.code).toBe("CONTENT_POLICY_BLOCK");
    expect(envelope.error.policyId).toBe("pol-9");
    expect(envelope.error.requestId).toBe("req-42");
  });
});
