/**
 * M3 · C1 + C2 — the Kiro enum map, the union roster, and the alias table.
 *
 * What this pins (the sealed plan's laws):
 *   • NO ENUM EXTRAPOLATION — KIRO_WIRE_ENUM holds exactly the six
 *     caidaoli-evidenced ids + `auto`, nothing derived from a family pattern.
 *   • UNKNOWN IDS PASS THROUGH VERBATIM — an id with no row ships as it came.
 *   • MAPPING BEFORE SUFFIX STRIP — `claude-3-5-sonnet-thinking` is "thinking
 *     on claude-sonnet-5", not a verbatim miss of the suffixed spelling.
 *   • THE UNION — 44 pre-existing roster ids + the three C2 additions.
 */
import { describe, it, expect } from "vitest";
import REGISTRY from "open-sse/providers/registry/index.js";
import {
  KIRO_ALIASES,
  KIRO_UNION_ADDITIONS,
  KIRO_WIRE_ENUM,
  normalizeKiroVersion,
  resolveKiroWireModel,
  splitKiroVariantSuffix,
} from "open-sse/providers/registry/kiroModelAliases.js";
import { resolveKiroModel, resolveKiroModelIntent } from "open-sse/config/kiroConstants.js";

const kiro = REGISTRY.find((e) => e?.id === "kiro");
const rosterIds = kiro.models.map((m) => m.id);

describe("Kiro wire enum (C1)", () => {
  it("holds exactly the six evidenced ids plus auto — no extrapolation", () => {
    expect(Object.keys(KIRO_WIRE_ENUM).sort()).toEqual([
      "auto",
      "claude-haiku-4.5",
      "claude-haiku-5.5",
      "claude-opus-4.5",
      "claude-opus-5",
      "claude-sonnet-4.5",
      "claude-sonnet-5",
    ].sort());
  });

  it("maps each evidenced id to its CLAUDE_*_V1_0 enum, and auto to auto", () => {
    expect(KIRO_WIRE_ENUM["claude-opus-4.5"]).toBe("CLAUDE_OPUS_4_5_V1_0");
    expect(KIRO_WIRE_ENUM["claude-sonnet-4.5"]).toBe("CLAUDE_SONNET_4_5_V1_0");
    expect(KIRO_WIRE_ENUM["claude-haiku-4.5"]).toBe("CLAUDE_HAIKU_4_5_V1_0");
    expect(KIRO_WIRE_ENUM["claude-opus-5"]).toBe("CLAUDE_OPUS_5_V1_0");
    expect(KIRO_WIRE_ENUM["claude-sonnet-5"]).toBe("CLAUDE_SONNET_5_V1_0");
    expect(KIRO_WIRE_ENUM["claude-haiku-5.5"]).toBe("CLAUDE_HAIKU_5_5_V1_0");
    expect(KIRO_WIRE_ENUM.auto).toBe("auto");
  });

  it("never invents an enum for a family that merely LOOKS like the pattern", () => {
    // The caidaoli outliers that prove the danger: 3.7 and 4.0-style ids are
    // NOT extrapolated to CLAUDE_*_V1_0 even though opus/sonnet-5 are mapped.
    for (const id of [
      "claude-3-7-sonnet-20250219",
      "claude-sonnet-4-20250514",
      "claude-3-5-haiku-20241022",
      "claude-opus-4.0",
      "claude-sonnet-4.6",
      "gpt-5.6-sol",
      "deepseek-3.2",
      "glm-5",
      "MiniMax-M2.5",
      "qwen3-coder-next",
    ]) {
      expect(resolveKiroWireModel(id), id).toMatchObject({ wire: id, enumMapped: false });
    }
  });

  it("passes a completely unknown id through verbatim", () => {
    expect(resolveKiroWireModel("some-future-model-9.9")).toEqual({
      wire: "some-future-model-9.9",
      base: "some-future-model-9.9",
      thinking: false,
      agentic: false,
      aliased: false,
      enumMapped: false,
    });
  });
});

describe("Kiro variant suffixes (synthetic)", () => {
  it("splits every suffix combination", () => {
    expect(splitKiroVariantSuffix("m")).toEqual({ base: "m", thinking: false, agentic: false });
    expect(splitKiroVariantSuffix("m-thinking")).toEqual({ base: "m", thinking: true, agentic: false });
    expect(splitKiroVariantSuffix("m-agentic")).toEqual({ base: "m", thinking: false, agentic: true });
    expect(splitKiroVariantSuffix("m-thinking-agentic")).toEqual({ base: "m", thinking: true, agentic: true });
  });

  it("keeps the flags on a mapped id while the wire id is the enum", () => {
    expect(resolveKiroWireModel("claude-sonnet-4.5-thinking-agentic")).toMatchObject({
      wire: "CLAUDE_SONNET_4_5_V1_0",
      base: "claude-sonnet-4.5",
      thinking: true,
      agentic: true,
      enumMapped: true,
      aliased: false,
    });
  });
});

describe("Kiro alias table (C2)", () => {
  it("carries the tanu360 name pairs the plan names", () => {
    expect(KIRO_ALIASES["claude-3-5-sonnet"]).toBe("claude-sonnet-5");
    expect(KIRO_ALIASES["gpt-5"]).toBe("claude-opus-5");
  });

  it("applies the alias BEFORE the suffix strip", () => {
    expect(resolveKiroWireModel("claude-3-5-sonnet-thinking")).toMatchObject({
      wire: "CLAUDE_SONNET_5_V1_0",
      base: "claude-sonnet-5",
      thinking: true,
      agentic: false,
      aliased: true,
    });
    expect(resolveKiroWireModel("gpt-5")).toMatchObject({ wire: "CLAUDE_OPUS_5_V1_0", base: "claude-opus-5", aliased: true });
  });

  it("normalizes dash/dot versions on the LOOKUP key only", () => {
    expect(normalizeKiroVersion("claude-sonnet-4-5")).toBe("claude-sonnet-4.5");
    expect(normalizeKiroVersion("claude-3-5-sonnet-20241022")).toBe("claude-3.5-sonnet-20241022");
    expect(normalizeKiroVersion("gpt-5.6-sol")).toBe("gpt-5.6-sol");
    // The dotted spelling resolves via the version regex; the shipped id is the enum.
    expect(resolveKiroWireModel("claude-sonnet-4-5")).toMatchObject({ wire: "CLAUDE_SONNET_4_5_V1_0" });
  });

  it("only maps onto ids the roster already serves (or an evidenced enum)", () => {
    for (const [from, to] of Object.entries(KIRO_ALIASES)) {
      const { base } = splitKiroVariantSuffix(to);
      expect(rosterIds.some((id) => splitKiroVariantSuffix(id).base === base), `${from} → ${to}`).toBe(true);
    }
  });
});

describe("Kiro union roster (C2)", () => {
  it("holds the 44 pre-existing ids plus the three C2 additions (x4 synthetic variants)", () => {
    // 44 originals + 3 union additions x 4 variants = 56.
    expect(rosterIds.length).toBe(56);
    for (const add of KIRO_UNION_ADDITIONS) {
      for (const variant of ["", "-thinking", "-agentic", "-thinking-agentic"]) {
        expect(rosterIds).toContain(`${add}${variant}`);
      }
    }
  });

  it("sends each union id upstream as `auto` (no enum evidence for a dated id)", () => {
    const models = new Map(kiro.models.map((m) => [m.id, m]));
    for (const add of KIRO_UNION_ADDITIONS) {
      expect(models.get(add).upstreamModelId).toBe("auto");
      expect(models.get(`${add}-thinking-agentic`).upstreamModelId).toBe("auto");
    }
  });

  it("keeps every original id's upstreamModelId exactly as it was", () => {
    const models = new Map(kiro.models.map((m) => [m.id, m]));
    expect(models.get("gpt-5.6-sol-thinking").upstreamModelId).toBe("gpt-5.6-sol");
    expect(models.get("claude-sonnet-5-agentic").upstreamModelId).toBeUndefined();
    expect(models.get("MiniMax-M2.5").upstreamModelId).toBeUndefined();
  });

  it("exposes the alias table on the registry entry", () => {
    expect(kiro.modelAliases).toBe(KIRO_ALIASES);
  });
});

describe("resolveKiroModelIntent follows the same law", () => {
  it("agrees with resolveKiroWireModel on the wire id and the flags", () => {
    for (const id of rosterIds.concat(Object.keys(KIRO_ALIASES), ["claude-3-5-sonnet-thinking", "auto", "unknown-model"])) {
      const wire = resolveKiroWireModel(id);
      const intent = resolveKiroModelIntent(id);
      // The ENUM rides in `wireModel`; the translator's modelId (`upstream`)
      // stays the public id — the only shape the generate surface has proven.
      expect(intent.wireModel, id).toBe(wire.wire);
      expect(intent.thinking, id).toBe(wire.thinking);
      expect(intent.agentic, id).toBe(wire.agentic);
    }
  });

  it("keeps the legacy suffix contract for unmapped ids (verbatim, flags set)", () => {
    const { upstream, agentic, thinking } = resolveKiroModel("glm-5-thinking-agentic");
    expect({ upstream, agentic, thinking }).toEqual({ upstream: "glm-5", agentic: true, thinking: true });
    expect(resolveKiroModelIntent("glm-5-thinking-agentic")).toMatchObject({
      upstream: "glm-5",
      agentic: true,
      thinking: true,
    });
  });

  it("consumes the (level) override without touching the wire id", () => {
    expect(resolveKiroModelIntent("claude-sonnet-4.5-thinking(high)")).toMatchObject({
      upstream: "claude-sonnet-4.5",
      wireModel: "CLAUDE_SONNET_4_5_V1_0",
      thinking: true,
      thinkingOverride: { mode: "level", level: "high" },
    });
  });
});
