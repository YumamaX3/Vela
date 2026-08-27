// Test covenant: hygieneScoring — honest weights, age-exemption,
// expiry never contributes, factors exposed (W1d).
import { describe, it, expect } from "vitest";
import { scoreKey, bandOf, HYGIENE_WEIGHTS } from "@/lib/endpoint/hygieneScoring.js";

const NOW = new Date("2026-08-26T12:00:00.000Z").getTime();
const ISO = (ms) => new Date(ms).toISOString();

const clean = {
  id: "k1", name: "clean", keyHash: "abc", keyPrefix: "vela_ab", isActive: 1,
  allowedModels: ["gpt-4o"], allowedKinds: ["llm"], allowedProviders: ["openai"],
  budgetScope: "daily", ipAllowlist: ["127.0.0.1"], expiresAt: ISO(NOW + 86400000 * 30),
  createdAt: ISO(NOW - 86400000 * 10), lastUsedAt: ISO(NOW - 3600000),
};

describe("hygieneScoring — honest factors", () => {
  it("clean key scores 100, band good", () => {
    const r = scoreKey(clean, NOW);
    expect(r.score).toBe(100);
    expect(r.band).toBe("good");
    expect(r.factors).toHaveLength(0);
  });

  it("unrestricted ACL deducts published weight", () => {
    const r = scoreKey({ ...clean, allowedModels: null, allowedKinds: null, allowedProviders: null }, NOW);
    expect(r.score).toBe(100 - HYGIENE_WEIGHTS.unrestrictedAcl);
    expect(r.factors.some((f) => f.id === "unrestrictedAcl")).toBe(true);
  });

  it("expiry NEVER contributes a factor", () => {
    const near = { ...clean, expiresAt: ISO(NOW + 1000) };
    const r = scoreKey(near, NOW);
    expect(r.factors.some((f) => f.id === "expired")).toBe(false);
  });

  it("age-exemption: no-expiry penalty waived past 90d", () => {
    const old = { ...clean, expiresAt: null, createdAt: ISO(NOW - 86400000 * 120) };
    const r = scoreKey(old, NOW);
    expect(r.factors.some((f) => f.id === "noExpiry")).toBe(false);
  });

  it("young no-expiry key DOES take the penalty", () => {
    const young = { ...clean, expiresAt: null, createdAt: ISO(NOW - 86400000 * 10) };
    const r = scoreKey(young, NOW);
    expect(r.factors.some((f) => f.id === "noExpiry")).toBe(true);
  });

  it("unused > 30d flags dormant urgency", () => {
    const dormant = { ...clean, lastUsedAt: ISO(NOW - 86400000 * 40) };
    const r = scoreKey(dormant, NOW);
    expect(r.urgencyChip).toBe("dormant");
    expect(r.factors.some((f) => f.id === "unusedLong")).toBe(true);
  });

  it("internal keys skip posture penalties", () => {
    const r = scoreKey({ ...clean, isInternal: 1, allowedModels: null, budgetScope: null }, NOW);
    expect(r.score).toBe(100);
  });

  it("fail-open: garbage → null", () => {
    expect(scoreKey(null, NOW)).toBeNull();
    expect(scoreKey({}, "not-a-date")).toBeNull();
  });

  it("band thresholds", () => {
    expect(bandOf(90)).toBe("good");
    expect(bandOf(60)).toBe("fair");
    expect(bandOf(30)).toBe("poor");
    expect(bandOf(null)).toBe("unknown");
  });
});
