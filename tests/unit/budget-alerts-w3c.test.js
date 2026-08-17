// Usage Observatory W3-C — the alert delivery layer's contract test.
//
// Covers budgetAlerts.js: hysteresis (fire once per upward threshold crossing
// per window), dedupe (repeats at same/lower level swallowed), window re-arm
// (key change re-fires fresh), banner state (active breaches, worst first,
// stale windows dropped), and webhook fan-out (Discord + n8n, enabled flags
// honored, URLs never fetched when disabled, never logged).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
}));

vi.mock("@/lib/db/repos/settingsRepo.js", () => ({
  getSettings: mocks.getSettings,
}));
// The W3-B hermetic precedent: model.js imports @/lib/localDb, which opens the
// LIVE app database on import — a locked/busy shared sqlite hangs the suite.
// Mock it with deterministic parse/resolve so the gate stays DB-free.
vi.mock("@/sse/services/model.js", () => ({
  parseModel: (s) => {
    if (typeof s !== "string") return null;
    const i = s.indexOf("/");
    if (i <= 0) return { provider: null, model: s, isAlias: true };
    return { provider: s.slice(0, i), model: s.slice(i + 1), providerAlias: s.slice(0, i) };
  },
  getModelInfo: async (s) => ({ provider: "aliasprov", model: String(s) }),
}));

const { recordBudgetAlert, getActiveBudgetBreaches, _resetAlertState } =
  await import("@/sse/services/budgetAlerts.js");

// ── fixtures ───────────────────────────────────────────────────────────────

function alert(over = {}) {
  return {
    budgetId: "gateway:*",
    scope: "gateway",
    subject: null,
    window: "day",
    capType: "token",
    cap: 1000,
    used: 550,
    pct: 55,
    threshold: 50,
    ts: new Date("2026-08-14T12:00:00").getTime(),
    ...over,
  };
}

beforeEach(() => {
  _resetAlertState();
  vi.clearAllMocks();
  mocks.getSettings.mockResolvedValue({ budgetAlerts: {} });
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-14T12:00:00"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── hysteresis + dedupe ────────────────────────────────────────────────────

describe("recordBudgetAlert — hysteresis and dedupe", () => {
  it("fires on the first crossing of a threshold", () => {
    expect(recordBudgetAlert(alert({ threshold: 50, pct: 55 }))).toBe(true);
  });

  it("dedupes a repeat at the same threshold within the window", () => {
    expect(recordBudgetAlert(alert({ threshold: 50 }))).toBe(true);
    expect(recordBudgetAlert(alert({ threshold: 50, pct: 60 }))).toBe(false);
    expect(recordBudgetAlert(alert({ threshold: 50, pct: 79 }))).toBe(false);
  });

  it("fires on each UPWARD crossing, but never on a lower one", () => {
    expect(recordBudgetAlert(alert({ threshold: 50 }))).toBe(true);
    expect(recordBudgetAlert(alert({ threshold: 80, pct: 85 }))).toBe(true);
    // A dip back through 50 within the same window does NOT re-fire.
    expect(recordBudgetAlert(alert({ threshold: 50, pct: 55 }))).toBe(false);
    expect(recordBudgetAlert(alert({ threshold: 100, pct: 100 }))).toBe(true);
    expect(recordBudgetAlert(alert({ threshold: 80, pct: 90 }))).toBe(false);
  });

  it("tracks cap types independently — token and spend crossings don't dedupe each other", () => {
    expect(recordBudgetAlert(alert({ threshold: 80, capType: "token" }))).toBe(true);
    expect(recordBudgetAlert(alert({ threshold: 80, capType: "spend" }))).toBe(true);
  });

  it("tracks budgets independently", () => {
    expect(recordBudgetAlert(alert({ threshold: 80 }))).toBe(true);
    expect(recordBudgetAlert(alert({ budgetId: "key:k1", threshold: 80 }))).toBe(true);
  });

  it("re-arms when the window rolls over (fresh key)", () => {
    expect(recordBudgetAlert(alert({ threshold: 50 }))).toBe(true);
    expect(recordBudgetAlert(alert({ threshold: 50 }))).toBe(false); // deduped in same day
    // Jump to the NEXT day — usage resets, the state key changes, re-fires.
    vi.setSystemTime(new Date("2026-08-15T01:00:00"));
    expect(recordBudgetAlert(alert({ threshold: 50, ts: new Date("2026-08-15T01:00:00").getTime() }))).toBe(true);
  });

  it("ignores malformed alerts — never throws", () => {
    expect(recordBudgetAlert(null)).toBe(false);
    expect(recordBudgetAlert({})).toBe(false);
    // A partial alert (no window/cap fields) still records under the default
    // day window — it is a valid emission shape, just thin.
    expect(recordBudgetAlert({ budgetId: "x" })).toBe(true);
  });
});

// ── banner state ───────────────────────────────────────────────────────────

describe("getActiveBudgetBreaches — the banner surface", () => {
  it("returns live breaches worst first (threshold desc, then pct desc)", () => {
    recordBudgetAlert(alert({ budgetId: "key:a", threshold: 50, pct: 55 }));
    recordBudgetAlert(alert({ budgetId: "key:b", threshold: 100, pct: 100 }));
    recordBudgetAlert(alert({ budgetId: "key:c", threshold: 80, pct: 82 }));
    const breaches = getActiveBudgetBreaches();
    expect(breaches.map((b) => b.budgetId)).toEqual(["key:b", "key:c", "key:a"]);
    expect(breaches[0].threshold).toBe(100);
  });

  it("drops breaches whose window has rolled over", () => {
    recordBudgetAlert(alert({ threshold: 80 })); // window start 2026-08-14
    expect(getActiveBudgetBreaches()).toHaveLength(1);
    vi.setSystemTime(new Date("2026-08-15T00:05:00")); // next day
    expect(getActiveBudgetBreaches()).toHaveLength(0);
  });

  it("updates a breach in place as usage climbs within the window", () => {
    recordBudgetAlert(alert({ threshold: 50, used: 550, pct: 55 }));
    recordBudgetAlert(alert({ threshold: 100, used: 1000, pct: 100 }));
    const breaches = getActiveBudgetBreaches();
    expect(breaches).toHaveLength(1); // same budget|capType|window → one entry
    expect(breaches[0].threshold).toBe(100);
    expect(breaches[0].used).toBe(1000);
  });
});

// ── webhook fan-out ────────────────────────────────────────────────────────

describe("recordBudgetAlert — Discord + n8n webhooks", () => {
  it("posts to Discord when enabled, never when disabled", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    mocks.getSettings.mockResolvedValue({
      budgetAlerts: { discordEnabled: true, discordWebhookUrl: "https://discord.example/hook" },
    });
    recordBudgetAlert(alert({ threshold: 80 }));
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://discord.example/hook");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body).content).toContain("budget alert");
    expect(JSON.parse(init.body).embeds[0].color).toBe(0xd97706); // 80% → amber

    fetchSpy.mockClear();
    mocks.getSettings.mockResolvedValue({ budgetAlerts: { discordEnabled: false, discordWebhookUrl: "https://discord.example/hook" } });
    recordBudgetAlert(alert({ budgetId: "key:other", threshold: 80 }));
    await Promise.resolve(); // flush the fire-and-forget microtask
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts structured JSON to n8n when enabled", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    mocks.getSettings.mockResolvedValue({
      budgetAlerts: { n8nEnabled: true, n8nWebhookUrl: "https://n8n.example/webhook/budget" },
    });
    recordBudgetAlert(alert({ threshold: 100, pct: 100 }));
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://n8n.example/webhook/budget");
    const body = JSON.parse(init.body);
    expect(body.source).toBe("vela-budget-alert");
    expect(body.budgetId).toBe("gateway:*");
    expect(body.threshold).toBe(100);
  });

  it("never fetches a non-http URL (no file:// or javascript: exfil)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    mocks.getSettings.mockResolvedValue({
      budgetAlerts: { discordEnabled: true, discordWebhookUrl: "file:///etc/passwd" },
    });
    recordBudgetAlert(alert({ threshold: 50 }));
    await Promise.resolve();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a webhook that throws never breaks the gate's emission", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    mocks.getSettings.mockResolvedValue({
      budgetAlerts: { discordEnabled: true, discordWebhookUrl: "https://discord.example/hook" },
    });
    // Still returns true (the alert fired) even though delivery failed.
    expect(recordBudgetAlert(alert({ threshold: 50 }))).toBe(true);
    await Promise.resolve();
  });

  it("settings unreadable → deliveries degrade silently, alert still fires", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    mocks.getSettings.mockRejectedValue(new Error("db locked"));
    mocks.getSettings.mockResolvedValueOnce({ budgetAlerts: { discordEnabled: true, discordWebhookUrl: "https://x.example" } });
    // First alert: settings read succeeds (resolvedValueOnce), delivery attempted.
    recordBudgetAlert(alert({ threshold: 50 }));
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    // Second alert: settings read throws → no delivery, no throw.
    fetchSpy.mockClear();
    expect(recordBudgetAlert(alert({ budgetId: "key:k9", threshold: 50 }))).toBe(true);
    await Promise.resolve();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── gate integration — alerts flow end-to-end ─────────────────────────────

describe("budgetGate → budgetAlerts wiring", () => {
  it("a gate threshold crossing lands in the banner breaches", async () => {
    // Real timers here: vitest's dynamic-import machinery flushes through
    // timers, and the file-level useFakeTimers would starve it into a hang.
    vi.useRealTimers();
    // vi.doMock factories are LAZY (not hoisted like vi.mock), so plain
    // locals defined here resolve by the time the gate imports them.
    const gateMocks = {
      listBudgets: vi.fn(),
      getUsageDailySince: vi.fn(),
    };
    vi.doMock("@/lib/db/repos/budgetRepo.js", () => ({ listBudgets: gateMocks.listBudgets }));
    vi.doMock("@/lib/db/repos/usageRepo.js", () => ({
      getUsageDailySince: gateMocks.getUsageDailySince,
      touchKeyLastUsed: vi.fn(async () => {}),
    }));
    gateMocks.listBudgets.mockResolvedValue([{
      id: "gateway:*", scope: "gateway", subject: null, window: "day",
      tokenCap: 1000, spendCapCents: null, thresholds: [50, 80, 100], isActive: true,
    }]);
    gateMocks.getUsageDailySince.mockResolvedValue([
      { promptTokens: 400, completionTokens: 100, cost: 0, byModel: {}, byApiKey: {} },
    ]);
    const { budgetStage } = await import("@/sse/services/budgetGate.js");
    const verdict = await budgetStage({ keyId: "k" }, {});
    expect(verdict.ok).toBe(true);
    expect(verdict.alerts).toHaveLength(1);
    expect(getActiveBudgetBreaches().length).toBeGreaterThanOrEqual(1);
    vi.doUnmock("@/lib/db/repos/budgetRepo.js");
    vi.doUnmock("@/lib/db/repos/usageRepo.js");
  });
});
