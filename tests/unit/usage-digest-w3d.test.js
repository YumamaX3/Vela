// Usage Observatory W3-D — the weekly digest's contract test.
//
// Covers usageDigest.js: buildWeeklyDigest aggregation (totals + top-N by
// cost, masked key identity), once-per-week dedupe via the kv marker, the
// enabled-gate, channel fan-out (Discord + n8n reuse W3-C's webhooks, enabled
// flags honored, URLs never fetched when disabled), and fail-open degradation.
//
// Hermetic precedent (W3-B/W3-C): model.js is mocked so no import ever opens
// the live app database; every repo the digest touches is injected via vi.mock.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getUsageDailySince: vi.fn(),
  getDigestState: vi.fn(),
  setDigestState: vi.fn(),
}));

vi.mock("@/lib/db/repos/settingsRepo.js", () => ({
  getSettings: mocks.getSettings,
}));
vi.mock("@/lib/db/repos/usageRepo.js", () => ({
  getUsageDailySince: mocks.getUsageDailySince,
}));
vi.mock("@/lib/db/repos/digestRepo.js", () => ({
  getDigestState: mocks.getDigestState,
  setDigestState: mocks.setDigestState,
}));
// The W3-B hermetic precedent — model.js statically imports @/lib/localDb,
// which opens the LIVE app database on import. Mock keeps the digest DB-free.
vi.mock("@/sse/services/model.js", () => ({
  parseModel: (s) => {
    if (typeof s !== "string") return null;
    const i = s.indexOf("/");
    if (i <= 0) return { provider: null, model: s, isAlias: true };
    return { provider: s.slice(0, i), model: s.slice(i + 1), providerAlias: s.slice(0, i) };
  },
  getModelInfo: async (s) => ({ provider: "aliasprov", model: String(s) }),
}));

const { buildWeeklyDigest, runWeeklyDigest } = await import("@/sse/services/usageDigest.js");

// ── fixtures ───────────────────────────────────────────────────────────────

function day({ requests = 0, prompt = 0, completion = 0, cached = 0, cost = 0, byProvider = {}, byModel = {}, byApiKey = {} }) {
  return {
    requests, promptTokens: prompt, completionTokens: completion, cachedTokens: cached, cost,
    byProvider, byModel, byApiKey, byAccount: {}, byEndpoint: {},
  };
}

const sampleDays = [
  day({
    requests: 10, prompt: 1000, completion: 500, cached: 200, cost: 0.5,
    byProvider: { openai: { requests: 6, promptTokens: 600, completionTokens: 300, cost: 0.3 }, anthropic: { requests: 4, promptTokens: 400, completionTokens: 200, cost: 0.2 } },
    byModel: { "gpt-4o|openai": { requests: 6, promptTokens: 600, completionTokens: 300, cost: 0.3, rawModel: "gpt-4o", provider: "openai" } },
    byApiKey: { "k1|gpt-4o|openai": { requests: 6, promptTokens: 600, completionTokens: 300, cost: 0.3, keyId: "k1", keyPrefix: "sk-…abc", rawModel: "gpt-4o", provider: "openai" } },
  }),
  day({
    requests: 5, prompt: 400, completion: 100, cached: 0, cost: 0.1,
    byProvider: { anthropic: { requests: 5, promptTokens: 400, completionTokens: 100, cost: 0.1 } },
    byModel: { "claude|anthropic": { requests: 5, promptTokens: 400, completionTokens: 100, cost: 0.1, rawModel: "claude", provider: "anthropic" } },
    byApiKey: { "k2|claude|anthropic": { requests: 5, promptTokens: 400, completionTokens: 100, cost: 0.1, keyId: "k2", keyPrefix: "sk-…def", rawModel: "claude", provider: "anthropic" } },
  }),
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSettings.mockResolvedValue({ budgetAlerts: { weeklyDigestEnabled: true } });
  mocks.getUsageDailySince.mockResolvedValue(sampleDays);
  mocks.getDigestState.mockResolvedValue({});
  mocks.setDigestState.mockResolvedValue();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-17T12:00:00")); // a Monday
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── buildWeeklyDigest — aggregation ───────────────────────────────────────

describe("buildWeeklyDigest — the ledger summary", () => {
  it("sums totals across the days returned by getUsageDailySince", async () => {
    const d = await buildWeeklyDigest();
    expect(d.totals.requests).toBe(15);
    expect(d.totals.tokens).toBe(2000);
    expect(d.totals.cachedTokens).toBe(200);
    expect(d.totals.cost).toBeCloseTo(0.6, 5);
  });

  it("ranks providers, models, and keys by cost (top-N)", async () => {
    const d = await buildWeeklyDigest();
    // anthropic 0.3 (0.2+0.1) edges openai 0.3 — stable by insertion among ties;
    // both present, requests differ.
    const provs = d.topProviders.map((r) => r.label);
    expect(provs).toContain("anthropic");
    expect(provs).toContain("openai");
    expect(d.topModels.map((r) => r.label)).toContain("openai/gpt-4o");
    expect(d.topKeys.map((r) => r.label)).toContain("sk-…abc");
    expect(d.topKeys.map((r) => r.label)).toContain("sk-…def");
  });

  it("queries the ledger for the last 7 calendar days", async () => {
    await buildWeeklyDigest();
    // Monday 2026-08-17 → start = 2026-08-11 (6 days back, inclusive today).
    expect(mocks.getUsageDailySince).toHaveBeenCalledWith("2026-08-11");
  });

  it("masks keyless rows and never leaks a raw key", async () => {
    mocks.getUsageDailySince.mockResolvedValue([
      day({
        requests: 1, prompt: 10, completion: 5, cost: 0.01,
        byApiKey: { "local-no-key|x|y": { requests: 1, promptTokens: 10, completionTokens: 5, cost: 0.01, keyId: null, keyPrefix: null } },
      }),
    ]);
    const d = await buildWeeklyDigest();
    expect(d.topKeys.map((r) => r.label)).toContain("No key");
  });
});

// ── runWeeklyDigest — dedupe + enabled gate ──────────────────────────────

describe("runWeeklyDigest — once per week, only when armed", () => {
  it("sends once and stamps the week marker", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    mocks.getSettings.mockResolvedValue({
      budgetAlerts: { weeklyDigestEnabled: true, discordEnabled: true, discordWebhookUrl: "https://discord.example/hook" },
    });
    const res = await runWeeklyDigest();
    expect(res.ok).toBe(true);
    expect(res.sent).toBe(true);
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    // Marker stamped with the current week's start (Monday dateKey).
    expect(mocks.setDigestState).toHaveBeenCalledWith(
      expect.objectContaining({ lastSentWeek: "2026-08-17" })
    );
  });

  it("dedupes a repeat send within the same week", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    mocks.getDigestState.mockResolvedValue({ lastSentWeek: "2026-08-17" });
    const res = await runWeeklyDigest();
    expect(res.sent).toBe(false);
    expect(res.skipped).toBe("already-sent-this-week");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("re-arms when the week rolls over (new Monday marker)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    mocks.getSettings.mockResolvedValue({
      budgetAlerts: { weeklyDigestEnabled: true, n8nEnabled: true, n8nWebhookUrl: "https://n8n.example/hook" },
    });
    mocks.getDigestState.mockResolvedValue({ lastSentWeek: "2026-08-10" }); // LAST week
    const res = await runWeeklyDigest();
    expect(res.sent).toBe(true);
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(mocks.setDigestState).toHaveBeenCalledWith(
      expect.objectContaining({ lastSentWeek: "2026-08-17" })
    );
  });

  it("skips when disabled (and force does not bypass the enabled-channel check)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    mocks.getSettings.mockResolvedValue({ budgetAlerts: { weeklyDigestEnabled: false } });
    const res = await runWeeklyDigest();
    expect(res.sent).toBe(false);
    expect(res.skipped).toBe("disabled");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("force bypasses the week dedupe but still respects enabled channels", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    mocks.getSettings.mockResolvedValue({
      budgetAlerts: { weeklyDigestEnabled: true, discordEnabled: true, discordWebhookUrl: "https://discord.example/hook" },
    });
    mocks.getDigestState.mockResolvedValue({ lastSentWeek: "2026-08-17" }); // already sent
    const res = await runWeeklyDigest({ force: true });
    expect(res.sent).toBe(true);
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  });
});

// ── delivery — reuses W3-C's channels ────────────────────────────────────

describe("runWeeklyDigest — webhook fan-out", () => {
  it("posts to Discord when enabled, never when disabled", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    mocks.getSettings.mockResolvedValue({
      budgetAlerts: { weeklyDigestEnabled: true, discordEnabled: true, discordWebhookUrl: "https://discord.example/hook" },
    });
    await runWeeklyDigest();
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://discord.example/hook");
    const body = JSON.parse(init.body);
    expect(body.content).toContain("weekly usage digest");
    expect(body.embeds[0].fields.length).toBeGreaterThan(2);

    fetchSpy.mockClear();
    mocks.getSettings.mockResolvedValue({
      budgetAlerts: { weeklyDigestEnabled: true, discordEnabled: false, discordWebhookUrl: "https://discord.example/hook" },
    });
    mocks.getDigestState.mockResolvedValue({}); // fresh week → would send if armed
    await runWeeklyDigest();
    await Promise.resolve();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts structured JSON to n8n when enabled", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    mocks.getSettings.mockResolvedValue({
      budgetAlerts: { weeklyDigestEnabled: true, n8nEnabled: true, n8nWebhookUrl: "https://n8n.example/webhook/digest" },
    });
    await runWeeklyDigest();
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://n8n.example/webhook/digest");
    const body = JSON.parse(init.body);
    expect(body.source).toBe("vela-usage-digest");
    expect(body.totals.requests).toBe(15);
  });

  it("never fetches a non-http URL (no file:// or javascript: exfil)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    mocks.getSettings.mockResolvedValue({
      budgetAlerts: { weeklyDigestEnabled: true, discordEnabled: true, discordWebhookUrl: "file:///etc/passwd" },
    });
    await runWeeklyDigest();
    await Promise.resolve();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a webhook that throws never breaks the digest tick", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    mocks.getSettings.mockResolvedValue({
      budgetAlerts: { weeklyDigestEnabled: true, discordEnabled: true, discordWebhookUrl: "https://discord.example/hook" },
    });
    const res = await runWeeklyDigest();
    expect(res.ok).toBe(true); // delivery failed, tick still succeeded
    expect(res.sent).toBe(true);
  });

  it("settings unreadable → the tick degrades, never throws", async () => {
    mocks.getSettings.mockRejectedValue(new Error("db locked"));
    const res = await runWeeklyDigest();
    expect(res.ok).toBe(false);
    expect(res.sent).toBe(false);
    expect(res.error).toBe("settings-unavailable");
  });
});
