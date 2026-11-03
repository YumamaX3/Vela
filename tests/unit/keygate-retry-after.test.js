// Test covenant: keygate-retry-after — honest Retry-After on key-gate 429s.
// Plan: plans/vela-key-governance.md §3.4 (rate stage). The rateLimitRpm
// denial must tell the client WHEN a slot frees: the whole-second (rounded up,
// floored at 1) lifespan left on the OLDEST in-window stamp. The header must
// reach the client on the denial Response itself, through both the gate's own
// response and the verdict's `headers` field (for routes that rebuild bodies).
// No other denial gains a Retry-After, and nothing here changes a verdict.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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

const { authorizeApiRequest, rateStage, GATE_CODES } = await import("@/sse/services/keyGate.js");

const SETTINGS = { requireApiKey: true };
const VALID_BEARER = { Authorization: "Bearer sk-vela-test-token" };

function req(headers = {}) {
  return { headers: new Headers(headers), url: "http://localhost/v1/chat/completions" };
}

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

/** A fresh keyId per test — the window map is a process-global singleton. */
let seq = 0;
const freshKeyId = () => `retry-after-${Date.now()}-${++seq}`;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
  mocks.resolveKey.mockReset();
  mocks.getAdapter.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("rateStage — honest Retry-After on the 429 denial", () => {
  it("untouched windows (null / 0 rpm) never carry a header", () => {
    for (const rpm of [null, 0]) {
      const verdict = rateStage({ keyId: freshKeyId(), rateLimitRpm: rpm });
      expect(verdict.ok).toBe(true);
      expect(verdict.headers).toBeUndefined();
      expect(verdict.response).toBeUndefined();
    }
  });

  it("reports the seconds left on the OLDEST in-window stamp, rounded up", () => {
    const key = { keyId: freshKeyId(), rateLimitRpm: 2 };
    expect(rateStage(key).ok).toBe(true);
    vi.advanceTimersByTime(30_000);
    expect(rateStage(key).ok).toBe(true); // second stamp at +30s
    vi.advanceTimersByTime(10_000); // now = +40s; oldest stamp (+0s) frees at +60s
    const denied = rateStage(key);
    expect(denied.ok).toBe(false);
    expect(denied.code).toBe(GATE_CODES.RATE_LIMITED);
    expect(denied.status).toBe(429);
    // 20s left on the oldest stamp — NOT the 50s the newest stamp would imply.
    expect(denied.headers).toEqual({ "Retry-After": "20" });
  });

  it("rounds a sub-second remainder up to 1 rather than promising 'now'", () => {
    const key = { keyId: freshKeyId(), rateLimitRpm: 1 };
    expect(rateStage(key).ok).toBe(true);
    vi.advanceTimersByTime(59_500); // 500ms left on the lone stamp
    const denied = rateStage(key);
    expect(denied.ok).toBe(false);
    expect(denied.headers).toEqual({ "Retry-After": "1" });
  });

  it("the Retry-After is real — waiting exactly that long frees a slot", () => {
    const key = { keyId: freshKeyId(), rateLimitRpm: 1 };
    expect(rateStage(key).ok).toBe(true);
    vi.advanceTimersByTime(58_100);
    const denied = rateStage(key);
    const waitMs = Number(denied.headers["Retry-After"]) * 1000;
    vi.advanceTimersByTime(waitMs);
    expect(rateStage(key).ok).toBe(true);
  });

  it("a second denial re-derives the header from the now-older stamp (never 0, never negative)", () => {
    const key = { keyId: freshKeyId(), rateLimitRpm: 1 };
    expect(rateStage(key).ok).toBe(true);
    vi.advanceTimersByTime(45_000);
    const first = rateStage(key);
    vi.advanceTimersByTime(10_000);
    const second = rateStage(key);
    expect(Number(first.headers["Retry-After"])).toBe(15);
    expect(Number(second.headers["Retry-After"])).toBe(5);
    expect(Number(second.headers["Retry-After"])).toBeGreaterThan(0);
  });

  it("the header rides on the denial Response itself", async () => {
    const key = { keyId: freshKeyId(), rateLimitRpm: 1 };
    expect(rateStage(key).ok).toBe(true);
    const denied = rateStage(key);
    expect(denied.response.status).toBe(429);
    expect(denied.response.headers.get("Retry-After")).toBe("60");
    // CORS stays intact — additive, not a replacement.
    expect(denied.response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(denied.response.headers.get("Content-Type")).toBe("application/json");
  });
});

describe("authorizeApiRequest — Retry-After flows to the enforcement site", () => {
  it("rate_limited through the gate carries the header on response and verdict", async () => {
    const keyId = freshKeyId();
    // row() reshapes the id → keyId exactly as toResolvedKey does; pin it.
    mocks.resolveKey.mockResolvedValue(row({ id: keyId, rateLimitRpm: 1 }));
    const call = () => authorizeApiRequest(req(VALID_BEARER), { settings: SETTINGS });
    expect((await call()).ok).toBe(true);
    vi.advanceTimersByTime(20_000);
    const denied = await call();
    expect(denied.ok).toBe(false);
    expect(denied.code).toBe(GATE_CODES.RATE_LIMITED);
    expect(denied.status).toBe(429);
    expect(denied.headers).toEqual({ "Retry-After": "40" });
    expect(denied.response.headers.get("Retry-After")).toBe("40");
  });

  it("other denials stay header-free — additive means additive", async () => {
    mocks.resolveKey.mockResolvedValue(null);
    const res = await authorizeApiRequest(req(VALID_BEARER), { settings: SETTINGS });
    expect(res.ok).toBe(false);
    expect(res.code).toBe(GATE_CODES.INVALID_KEY);
    expect(res.headers).toBeUndefined();
    expect(res.response.headers.get("Retry-After")).toBeNull();
  });

  it("fail-open: no key required → no rate verdict, no throw", async () => {
    const res = await authorizeApiRequest(req(), { settings: { requireApiKey: false } });
    expect(res.ok).toBe(true);
    expect(res.skipped).toBe(true);
  });
});
