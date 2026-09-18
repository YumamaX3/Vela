// Provider icon source — the URL contract.
//
// Why this test exists: `getProviderIconSrc` used to branch on
// `id === "zai-search" ? "svg" : "png"` — a special case for a provider whose
// file had been folded into glm.js (upstream 9dbdca0e) and which no caller ever
// passed. The branch was unreachable, but removing it is only safe if the
// `.png` default is genuinely universal: `public/providers/kimchi.svg` exists
// alongside `kimchi.png`, so a careless collapse would have silently swapped
// that provider's icon. These tests pin the shape so the next person can delete
// or extend it with evidence instead of hope.
import { describe, it, expect } from "vitest";
import {
  getProviderIconSrc,
  resolveProviderIconId,
  markProviderIconMissing,
} from "@/shared/utils/providerIcon.js";

describe("getProviderIconSrc — the URL contract", () => {
  it("returns a /providers/{id}.png path for a plain id", () => {
    expect(getProviderIconSrc("anthropic")).toBe("/providers/anthropic.png");
  });

  it("normalizes case and surrounding whitespace", () => {
    expect(getProviderIconSrc("  Anthropic  ")).toBe("/providers/anthropic.png");
  });

  it("applies the brand aliases", () => {
    expect(getProviderIconSrc("perplexity-agent")).toBe("/providers/perplexity.png");
    expect(getProviderIconSrc("gitlab-duo")).toBe("/providers/gitlab.png");
    expect(getProviderIconSrc("vercel-ai-gateway")).toBe("/providers/vercel.png");
  });

  it("returns null for empty or non-string input", () => {
    expect(getProviderIconSrc("")).toBeNull();
    expect(getProviderIconSrc("   ")).toBeNull();
    expect(getProviderIconSrc(null)).toBeNull();
    expect(getProviderIconSrc(undefined)).toBeNull();
    expect(getProviderIconSrc(42)).toBeNull();
  });

  it("never emits .svg — the zai-search special case is gone", () => {
    // Regression pin: the removed branch was the only source of `.svg`, and no
    // caller passes "zai-search" (the provider folded into glm.js).
    for (const id of ["anthropic", "kimchi", "zai-search", "glm", "perplexity"]) {
      expect(getProviderIconSrc(id)).not.toContain(".svg");
    }
  });

  it("resolves kimchi to .png even though kimchi.svg ships beside it", () => {
    // The behavior-preserving assertion: before the branch removal kimchi
    // already resolved to .png, because only "zai-search" took the svg path.
    expect(getProviderIconSrc("kimchi")).toBe("/providers/kimchi.png");
  });

  it("returns null after a 404 is recorded for the session", () => {
    const id = "probe-missing-provider";
    expect(getProviderIconSrc(id)).toBe(`/providers/${id}.png`);
    markProviderIconMissing(id);
    expect(getProviderIconSrc(id)).toBeNull();
    expect(resolveProviderIconId(id)).toBe("");
  });

  it("records the alias target when an aliased id 404s", () => {
    markProviderIconMissing("perplexity-agent");
    // Both the raw id and its alias are now remembered as missing.
    expect(getProviderIconSrc("perplexity-agent")).toBeNull();
    expect(getProviderIconSrc("perplexity")).toBeNull();
  });
});
