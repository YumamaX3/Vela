// W2 · Error semantics — classify429 (v0.9.75)
//
// One HTTP status, three retry horizons. Vela's flat `{ status: 429,
// backoff: true }` rule cannot tell a per-minute rate limit from a dead daily
// quota; this suite proves the split and its cooldowns, and — just as
// importantly — that a 429 carrying no quota wording still gets today's
// exponential backoff (nothing existing regresses).
import { describe, expect, it } from "vitest";
import {
  classify429,
  looksLikeDailyQuota,
  looksLikeQuotaExhausted,
  getMsUntilTomorrowMidnightUTC,
  parseRetryAfter,
} from "../../open-sse/utils/classify429.js";
import {
  RATE_LIMIT_COOLDOWN_MS,
  QUOTA_EXHAUSTED_COOLDOWN_MS,
} from "../../open-sse/config/errorConfig.js";
import { checkFallbackError, getQuotaCooldown } from "../../open-sse/services/accountFallback.js";

describe("classify429 — three classes, three distinct cooldowns", () => {
  const daily = { error: { message: "You have exhausted today's quota. Try again tomorrow." } };
  const quota = { error: { message: "You exceeded your monthly quota. Check your plan and billing details." } };
  const rate = { error: { message: "Rate limit reached: too many requests. Please retry shortly." } };

  it("classifies a daily-quota 429 as daily_quota", () => {
    const r = classify429({ status: 429, body: daily });
    expect(r.kind).toBe("daily_quota");
  });

  it("classifies a monthly/billing 429 as quota_exhausted", () => {
    const r = classify429({ status: 429, body: quota });
    expect(r.kind).toBe("quota_exhausted");
    expect(r.cooldownMs).toBe(QUOTA_EXHAUSTED_COOLDOWN_MS);
  });

  it("classifies a bare 429 as rate_limit with the ~60s cooldown", () => {
    const r = classify429({ status: 429, body: rate });
    expect(r.kind).toBe("rate_limit");
    expect(r.cooldownMs).toBe(RATE_LIMIT_COOLDOWN_MS);
  });

  it("the three classes carry three DISTINCT cooldowns", () => {
    // Pin the clock at noon UTC so the derived daily lock is unambiguous.
    const noon = new Date("2026-09-20T12:00:00.000Z");
    const a = classify429({ status: 429, body: daily, now: noon }).cooldownMs;
    const b = classify429({ status: 429, body: quota, now: noon }).cooldownMs;
    const c = classify429({ status: 429, body: rate, now: noon }).cooldownMs;
    expect(new Set([a, b, c]).size).toBe(3);
    // daily_quota locks to the next UTC midnight — minutes to hours, but never
    // a flat 60s and never the fixed 1h window.
    expect(a).toBeGreaterThan(RATE_LIMIT_COOLDOWN_MS);
    expect(a).not.toBe(QUOTA_EXHAUSTED_COOLDOWN_MS);
    expect(a).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });

  it("daily_quota is derived from the clock, not a constant", () => {
    const noon = new Date("2026-09-20T12:00:00.000Z");
    const r = classify429({ status: 429, body: daily, now: noon });
    expect(r.cooldownMs).toBe(getMsUntilTomorrowMidnightUTC(noon));
    expect(r.cooldownMs).toBe(12 * 60 * 60 * 1000);
  });

  it("daily patterns take priority over generic quota wording", () => {
    // Matches BOTH /daily quota/ and /quota.*exceed/ — daily must win.
    const body = { error: { message: "daily quota exceeded — resets tomorrow" } };
    expect(looksLikeDailyQuota(body)).toBe(true);
    expect(classify429({ status: 429, body }).kind).toBe("daily_quota");
  });

  it("reads a nested error.message out of an object body", () => {
    expect(looksLikeQuotaExhausted({ error: { message: "insufficient quota" } })).toBe(true);
  });

  it("honours an explicit Retry-After on a plain rate limit", () => {
    const r = classify429({ status: 429, headers: { "retry-after": "5" }, body: rate });
    expect(r.kind).toBe("rate_limit");
    expect(r.cooldownMs).toBe(5000);
  });

  it("caps a bogus Retry-After at the quota horizon", () => {
    const r = classify429({ status: 429, headers: { "retry-after": "86400" }, body: rate });
    expect(r.cooldownMs).toBe(QUOTA_EXHAUSTED_COOLDOWN_MS);
  });

  it("parses Retry-After in seconds, relative units, and HTTP dates", () => {
    expect(parseRetryAfter("60")).toBe(60);
    expect(parseRetryAfter("5m")).toBe(300);
    expect(parseRetryAfter("2h")).toBe(7200);
    expect(parseRetryAfter("nonsense")).toBe(null);
  });

  it("never crashes on a malformed body", () => {
    expect(() => classify429({ status: 429, body: undefined })).not.toThrow();
    expect(classify429({ status: 429, body: undefined }).kind).toBe("rate_limit");
    expect(classify429(null).kind).toBe("rate_limit");
  });
});

describe("checkFallbackError — 429 wiring", () => {
  it("a daily-quota 429 produces the daily lock, not backoff seconds", () => {
    const r = checkFallbackError(429, "daily quota exceeded — try again tomorrow");
    expect(r.shouldFallback).toBe(true);
    expect(r.cooldownMs).toBeGreaterThan(RATE_LIMIT_COOLDOWN_MS);
    expect(r.cooldownMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });

  it("a quota-exhausted 429 produces the ~1h cooldown", () => {
    const r = checkFallbackError(429, JSON.stringify({
      error: { message: "You exceeded your monthly quota. Check your plan and billing details." },
    }));
    expect(r.cooldownMs).toBe(QUOTA_EXHAUSTED_COOLDOWN_MS);
  });

  it("an unknown 429 keeps today's exponential backoff", () => {
    const r = checkFallbackError(429, "nope", 0);
    expect(r).toEqual({
      shouldFallback: true,
      cooldownMs: getQuotaCooldown(1),
      newBackoffLevel: 1,
    });
  });

  it("a quota-worded 429 no longer collapses into the flat backoff", () => {
    // Before W2 this matched the `quota exceeded` TEXT rule → seconds.
    const before = getQuotaCooldown(1);
    const r = checkFallbackError(429, "quota exceeded");
    expect(r.cooldownMs).not.toBe(before);
    expect(r.cooldownMs).toBe(QUOTA_EXHAUSTED_COOLDOWN_MS);
  });

  it("non-429 statuses are untouched by the classifier", () => {
    // The text rules still own these — unchanged.
    expect(checkFallbackError(400, "rate limit reached")).toEqual({
      shouldFallback: true, cooldownMs: getQuotaCooldown(1), newBackoffLevel: 1,
    });
    expect(checkFallbackError(422, "quota exceeded")).toEqual({
      shouldFallback: true, cooldownMs: getQuotaCooldown(1), newBackoffLevel: 1,
    });
    expect(checkFallbackError(400, "maximum context length exceeded")).toEqual({
      shouldFallback: false, cooldownMs: 0,
    });
    expect(checkFallbackError(503, "upstream exploded").cooldownMs).toBe(30 * 1000);
    expect(checkFallbackError(401, "nope")).toEqual({ shouldFallback: true, cooldownMs: 2 * 60 * 1000 });
  });
});
