// M0 Tag 3 — loginLimiter contract: escalation ladder, fixed-window rate
// limit, and IP keying trust. Uses the module's injectable clock (setNow)
// instead of fake timers so window/lock arithmetic is exact.
import { describe, it, expect, beforeEach, afterEach } from "vitest";

const {
  checkLock,
  recordFail,
  recordSuccess,
  consumeLoginAttempt,
  getClientIp,
  setNow,
  resetForTests,
} = await import("../../src/lib/auth/loginLimiter.js");

const PEER_TOKEN = "peer-token-fixture";
const MIN = 60_000;

function request(headers = {}) {
  return { headers: new Headers(headers) };
}

describe("loginLimiter — escalation ladder (house pattern)", () => {
  let now;
  beforeEach(() => {
    resetForTests();
    now = 1_000_000_000_000;
    setNow(() => now);
  });
  afterEach(() => resetForTests());

  function fail(n, ip = "198.51.100.7") {
    let last;
    for (let i = 0; i < n; i++) last = recordFail(ip);
    return last;
  }

  it("locks for 1 minute at the 5th failure", () => {
    expect(checkLock("198.51.100.7").locked).toBe(false);
    const fourth = fail(4);
    expect(checkLock("198.51.100.7").locked).toBe(false);
    expect(fourth.remainingBeforeLock).toBe(1); // one more failure until lock
    fail(1); // the 5th — locks; remainingBeforeLock now counts toward tier 2

    const lock = checkLock("198.51.100.7");
    expect(lock.locked).toBe(true);
    expect(lock.retryAfter).toBe(60);
  });

  it("escalates to 15 minutes at the 10th failure", () => {
    fail(5);
    now += MIN; // first lock expires
    fail(5);

    const lock = checkLock("198.51.100.7");
    expect(lock.locked).toBe(true);
    expect(lock.retryAfter).toBe(15 * 60);
  });

  it("escalates to 1 hour at the 20th failure and holds the top tier", () => {
    fail(5);
    now += MIN;
    fail(5);
    now += 15 * MIN;
    fail(10);

    expect(checkLock("198.51.100.7").retryAfter).toBe(60 * 60);

    // Past the ladder's end, every further failure re-locks at the top tier.
    now += 60 * MIN;
    fail(1);
    expect(checkLock("198.51.100.7").retryAfter).toBe(60 * 60);
  });

  it("success resets the failure count and the ladder", () => {
    fail(4);
    recordSuccess("198.51.100.7");

    fail(4);
    expect(checkLock("198.51.100.7").locked).toBe(false); // reset, not tier 2
    fail(1);
    expect(checkLock("198.51.100.7").retryAfter).toBe(60); // tier 1 again
  });

  it("success after a lock clears the lockout entirely", () => {
    fail(5);
    now += MIN; // lock expires
    recordSuccess("198.51.100.7");
    expect(checkLock("198.51.100.7").locked).toBe(false);
  });

  it("lockouts are per-IP", () => {
    fail(5, "198.51.100.7");
    expect(checkLock("198.51.100.7").locked).toBe(true);
    expect(checkLock("198.51.100.8").locked).toBe(false);
  });
});

describe("loginLimiter — fixed-window rate limit", () => {
  let now;
  beforeEach(() => {
    resetForTests();
    now = 1_000_000_000_000;
    setNow(() => now);
  });
  afterEach(() => resetForTests());

  it("allows 10 attempts per window and refuses the 11th with a Retry-After budget", () => {
    for (let i = 1; i <= 10; i++) {
      const g = consumeLoginAttempt("203.0.113.5");
      expect(g.allowed).toBe(true);
      expect(g.remaining).toBe(10 - i);
    }

    const denied = consumeLoginAttempt("203.0.113.5");
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfter).toBe(15 * 60); // window just started
  });

  it("the window expiry clears the limit", () => {
    for (let i = 0; i < 11; i++) consumeLoginAttempt("203.0.113.5");
    expect(consumeLoginAttempt("203.0.113.5").allowed).toBe(false);

    now += 15 * MIN;
    const fresh = consumeLoginAttempt("203.0.113.5");
    expect(fresh.allowed).toBe(true);
    expect(fresh.remaining).toBe(9);
  });

  it("the window counter is independent of the ladder (separate store)", () => {
    for (let i = 0; i < 5; i++) recordFail("203.0.113.5"); // ladder locks
    expect(checkLock("203.0.113.5").locked).toBe(true);

    // Every attempt the route admits past the lock check consumes a slot —
    // the two stores never interact, so the window bounds raw volume on its
    // own schedule.
    for (let i = 0; i < 10; i++) consumeLoginAttempt("203.0.113.5");
    expect(consumeLoginAttempt("203.0.113.5").allowed).toBe(false);
    // ...and the lock is still governed by the ladder alone.
    expect(checkLock("203.0.113.5").locked).toBe(true);
  });
});

describe("loginLimiter — IP keying trust", () => {
  beforeEach(() => {
    resetForTests();
    process.env.VELA_PEER_TOKEN = PEER_TOKEN;
    delete process.env.TRUST_PROXY;
  });
  afterEach(() => {
    resetForTests();
    delete process.env.VELA_PEER_TOKEN;
    delete process.env.TRUST_PROXY;
  });

  it("a spoofed x-9r-real-ip WITHOUT a valid peer token is NOT trusted as the key", () => {
    expect(getClientIp(request({ "x-9r-real-ip": "1.1.1.1" }))).toBe("unknown");
    expect(getClientIp(request({ "x-9r-real-ip": "2.2.2.2" }))).toBe("unknown");
  });

  it("a wrong peer token does not promote the spoofed header either", () => {
    const ip = getClientIp(request({
      "x-9r-real-ip": "1.1.1.1",
      "x-9r-peer-token": "guessed-token",
    }));
    expect(ip).toBe("unknown");
  });

  it("the stamped peer IP is the key only when the wrapper proved it", () => {
    const ip = getClientIp(request({
      "x-9r-real-ip": "203.0.113.9",
      "x-9r-peer-token": PEER_TOKEN,
    }));
    expect(ip).toBe("203.0.113.9");
  });

  it("spoofed IPs therefore share one lockout bucket (rotation cannot escape)", () => {
    setNow(() => Date.now());
    recordFail("unknown");
    recordFail("unknown");
    recordFail("unknown");
    recordFail("unknown");
    recordFail("unknown");

    // Two requests claiming different source IPs land in the same bucket.
    const first = getClientIp(request({ "x-9r-real-ip": "1.1.1.1" }));
    const second = getClientIp(request({ "x-9r-real-ip": "2.2.2.2" }));
    expect(checkLock(first).locked).toBe(true);
    expect(checkLock(second).locked).toBe(true);
  });
});
