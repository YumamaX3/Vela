// In-memory progressive lockout + fixed-window rate limit for the dashboard
// login surface.
//
// RESIDUAL (documented, accepted): both stores live in process memory — a
// restart clears every lockout and every rate-limit window. That is the
// accepted trade-off: the ladder exists to make brute force expensive within
// a process lifetime, and an attacker's best case after a restart is a fresh
// ladder, still bounded by the fixed window. A persistent store would buy
// survival across restarts at the cost of a DB write on every failed login,
// which this surface does not need yet.
import { hasTrustedPeerHeaders } from "./trustedPeer.js";

// Escalation ladder (house pattern — rules/security.md): 5 failures → 1 min,
// 10 → 15 min, 20 → 1 hour. Failure counts accumulate across tiers until a
// success clears them entirely; once the top tier is served, every further
// failure re-locks for the top-tier duration.
const LOCK_THRESHOLDS = [
  { fails: 5, lockMs: 60_000 },
  { fails: 10, lockMs: 15 * 60_000 },
  { fails: 20, lockMs: 60 * 60_000 },
];

// Fixed-window limiter on the login route itself, INDEPENDENT of the failure
// ladder: RATE_LIMIT_MAX attempts per window per IP. The ladder punishes
// wrong passwords; this bounds raw request volume even for attempts that
// never reach a password compare (already locked, refused origins, ...).
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 15 * 60_000;

// Ladder entries idle (no failures, not locked) for over an hour are dropped.
const ENTRY_TTL_MS = 60 * 60_000;

let nowFn = () => Date.now();
// Injectable clock for tests — setNow(null) restores Date.now.
export function setNow(fn) { nowFn = fn || (() => Date.now()); }

const lockouts = new Map(); // ipKey → { fails, tier, lockUntil, lastActivityAt }
const rateWindows = new Map(); // ipKey → { windowStart, count }

function getLockoutEntry(ip) {
  const e = lockouts.get(ip);
  if (!e) return null;
  const now = nowFn();
  const stillLocked = e.lockUntil && now < e.lockUntil;
  if (now - (e.lastActivityAt || 0) > ENTRY_TTL_MS && !stillLocked) {
    lockouts.delete(ip);
    return null;
  }
  return e;
}

export function checkLock(ip) {
  const e = lockouts.get(ip);
  if (!e || !e.lockUntil) return { locked: false };
  const remaining = e.lockUntil - nowFn();
  if (remaining <= 0) return { locked: false };
  return { locked: true, retryAfter: Math.ceil(remaining / 1000) };
}

export function recordFail(ip) {
  const now = nowFn();
  const e = getLockoutEntry(ip) || { fails: 0, tier: 0, lockUntil: 0, lastActivityAt: now };
  e.fails += 1;
  e.lastActivityAt = now;
  // Clamped index: once the top tier is reached it stays put, so every
  // further failure re-locks for the top-tier duration rather than falling
  // off the end of the ladder.
  const idx = Math.min(e.tier, LOCK_THRESHOLDS.length - 1);
  const threshold = LOCK_THRESHOLDS[idx];
  if (e.fails >= threshold.fails) {
    e.lockUntil = now + threshold.lockMs;
    if (e.tier < LOCK_THRESHOLDS.length) e.tier += 1;
  }
  lockouts.set(ip, e);
  const next = LOCK_THRESHOLDS[Math.min(e.tier, LOCK_THRESHOLDS.length - 1)];
  return { remainingBeforeLock: next ? Math.max(0, next.fails - e.fails) : 0 };
}

export function recordSuccess(ip) {
  lockouts.delete(ip);
}

// Every login attempt (success or failure, even one short-circuited by a
// lock) consumes one slot of the caller's fixed window. Window expiry clears
// the slate: the next attempt starts a fresh window.
export function consumeLoginAttempt(ip) {
  const now = nowFn();
  let w = rateWindows.get(ip);
  if (!w || now - w.windowStart >= RATE_LIMIT_WINDOW_MS) {
    w = { windowStart: now, count: 0 };
    rateWindows.set(ip, w);
  }
  w.count += 1;
  if (rateWindows.size > 10_000) {
    for (const [key, entry] of rateWindows) {
      if (now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) rateWindows.delete(key);
    }
  }
  if (w.count <= RATE_LIMIT_MAX) {
    return { allowed: true, remaining: RATE_LIMIT_MAX - w.count };
  }
  const retryAfter = Math.max(1, Math.ceil((w.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000));
  return { allowed: false, retryAfter };
}

export function getClientIp(request) {
  // x-9r-real-ip is honored ONLY when custom-server.js proves it stamped the
  // header from the TCP socket (the per-process peer token). Without that
  // proof the header is attacker-supplied input — trusting it as the bucket
  // key would let a client rotate the value to escape its own lockout.
  if (hasTrustedPeerHeaders(request)) {
    const realIp = request.headers.get("x-9r-real-ip");
    if (realIp) return realIp;
  }
  // Behind a trusted reverse proxy that overwrites XFF with the real client IP.
  if (process.env.TRUST_PROXY === "true") {
    const xff = request.headers.get("x-forwarded-for");
    if (xff) return xff.split(",")[0].trim();
  }
  // Direct exposure without custom-server: single bucket so spoofed XFF
  // rotation cannot escape the limiter.
  return "unknown";
}

// Test hygiene — clears both stores and restores the real clock.
export function resetForTests() {
  lockouts.clear();
  rateWindows.clear();
  nowFn = () => Date.now();
}
