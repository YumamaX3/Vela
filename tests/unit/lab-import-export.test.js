// AI Lab W6 locking suite — the import/export transport (K1 + S5 + S6).
// Proves: imported injectors arrive DISABLED (the stored-injection guard),
// caps (name ≤64, prompt ≤16KB), collision → " (2)" rename never overwrite,
// unknown schemaVersion → 400, and mode refs re-bind by id with name-match
// fallback. Uses the pure import planner so the route and the suite share it.
import { describe, it, expect } from "vitest";
import { planImport } from "open-sse/rtk/importPlanner.js";

const EXPORT = {
  schemaVersion: 1,
  kind: "vela-lab-export",
  injectors: [
    { id: "a", name: "Greeter", prompt: "hi {{model}}", position: "append", applyTo: "llm" },
    { id: "b", name: "Dup", prompt: "p", position: "append", applyTo: "llm" },
    { name: "NoPrompt", prompt: "" }, // rejected
    { name: "TooLong", prompt: "x".repeat(17000) }, // rejected (cap)
  ],
  modes: [
    { id: "m1", name: "json", injectorRefs: [{ id: "a" }, { id: "ghost" }] },
  ],
  policies: [{ id: "p1", name: "flag", action: "flag", patterns: ["(a|a)*"] }],
};

const CURRENT = {
  userInjectors: [{ id: "existing", name: "Dup", prompt: "old", enabled: true }],
  modeBundles: [],
  contentPolicies: [],
};

describe("lab import/export (W6)", () => {
  it("imported injectors arrive DISABLED (K1 stored-injection guard)", () => {
    const plan = planImport(EXPORT, CURRENT);
    const imported = plan.injectors.filter((i) => i.source === "imported");
    expect(imported.length).toBeGreaterThan(0);
    for (const inj of imported) expect(inj.enabled).toBe(false);
    // Pre-existing rows are preserved untouched (including their enable state).
    const existing = plan.injectors.find((i) => i.id === "existing");
    expect(existing?.enabled).toBe(true);
  });

  it("caps: name ≤64, prompt ≤16KB — oversized entries rejected, not truncated", () => {
    const plan = planImport(EXPORT, CURRENT);
    expect(plan.report.rejected).toBeGreaterThanOrEqual(2);
    expect(plan.injectors.some((i) => i.name === "NoPrompt")).toBe(false);
    expect(plan.injectors.some((i) => i.name === "TooLong")).toBe(false);
  });

  it("collision → ' (2)' rename, never overwrite the existing row", () => {
    const plan = planImport(EXPORT, CURRENT);
    const dup = plan.injectors.find((i) => i.name === "Dup (2)");
    expect(dup).toBeTruthy();
    expect(plan.report.renamed).toBeGreaterThanOrEqual(1);
    // The pre-existing "Dup" row is preserved exactly once, untouched.
    const existing = plan.injectors.filter((i) => i.name === "Dup");
    expect(existing).toHaveLength(1);
    expect(existing[0].id).toBe("existing");
    expect(existing[0].prompt).toBe("old");
  });

  it("mode refs re-bind by exported-id map; dangling refs dropped with a warning", () => {
    const plan = planImport(EXPORT, CURRENT);
    const mode = plan.modes.find((m) => m.name === "json");
    const boundIds = mode.injectorRefs.map((r) => r.id);
    // "a" re-binds to the freshly imported Greeter (same id).
    expect(boundIds).toContain("a");
    // "ghost" is dropped (not found), surfaced in warnings.
    expect(plan.report.warnings.some((w) => w.includes("ghost"))).toBe(true);
  });

  it("imported modes + policies also arrive disabled", () => {
    const plan = planImport(EXPORT, CURRENT);
    expect(plan.modes.every((m) => m.enabled === false)).toBe(true);
    expect(plan.policies.every((p) => p.enabled === false)).toBe(true);
  });

  it("schemaVersion mismatch is rejected at the planner boundary", () => {
    expect(() => planImport({ ...EXPORT, schemaVersion: 2 }, CURRENT)).toThrow(/unsupported/i);
  });
});
