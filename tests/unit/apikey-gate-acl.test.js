// Test covenant: apikey-gate-acl — table-driven state matrix over the stage pipeline.
// Plan: plans/vela-key-governance.md §7. The gate is the single decision point for
// every /v1 enforcement site; this suite locks its codes, statuses, and precedence.
import { describe, it, expect, beforeEach, vi } from "vitest";

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
  authorizeApiRequest,
  extractKeyFromHeaders,
  lifetimeStage,
  modelScopeStage,
  GATE_CODES,
} = await import("@/sse/services/keyGate.js");

function req(headers = {}, url = "http://localhost/v1/chat/completions") {
  return { headers: new Headers(headers), url };
}

// Raw DB row shape as resolveKey returns it (before toResolvedKey).
function row(over = {}) {
  return {
    id: "kid" + "0".repeat(29),
    name: "Test Key",
    keyPrefix: "vela-v1-kid0…",
    isActive: 1,
    isInternal: 0,
    allowedModels: null,
    expiresAt: null,
    rateLimitRpm: null,
    tokenBudgetDaily: null,
    spendCapDailyCents: null,
    budgetScope: null,
    ipAllowlist: null,
    ...over,
  };
}

const SETTINGS = { requireApiKey: true };
const VALID_BEARER = { Authorization: "Bearer vela-v1-test" };
const PAST = "2000-01-01T00:00:00.000Z";
const FUTURE = "2999-01-01T00:00:00.000Z";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAdapter.mockResolvedValue({ run: vi.fn() }); // touchLastUsed sink
});

describe("keyGate — state matrix (fail-closed, distinct codes)", () => {
  const matrix = [
    {
      name: "valid unrestricted key → ok",
      setup: () => mocks.resolveKey.mockResolvedValue(row()),
      expect: (res) => {
        expect(res.ok).toBe(true);
        expect(res.key.keyId).toBe("kid" + "0".repeat(29));
        expect(res.key.allowedModels).toBeNull();
      },
    },
    {
      name: "unknown key → 401 invalid_api_key",
      setup: () => mocks.resolveKey.mockResolvedValue(null),
      expect: (res) => {
        expect(res.ok).toBe(false);
        expect(res.code).toBe(GATE_CODES.INVALID_KEY);
        expect(res.status).toBe(401);
      },
    },
    {
      name: "missing key → 401 (never reaches resolve)",
      setup: () => mocks.resolveKey.mockResolvedValue(row()),
      headers: {},
      expect: (res) => {
        expect(res.ok).toBe(false);
        expect(res.code).toBe(GATE_CODES.INVALID_KEY);
        expect(mocks.resolveKey).not.toHaveBeenCalled();
      },
    },
    {
      name: "paused key → 403 key_paused (existence oracle is a documented decision)",
      setup: () => mocks.resolveKey.mockResolvedValue(row({ isActive: 0 })),
      expect: (res) => {
        expect(res.ok).toBe(false);
        expect(res.code).toBe(GATE_CODES.KEY_PAUSED);
        expect(res.status).toBe(403);
      },
    },
    {
      name: "expired key → 401 key_expired",
      setup: () => mocks.resolveKey.mockResolvedValue(row({ expiresAt: PAST })),
      expect: (res) => {
        expect(res.ok).toBe(false);
        expect(res.code).toBe(GATE_CODES.KEY_EXPIRED);
        expect(res.status).toBe(401);
      },
    },
    {
      name: "future expiresAt passes lifetime stage",
      setup: () => mocks.resolveKey.mockResolvedValue(row({ expiresAt: FUTURE })),
      expect: (res) => expect(res.ok).toBe(true),
    },
    {
      name: "out-of-scope model → 403 model_not_allowed",
      setup: () => mocks.resolveKey.mockResolvedValue(row({ allowedModels: '["openai/gpt-4o"]' })),
      opts: { requestModel: "anthropic/claude-x" },
      expect: (res) => {
        expect(res.ok).toBe(false);
        expect(res.code).toBe(GATE_CODES.MODEL_FORBIDDEN);
        expect(res.status).toBe(403);
      },
    },
    {
      name: "in-scope model → ok",
      setup: () => mocks.resolveKey.mockResolvedValue(row({ allowedModels: '["openai/gpt-4o"]' })),
      opts: { requestModel: "openai/gpt-4o" },
      expect: (res) => expect(res.ok).toBe(true),
    },
    {
      name: "combo — ALL members in scope → ok",
      setup: () => mocks.resolveKey.mockResolvedValue(row({ allowedModels: '["openai/gpt-4o","openai/gpt-4o-mini"]' })),
      opts: { comboModels: ["openai/gpt-4o", "openai/gpt-4o-mini"] },
      expect: (res) => expect(res.ok).toBe(true),
    },
    {
      name: "combo — ONE member out of scope → 403 (grant-time = ALL members)",
      setup: () => mocks.resolveKey.mockResolvedValue(row({ allowedModels: '["openai/gpt-4o"]' })),
      opts: { comboModels: ["openai/gpt-4o", "anthropic/claude-x"] },
      expect: (res) => {
        expect(res.ok).toBe(false);
        expect(res.code).toBe(GATE_CODES.MODEL_FORBIDDEN);
      },
    },
    {
      name: "internal key without allowInternal → masked 403 invalid_api_key (no oracle)",
      setup: () => mocks.resolveKey.mockResolvedValue(row({ isInternal: 1 })),
      expect: (res) => {
        expect(res.ok).toBe(false);
        expect(res.code).toBe(GATE_CODES.INVALID_KEY);
        expect(res.status).toBe(403);
      },
    },
    {
      name: "internal key WITH allowInternal (MITM-facing path) → ok",
      setup: () => mocks.resolveKey.mockResolvedValue(row({ isInternal: 1 })),
      opts: { allowInternal: true },
      expect: (res) => expect(res.ok).toBe(true),
    },
    {
      name: "requireApiKey=false → skipped pass-through, key null",
      setup: () => {},
      settings: { requireApiKey: false },
      headers: {},
      expect: (res) => {
        expect(res.ok).toBe(true);
        expect(res.skipped).toBe(true);
        expect(res.key).toBeNull();
      },
    },
    {
      name: "?key= query param is NEVER read by the gate",
      setup: () => mocks.resolveKey.mockResolvedValue(row()),
      headers: {},
      url: "http://localhost/v1/chat/completions?key=sk-anything",
      expect: (res) => {
        expect(res.ok).toBe(false);
        expect(res.code).toBe(GATE_CODES.INVALID_KEY);
        expect(mocks.resolveKey).not.toHaveBeenCalled();
      },
    },
  ];

  for (const c of matrix) {
    it(c.name, async () => {
      c.setup();
      const request = req(c.headers ?? VALID_BEARER, c.url);
      const res = await authorizeApiRequest(request, {
        settings: c.settings ?? SETTINGS,
        requestModel: c.opts?.requestModel ?? null,
        comboModels: c.opts?.comboModels ?? null,
        allowInternal: c.opts?.allowInternal ?? false,
      });
      c.expect(res);
    });
  }

  it("precedence: paused identity beats expired lifetime", async () => {
    mocks.resolveKey.mockResolvedValue(row({ isActive: 0, expiresAt: PAST }));
    const res = await authorizeApiRequest(req(VALID_BEARER), { settings: SETTINGS });
    expect(res.code).toBe(GATE_CODES.KEY_PAUSED); // identity checked before lifetime
  });
});

describe("keyGate — header extraction", () => {
  it("prefers Bearer, then x-api-key, then x-goog-api-key", () => {
    expect(extractKeyFromHeaders(req({ Authorization: "Bearer a", "x-api-key": "b" }))).toBe("a");
    expect(extractKeyFromHeaders(req({ "x-api-key": "b", "x-goog-api-key": "c" }))).toBe("b");
    expect(extractKeyFromHeaders(req({ "x-goog-api-key": "c" }))).toBe("c");
    expect(extractKeyFromHeaders(req({}))).toBeNull();
  });
});

describe("keyGate — stage functions exported for unit use", () => {
  it("lifetimeStage: null expiry passes, past expiry denies", () => {
    expect(lifetimeStage({ expiresAt: null }).ok).toBe(true);
    expect(lifetimeStage({ expiresAt: FUTURE }).ok).toBe(true);
    const denied = lifetimeStage({ expiresAt: PAST });
    expect(denied.ok).toBe(false);
    expect(denied.code).toBe(GATE_CODES.KEY_EXPIRED);
  });

  it("modelScopeStage: null scope is unrestricted; scope filters requestModel and comboModels", () => {
    expect(modelScopeStage({ allowedModels: null }, { requestModel: "anything" }).ok).toBe(true);
    const scoped = { allowedModels: ["openai/gpt-4o"] };
    expect(modelScopeStage(scoped, { requestModel: "openai/gpt-4o" }).ok).toBe(true);
    expect(modelScopeStage(scoped, { requestModel: "x/y" }).ok).toBe(false);
    expect(modelScopeStage(scoped, { comboModels: ["openai/gpt-4o"] }).ok).toBe(true);
    expect(modelScopeStage(scoped, { comboModels: ["x/y"] }).ok).toBe(false);
    // empty combo + no model → passes (nothing to check)
    expect(modelScopeStage(scoped, {}).ok).toBe(true);
  });
});
