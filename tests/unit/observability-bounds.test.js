// AI Lab W3 locking suite — bounded observability (S7).
// Caps: ≤5 distinct names, ≤24 chars each, header ≤ ~130 bytes; mode/policy
// tags ride alongside; never prompt content or excerpts.
import { describe, it, expect } from "vitest";
import { summarizeApplied, buildAppliedHeader, truncateName } from "open-sse/rtk/boundedSummary.js";

describe("bounded observability (W3/S7)", () => {
  it("caps at 5 distinct names", () => {
    const names = ["a", "b", "c", "d", "e", "f", "g"];
    expect(summarizeApplied(names)).toBe("a,b,c,d,e");
  });

  it("dedupes and skips empties", () => {
    expect(summarizeApplied(["x", "x", "", "y"])).toBe("x,y");
  });

  it("truncates each name to 24 chars", () => {
    const long = "x".repeat(40);
    const out = summarizeApplied([long]);
    expect(out.length).toBe(24);
  });

  it("UTF-8-aware: never splits a multi-byte code point", () => {
    const s = "🪞".repeat(30); // 30 emoji, 120 bytes — must truncate to 24 code points
    const t = truncateName(s, 24);
    // 24 CODE POINTS = exactly 24 complete emoji; no partial code point ever.
    expect([...t].length).toBe(24);
    expect(t).toBe("🪞".repeat(24));
  });

  it("header builds with mode + policy tags, bounded total", () => {
    const h = buildAppliedHeader({
      names: ["One", "Two", "Three", "Four", "Five", "Six"],
      mode: "json-only",
      policyVerdict: "flag",
    });
    expect(h).toContain("mode:json-only");
    expect(h).toContain("policy:flag");
    expect(h.split(" ")[0]).toBe("One,Two,Three,Four,Five"); // names capped, no Six
    expect(Buffer.byteLength(h, "utf8")).toBeLessThan(130);
  });

  it("empty input → empty header", () => {
    expect(buildAppliedHeader({})).toBe("");
    expect(buildAppliedHeader({ names: [] })).toBe("");
  });
});
