// Usage Observatory W3-B — the budget engine's contract test.
//
// Covers budgetGate.js (Observatory hierarchy) against the frozen vocabulary
// of budgetDef.js: scopes gateway|key|model, windows day|week|month, soft
// 50/80/100 alert emission, hard-cap 429s with DISTINCT codes, the fail-open
// degradation posture, the keyless passthrough binding, the TTL caches, and
// the wiring through authorizeApiRequest (legacy budget_exceeded precedence
// included).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveKey: vi.fn(),
  getApiKeyById: vi.fn(),
  listBudgets: vi.fn(),
  getUsageDailySince: vi.fn(),
}));

vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({
  resolveKey: mocks.resolveKey,
  getApiKeyById: mocks.getApiKeyById,
}));
vi.mock("@/lib/db/repos/budgetRepo.js", () => ({
  listBudgets: mocks.listBudgets,
}));
vi.mock("@/lib/db/repos/usageRepo.js", () => ({
  getUsageDailySince: mocks.getUsageDailySince,
  touchKeyLastUsed: vi.fn(async () => {}),
}));
// Deterministic model resolution — "provider/model" parses; bare names resolve
// to a fixed provider so alias-matching paths stay hermetic.
vi.mock("@/sse/services/model.js", () => ({
  parseModel: (s) => {
    if (typeof s !== "string") return null;
    const i = s.indexOf("/");
    if (i <= 0) return { provider: null, model: s, isAlias: true };
    return { provider: s.slice(0, i), model: s.slice(i + 1), providerAlias: s.slice(0, i) };
  },
  getModelInfo: async (s) => ({ provider: "aliasprov", model: String(s) }),
}));

const { budgetStage, quotaWindowStart, onBudgetAlert, getRecentBudgetAlerts } =
  await import("@/sse/services/budgetGate.js");
const { authorizeApiRequest, GATE_CODES } = await import("@/sse/services/keyGate.js");

// ── fixtures ───────────────────────────────────────────────────────────────

function budget(over = {}) {
  return {
    id: "gateway:*",
    scope: "gateway",
    subject: null,
    window: "day",
    tokenCap: null,
    spendCapCents: null,
    thresholds: [50, 80, 100],
    isActive: true,
    ...over,
  };
}

// One parsed usageDaily ledger day — same shape aggregateEntryToDay writes
// (day totals + byModel/byApiKey entries with meta). dateKey rides along for
// the mock's window filter only — the engine never reads it.
function day(dateKey, { prompt = 0, completion = 0, cost = 0, byModel = null, byApiKey = null } = {}) {
  return {
    dateKey,
    requests: 1,
    promptTokens: prompt,
    completionTokens: completion,
    cachedTokens: 0,
    cost,
    byProvider: {},
    byModel: byModel || {},
    byAccount: {},
    byApiKey: byApiKey || {},
    byEndpoint: {},
  };
}

function ledgerSince(days) {
  // Honors the startDateKey param so window boundaries are tested honestly.
  mocks.getUsageDailySince.mockImplementation(async (start) => days.filter((d) => d.dateKey >= start));
}

function resetGateGlobals() {
  delete global._velaQuotaDaysCache;
  delete global._velaQuotaSumsCache;
  delete global._velaBudgetAlertRing;
  delete global._velaRateWindows;
  delete global._velaBudgetCache;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetGateGlobals();
  mocks.listBudgets.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

// ── window math ────────────────────────────────────────────────────────────

describe("quotaWindowStart — local-date window boundaries", () => {
  it("day → today's local dateKey", () => {
    expect(quotaWindowStart("day", new Date(2024, 0, 3, 23, 59))).toBe("2024-01-03");
  });

  it("week → Monday of the ISO week", () => {
    // 2024-01-01 is a Monday; 2024-01-07 the following Sunday.
    expect(quotaWindowStart("week", new Date(2024, 0, 3))).toBe("2024-01-01");
    expect(quotaWindowStart("week", new Date(2024, 0, 7))).toBe("2024-01-01"); // Sunday → same week
    expect(quotaWindowStart("week", new Date(2024, 0, 8))).toBe("2024-01-08"); // next Monday
  });

  it("month → the 1st of the month", () => {
    expect(quotaWindowStart("month", new Date(2024, 2, 15))).toBe("2024-03-01");
    expect(quotaWindowStart("month", new Date(2024, 11, 31))).toBe("2024-12-01");
  });
});

// ── hard caps — distinct 429 codes per scope ──────────────────────────────

describe("budgetStage — hard caps", () => {
  it("no budgets → pass without touching the ledger", async () => {
    const verdict = await budgetStage({ keyId: "k" }, {});
    expect(verdict.ok).toBe(true);
    expect(mocks.getUsageDailySince).not.toHaveBeenCalled();
  });

  it("gateway token cap at/over → 429 gateway_budget_exceeded", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00"));
    mocks.listBudgets.mockResolvedValue([budget({ tokenCap: 1000 })]);
    ledgerSince([day("2026-08-14", { prompt: 600, completion: 400 })]);
    const verdict = await budgetStage({ keyId: "k" }, {});
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe("gateway_budget_exceeded");
    expect(verdict.status).toBe(429);
    expect(verdict.message).toContain("1000 of 1000 tokens");
  });

  it("gateway under cap → pass", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00"));
    mocks.listBudgets.mockResolvedValue([budget({ tokenCap: 1000 })]);
    ledgerSince([day("2026-08-14", { prompt: 600, completion: 399 })]);
    expect((await budgetStage({ keyId: "k" }, {})).ok).toBe(true);
  });

  it("key spend cap crossed → 429 key_budget_exceeded with dollar context", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00"));
    mocks.listBudgets.mockResolvedValue([
      budget({ id: "key:k1", scope: "key", subject: "k1", spendCapCents: 500 }),
    ]);
    ledgerSince([
      day("2026-08-14", {
        byApiKey: {
          "k1|openai/gpt-4o|openai": { promptTokens: 10, completionTokens: 0, cost: 5.0, meta: { keyId: "k1" } },
          "k2|openai/gpt-4o|openai": { promptTokens: 999, completionTokens: 999, cost: 99, meta: { keyId: "k2" } },
        },
      }),
    ]);
    // The capped key is denied; a different key passes — subject scoping holds.
    const denied = await budgetStage({ keyId: "k1" }, {});
    expect(denied.ok).toBe(false);
    expect(denied.code).toBe("key_budget_exceeded");
    expect(denied.status).toBe(429);
    expect(denied.message).toContain("$5.00 of $5.00");
    delete global._velaQuotaSumsCache;
    expect((await budgetStage({ keyId: "k2" }, {})).ok).toBe(true);
  });

  it("model token cap crossed → 429 model_budget_exceeded (provider/model and bare-name match)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00"));
    mocks.listBudgets.mockResolvedValue([
      budget({ id: "model:openai/gpt-4o", scope: "model", subject: "openai/gpt-4o", tokenCap: 100 }),
    ]);
    ledgerSince([
      day("2026-08-14", {
        byModel: {
          "gpt-4o|openai": { promptTokens: 80, completionTokens: 30, cost: 0, meta: { rawModel: "gpt-4o", provider: "openai" } },
          "claude-3|anthropic": { promptTokens: 9999, completionTokens: 9999, cost: 0, meta: { rawModel: "claude-3", provider: "anthropic" } },
        },
      }),
    ]);
    const denied = await budgetStage({ keyId: "k" }, { requestModel: "openai/gpt-4o" });
    expect(denied.ok).toBe(false);
    expect(denied.code).toBe("model_budget_exceeded");
    // Bare model-name subjects match the same ledger entries.
    delete global._velaQuotaSumsCache;
    mocks.listBudgets.mockResolvedValue([
      budget({ id: "model:gpt-4o", scope: "model", subject: "gpt-4o", tokenCap: 100 }),
    ]);
    expect((await budgetStage({ keyId: "k" }, { requestModel: "openai/gpt-4o" })).ok).toBe(false);
  });

  it("a different request model does not trip a model budget", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00"));
    mocks.listBudgets.mockResolvedValue([
      budget({ id: "model:openai/gpt-4o", scope: "model", subject: "openai/gpt-4o", tokenCap: 10 }),
    ]);
    ledgerSince([day("2026-08-14", { prompt: 5, completion: 5 })]);
    const verdict = await budgetStage({ keyId: "k" }, { requestModel: "anthropic/claude-3" });
    expect(verdict.ok).toBe(true);
  });

  it("inactive budgets are ignored", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00"));
    mocks.listBudgets.mockResolvedValue([budget({ tokenCap: 1, isActive: false })]);
    ledgerSince([day("2026-08-14", { prompt: 100, completion: 100 })]);
    expect((await budgetStage({ keyId: "k" }, {})).ok).toBe(true);
  });

  it("day windows exclude prior days; month windows include the whole month", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00"));
    const huge = day("2026-08-13", { prompt: 999999, completion: 0 });
    const small = day("2026-08-14", { prompt: 10, completion: 0 });
    mocks.listBudgets.mockResolvedValue([budget({ window: "day", tokenCap: 500 })]);
    ledgerSince([huge, small]);
    // A day budget on the 14th sees only the 14th → pass.
    expect((await budgetStage({ keyId: "k" }, {})).ok).toBe(true);
    // A month budget sees both days → deny.
    delete global._velaQuotaSumsCache;
    delete global._velaQuotaDaysCache;
    mocks.listBudgets.mockResolvedValue([budget({ window: "month", tokenCap: 500 })]);
    const monthVerdict = await budgetStage({ keyId: "k" }, {});
    expect(monthVerdict.ok).toBe(false);
    expect(monthVerdict.code).toBe("gateway_budget_exceeded");
  });
});

// ── soft thresholds — alert emission, never denial ─────────────────────────

describe("budgetStage — soft thresholds (50/80/100)", () => {
  it("crossing 50% emits an alert record and still passes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00"));
    mocks.listBudgets.mockResolvedValue([budget({ tokenCap: 1000 })]);
    ledgerSince([day("2026-08-14", { prompt: 300, completion: 250 })]); // 550 = 55%
    const seen = [];
    const off = onBudgetAlert((a) => seen.push(a));
    const verdict = await budgetStage({ keyId: "k" }, {});
    off();
    expect(verdict.ok).toBe(true);
    expect(verdict.alerts).toHaveLength(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      budgetId: "gateway:*", scope: "gateway", capType: "token",
      cap: 1000, used: 550, threshold: 50,
    });
    expect(seen[0].pct).toBe(55);
    expect(getRecentBudgetAlerts()).toHaveLength(1);
  });

  it("the alert ring stays bounded and listeners never break the gate", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00"));
    mocks.listBudgets.mockResolvedValue([budget({ tokenCap: 100 })]);
    ledgerSince([day("2026-08-14", { prompt: 99, completion: 0 })]); // 99% — never >= cap
    const off = onBudgetAlert(() => { throw new Error("broken channel"); });
    const verdict = await budgetStage({ keyId: "k" }, {});
    off();
    expect(verdict.ok).toBe(true); // a broken listener must not deny traffic
    expect(verdict.alerts[0].threshold).toBe(80); // 99% crosses 50 AND 80 → highest reported
  });

  it("under the first threshold → no alerts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00"));
    mocks.listBudgets.mockResolvedValue([budget({ tokenCap: 1000 })]);
    ledgerSince([day("2026-08-14", { prompt: 100, completion: 0 })]); // 10%
    const verdict = await budgetStage({ keyId: "k" }, {});
    expect(verdict.ok).toBe(true);
    expect(verdict.alerts).toEqual([]);
  });
});

// ── degradation posture (honest fail-open) ─────────────────────────────────

describe("budgetStage — degradation", () => {
  it("budget config unreachable → pass, flagged degraded", async () => {
    mocks.listBudgets.mockRejectedValue(new Error("kv offline"));
    const verdict = await budgetStage({ keyId: "k" }, {});
    expect(verdict.ok).toBe(true);
    expect(verdict.degraded).toBe("budget-config-unavailable");
  });

  it("ledger unreachable → budgets degrade open rather than 500 the gate", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00"));
    mocks.listBudgets.mockResolvedValue([budget({ tokenCap: 1 })]);
    mocks.getUsageDailySince.mockRejectedValue(new Error("db locked"));
    const verdict = await budgetStage({ keyId: "k" }, {});
    expect(verdict.ok).toBe(true);
  });
});

// ── hot-path caches ────────────────────────────────────────────────────────

describe("budgetStage — TTL caches", () => {
  it("repeated evaluations within 5s read the ledger once", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00"));
    mocks.listBudgets.mockResolvedValue([budget({ tokenCap: 1_000_000 })]);
    ledgerSince([day("2026-08-14", { prompt: 10, completion: 0 })]);
    await budgetStage({ keyId: "k" }, {});
    await budgetStage({ keyId: "k" }, {});
    await budgetStage({ keyId: "k" }, {});
    expect(mocks.getUsageDailySince).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5_001);
    await budgetStage({ keyId: "k" }, {});
    expect(mocks.getUsageDailySince).toHaveBeenCalledTimes(2);
  });

  it("budgets sharing a window share one ledger fetch", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00"));
    mocks.listBudgets.mockResolvedValue([
      budget({ tokenCap: 1_000_000 }),
      budget({ id: "key:k1", scope: "key", subject: "k1", tokenCap: 1_000_000 }),
    ]);
    ledgerSince([day("2026-08-14", { prompt: 1, completion: 0 })]);
    await budgetStage({ keyId: "k1" }, {});
    expect(mocks.getUsageDailySince).toHaveBeenCalledTimes(1);
  });
});

// ── keyless passthrough — gateway/model caps still bind ────────────────────

describe("budgetStage — keyless passthrough (key: null)", () => {
  it("gateway budget binds keyless traffic", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00"));
    mocks.listBudgets.mockResolvedValue([budget({ tokenCap: 10 })]);
    ledgerSince([day("2026-08-14", { prompt: 10, completion: 10 })]);
    const verdict = await budgetStage(null, {});
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe("gateway_budget_exceeded");
  });

  it("key-scoped budgets never bind keyless traffic", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00"));
    mocks.listBudgets.mockResolvedValue([
      budget({ id: "key:k1", scope: "key", subject: "k1", tokenCap: 1 }),
    ]);
    ledgerSince([day("2026-08-14", { prompt: 999, completion: 999 })]);
    expect((await budgetStage(null, {})).ok).toBe(true);
  });

  it("model budget binds keyless traffic carrying that model", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00"));
    mocks.listBudgets.mockResolvedValue([
      budget({ id: "model:openai/gpt-4o", scope: "model", subject: "openai/gpt-4o", tokenCap: 5 }),
    ]);
    ledgerSince([
      day("2026-08-14", {
        byModel: { "gpt-4o|openai": { promptTokens: 9, completionTokens: 0, cost: 0, meta: { rawModel: "gpt-4o", provider: "openai" } } },
      }),
    ]);
    const denied = await budgetStage(null, { requestModel: "openai/gpt-4o" });
    expect(denied.ok).toBe(false);
    expect(denied.code).toBe("model_budget_exceeded");
  });
});

// ── full-gate wiring ───────────────────────────────────────────────────────

const SETTINGS = { requireApiKey: true };
const VALID_BEARER = { Authorization: "Bearer vela-v1-test" };

function req(headers = {}) {
  return { headers: new Headers(headers), url: "http://localhost/v1/chat/completions" };
}

function keyRow(over = {}) {
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

describe("authorizeApiRequest — budgetStage wired end-to-end", () => {
  it("a breached gateway budget denies through the gate with its distinct code", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00"));
    mocks.resolveKey.mockResolvedValue(keyRow());
    mocks.listBudgets.mockResolvedValue([budget({ tokenCap: 10 })]);
    ledgerSince([day("2026-08-14", { prompt: 50, completion: 50 })]);
    const res = await authorizeApiRequest(req(VALID_BEARER), {
      settings: SETTINGS, requestModel: "openai/gpt-4o",
    });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("gateway_budget_exceeded");
    expect(res.status).toBe(429);
  });

  it("legacy per-key caps keep precedence — budget_exceeded fires before the Observatory codes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00"));
    const keyId = "kid" + "0".repeat(29);
    mocks.resolveKey.mockResolvedValue(keyRow({ tokenBudgetDaily: 10, budgetScope: "daily" }));
    mocks.listBudgets.mockResolvedValue([budget({ tokenCap: 1 })]);
    // Ledger day shaped for BOTH instruments: byApiKey entry (legacy sum) +
    // day totals (gateway sum) over the cap.
    ledgerSince([
      day("2026-08-14", {
        prompt: 100, completion: 100,
        byApiKey: { [`${keyId}|openai/gpt-4o|openai`]: { promptTokens: 100, completionTokens: 100, cost: 0, meta: { keyId } } },
      }),
    ]);
    const res = await authorizeApiRequest(req(VALID_BEARER), {
      settings: SETTINGS, requestModel: "openai/gpt-4o",
    });
    expect(res.ok).toBe(false);
    expect(res.code).toBe(GATE_CODES.BUDGET_EXCEEDED); // legacy code — spendStage ran first
  });

  it("REGRESSION: with no budgets defined, the gate behaves exactly as before", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00"));
    mocks.resolveKey.mockResolvedValue(keyRow());
    mocks.listBudgets.mockResolvedValue([]);
    ledgerSince([]);
    const res = await authorizeApiRequest(req(VALID_BEARER), { settings: SETTINGS });
    expect(res.ok).toBe(true);
    expect(res.key).toBeTruthy();
    expect(mocks.getUsageDailySince).not.toHaveBeenCalled();
  });

  it("requireApiKey=false — gateway budgets still bind the keyless passthrough", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00"));
    mocks.listBudgets.mockResolvedValue([budget({ tokenCap: 10 })]);
    ledgerSince([day("2026-08-14", { prompt: 99, completion: 0 })]);
    const denied = await authorizeApiRequest(req({}), {
      settings: { requireApiKey: false }, requestModel: "openai/gpt-4o",
    });
    expect(denied.ok).toBe(false);
    expect(denied.code).toBe("gateway_budget_exceeded");
    // Within the cap → the frozen passthrough still returns skipped.
    delete global._velaQuotaSumsCache;
    delete global._velaQuotaDaysCache;
    mocks.listBudgets.mockResolvedValue([budget({ tokenCap: 10_000 })]);
    const passed = await authorizeApiRequest(req({}), { settings: { requireApiKey: false } });
    expect(passed.ok).toBe(true);
    expect(passed.skipped).toBe(true);
    expect(passed.key).toBeNull();
  });
});
