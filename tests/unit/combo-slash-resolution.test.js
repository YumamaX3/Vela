// Slash-bearing combo names — the v0.9.39 decree proved at both gates.
//
// Part 1: getComboModels now looks up EVERY shape (the old includes("/")
// early-return is gone), so "vela/cc/opus" resolves as a combo while a
// genuine "provider/model" with no matching combo falls through untouched.
// Part 2: the keyGate stages treat a resolved combo by its FULL slash-bearing
// name — providerStage never reads the combo's own slashes as a provider
// prefix, and comboStage enforces allowedCombos against the full name.
import { describe, it, expect, vi } from "vitest";

// ── Part 1: resolution ────────────────────────────────────────────────
const combos = new Map();

vi.mock("@/lib/localDb", () => ({
  getComboByName: vi.fn(async (name) => combos.get(name) || null),
  getModelAliases: vi.fn(async () => ({})),
  getProviderNodes: vi.fn(async () => []),
}));

const { getComboModels } = await import("@/sse/services/model.js");

describe("getComboModels — slash-bearing names resolve", () => {
  it("resolves a namespaced combo name", async () => {
    combos.set("vela/cc/opus", { name: "vela/cc/opus", models: ["anthropic/claude-opus-4", "openai/gpt-5"] });
    const models = await getComboModels("vela/cc/opus");
    expect(models).toEqual(["anthropic/claude-opus-4", "openai/gpt-5"]);
  });

  it("resolves a deep namespaced combo name", async () => {
    combos.set("vela/deepseek/deepseek-v4-flash", { name: "vela/deepseek/deepseek-v4-flash", models: ["deepseek/deepseek-v4-flash"] });
    const models = await getComboModels("vela/deepseek/deepseek-v4-flash");
    expect(models).toEqual(["deepseek/deepseek-v4-flash"]);
  });

  it("still resolves plain combo names", async () => {
    combos.set("daily-driver", { name: "daily-driver", models: ["anthropic/claude-sonnet-4"] });
    const models = await getComboModels("daily-driver");
    expect(models).toEqual(["anthropic/claude-sonnet-4"]);
  });

  it("lets genuine provider/model pairs fall through when no combo matches", async () => {
    expect(await getComboModels("anthropic/claude-sonnet-5")).toBeNull();
    expect(await getComboModels("openai/gpt-5")).toBeNull();
  });

  it("rejects empty input", async () => {
    expect(await getComboModels("")).toBeNull();
    expect(await getComboModels(null)).toBeNull();
    expect(await getComboModels(undefined)).toBeNull();
  });

  it("ignores combos with an empty model list", async () => {
    combos.set("vela/empty", { name: "vela/empty", models: [] });
    expect(await getComboModels("vela/empty")).toBeNull();
  });
});

// ── Part 2: the gate stages ───────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  resolveKey: vi.fn(),
  getApiKeyById: vi.fn(),
  getAdapter: vi.fn(),
}));

vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({
  resolveKey: mocks.resolveKey,
  getApiKeyById: mocks.getApiKeyById,
}));
vi.mock("@/lib/db/driver.js", () => ({
  getAdapter: mocks.getAdapter,
}));

const { providerStage, comboStage } = await import("@/sse/services/keyGate.js");

const keyWith = (patch) => ({
  allowedKinds: null,
  allowedProviders: null,
  allowedCombos: null,
  allowedModels: null,
  ...patch,
});

describe("providerStage — a combo's slashes are never a provider prefix", () => {
  it("skips when a combo resolved (comboModels present)", () => {
    const key = keyWith({ allowedProviders: ["anthropic"] });
    const verdict = providerStage(key, {
      requestModel: "vela/cc/opus",
      comboModels: ["anthropic/claude-opus-4"],
    });
    expect(verdict.ok).toBe(true);
  });

  it("still enforces allowedProviders on plain provider/model requests", () => {
    const key = keyWith({ allowedProviders: ["anthropic"] });
    expect(providerStage(key, { requestModel: "openai/gpt-5" }).ok).toBe(false);
    expect(providerStage(key, { requestModel: "anthropic/claude-sonnet-4" }).ok).toBe(true);
  });

  it("skips when allowedProviders is unrestricted (null)", () => {
    const key = keyWith();
    expect(providerStage(key, { requestModel: "vela/cc/opus" }).ok).toBe(true);
  });
});

describe("comboStage — the full slash-bearing name is the ACL identity", () => {
  it("allows a resolved combo that rides the allowlist", () => {
    const key = keyWith({ allowedCombos: ["vela/cc/opus", "daily-driver"] });
    const verdict = comboStage(key, {
      requestModel: "vela/cc/opus",
      comboModels: ["anthropic/claude-opus-4"],
    });
    expect(verdict.ok).toBe(true);
  });

  it("denies a resolved combo outside the allowlist", () => {
    const key = keyWith({ allowedCombos: ["other-combo"] });
    const verdict = comboStage(key, {
      requestModel: "vela/cc/opus",
      comboModels: ["anthropic/claude-opus-4"],
    });
    expect(verdict.ok).toBe(false);
  });

  it("denies ALL combos for an empty allowlist", () => {
    const key = keyWith({ allowedCombos: [] });
    const verdict = comboStage(key, {
      requestModel: "vela/cc/opus",
      comboModels: ["anthropic/claude-opus-4"],
    });
    expect(verdict.ok).toBe(false);
  });

  it("still honors the legacy combo/ addressing form", () => {
    const key = keyWith({ allowedCombos: ["daily-driver"] });
    expect(comboStage(key, { requestModel: "combo/daily-driver" }).ok).toBe(true);
    expect(comboStage(key, { requestModel: "combo/other" }).ok).toBe(false);
  });

  it("passes non-combo requests untouched", () => {
    const key = keyWith({ allowedCombos: ["vela/cc/opus"] });
    expect(comboStage(key, { requestModel: "openai/gpt-5" }).ok).toBe(true);
    expect(comboStage(key, { requestModel: null }).ok).toBe(true);
  });

  it("skips when allowedCombos is unrestricted (null)", () => {
    const key = keyWith();
    expect(
      comboStage(key, { requestModel: "vela/cc/opus", comboModels: ["anthropic/claude-opus-4"] }).ok
    ).toBe(true);
  });
});
