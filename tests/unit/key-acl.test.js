/**
 * Per-key ACL Test Suite — v0.9.17
 *
 * Proves the tri-state access-control layers (kinds / providers / combos /
 * models) added to keyGate.js. Ported from VansRouter §1 semantics, seam-native.
 *
 *   A1. triStateAllowed — null = all, [] = none, ["x"] = whitelist
 *   A2. kindStage — blocks out-of-kind requests, passes in-kind
 *   A3. providerStage — blocks out-of-provider, passes in-provider + alias form
 *   A4. comboStage — blocks out-of-combo, passes in-combo, ignores non-combos
 *   A5. modelScopeStage — combo requests gate on ALL members
 *   A6. filterModelsByScope — full ACL narrowing for /v1/models
 *   A7. STAGES integration — the gate pipeline enforces ACL stages
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// The A7 pipeline tests mock the apiKeysRepo.resolveKey lookup via the proven
// vi.hoisted pattern (see apikey-gate-acl.test.js). The stage-unit suites
// (A1–A6) import the REAL keyGate — only the pipeline suite mocks the repo.
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

const {
  triStateAllowed,
  kindStage,
  providerStage,
  comboStage,
  modelScopeStage,
  filterModelsByScope,
  authorizeApiRequest,
  GATE_CODES,
} = await import("@/sse/services/keyGate.js");
import { HTTP_STATUS } from "../../open-sse/config/runtimeConfig.js";

// The stage-unit suites (A1–A6) use ResolvedKey-shaped objects directly.
function makeKey(overrides = {}) {
  return {
    keyId: "k1",
    keyPrefix: "vela-test",
    name: "test",
    allowedModels: null,
    allowedKinds: null,
    allowedProviders: null,
    allowedCombos: null,
    isInternal: false,
    expiresAt: null,
    rateLimitRpm: null,
    tokenBudgetDaily: null,
    spendCapDailyCents: null,
    budgetScope: null,
    ipAllowlist: null,
    ...overrides,
  };
}

describe("A1: triStateAllowed tri-state semantics", () => {
  it("null → all allowed (unrestricted)", () => {
    expect(triStateAllowed(null, "llm")).toBe(true);
    expect(triStateAllowed(undefined, "anything")).toBe(true);
  });

  it("[] → none allowed (deny everything)", () => {
    expect(triStateAllowed([], "llm")).toBe(false);
    expect(triStateAllowed([], "anything")).toBe(false);
  });

  it('["x","y"] → whitelist', () => {
    expect(triStateAllowed(["llm", "tts"], "llm")).toBe(true);
    expect(triStateAllowed(["llm", "tts"], "stt")).toBe(false);
  });

  it("malformed (non-array) → fail-open", () => {
    expect(triStateAllowed("llm", "llm")).toBe(true);
    expect(triStateAllowed(42, "llm")).toBe(true);
  });
});

describe("A2: kindStage", () => {
  it("passes when allowedKinds is null (unrestricted)", () => {
    const key = makeKey();
    expect(kindStage(key, { kind: "llm" }).ok).toBe(true);
  });

  it("blocks when the resolved kind is not allowed", () => {
    const key = makeKey({ allowedKinds: ["llm"] });
    const verdict = kindStage(key, { kind: "tts" });
    expect(verdict.ok).toBe(false);
    expect(verdict.status).toBe(HTTP_STATUS.FORBIDDEN);
  });

  it("passes when the resolved kind is allowed", () => {
    const key = makeKey({ allowedKinds: ["llm"] });
    expect(kindStage(key, { kind: "llm" }).ok).toBe(true);
  });

  it("[] kinds denies everything", () => {
    const key = makeKey({ allowedKinds: [] });
    expect(kindStage(key, { kind: "llm" }).ok).toBe(false);
  });

  it("no explicit kind → defaults to llm", () => {
    const key = makeKey({ allowedKinds: ["llm"] });
    expect(kindStage(key, {}).ok).toBe(true);
    expect(kindStage(key, { kind: "tts" }).ok).toBe(false);
  });
});

describe("A3: providerStage", () => {
  it("passes when allowedProviders is null", () => {
    const key = makeKey();
    expect(providerStage(key, { requestModel: "openai/gpt-4" }).ok).toBe(true);
  });

  it("blocks when the provider is not allowed", () => {
    const key = makeKey({ allowedProviders: ["anthropic"] });
    const verdict = providerStage(key, { requestModel: "openai/gpt-4" });
    expect(verdict.ok).toBe(false);
  });

  it("passes when the provider is allowed", () => {
    const key = makeKey({ allowedProviders: ["openai"] });
    expect(providerStage(key, { requestModel: "openai/gpt-4" }).ok).toBe(true);
  });

  it("[] providers denies everything", () => {
    const key = makeKey({ allowedProviders: [] });
    expect(providerStage(key, { requestModel: "openai/gpt-4" }).ok).toBe(false);
  });

  it("non-provider/model requests pass (no provider to scope)", () => {
    const key = makeKey({ allowedProviders: ["openai"] });
    expect(providerStage(key, { requestModel: "combo/flagship" }).ok).toBe(true);
  });
});

describe("A4: comboStage", () => {
  it("passes when allowedCombos is null", () => {
    const key = makeKey();
    expect(comboStage(key, { requestModel: "combo/flagship" }).ok).toBe(true);
  });

  it("blocks a combo outside the allowlist", () => {
    const key = makeKey({ allowedCombos: ["flagship"] });
    const verdict = comboStage(key, { requestModel: "combo/other" });
    expect(verdict.ok).toBe(false);
  });

  it("passes a combo inside the allowlist", () => {
    const key = makeKey({ allowedCombos: ["flagship"] });
    expect(comboStage(key, { requestModel: "combo/flagship" }).ok).toBe(true);
  });

  it("ignores non-combo requests", () => {
    const key = makeKey({ allowedCombos: ["flagship"] });
    expect(comboStage(key, { requestModel: "openai/gpt-4" }).ok).toBe(true);
  });
});

describe("A5: modelScopeStage combo gating", () => {
  it("allows a combo only when ALL members are in scope", () => {
    const key = makeKey({ allowedModels: ["openai/gpt-4"] });
    const ok = modelScopeStage(key, {
      requestModel: "combo/flagship",
      comboModels: ["openai/gpt-4"],
    });
    expect(ok.ok).toBe(true);

    const blocked = modelScopeStage(key, {
      requestModel: "combo/flagship",
      comboModels: ["openai/gpt-4", "anthropic/claude"],
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.status).toBe(HTTP_STATUS.FORBIDDEN);
  });

  it("blocks a single model outside scope", () => {
    const key = makeKey({ allowedModels: ["openai/gpt-4"] });
    const verdict = modelScopeStage(key, { requestModel: "anthropic/claude" });
    expect(verdict.ok).toBe(false);
  });
});

describe("A6: filterModelsByScope full ACL narrowing", () => {
  const models = [
    { id: "openai/gpt-4", kind: "llm" },
    { id: "anthropic/claude", kind: "llm" },
    { id: "combo/flagship", kind: "llm" },
    { id: "combo/other", kind: "llm" },
    { id: "tts/edge-tts", kind: "tts" },
  ];

  it("returns all models for an unrestricted key", () => {
    expect(filterModelsByScope(models, makeKey()).length).toBe(5);
  });

  it("filters by providers (combos stay visible — separate dimension)", () => {
    const key = makeKey({ allowedProviders: ["openai"] });
    const out = filterModelsByScope(models, key);
    expect(out.map((m) => m.id)).toEqual(["openai/gpt-4", "combo/flagship", "combo/other"]);
  });

  it("filters by kinds", () => {
    const key = makeKey({ allowedKinds: ["tts"] });
    const out = filterModelsByScope(models, key);
    expect(out.map((m) => m.id)).toEqual(["tts/edge-tts"]);
  });

  it("filters disallowed combos, keeps regular models + allowed combos", () => {
    const key = makeKey({ allowedCombos: ["flagship"] });
    const out = filterModelsByScope(models, key);
    expect(out.map((m) => m.id)).toEqual(["openai/gpt-4", "anthropic/claude", "combo/flagship", "tts/edge-tts"]);
  });

  it("filters by allowedModels (legacy scope)", () => {
    const key = makeKey({ allowedModels: ["openai/gpt-4"] });
    const out = filterModelsByScope(models, key);
    expect(out.map((m) => m.id)).toEqual(["openai/gpt-4"]);
  });

  it("empty providers array yields only combos (providers dimension denies all)", () => {
    const key = makeKey({ allowedProviders: [] });
    const out = filterModelsByScope(models, key);
    expect(out.map((m) => m.id)).toEqual(["combo/flagship", "combo/other"]);
  });

  it("empty combos array hides every combo", () => {
    const key = makeKey({ allowedCombos: [] });
    const out = filterModelsByScope(models, key);
    expect(out.map((m) => m.id)).toEqual(["openai/gpt-4", "anthropic/claude", "tts/edge-tts"]);
  });
});

describe("A7: authorizeApiRequest pipeline enforces ACL", () => {
  // Raw DB row shape: JSON columns arrive as STRINGS (safeParse handles them).
  const aclRow = (overrides = {}) => ({
    id: "k1",
    keyPrefix: "vela-test",
    name: "test",
    allowedModels: null,
    allowedKinds: null,
    allowedProviders: '["openai"]',
    allowedCombos: null,
    isActive: 1,
    isInternal: 0,
    expiresAt: null,
    rateLimitRpm: null,
    tokenBudgetDaily: null,
    spendCapDailyCents: null,
    budgetScope: null,
    ipAllowlist: null,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdapter.mockResolvedValue({ run: vi.fn() }); // touchLastUsed sink
  });

  it("denies a provider outside allowedProviders", async () => {
    mocks.resolveKey.mockResolvedValue(aclRow());

    const settings = { requireApiKey: true };
    const request = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer test-key" },
    });

    const verdict = await authorizeApiRequest(request, {
      requestModel: "anthropic/claude",
      kind: "llm",
      settings,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.status).toBe(HTTP_STATUS.FORBIDDEN);
  });

  it("passes a provider inside allowedProviders", async () => {
    mocks.resolveKey.mockResolvedValue(aclRow());

    const settings = { requireApiKey: true };
    const request = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer test-key" },
    });

    const verdict = await authorizeApiRequest(request, {
      requestModel: "openai/gpt-4",
      kind: "llm",
      settings,
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.key.allowedProviders).toEqual(["openai"]);
  });

  it("denies a combo outside allowedCombos", async () => {
    mocks.resolveKey.mockResolvedValue(aclRow({ allowedProviders: null, allowedCombos: '["flagship"]' }));

    const settings = { requireApiKey: true };
    const request = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer test-key" },
    });

    const verdict = await authorizeApiRequest(request, {
      requestModel: "combo/other",
      kind: "llm",
      settings,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.status).toBe(HTTP_STATUS.FORBIDDEN);
  });

  it("denies a kind outside allowedKinds", async () => {
    mocks.resolveKey.mockResolvedValue(aclRow({ allowedProviders: null, allowedKinds: '["llm"]' }));

    const settings = { requireApiKey: true };
    const request = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer test-key" },
    });

    const verdict = await authorizeApiRequest(request, {
      requestModel: "tts/edge-tts",
      kind: "tts",
      settings,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.status).toBe(HTTP_STATUS.FORBIDDEN);
  });

  it("missing key still denies before ACL stages", async () => {
    mocks.resolveKey.mockResolvedValue(null);

    const settings = { requireApiKey: true };
    const request = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer bad-key" },
    });

    const verdict = await authorizeApiRequest(request, {
      requestModel: "openai/gpt-4",
      kind: "llm",
      settings,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe(GATE_CODES.INVALID_KEY);
  });
});
