/**
 * M3 · C6 — the Kiro provider rows, pinned to what the probe MEASURED.
 *
 * The law: rows are added only where the pattern chain resolves something Kiro
 * does not serve (or resolves through data shared with other providers), never
 * as a blanket conversion. scripts/probe-kiro-capabilities.mjs is the measuring
 * instrument; the asserted facts below are its output.
 */
import { describe, it, expect } from "vitest";
import REGISTRY from "open-sse/providers/registry/index.js";
import { PROVIDER_CAPABILITIES, getCapabilitiesForModel } from "open-sse/providers/capabilities.js";

const kiro = REGISTRY.find((e) => e?.id === "kiro");
const stripSuffix = (id) => id.replace(/-(thinking-agentic|thinking|agentic)$/, "");
const isGpt = (id) => /^gpt-5\.6-/.test(stripSuffix(id));

describe("Kiro capability rows", () => {
  it("no non-Anthropic Kiro model advertises web search (no search tool on this lane)", () => {
    for (const id of ["deepseek-3.2", "qwen3-coder-next", "glm-5", "MiniMax-M2.5"]) {
      expect(getCapabilitiesForModel("kr", id).search, id).toBe(false);
    }
  });

  it("keeps the measured windows and text-only posture", () => {
    expect(getCapabilitiesForModel("kr", "deepseek-3.2")).toMatchObject({ vision: false, contextWindow: 128000, maxOutput: 64000 });
    expect(getCapabilitiesForModel("kr", "qwen3-coder-next")).toMatchObject({ vision: false, contextWindow: 1000000 });
    expect(getCapabilitiesForModel("kr", "glm-5")).toMatchObject({ vision: false, contextWindow: 200000, maxOutput: 128000 });
    expect(getCapabilitiesForModel("kr", "MiniMax-M2.5")).toMatchObject({ vision: false, thinkingCanDisable: false, contextWindow: 200000 });
  });

  it("restates the three Claude rows at the Kiro-measured values", () => {
    for (const id of ["claude-opus-4.5", "claude-sonnet-4.5", "claude-haiku-4.5"]) {
      expect(getCapabilitiesForModel("kr", id), id).toMatchObject({
        vision: true, reasoning: true, search: true, thinkingFormat: "claude-budget", contextWindow: 200000, maxOutput: 64000,
      });
    }
  });

  it("does NOT blanket-convert: GPT-5.6 rows keep their 272k window", () => {
    for (const id of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
      expect(getCapabilitiesForModel("kr", id), id).toMatchObject({ contextWindow: 272000, thinkingFormat: "openai", search: true });
    }
  });

  it("the whole roster agrees with the roster facts and the wire's thinking path", () => {
    const fails = [];
    for (const row of kiro.models) {
      const caps = getCapabilitiesForModel("kr", stripSuffix(row.id));
      if (row.contextLength && caps.contextWindow !== row.contextLength) fails.push(`${row.id}:ctx`);
      const textOnly = Array.isArray(row.strip) && row.strip.includes("image");
      if (textOnly && caps.vision) fails.push(`${row.id}:vision`);
      if (isGpt(row.id) && caps.thinkingFormat !== "openai") fails.push(`${row.id}:gptfmt`);
      if (!isGpt(row.id) && caps.thinkingFormat === "openai") fails.push(`${row.id}:non-gpt-openai-fmt`);
    }
    expect(fails).toEqual([]);
  });

  it("resolves identically on the kr alias lane and the kiro id lane (divergence hazard)", () => {
    const rows = Object.keys(PROVIDER_CAPABILITIES.kiro);
    expect(rows.length).toBeGreaterThan(0);
    for (const model of rows) {
      expect(getCapabilitiesForModel("kr", model), model).toEqual(getCapabilitiesForModel("kiro", model));
    }
  });
});
