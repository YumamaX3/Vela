// AI Lab W3 locking suite — ACL at the hook (S3).
// The DECISIVE filter runs inside the pipeline's injector stage, fed by the
// resolved key's allowlist. No UI-only path exists. Also locks the inject-var
// allowlist governance (K2) and the keyless-mode decision (K3).
import { describe, it, expect } from "vitest";
import { runInjectorBand } from "open-sse/rtk/pipeline.js";
import { triStateAllowed } from "open-sse/rtk/expansion.js";
import { FORMATS } from "open-sse/translator/formats.js";

const INJECTORS = [
  { id: "i1", name: "Allowed", prompt: "yes", enabled: true },
  { id: "i2", name: "Denied", prompt: "no", enabled: true },
];

function sysText(body) {
  return body.messages.find((m) => m.role === "system")?.content || "";
}

describe("ACL at the hook (W3)", () => {
  it("NULL allowedInjectors = all pass (back-compat)", () => {
    const body = { messages: [{ role: "system", content: "base" }] };
    const { applied, names, denials } = runInjectorBand(body, FORMATS.OPENAI, {
      injectors: INJECTORS,
      acl: { allowedInjectors: null },
    });
    expect(applied).toBe(2);
    expect(names).toEqual(["Allowed", "Denied"]);
    expect(denials).toHaveLength(0);
  });

  it("[] = deny all → zero applied, all denied", () => {
    const body = { messages: [{ role: "system", content: "base" }] };
    const { applied, names, denials } = runInjectorBand(body, FORMATS.OPENAI, {
      injectors: INJECTORS,
      acl: { allowedInjectors: [] },
    });
    expect(applied).toBe(0);
    expect(names).toEqual([]);
    expect(denials).toHaveLength(2);
    expect(denials[0].reason).toBe("acl-denied");
  });

  it("whitelist: allowed id applies, denied id is a bounded skip (no request failure)", () => {
    const body = { messages: [{ role: "system", content: "base" }] };
    const { applied, names, denials } = runInjectorBand(body, FORMATS.OPENAI, {
      injectors: INJECTORS,
      acl: { allowedInjectors: ["i1"] },
    });
    expect(applied).toBe(1);
    expect(names).toEqual(["Allowed"]);
    expect(denials.map((d) => d.name)).toEqual(["Denied"]);
    expect(sysText(body)).toContain("yes");
    expect(sysText(body)).not.toContain("no");
  });

  it("triStateAllowed semantics are shared (null=all, []=deny, [x]=whitelist, malformed=fail-open)", () => {
    expect(triStateAllowed(null, "x")).toBe(true);
    expect(triStateAllowed([], "x")).toBe(false);
    expect(triStateAllowed(["x"], "x")).toBe(true);
    expect(triStateAllowed(["x"], "y")).toBe(false);
    expect(triStateAllowed("not-an-array", "x")).toBe(true); // malformed → fail-open
  });

  it("ACL applies to mode-bundle injectors too (the seam refuses, not the dashboard)", () => {
    const body = { messages: [{ role: "system", content: "base" }] };
    const { applied, denials } = runInjectorBand(body, FORMATS.OPENAI, {
      modeInjectors: [{ id: "m1", name: "ModeInj", prompt: "mode-yes", enabled: true }],
      acl: { allowedInjectors: [] },
    });
    expect(applied).toBe(0);
    expect(denials.some((d) => d.name === "ModeInj")).toBe(true);
  });

  it("inject-var allowlist: header override honored only when allowed (K2)", () => {
    const body = { messages: [{ role: "system", content: "base" }] };
    const headers = new Headers();
    headers.set("x-vela-inject-var-tone", "HACKED");
    const { applied } = runInjectorBand(body, FORMATS.OPENAI, {
      injectors: [{ id: "i1", name: "Var", prompt: "tone={{tone}}", enabled: true, variables: { tone: "formal" } }],
      ctx: { headers },
      varAllowlist: [], // deny all header overrides
      acl: { allowedInjectors: null },
    });
    expect(applied).toBe(1);
    expect(sysText(body)).toContain("tone=formal"); // header dropped, default stands
  });
});
