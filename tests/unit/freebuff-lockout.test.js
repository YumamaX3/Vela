/**
 * freebuff lockout branches in markAccountUnavailable.
 * Both freebuff branches must precede the capped generic resetsAtMs path:
 *  - daily-quota 429 locks ACCOUNT-WIDE (modelLock___all) to the real resetAt,
 *    NOT truncated to MAX_RATE_LIMIT_COOLDOWN_MS (30 min).
 *  - model_locked 409 locks per-model for 65 min.
 * Mirrors tests/unit/github-monthly-usage-lock.test.js mock shape.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/localDb", () => dbMocks);
vi.mock("@/lib/network/connectionProxy", () => ({
  pickProxyPoolId: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(async () => ({})),
}));
vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {},
  resolveProviderId: (provider) => provider,
}));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));

const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getProviderConnections.mockResolvedValue([{
    id: "fb-1", provider: "freebuff", name: "fb-1", backoffLevel: 2,
  }]);
});

describe("freebuff daily-quota lockout", () => {
  it("locks the whole account (modelLock___all) to the real resetAt beyond the 30-min cap", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
    try {
      const resetAtMs = Date.parse("2026-08-16T07:00:00.000Z"); // ~19h out — beyond 30-min cap
      const resetIso = new Date(resetAtMs).toISOString();
      await markAccountUnavailable(
        "fb-1", 429,
        `freebuff: daily session quota exhausted — resets at ${resetIso}`,
        "freebuff", "mimo/mimo-v2.5", resetAtMs,
      );
      const patch = dbMocks.updateProviderConnection.mock.calls[0][1];
      expect(patch.modelLock___all).toBe(resetIso);
      expect(patch.testStatus).toBe("unavailable");
      expect(patch).not.toHaveProperty("modelLock_mimo/mimo-v2.5");
      // NOT truncated to 30 minutes: the lock expiry equals the real reset.
      const lockedMs = new Date(patch.modelLock___all).getTime() - Date.now();
      expect(lockedMs).toBeGreaterThan(30 * 60 * 1000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("parses resetAt from the error text when resetsAtMs is absent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
    try {
      const resetIso = "2026-08-16T07:00:00.000Z";
      await markAccountUnavailable(
        "fb-1", 429,
        `freebuff: daily session quota exhausted — resets at ${resetIso}`,
        "freebuff", "mimo/mimo-v2.5", null,
      );
      const patch = dbMocks.updateProviderConnection.mock.calls[0][1];
      expect(patch.modelLock___all).toBe(resetIso);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not lock non-freebuff providers via the freebuff branch", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
    try {
      dbMocks.getProviderConnections.mockResolvedValue([{ id: "g-1", provider: "github", backoffLevel: 0 }]);
      const resetAtMs = Date.parse("2026-08-16T07:00:00.000Z");
      await markAccountUnavailable("g-1", 429, "rate limited", "github", "m1", resetAtMs);
      const patch = dbMocks.updateProviderConnection.mock.calls[0][1];
      // generic path caps at 30 min -> per-model lock, not account-wide resetAt
      expect(patch).not.toHaveProperty("modelLock___all");
      expect(patch).toHaveProperty("modelLock_m1");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("freebuff model_locked lockout", () => {
  it("locks per-model for 65 minutes on a 409 model_locked", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
    try {
      await markAccountUnavailable(
        "fb-1", 409,
        "freebuff: model_locked — this account's session is locked to another model",
        "freebuff", "openai/gpt-5.6-luna", null,
      );
      const patch = dbMocks.updateProviderConnection.mock.calls[0][1];
      const key = "modelLock_openai/gpt-5.6-luna";
      expect(patch).toHaveProperty(key);
      const lockedMs = new Date(patch[key]).getTime() - Date.now();
      // 65 min ± tolerance
      expect(lockedMs).toBeGreaterThan(64 * 60 * 1000);
      expect(lockedMs).toBeLessThan(66 * 60 * 1000);
      expect(patch).not.toHaveProperty("modelLock___all");
    } finally {
      vi.useRealTimers();
    }
  });
});
