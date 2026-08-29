/**
 * freebuff bounded + ban cooldown branches in markAccountUnavailable.
 * Both families must precede the capped generic resetsAtMs path:
 *  - bounded codes rotate the account for their code-specific window
 *    (never truncated to MAX_RATE_LIMIT_COOLDOWN_MS, never midnight-locked),
 *    account-wide EXCEPT invalid_agent_model (per-model — the (egress, model)
 *    pairing only);
 *  - bans lock account-wide for 24h or until the body's resumes_at.
 * Also proves the ordering law: a bounded marker wins over a handed-over
 * resetsAtMs (chatCore passes parseError's projected reset even for bounded
 * kinds — the daily-quota branch must not capture it).
 * Mirrors tests/unit/freebuff-lockout.test.js mock shape.
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
import { FREEBUFF_COOLDOWNS } from "../../open-sse/config/freebuff.js";

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getProviderConnections.mockResolvedValue([{
    id: "fb-1", provider: "freebuff", name: "fb-1", backoffLevel: 2,
  }]);
});

describe("bounded cooldown codes — window + scope", () => {
  const cases = [
    ["free_mode_run_fanout", 429, FREEBUFF_COOLDOWNS.RUN_FANOUT_MS, true],
    ["free_mode_invalid_agent_model", 429, FREEBUFF_COOLDOWNS.INVALID_AGENT_MODEL_MS, false],
    ["load_shedding", 429, FREEBUFF_COOLDOWNS.LOAD_SHED_MS, true],
    ["peak_hours", 429, FREEBUFF_COOLDOWNS.PEAK_HOURS_MS, true],
    ["waiting_room_required", 428, FREEBUFF_COOLDOWNS.WAITING_ROOM_RETRY_MS, true],
    ["waiting_room_queued", 503, FREEBUFF_COOLDOWNS.WAITING_ROOM_RETRY_MS, true],
    ["session_limit_reached", 429, FREEBUFF_COOLDOWNS.WAITING_ROOM_RETRY_MS, true],
  ];

  for (const [marker, status, windowMs, accountWide] of cases) {
    it(`${marker} (${status}) → ${windowMs}ms ${accountWide ? "account-wide" : "per-model"} lock`, async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
      try {
        const result = await markAccountUnavailable(
          "fb-1", status, `freebuff: ${marker} — upstream says wait`, "freebuff", "mimo/mimo-v2.5",
        );
        expect(result.shouldFallback).toBe(true);
        expect(result.cooldownMs).toBe(windowMs);
        const patch = dbMocks.updateProviderConnection.mock.calls[0][1];
        if (accountWide) {
          expect(patch.modelLock___all).toBeTruthy();
          expect(patch).not.toHaveProperty("modelLock_mimo/mimo-v2.5");
        } else {
          expect(patch.modelLock___all).toBeUndefined();
          expect(patch["modelLock_mimo/mimo-v2.5"]).toBeTruthy();
        }
        expect(patch.testStatus).toBe("unavailable");
      } finally {
        vi.useRealTimers();
      }
    });
  }

  it("a bounded marker wins over a handed-over resetsAtMs (ordering law)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
    try {
      // chatCore hands over parseError's projected reset (now+2h) even though
      // the code is bounded — the bounded window (60s) must win, and the lock
      // must stay per-model for invalid_agent_model.
      const projectedResetMs = Date.now() + 2 * 3600 * 1000;
      const result = await markAccountUnavailable(
        "fb-1", 429, "freebuff: free_mode_invalid_agent_model", "freebuff", "mimo/mimo-v2.5", projectedResetMs,
      );
      expect(result.cooldownMs).toBe(FREEBUFF_COOLDOWNS.INVALID_AGENT_MODEL_MS);
      const patch = dbMocks.updateProviderConnection.mock.calls[0][1];
      expect(patch["modelLock_mimo/mimo-v2.5"]).toBeTruthy();
      expect(patch.modelLock___all).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ban cooldown — 24h account-wide, resumes_at aware", () => {
  it("banned 403 without resumes_at → 24h account-wide", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
    try {
      const result = await markAccountUnavailable(
        "fb-1", 403, '{"status":"banned"}', "freebuff", "mimo/mimo-v2.5",
      );
      expect(result.cooldownMs).toBe(FREEBUFF_COOLDOWNS.BAN_MS);
      const patch = dbMocks.updateProviderConnection.mock.calls[0][1];
      expect(patch.modelLock___all).toBeTruthy();
      expect(patch).not.toHaveProperty("modelLock_mimo/mimo-v2.5");
    } finally {
      vi.useRealTimers();
    }
  });

  it("account_suspended with resumes_at locks until that moment (ceiling-clamped)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
    try {
      const resumesIso = "2026-08-17T12:00:00.000Z"; // 48h out — under the 7d ceiling
      const result = await markAccountUnavailable(
        "fb-1", 403, `{"error":"account_suspended","resumes_at":"${resumesIso}"}`, "freebuff", "mimo/mimo-v2.5",
      );
      expect(result.cooldownMs).toBe(Date.parse(resumesIso) - Date.now());
      const patch = dbMocks.updateProviderConnection.mock.calls[0][1];
      expect(patch.modelLock___all).toBe(resumesIso);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a 403 merely mentioning banned is NOT a ban lock", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
    try {
      const result = await markAccountUnavailable(
        "fb-1", 403, "freebuff: access denied", "freebuff", "mimo/mimo-v2.5",
      );
      // Falls to the generic fallback machinery — not the 24h ban window.
      expect(result.cooldownMs).not.toBe(FREEBUFF_COOLDOWNS.BAN_MS);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("non-freebuff providers never ride these branches", () => {
  it("the same text on another provider ignores every freebuff branch", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
    try {
      await markAccountUnavailable(
        "fb-1", 429, "freebuff: free_mode_run_fanout", "openai", "gpt-4o",
      );
      const patch = dbMocks.updateProviderConnection.mock.calls[0]?.[1];
      // Generic path — no freebuff-bounded window, no account-wide freebuff lock shape.
      expect(patch?.modelLock___all).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
