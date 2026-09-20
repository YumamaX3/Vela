// W2 · Error semantics — cooldownRetry (v0.9.75)
//
// When every candidate account is cooling down, wait out a SHORT cooldown and
// retry once instead of answering 503; give up when the wait would be long.
// The helper is pure (injectable clock, plain AbortSignal) so the decision and
// the sleep are proven without a live request.
import { describe, expect, it, vi } from "vitest";
import {
  maybeWaitForCooldown,
  sleepMs,
  MAX_RETRY_WAIT_MS,
} from "../../open-sse/utils/cooldownRetry.js";

describe("maybeWaitForCooldown — wait when the earliest expiry is <= 30s", () => {
  it("waits and retries when the earliest expiry is 5s out", async () => {
    vi.useFakeTimers();
    try {
      const now = Date.now();
      const p = maybeWaitForCooldown({
        retryAfter: new Date(now + 5000).toISOString(),
        retriesSoFar: 0,
      });
      await vi.advanceTimersByTimeAsync(5000);
      await expect(p).resolves.toEqual({ shouldRetry: true, waitedMs: 5000 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits at exactly the 30s bound", async () => {
    vi.useFakeTimers();
    try {
      const now = Date.now();
      const p = maybeWaitForCooldown({
        retryAfter: now + MAX_RETRY_WAIT_MS,
        retriesSoFar: 0,
      });
      await vi.advanceTimersByTimeAsync(MAX_RETRY_WAIT_MS);
      await expect(p).resolves.toEqual({ shouldRetry: true, waitedMs: MAX_RETRY_WAIT_MS });
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries immediately (no sleep) when the cooldown already elapsed", async () => {
    const r = await maybeWaitForCooldown({ retryAfter: Date.now() - 1000, retriesSoFar: 0 });
    expect(r).toEqual({ shouldRetry: true, waitedMs: 0 });
  });

  it("accepts epoch-ms and Date retryAfter values", async () => {
    const now = 1_000_000;
    const epoch = await maybeWaitForCooldown({ retryAfter: now + 3000, retriesSoFar: 0, now: () => now, maxWaitMs: 30000 });
    expect(epoch).toEqual({ shouldRetry: true, waitedMs: 3000 });
    const date = await maybeWaitForCooldown({ retryAfter: new Date(now + 1000), retriesSoFar: 0, now: () => now });
    expect(date).toEqual({ shouldRetry: true, waitedMs: 1000 });
  });
});

describe("maybeWaitForCooldown — give up when the wait would be long", () => {
  it("gives up when the earliest expiry is 31s out (> 30s)", async () => {
    const now = 2_000_000;
    const r = await maybeWaitForCooldown({ retryAfter: now + 31_000, retriesSoFar: 0, now: () => now });
    expect(r).toEqual({ shouldRetry: false, reason: "wait_too_long" });
  });

  it("gives up when the earliest expiry is an hour out", async () => {
    const now = 3_000_000;
    const r = await maybeWaitForCooldown({ retryAfter: now + 3600_000, retriesSoFar: 0, now: () => now });
    expect(r.shouldRetry).toBe(false);
    expect(r.reason).toBe("wait_too_long");
  });
});

describe("maybeWaitForCooldown — guards", () => {
  it("gives up once the retry budget is spent", async () => {
    const r = await maybeWaitForCooldown({ retryAfter: Date.now() + 1000, retriesSoFar: 1 });
    expect(r).toEqual({ shouldRetry: false, reason: "budget_exhausted" });
  });

  it("gives up on a missing/unparseable retryAfter", async () => {
    expect(await maybeWaitForCooldown({ retryAfter: null, retriesSoFar: 0 }))
      .toEqual({ shouldRetry: false, reason: "invalid_retry_after" });
    expect(await maybeWaitForCooldown({ retryAfter: "not-a-date", retriesSoFar: 0 }))
      .toEqual({ shouldRetry: false, reason: "invalid_retry_after" });
  });

  it("does not wait when the client already disconnected", async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await maybeWaitForCooldown({ retryAfter: Date.now() + 1000, retriesSoFar: 0, signal: ac.signal });
    expect(r).toEqual({ shouldRetry: false, reason: "client_disconnected" });
  });

  it("aborts the sleep when the client disconnects mid-wait", async () => {
    const ac = new AbortController();
    const p = maybeWaitForCooldown({ retryAfter: Date.now() + 20_000, retriesSoFar: 0, signal: ac.signal });
    ac.abort();
    const r = await p;
    expect(r.shouldRetry).toBe(false);
    expect(r.reason).toBe("client_disconnected");
  });
});

describe("sleepMs", () => {
  it("resolves after the delay", async () => {
    vi.useFakeTimers();
    try {
      let done = false;
      const p = sleepMs(1000).then(() => { done = true; });
      await vi.advanceTimersByTimeAsync(1000);
      await p;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort(new Error("gone"));
    await expect(sleepMs(1000, ac.signal)).rejects.toThrow("gone");
  });
});
