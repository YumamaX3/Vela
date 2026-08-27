// AI Lab W2 locking suite — mode resolution + keyGate modeStage.
// Proves the S1 invariant: precedence header > key default > none; read-only,
// zero settings mutation; and the cheap pre-dispatch 403 gate.
import { describe, it, expect } from "vitest";
import { resolveMode, expandModeRefs, normalizeInjector } from "open-sse/rtk/expansion.js";
import { modeStage } from "@/sse/services/keyGate.js";

const MODES = [
  { id: "m1", name: "json-only", injectorRefs: [{ id: "i1" }, { id: "i2" }], saverToggles: {}, enabled: true },
  { id: "m2", name: "id-first", injectorRefs: [{ id: "i3", modelGlob: "grok-web" }], enabled: true },
  { id: "m3", name: "disabled-mode", injectorRefs: [], enabled: false },
];

describe("resolveMode — S1 precedence header > key-default > none", () => {
  it("header mode wins when present and known", () => {
    const out = resolveMode(MODES, { headerMode: "json-only", keyDefaultMode: "id-first" });
    expect(out.mode?.id).toBe("m1");
    expect(out.resolved).toBe("json-only");
  });

  it("key default applies when no header", () => {
    const out = resolveMode(MODES, { headerMode: null, keyDefaultMode: "id-first" });
    expect(out.mode?.id).toBe("m2");
    expect(out.resolved).toBe("id-first");
  });

  it("no mode when neither header nor default", () => {
    const out = resolveMode(MODES, { headerMode: null, keyDefaultMode: null });
    expect(out.mode).toBeNull();
    expect(out.resolved).toBeNull();
  });

  it("unknown mode is reported, never silently applied", () => {
    const out = resolveMode(MODES, { headerMode: "does-not-exist" });
    expect(out.mode).toBeNull();
    expect(out.unknown).toBe("does-not-exist");
  });

  it("disabled mode reports unknown (won't apply)", () => {
    const out = resolveMode(MODES, { headerMode: "disabled-mode" });
    expect(out.mode).toBeNull();
    expect(out.unknown).toBe("disabled-mode");
  });

  it("read-only: resolution never mutates the modeBundles input", () => {
    const before = JSON.stringify(MODES);
    resolveMode(MODES, { headerMode: "json-only" });
    expect(JSON.stringify(MODES)).toBe(before);
  });
});

describe("expandModeRefs — target-scoped + dangling-ref safety", () => {
  const injectors = [
    normalizeInjector({ id: "i1", name: "a", prompt: "p" }),
    normalizeInjector({ id: "i2", name: "b", prompt: "p" }),
    normalizeInjector({ id: "i3", name: "c", prompt: "p" }),
  ].filter(Boolean);

  it("expands refs in order into concrete injectors", () => {
    const { injectors: out, skips } = expandModeRefs(MODES[0], injectors);
    expect(out.map((x) => x.id)).toEqual(["i1", "i2"]);
    expect(skips).toHaveLength(0);
  });

  it("model-glob ref only applies on a matching model (target-scoped)", () => {
    const { injectors: match } = expandModeRefs(MODES[1], injectors, { model: "grok-web" });
    expect(match.map((x) => x.id)).toEqual(["i3"]);
    const { injectors: noMatch, skips } = expandModeRefs(MODES[1], injectors, { model: "gpt-x" });
    expect(noMatch).toHaveLength(0);
    expect(skips.some((s) => s.reason === "model-glob")).toBe(true);
  });

  it("dangling ref is a logged skip, never a broken expansion", () => {
    const mode = { id: "d", name: "dangling", injectorRefs: [{ id: "missing" }, { id: "i1" }], enabled: true };
    const { injectors: out, skips } = expandModeRefs(mode, injectors);
    expect(out.map((x) => x.id)).toEqual(["i1"]);
    expect(skips.some((s) => s.reason === "missing-injector")).toBe(true);
  });
});

describe("modeStage — keyGate cheap pre-dispatch gate (S2/S3)", () => {
  it("no mode requested → pass", () => {
    expect(modeStage({ allowedModes: null }).ok).toBe(true);
    expect(modeStage({ allowedModes: ["json-only"] }, {}).ok).toBe(true);
  });

  it("NULL allowedModes = unrestricted (pass)", () => {
    const v = modeStage({ allowedModes: null }, { modeName: "anything" });
    expect(v.ok).toBe(true);
  });

  it("[] = deny all → 403 mode_not_allowed", () => {
    const v = modeStage({ allowedModes: [] }, { modeName: "json-only" });
    expect(v.ok).toBe(false);
    expect(v.code).toBe("mode_not_allowed");
    expect(v.status).toBe(403);
  });

  it("whitelist: in-list passes, out-of-list 403", () => {
    expect(modeStage({ allowedModes: ["json-only"] }, { modeName: "json-only" }).ok).toBe(true);
    const v = modeStage({ allowedModes: ["json-only"] }, { modeName: "id-first" });
    expect(v.ok).toBe(false);
    expect(v.code).toBe("mode_not_allowed");
  });
});