/**
 * Resilience Covenant Test Suite — Seam 1 (circuit breaker) + Seam 2 (fallback rules)
 *
 * Aligned to plans/resilience-covenant-v0.9.15.md. Real assertions proving the
 * breaker state machine, hard-skip semantics, Retry-After honoring, fail-open
 * law, and the combo DB-rules merge. No tautologies.
 */
import { describe, it, expect, vi } from "vitest";

// ────────────────────────────────────────────────────────────────────────────
// Seam 1 — circuit breaker
// ────────────────────────────────────────────────────────────────────────────

// Import the module fresh per test so in-memory state doesn't leak across cases.
async function freshBreaker() {
  const mod = await import("../../src/lib/network/circuitBreaker.js");
  mod.clearAll();
  return mod;
}

describe("Seam 1 — circuit breaker state machine", () => {
  it("healthy key is available", async () => {
    const cb = await freshBreaker();
    expect(cb.isAvailable("p1", "prov1", "model-a")).toBe(true);
  });

  it("3 consecutive failures trip cooldown and HARD-SKIP the pool", async () => {
    const cb = await freshBreaker();
    vi.useFakeTimers();
    try {
      for (let i = 0; i < 3; i++) cb.recordFailure("p1", "prov1", "model-a");
      // In cooldown (1s backoff at n=3) → must be unavailable (hard skip, not pass-through)
      expect(cb.isAvailable("p1", "prov1", "model-a")).toBe(false);
      const snap = cb.getSnapshot().find((s) => s.poolId === "p1");
      expect(snap.state).toBe("cooldown");
      expect(snap.failureCount).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("8 consecutive failures escalate to exhausted", async () => {
    const cb = await freshBreaker();
    for (let i = 0; i < 8; i++) cb.recordFailure("p1", "prov1", "model-a");
    const snap = cb.getSnapshot().find((s) => s.poolId === "p1");
    expect(snap.state).toBe("exhausted");
    expect(cb.isAvailable("p1", "prov1", "model-a")).toBe(false);
  });

  it("backoff is exponential capped at 5 minutes", async () => {
    const cb = await freshBreaker();
    vi.useFakeTimers();
    try {
      // At 8 failures, exponent = 8-3 = 5 → 2^5 = 32 SECONDS = 32000ms
      for (let i = 0; i < 8; i++) cb.recordFailure("p1", "prov1", "model-a");
      const snap = cb.getSnapshot().find((s) => s.poolId === "p1");
      const backoff = snap.cooldownUntil - snap.lastFailureAt;
      expect(backoff).toBe(32_000);
      // Cap: 25 failures → 2^22s is astronomic → capped at 300_000ms (5 min)
      for (let i = 0; i < 25; i++) cb.recordFailure("p2", "prov2", "model-a");
      const snap2 = cb.getSnapshot().find((s) => s.poolId === "p2");
      const backoff2 = snap2.cooldownUntil - snap2.lastFailureAt;
      expect(backoff2).toBe(300_000); // capped at 5 min
    } finally {
      vi.useRealTimers();
    }
  });

  it("Retry-After header is honored as explicit cooldown", async () => {
    const cb = await freshBreaker();
    vi.useFakeTimers();
    try {
      cb.onRetryAfter("p1", "prov1", "model-a", 10_000);
      const snap = cb.getSnapshot().find((s) => s.poolId === "p1");
      expect(snap.state).toBe("cooldown");
      expect(snap.retryAfterMs).toBe(10_000);
      // With fake timers Date.now is frozen at the real epoch: cooldownUntil = epoch + 10000
      expect(snap.cooldownUntil).toBe(Date.now() + 10_000);
      expect(cb.isAvailable("p1", "prov1", "model-a")).toBe(false);
      vi.advanceTimersByTime(10_001);
      expect(cb.isAvailable("p1", "prov1", "model-a")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("success resets the breaker to healthy", async () => {
    const cb = await freshBreaker();
    for (let i = 0; i < 5; i++) cb.recordFailure("p1", "prov1", "model-a");
    expect(cb.isAvailable("p1", "prov1", "model-a")).toBe(false);
    cb.recordSuccess("p1", "prov1", "model-a");
    const snap = cb.getSnapshot().find((s) => s.poolId === "p1");
    expect(snap.state).toBe("healthy");
    expect(snap.failureCount).toBe(0);
    expect(cb.isAvailable("p1", "prov1", "model-a")).toBe(true);
  });

  it("cooldown expires and re-enables the pool (auto-recovery)", async () => {
    const cb = await freshBreaker();
    vi.useFakeTimers();
    try {
      for (let i = 0; i < 3; i++) cb.recordFailure("p1", "prov1", "model-a");
      expect(cb.isAvailable("p1", "prov1", "model-a")).toBe(false);
      // 3 failures → backoff 2^0 = 1s; advance past it
      vi.advanceTimersByTime(1_100);
      expect(cb.isAvailable("p1", "prov1", "model-a")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resetKey manually clears a key to healthy", async () => {
    const cb = await freshBreaker();
    for (let i = 0; i < 8; i++) cb.recordFailure("p1", "prov1", "model-a");
    expect(cb.isAvailable("p1", "prov1", "model-a")).toBe(false);
    cb.resetKey("p1", "prov1", "model-a");
    expect(cb.isAvailable("p1", "prov1", "model-a")).toBe(true);
  });

  it("FAIL-OPEN: isAvailable never throws and returns true for healthy/unknown keys", async () => {
    const cb = await freshBreaker();
    // Unknown keys are healthy → true
    expect(cb.isAvailable("never", "seen", "key")).toBe(true);
    // A single failure stays healthy (below threshold) → still available
    cb.recordFailure("x", "y", "z");
    expect(cb.isAvailable("x", "y", "z")).toBe(true);
    // recordFailure itself never throws even with garbage input
    expect(() => cb.recordFailure(null, undefined, "")).not.toThrow();
    expect(cb.isAvailable(null, undefined, "")).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Seam 2 — fallback-rules DB merge in combo expansion
// ────────────────────────────────────────────────────────────────────────────

describe("Seam 2 — fallback-rules DB merge in combo expansion", () => {
  it("returns hardcoded combo models when DB is empty (byte-identical legacy)", async () => {
    const { getComboModelsFromData } = await import("../../open-sse/services/combo.js");
    const combos = [{ name: "combo-a", models: ["p1/m1", "p2/m2"] }];
    const rulesRepo = { getRulesForSourceModel: vi.fn().mockResolvedValue([]) };
    const models = await getComboModelsFromData("combo-a", combos, rulesRepo, "429");
    expect(models).toEqual(["p1/m1", "p2/m2"]);
    expect(rulesRepo.getRulesForSourceModel).toHaveBeenCalled();
  });

  it("merges DB fallback rules (DB wins, hardcoded defaults retained)", async () => {
    const { getComboModelsFromData } = await import("../../open-sse/services/combo.js");
    const combos = [{ name: "combo-a", models: ["p1/m1", "p2/m2"] }];
    const rulesRepo = {
      getRulesForSourceModel: vi.fn().mockResolvedValue([
        { targetModel: "p3/m3", priority: 10, triggerOnStatus: "429,503", maxRetries: 2 },
      ]),
    };
    const models = await getComboModelsFromData("combo-a", combos, rulesRepo, "429");
    expect(models).toContain("p3/m3"); // DB rule appended
    expect(models).toContain("p1/m1"); // hardcoded retained
  });

  it("filters rules by trigger status — non-matching status not applied", async () => {
    const { getComboModelsFromData } = await import("../../open-sse/services/combo.js");
    const combos = [{ name: "combo-a", models: ["p1/m1"] }];
    const rulesRepo = {
      getRulesForSourceModel: vi.fn().mockResolvedValue([
        { targetModel: "p2/m2", priority: 10, triggerOnStatus: "500", maxRetries: 1 },
      ]),
    };
    const models = await getComboModelsFromData("combo-a", combos, rulesRepo, "429");
    expect(models).toEqual(["p1/m1"]); // 500 rule not applied to 429
  });

  it("sorts rules by priority (lower first)", async () => {
    const { getComboModelsFromData } = await import("../../open-sse/services/combo.js");
    const combos = [{ name: "combo-a", models: ["p1/m1"] }];
    const rulesRepo = {
      getRulesForSourceModel: vi.fn().mockResolvedValue([
        { targetModel: "p9/m9", priority: 200, triggerOnStatus: "429", maxRetries: 1 },
        { targetModel: "p3/m3", priority: 10, triggerOnStatus: "429", maxRetries: 1 },
        { targetModel: "p5/m5", priority: 50, triggerOnStatus: "429", maxRetries: 1 },
      ]),
    };
    const models = await getComboModelsFromData("combo-a", combos, rulesRepo, "429");
    const idx = (m) => models.indexOf(m);
    expect(idx("p3/m3")).toBeLessThan(idx("p5/m5"));
    expect(idx("p5/m5")).toBeLessThan(idx("p9/m9"));
  });

  it("FAIL-OPEN: repo throw falls back to hardcoded models", async () => {
    const { getComboModelsFromData } = await import("../../open-sse/services/combo.js");
    const combos = [{ name: "combo-a", models: ["p1/m1"] }];
    const rulesRepo = {
      getRulesForSourceModel: vi.fn().mockRejectedValue(new Error("db down")),
    };
    const models = await getComboModelsFromData("combo-a", combos, rulesRepo, "429");
    expect(models).toEqual(["p1/m1"]); // fail-open → legacy
  });

  it("non-combo provider/model string returns null (unchanged)", async () => {
    const { getComboModelsFromData } = await import("../../open-sse/services/combo.js");
    const models = await getComboModelsFromData("openai/gpt-4o", [], null, "429");
    expect(models).toBeNull();
  });
});
