// AI Lab W1 locking suite — "preview is truth" by construction.
// The engine (applyUserInjectors / pipeline band) and the preview renderer
// (expansion.renderInjection) share ONE pure module; this suite proves a
// byte-identical system message for identical inputs across formats, and that
// variable expansion (built-ins + custom) matches the engine exactly.
import { describe, it, expect } from "vitest";
import { applyUserInjectors } from "open-sse/rtk/userInjectors.js";
import { renderInjection, expandInjections, buildVarMap, expandVars } from "open-sse/rtk/expansion.js";
import { injectSystemPrompt } from "open-sse/rtk/systemInject.js";
import { FORMATS } from "open-sse/translator/formats.js";

const INJECTORS = [
  { name: "Greeter", prompt: "Always greet as {{date}} model {{model}}", position: "append", enabled: true },
  { name: "JsonGuard", prompt: "Output JSON only. Custom={{tone}}", position: "prepend", enabled: true, variables: { tone: "formal" } },
];

function engineSystem(body, format, injectors, ctx) {
  applyUserInjectors(body, format, { injectors, ctx });
  const sys = body.system ? body.system
    : body.system_instruction ? body.system_instruction
    : body.messages?.find((m) => m.role === "system")?.content;
  return typeof sys === "string" ? sys : JSON.stringify(sys);
}

/** The preview renderer path — renders via the shared module, then applies via the seam. */
function previewSystem(injectors, format, ctx, baseBody) {
  const body = JSON.parse(JSON.stringify(baseBody));
  const { rendered } = expandInjections(injectors, ctx);
  for (const r of rendered) injectSystemPrompt(body, format, r.text, r.position);
  const sys = body.system ? body.system
    : body.system_instruction ? body.system_instruction
    : body.messages?.find((m) => m.role === "system")?.content;
  return typeof sys === "string" ? sys : JSON.stringify(sys);
}

describe("expansion byte-match (W1)", () => {
  const ctx = { model: "gpt-test", date: "2026-08-27", time: "12:00:00" };

  it("engine and preview render byte-identical system text (OpenAI)", () => {
    const base = { model: "gpt-test", messages: [{ role: "system", content: "base" }, { role: "user", content: "hi" }] };
    expect(engineSystem(JSON.parse(JSON.stringify(base)), FORMATS.OPENAI, INJECTORS, ctx))
      .toBe(previewSystem(INJECTORS, FORMATS.OPENAI, ctx, base));
  });

  it("engine and preview render byte-identical system text (Claude)", () => {
    const base = { model: "claude", system: [{ type: "text", text: "base" }], messages: [{ role: "user", content: "hi" }] };
    expect(engineSystem(JSON.parse(JSON.stringify(base)), FORMATS.CLAUDE, INJECTORS, ctx))
      .toBe(previewSystem(INJECTORS, FORMATS.CLAUDE, ctx, base));
  });

  it("engine and preview render byte-identical system text (Gemini)", () => {
    const base = { system_instruction: { parts: [{ text: "base" }] }, contents: [{ role: "user", parts: [{ text: "hi" }] }] };
    expect(engineSystem(JSON.parse(JSON.stringify(base)), FORMATS.GEMINI, INJECTORS, ctx))
      .toBe(previewSystem(INJECTORS, FORMATS.GEMINI, ctx, base));
  });

  it("variable expansion is identical: built-ins + custom vars", () => {
    const inj = INJECTORS[0];
    const vars = buildVarMap(inj, ctx);
    expect(expandVars("{{date}} {{model}} {{tone}}", vars)).toBe("2026-08-27 gpt-test {{tone}}"); // tone not in map → literal
    const vars2 = buildVarMap(INJECTORS[1], ctx);
    expect(expandVars("{{tone}}", vars2)).toBe("formal");
  });

  it("renderInjection honors the per-key var allowlist for HEADER overrides only (W3 shape)", () => {
    const inj = { name: "X", prompt: "{{secret}}", variables: { secret: "s" } };
    // Declared custom-variable defaults always apply (the allowlist governs
    // header smuggling, never the injector's own variables map).
    expect(renderInjection(inj, ctx, { varAllowlist: [] }).text).toBe("s");
    expect(renderInjection(inj, ctx, { varAllowlist: null }).text).toBe("s");
    expect(renderInjection(inj, ctx, { varAllowlist: ["secret"] }).text).toBe("s");

    // Header overrides: allowed name → applied; denied name → default stands.
    const headers = new Headers();
    headers.set("x-vela-inject-var-secret", "HACKED");
    const rAllowed = renderInjection(inj, { ...ctx, headers }, { varAllowlist: ["secret"] });
    expect(rAllowed.text).toBe("HACKED");
    const rDenied = renderInjection(inj, { ...ctx, headers }, { varAllowlist: [] });
    expect(rDenied.text).toBe("s"); // header dropped → injector default
    const rNull = renderInjection(inj, { ...ctx, headers }, { varAllowlist: null });
    expect(rNull.text).toBe("HACKED"); // NULL = all (today's behavior)
  });

  it("expandInjections counts distinct rendered texts", () => {
    const { appliedDistinct, rendered } = expandInjections(
      [{ name: "A", prompt: "dup" }, { name: "B", prompt: "dup" }],
      ctx
    );
    expect(rendered).toHaveLength(2);
    expect(appliedDistinct).toBe(1);
  });
});
