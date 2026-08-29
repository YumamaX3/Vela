/**
 * classifyGate — the complete ~20-code matrix, one fixture per code
 * (reference freebuff-proxy internal/upstream/ratelimit.go classifyError,
 * re-verified 2026-08-30). Body-marker kinds are status-agnostic; session
 * staleness is scoped to 409/410/428; bans match EXACT markers only.
 */
import { describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(async () => []),
  updateProviderConnection: vi.fn(async () => {}),
}));

vi.mock("@/lib/localDb", () => dbMocks);
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));

import { classifyGate, __test__ } from "../../open-sse/services/freebuffSession.js";
import { FREEBUFF_COOLDOWNS } from "../../open-sse/config/freebuff.js";

const body = (obj) => JSON.stringify(obj);
const err = (obj) => body({ error: obj });

describe("terminal account fates — exact markers", () => {
  it('403 {"status":"banned"} → banned', () => {
    const g = classifyGate(403, '{"status":"banned"}');
    expect(g.kind).toBe("banned");
  });

  it('403 {"error":"account_suspended"} → banned', () => {
    const g = classifyGate(403, body({ error: "account_suspended" }));
    expect(g.kind).toBe("banned");
  });

  it("ban bodies carry resumes_at into resetAt", () => {
    const iso = "2026-09-01T07:00:00.000Z";
    const g = classifyGate(403, `{"status":"banned","resumes_at":"${iso}"}`);
    expect(g.kind).toBe("banned");
    expect(g.resetAt).toBe(Date.parse(iso));
  });

  it("a 403 that merely mentions banned stays generic", () => {
    const g = classifyGate(403, err({ message: "you might be banned someday" }));
    expect(g.kind).toBe("other");
  });

  it("403 country_blocked → country_blocked", () => {
    const g = classifyGate(403, err({ code: "country_blocked", message: "not available in your region" }));
    expect(g.kind).toBe("country_blocked");
  });
});

describe("body-marker driven kinds — status-agnostic", () => {
  it("free_mode_run_fanout → run_fanout with the 60s window", () => {
    const g = classifyGate(429, err({ code: "free_mode_run_fanout" }));
    expect(g.kind).toBe("run_fanout");
    expect(g.retryAfterMs).toBe(FREEBUFF_COOLDOWNS.RUN_FANOUT_MS);
    // Same marker on a 403 also classifies (marker over status).
    expect(classifyGate(403, err({ message: "free_mode_run_fanout" })).kind).toBe("run_fanout");
  });

  it("free_mode_capacity_deferred → capacity_deferred with upstream retryAfterMs", () => {
    const g = classifyGate(429, err({ code: "free_mode_capacity_deferred", retryAfterMs: 12000 }));
    expect(g.kind).toBe("capacity_deferred");
    expect(g.retryAfterMs).toBe(12000);
  });

  it("free_mode_invalid_agent_model → invalid_agent_model 60s", () => {
    const g = classifyGate(400, err({ code: "free_mode_invalid_agent_model" }));
    expect(g.kind).toBe("invalid_agent_model");
    expect(g.retryAfterMs).toBe(FREEBUFF_COOLDOWNS.INVALID_AGENT_MODEL_MS);
  });

  it("waiting_room_queued → transient with the retry window", () => {
    const g = classifyGate(429, err({ code: "waiting_room_queued" }));
    expect(g.kind).toBe("waiting_room_queued");
    expect(g.retryAfterMs).toBe(FREEBUFF_COOLDOWNS.WAITING_ROOM_RETRY_MS);
  });

  it("waiting_room_required → required, honoring upstream retryAfterMs", () => {
    const g = classifyGate(428, err({ code: "waiting_room_required", retryAfterMs: 45000 }));
    expect(g.kind).toBe("waiting_room_required");
    expect(g.retryAfterMs).toBe(45000);
  });

  it("ip_capped → bounded admission, upstream retryAfterMs wins", () => {
    const g = classifyGate(429, err({ code: "ip_capped", retryAfterMs: 25000 }));
    expect(g.kind).toBe("ip_capped");
    expect(g.retryAfterMs).toBe(25000);
  });

  it("ip_capped without retryAfterMs falls back to the default window", () => {
    const g = classifyGate(429, err({ code: "ip_capped" }));
    expect(g.retryAfterMs).toBe(FREEBUFF_COOLDOWNS.IP_CAPPED_DEFAULT_MS);
  });

  it("session_superseded → superseded (terminal)", () => {
    const g = classifyGate(409, err({ code: "session_superseded" }));
    expect(g.kind).toBe("superseded");
    expect(g.code).toBe("session_superseded");
  });

  it("session_model_mismatch + limited → limited_ip", () => {
    const g = classifyGate(409, err({ code: "session_model_mismatch", message: "this ip is limited to other models" }));
    expect(g.kind).toBe("limited_ip");
    // mismatch WITHOUT limited is NOT limited_ip — falls to stale handling.
    expect(classifyGate(409, err({ code: "session_model_mismatch" })).kind).not.toBe("limited_ip");
  });
});

describe("status-scoped session staleness (409/410/428)", () => {
  it("409 session_limit_reached → session_limit", () => {
    const g = classifyGate(409, err({ code: "session_limit_reached" }));
    expect(g.kind).toBe("session_limit");
    expect(g.retryAfterMs).toBe(FREEBUFF_COOLDOWNS.WAITING_ROOM_RETRY_MS);
  });

  it("session_expired → reclaimable on all three statuses", () => {
    for (const status of [409, 410, 428]) {
      expect(classifyGate(status, err({ code: "session_expired" })).kind).toBe("reclaimable");
    }
  });

  it("the ErrSessionInvalid family → reclaimable", () => {
    for (const code of ["freebuff_update_required", "free_mode_legacy_luna_agent", "free_mode_legacy_luna"]) {
      expect(classifyGate(409, err({ code })).kind).toBe("reclaimable");
    }
  });

  it("model_locked → model_locked", () => {
    expect(classifyGate(409, err({ code: "model_locked" })).kind).toBe("model_locked");
  });

  it("unknown stale codes → stale_unknown", () => {
    expect(classifyGate(409, err({ code: "some_future_code" })).kind).toBe("stale_unknown");
  });
});

describe("auth + CLI gate", () => {
  it("401 → auth", () => {
    expect(classifyGate(401, err({ message: "unauthorized" })).kind).toBe("auth");
  });

  it("403 free_mode_cli_required → cli_required", () => {
    expect(classifyGate(403, err({ code: "free_mode_cli_required" })).kind).toBe("cli_required");
  });
});

describe("quota family — midnight lock vs bounded backoff", () => {
  it("429 with resetAt → daily_quota carrying the epoch", () => {
    const iso = "2026-08-16T07:00:00.000Z";
    const g = classifyGate(429, err({ resetAt: iso }));
    expect(g.kind).toBe("daily_quota");
    expect(g.resetAt).toBe(Date.parse(iso));
  });

  it("unix-seconds resetAt is projected to milliseconds", () => {
    const g = classifyGate(429, err({ reset_at: 1787000000 })); // < 1e12 → seconds
    expect(g.kind).toBe("daily_quota");
    expect(g.resetAt).toBe(1787000000 * 1000);
  });

  it("pacific_day/pacific_week at limit → daily_quota without a timestamp", () => {
    expect(classifyGate(429, err({ period: "pacific_day", limit: 40, recentCount: 40 })).kind).toBe("daily_quota");
    expect(classifyGate(429, err({ period: "pacific_week", limit: 200, recentCount: 250 })).kind).toBe("daily_quota");
  });

  it("isDailyCapScalars rejects malformed caps", () => {
    const s = __test__.isDailyCapScalars;
    expect(s({ period: "pacific_day", limit: 40, recentCount: 40 })).toBe(true);
    expect(s({ period: "pacific_day", limit: 40, recentCount: 10 })).toBe(false); // under limit
    expect(s({ period: "pacific_day", limit: 0, recentCount: 5 })).toBe(false);   // no limit
    expect(s({ period: "pacific_day", limit: 40 })).toBe(false);                  // no counter
    expect(s({ period: "hourly", limit: 40, recentCount: 40 })).toBe(false);      // wrong period
  });

  it("insufficient_quota / limit_burst_rate → load_shedding 90s (never midnight)", () => {
    for (const msg of ["insufficient_quota", "limit_burst_rate"]) {
      const g = classifyGate(429, err({ message: msg }));
      expect(g.kind).toBe("load_shedding");
      expect(g.retryAfterMs).toBe(FREEBUFF_COOLDOWNS.LOAD_SHED_MS);
    }
  });

  it('"peak hours" → peak_hours 30min', () => {
    const g = classifyGate(429, err({ message: "Free tier is at Peak Hours capacity" }));
    expect(g.kind).toBe("peak_hours");
    expect(g.retryAfterMs).toBe(FREEBUFF_COOLDOWNS.PEAK_HOURS_MS);
  });

  it("opaque 429 → bounded backoff", () => {
    const g = classifyGate(429, err({ message: "slow down" }));
    expect(g.kind).toBe("bounded_429");
    expect(g.retryAfterMs).toBe(FREEBUFF_COOLDOWNS.OPAQUE_429_MS);
  });

  it("rate_limited code without quota signals → bounded backoff", () => {
    expect(classifyGate(500, err({ code: "rate_limited" })).kind).toBe("bounded_429");
    expect(classifyGate(500, err({ code: "spend_limited" })).kind).toBe("bounded_429");
  });
});

describe("scalar extraction hygiene", () => {
  it("retryAfterMs is clamped to the 7-day ceiling", () => {
    const g = classifyGate(429, err({ code: "ip_capped", retryAfterMs: 999999999999 }));
    expect(g.retryAfterMs).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000);
  });

  it("negative or zero retryAfterMs falls back to defaults", () => {
    const g = classifyGate(429, err({ code: "ip_capped", retryAfterMs: -5 }));
    expect(g.retryAfterMs).toBe(FREEBUFF_COOLDOWNS.IP_CAPPED_DEFAULT_MS);
  });

  it("non-JSON bodies never throw", () => {
    expect(classifyGate(500, "gateway exploded").kind).toBe("other");
    expect(classifyGate(429, "").kind).toBe("bounded_429");
    expect(classifyGate(403, "<html>access denied</html>").kind).toBe("other");
  });
});
