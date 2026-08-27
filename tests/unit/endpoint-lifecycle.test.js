// Test covenant: lifecycleOf — the 6-state machine (W1d).
// Precedence ladder, boundary values, injected-now goldens (clock-pinning).
import { describe, it, expect } from "vitest";
import { lifecycleOf, lifecycleCounts, LIFECYCLE } from "@/lib/endpoint/lifecycleOf.js";

const NOW = new Date("2026-08-26T12:00:00.000Z").getTime();
const ISO = (ms) => new Date(ms).toISOString();
const active = {
  id: "k1", name: "key", keyHash: "abc", keyPrefix: "vela_ab",
  isActive: 1, createdAt: ISO(NOW - 86400000), deletedAt: null,
};

describe("lifecycleOf — 6 states", () => {
  it("active when serving", () => {
    expect(lifecycleOf(active, NOW)).toBe(LIFECYCLE.ACTIVE);
  });

  it("deleted beats all (rung 1)", () => {
    const row = { ...active, deletedAt: ISO(NOW), expiresAt: ISO(NOW - 1000), isActive: 0, keyHash: null };
    expect(lifecycleOf(row, NOW)).toBe(LIFECYCLE.DELETED);
  });

  it("revoked when hash purged + row visible (rung 2)", () => {
    const row = { ...active, isActive: 0, keyHash: null, deletedAt: null };
    expect(lifecycleOf(row, NOW)).toBe(LIFECYCLE.REVOKED);
  });

  it("expired beats grace when past expiry (rung 3)", () => {
    const row = { ...active, expiresAt: ISO(NOW - 1000), rotationGraceUntil: ISO(NOW + 3600000) };
    expect(lifecycleOf(row, NOW)).toBe(LIFECYCLE.EXPIRED);
  });

  it("grace when successor inside rotation window (rung 4)", () => {
    const row = { ...active, rotationGraceUntil: ISO(NOW + 3600000) };
    expect(lifecycleOf(row, NOW)).toBe(LIFECYCLE.GRACE);
  });

  it("grace expires at the boundary (strict >)", () => {
    const row = { ...active, rotationGraceUntil: ISO(NOW) };
    expect(lifecycleOf(row, NOW)).toBe(LIFECYCLE.ACTIVE);
  });

  it("null/empty input fails open to null", () => {
    expect(lifecycleOf(null, NOW)).toBeNull();
    expect(lifecycleOf("garbage", NOW)).toBeNull();
  });

  it("counts a fleet correctly", () => {
    const counts = lifecycleCounts([
      active,
      { ...active, id: "k2", deletedAt: ISO(NOW) },
      { ...active, id: "k3", isActive: 0, keyHash: null },
    ], NOW);
    expect(counts[LIFECYCLE.ACTIVE]).toBe(1);
    expect(counts[LIFECYCLE.DELETED]).toBe(1);
    expect(counts[LIFECYCLE.REVOKED]).toBe(1);
  });
});
