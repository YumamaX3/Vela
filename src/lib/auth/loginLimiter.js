// Progressive lockout + fixed-window rate limit for the dashboard login
// surface — now DURABLE (Auth Hardening W1, migration 016).
//
// WHAT CHANGED, AND WHY THE OLD PARAGRAPH IS GONE
// This file's previous header called process-memory storage an "accepted
// residual": a restart cleared every lockout and every fixed window. That was
// true then and is false now. The ladder and the window live in `authFailures`
// (one row per caller key, carrying BOTH), so a lockout survives a restart, a
// redeploy, and a second process — which is the entire point of a ladder.
//
// THE DURABLE ARM ENGAGES WHEN THE HARBOR IS OPEN
// Reads/writes go through the adapter the moment one exists, resolved with
// getAdapterSync() — never getAdapter(), because this module's public contract
// is SYNCHRONOUS (the login route consults the ladder before it parses a body)
// and because opening a harbor as a side effect of an import or a unit test
// would be a wound, not a feature. When no adapter is open yet, the in-memory
// maps serve, exactly as they did before.
//
// THE ONE HONEST GAP — the cold-start blind spot: on the first login request
// after a process starts, no adapter is open yet (the route's own getSettings()
// is what opens it, a few lines later), so that single checkLock reads memory
// and may miss a lockout persisted by the previous process. Every attempt after
// it is durable, and the attacker gains one request — against a store that
// re-locks on the next failure because `fails` never reset. Named rather than
// papered over.
//
// FAIL-OPEN: an adapter error disarms the durable arm (one latched warning) and
// falls back to memory. A store that cannot be read must never brick the gate.
import { hasTrustedPeerHeaders } from "./trustedPeer.js";
import { getAdapterSync } from "@/lib/db/driver.js";
import {
  readFailureRow,
  upsertFailureRow,
  deleteFailureRow,
  deleteAllFailureRows,
} from "@/lib/db/repos/authStoreRepo.js";

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

// The in-memory mirror is bounded so a flood of distinct keys cannot grow it
// without end; the durable store is the authority when the harbor is open.
const MAX_MEMORY_ENTRIES = 10_000;

let nowFn = () => Date.now();
// Injectable clock for tests — setNow(null) restores Date.now.
export function setNow(fn) { nowFn = fn || (() => Date.now()); }

// ipKey → { fails, tier, lockUntil, windowStart, windowCount, lastActivityAt }
const entries = new Map();

let warned = false;
function warnOnce(err) {
  if (warned) return;
  warned = true;
  console.warn("[loginLimiter] durable store unavailable — in-memory only (fail-open):", err?.message || err);
}

/** The open harbor, or null. Never opens one — see the header. */
function store() {
  try {
    return getAdapterSync();
  } catch {
    return null;
  }
}

/** Read one row — durable harbor first, in-memory mirror second. Prunes idle
 *  entries. An adapter error disarms the durable arm and falls back. */
function readEntry(ip, now) {
  const db = store();
  if (db) {
    try {
      const row = readFailureRow(db, ip);
      if (!row) return null;
      const entry = {
        fails: row.fails ?? 0,
        tier: row.tier ?? 0,
        lockUntil: row.lockUntil ?? 0,
        windowStart: row.windowStart ?? 0,
        windowCount: row.windowCount ?? 0,
        lastActivityAt: row.lastActivityAt ?? 0,
      };
      const stillLocked = entry.lockUntil && now < entry.lockUntil;
      if (now - (entry.lastActivityAt || 0) > ENTRY_TTL_MS && !stillLocked) {
        try { deleteFailureRow(db, ip); } catch (err) { warnOnce(err); }
        entries.delete(ip);
        return null;
      }
      entries.set(ip, entry);
      return entry;
    } catch (err) {
      warnOnce(err); // fall through to memory
    }
  }
  const e = entries.get(ip);
  if (!e) return null;
  const stillLocked = e.lockUntil && now < e.lockUntil;
  if (now - (e.lastActivityAt || 0) > ENTRY_TTL_MS && !stillLocked) {
    entries.delete(ip);
    return null;
  }
  return e;
}

/** Write one row through to the durable harbor (when open) and mirror it in
 *  memory, so a mid-process harbor loss degrades to a WARM map, not a blank. */
function writeEntry(ip, entry) {
  if (entry) {
    entries.set(ip, entry);
    if (entries.size > MAX_MEMORY_ENTRIES) pruneIdleMemory();
  } else {
    entries.delete(ip);
  }
  const db = store();
  if (!db) return;
  try {
    if (entry) upsertFailureRow(db, ip, entry);
    else deleteFailureRow(db, ip);
  } catch (err) {
    warnOnce(err); // the mirror already holds the truth for this process
  }
}

function pruneIdleMemory() {
  const cutoff = nowFn() - ENTRY_TTL_MS;
  for (const [key, entry] of entries) {
    if ((entry.lastActivityAt || 0) < cutoff) entries.delete(key);
  }
}

export function checkLock(ip) {
  const e = readEntry(ip, nowFn());
  if (!e || !e.lockUntil) return { locked: false };
  const remaining = e.lockUntil - nowFn();
  if (remaining <= 0) return { locked: false };
  return { locked: true, retryAfter: Math.ceil(remaining / 1000) };
}

export function recordFail(ip) {
  const now = nowFn();
  const e = readEntry(ip, now) || {
    fails: 0, tier: 0, lockUntil: 0,
    windowStart: 0, windowCount: 0, lastActivityAt: now,
  };
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
  writeEntry(ip, e);
  const next = LOCK_THRESHOLDS[Math.min(e.tier, LOCK_THRESHOLDS.length - 1)];
  return { remainingBeforeLock: next ? Math.max(0, next.fails - e.fails) : 0 };
}

export function recordSuccess(ip) {
  writeEntry(ip, null);
}

// Every login attempt (success or failure, even one short-circuited by a
// lock) consumes one slot of the caller's fixed window. Window expiry clears
// the slate: the next attempt starts a fresh window. The window rides the SAME
// row as the ladder — one caller key, one row, both counters.
export function consumeLoginAttempt(ip) {
  const now = nowFn();
  const e = readEntry(ip, now) || {
    fails: 0, tier: 0, lockUntil: 0,
    windowStart: 0, windowCount: 0, lastActivityAt: now,
  };
  if (!e.windowStart || now - e.windowStart >= RATE_LIMIT_WINDOW_MS) {
    e.windowStart = now;
    e.windowCount = 0;
  }
  e.windowCount += 1;
  e.lastActivityAt = now;
  writeEntry(ip, e);
  if (e.windowCount <= RATE_LIMIT_MAX) {
    return { allowed: true, remaining: RATE_LIMIT_MAX - e.windowCount };
  }
  const retryAfter = Math.max(1, Math.ceil((e.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000));
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

// Test hygiene — clears the in-memory mirror AND the durable rows (a test that
// left a ladder row behind would poison the next one), and restores the real
// clock. The latched warning is re-armed so a store failure is reported again.
export function resetForTests() {
  entries.clear();
  nowFn = () => Date.now();
  warned = false;
  const db = store();
  if (!db) return;
  try {
    deleteAllFailureRows(db);
  } catch (err) {
    warnOnce(err);
  }
}
