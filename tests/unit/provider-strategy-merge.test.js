// Provider strategy merge — one override object, three cards writing it.
import { describe, it, expect } from "vitest";
import { mergeProviderStrategy } from "@/shared/utils/providerStrategy.js";

describe("mergeProviderStrategy", () => {
  it("keeps the proxy fields when the round-robin toggle writes", () => {
    const before = { opencode: { proxyPoolId: "pool-1", rotateStrategy: "random" } };
    const after = mergeProviderStrategy(before, "opencode", {
      fallbackStrategy: "round-robin",
      stickyRoundRobinLimit: 3,
    });
    expect(after.opencode).toEqual({
      proxyPoolId: "pool-1",
      rotateStrategy: "random",
      fallbackStrategy: "round-robin",
      stickyRoundRobinLimit: 3,
    });
  });

  it("keeps the strategy when the keyless proxy card writes", () => {
    const before = { opencode: { fallbackStrategy: "round-robin", stickyRoundRobinLimit: 3 } };
    const after = mergeProviderStrategy(before, "opencode", {
      proxyPoolId: "pool-2",
      rotateStrategy: "round-robin",
    });
    expect(after.opencode).toEqual({
      fallbackStrategy: "round-robin",
      stickyRoundRobinLimit: 3,
      proxyPoolId: "pool-2",
      rotateStrategy: "round-robin",
    });
  });

  it("removes only the cleared field, and the provider key when nothing is left", () => {
    const before = { opencode: { proxyPoolId: "pool-1", fallbackStrategy: "round-robin" } };
    const cleared = mergeProviderStrategy(before, "opencode", { proxyPoolId: null });
    expect(cleared.opencode).toEqual({ fallbackStrategy: "round-robin" });

    const empty = mergeProviderStrategy({ opencode: { proxyPoolId: "pool-1" } }, "opencode", {
      proxyPoolId: null,
      rotateStrategy: "",
    });
    expect(empty).toEqual({});
  });

  it("leaves other providers untouched", () => {
    const before = { anthropic: { fallbackStrategy: "round-robin" } };
    const after = mergeProviderStrategy(before, "opencode", { proxyPoolId: "pool-1" });
    expect(after.anthropic).toEqual({ fallbackStrategy: "round-robin" });
    expect(after.opencode).toEqual({ proxyPoolId: "pool-1" });
  });
});
